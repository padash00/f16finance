import { NextResponse } from 'next/server'

import { validateAdminToken } from '@/lib/server/admin-tokens'
import { requirePointDevice } from '@/lib/server/point-devices'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function checkSuperAdmin(token: string): boolean {
  return validateAdminToken(token) !== null
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

    const { supabase: deviceSupabase, device } = point

    // Суперадмин может передать токен через заголовок для получения данных ВСЕХ точек
    const adminToken = request.headers.get('x-admin-token') || ''
    const isSuperAdmin = adminToken ? checkSuperAdmin(adminToken) : false

    const supabase = isSuperAdmin ? createAdminSupabaseClient() : deviceSupabase

    const debtQuery = supabase
      .from('point_debt_items')
      .select('id, operator_id, client_name, item_name, quantity, total_amount, comment, status, created_at, deleted_at, operator:operator_id(id, name, short_name)')
      .order('created_at', { ascending: false })
      .limit(isSuperAdmin ? 2000 : 500)

    const shiftsQuery = supabase
      .from('incomes')
      .select('id, date, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment, operator_id, company_id')
      .order('date', { ascending: false })
      .limit(isSuperAdmin ? 1000 : 200)

    if (!isSuperAdmin) {
      debtQuery.eq('company_id', device.company_id)
      shiftsQuery.eq('company_id', device.company_id)
    }

    const [
      { data: debtItems, error: debtItemsError },
      { data: shiftRows, error: shiftRowsError },
    ] = await Promise.all([debtQuery, shiftsQuery])

    if (debtItemsError) throw debtItemsError
    if (shiftRowsError) throw shiftRowsError

    // Для суперадмина загружаем названия компаний
    const companyNameMap = new Map<string, string>()
    if (isSuperAdmin) {
      const companyIds = [...new Set((shiftRows || []).map((r: any) => r.company_id).filter(Boolean))]
      if (companyIds.length > 0) {
        const { data: companiesData } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', companyIds)
        for (const c of companiesData || []) {
          companyNameMap.set(c.id, c.name)
        }
      }
    }

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
      return {
        id: row.id,
        date: row.date,
        shift: row.shift,
        zone: row.zone,
        company_id: row.company_id || null,
        company_name: companyNameMap.get(row.company_id) || null,
        operator_id: row.operator_id || null,
        operator_name: null, // resolved on client via bootstrap.operators
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
