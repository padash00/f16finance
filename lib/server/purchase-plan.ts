import 'server-only'

// ─────────────────────────────────────────────────────────────────────────────
// Умный план закупа на следующую неделю.
//
// Финансовое ядро: для выбранной точки (company_id) считает, сколько закупить
// по каждому товару, исходя из продаж (спрос), текущих остатков и последней
// закупочной цены. Результат группируется по поставщикам.
//
// ФОРМУЛА (не менять без согласования — это денежный путь):
//   weeklyDemand = sum(qty продаж за 28 дней) / 4
//   target       = weeklyDemand * 2        (запас на 2 недели)
//   order        = ceil(max(0, target - stock))
//   amount       = order * unitCost        (последняя приёмка товара)
//   В план попадают только товары с order > 0.
// ─────────────────────────────────────────────────────────────────────────────

type AnySupabase = any

export type PurchasePlanLine = {
  item_id: string
  name: string
  barcode: string
  weeklyDemand: number
  trendPct: number
  stock: number
  order: number
  unitCost: number
  amount: number
  salePrice: number
  marginPct: number       // (цена − закуп) / цена × 100
  coverageWeeks: number    // на сколько недель хватит текущего остатка
  wasOutOfStock: boolean   // сейчас в нуле — реальный спрос мог быть выше
  packSize: number         // штук в упаковке (1 = штучный)
  packs: number            // сколько упаковок к заказу
}

export type PurchasePlanSkip = {
  item_id: string
  name: string
  stock: number
  weeklyDemand: number
  coverageWeeks: number
}

export type PurchasePlanSupplierGroup = {
  supplier: string
  total: number
  items: PurchasePlanLine[]
}

export type PurchasePlanResult = {
  company_id: string
  weekStart: string
  generatedAt: string
  total: number
  revenue4wPerWeek: number
  bySupplier: PurchasePlanSupplierGroup[]
  doNotBuy: PurchasePlanSkip[]   // затоваренные — брать не нужно
}

