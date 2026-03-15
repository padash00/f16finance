import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function extractBarcode(comment: string | null | undefined) {
  const raw = String(comment || '')
  const marker = 'barcode:'
  if (!raw.includes(marker)) return null
  return raw.split(marker, 2)[1]?.trim() || null
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point

    const [
      { data: debtItems, error: debtItemsError },
      { data: shiftRows, error: shiftRowsError },
    ] = await Promise.all([
      supabase
        .from('point_debt_items')
        .select(
          'id, operator_id, client_name, item_name, quantity, total_amount, comment, status, created_at, deleted_at, operator:operator_id(id, name, short_name)',
        )
        .eq('company_id', device.company_id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('incomes')
        .select('id, date, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment, operator_id, operator:operator_id(id, name, short_name)')
        .eq('company_id', device.company_id)
        .order('date', { ascending: false })
        .limit(50),
    ])

    if (debtItemsError) throw debtItemsError
    if (shiftRowsError) throw shiftRowsError

    const activeDebtItems = ((debtItems || []) as any[]).filter((item) => item.status === 'active')

    const warehouseMap = new Map<string, { barcode: string; item_name: string; quantity: number }>()
    const workerTotalsMap = new Map<string, number>()
    const clientTotalsMap = new Map<string, number>()

    for (const item of activeDebtItems) {
      const barcode = extractBarcode(item.comment) || '—'
      const itemName = String(item.item_name || 'Товар')
      const qty = Number(item.quantity || 0)
      const amount = Number(item.total_amount || 0)
      const operator = Array.isArray(item.operator) ? item.operator[0] || null : item.operator || null
      const debtorName = operator?.name || item.client_name || 'Должник'

      const warehouseKey = `${barcode}::${itemName}`
      const warehouseHit = warehouseMap.get(warehouseKey)
      if (warehouseHit) {
        warehouseHit.quantity += qty
      } else {
        warehouseMap.set(warehouseKey, {
          barcode,
          item_name: itemName,
          quantity: qty,
        })
      }

      if (item.operator_id) {
        workerTotalsMap.set(debtorName, (workerTotalsMap.get(debtorName) || 0) + amount)
      } else {
        clientTotalsMap.set(debtorName, (clientTotalsMap.get(debtorName) || 0) + amount)
      }
    }

    const warehouse = Array.from(warehouseMap.values()).sort((a, b) => a.item_name.localeCompare(b.item_name))
    const worker_totals = Array.from(workerTotalsMap.entries())
      .map(([name, total_amount]) => ({ name, total_amount }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const client_totals = Array.from(clientTotalsMap.entries())
      .map(([name, total_amount]) => ({ name, total_amount }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const debt_history = ((debtItems || []) as any[]).map((item) => {
      const operator = Array.isArray(item.operator) ? item.operator[0] || null : item.operator || null
      return {
        id: item.id,
        debtor_name: operator?.name || item.client_name || 'Должник',
        item_name: item.item_name,
        barcode: extractBarcode(item.comment),
        quantity: Number(item.quantity || 0),
        total_amount: Number(item.total_amount || 0),
        status: item.status || 'active',
        created_at: item.created_at,
        deleted_at: item.deleted_at || null,
      }
    })

    const shifts = ((shiftRows || []) as any[]).map((row) => {
      const operator = Array.isArray(row.operator) ? row.operator[0] || null : row.operator || null
      return {
        id: row.id,
        date: row.date,
        shift: row.shift,
        zone: row.zone,
        operator_name: operator?.name || 'Оператор',
        start_cash: null,
        actual_amount:
          Number(row.cash_amount || 0) +
          Number(row.kaspi_amount || 0) +
          Number(row.online_amount || 0) +
          Number(row.card_amount || 0),
        planned_amount: null,
        diff: null,
        cash_amount: Number(row.cash_amount || 0),
        kaspi_amount: Number(row.kaspi_amount || 0),
        online_amount: Number(row.online_amount || 0),
        card_amount: Number(row.card_amount || 0),
        comment: row.comment || null,
      }
    })

    return json({
      ok: true,
      data: {
        warehouse,
        worker_totals,
        client_totals,
        debt_history,
        shifts,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-reports:get',
      message: error?.message || 'Point reports GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить сводки точки' }, 500)
  }
}
