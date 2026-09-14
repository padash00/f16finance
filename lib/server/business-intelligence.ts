import 'server-only'

// ─────────────────────────────────────────────────────────────────────────────
// Бизнес-аналитика — движок данных для /business-intelligence.
//
// Страница отвечает на вопросы владельца, а не показывает формулы:
//   • что заказать           — restock (тот же расчёт, что «План закупа»)
//   • что лежит без дела      — idleStock (без продаж за период + затоварено)
//   • какие товары главные    — abc (Парето 80/20, как /store/abc)
//   • где выручка странная    — anomalies (по доходам из отчётов, клуб тоже)
//   • кто из клиентов уходит  — rfm
//   • где недостачи           — cashierRisk (по закрытым ревизиям)
//
// eoq / safetyStock / newsvendor / clv / healthScore на веб-странице больше не
// показываются, но остаются в ответе: их читает приложение владельца
// (apple/OrdaKit, BusinessIntelligence). Удалять поля — только вместе с ним.
//
// СКОУП: allowedCompanyIds === null → видно всё (superadmin без орг);
//        [] → ничего (NEVER-pattern); [...] → только эти компании.
// ─────────────────────────────────────────────────────────────────────────────

import {
  aggregateRevisionShortages,
  coverageDays,
  findRevenueOutliers,
  shiftISODate,
  type RevisionActInput,
} from '@/lib/analysis/business-signals'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { fetchAllRows, kzTodayISO } from '@/lib/server/forecast-inputs'
import { computePurchasePlan } from '@/lib/server/purchase-plan'

type AnySupabase = any

const DAY_MS = 86_400_000

// Константы старых формул (для приложения владельца).
const DEFAULT_ORDER_COST = 2000 // S — стоимость одного заказа, ₸
const DEFAULT_HOLDING_RATE = 0.25 // H = rate × закупочная цена, доля/год
const DEFAULT_LEAD = 0.5 // срок поставки, недель
const SERVICE_Z = 1.65 // сервис-уровень 95%
const ANALYSIS_DAYS = 60
/** Норма «обычного дня» строится минимум по 8 неделям, даже если период короче */
const NORM_DAYS = 56
/** Кончится за столько дней или меньше — срочно */
const URGENT_DAYS = 3

const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Выборочное стандартное отклонение (n−1). 0 при n<2. */
function stddev(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1)
  return Math.sqrt(Math.max(0, variance))
}

/** Обратная функция стандартного нормального распределения (Acklam). */
function inverseNormalCDF(p: number): number {
  if (!(p > 0) || !(p < 1)) {
    if (p <= 0) return -Infinity
    return Infinity
  }
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  const pHigh = 1 - pLow
  let q: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p <= pHigh) {
    q = p - 0.5
    const rr = q * q
    return (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1)
  }
  q = Math.sqrt(-2 * Math.log(1 - p))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

// ── Типы результата ──────────────────────────────────────────────────────────

export type AnomalyDay = {
  company: string
  companyId: string
  date: string // YYYY-MM-DD
  revenue: number
  /** Обычная выручка точки в этот день недели */
  expected: number
  /** Отклонение от обычного, доля */
  deviation: number
  z: number
  direction: 'above' | 'below'
}
export type AnomalyPoint = {
  company: string
  companyId: string
  /** Обычный день (медиана за период) */
  typicalDay: number
  mean: number
  stddev: number
  ucl: number
  lcl: number
  daysAnalyzed: number
}
export type AnomalySection = {
  available: boolean
  note?: string
  days: number
  from: string
  to: string
  points: AnomalyPoint[]
  anomalies: AnomalyDay[]
}

export type RestockLine = {
  item_id: string
  name: string
  company: string
  companyId: string
  supplier: string
  stock: number
  weeklyDemand: number
  /** На сколько дней хватит остатка; 0 — уже нет */
  daysLeft: number
  order: number
  amount: number
}
export type RestockSection = {
  available: boolean
  note?: string
  totalAmount: number
  itemsCount: number
  urgentCount: number
  lines: RestockLine[]
}

export type IdleStockLine = {
  item_id: string
  name: string
  stock: number
  value: number
}
export type OverstockLine = {
  item_id: string
  name: string
  company: string
  stock: number
  weeklyDemand: number
  weeksLeft: number
  value: number
}
export type IdleStockSection = {
  available: boolean
  note?: string
  /** Без единой продажи за период */
  noSalesCount: number
  noSalesValue: number
  noSales: IdleStockLine[]
  /** Продаётся, но запаса больше чем на 4 недели */
  overstockValue: number
  overstock: OverstockLine[]
}

export type EoqRow = { item_id: string; name: string; annualDemand: number; eoq: number; stock: number; purchase: number }
export type EoqSection = { available: boolean; note?: string; orderCost: number; holdingRate: number; rows: EoqRow[] }

export type SafetyRow = {
  item_id: string
  name: string
  avgWeeklyDemand: number
  sigmaWeekly: number
  safetyStock: number
  reorderPoint: number
  stock: number
  belowReorder: boolean
}
export type SafetySection = { available: boolean; note?: string; serviceZ: number; leadTimeWeeks: number; rows: SafetyRow[] }

