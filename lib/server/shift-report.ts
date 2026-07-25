import 'server-only'

import { fetchAllPages, chunkArray } from '@/lib/server/point-sales-core'

// Данные сменного отчёта — общий источник для чекового (80мм) и A4 Z-отчёта.
// Считается по shift_id (продажи/возвраты/позиции уже привязаны). Реквизиты —
// из point_receipt_settings (Реквизиты ККМ). Номер смены — порядковый по точке.

export type ShiftReportPosition = { name: string; unit: string; sold: number; stock: number; amount: number }

export type ShiftReport = {
  shiftId: string
  companyId: string
  pointName: string
  shiftNumber: number
  cashier: string
  openedAt: string | null
  closedAt: string | null
  requisites: { name: string; bin: string; address: string; kkmReg: string; ofd: string }
  cashSales: number
  cashCount: number
  kaspiSales: number
  kaspiCount: number
  returns: number
  checkCount: number
  total: number
  openingCash: number
  closingCash: number
  positions: ShiftReportPosition[]
  goodsTotal: number
}

export async function computeShiftReport(supabase: any, shiftId: string): Promise<ShiftReport | null> {
  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id, company_id, operator_id, opened_at, closed_at, opening_cash, closing_cash, closing_kaspi')
    .eq('id', shiftId)
    .maybeSingle()
  if (!shift) return null
  const companyId = String(shift.company_id)

  const [{ data: rs }, { data: company }, priorRes] = await Promise.all([
    supabase.from('point_receipt_settings')
      .select('tax_payer_name, tax_payer_bin, point_address, kkm_registration_number, ofd_name')
      .eq('company_id', companyId).maybeSingle(),
    supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
    // Порядковый номер смены по точке = сколько смен открыто до этой включительно.
    supabase.from('point_shifts').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).lte('opened_at', shift.opened_at),
  ])
  const shiftNumber = priorRes?.count || 1

  // Кассир (или владелец/администрация, если operator_id пуст)
  let cashier = 'Владелец / администрация'
  if (shift.operator_id) {
    const { data: op } = await supabase.from('staff').select('full_name, short_name').eq('id', shift.operator_id).maybeSingle()
    cashier = (op?.short_name || op?.full_name || 'Оператор') as string
  }

  // Продажи по смене
  const sales = await fetchAllPages((from, to) =>
    supabase.from('point_sales').select('id, cash_amount, kaspi_amount, total_amount').eq('shift_id', shiftId).order('id').range(from, to),
  )
  let cashSales = 0, kaspiSales = 0, total = 0, cashCount = 0, kaspiCount = 0
  const saleIds: string[] = []
  for (const s of sales) {
    saleIds.push(String(s.id))
    cashSales += Number(s.cash_amount || 0)
    kaspiSales += Number(s.kaspi_amount || 0)
    total += Number(s.total_amount || 0)
    if (Number(s.cash_amount || 0) > 0) cashCount++
    if (Number(s.kaspi_amount || 0) > 0) kaspiCount++
  }
  const checkCount = sales.length

  // Возвраты
  const returnsRows = await fetchAllPages((from, to) =>
    supabase.from('point_returns').select('total_amount').eq('shift_id', shiftId).order('id').range(from, to),
  )
  const returns = returnsRows.reduce((a: number, r: any) => a + Number(r.total_amount || 0), 0)

  // Позиции: строки продаж по sale_id → агрегируем по item_id
  const posMap = new Map<string, { sold: number; amount: number }>()
  for (const group of chunkArray(saleIds, 300)) {
    if (!group.length) continue
    const items = await fetchAllPages((from, to) =>
      supabase.from('point_sale_items').select('item_id, quantity, unit_price').in('sale_id', group).order('id').range(from, to),
    )
    for (const it of items) {
      const id = String(it.item_id)
      const m = posMap.get(id) || { sold: 0, amount: 0 }
      m.sold += Number(it.quantity || 0)
      m.amount += Number(it.quantity || 0) * Number(it.unit_price || 0)
      posMap.set(id, m)
    }
  }

  const itemIds = [...posMap.keys()]
  const positions: ShiftReportPosition[] = []
  let goodsTotal = 0
  if (itemIds.length) {
    const nameById = new Map<string, { name: string; unit: string }>()
    for (const group of chunkArray(itemIds, 300)) {
      const { data: invItems } = await supabase.from('inventory_items').select('id, name, unit').in('id', group)
      for (const i of invItems || []) nameById.set(String(i.id), { name: String(i.name || '—'), unit: String(i.unit || '') })
    }
    // Остаток на точке (все локации компании)
    const { data: locs } = await supabase.from('inventory_locations').select('id').eq('company_id', companyId)
    const locIds = (locs || []).map((l: any) => String(l.id))
    const stockByItem = new Map<string, number>()
    if (locIds.length) {
      for (const group of chunkArray(itemIds, 300)) {
        const { data: bals } = await supabase.from('inventory_balances').select('item_id, quantity').in('item_id', group).in('location_id', locIds)
        for (const b of bals || []) stockByItem.set(String(b.item_id), (stockByItem.get(String(b.item_id)) || 0) + Number(b.quantity || 0))
      }
    }
    for (const [id, v] of posMap) {
      const meta = nameById.get(id)
      goodsTotal += v.amount
      positions.push({ name: meta?.name || '—', unit: meta?.unit || '', sold: v.sold, stock: stockByItem.get(id) || 0, amount: v.amount })
    }
    positions.sort((a, b) => b.amount - a.amount)
  }

  return {
    shiftId,
    companyId,
    pointName: String(company?.name || ''),
    shiftNumber,
    cashier,
    openedAt: shift.opened_at || null,
    closedAt: shift.closed_at || null,
    requisites: {
      name: String(rs?.tax_payer_name || ''),
      bin: String(rs?.tax_payer_bin || ''),
      address: String(rs?.point_address || ''),
      kkmReg: String(rs?.kkm_registration_number || ''),
      ofd: String(rs?.ofd_name || ''),
    },
    cashSales, cashCount, kaspiSales, kaspiCount, returns, checkCount, total,
    openingCash: Number(shift.opening_cash || 0),
    closingCash: Number(shift.closing_cash || 0),
    positions,
    goodsTotal,
  }
}
