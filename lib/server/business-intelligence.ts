import 'server-only'

// ─────────────────────────────────────────────────────────────────────────────
// Бизнес-аналитика — движок данных.
//
// Применяет настоящие операционные/статистические формулы (как Amazon, Walmart,
// Six Sigma) к данным клуба. Каждая секция (A–G) возвращает { available, ... }.
// Источники и скоуп — как в lib/server/store-insights.ts / purchase-plan.ts.
//
// СКОУП: allowedCompanyIds === null → видно всё (superadmin без орг);
//        [] → ничего (NEVER-pattern); [...] → только эти компании.
//
// ФОРМУЛЫ (это суть фичи — реализованы строго):
//   A. Z-score / контрольные карты (Six Sigma):
//        μ = среднее дневной выручки точки за 60 дней
//        σ = выборочное стд.откл (n−1)
//        z = (x − μ) / σ ; аномалия при |z| > 2
//        UCL = μ + 3σ ; LCL = μ − 3σ
//   B. EOQ (формула Уилсона):
//        D = годовой спрос = soldQty × (365 / days)
//        S = DEFAULT_ORDER_COST = 2000 ₸ (стоимость одного заказа)
//        H = DEFAULT_HOLDING_RATE (0.25) × закупочная цена (хранение ед./год)
//        EOQ = √(2·D·S / H)
//   C. Страховой запас + точка дозаказа:
//        σ_d = стд.откл недельного спроса
//        Z = 1.65 (сервис 95%) ; leadTimeWeeks = DEFAULT_LEAD = 0.5
//        SS  = Z · σ_d · √leadTime
//        ROP = avgWeeklyDemand · leadTime + SS
//   D. Newsvendor (critical fractile):
//        Cu = маржа = sale − purchase (недозаказ) ; Co = purchase (списание)
//        CF = Cu / (Cu + Co)
//        Q* = μ + z(CF) · σ  (z(CF) — обратная нормальная, аппроксимация)
//   E. ABC-анализ (Парето 80/20):
//        товары по выручке убыв., накопит.% ; A≤80%, B≤95%, C — остальное
//   F. Байес-риск недостач по кассирам (Beta(α=1,β=4)):
//        posterior = (1 + shortfalls) / (1 + 4 + total)
//        источник: закрытые аудит-акты (snapshot vs counts по counted_by)
//   G. RFM (квинтили 1–5):
//        R = дней с последней покупки ; F = visits ; M = total_spent
//        сегмент по сумме R/F/M-баллов
// ─────────────────────────────────────────────────────────────────────────────

type AnySupabase = any

const DAY_MS = 86_400_000
const PAGE = 1000

// Константы формул (документированы выше).
const DEFAULT_ORDER_COST = 2000 // S — стоимость одного заказа, ₸
const DEFAULT_HOLDING_RATE = 0.25 // H = rate × закупочная цена, доля/год
const DEFAULT_LEAD = 0.5 // leadTimeWeeks — срок поставки, недель
const SERVICE_Z = 1.65 // Z для сервис-уровня 95%
const ANALYSIS_DAYS = 60 // окно для аномалий/спроса
const BETA_ALPHA = 1
const BETA_BETA = 4

const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Среднее массива (0 для пустого). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Выборочное стандартное отклонение (n−1). 0 при n<2 (защита деления). */
function stddev(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1)
  return Math.sqrt(Math.max(0, variance))
}

/**
 * Обратная функция стандартного нормального распределения (z по вероятности p).
 * Аппроксимация Бейсли–Спрингера / Морро — точность ~1e-9 на (0,1).
 * Защита: p вне (0,1) клампится; p=0.5 → 0.
 */
