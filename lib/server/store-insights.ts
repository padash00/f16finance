import 'server-only'

// ─────────────────────────────────────────────────────────────────────────────
// AI-разбор магазина — движок данных.
//
// Для выбранной организации (скоуп по company_id) считает по каждому товару за
// последние `days` дней: выручку, проданное кол-во, скорость продаж, маржу,
// прибыль, остаток, замороженные деньги, покрытие. Собирает бакеты:
//   topProfit   — звёзды (что кормит)
//   deadStock   — мёртвый груз (есть остаток, 0 продаж) → заморожены деньги
//   slowLowMargin — продаётся, но медленно и с низкой маржой → кандидаты убрать
//   trending    — тренд (вторая половина периода vs первая)
//   losses      — списания/инвентаризация (writeoff/inventory_adjustment) в ₸
//
// ФИНАНСОВОЕ ЯДРО (не менять без согласования — денежный путь):
//   revenue      = Σ total_amount продаж (movement_type='sale')
//   soldQty      = Σ quantity продаж
//   velocityWeek = soldQty / (days/7)
//   purchase     = последняя приёмка (inventory_receipt_items.unit_cost) ||
//                  inventory_items.default_purchase_price
//   marginPct    = (sale_price − purchase) / sale_price × 100
//   profit       = soldQty × (sale_price − purchase)
//   stock        = Σ inventory_balances по локациям скоупа
//   stockValue   = stock × purchase
//   coverageWeeks= stock / velocityWeek (0 продаж + остаток → Infinity-маркер)
//
// Литералы movement_type подтверждены в supabase/migrations/20260322_inventory_foundation.sql:
//   'receipt','transfer_to_point','sale','debt','return','writeoff','inventory_adjustment'
//   → продажи = 'sale'; потери = 'writeoff' + 'inventory_adjustment'.
// ─────────────────────────────────────────────────────────────────────────────

type AnySupabase = any

export type InsightProduct = {
  item_id: string
  name: string
  soldQty: number
  revenue: number
  profit: number
  marginPct: number
  velocityPerWeek: number
  purchase: number
  salePrice: number
  stock: number
  stockValue: number
  coverageWeeks: number      // 999 = ∞ (есть остаток, продаж нет)
  trendPct: number           // вторая половина периода vs первая
}

export type DeadStockRow = {
  item_id: string
  name: string
  stock: number
  purchase: number
  stockValue: number         // заморожено ₸
}

export type SlowRow = {
  item_id: string
  name: string
  soldQty: number
  velocityPerWeek: number
  marginPct: number
  profit: number
  stock: number
  stockValue: number
}

export type TrendRow = {
  item_id: string
  name: string
  trendPct: number
  recentQty: number          // вторая половина
  earlierQty: number         // первая половина
  revenue: number
}

export type LossRow = {
  item_id: string
  name: string
  qty: number
  purchase: number
  lossValue: number          // qty × purchase
}

export type StoreInsightsResult = {
  organizationId: string | null
  days: number
  generatedAt: string
  totals: {
    totalRevenue: number
    totalProfit: number
    deadStockValue: number
    lossesValue: number
    skuSold: number          // сколько товаров продавалось
    skuDead: number          // сколько позиций — мёртвый груз
  }
  topProfit: InsightProduct[]
  deadStock: DeadStockRow[]
  slowLowMargin: SlowRow[]
  trending: { rising: TrendRow[]; falling: TrendRow[] }
  losses: { value: number; rows: LossRow[] }
}

const DAY_MS = 86_400_000
const COVERAGE_INFINITY = 999
const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

function empty(organizationId: string | null, days: number): StoreInsightsResult {
  return {
    organizationId,
    days,
    generatedAt: new Date().toISOString(),
    totals: { totalRevenue: 0, totalProfit: 0, deadStockValue: 0, lossesValue: 0, skuSold: 0, skuDead: 0 },
    topProfit: [],
    deadStock: [],
    slowLowMargin: [],
    trending: { rising: [], falling: [] },
    losses: { value: 0, rows: [] },
  }
}

/**
 * Считает AI-разбор магазина для текущего скоупа.
 * supabase — admin-клиент (обходит RLS). Скоуп по company должен быть передан
 * вызывающим: allowedCompanyIds === null → видно всё (superadmin без орг);
 * [] → ничего (NEVER-pattern); [...] → только эти компании.
 */