export type NewsvendorRow = { item_id: string; name: string; cu: number; co: number; criticalFractilePct: number; recommendedStock: number; stock: number }
export type NewsvendorSection = { available: boolean; note?: string; rows: NewsvendorRow[] }

export type AbcClassStat = { cls: 'A' | 'B' | 'C'; itemCount: number; itemSharePct: number; revenue: number; revenueSharePct: number }
export type AbcVitalItem = { item_id: string; name: string; revenue: number; cumulativePct: number }
export type AbcSection = { available: boolean; note?: string; totalRevenue: number; totalItems: number; classes: AbcClassStat[]; vital: AbcVitalItem[] }

export type CashierRisk = {
  operatorId: string
  cashier: string
  /** Ревизий с недостачей на позициях сотрудника (для приложения — старое имя) */
  shortfallEvents: number
  /** Ревизий, где сотрудник считал */
  totalEvents: number
  shortageAmount: number
  shortagePositions: number
  positions: number
  lastShortageAt: string | null
  posterior: number
  posteriorPct: number
}
export type BayesSection = {
  available: boolean
  note?: string
  source: 'audit' | 'writeoff' | 'none'
  actsAnalyzed: number
  totalShortage: number
  rows: CashierRisk[]
}

export type RfmCustomer = {
  customer_id: string
  name: string
  recencyDays: number
  frequency: number
  monetary: number
  rScore: number
  fScore: number
  mScore: number
  segment: string
}
export type RfmSegmentStat = { segment: string; count: number; monetary: number }
export type RfmSection = { available: boolean; note?: string; segments: RfmSegmentStat[]; customers: RfmCustomer[]; atRisk: RfmCustomer[] }

export type HealthFactor = { label: string; score0to100: number; note: string }
export type HealthSection = { score: number; factors: HealthFactor[] }

export type ClvRow = { customer_id: string; name: string; clv: number; avgOrder: number; frequency: number }
export type ClvSection = { available: boolean; note?: string; rows: ClvRow[] }

export type BusinessIntelligenceResult = {
  organizationId: string | null
  generatedAt: string
  /** Есть ли у скоупа склад/витрина — без них товарные блоки не считаются */
  hasStore: boolean
  anomalies: AnomalySection
  restock: RestockSection
  idleStock: IdleStockSection
  abc: AbcSection
  cashierRisk: BayesSection
  rfm: RfmSection
  eoq: EoqSection
  safetyStock: SafetySection
  newsvendor: NewsvendorSection
  healthScore: HealthSection
  clv: ClvSection
}

const NO_STORE = 'у точки нет склада — товарный учёт не ведётся'

function emptyResult(organizationId: string | null): BusinessIntelligenceResult {
  const na = <T extends object>(extra: T) => ({ available: false, note: 'нет данных', ...extra })
  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    hasStore: false,
    anomalies: na({ days: ANALYSIS_DAYS, from: '', to: '', points: [], anomalies: [] }),
    restock: na({ totalAmount: 0, itemsCount: 0, urgentCount: 0, lines: [] }),
    idleStock: na({ noSalesCount: 0, noSalesValue: 0, noSales: [], overstockValue: 0, overstock: [] }),
    abc: na({ totalRevenue: 0, totalItems: 0, classes: [], vital: [] }),
    cashierRisk: na({ source: 'none' as const, actsAnalyzed: 0, totalShortage: 0, rows: [] }),
    rfm: na({ segments: [], customers: [], atRisk: [] }),
    eoq: na({ orderCost: DEFAULT_ORDER_COST, holdingRate: DEFAULT_HOLDING_RATE, rows: [] }),
    safetyStock: na({ serviceZ: SERVICE_Z, leadTimeWeeks: DEFAULT_LEAD, rows: [] }),
    newsvendor: na({ rows: [] }),
    healthScore: { score: 0, factors: [] },
    clv: na({ rows: [] }),
  }
}

const weekKey = (iso: string) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return String(Math.floor(t / (7 * DAY_MS)))
}

/**
 * Считает бизнес-аналитику для скоупа. supabase — admin-клиент (обходит RLS).
 */