const DAY_MS = 86_400_000

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Понедельник СЛЕДУЮЩЕЙ недели в формате YYYY-MM-DD. */
function nextMondayISO(from: Date): string {
  const day = from.getUTCDay() // 0=Вс .. 6=Сб
  // Сколько дней до ближайшего будущего понедельника (строго в будущем).
  const daysUntilMonday = ((8 - day) % 7) || 7
  const monday = new Date(from.getTime() + daysUntilMonday * DAY_MS)
  return monday.toISOString().slice(0, 10)
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10

/**
 * Считает план закупа для одной точки. Используется и в /suggest, и в AI-роуте.
 * supabase — admin-клиент (обходит RLS). Скоуп по company должен быть проверён
 * вызывающим (company_id ∈ allowedCompanyIds).
 */
export async function computePurchasePlan(
  supabase: AnySupabase,
  companyId: string,
): Promise<PurchasePlanResult> {
  const today = startOfTodayUtc()
  const weekStart = nextMondayISO(today)
  const generatedAt = new Date().toISOString()

  // Окна спроса (по created_at движений).
  const since28 = new Date(today.getTime() - 28 * DAY_MS).toISOString()
  const since14 = new Date(today.getTime() - 14 * DAY_MS).toISOString() // последние 14 дней
  const since28for14 = since28 // предыдущие 14 дней = [since28; since14)

  // 1. Локации точки.
  const { data: locRows, error: locErr } = await supabase
    .from('inventory_locations')
    .select('id')
    .eq('company_id', companyId)
  if (locErr) throw locErr
  const locationIds = (locRows || []).map((r: any) => String(r.id)).filter(Boolean)

  if (locationIds.length === 0) {
    return { company_id: companyId, weekStart, generatedAt, total: 0, revenue4wPerWeek: 0, bySupplier: [], doNotBuy: [] }
  }

  // 2. Продажи за 28 дней (movement_type='sale', from_location ∈ локации точки).
  //    Пагинируем — продаж может быть много.
  type SaleRow = { item_id: string; quantity: number; created_at: string; total_amount: number | null }
  const sales: SaleRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('item_id, quantity, created_at, total_amount')
      .eq('movement_type', 'sale')
      .in('from_location_id', locationIds)
      .gte('created_at', since28)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as SaleRow[]
    sales.push(...batch)
    if (batch.length < PAGE) break
  }

  // Агрегация спроса по item_id.
  type DemandAgg = { total: number; last14: number; prev14: number; revenue: number }
  const demandByItem = new Map<string, DemandAgg>()
  let revenueLastWeekWindow = 0 // выручка за последние 7 дней (для % от выручки в AI)
  const since7 = new Date(today.getTime() - 7 * DAY_MS).toISOString()
  for (const row of sales) {
    const itemId = String(row.item_id || '')
    if (!itemId) continue
    const qty = Number(row.quantity || 0)
    if (!(qty > 0)) continue
    const createdAt = String(row.created_at || '')
    const amount = Number(row.total_amount || 0)
    const agg = demandByItem.get(itemId) || { total: 0, last14: 0, prev14: 0, revenue: 0 }
    agg.total += qty
    agg.revenue += amount
    if (createdAt >= since14) agg.last14 += qty
    else if (createdAt >= since28for14) agg.prev14 += qty
    demandByItem.set(itemId, agg)
    if (createdAt >= since7) revenueLastWeekWindow += amount
  }

  const itemIds = Array.from(demandByItem.keys())
  if (itemIds.length === 0) {
    return { company_id: companyId, weekStart, generatedAt, total: 0, revenue4wPerWeek: round2(revenueLastWeekWindow), bySupplier: [], doNotBuy: [] }
  }

  // 3. Текущий остаток по точке (сумма по локациям).
  const stockByItem = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .in('location_id', locationIds)
      .in('item_id', itemIds)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data || []) as Array<{ item_id: string; quantity: number }>
    for (const b of batch) {
      const id = String(b.item_id || '')
      stockByItem.set(id, (stockByItem.get(id) || 0) + Number(b.quantity || 0))
    }
    if (batch.length < PAGE) break
  }

  // 4. Карточки товаров (name, barcode, fallback-цена, цена продажи для маржи).
  const itemInfo = new Map<string, { name: string; barcode: string; fallbackCost: number; salePrice: number }>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, default_purchase_price, sale_price')
      .in('id', chunk)
    if (error) throw error
    for (const r of data || []) {
      itemInfo.set(String(r.id), {
        name: String(r.name || ''),
        barcode: String(r.barcode || ''),
        fallbackCost: Number(r.default_purchase_price || 0),
        salePrice: Number((r as any).sale_price || 0),
      })
    }
  }

  // 4b. Размер упаковки (штук в коробке). Отдельным запросом с try/catch —
  //     если колонки ещё нет (миграция не применена), упаковки = 1 (штучно).
  const packByItem = new Map<string, number>()
  try {
    for (let i = 0; i < itemIds.length; i += 500) {
      const chunk = itemIds.slice(i, i + 500)
      const { data, error } = await supabase.from('inventory_items').select('id, pack_size').in('id', chunk)
      if (error) throw error
      for (const r of data || []) {
        const ps = Number((r as any).pack_size || 1)
        packByItem.set(String(r.id), ps > 0 ? ps : 1)
      }
    }
  } catch { /* колонки pack_size нет — считаем штучно */ }

  // 5. Последняя приёмка по каждому товару → unitCost + supplierName.
  //    receipt_items (item_id, unit_cost) join receipts (received_at, supplier).
  //    Для каждого item_id берём строку с максимальным received_at.
  const lastReceiptByItem = new Map<string, { unitCost: number; supplierName: string; receivedAt: string }>()
  for (let i = 0; i < itemIds.length; i += 300) {
    const chunk = itemIds.slice(i, i + 300)
    const { data, error } = await supabase
      .from('inventory_receipt_items')
      .select('item_id, unit_cost, receipt:receipt_id(received_at, supplier:supplier_id(name, organization_name))')
      .in('item_id', chunk)
    if (error) throw error
    for (const r of (data || []) as any[]) {
      const itemId = String(r.item_id || '')
      if (!itemId) continue
      const receipt = r.receipt || {}
      const receivedAt = String(receipt.received_at || '')
      const prev = lastReceiptByItem.get(itemId)
      if (prev && prev.receivedAt >= receivedAt) continue
      const supplier = receipt.supplier || {}
      const supplierName =
        String(supplier.organization_name || '').trim() ||
        String(supplier.name || '').trim() ||
        '—'
      lastReceiptByItem.set(itemId, {
        unitCost: Number(r.unit_cost || 0),
        supplierName,
        receivedAt,
      })
    }
  }

  // 6. Расчёт и группировка по поставщикам.
  const groups = new Map<string, PurchasePlanLine[]>()
  const doNotBuy: PurchasePlanSkip[] = []
  for (const itemId of itemIds) {
    const agg = demandByItem.get(itemId)!
    const weeklyDemand = agg.total / 4
    const target = weeklyDemand * 2 // запас на 2 недели
    const stock = stockByItem.get(itemId) || 0
    // Округляем заказ ДО ЦЕЛЫХ УПАКОВОК (закупаешь коробками, не штуками).
    const packSize = packByItem.get(itemId) || 1
    const packs = Math.ceil(Math.max(0, target - stock) / packSize)
    const order = packs * packSize
    const info = itemInfo.get(itemId)
    // На сколько недель хватит текущего остатка.
    const coverageWeeks = weeklyDemand > 0 ? round1(stock / weeklyDemand) : stock > 0 ? 99 : 0

    if (order <= 0) {
      // Затоварено: остатка хватит надолго (>4 нед при наличии спроса) → «не бери».
      if (weeklyDemand > 0 && coverageWeeks > 4) {
        doNotBuy.push({ item_id: itemId, name: info?.name || '—', stock: round2(stock), weeklyDemand: round2(weeklyDemand), coverageWeeks })
      }
      continue
    }

    const receipt = lastReceiptByItem.get(itemId)
    const unitCost = receipt ? receipt.unitCost : info?.fallbackCost || 0
    const supplierName = receipt ? receipt.supplierName : '—'
    const amount = order * unitCost
    const salePrice = info?.salePrice || 0
    const marginPct = salePrice > 0 ? round1(((salePrice - unitCost) / salePrice) * 100) : 0

    // Тренд: последние 14 vs предыдущие 14 дней.
    const trendPct =
      agg.prev14 > 0
        ? round1(((agg.last14 - agg.prev14) / agg.prev14) * 100)
        : agg.last14 > 0
        ? 100
        : 0

    const line: PurchasePlanLine = {
      item_id: itemId,
      name: info?.name || '—',
      barcode: info?.barcode || '',
      weeklyDemand: round2(weeklyDemand),
      trendPct,
      stock: round2(stock),
      order,
      unitCost: round2(unitCost),
      amount: round2(amount),
      salePrice: round2(salePrice),
      marginPct,
      coverageWeeks,
      wasOutOfStock: stock <= 0,
      packSize: round2(packSize),
      packs,
    }
    const list = groups.get(supplierName) || []
    list.push(line)
    groups.set(supplierName, list)
  }
  // Самые затоваренные сверху, не больше 30.
  doNotBuy.sort((a, b) => b.coverageWeeks - a.coverageWeeks)
  doNotBuy.splice(30)

  const bySupplier: PurchasePlanSupplierGroup[] = Array.from(groups.entries())
    .map(([supplier, items]) => {
      items.sort((a, b) => b.amount - a.amount)
      const total = round2(items.reduce((s, it) => s + it.amount, 0))
      return { supplier, total, items }
    })
    .sort((a, b) => b.total - a.total)

  const total = round2(bySupplier.reduce((s, g) => s + g.total, 0))

  return {
    company_id: companyId,
    weekStart,
    generatedAt,
    total,
    revenue4wPerWeek: round2(revenueLastWeekWindow),
    bySupplier,
    doNotBuy,
  }
}