export async function computeStoreInsights(
  supabase: AnySupabase,
  params: {
    organizationId: string | null
    allowedCompanyIds: string[] | null
    isSuperAdmin?: boolean
    days?: number
  },
): Promise<StoreInsightsResult> {
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30
  const organizationId = params.organizationId || null
  const allowedCompanyIds = params.allowedCompanyIds

  // NEVER-pattern: не-супер без орг → пустой набор компаний → пустой результат.
  if (Array.isArray(allowedCompanyIds) && allowedCompanyIds.length === 0) {
    return empty(organizationId, days)
  }

  const now = Date.now()
  const since = new Date(now - days * DAY_MS).toISOString()
  // Середина периода — для тренда (вторая половина vs первая).
  const mid = new Date(now - (days / 2) * DAY_MS).toISOString()

  // 1. Локации скоупа.
  let locQ = supabase.from('inventory_locations').select('id, company_id')
  if (allowedCompanyIds) locQ = locQ.in('company_id', allowedCompanyIds)
  const { data: locRows, error: locErr } = await locQ
  if (locErr) throw locErr
  const locationIds = (locRows || []).map((r: any) => String(r.id)).filter(Boolean)
  if (locationIds.length === 0) return empty(organizationId, days)

  const PAGE = 1000

  // 2. Продажи за период (movement_type='sale', from_location ∈ локации скоупа).
  type SaleRow = { item_id: string; quantity: number; created_at: string; total_amount: number | null }
  type SaleAgg = { soldQty: number; revenue: number; recentQty: number; earlierQty: number }
  const salesByItem = new Map<string, SaleAgg>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('item_id, quantity, created_at, total_amount')
      .eq('movement_type', 'sale')
      .in('from_location_id', locationIds)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as SaleRow[]
    for (const row of batch) {
      const itemId = String(row.item_id || '')
      if (!itemId) continue
      const qty = Number(row.quantity || 0)
      if (!(qty > 0)) continue
      const createdAt = String(row.created_at || '')
      const amount = Number(row.total_amount || 0)
      const agg = salesByItem.get(itemId) || { soldQty: 0, revenue: 0, recentQty: 0, earlierQty: 0 }
      agg.soldQty += qty
      agg.revenue += amount
      if (createdAt >= mid) agg.recentQty += qty
      else agg.earlierQty += qty
      salesByItem.set(itemId, agg)
    }
    if (batch.length < PAGE) break
  }

  // 3. Потери: списания + инвентаризация за период (movement_type IN writeoff,inventory_adjustment).
  type LossAgg = { qty: number }
  const lossByItem = new Map<string, LossAgg>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('item_id, quantity, created_at, from_location_id, to_location_id')
      .in('movement_type', ['writeoff', 'inventory_adjustment'])
      .or(`from_location_id.in.(${locationIds.join(',')}),to_location_id.in.(${locationIds.join(',')})`)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as Array<{ item_id: string; quantity: number }>
    for (const row of batch) {
      const itemId = String(row.item_id || '')
      if (!itemId) continue
      const qty = Number(row.quantity || 0)
      if (!(qty > 0)) continue
      const agg = lossByItem.get(itemId) || { qty: 0 }
      agg.qty += qty
      lossByItem.set(itemId, agg)
    }
    if (batch.length < PAGE) break
  }

  // 4. Остатки по локациям скоупа — собираем весь каталог точки (не только проданное),
  //    иначе мёртвый груз (0 продаж) не попадёт в выборку.
  const stockByItem = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .in('location_id', locationIds)
      .gt('quantity', 0)
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

  // Полный набор item_id: проданные + с остатком + с потерями.
  const itemIds = Array.from(
    new Set<string>([...salesByItem.keys(), ...stockByItem.keys(), ...lossByItem.keys()]),
  )
  if (itemIds.length === 0) return empty(organizationId, days)

  // 5. Карточки товаров (name, sale_price, fallback закупки).
  const itemInfo = new Map<string, { name: string; salePrice: number; fallbackCost: number }>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
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

  // 6. Последняя закупочная цена по каждому товару (макс. received_at приёмки).
  const lastCostByItem = new Map<string, { unitCost: number; receivedAt: string }>()
  for (let i = 0; i < itemIds.length; i += 300) {
    const chunk = itemIds.slice(i, i + 300)
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
    const receipt = lastCostByItem.get(itemId)
    if (receipt && receipt.unitCost > 0) return receipt.unitCost
    return itemInfo.get(itemId)?.fallbackCost || 0
  }

  // 7. Метрики по каждому товару.
  const weeks = days / 7
  const products: InsightProduct[] = []
  let totalRevenue = 0
  let totalProfit = 0
  let deadStockValue = 0

  for (const itemId of itemIds) {
    const info = itemInfo.get(itemId)
    const name = info?.name || '—'
    const salePrice = info?.salePrice || 0
    const purchase = purchaseOf(itemId)
    const sale = salesByItem.get(itemId)
    const soldQty = sale?.soldQty || 0
    const revenue = sale?.revenue || 0
    const stock = stockByItem.get(itemId) || 0

    const unitProfit = salePrice - purchase
    const profit = soldQty * unitProfit
    const marginPct = salePrice > 0 ? ((salePrice - purchase) / salePrice) * 100 : 0
    const velocityPerWeek = weeks > 0 ? soldQty / weeks : 0
    const stockValue = stock * purchase
    const coverageWeeks =
      velocityPerWeek > 0 ? stock / velocityPerWeek : stock > 0 ? COVERAGE_INFINITY : 0

    const recentQty = sale?.recentQty || 0
    const earlierQty = sale?.earlierQty || 0
    const trendPct =
      earlierQty > 0 ? ((recentQty - earlierQty) / earlierQty) * 100 : recentQty > 0 ? 100 : 0

    totalRevenue += revenue
    totalProfit += profit
    if (soldQty === 0 && stock > 0) deadStockValue += stockValue

    products.push({
      item_id: itemId,
      name,
      soldQty: r2(soldQty),
      revenue: r0(revenue),
      profit: r0(profit),
      marginPct: r1(marginPct),
      velocityPerWeek: r2(velocityPerWeek),
      purchase: r2(purchase),
      salePrice: r2(salePrice),
      stock: r2(stock),
      stockValue: r0(stockValue),
      coverageWeeks: coverageWeeks >= COVERAGE_INFINITY ? COVERAGE_INFINITY : r1(coverageWeeks),
      trendPct: r1(trendPct),
    })
  }

  // 8. Бакеты (≤15 строк каждый).
  const topProfit = products
    .filter((p) => p.profit > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 15)

  const deadStock: DeadStockRow[] = products
    .filter((p) => p.stock > 0 && p.soldQty === 0)
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 15)
    .map((p) => ({ item_id: p.item_id, name: p.name, stock: p.stock, purchase: p.purchase, stockValue: p.stockValue }))

  // Медленные + низкая маржа: есть продажи, скорость в нижней трети, маржа < 15%.
  const sellingVel = products.filter((p) => p.soldQty > 0).map((p) => p.velocityPerWeek)
  const velThreshold = (() => {
    if (sellingVel.length === 0) return 0
    const sorted = [...sellingVel].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 3)] // нижняя треть скорости
  })()
  const slowLowMargin: SlowRow[] = products
    .filter((p) => p.soldQty > 0 && p.velocityPerWeek <= velThreshold && p.marginPct < 15)
    .sort((a, b) => a.marginPct - b.marginPct || a.velocityPerWeek - b.velocityPerWeek)
    .slice(0, 15)
    .map((p) => ({
      item_id: p.item_id,
      name: p.name,
      soldQty: p.soldQty,
      velocityPerWeek: p.velocityPerWeek,
      marginPct: p.marginPct,
      profit: p.profit,
      stock: p.stock,
      stockValue: p.stockValue,
    }))

  // Тренды: товары с заметной продажей (исключаем единичные хвосты — soldQty>=3).
  const trendable = products.filter((p) => p.soldQty >= 3)
  const toTrendRow = (p: InsightProduct): TrendRow => {
    const sale = salesByItem.get(p.item_id)
    return {
      item_id: p.item_id,
      name: p.name,
      trendPct: p.trendPct,
      recentQty: r2(sale?.recentQty || 0),
      earlierQty: r2(sale?.earlierQty || 0),
      revenue: p.revenue,
    }
  }
  const rising = trendable
    .filter((p) => p.trendPct > 15)
    .sort((a, b) => b.trendPct - a.trendPct)
    .slice(0, 10)
    .map(toTrendRow)
  const falling = trendable
    .filter((p) => p.trendPct < -15)
    .sort((a, b) => a.trendPct - b.trendPct)
    .slice(0, 10)
    .map(toTrendRow)

  // Потери в ₸.
  let lossesValue = 0
  const lossRows: LossRow[] = []
  for (const [itemId, agg] of lossByItem) {
    const purchase = purchaseOf(itemId)
    const lossValue = agg.qty * purchase
    lossesValue += lossValue
    lossRows.push({
      item_id: itemId,
      name: itemInfo.get(itemId)?.name || '—',
      qty: r2(agg.qty),
      purchase: r2(purchase),
      lossValue: r0(lossValue),
    })
  }
  lossRows.sort((a, b) => b.lossValue - a.lossValue)

  return {
    organizationId,
    days,
    generatedAt: new Date().toISOString(),
    totals: {
      totalRevenue: r0(totalRevenue),
      totalProfit: r0(totalProfit),
      deadStockValue: r0(deadStockValue),
      lossesValue: r0(lossesValue),
      skuSold: salesByItem.size,
      skuDead: deadStock.length,
    },
    topProfit,
    deadStock,
    slowLowMargin,
    trending: { rising, falling },
    losses: { value: r0(lossesValue), rows: lossRows.slice(0, 15) },
  }
}