export async function computeBusinessIntelligence(
  supabase: AnySupabase,
  params: {
    organizationId: string | null
    allowedCompanyIds: string[] | null
    isSuperAdmin?: boolean
    companyId?: string | null
    days?: number | null
    from?: string | null
    to?: string | null
  },
): Promise<BusinessIntelligenceResult> {
  const organizationId = params.organizationId || null
  const allowedCompanyIds = params.allowedCompanyIds

  // ── Окно анализа: свой период (обе даты) или пресет дней ───────────────────
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const fromStr = typeof params.from === 'string' ? params.from.trim() : ''
  const toStr = typeof params.to === 'string' ? params.to.trim() : ''
  const custom = DATE_RE.test(fromStr) && DATE_RE.test(toStr) && fromStr <= toStr
  const today = kzTodayISO()
  // Сегодняшние отчёты смен ещё не внесены — по умолчанию период кончается вчера
  const toDate = custom ? toStr : shiftISODate(today, -1)
  const windowDays = custom
    ? Math.max(1, Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / DAY_MS) + 1)
    : [30, 90, 180, 365].includes(Number(params.days)) ? Number(params.days) : ANALYSIS_DAYS
  const fromDate = custom ? fromStr : shiftISODate(toDate, -(windowDays - 1))
  const since = `${fromDate}T00:00:00+05:00`
  const until = `${toDate}T23:59:59+05:00`

  if (Array.isArray(allowedCompanyIds) && allowedCompanyIds.length === 0) {
    return emptyResult(organizationId)
  }

  let effectiveCompanyIds = allowedCompanyIds
  if (params.companyId) {
    if (allowedCompanyIds && !allowedCompanyIds.includes(params.companyId)) return emptyResult(organizationId)
    effectiveCompanyIds = [params.companyId]
  }

  const now = Date.now()

  // 1. Точки скоупа
  let compQ = supabase.from('companies').select('id, name, code')
  if (effectiveCompanyIds) compQ = compQ.in('id', effectiveCompanyIds)
  else if (organizationId) compQ = compQ.eq('organization_id', organizationId)
  const { data: compRows, error: compErr } = await compQ
  if (compErr) throw compErr
  const companies = ((compRows || []) as Array<{ id: string; name: string | null; code: string | null }>).map((c) => ({
    id: String(c.id),
    name: String(c.name || '—'),
    code: c.code,
  }))
  const companyName = new Map(companies.map((c) => [c.id, c.name]))
  // Как в /reports: точка-экстра не входит в «все точки», только если выбрана явно
  const revenueCompanyIds = params.companyId
    ? companies.map((c) => c.id)
    : companies.filter((c) => !isExtraCompany(c)).map((c) => c.id)
  const scopeCompanyIds = effectiveCompanyIds ?? companies.map((c) => c.id)

  // ── Где выручка странная (доходы из отчётов) ──────────────────────────────
  const anomalies = await computeRevenueAnomalies(supabase, {
    companyIds: revenueCompanyIds,
    companyName,
    fromDate,
    toDate,
    windowDays,
  })

  // ── Клиенты и недостачи — не зависят от склада ────────────────────────────
  const [rfm, cashierRisk] = await Promise.all([
    computeRfm(supabase, { companyIds: scopeCompanyIds, now }),
    computeCashierRisk(supabase, { companyIds: scopeCompanyIds, since, until }),
  ])

  // 2. Склады/витрины скоупа
  let locQ = supabase.from('inventory_locations').select('id, company_id')
  locQ = locQ.in('company_id', scopeCompanyIds.length ? scopeCompanyIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: locRows, error: locErr } = await locQ
  if (locErr) throw locErr
  const locationIds: string[] = []
  const storeCompanyIds = new Set<string>()
  for (const r of (locRows || []) as any[]) {
    locationIds.push(String(r.id))
    if (r.company_id) storeCompanyIds.add(String(r.company_id))
  }

  if (locationIds.length === 0) {
    const empty = emptyResult(organizationId)
    const noStore = <T extends { note?: string }>(section: T): T => ({ ...section, note: NO_STORE })
    return {
      ...empty,
      anomalies,
      rfm,
      cashierRisk,
      restock: noStore(empty.restock),
      idleStock: noStore(empty.idleStock),
      abc: noStore(empty.abc),
      eoq: noStore(empty.eoq),
      safetyStock: noStore(empty.safetyStock),
      newsvendor: noStore(empty.newsvendor),
      healthScore: computeHealthScore({ safety: empty.safetyStock, anomalies, cashierRisk }),
    }
  }

  // 3. Продажи за период
  type SaleRow = { item_id: string; quantity: number; created_at: string; total_amount: number | null }
  type ItemAgg = { soldQty: number; revenue: number; weeklyQty: Map<string, number> }
  const itemAgg = new Map<string, ItemAgg>()
  const sales = await fetchAllRows<SaleRow>(() =>
    supabase
      .from('inventory_movements')
      .select('item_id, quantity, created_at, total_amount')
      .eq('movement_type', 'sale')
      .in('from_location_id', locationIds)
      .gte('created_at', since)
      .lte('created_at', until)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  )
  for (const row of sales) {
    const itemId = String(row.item_id || '')
    const qty = Number(row.quantity || 0)
    if (!itemId || !(qty > 0)) continue
    const agg = itemAgg.get(itemId) || { soldQty: 0, revenue: 0, weeklyQty: new Map<string, number>() }
    agg.soldQty += qty
    agg.revenue += Number(row.total_amount || 0)
    const wk = weekKey(String(row.created_at || ''))
    if (wk) agg.weeklyQty.set(wk, (agg.weeklyQty.get(wk) || 0) + qty)
    itemAgg.set(itemId, agg)
  }

  // 4. Остатки
  const stockByItem = new Map<string, number>()
  const balances = await fetchAllRows<{ item_id: string; quantity: number }>(() =>
    supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .in('location_id', locationIds)
      .order('location_id', { ascending: true })
      .order('item_id', { ascending: true }),
  )
  for (const b of balances) {
    const id = String(b.item_id || '')
    if (id) stockByItem.set(id, (stockByItem.get(id) || 0) + Number(b.quantity || 0))
  }

  const soldIds = Array.from(itemAgg.keys())
  const idleIds = Array.from(stockByItem.entries())
    .filter(([id, qty]) => qty > 0 && !itemAgg.has(id))
    .map(([id]) => id)

  // 5. Карточки товаров (проданные + лежащие без продаж)
  const itemInfo = new Map<string, { name: string; salePrice: number; cost: number; active: boolean }>()
  const infoIds = [...soldIds, ...idleIds]
  for (let i = 0; i < infoIds.length; i += 200) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, sale_price, default_purchase_price, is_active')
      .in('id', infoIds.slice(i, i + 200))
    if (error) throw error
    for (const r of (data || []) as any[]) {
      itemInfo.set(String(r.id), {
        name: String(r.name || '—'),
        salePrice: Number(r.sale_price || 0),
        cost: Number(r.default_purchase_price || 0),
        active: r.is_active !== false,
      })
    }
  }

  // 6. Последняя закупочная цена проданных товаров
  const lastCostByItem = new Map<string, { unitCost: number; receivedAt: string }>()
  for (let i = 0; i < soldIds.length; i += 200) {
    const rows = await fetchAllRows<any>(() =>
      supabase
        .from('inventory_receipt_items')
        .select('id, item_id, unit_cost, receipt:receipt_id(received_at)')
        .in('item_id', soldIds.slice(i, i + 200))
        .order('id', { ascending: true }),
    )
    for (const r of rows) {
      const itemId = String(r.item_id || '')
      const receivedAt = String(r.receipt?.received_at || '')
      const prev = lastCostByItem.get(itemId)
      if (!itemId || (prev && prev.receivedAt >= receivedAt)) continue
      lastCostByItem.set(itemId, { unitCost: Number(r.unit_cost || 0), receivedAt })
    }
  }
  const purchaseOf = (itemId: string) => {
    const c = lastCostByItem.get(itemId)
    if (c && c.unitCost > 0) return c.unitCost
    return itemInfo.get(itemId)?.cost || 0
  }

  // ── Что заказать: план закупа по каждой точке со складом ──────────────────
  const plans = await Promise.all(
    Array.from(storeCompanyIds).map(async (cid) => ({ cid, plan: await computePurchasePlan(supabase, cid) })),
  )
  const restockLines: RestockLine[] = []
  const overstock: OverstockLine[] = []
  for (const { cid, plan } of plans) {
    for (const group of plan.bySupplier) {
      for (const line of group.items) {
        restockLines.push({
          item_id: line.item_id,
          name: line.name,
          company: companyName.get(cid) || '—',
          companyId: cid,
          supplier: group.supplier,
          stock: line.stock,
          weeklyDemand: line.weeklyDemand,
          daysLeft: coverageDays(line.coverageWeeks, line.stock),
          order: line.order,
          amount: line.amount,
        })
      }
    }
    for (const skip of plan.doNotBuy) {
      overstock.push({
        item_id: skip.item_id,
        name: skip.name,
        company: companyName.get(cid) || '—',
        stock: skip.stock,
        weeklyDemand: skip.weeklyDemand,
        weeksLeft: skip.coverageWeeks,
        value: 0,
      })
    }
  }
  restockLines.sort((a, b) => a.daysLeft - b.daysLeft || b.amount - a.amount)

  // Стоимость затоваренного — по закупочной цене карточки
  const missingCost = overstock.map((o) => o.item_id).filter((id) => !itemInfo.has(id))
  for (let i = 0; i < missingCost.length; i += 200) {
    const { data } = await supabase.from('inventory_items').select('id, name, sale_price, default_purchase_price, is_active').in('id', missingCost.slice(i, i + 200))
    for (const r of (data || []) as any[]) {
      itemInfo.set(String(r.id), { name: String(r.name || '—'), salePrice: Number(r.sale_price || 0), cost: Number(r.default_purchase_price || 0), active: r.is_active !== false })
    }
  }
  for (const o of overstock) o.value = r0(o.stock * (purchaseOf(o.item_id) || itemInfo.get(o.item_id)?.cost || 0))
  overstock.sort((a, b) => b.value - a.value)

  const restock: RestockSection = {
    available: storeCompanyIds.size > 0,
    note: restockLines.length ? undefined : 'всего хватает на 2 недели вперёд',
    totalAmount: r0(restockLines.reduce((s, l) => s + l.amount, 0)),
    itemsCount: restockLines.length,
    urgentCount: restockLines.filter((l) => l.daysLeft <= URGENT_DAYS).length,
    lines: restockLines.slice(0, 40),
  }

  // ── Что лежит без дела ─────────────────────────────────────────────────────
  // Архивные товары не считаем: их уже решили не продавать
  const noSales: IdleStockLine[] = idleIds
    .filter((id) => itemInfo.get(id)?.active ?? true)
    .map((id) => {
      const info = itemInfo.get(id)
      const stock = stockByItem.get(id) || 0
      return { item_id: id, name: info?.name || '—', stock: r2(stock), value: r0(stock * (info?.cost || 0)) }
    })
    .sort((a, b) => b.value - a.value)
  const idleStock: IdleStockSection = {
    available: true,
    noSalesCount: noSales.length,
    noSalesValue: r0(noSales.reduce((s, r) => s + r.value, 0)),
    noSales: noSales.slice(0, 30),
    overstockValue: r0(overstock.reduce((s, r) => s + r.value, 0)),
    overstock: overstock.slice(0, 30),
  }

  // ── Метрики по товару (для ABC и старых формул приложения) ─────────────────
  const weeks = Math.max(1, Math.round(windowDays / 7))
  const metrics = soldIds.map((itemId) => {
    const agg = itemAgg.get(itemId)!
    const info = itemInfo.get(itemId)
    const weeklyValues = Array.from(agg.weeklyQty.keys()).sort().map((k) => agg.weeklyQty.get(k) || 0)
    while (weeklyValues.length < weeks) weeklyValues.push(0)
    return {
      item_id: itemId,
      name: info?.name || '—',
      revenue: agg.revenue,
      annualDemand: agg.soldQty * (365 / windowDays),
      purchase: purchaseOf(itemId),
      salePrice: info?.salePrice || 0,
      stock: stockByItem.get(itemId) || 0,
      weeklyValues,
    }
  })
  const byRevenue = [...metrics].sort((a, b) => b.revenue - a.revenue)

  // ── Какие товары главные (ABC) ─────────────────────────────────────────────
  const abcSorted = byRevenue.filter((m) => m.revenue > 0)
  const totalRevenue = abcSorted.reduce((s, m) => s + m.revenue, 0)
  const vital: AbcVitalItem[] = []
  const counts = { A: 0, B: 0, C: 0 }
  const rev = { A: 0, B: 0, C: 0 }
  let cum = 0
  for (const m of abcSorted) {
    cum += m.revenue
    const cumPct = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 100
    const cls: 'A' | 'B' | 'C' = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'
    counts[cls] += 1
    rev[cls] += m.revenue
    if (cls === 'A') vital.push({ item_id: m.item_id, name: m.name, revenue: r0(m.revenue), cumulativePct: r1(cumPct) })
  }
  const totalItems = abcSorted.length
  const abc: AbcSection = {
    available: totalItems > 0,
    note: totalItems > 0 ? undefined : 'за период не было продаж',
    totalRevenue: r0(totalRevenue),
    totalItems,
    classes: (['A', 'B', 'C'] as const).map((cls) => ({
      cls,
      itemCount: counts[cls],
      itemSharePct: totalItems > 0 ? r1((counts[cls] / totalItems) * 100) : 0,
      revenue: r0(rev[cls]),
      revenueSharePct: totalRevenue > 0 ? r1((rev[cls] / totalRevenue) * 100) : 0,
    })),
    vital: vital.slice(0, 30),
  }

  // ── Старые формулы (только для приложения владельца) ──────────────────────
  const top = byRevenue.slice(0, 20)
  const eoqRows: EoqRow[] = top.map((m) => {
    const H = DEFAULT_HOLDING_RATE * m.purchase
    const eoq = m.annualDemand > 0 && H > 0 ? Math.sqrt((2 * m.annualDemand * DEFAULT_ORDER_COST) / H) : 0
    return { item_id: m.item_id, name: m.name, annualDemand: r0(m.annualDemand), eoq: r0(eoq), stock: r2(m.stock), purchase: r2(m.purchase) }
  })
  const eoq: EoqSection = {
    available: eoqRows.some((r) => r.eoq > 0),
    note: eoqRows.some((r) => r.eoq > 0) ? undefined : 'нужны закупочные цены и продажи',
    orderCost: DEFAULT_ORDER_COST,
    holdingRate: DEFAULT_HOLDING_RATE,
    rows: eoqRows,
  }
  const safetyRows: SafetyRow[] = top.map((m) => {
    const avgWeekly = mean(m.weeklyValues)
    const sigmaWeekly = stddev(m.weeklyValues)
    const ss = SERVICE_Z * sigmaWeekly * Math.sqrt(DEFAULT_LEAD)
    const rop = avgWeekly * DEFAULT_LEAD + ss
    return {
      item_id: m.item_id,
      name: m.name,
      avgWeeklyDemand: r2(avgWeekly),
      sigmaWeekly: r2(sigmaWeekly),
      safetyStock: Math.ceil(ss),
      reorderPoint: Math.ceil(rop),
      stock: r2(m.stock),
      belowReorder: m.stock < rop,
    }
  })
  const safetyStock: SafetySection = {
    available: safetyRows.length > 0,
    note: safetyRows.length > 0 ? undefined : 'нужны продажи за период',
    serviceZ: SERVICE_Z,
    leadTimeWeeks: DEFAULT_LEAD,
    rows: safetyRows,
  }
  const newsvendorRows: NewsvendorRow[] = []
  for (const m of top) {
    const cu = m.salePrice - m.purchase
    const co = m.purchase
    if (!(cu > 0) || !(co > 0)) continue
    const cf = cu / (cu + co)
    const zcf = inverseNormalCDF(cf)
    const qStar = Math.max(0, mean(m.weeklyValues) + (Number.isFinite(zcf) ? zcf : 0) * stddev(m.weeklyValues))
    newsvendorRows.push({ item_id: m.item_id, name: m.name, cu: r2(cu), co: r2(co), criticalFractilePct: r1(cf * 100), recommendedStock: Math.ceil(qStar), stock: r2(m.stock) })
  }
  const newsvendor: NewsvendorSection = {
    available: newsvendorRows.length > 0,
    note: newsvendorRows.length > 0 ? 'Срока годности в каталоге нет — расчёт по всем ходовым товарам с маржой' : 'нужны товары с маржой и продажами',
    rows: newsvendorRows,
  }

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    hasStore: true,
    anomalies,
    restock,
    idleStock,
    abc,
    cashierRisk,
    rfm,
    eoq,
    safetyStock,
    newsvendor,
    healthScore: computeHealthScore({ safety: safetyStock, anomalies, cashierRisk }),
    clv: computeClv(rfm),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Где выручка странная — по доходам из отчётов смен (клуб и магазин).