function inverseNormalCDF(p: number): number {
  if (!(p > 0) || !(p < 1)) {
    if (p <= 0) return -Infinity
    return Infinity
  }
  // Коэффициенты Acklam.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  const pHigh = 1 - pLow
  let q: number
  let x: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= pHigh) {
    q = p - 0.5
    const rr = q * q
    x = (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  return x
}

// ── Типы результата ──────────────────────────────────────────────────────────

export type AnomalyDay = {
  company: string
  date: string // YYYY-MM-DD
  revenue: number
  z: number
  direction: 'above' | 'below'
}
export type AnomalyPoint = {
  company: string
  mean: number
  stddev: number
  ucl: number // μ + 3σ
  lcl: number // μ − 3σ
  daysAnalyzed: number
}
export type AnomalySection = {
  available: boolean
  note?: string
  days: number
  points: AnomalyPoint[]
  anomalies: AnomalyDay[]
}

export type EoqRow = {
  item_id: string
  name: string
  annualDemand: number // D
  eoq: number
  stock: number
  purchase: number
}
export type EoqSection = {
  available: boolean
  note?: string
  orderCost: number // S
  holdingRate: number // H rate
  rows: EoqRow[]
}

export type SafetyRow = {
  item_id: string
  name: string
  avgWeeklyDemand: number
  sigmaWeekly: number
  safetyStock: number // SS
  reorderPoint: number // ROP
  stock: number
  belowReorder: boolean
}
export type SafetySection = {
  available: boolean
  note?: string
  serviceZ: number
  leadTimeWeeks: number
  rows: SafetyRow[]
}

export type NewsvendorRow = {
  item_id: string
  name: string
  cu: number // маржа на единицу
  co: number // потеря при списании (закуп)
  criticalFractilePct: number // CF × 100
  recommendedStock: number // Q*
  stock: number
}
export type NewsvendorSection = {
  available: boolean
  note?: string
  rows: NewsvendorRow[]
}

export type AbcClassStat = {
  cls: 'A' | 'B' | 'C'
  itemCount: number
  itemSharePct: number
  revenue: number
  revenueSharePct: number
}
export type AbcVitalItem = {
  item_id: string
  name: string
  revenue: number
  cumulativePct: number
}
export type AbcSection = {
  available: boolean
  note?: string
  totalRevenue: number
  totalItems: number
  classes: AbcClassStat[]
  vital: AbcVitalItem[] // класс A
}

export type CashierRisk = {
  cashier: string
  shortfallEvents: number
  totalEvents: number
  posterior: number // вероятность недостачи (Beta-сглаживание)
  posteriorPct: number
}
export type BayesSection = {
  available: boolean
  note?: string
  source: 'audit' | 'writeoff' | 'none'
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
export type RfmSection = {
  available: boolean
  note?: string
  segments: RfmSegmentStat[]
  customers: RfmCustomer[] // верх по monetary
}

export type HealthFactor = { label: string; score0to100: number; note: string }
export type HealthSection = {
  score: number // 0..100 — общая оценка здоровья бизнеса
  factors: HealthFactor[]
}

export type ClvRow = {
  customer_id: string
  name: string
  clv: number // оценка пожизненной ценности клиента, ₸
  avgOrder: number // средний чек, ₸
  frequency: number // число покупок
}
export type ClvSection = {
  available: boolean
  note?: string
  rows: ClvRow[]
}

export type BusinessIntelligenceResult = {
  organizationId: string | null
  generatedAt: string
  anomalies: AnomalySection
  eoq: EoqSection
  safetyStock: SafetySection
  newsvendor: NewsvendorSection
  abc: AbcSection
  cashierRisk: BayesSection
  rfm: RfmSection
  healthScore: HealthSection
  clv: ClvSection
}

function emptyResult(organizationId: string | null): BusinessIntelligenceResult {
  const na = (extra: any) => ({ available: false, note: 'нет данных', ...extra })
  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    anomalies: na({ days: ANALYSIS_DAYS, points: [], anomalies: [] }),
    eoq: na({ orderCost: DEFAULT_ORDER_COST, holdingRate: DEFAULT_HOLDING_RATE, rows: [] }),
    safetyStock: na({ serviceZ: SERVICE_Z, leadTimeWeeks: DEFAULT_LEAD, rows: [] }),
    newsvendor: na({ rows: [] }),
    abc: na({ totalRevenue: 0, totalItems: 0, classes: [], vital: [] }),
    cashierRisk: na({ source: 'none', rows: [] }),
    rfm: na({ segments: [], customers: [] }),
    healthScore: { score: 0, factors: [] },
    clv: { available: false, note: 'нет данных', rows: [] },
  }
}

const dayKey = (iso: string) => String(iso || '').slice(0, 10)
const weekKey = (iso: string) => {
  // ISO-неделя приблизительно: год + номер недели от epoch (нужна лишь группировка).
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return String(Math.floor(t / (7 * DAY_MS)))
}

/**
 * Считает бизнес-аналитику для скоупа. supabase — admin-клиент (обходит RLS).
 * Скоуп по company передаёт вызывающий (через allowedCompanyIds).
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

  // ── Окно анализа ───────────────────────────────────────────────────────────
  // Приоритет: если заданы ОБА валидных from/to (YYYY-MM-DD) — произвольный период.
  // Иначе — пресет days (30/90/180/365), по умолчанию 60.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const fromStr = typeof params.from === 'string' ? params.from.trim() : ''
  const toStr = typeof params.to === 'string' ? params.to.trim() : ''
  let customSince: Date | null = null
  let customUntil: Date | null = null
  if (DATE_RE.test(fromStr) && DATE_RE.test(toStr)) {
    const s = new Date(`${fromStr}T00:00:00`)
    const u = new Date(`${toStr}T23:59:59`)
    if (Number.isFinite(s.getTime()) && Number.isFinite(u.getTime()) && u.getTime() >= s.getTime()) {
      customSince = s
      customUntil = u
    }
  }
  // windowDays: из произвольного периода — ceil((until−since)/DAY_MS), мин. 1; иначе пресет.
  const windowDays = customSince && customUntil
    ? Math.max(1, Math.ceil((customUntil.getTime() - customSince.getTime()) / DAY_MS))
    : [30, 90, 180, 365].includes(Number(params.days)) ? Number(params.days) : ANALYSIS_DAYS

  // NEVER-pattern: не-супер без орг → пустой набор компаний → пустой результат.
  if (Array.isArray(allowedCompanyIds) && allowedCompanyIds.length === 0) {
    return emptyResult(organizationId)
  }

  // Фильтр одной точки (если выбрана) — в пределах разрешённого скоупа.
  let effectiveCompanyIds = allowedCompanyIds
  if (params.companyId) {
    if (allowedCompanyIds && !allowedCompanyIds.includes(params.companyId)) return emptyResult(organizationId)
    effectiveCompanyIds = [params.companyId]
  }

  const now = Date.now()
  // since/until: при произвольном периоде — заданные границы; иначе скользящее окно.
  const since = (customSince ? customSince : new Date(now - windowDays * DAY_MS)).toISOString()
  const until = customUntil ? customUntil.toISOString() : null

  // 1. Точки (companies) и их локации скоупа.
  let compQ = supabase.from('companies').select('id, name')
  if (effectiveCompanyIds) compQ = compQ.in('id', effectiveCompanyIds)
  const { data: compRows, error: compErr } = await compQ
  if (compErr) throw compErr
  const companyName = new Map<string, string>()
  for (const c of (compRows || []) as any[]) companyName.set(String(c.id), String(c.name || '—'))

  let locQ = supabase.from('inventory_locations').select('id, company_id')
  if (effectiveCompanyIds) locQ = locQ.in('company_id', effectiveCompanyIds)
  const { data: locRows, error: locErr } = await locQ
  if (locErr) throw locErr
  const companyByLocation = new Map<string, string>()
  const locationIds: string[] = []
  for (const r of (locRows || []) as any[]) {
    const id = String(r.id)
    locationIds.push(id)
    if (r.company_id) companyByLocation.set(id, String(r.company_id))
  }
  if (locationIds.length === 0) return emptyResult(organizationId)

  // 2. Продажи за 60 дней (sale, from_location ∈ локации скоупа). Пагинация.
  type SaleRow = { item_id: string; quantity: number; created_at: string; total_amount: number | null; from_location_id: string | null }
  // Агрегаты по товару (для EOQ/SS/Newsvendor/ABC).
  type ItemAgg = { soldQty: number; revenue: number; weeklyQty: Map<string, number> }
  const itemAgg = new Map<string, ItemAgg>()
  // Дневная выручка по точке (для аномалий).
  const dailyRevByCompany = new Map<string, Map<string, number>>()

  for (let from = 0; ; from += PAGE) {
    let salesQ = supabase
      .from('inventory_movements')
      .select('item_id, quantity, created_at, total_amount, from_location_id')
      .eq('movement_type', 'sale')
      .in('from_location_id', locationIds)
      .gte('created_at', since)
    // Верхняя граница произвольного периода (если задан).
    if (until) salesQ = salesQ.lte('created_at', until)
    const { data, error } = await salesQ
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as SaleRow[]
    for (const row of batch) {
      const itemId = String(row.item_id || '')
      const qty = Number(row.quantity || 0)
      const amount = Number(row.total_amount || 0)
      const createdAt = String(row.created_at || '')
      // Дневная выручка по точке (вся, даже qty=0/возвраты исключены выше типом).
      const companyId = row.from_location_id ? companyByLocation.get(String(row.from_location_id)) : undefined
      if (companyId) {
        const byDay = dailyRevByCompany.get(companyId) || new Map<string, number>()
        const dk = dayKey(createdAt)
        byDay.set(dk, (byDay.get(dk) || 0) + amount)
        dailyRevByCompany.set(companyId, byDay)
      }
      if (!itemId || !(qty > 0)) continue
      const agg = itemAgg.get(itemId) || { soldQty: 0, revenue: 0, weeklyQty: new Map<string, number>() }
      agg.soldQty += qty
      agg.revenue += amount
      const wk = weekKey(createdAt)
      if (wk) agg.weeklyQty.set(wk, (agg.weeklyQty.get(wk) || 0) + qty)
      itemAgg.set(itemId, agg)
    }
    if (batch.length < PAGE) break
  }

  // 3. Остатки по локациям скоупа (для текущего stock).
  const stockByItem = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .in('location_id', locationIds)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as Array<{ item_id: string; quantity: number }>
    for (const b of batch) {
      const id = String(b.item_id || '')
      if (!id) continue
      stockByItem.set(id, (stockByItem.get(id) || 0) + Number(b.quantity || 0))
    }
    if (batch.length < PAGE) break
  }

  const itemIds = Array.from(itemAgg.keys())

  // 4. Карточки товаров (name, sale_price, fallback закупки).
  const itemInfo = new Map<string, { name: string; salePrice: number; fallbackCost: number }>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
    if (chunk.length === 0) break
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, sale_price, default_purchase_price')
      .in('id', chunk)
    if (error) throw error
    for (const r of data || []) {
      itemInfo.set(String(r.id), {
        name: String(r.name || '—'),
        salePrice: Number((r as any).sale_price || 0),
        fallbackCost: Number((r as any).default_purchase_price || 0),
      })
    }
  }

  // 5. Последняя закупочная цена (макс received_at приёмки) → purchase.
  const lastCostByItem = new Map<string, { unitCost: number; receivedAt: string }>()
  for (let i = 0; i < itemIds.length; i += 300) {
    const chunk = itemIds.slice(i, i + 300)
    if (chunk.length === 0) break
    const { data, error } = await supabase
      .from('inventory_receipt_items')
      .select('item_id, unit_cost, receipt:receipt_id(received_at)')
      .in('item_id', chunk)
    if (error) throw error
    for (const r of (data || []) as any[]) {
      const itemId = String(r.item_id || '')
      if (!itemId) continue
      const receivedAt = String(r.receipt?.received_at || '')
      const prev = lastCostByItem.get(itemId)
      if (prev && prev.receivedAt >= receivedAt) continue
      lastCostByItem.set(itemId, { unitCost: Number(r.unit_cost || 0), receivedAt })
    }
  }
  const purchaseOf = (itemId: string) => {
    const c = lastCostByItem.get(itemId)
    if (c && c.unitCost > 0) return c.unitCost
    return itemInfo.get(itemId)?.fallbackCost || 0
  }

  // Сколько недель в окне (для перевода спроса в неделю/год).
  const weeks = windowDays / 7

  // ── A. Детектор аномалий (Z-score / контрольные карты) ─────────────────────
  const anomalyPoints: AnomalyPoint[] = []
  const anomalies: AnomalyDay[] = []
  for (const [companyId, byDay] of dailyRevByCompany) {
    const values = Array.from(byDay.values())
    if (values.length < 3) continue // мало данных — пропускаем точку
    const mu = mean(values)
    const sigma = stddev(values)
    const name = companyName.get(companyId) || '—'
    anomalyPoints.push({
      company: name,
      mean: r0(mu),
      stddev: r0(sigma),
      ucl: r0(mu + 3 * sigma),
      lcl: r0(mu - 3 * sigma),
      daysAnalyzed: values.length,
    })
    if (sigma <= 0) continue // деления на 0 нет — все дни равны, аномалий нет
    for (const [dk, rev] of byDay) {
      const z = (rev - mu) / sigma
      if (Math.abs(z) > 2) {
        anomalies.push({ company: name, date: dk, revenue: r0(rev), z: r2(z), direction: z > 0 ? 'above' : 'below' })
      }
    }
  }
  anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  const anomalySection: AnomalySection = {
    available: anomalyPoints.length > 0,
    note: anomalyPoints.length > 0 ? undefined : 'нужны данные о продажах за период',
    days: windowDays,
    points: anomalyPoints,
    anomalies: anomalies.slice(0, 40),
  }

  // ── Метрики по товару (нужны для B/C/D/E) ──────────────────────────────────
  type Metric = {
    item_id: string
    name: string
    soldQty: number
    revenue: number
    annualDemand: number
    purchase: number
    salePrice: number
    stock: number
    weeklyValues: number[] // спрос по неделям окна
  }
  const metrics: Metric[] = []
  for (const itemId of itemIds) {
    const agg = itemAgg.get(itemId)!
    const info = itemInfo.get(itemId)
    const purchase = purchaseOf(itemId)
    const salePrice = info?.salePrice || 0
    const annualDemand = agg.soldQty * (365 / windowDays)
    // Недельный спрос: заполняем все недели окна (включая нули) для честного σ.
    const totalWeeks = Math.max(1, Math.round(weeks))
    const weeklyMap = agg.weeklyQty
    const sortedWeekKeys = Array.from(weeklyMap.keys()).sort()
    const weeklyValues: number[] = []
    // Если недель с продажами меньше окна — добиваем нулями до totalWeeks.
    for (const k of sortedWeekKeys) weeklyValues.push(weeklyMap.get(k) || 0)
    while (weeklyValues.length < totalWeeks) weeklyValues.push(0)
    metrics.push({
      item_id: itemId,
      name: info?.name || '—',
      soldQty: agg.soldQty,
      revenue: agg.revenue,
      annualDemand,
      purchase,
      salePrice,
      stock: stockByItem.get(itemId) || 0,
      weeklyValues,
    })
  }

  // ── B. EOQ (формула Уилсона) — топ-20 по обороту (revenue) ─────────────────
  const byRevenue = [...metrics].sort((a, b) => b.revenue - a.revenue)
  const eoqRows: EoqRow[] = []
  for (const m of byRevenue.slice(0, 20)) {
    const D = m.annualDemand
    const S = DEFAULT_ORDER_COST
    const H = DEFAULT_HOLDING_RATE * m.purchase
    // EOQ = √(2DS/H). Защита деления: H>0 и D>0.
    const eoq = D > 0 && H > 0 ? Math.sqrt((2 * D * S) / H) : 0
    eoqRows.push({
      item_id: m.item_id,
      name: m.name,
      annualDemand: r0(D),
      eoq: r0(eoq),
      stock: r2(m.stock),
      purchase: r2(m.purchase),
    })
  }
  const eoqSection: EoqSection = {
    available: eoqRows.some((r) => r.eoq > 0),
    note: eoqRows.some((r) => r.eoq > 0) ? undefined : 'нужны закупочные цены и продажи',
    orderCost: DEFAULT_ORDER_COST,
    holdingRate: DEFAULT_HOLDING_RATE,
    rows: eoqRows,
  }

  // ── C. Страховой запас + точка дозаказа — топ-20 по обороту ────────────────
  const safetyRows: SafetyRow[] = []
  for (const m of byRevenue.slice(0, 20)) {
    const avgWeekly = mean(m.weeklyValues)
    const sigmaWeekly = stddev(m.weeklyValues)
    // SS = Z · σ_d · √leadTime ; ROP = avg · leadTime + SS.
    const ss = SERVICE_Z * sigmaWeekly * Math.sqrt(DEFAULT_LEAD)
    const rop = avgWeekly * DEFAULT_LEAD + ss
    safetyRows.push({
      item_id: m.item_id,
      name: m.name,
      avgWeeklyDemand: r2(avgWeekly),
      sigmaWeekly: r2(sigmaWeekly),
      safetyStock: Math.ceil(ss),
      reorderPoint: Math.ceil(rop),
      stock: r2(m.stock),
      belowReorder: m.stock < rop,
    })
  }
  const safetySection: SafetySection = {
    available: safetyRows.length > 0,
    note: safetyRows.length > 0 ? undefined : 'нужны продажи за период',
    serviceZ: SERVICE_Z,
    leadTimeWeeks: DEFAULT_LEAD,
    rows: safetyRows,
  }

  // ── D. Newsvendor (critical fractile) ──────────────────────────────────────
  // Признака «скоропорт»/срока годности в схеме нет (проверено) → считаем по всем
  // ходовым товарам с положительной маржой, помечаем это в note.
  const newsvendorRows: NewsvendorRow[] = []
  for (const m of byRevenue.slice(0, 20)) {
    const cu = m.salePrice - m.purchase // маржа (недозаказ)
    const co = m.purchase // потеря при списании
    if (!(cu > 0) || !(co > 0)) continue // защита деления и бессмысленных строк
    const cf = cu / (cu + co)
    const zcf = inverseNormalCDF(cf)
    const avgWeekly = mean(m.weeklyValues)
    const sigmaWeekly = stddev(m.weeklyValues)
    // Q* = μ + z(CF)·σ (недельный горизонт). Не ниже 0.
    const qStar = Math.max(0, avgWeekly + (Number.isFinite(zcf) ? zcf : 0) * sigmaWeekly)
    newsvendorRows.push({
      item_id: m.item_id,
      name: m.name,
      cu: r2(cu),
      co: r2(co),
      criticalFractilePct: r1(cf * 100),
      recommendedStock: Math.ceil(qStar),
      stock: r2(m.stock),
    })
  }
  const newsvendorSection: NewsvendorSection = {
    available: newsvendorRows.length > 0,
    note:
      newsvendorRows.length > 0
        ? 'В каталоге нет поля срока годности — расчёт по всем ходовым товарам с маржой (критический фрактиль)'
        : 'нужны товары с маржой и продажами',
    rows: newsvendorRows,
  }

  // ── E. ABC-анализ (Парето 80/20) ───────────────────────────────────────────
  const abcSorted = [...metrics].filter((m) => m.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = abcSorted.reduce((s, m) => s + m.revenue, 0)
  const vital: AbcVitalItem[] = []
  const counts = { A: 0, B: 0, C: 0 }
  const rev = { A: 0, B: 0, C: 0 }
  let cum = 0
  for (const m of abcSorted) {
    cum += m.revenue
    const cumPct = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 100
    let cls: 'A' | 'B' | 'C'
    if (cumPct <= 80) cls = 'A'
    else if (cumPct <= 95) cls = 'B'
    else cls = 'C'
    counts[cls] += 1
    rev[cls] += m.revenue
    if (cls === 'A') vital.push({ item_id: m.item_id, name: m.name, revenue: r0(m.revenue), cumulativePct: r1(cumPct) })
  }
  const totalItems = abcSorted.length
  const abcClasses: AbcClassStat[] = (['A', 'B', 'C'] as const).map((cls) => ({
    cls,
    itemCount: counts[cls],
    itemSharePct: totalItems > 0 ? r1((counts[cls] / totalItems) * 100) : 0,
    revenue: r0(rev[cls]),
    revenueSharePct: totalRevenue > 0 ? r1((rev[cls] / totalRevenue) * 100) : 0,
  }))
  const abcSection: AbcSection = {
    available: totalItems > 0,
    note: totalItems > 0 ? undefined : 'нужны продажи за период',
    totalRevenue: r0(totalRevenue),
    totalItems,
    classes: abcClasses,
    vital: vital.slice(0, 30),
  }

  // ── F. Байес-риск недостач по кассирам ─────────────────────────────────────
  const cashierRisk = await computeCashierRisk(supabase, { allowedCompanyIds, locationIds })

  // ── G. RFM-сегментация клиентов ────────────────────────────────────────────
  const rfm = await computeRfm(supabase, { allowedCompanyIds, now })

  // ── H. Оценка здоровья бизнеса (среднее доступных факторов 0..100) ──────────
  const healthScore = computeHealthScore({
    safety: safetySection,
    anomalies: anomalySection,
    cashierRisk,
  })

  // ── I. CLV — пожизненная ценность клиента (переиспользуем RFM) ──────────────
  const clv = computeClv(rfm)

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    anomalies: anomalySection,
    eoq: eoqSection,
    safetyStock: safetySection,
    newsvendor: newsvendorSection,
    abc: abcSection,
    cashierRisk,
    rfm,
    healthScore,
    clv,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// H. Оценка здоровья бизнеса.
// score = среднее доступных факторов, каждый 0..100. Все деления защищены.
//   Наличие     = 100 · (1 − belowReorder/total)  — доля топ-товаров НЕ ниже дозаказа
//   Стабильность= 100 − min(100, anomalies×10)     — меньше аномалий лучше
//   Контроль    = 100 − maxPosteriorPct            — по макс. риску кассира (нет → 100)
// (Фактор «Ассортимент» по мёртвым товарам пропускаем — отдельных данных здесь нет.)
// ─────────────────────────────────────────────────────────────────────────────
function computeHealthScore(input: {
  safety: SafetySection
  anomalies: AnomalySection
  cashierRisk: BayesSection
}): HealthSection {
  const factors: HealthFactor[] = []

  // Наличие — по страховому запасу.
  const safetyRows = input.safety.rows || []
  const total = safetyRows.length
  if (input.safety.available && total > 0) {
    const below = safetyRows.filter((r) => r.belowReorder).length
    const score = 100 * (1 - below / total) // total>0 гарантирован
    factors.push({
      label: 'Наличие',
      score0to100: r0(score),
      note: `${total - below} из ${total} топ-товаров выше точки дозаказа${below > 0 ? `, ${below} нужно заказать` : ''}`,
    })
  }

  // Стабильность — по числу аномальных дней.
  if (input.anomalies.available) {
    const n = input.anomalies.anomalies.length
    const score = 100 - Math.min(100, n * 10)
    factors.push({
      label: 'Стабильность',
      score0to100: r0(score),
      note: n === 0 ? 'аномальных дней выручки нет' : `${n} аномальных ${n === 1 ? 'день' : 'дней'} в выручке`,
    })
  }

  // Контроль — по максимальному риску кассира.
  if (input.cashierRisk.available && input.cashierRisk.rows.length > 0) {
    const maxPct = Math.max(...input.cashierRisk.rows.map((r) => r.posteriorPct))
    const score = Math.max(0, 100 - maxPct)
    const worst = input.cashierRisk.rows.find((r) => r.posteriorPct === maxPct)
    factors.push({
      label: 'Контроль',
      score0to100: r0(score),
      note: worst ? `макс. риск недостач: ${worst.cashier} (${maxPct}%)` : `макс. риск недостач ${maxPct}%`,
    })
  } else {
    factors.push({ label: 'Контроль', score0to100: 100, note: 'данных о недостачах нет — рисков не выявлено' })
  }

  // score = среднее доступных факторов (защита деления на 0).
  const score = factors.length > 0 ? r0(mean(factors.map((f) => f.score0to100))) : 0
  return { score, factors }
}

// ─────────────────────────────────────────────────────────────────────────────
// I. CLV — Customer Lifetime Value (переиспользуем RFM-клиентов).
//   avgOrder = monetary / max(1, frequency)        — средний чек
//   clv ≈ avgOrder · frequency · HORIZON            — простая оценка ценности
//   HORIZON = 2 (горизонт ~2 «жизни» клиента)
// Топ-10 по clv убыв. Нет клиентов → available:false.
// ─────────────────────────────────────────────────────────────────────────────
const CLV_HORIZON = 2

function computeClv(rfm: RfmSection): ClvSection {
  if (!rfm.available || !rfm.customers || rfm.customers.length === 0) {
    return { available: false, note: 'нужны данные о клиентах и покупках', rows: [] }
  }
  const rows: ClvRow[] = rfm.customers.map((c) => {
    const frequency = Math.max(0, c.frequency)
    const avgOrder = c.monetary / Math.max(1, frequency) // защита деления на 0
    const clv = avgOrder * frequency * CLV_HORIZON
    return {
      customer_id: c.customer_id,
      name: c.name,
      clv: r0(clv),
      avgOrder: r0(avgOrder),
      frequency,
    }
  })
  rows.sort((a, b) => b.clv - a.clv)
  return { available: true, rows: rows.slice(0, 10) }
}

// ─────────────────────────────────────────────────────────────────────────────
// F. Байес-риск по кассирам.
// Источник №1 — закрытые аудит-акты: snapshot.expected_qty vs counts.counted_qty
// по counted_by (оператор). Событие = посчитанная позиция; недостача = counted < expected.
// posterior = (α + shortfalls) / (α + β + total), α=1, β=4.
// Если аудит-данных нет — прокси по списаниям (writeoff) с actor; иначе note.
// ─────────────────────────────────────────────────────────────────────────────
async function computeCashierRisk(
  supabase: AnySupabase,
  params: { allowedCompanyIds: string[] | null; locationIds: string[] },
): Promise<BayesSection> {
  const { allowedCompanyIds, locationIds } = params

  // Закрытые акты скоупа.
  let actsQ = supabase
    .from('inventory_audit_acts')
    .select('id, company_id')
    .eq('status', 'closed')
    .order('opened_at', { ascending: false })
    .limit(200)
  if (allowedCompanyIds) actsQ = actsQ.in('company_id', allowedCompanyIds)
  const { data: acts } = await actsQ
  const actIds = ((acts || []) as any[]).map((a) => String(a.id))

  // Агрегаты по оператору: события (позиции) и недостачи.
  const events = new Map<string, number>()
  const shortfalls = new Map<string, number>()

  if (actIds.length > 0) {
    // snapshot: act_id+item_id → expected_qty
    const expectedBy = new Map<string, number>()
    for (let i = 0; i < actIds.length; i += 50) {
      const chunk = actIds.slice(i, i + 50)
      const { data } = await supabase.from('inventory_audit_snapshot').select('act_id, item_id, expected_qty').in('act_id', chunk)
      for (const r of (data || []) as any[]) expectedBy.set(`${r.act_id}:${r.item_id}`, Number(r.expected_qty || 0))
    }
    // counts: кто посчитал и сколько
    const countRows: Array<{ act_id: string; item_id: string; counted_qty: number; counted_by: string | null }> = []
    for (let i = 0; i < actIds.length; i += 50) {
      const chunk = actIds.slice(i, i + 50)
      const { data } = await supabase.from('inventory_audit_counts').select('act_id, item_id, counted_qty, counted_by').in('act_id', chunk)
      for (const r of (data || []) as any[]) {
        countRows.push({ act_id: String(r.act_id), item_id: String(r.item_id), counted_qty: Number(r.counted_qty || 0), counted_by: r.counted_by ? String(r.counted_by) : null })
      }
    }
    for (const r of countRows) {
      if (!r.counted_by) continue
      events.set(r.counted_by, (events.get(r.counted_by) || 0) + 1)
      const expected = expectedBy.get(`${r.act_id}:${r.item_id}`) ?? 0
      if (r.counted_qty < expected - 1e-9) shortfalls.set(r.counted_by, (shortfalls.get(r.counted_by) || 0) + 1)
    }
  }

  let source: 'audit' | 'writeoff' | 'none' = events.size > 0 ? 'audit' : 'none'

  // Прокси по списаниям, если аудита нет.
  if (events.size === 0 && locationIds.length > 0) {
    const since = new Date(Date.now() - 90 * DAY_MS).toISOString()
    const writeoffByOp = new Map<string, number>()
    let totalWriteoffs = 0
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('actor_user_id, quantity, from_location_id, created_at')
        .in('movement_type', ['writeoff', 'inventory_adjustment'])
        .in('from_location_id', locationIds)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) break
      const batch = (data || []) as any[]
      for (const r of batch) {
        const op = r.actor_user_id ? String(r.actor_user_id) : null
        if (!op) continue
        if (Number(r.quantity || 0) <= 0) continue
        totalWriteoffs += 1
        writeoffByOp.set(op, (writeoffByOp.get(op) || 0) + 1)
      }
      if (batch.length < PAGE) break
    }
    if (writeoffByOp.size > 0) {
      source = 'writeoff'
      for (const [op, w] of writeoffByOp) {
        // событие = списание; «недостача» = само списание (прокси).
        events.set(op, totalWriteoffs) // знаменатель — общий объём (на кого пришлось)
        shortfalls.set(op, w)
      }
    }
  }

  if (events.size === 0) {
    return { available: false, note: 'нужны закрытые ревизии (аудит-акты) с подсчётом по операторам', source: 'none', rows: [] }
  }

  // Имена операторов.
  const opIds = Array.from(events.keys())
  const opName = new Map<string, string>()
  for (let i = 0; i < opIds.length; i += 200) {
    const chunk = opIds.slice(i, i + 200)
    const { data } = await supabase.from('operators').select('id, name, short_name').in('id', chunk)
    for (const o of (data || []) as any[]) opName.set(String(o.id), String(o.name || o.short_name || 'Оператор'))
  }

  const rows: CashierRisk[] = []
  for (const op of opIds) {
    const total = events.get(op) || 0
    const sf = shortfalls.get(op) || 0
    // posterior = (α + shortfalls) / (α + β + total). total>0 гарантирован.
    const posterior = (BETA_ALPHA + sf) / (BETA_ALPHA + BETA_BETA + total)
    rows.push({
      cashier: opName.get(op) || (source === 'writeoff' ? 'Пользователь' : 'Оператор'),
      shortfallEvents: sf,
      totalEvents: total,
      posterior: r2(posterior),
      posteriorPct: r1(posterior * 100),
    })
  }
  rows.sort((a, b) => b.posterior - a.posterior)

  return {
    available: true,
    note:
      source === 'writeoff'
        ? 'Нет ревизий — оценка по списаниям как прокси (менее точно). Проведите аудит-акты для точной оценки.'
        : undefined,
    source,
    rows: rows.slice(0, 30),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// G. RFM-сегментация.
// R — дней с последней покупки (из point_sales.created_at), F — visits_count,
// M — total_spent (из customers). Квинтили 1–5; сегмент по сумме баллов.
// ─────────────────────────────────────────────────────────────────────────────
async function computeRfm(
  supabase: AnySupabase,
  params: { allowedCompanyIds: string[] | null; now: number },
): Promise<RfmSection> {
  const { allowedCompanyIds, now } = params

  // Клиенты скоупа.
  let custQ = supabase.from('customers').select('id, name, total_spent, visits_count').eq('is_active', true)
  if (allowedCompanyIds) custQ = custQ.in('company_id', allowedCompanyIds)
  const { data: custRows, error: custErr } = await custQ.limit(5000)
  if (custErr || !custRows || (custRows as any[]).length === 0) {
    return { available: false, note: 'нужны данные о клиентах и их покупках', segments: [], customers: [] }
  }

  type Cust = { id: string; name: string; monetary: number; frequency: number; lastPurchase: number | null }
  const customers: Cust[] = ((custRows as any[]) || []).map((c) => ({
    id: String(c.id),
    name: String(c.name || 'Клиент'),
    monetary: Number(c.total_spent || 0),
    frequency: Number(c.visits_count || 0),
    lastPurchase: null,
  }))
  const byId = new Map(customers.map((c) => [c.id, c]))

  // Последняя покупка по клиенту (point_sales.created_at).
  const custIds = customers.map((c) => c.id)
  for (let i = 0; i < custIds.length; i += 300) {
    const chunk = custIds.slice(i, i + 300)
    let q = supabase
      .from('point_sales')
      .select('customer_id, created_at')
      .in('customer_id', chunk)
      .order('created_at', { ascending: false })
    if (allowedCompanyIds) q = q.in('company_id', allowedCompanyIds)
    const { data } = await q.limit(5000)
    for (const r of (data || []) as any[]) {
      const cid = String(r.customer_id || '')
      const c = byId.get(cid)
      if (!c) continue
      const t = Date.parse(String(r.created_at || ''))
      if (Number.isFinite(t) && (c.lastPurchase === null || t > c.lastPurchase)) c.lastPurchase = t
    }
  }

  // Только клиенты хотя бы с одной покупкой (frequency>0 или есть дата).
  const active = customers.filter((c) => c.frequency > 0 || c.lastPurchase !== null || c.monetary > 0)
  if (active.length === 0) {
    return { available: false, note: 'нужны данные о покупках клиентов', segments: [], customers: [] }
  }

  // Квинтильные баллы. R: меньше дней → выше балл. F/M: больше → выше балл.
  const recencyDaysOf = (c: Cust) => (c.lastPurchase !== null ? Math.max(0, (now - c.lastPurchase) / DAY_MS) : 9999)
  const quintileScore = (value: number, sortedAsc: number[], higherIsBetter: boolean): number => {
    if (sortedAsc.length === 0) return 3
    // ранг значения (доля значений ≤ value)
    let rank = 0
    for (const v of sortedAsc) {
      if (v <= value) rank++
      else break
    }
    const pct = rank / sortedAsc.length // 0..1
    let score = Math.min(5, Math.max(1, Math.ceil(pct * 5)))
    if (!higherIsBetter) score = 6 - score // инвертируем для recency-days
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

  // Сводка по сегментам.
  const segMap = new Map<string, { count: number; monetary: number }>()
  for (const c of result) {
    const s = segMap.get(c.segment) || { count: 0, monetary: 0 }
    s.count += 1
    s.monetary += c.monetary
    segMap.set(c.segment, s)
  }
  const segments: RfmSegmentStat[] = Array.from(segMap.entries())
    .map(([segment, v]) => ({ segment, count: v.count, monetary: r0(v.monetary) }))
    .sort((a, b) => b.monetary - a.monetary)

  result.sort((a, b) => b.monetary - a.monetary)

  return {
    available: true,
    note: undefined,
    segments,
    customers: result.slice(0, 50),
  }
}
