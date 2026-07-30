import 'server-only'

import { buildTenantUrl } from '@/lib/core/tenant-domain'
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
  debts: Array<{ debtor: string; item: string; quantity: number; amount: number }>
  debtsTotal: number
  /** Публичная страница онлайн-чека на поддомене организации: https://<slug>.ordaops.kz/z/<shiftId> */
  onlineUrl: string
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
    supabase.from('companies').select('name, organization_id').eq('id', companyId).maybeSingle(),
    // Порядковый номер смены по точке = сколько смен открыто до этой включительно.
    supabase.from('point_shifts').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).lte('opened_at', shift.opened_at),
  ])
  const shiftNumber = priorRes?.count || 1

  // Онлайн-чек на поддомене организации (Вариант B: у каждого клиента свой поддомен).
  let orgSlug = ''
  const orgIdForUrl = (company as any)?.organization_id || null
  if (orgIdForUrl) {
    const { data: orgRow } = await supabase.from('organizations').select('slug').eq('id', orgIdForUrl).maybeSingle()
    orgSlug = String((orgRow as any)?.slug || '')
  }
  const onlineUrl = `${buildTenantUrl(orgSlug)}/z/${shiftId}`

  // Продажи по смене
  const sales = await fetchAllPages((from, to) =>
    supabase.from('point_sales').select('id, cash_amount, kaspi_amount, total_amount, operator_id').eq('shift_id', shiftId).order('id').range(from, to),
  )
  let cashSales = 0, kaspiSales = 0, total = 0, cashCount = 0, kaspiCount = 0
  const saleIds: string[] = []
  const opCount = new Map<string, number>()
  for (const s of sales) {
    saleIds.push(String(s.id))
    cashSales += Number(s.cash_amount || 0)
    kaspiSales += Number(s.kaspi_amount || 0)
    total += Number(s.total_amount || 0)
    if (Number(s.cash_amount || 0) > 0) cashCount++
    if (Number(s.kaspi_amount || 0) > 0) kaspiCount++
    if (s.operator_id) opCount.set(String(s.operator_id), (opCount.get(String(s.operator_id)) || 0) + 1)
  }
  const checkCount = sales.length

  // Кассир: тот, кто вёл смену. operator_id ссылается на operators (НЕ staff).
  // Порядок: operators по operator_id смены → аудит открытия смены → самый
  // частый оператор продаж → staff → «Владелец / администрация».
  let cashier = 'Владелец / администрация'
  let opId: string | null = shift.operator_id ? String(shift.operator_id) : null
  if (!opId) {
    const { data: openLog } = await supabase.from('audit_log').select('payload').eq('action', 'point_shift.open').eq('entity_id', shiftId).limit(1).maybeSingle()
    const logOp = (openLog as any)?.payload?.operator_id
    if (logOp) opId = String(logOp)
  }
  if (!opId && opCount.size) {
    opId = [...opCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  if (opId) {
    const { data: op } = await supabase.from('operators').select('name, short_name').eq('id', opId).maybeSingle()
    if (op) cashier = String((op as any).short_name || (op as any).name || 'Оператор')
    else {
      const { data: st } = await supabase.from('staff').select('full_name, short_name').eq('id', opId).maybeSingle()
      if (st) cashier = String((st as any).short_name || (st as any).full_name || 'Оператор')
    }
  }

  // Возвраты
  const returnsRows = await fetchAllPages((from, to) =>
    supabase.from('point_returns').select('total_amount').eq('shift_id', shiftId).order('id').range(from, to),
  )
  const returns = returnsRows.reduce((a: number, r: any) => a + Number(r.total_amount || 0), 0)

  // Позиции: строки продаж по sale_id. Ключ — item_id (реальный товар) или
  // u:universal_name (свободная строка). ВАЖНО: null item_id нельзя пихать в
  // .in('id', …) — Postgres падает на невалидном uuid и обнуляет весь запрос имён.
  const posMap = new Map<string, { sold: number; amount: number; itemId: string | null; uniName: string | null }>()
  for (const group of chunkArray(saleIds, 300)) {
    if (!group.length) continue
    const items = await fetchAllPages((from, to) =>
      supabase.from('point_sale_items').select('item_id, quantity, unit_price, universal_name').in('sale_id', group).order('id').range(from, to),
    )
    for (const it of items) {
      const itemId = it.item_id ? String(it.item_id) : null
      const uni = it.universal_name ? String(it.universal_name) : null
      const key = itemId || (uni ? `u:${uni}` : 'u:—')
      const m = posMap.get(key) || { sold: 0, amount: 0, itemId, uniName: uni }
      m.sold += Number(it.quantity || 0)
      m.amount += Number(it.quantity || 0) * Number(it.unit_price || 0)
      posMap.set(key, m)
    }
  }

  const realItemIds = [...posMap.values()].map((v) => v.itemId).filter((x): x is string => !!x)
  const positions: ShiftReportPosition[] = []
  let goodsTotal = 0
  const nameById = new Map<string, { name: string; unit: string }>()
  const stockByItem = new Map<string, number>()
  if (realItemIds.length) {
    for (const group of chunkArray(realItemIds, 300)) {
      const { data: invItems } = await supabase.from('inventory_items').select('id, name, unit').in('id', group)
      for (const i of invItems || []) nameById.set(String(i.id), { name: String(i.name || '—'), unit: String(i.unit || '') })
    }
    const { data: locs } = await supabase.from('inventory_locations').select('id').eq('company_id', companyId)
    const locIds = (locs || []).map((l: any) => String(l.id))
    if (locIds.length) {
      for (const group of chunkArray(realItemIds, 300)) {
        const { data: bals } = await supabase.from('inventory_balances').select('item_id, quantity').in('item_id', group).in('location_id', locIds)
        for (const b of bals || []) stockByItem.set(String(b.item_id), (stockByItem.get(String(b.item_id)) || 0) + Number(b.quantity || 0))
      }
    }
  }
  for (const v of posMap.values()) {
    const meta = v.itemId ? nameById.get(v.itemId) : null
    goodsTotal += v.amount
    positions.push({
      name: meta?.name || v.uniName || '—',
      unit: meta?.unit || '',
      sold: v.sold,
      stock: v.itemId ? (stockByItem.get(v.itemId) || 0) : 0,
      amount: v.amount,
    })
  }
  positions.sort((a, b) => b.amount - a.amount)

  // Долги за смену (взято в долг, отдельно от выручки). Окно смены по created_at
  // (ловит и старые долги без shift_id, и новые). status='active'.
  const openedAt = shift.opened_at || new Date(0).toISOString()
  const closedAt = shift.closed_at || new Date().toISOString()
  const debtRows = await fetchAllPages((from, to) =>
    supabase.from('point_debt_items')
      .select('client_name, item_name, quantity, total_amount, operator_id')
      .eq('company_id', companyId).eq('status', 'active')
      .gte('created_at', openedAt).lte('created_at', closedAt)
      .order('created_at').range(from, to),
  )
  const debtOpIds = Array.from(new Set(debtRows.map((d: any) => d.operator_id).filter(Boolean))) as string[]
  const debtOpName = new Map<string, string>()
  if (debtOpIds.length) {
    const { data: ops } = await supabase.from('operators').select('id, name, short_name').in('id', debtOpIds)
    for (const o of ops || []) debtOpName.set(String(o.id), String((o as any).short_name || (o as any).name || ''))
  }
  const debts = debtRows.map((d: any) => ({
    debtor: (d.operator_id ? debtOpName.get(String(d.operator_id)) : '') || String(d.client_name || 'Должник'),
    item: String(d.item_name || '—'),
    quantity: Number(d.quantity || 0),
    amount: Number(d.total_amount || 0),
  }))
  const debtsTotal = debts.reduce((a, d) => a + d.amount, 0)

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
    debts,
    debtsTotal,
    onlineUrl,
  }
}