// Безнал ночной смены после полуночи — на следующий день, как в /reports.
// ─────────────────────────────────────────────────────────────────────────────
async function computeRevenueAnomalies(
  supabase: AnySupabase,
  params: { companyIds: string[]; companyName: Map<string, string>; fromDate: string; toDate: string; windowDays: number },
): Promise<AnomalySection> {
  const { companyIds, companyName, fromDate, toDate, windowDays } = params
  const base = { days: windowDays, from: fromDate, to: toDate }
  if (companyIds.length === 0) return { available: false, note: 'нет точек', ...base, points: [], anomalies: [] }

  // Норме нужна история: минимум 8 недель, даже если смотрим месяц
  const normFrom = shiftISODate(toDate, -(Math.max(windowDays, NORM_DAYS) - 1))
  const loadFrom = normFrom < fromDate ? normFrom : fromDate
  const rows = await fetchAllRows<ReportIncomeCalendarRow>(() =>
    supabase
      .from('incomes')
      .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount')
      .in('company_id', companyIds)
      .gte('date', loadFrom)
      .lte('date', toDate)
      .order('date', { ascending: true })
      .order('id', { ascending: true }),
  )

  const byCompany = new Map<string, Map<string, number>>()
  for (const r of splitIncomeKaspiByCalendarDay(rows) as any[]) {
    const date = String(r.date).slice(0, 10)
    if (date < loadFrom || date > toDate) continue
    const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    const cid = String(r.company_id)
    const days = byCompany.get(cid) || new Map<string, number>()
    days.set(date, (days.get(date) || 0) + total)
    byCompany.set(cid, days)
  }

  const points: AnomalyPoint[] = []
  const anomalies: AnomalyDay[] = []
  for (const [cid, dayMap] of byCompany) {
    const days = Array.from(dayMap.entries()).map(([date, revenue]) => ({ date, revenue }))
    const result = findRevenueOutliers(days, { from: fromDate })
    if (result.daysAnalyzed === 0) continue
    const inWindow = days.filter((d) => d.date >= fromDate && d.revenue > 0).map((d) => d.revenue)
    const mu = mean(inWindow)
    const sigma = stddev(inWindow)
    const name = companyName.get(cid) || '—'
    points.push({
      company: name,
      companyId: cid,
      typicalDay: result.typicalDay,
      mean: r0(mu),
      stddev: r0(sigma),
      ucl: r0(mu + 3 * sigma),
      lcl: r0(mu - 3 * sigma),
      daysAnalyzed: result.daysAnalyzed,
    })
    for (const o of result.outliers) anomalies.push({ company: name, companyId: cid, ...o })
  }
  anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  points.sort((a, b) => b.typicalDay - a.typicalDay)

  return {
    available: points.length > 0,
    note: points.length > 0 ? undefined : 'за период нет доходов в отчётах',
    ...base,
    points,
    anomalies: anomalies.slice(0, 40),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Оценка здоровья — только для приложения владельца. Фактор без данных не
// добавляется: раньше «Контроль» без ревизий получал 100 и приукрашивал итог.
// ─────────────────────────────────────────────────────────────────────────────
function computeHealthScore(input: { safety: SafetySection; anomalies: AnomalySection; cashierRisk: BayesSection }): HealthSection {
  const factors: HealthFactor[] = []

  const safetyRows = input.safety.rows || []
  if (input.safety.available && safetyRows.length > 0) {
    const below = safetyRows.filter((r) => r.belowReorder).length
    factors.push({
      label: 'Наличие',
      score0to100: r0(100 * (1 - below / safetyRows.length)),
      note: `${safetyRows.length - below} из ${safetyRows.length} топ-товаров выше точки дозаказа${below > 0 ? `, ${below} нужно заказать` : ''}`,
    })
  }

  if (input.anomalies.available) {
    const n = input.anomalies.anomalies.length
    factors.push({
      label: 'Стабильность',
      score0to100: r0(100 - Math.min(100, n * 10)),
      note: n === 0 ? 'странных дней выручки нет' : `${n} странных ${n === 1 ? 'день' : 'дней'} в выручке`,
    })
  }

  if (input.cashierRisk.available && input.cashierRisk.rows.length > 0) {
    const maxPct = Math.max(...input.cashierRisk.rows.map((r) => r.posteriorPct))
    const worst = input.cashierRisk.rows.find((r) => r.posteriorPct === maxPct)
    factors.push({
      label: 'Контроль',
      score0to100: r0(Math.max(0, 100 - maxPct)),
      note: worst ? `чаще всего недостачи у: ${worst.cashier} (${maxPct}%)` : `риск недостач ${maxPct}%`,
    })
  }

  const score = factors.length > 0 ? r0(mean(factors.map((f) => f.score0to100))) : 0
  return { score, factors }
}

// CLV — только для приложения владельца.
function computeClv(rfm: RfmSection): ClvSection {
  if (!rfm.available || rfm.customers.length === 0) {
    return { available: false, note: 'нужны данные о клиентах и покупках', rows: [] }
  }
  const rows: ClvRow[] = rfm.customers.map((c) => {
    const frequency = Math.max(0, c.frequency)
    const avgOrder = c.monetary / Math.max(1, frequency)
    return { customer_id: c.customer_id, name: c.name, clv: r0(avgOrder * frequency * 2), avgOrder: r0(avgOrder), frequency }
  })
  rows.sort((a, b) => b.clv - a.clv)
  return { available: true, rows: rows.slice(0, 10) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Недостачи по закрытым ревизиям за период (см. lib/analysis/business-signals).
// Раньше при отсутствии ревизий бралась «замена» по списаниям, где каждому
// сотруднику в знаменатель ставились списания всех — проценты выходили
// одинаковыми и ничего не значили. Замену убрали: нет ревизий — нет оценки.
// ─────────────────────────────────────────────────────────────────────────────
async function computeCashierRisk(
  supabase: AnySupabase,
  params: { companyIds: string[]; since: string; until: string },
): Promise<BayesSection> {
  const empty = (note: string): BayesSection => ({ available: false, note, source: 'none', actsAnalyzed: 0, totalShortage: 0, rows: [] })
  if (params.companyIds.length === 0) return empty('нет точек')

  const { data: actRows, error: actsError } = await supabase
    .from('inventory_audit_acts')
    .select('id, location_id, opened_at, closed_at')
    .eq('status', 'closed')
    .in('company_id', params.companyIds)
    .gte('closed_at', params.since)
    .lte('closed_at', params.until)
    .order('closed_at', { ascending: false })
    .limit(60)
  if (actsError) throw actsError
  const acts = (actRows || []) as Array<{ id: string; location_id: string; opened_at: string; closed_at: string | null }>
  if (acts.length === 0) return empty('за период не было закрытых ревизий')

  const inputs: RevisionActInput[] = []
  const allItemIds = new Set<string>()
  for (const act of acts) {
    const [snapshot, counts, moves] = await Promise.all([
      fetchAllRows<any>(() =>
        supabase.from('inventory_audit_snapshot').select('item_id, expected_qty').eq('act_id', act.id).order('item_id', { ascending: true }),
      ),
      fetchAllRows<any>(() =>
        supabase.from('inventory_audit_counts').select('id, item_id, counted_qty, counted_by, counted_at').eq('act_id', act.id).order('id', { ascending: true }),
      ),
      fetchAllRows<any>(() => {
        let q = supabase
          .from('inventory_movements')
          .select('id, item_id, quantity, from_location_id, to_location_id, created_at')
          .or(`from_location_id.eq.${act.location_id},to_location_id.eq.${act.location_id}`)
          .gte('created_at', act.opened_at)
        if (act.closed_at) q = q.lte('created_at', act.closed_at)
        return q.order('created_at', { ascending: true }).order('id', { ascending: true })
      }),
    ])
    const loc = String(act.location_id)
    inputs.push({
      actId: String(act.id),
      closedAt: act.closed_at,
      expected: new Map(snapshot.map((s) => [String(s.item_id), Number(s.expected_qty || 0)])),
      counts: counts.map((c) => ({
        itemId: String(c.item_id),
        counted: Number(c.counted_qty || 0),
        by: c.counted_by ? String(c.counted_by) : null,
        at: String(c.counted_at || ''),
      })),
      moves: moves.map((m) => {
        const qty = Number(m.quantity || 0)
        const delta = (String(m.to_location_id) === loc ? qty : 0) - (String(m.from_location_id) === loc ? qty : 0)
        return { itemId: String(m.item_id), delta, at: String(m.created_at || '') }
      }),
      unitCost: new Map(),
    })
    for (const c of counts) allItemIds.add(String(c.item_id))
  }

  // Недостача в деньгах — по закупочной цене карточки, как долг при закрытии акта
  const costByItem = new Map<string, number>()
  const itemIds = Array.from(allItemIds)
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabase.from('inventory_items').select('id, default_purchase_price').in('id', itemIds.slice(i, i + 200))
    for (const r of (data || []) as any[]) costByItem.set(String(r.id), Number(r.default_purchase_price || 0))
  }
  for (const input of inputs) input.unitCost = costByItem

  const aggregated = aggregateRevisionShortages(inputs)
  if (aggregated.length === 0) return empty('в ревизиях за период не указано, кто считал')

  const opIds = aggregated.map((r) => r.operatorId)
  const opName = new Map<string, string>()
  for (let i = 0; i < opIds.length; i += 200) {
    const { data } = await supabase.from('operators').select('id, name, short_name').in('id', opIds.slice(i, i + 200))
    for (const o of (data || []) as any[]) opName.set(String(o.id), String(o.name || o.short_name || 'Сотрудник'))
  }

  const rows: CashierRisk[] = aggregated.map((r) => ({
    operatorId: r.operatorId,
    cashier: opName.get(r.operatorId) || 'Сотрудник',
    shortfallEvents: r.actsWithShortage,
    totalEvents: r.acts,
    shortageAmount: r.shortageAmount,
    shortagePositions: r.shortagePositions,
    positions: r.positions,
    lastShortageAt: r.lastShortageAt,
    posterior: r2(r.posterior),
    posteriorPct: r1(r.posterior * 100),
  }))

  return {
    available: true,
    source: 'audit',
    actsAnalyzed: acts.length,
    totalShortage: rows.reduce((s, r) => s + r.shortageAmount, 0),
    rows: rows.slice(0, 30),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Клиенты: давность последней покупки, число визитов, сумма покупок.
// Баллы 1–5 по месту среди клиентов точки; сегмент по сумме баллов.
// ─────────────────────────────────────────────────────────────────────────────
async function computeRfm(supabase: AnySupabase, params: { companyIds: string[]; now: number }): Promise<RfmSection> {
  const { companyIds, now } = params
  const empty = (note: string): RfmSection => ({ available: false, note, segments: [], customers: [], atRisk: [] })
  if (companyIds.length === 0) return empty('нет точек')

  const custRows = await fetchAllRows<any>(() =>
    supabase
      .from('customers')
      .select('id, name, total_spent, visits_count')
      .eq('is_active', true)
      .in('company_id', companyIds)
      .order('id', { ascending: true }),
  )
  if (custRows.length === 0) return empty('клиентской базы нет — клиентов добавляют на кассе или в разделе «Клиенты»')

  type Cust = { id: string; name: string; monetary: number; frequency: number; lastPurchase: number | null }
  const customers: Cust[] = custRows.map((c) => ({
    id: String(c.id),
    name: String(c.name || 'Клиент'),
    monetary: Number(c.total_spent || 0),
    frequency: Number(c.visits_count || 0),
    lastPurchase: null,
  }))
  const byId = new Map(customers.map((c) => [c.id, c]))

  const custIds = customers.map((c) => c.id)
  for (let i = 0; i < custIds.length; i += 200) {
    const sales = await fetchAllRows<any>(() =>
      supabase
        .from('point_sales')
        .select('id, customer_id, created_at')
        .in('customer_id', custIds.slice(i, i + 200))
        .in('company_id', companyIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
    )
    for (const r of sales) {
      const c = byId.get(String(r.customer_id || ''))
      const t = Date.parse(String(r.created_at || ''))
      if (c && Number.isFinite(t) && (c.lastPurchase === null || t > c.lastPurchase)) c.lastPurchase = t
    }
  }

  const active = customers.filter((c) => c.frequency > 0 || c.lastPurchase !== null || c.monetary > 0)
  if (active.length === 0) return empty('у клиентов ещё нет покупок')

  const recencyDaysOf = (c: Cust) => (c.lastPurchase !== null ? Math.max(0, (now - c.lastPurchase) / DAY_MS) : 9999)
  const quintileScore = (value: number, sortedAsc: number[], higherIsBetter: boolean): number => {
    if (sortedAsc.length === 0) return 3
    let rank = 0
    for (const v of sortedAsc) {
      if (v <= value) rank++
      else break
    }
    let score = Math.min(5, Math.max(1, Math.ceil((rank / sortedAsc.length) * 5)))
    if (!higherIsBetter) score = 6 - score
    return score
  }
  const recencyArr = active.map(recencyDaysOf).sort((a, b) => a - b)
  const freqArr = active.map((c) => c.frequency).sort((a, b) => a - b)
  const monArr = active.map((c) => c.monetary).sort((a, b) => a - b)

  const segmentOf = (r: number, f: number, m: number): string => {
    const fm = (f + m) / 2
    if (r >= 4 && fm >= 4) return 'Чемпионы'
    if (r >= 3 && fm >= 3) return 'Лояльные'
    if (r >= 4 && fm < 3) return 'Новички'
    if (r <= 2 && fm >= 3) return 'В зоне риска'
    if (r <= 2 && fm <= 2) return 'Потеряны'
    return 'Обычные'
  }

  const result: RfmCustomer[] = active.map((c) => {
    const rDays = recencyDaysOf(c)
    const rScore = quintileScore(rDays, recencyArr, false)
    const fScore = quintileScore(c.frequency, freqArr, true)
    const mScore = quintileScore(c.monetary, monArr, true)
    return {
      customer_id: c.id,
      name: c.name,
      recencyDays: rDays >= 9999 ? 9999 : r0(rDays),
      frequency: c.frequency,
      monetary: r0(c.monetary),
      rScore,
      fScore,
      mScore,
      segment: segmentOf(rScore, fScore, mScore),
    }
  })

  const segMap = new Map<string, { count: number; monetary: number }>()
  for (const c of result) {
    const s = segMap.get(c.segment) || { count: 0, monetary: 0 }
    s.count += 1
    s.monetary += c.monetary
    segMap.set(c.segment, s)
  }
  const segments = Array.from(segMap.entries())
    .map(([segment, v]) => ({ segment, count: v.count, monetary: r0(v.monetary) }))
    .sort((a, b) => b.monetary - a.monetary)

  result.sort((a, b) => b.monetary - a.monetary)

  return {
    available: true,
    segments,
    customers: result.slice(0, 50),
    // Уходят: раньше приходили часто и много, а сейчас давно не были
    atRisk: result.filter((c) => c.segment === 'В зоне риска').slice(0, 30),
  }
}
