import type { SupabaseClient } from '@supabase/supabase-js'

import { sanitizeOrFilterValue } from '@/lib/server/postgrest-filter'

type AnySupabase = SupabaseClient<any, 'public', any>

export type InventoryScope = {
  organizationId?: string | null
  allowedCompanyIds?: string[] | null
  isSuperAdmin?: boolean
  /** Целевая точка (магазин) для СОЗДАНИЯ каталожных строк (товар/категория/
   *  поставщик). Каталог по точке: новая строка принадлежит выбранной точке. */
  companyId?: string | null
}

export type InventoryOverview = {
  categories: any[]
  suppliers: any[]
  items: any[]
  locations: any[]
  balances: any[]
  receipts: any[]
  requests: any[]
  writeoffs: any[]
  stocktakes: any[]
  movements: any[]
  companies: any[]
}

export type StoreAnalyticsData = {
  locations: any[]
  balances: any[]
  movements: any[]
}

export type StoreReceiptsData = {
  items: any[]
  suppliers: any[]
  locations: any[]
  receipts: any[]
}

export type StoreMovementsData = {
  movements: any[]
  locations: any[]
}

export type StoreWriteoffsData = {
  locations: any[]
  balances: any[]
  writeoffs: any[]
}

export type StoreRevisionsData = {
  items: any[]
  locations: any[]
  balances: any[]
  stocktakes: any[]
}

const PAGE_SIZE = 1000
const MAX_PAGES = 50

/**
 * PostgREST молча режет любой select до 1000 строк — забираем постранично
 * (.range) до первой неполной страницы. buildQuery обязан включать .order()
 * с детерминированной сортировкой (уникальный tiebreaker), иначе страницы
 * могут пересекаться. Возвращает { data, error } для совместимости
 * с деструктуризацией в Promise.all.
 */
async function fetchAllPagesResult(
  buildQuery: (from: number, to: number) => any,
): Promise<{ data: any[]; error: any }> {
  const out: any[] = []
  // Предохранитель: если выборка вдруг перестанет укорачиваться (например,
  // запрос без устойчивого порядка), цикл не должен крутиться вечно.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) return { data: out, error }
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return { data: out, error: null }
}

// Скоуп по орг/компаниям применяется и к суперадмину, если активная орг задана
// (в т.ч. host-locked субдоменом tenant'а) — иначе на castle.ordaops.kz суперадмин
// видит склады/витрины/товары чужой орг. «Всё» — только без активной орг
// (allowedCompanyIds === null / organizationId пуст = платформенный контекст).
function isRestrictedScope(scope?: InventoryScope) {
  return Boolean(scope && scope.allowedCompanyIds !== null)
}

function hasOrganizationScope(scope?: InventoryScope) {
  return Boolean(scope?.organizationId)
}

function getAllowedCompanyIdSet(scope?: InventoryScope) {
  return new Set((scope?.allowedCompanyIds || []).filter(Boolean).map((value) => String(value)))
}

function filterByOrganizationScope<T>(
  rows: T[],
  scope: InventoryScope | undefined,
  getOrganizationId: (row: T) => string | null | undefined,
) {
  if (!hasOrganizationScope(scope)) return rows
  const organizationId = String(scope?.organizationId || '')
  return rows.filter((row) => String(getOrganizationId(row) || '') === organizationId)
}

function filterByCompanyScope<T>(
  rows: T[],
  scope: InventoryScope | undefined,
  getCompanyIds: (row: T) => Array<string | null | undefined>,
) {
  if (!isRestrictedScope(scope)) return rows
  const allowed = getAllowedCompanyIdSet(scope)
  if (allowed.size === 0) return []
  return rows.filter((row) => {
    const ids = getCompanyIds(row)
    // Строки БЕЗ company_id (орг-общие / легаси / глобальные локации-склады) —
    // видны везде в орг (и в «Общем», и в конкретной точке). Иначе легаси-данные
    // пропадали бы из пикеров, хотя их сток есть в журналах.
    if (ids.every((id) => !id)) return true
    return ids.some((companyId) => companyId && allowed.has(String(companyId)))
  })
}

function filterByLocationScope<T>(
  rows: T[],
  scope: InventoryScope | undefined,
  getLocation: (row: T) => { organization_id?: string | null; company_id?: string | null } | null | undefined,
) {
  if (!isRestrictedScope(scope)) return rows
  const allowed = getAllowedCompanyIdSet(scope)
  const organizationId = String(scope?.organizationId || '')
  return rows.filter((row) => {
    const location = getLocation(row)
    if (!location) return false
    // Привязана к точке → строго в разрешённом наборе точек (при выбранной точке
    // = только она; «Общий» = все точки орг). Раньше org-байпас пропускал любую
    // локацию орг — из-за этого журналы/дропдауны показывали чужие точки.
    if (location.company_id) return allowed.has(String(location.company_id))
    // Локация без company_id (орг-уровень) → по орг.
    if (location.organization_id && organizationId) return String(location.organization_id) === organizationId
    return false
  })
}

function filterByMovementScope(rows: any[], scope?: InventoryScope) {
  return filterByLocationScope(rows, scope, (row: any) => {
    const fromLocation = Array.isArray(row.from_location) ? row.from_location[0] || null : row.from_location || null
    const toLocation = Array.isArray(row.to_location) ? row.to_location[0] || null : row.to_location || null
    return fromLocation || toLocation
  })
}

function applyOrganizationFilter(query: any, scope?: InventoryScope) {
  if (hasOrganizationScope(scope)) {
    return query.eq('organization_id', String(scope?.organizationId || ''))
  }
  return query
}

export async function ensureInventoryCompanyAccess(
  supabase: AnySupabase,
  companyId: string,
  scope?: InventoryScope,
) {
  if (!isRestrictedScope(scope)) return
  const allowed = getAllowedCompanyIdSet(scope)
  if (!allowed.has(String(companyId))) {
    throw new Error('forbidden-company')
  }
}

export async function ensureInventoryLocationAccess(
  supabase: AnySupabase,
  locationId: string,
  scope?: InventoryScope,
) {
  if (!isRestrictedScope(scope)) return

  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, company_id, organization_id')
    .eq('id', locationId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('inventory-location-not-found')

  const organizationId = String(scope?.organizationId || '')
  const allowed = getAllowedCompanyIdSet(scope)

  // Локация ПРИВЯЗАНА к точке → должна входить в разрешённый набор точек.
  // При выбранной точке allowedCompanyIds=[точка] → запись строго в неё; в
  // режиме «Общий» allowed=все точки орг → любая своя локация. Так приёмка/
  // списание/оприходование не запишутся в чужую точку даже прямым API-запросом.
  if (data.company_id) {
    if (allowed.has(String(data.company_id))) return
    throw new Error('forbidden-location')
  }

  // Локация без company_id (орг-уровень) — разрешаем по принадлежности орг.
  if (data.organization_id && organizationId && String(data.organization_id) === organizationId) {
    return
  }

  throw new Error('forbidden-location')
}

export async function fetchOpenTransferRequestsForLocation(
  supabase: AnySupabase,
  locationId: string,
  scope?: InventoryScope,
) {
  const normalizedLocationId = String(locationId || '').trim()
  if (!normalizedLocationId) return []

  const { data, error } = await supabase
    .from('inventory_requests')
    .select('id, status, created_at, source_location_id, target_location_id, requesting_company_id, company:requesting_company_id(id, name, code), source_location:source_location_id(id, name, code, location_type, company_id, organization_id), target_location:target_location_id(id, name, code, location_type, company_id, organization_id)')
    .in('status', ['approved_full', 'approved_partial', 'issued'])
    .or(`source_location_id.eq.${normalizedLocationId},target_location_id.eq.${normalizedLocationId}`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return filterByCompanyScope(mapNestedRows(data || []), scope, (row: any) => [
    row.requesting_company_id,
    row.company?.id,
    row.source_location?.company_id,
    row.target_location?.company_id,
  ])
}

export async function ensureInventoryRequestAccess(
  supabase: AnySupabase,
  requestId: string,
  scope?: InventoryScope,
) {
  if (!isRestrictedScope(scope)) return

  const { data, error } = await supabase
    .from('inventory_requests')
    .select('id, requesting_company_id')
    .eq('id', requestId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('inventory-request-not-found')

  await ensureInventoryCompanyAccess(supabase, String(data.requesting_company_id), scope)
}

export async function fetchInventoryRequests(supabase: AnySupabase, scope?: InventoryScope) {
  const { data, error } = await supabase
    .from('inventory_requests')
    .select('id, source_location_id, target_location_id, requesting_company_id, status, comment, decision_comment, created_by, approved_by, approved_at, issued_by, issued_at, received_by, received_at, received_qty_confirmed, created_at, updated_at, source_location:source_location_id(id, name, code, location_type), target_location:target_location_id(id, name, code, location_type), company:requesting_company_id(id, name, code), items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return filterByCompanyScope(mapNestedRows(data || []), scope, (row: any) => [row.requesting_company_id, row.company?.id])
}

export type StoreSearchResult = {
  type: 'item' | 'request' | 'receipt' | 'writeoff'
  title: string
  subtitle: string
  href: string
  score: number
}

/**
 * Поиск по магазину для строки в шапке модуля.
 *
 * ПОЧЕМУ так: раньше поиск дёргал общую выборку магазина — на каждое нажатие
 * клавиши читались весь каталог и вся таблица остатков, а фильтрация шла в Node,
 * при том что остатки поиску вообще не нужны. Здесь ищет БД: ilike + limit
 * по каждой сущности.
 */
export async function searchStore(
  supabase: AnySupabase,
  scope: InventoryScope | undefined,
  rawQuery: string,
): Promise<StoreSearchResult[]> {
  const q = String(rawQuery || '').trim().toLowerCase()
  if (!q) return []
  const safe = sanitizeOrFilterValue(q)
  if (!safe) return []

  const { data: locationRows, error: locationsError } = await applyOrganizationFilter(
    supabase.from('inventory_locations').select('id, company_id, organization_id, name').eq('is_active', true),
    scope,
  )
  if (locationsError) throw locationsError
  const locationIds = filterByCompanyScope(locationRows || [], scope, (row: any) => [row.company_id]).map(
    (row: any) => String(row.id),
  )

  const requestsQuery = () => {
    let query = supabase
      .from('inventory_requests')
      .select('id, status, requesting_company_id, company:requesting_company_id(id, name)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (isRestrictedScope(scope)) {
      const allowed = Array.from(getAllowedCompanyIdSet(scope))
      if (allowed.length === 0) return null
      query = query.in('requesting_company_id', allowed)
    }
    return query
  }
  const requestsPromise = requestsQuery()

  const [items, requests, receipts, writeoffs] = await Promise.all([
    applyOrganizationFilter(
      supabase
        .from('inventory_items')
        .select('id, name, barcode')
        .eq('is_active', true)
        .or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`)
        .order('name')
        .limit(10),
      scope,
    ),
    requestsPromise || Promise.resolve({ data: [], error: null }),
    locationIds.length
      ? supabase
          .from('inventory_receipts')
          .select('id, invoice_number, supplier:supplier_id(id, name)')
          .in('location_id', locationIds)
          .ilike('invoice_number', `%${safe}%`)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    locationIds.length
      ? supabase
          .from('inventory_writeoffs')
          .select('id, reason, location:location_id(id, name)')
          .in('location_id', locationIds)
          .ilike('reason', `%${safe}%`)
          .order('written_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (items.error) throw items.error
  if (requests.error) throw requests.error
  if (receipts.error) throw receipts.error
  if (writeoffs.error) throw writeoffs.error

  const results: StoreSearchResult[] = []

  for (const item of items.data || []) {
    const name = String((item as any).name || '')
    const barcode = String((item as any).barcode || '')
    results.push({
      type: 'item',
      title: name || 'Товар',
      subtitle: barcode || 'Без штрихкода',
      href: `/store/warehouse?q=${encodeURIComponent(barcode || name)}`,
      score: barcode === q ? 100 : barcode.startsWith(q) ? 90 : name.toLowerCase().startsWith(q) ? 80 : 70,
    })
  }

  for (const row of mapNestedRows((requests.data || []) as any[])) {
    const requestId = String(row.id || '')
    const companyName = String(row.company?.name || '')
    const status = String(row.status || '')
    if (!`${requestId} ${companyName} ${status}`.toLowerCase().includes(q)) continue
    results.push({
      type: 'request',
      title: `Заявка ${requestId.slice(0, 8)}`,
      subtitle: `${companyName || 'Точка'} · ${status}`,
      href: `/store/requests?q=${encodeURIComponent(requestId)}`,
      score: requestId.includes(q) ? 95 : 65,
    })
  }

  for (const row of mapNestedRows((receipts.data || []) as any[])) {
    const id = String(row.id || '')
    const invoice = String(row.invoice_number || '')
    results.push({
      type: 'receipt',
      title: `Приемка ${invoice || id.slice(0, 8)}`,
      subtitle: String(row.supplier?.name || 'Без поставщика'),
      href: `/store/receipts?q=${encodeURIComponent(invoice || id)}`,
      score: invoice.toLowerCase() === q ? 92 : 62,
    })
  }

  for (const row of mapNestedRows((writeoffs.data || []) as any[])) {
    const id = String(row.id || '')
    const reason = String(row.reason || '')
    results.push({
      type: 'writeoff',
      title: `Списание ${id.slice(0, 8)}`,
      subtitle: `${reason || 'Причина не указана'} · ${String(row.location?.name || 'Локация')}`,
      href: `/store/writeoffs?q=${encodeURIComponent(reason || id)}`,
      score: id.includes(q) ? 90 : 60,
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 30)
}

export type StoreOverviewLowStockRow = {
  item_id: string
  name: string
  quantity: number
  threshold: number
  location_name: string | null
}

export type StoreOverviewMetrics = {
  pendingRequests: number
  disputedRequests: number
  showcases: number
  receipts: number
  unresolvedWriteoffs: number
  lowStock: number
  lowStockTop: StoreOverviewLowStockRow[]
}

const EMPTY_STORE_METRICS: StoreOverviewMetrics = {
  pendingRequests: 0,
  disputedRequests: 0,
  showcases: 0,
  receipts: 0,
  unresolvedWriteoffs: 0,
  lowStock: 0,
  lowStockTop: [],
}

/**
 * Счётчики для обзора магазина.
 *
 * ПОЧЕМУ только счётчики: прошлая версия ради шести чисел читала inventory_items
 * и inventory_balances целиком — балансы вообще без фильтра по точке, изоляция
 * делалась уже в Node. Здесь каждый счётчик считает сервер БД
 * (count: 'exact', head: true), а строки читаются только там, где иначе нельзя:
 * низкий остаток сравнивает количество с порогом товара, и только по товарам,
 * у которых порог вообще задан.
 */
export async function fetchStoreOverviewMetrics(
  supabase: AnySupabase,
  scope?: InventoryScope,
): Promise<StoreOverviewMetrics> {
  const { data: locationRows, error: locationsError } = await applyOrganizationFilter(
    supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, location_type')
      .eq('is_active', true),
    scope,
  )
  if (locationsError) throw locationsError

  const locations = filterByCompanyScope(locationRows || [], scope, (row: any) => [row.company_id])
  const locationIds = locations.map((row: any) => String(row.id))
  if (locationIds.length === 0) return EMPTY_STORE_METRICS

  const locationNameById = new Map<string, string>(
    locations.map((row: any) => [String(row.id), String(row.name || '')]),
  )
  const showcases = locations.filter((row: any) => row.location_type === 'point_display').length

  const countRequests = async (status: string): Promise<{ count: number | null; error: any }> => {
    let query = supabase
      .from('inventory_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    if (isRestrictedScope(scope)) {
      const allowed = Array.from(getAllowedCompanyIdSet(scope))
      if (allowed.length === 0) return { count: 0, error: null }
      query = query.in('requesting_company_id', allowed)
    }
    const { count, error } = await query
    return { count, error }
  }

  // Списания «требуют разбора» = пустая причина. Смотрим последние 90 дней:
  // разбирать имеет смысл свежие, а запрос ложится на индекс (location_id, written_at).
  const writeoffsSince = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)

  const [pending, disputed, receipts, writeoffs, thresholdItems] = await Promise.all([
    countRequests('new'),
    countRequests('disputed'),
    supabase
      .from('inventory_receipts')
      .select('id', { count: 'exact', head: true })
      .in('location_id', locationIds),
    fetchAllPagesResult((from, to) =>
      supabase
        .from('inventory_writeoffs')
        .select('id, reason')
        .in('location_id', locationIds)
        .gte('written_at', writeoffsSince)
        .order('id')
        .range(from, to),
    ),
    fetchAllPagesResult((from, to) =>
      applyOrganizationFilter(
        supabase
          .from('inventory_items')
          .select('id, name, low_stock_threshold')
          .eq('is_active', true)
          .not('low_stock_threshold', 'is', null)
          .order('id'),
        scope,
      ).range(from, to),
    ),
  ])

  if (pending.error) throw pending.error
  if (disputed.error) throw disputed.error
  if (receipts.error) throw receipts.error
  if (writeoffs.error) throw writeoffs.error
  if (thresholdItems.error) throw thresholdItems.error

  const unresolvedWriteoffs = (writeoffs.data || []).filter(
    (row: any) => !String(row.reason || '').trim(),
  ).length

  const thresholdById = new Map<string, { name: string; threshold: number }>()
  for (const item of thresholdItems.data || []) {
    thresholdById.set(String(item.id), {
      name: String(item.name || 'Товар'),
      threshold: Number(item.low_stock_threshold || 0),
    })
  }

  let lowStock = 0
  const lowStockTop: StoreOverviewLowStockRow[] = []
  if (thresholdById.size > 0) {
    const itemIds = Array.from(thresholdById.keys())
    const balances: any[] = []
    // .in() по длинному списку упирается в лимит длины URL — режем на пачки.
    for (let i = 0; i < itemIds.length; i += 200) {
      const chunk = itemIds.slice(i, i + 200)
      const { data, error } = await fetchAllPagesResult((from, to) =>
        supabase
          .from('inventory_balances')
          .select('item_id, location_id, quantity')
          .in('location_id', locationIds)
          .in('item_id', chunk)
          .order('item_id')
          .order('location_id')
          .range(from, to),
      )
      if (error) throw error
      balances.push(...(data || []))
    }

    // Позиция считается один раз, даже если она мала и на складе, и на витрине:
    // «низкий остаток» — про товар, а не про строку баланса. Берём минимальный
    // запас по локациям, чтобы наверх всплывало самое горячее.
    const worstByItem = new Map<string, StoreOverviewLowStockRow>()
    for (const row of balances) {
      const meta = thresholdById.get(String(row.item_id))
      if (!meta) continue
      const quantity = Number(row.quantity || 0)
      if (quantity > meta.threshold) continue
      const candidate: StoreOverviewLowStockRow = {
        item_id: String(row.item_id),
        name: meta.name,
        quantity,
        threshold: meta.threshold,
        location_name: locationNameById.get(String(row.location_id)) || null,
      }
      const current = worstByItem.get(candidate.item_id)
      if (!current || candidate.quantity < current.quantity) worstByItem.set(candidate.item_id, candidate)
    }

    lowStock = worstByItem.size
    lowStockTop.push(
      ...Array.from(worstByItem.values())
        .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'ru'))
        .slice(0, 10),
    )
  }

  return {
    pendingRequests: Number(pending.count || 0),
    disputedRequests: Number(disputed.count || 0),
    showcases,
    receipts: Number(receipts.count || 0),
    unresolvedWriteoffs,
    lowStock,
    lowStockTop,
  }
}

const LOCATION_SCOPE_TABLE = 'inventory_locations'
const NEVER_MATCH_UUID = '00000000-0000-0000-0000-000000000000'
// Больше двух сотен id в .in() — это уже длина URL, на которой шлюз обрывает
// запрос. У арендатора локаций единицы (склад + витрина на точку), так что
// предел упирается только в платформенный контекст суперадмина без орг.
const MAX_LOCATION_IDS_IN_FILTER = 200

/**
 * Id локаций, видимых в скоупе. `null` — фильтровать по локациям нельзя
 * (платформенный контекст либо слишком длинный список), запрос идёт как раньше,
 * а изоляцию доделывает filterByLocationScope в приложении.
 *
 * ЗАЧЕМ: выборки остатков читали `inventory_balances` целиком — всю таблицу
 * всех арендаторов — и отфильтровывали чужое уже в Node. Со списком локаций
 * фильтр уезжает в БД, и запрос ложится на индекс.
 */
async function resolveScopeLocationIds(
  supabase: AnySupabase,
  scope?: InventoryScope,
): Promise<string[] | null> {
  if (!isRestrictedScope(scope)) return null

  const { data, error } = await applyOrganizationFilter(
    supabase.from(LOCATION_SCOPE_TABLE).select('id, company_id, organization_id'),
    scope,
  )
  if (error) throw error

  const allowed = filterByCompanyScope(data || [], scope, (row: any) => [row.company_id])
  const ids = allowed.map((row: any) => String(row.id))
  return ids.length > MAX_LOCATION_IDS_IN_FILTER ? null : ids
}

/** Применить фильтр по локациям, если он вычислился. */
function withLocationFilter(query: any, locationIds: string[] | null) {
  if (locationIds === null) return query
  // Пустой список — «видно ноль локаций» (орг без склада, пользователь без
  // точек). `.in()` с пустым массивом PostgREST разбирает непредсказуемо,
  // поэтому кладём заведомо несуществующий id: fail-closed, а не «всё подряд».
  if (locationIds.length === 0) return query.in('location_id', [NEVER_MATCH_UUID])
  return query.in('location_id', locationIds)
}

export async function fetchStoreAnalytics(
  supabase: AnySupabase,
  scope?: InventoryScope,
  options?: { days?: number },
): Promise<StoreAnalyticsData> {
  // Окно движений по дате (Сегодня/Неделя/Месяц). days<=0 или undefined → всё время.
  const days = Number(options?.days || 0)
  const sinceIso = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null
  const locationIds = await resolveScopeLocationIds(supabase, scope)
  const [
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    fetchAllPagesResult((from, to) =>
      withLocationFilter(
        supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, low_stock_threshold), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
          .gt('quantity', 0)
          .order('updated_at', { ascending: false })
          .order('location_id', { ascending: true })
          .order('item_id', { ascending: true }),
        locationIds,
      ).range(from, to),
    ),
    fetchAllPagesResult((from, to) => {
      let q = supabase
        .from('inventory_movements')
        .select('id, movement_type, quantity, total_amount, created_at, item:item_id(id, name, barcode, unit), from_location:from_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
        .order('created_at', { ascending: false })
      if (sinceIso) q = q.gte('created_at', sinceIso)
      return q.range(from, to)
    }),
  ])

  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (movementsError) throw movementsError

  return {
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    movements: filterByMovementScope(mapNestedRows(movements || []), scope),
  }
}

export async function fetchStoreReceipts(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreReceiptsData> {
  const buildItemsQuery = () => {
    let itemsQuery: any = supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, sale_price, default_purchase_price, item_type, requires_expiry, category:category_id(id, name), organization_id, company_id')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
    if (hasOrganizationScope(scope)) {
      const orgId = String(scope?.organizationId || '')
      // Keep legacy shared catalog rows (organization_id is null) visible to org-scoped managers.
      itemsQuery = itemsQuery.or(`organization_id.eq.${orgId},organization_id.is.null`)
    }
    return itemsQuery
  }

  const [
    { data: items, error: itemsError },
    { data: suppliers, error: suppliersError },
    { data: locations, error: locationsError },
    { data: receipts, error: receiptsError },
  ] = await Promise.all([
    fetchAllPagesResult((from, to) => buildItemsQuery().range(from, to)),
    applyOrganizationFilter(supabase.from('inventory_suppliers').select('*').order('name', { ascending: true }), scope),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .in('location_type', ['warehouse', 'point_display'])
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_receipts')
      .select('id, location_id, supplier_id, received_at, invoice_number, invoice_file_url, comment, total_amount, status, kind, cancelled_at, cancel_reason, created_at, location:location_id(id, name, code, location_type, organization_id, company_id), supplier:supplier_id(id, name, bin_iin, organization_name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, is_bonus, comment, production_date, expiry_date, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  if (itemsError) throw itemsError
  if (suppliersError) throw suppliersError
  if (locationsError) throw locationsError
  if (receiptsError) throw receiptsError

  return {
    items: filterByCompanyScope(mapNestedRows(items || []), scope, (row: any) => [row.company_id]),
    suppliers: filterByCompanyScope((suppliers || []) as any[], scope, (row: any) => [row.company_id]),
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    receipts: filterByLocationScope(mapNestedRows(receipts || []), scope, (row: any) => row.location),
  }
}

export async function fetchStoreMovements(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreMovementsData> {
  const [{ data: movements, error: movementsError }, { data: locations, error: locationsError }] = await Promise.all([
    supabase
      .from('inventory_movements')
      .select('id, movement_type, quantity, unit_cost, total_amount, reference_type, comment, created_at, item:item_id(id, name, barcode, unit), from_location:from_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('created_at', { ascending: false })
      .limit(160),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
  ])

  if (movementsError) throw movementsError
  if (locationsError) throw locationsError

  return {
    movements: filterByMovementScope(mapNestedRows(movements || []), scope),
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
  }
}

export async function fetchStoreWriteoffs(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreWriteoffsData> {
  const locationIds = await resolveScopeLocationIds(supabase, scope)
  // Каталога здесь нет намеренно: списывают только то, что лежит на локации,
  // и страница выбирает позицию из balances. Полный каталог активных товаров
  // уезжал клиенту на каждое открытие «Списаний» и ни разу не читался.
  const [
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: writeoffs, error: writeoffsError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .in('location_type', ['warehouse', 'point_display'])
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    fetchAllPagesResult((from, to) =>
      withLocationFilter(
        supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, item_type), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
          .gt('quantity', 0)
          .order('updated_at', { ascending: false })
          .order('location_id', { ascending: true })
          .order('item_id', { ascending: true }),
        locationIds,
      ).range(from, to),
    ),
    supabase
      .from('inventory_writeoffs')
      .select('id, location_id, written_at, reason, comment, total_amount, status, cancelled_at, cancel_reason, created_at, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_writeoff_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (writeoffsError) throw writeoffsError

  return {
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    writeoffs: filterByLocationScope(mapNestedRows(writeoffs || []), scope, (row: any) => row.location),
  }
}

/**
 * Что показывать из архива ревизий.
 *
 * `active` — обычный список (всё, кроме убранного в архив).
 * `archived` — только архив.
 * `all` — и то и другое.
 *
 * Архив разрешён только суперадминистратору, и решается это в роуте: сюда
 * приходит уже готовый режим.
 */
export type RevisionArchiveMode = 'active' | 'archived' | 'all'

/**
 * Убран ли акт в архив.
 *
 * Проверка живёт в одном месте, потому что до применения миграции колонки
 * archived_at в базе ещё нет: тогда поле приходит как undefined, и акт
 * считается живым. Так страница «Документы» не падает в промежутке между
 * выкладкой кода и накатом миграции.
 */
function isArchivedRevision(row: any): boolean {
  return Boolean(row?.archived_at)
}

export async function fetchStoreRevisions(
  supabase: AnySupabase,
  scope?: InventoryScope,
  options?: { archive?: RevisionArchiveMode },
): Promise<StoreRevisionsData> {
  const locationIds = await resolveScopeLocationIds(supabase, scope)
  const [
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: stocktakes, error: stocktakesError },
  ] = await Promise.all([
    fetchAllPagesResult((from, to) =>
      applyOrganizationFilter(
        supabase
        .from('inventory_items')
        .select('id, name, barcode, unit, item_type, is_active, company_id, category:category_id(id, name)')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .order('id', { ascending: true }),
        scope,
      ).range(from, to),
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .in('location_type', ['warehouse', 'point_display'])
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    fetchAllPagesResult((from, to) =>
      withLocationFilter(
        supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, item_type), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
          .order('updated_at', { ascending: false })
          .order('location_id', { ascending: true })
          .order('item_id', { ascending: true }),
        locationIds,
      ).range(from, to),
    ),
    supabase
      .from('inventory_stocktakes')
      // Звёздочка, а не список колонок: поля архива появляются только после
      // миграции, и явное перечисление уронило бы запрос до её наката.
      .select('*, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_stocktake_items(id, item_id, expected_qty, actual_qty, delta_qty, comment, item:item_id(id, name, barcode, unit, sale_price, default_purchase_price))')
      .order('created_at', { ascending: false })
      .limit(120),
  ])

  if (itemsError) throw itemsError
  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (stocktakesError) throw stocktakesError

  return {
    items: filterByCompanyScope(mapNestedRows(items || []), scope, (row: any) => [row.company_id]),
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    stocktakes: filterByLocationScope(mapNestedRows(stocktakes || []), scope, (row: any) => row.location).filter(
      (row: any) => {
        const archive = options?.archive || 'active'
        if (archive === 'all') return true
        return archive === 'archived' ? isArchivedRevision(row) : !isArchivedRevision(row)
      },
    ),
  }
}

export async function fetchInventoryOverview(supabase: AnySupabase, scope?: InventoryScope): Promise<InventoryOverview> {
  const locationIds = await resolveScopeLocationIds(supabase, scope)
  const [
    { data: categories, error: categoriesError },
    { data: suppliers, error: suppliersError },
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: receipts, error: receiptsError },
    { data: requests, error: requestsError },
    { data: writeoffs, error: writeoffsError },
    { data: stocktakes, error: stocktakesError },
    { data: movements, error: movementsError },
    { data: companies, error: companiesError },
  ] = await Promise.all([
    applyOrganizationFilter(supabase.from('inventory_categories').select('*').order('name', { ascending: true }), scope),
    applyOrganizationFilter(supabase.from('inventory_suppliers').select('*').order('name', { ascending: true }), scope),
    fetchAllPagesResult((from, to) =>
      applyOrganizationFilter(
        supabase
        .from('inventory_items')
        .select('id, name, barcode, organization_id, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)')
        .order('name', { ascending: true })
        .order('id', { ascending: true }),
        scope,
      ).range(from, to),
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, created_at, updated_at, company:company_id(id, name, code)')
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    fetchAllPagesResult((from, to) =>
      withLocationFilter(
        supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
          .order('updated_at', { ascending: false })
          .order('location_id', { ascending: true })
          .order('item_id', { ascending: true }),
        locationIds,
      ).range(from, to),
    ),
    supabase
      .from('inventory_receipts')
      .select('id, location_id, supplier_id, received_at, invoice_number, invoice_file_url, comment, total_amount, status, created_by, created_at, location:location_id(id, name, code, location_type, company_id, organization_id), supplier:supplier_id(id, name, bin_iin, organization_name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_requests')
      .select('id, source_location_id, target_location_id, requesting_company_id, status, comment, decision_comment, created_by, approved_by, approved_at, created_at, updated_at, source_location:source_location_id(id, name, code, location_type, organization_id), target_location:target_location_id(id, name, code, location_type, organization_id), company:requesting_company_id(id, name, code), items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_writeoffs')
      .select('id, location_id, written_at, reason, comment, total_amount, created_by, created_at, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_writeoff_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_stocktakes')
      .select('*, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_stocktake_items(id, item_id, expected_qty, actual_qty, delta_qty, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_movements')
      .select('id, item_id, movement_type, from_location_id, to_location_id, quantity, unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id, created_at, item:item_id(id, name, barcode), from_location:from_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('created_at', { ascending: false })
      .limit(300),
    scope?.allowedCompanyIds === null || !scope?.allowedCompanyIds
      ? supabase.from('companies').select('id, name, code').order('name', { ascending: true })
      : scope.allowedCompanyIds.length > 0
        ? supabase.from('companies').select('id, name, code').in('id', scope.allowedCompanyIds).order('name', { ascending: true })
        : Promise.resolve({ data: [], error: null } as const),
  ])

  if (categoriesError) throw categoriesError
  if (suppliersError) throw suppliersError
  if (itemsError) throw itemsError
  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (receiptsError) throw receiptsError
  if (requestsError) throw requestsError
  if (writeoffsError) throw writeoffsError
  if (stocktakesError) throw stocktakesError
  if (movementsError) throw movementsError
  if (companiesError) throw companiesError

  return {
    categories: filterByOrganizationScope(mapNestedRows(categories || []), scope, (row: any) => row.organization_id),
    suppliers: filterByOrganizationScope((suppliers || []) as any[], scope, (row: any) => row.organization_id),
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    receipts: filterByLocationScope(mapNestedRows(receipts || []), scope, (row: any) => row.location),
    requests: filterByCompanyScope(mapNestedRows(requests || []), scope, (row: any) => [row.requesting_company_id, row.company?.id]),
    writeoffs: filterByLocationScope(mapNestedRows(writeoffs || []), scope, (row: any) => row.location),
    // В общем обзоре архива нет вовсе: там смотрят, что происходит на складе,
    // а не разбирают убранные акты. Архив живёт только на своей странице.
    stocktakes: filterByLocationScope(mapNestedRows(stocktakes || []), scope, (row: any) => row.location).filter(
      (row: any) => !isArchivedRevision(row),
    ),
    movements: filterByMovementScope(mapNestedRows(movements || []), scope),
    companies: Array.isArray(companies) ? [...companies] : [],
  }
}

export async function createInventoryCategory(
  supabase: AnySupabase,
  payload: { name: string; description?: string | null },
  scope?: InventoryScope,
) {
  const { data, error } = await supabase
    .from('inventory_categories')
    .insert([
      {
        organization_id: scope?.organizationId || null,
        company_id: scope?.companyId || null,
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
      },
    ])
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function createInventorySupplier(
  supabase: AnySupabase,
  payload: {
    name: string
    bin_iin?: string | null
    organization_name?: string | null
    contact_name?: string | null
    phone?: string | null
    notes?: string | null
    sales_rep_name?: string | null
    sales_rep_phone?: string | null
    lead_time_days?: number | null
  },
  scope?: InventoryScope,
) {
  const { data, error } = await supabase
    .from('inventory_suppliers')
    .insert([
      {
        organization_id: scope?.organizationId || null,
        company_id: scope?.companyId || null,
        name: payload.name.trim(),
        bin_iin: payload.bin_iin?.trim() || null,
        organization_name: payload.organization_name?.trim() || null,
        contact_name: payload.contact_name?.trim() || null,
        phone: payload.phone?.trim() || null,
        notes: payload.notes?.trim() || null,
        sales_rep_name: payload.sales_rep_name?.trim() || null,
        sales_rep_phone: payload.sales_rep_phone?.trim() || null,
        lead_time_days: payload.lead_time_days != null && Number.isFinite(payload.lead_time_days)
          ? Math.max(0, Math.round(payload.lead_time_days))
          : 3,
      },
    ])
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function createInventoryItem(
  supabase: AnySupabase,
  payload: {
    name: string
    barcode: string
    category_id?: string | null
    sale_price: number
    default_purchase_price?: number
    unit?: string | null
    notes?: string | null
    item_type?: string
    low_stock_threshold?: number | null
    requires_expiry?: boolean
  },
  scope?: InventoryScope,
) {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert([
      {
        organization_id: scope?.organizationId || null,
        company_id: scope?.companyId || null,
        name: payload.name.trim(),
        barcode: payload.barcode.trim(),
        category_id: payload.category_id || null,
        sale_price: payload.sale_price,
        default_purchase_price: payload.default_purchase_price || 0,
        unit: payload.unit?.trim() || 'шт',
        notes: payload.notes?.trim() || null,
        item_type: payload.item_type || 'product',
        low_stock_threshold: payload.low_stock_threshold ?? null,
        requires_expiry: payload.requires_expiry !== false,
      },
    ])
    .select('id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)')
    .single()

  if (error) throw error
  return mapNestedRow(data)
}

export async function syncInventoryItemToPointProducts(
  supabase: AnySupabase,
  payload: {
    name: string
    barcode: string
    sale_price: number
    is_active?: boolean
  } & InventoryScope,
) {
  const normalizedBarcode = String(payload.barcode || '').trim()
  const normalizedName = String(payload.name || '').trim()
  if (!normalizedBarcode || !normalizedName) return { syncedCompanyIds: [] as string[] }

  // Изоляция (fail-closed): синк POS-каталога только в витрины СВОЕЙ орг.
  // Не суперадмин без организации → синкать некуда (иначе имя/цена товара
  // затирали бы point_products всех арендаторов с тем же штрихкодом).
  if (!payload.isSuperAdmin && !payload.organizationId) {
    return { syncedCompanyIds: [] as string[] }
  }

  let locationsQuery = supabase
    .from('inventory_locations')
    .select('company_id')
    .eq('location_type', 'point_display')
    .eq('is_active', true)
    .not('company_id', 'is', null)

  if (payload.organizationId && !payload.isSuperAdmin) {
    locationsQuery = locationsQuery.eq('organization_id', String(payload.organizationId))
  }

  const { data: locations, error: locationsError } = await locationsQuery

  if (locationsError) throw locationsError

  const companyIds = Array.from(
    new Set(
      (locations || [])
        .map((row: any) => row.company_id)
        .filter((value: string | null | undefined): value is string => !!value),
    ),
  )

  if (companyIds.length === 0) return { syncedCompanyIds: [] as string[] }

  const rows = companyIds.map((companyId) => ({
    company_id: companyId,
    name: normalizedName,
    barcode: normalizedBarcode,
    price: Math.max(0, Math.round(Number(payload.sale_price || 0))),
    is_active: payload.is_active !== false,
  }))

  const { error } = await supabase.from('point_products').upsert(rows, {
    onConflict: 'company_id,barcode',
  })

  if (error) throw error
  return { syncedCompanyIds: companyIds }
}

const POINT_PRODUCTS_UPSERT_CHUNK = 800

/**
 * Одна выборка витрин + пакетные upsert в point_products (для импорта каталога без N+1 запросов).
 */
export async function bulkSyncInventoryItemsToPointProducts(
  supabase: AnySupabase,
  items: Array<{ name: string; barcode: string; sale_price: number; is_active?: boolean }>,
  scope?: Pick<InventoryScope, 'organizationId' | 'isSuperAdmin'>,
) {
  const byBarcode = new Map<string, { name: string; barcode: string; sale_price: number; is_active: boolean }>()
  for (const it of items) {
    const barcode = String(it.barcode || '').trim()
    const name = String(it.name || '').trim()
    if (!barcode || !name) continue
    byBarcode.set(barcode, {
      name,
      barcode,
      sale_price: it.sale_price,
      is_active: it.is_active !== false,
    })
  }
  const unique = Array.from(byBarcode.values())
  if (!unique.length) return { pointProductRows: 0 }

  let locationsQuery = supabase
    .from('inventory_locations')
    .select('company_id')
    .eq('location_type', 'point_display')
    .eq('is_active', true)
    .not('company_id', 'is', null)

  if (scope?.organizationId && !scope?.isSuperAdmin) {
    locationsQuery = locationsQuery.eq('organization_id', String(scope.organizationId))
  }

  const { data: locations, error: locationsError } = await locationsQuery
  if (locationsError) throw locationsError

  const companyIds = Array.from(
    new Set(
      (locations || [])
        .map((row: any) => row.company_id)
        .filter((value: string | null | undefined): value is string => !!value),
    ),
  )
  if (!companyIds.length) return { pointProductRows: 0 }

  const rows: Array<{
    company_id: string
    name: string
    barcode: string
    price: number
    is_active: boolean
  }> = []
  for (const it of unique) {
    const price = Math.max(0, Math.round(Number(it.sale_price || 0)))
    for (const companyId of companyIds) {
      rows.push({
        company_id: companyId,
        name: it.name,
        barcode: it.barcode,
        price,
        is_active: it.is_active,
      })
    }
  }

  for (let i = 0; i < rows.length; i += POINT_PRODUCTS_UPSERT_CHUNK) {
    const slice = rows.slice(i, i + POINT_PRODUCTS_UPSERT_CHUNK)
    const { error } = await supabase.from('point_products').upsert(slice, {
      onConflict: 'company_id,barcode',
    })
    if (error) throw error
  }

  return { pointProductRows: rows.length }
}

export async function updateInventoryCategory(
  supabase: AnySupabase,
  id: string,
  payload: { name: string; description?: string | null },
  scope?: InventoryScope,
) {
  let query: any = supabase
    .from('inventory_categories')
    .update({ name: payload.name.trim(), description: payload.description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (hasOrganizationScope(scope)) query = query.eq('organization_id', String(scope?.organizationId || ''))
  query = query.select('*').single()
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function deleteInventoryCategory(
  supabase: AnySupabase,
  id: string,
  scope?: InventoryScope,
) {
  // FK inventory_items.category_id — on delete set null: товары остаются «Без категории»
  let query: any = supabase.from('inventory_categories').delete().eq('id', id)
  if (hasOrganizationScope(scope)) query = query.eq('organization_id', String(scope?.organizationId || ''))
  const { error } = await query
  if (error) throw error
}

export async function updateInventorySupplier(
  supabase: AnySupabase,
  id: string,
  payload: {
    name: string
    bin_iin?: string | null
    organization_name?: string | null
    contact_name?: string | null
    phone?: string | null
    notes?: string | null
    sales_rep_name?: string | null
    sales_rep_phone?: string | null
    lead_time_days?: number | null
  },
  scope?: InventoryScope,
) {
  let query: any = supabase
    .from('inventory_suppliers')
    .update({
      name: payload.name.trim(),
      bin_iin: payload.bin_iin?.trim() || null,
      organization_name: payload.organization_name?.trim() || null,
      contact_name: payload.contact_name?.trim() || null,
      phone: payload.phone?.trim() || null,
      notes: payload.notes?.trim() || null,
      sales_rep_name: payload.sales_rep_name?.trim() || null,
      sales_rep_phone: payload.sales_rep_phone?.trim() || null,
      lead_time_days: payload.lead_time_days != null && Number.isFinite(payload.lead_time_days)
        ? Math.max(0, Math.round(payload.lead_time_days))
        : 3,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (hasOrganizationScope(scope)) query = query.eq('organization_id', String(scope?.organizationId || ''))
  query = query.select('*').single()
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateInventoryItem(
  supabase: AnySupabase,
  id: string,
  payload: {
    name: string
    barcode: string
    category_id?: string | null
    sale_price: number
    default_purchase_price?: number
    unit?: string | null
    notes?: string | null
    item_type?: string
    low_stock_threshold?: number | null
  },
  scope?: InventoryScope,
) {
  let query: any = supabase
    .from('inventory_items')
    .update({
      name: payload.name.trim(),
      barcode: payload.barcode.trim(),
      category_id: payload.category_id || null,
      sale_price: payload.sale_price,
      default_purchase_price: payload.default_purchase_price || 0,
      unit: payload.unit?.trim() || 'шт',
      notes: payload.notes?.trim() || null,
      item_type: payload.item_type || 'product',
      updated_at: new Date().toISOString(),
      low_stock_threshold: payload.low_stock_threshold ?? null,
    })
    .eq('id', id)
  if (hasOrganizationScope(scope)) query = query.eq('organization_id', String(scope?.organizationId || ''))
  query = query.select('id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)').single()
  const { data, error } = await query
  if (error) throw error
  return mapNestedRow(data)
}

export async function postInventoryReceipt(
  supabase: AnySupabase,
  payload: {
    location_id: string
    received_at: string
    supplier_id?: string | null
    invoice_number?: string | null
    invoice_file_url?: string | null
    comment?: string | null
    created_by?: string | null
    items: Array<{ item_id: string; quantity: number; unit_cost: number; is_bonus?: boolean; comment?: string | null; production_date?: string | null; expiry_date?: string | null }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_post_receipt', {
    p_location_id: payload.location_id,
    p_received_at: payload.received_at,
    p_supplier_id: payload.supplier_id || null,
    p_invoice_number: payload.invoice_number || null,
    p_invoice_file_url: payload.invoice_file_url || null,
    p_comment: payload.comment || null,
    p_created_by: payload.created_by || null,
    p_items: payload.items,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function createInventoryRequest(
  supabase: AnySupabase,
  payload: {
    source_location_id: string
    target_location_id: string
    requesting_company_id: string
    comment?: string | null
    created_by?: string | null
    items: Array<{ item_id: string; requested_qty: number; comment?: string | null }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_create_request', {
    p_source_location_id: payload.source_location_id,
    p_target_location_id: payload.target_location_id,
    p_requesting_company_id: payload.requesting_company_id,
    p_comment: payload.comment || null,
    p_created_by: payload.created_by || null,
    p_items: payload.items,
  })

  if (error) throw error
  return data
}

export async function decideInventoryRequest(
  supabase: AnySupabase,
  payload: {
    request_id: string
    approved: boolean
    decision_comment?: string | null
    actor_user_id?: string | null
    items?: Array<{ request_item_id: string; approved_qty: number }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_decide_request', {
    p_request_id: payload.request_id,
    p_approved: payload.approved,
    p_decision_comment: payload.decision_comment || null,
    p_actor_user_id: payload.actor_user_id || null,
    p_items: payload.items || [],
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function createPointInventorySale(
  supabase: AnySupabase,
  payload: {
    company_id: string
    location_id: string
    point_device_id?: string | null
    operator_id?: string | null
    sale_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount: number
    kaspi_amount: number
    kaspi_before_midnight_amount: number
    kaspi_after_midnight_amount: number
    comment?: string | null
    source?: string | null
    local_ref?: string | null
    items: Array<{
      item_id?: string | null
      universal_name?: string | null
      quantity: number
      unit_price: number
      comment?: string | null
    }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_create_point_sale', {
    p_company_id: payload.company_id,
    p_location_id: payload.location_id,
    p_point_device_id: payload.point_device_id || null,
    p_operator_id: payload.operator_id || null,
    p_sale_date: payload.sale_date,
    p_shift: payload.shift,
    p_payment_method: payload.payment_method,
    p_cash_amount: payload.cash_amount,
    p_kaspi_amount: payload.kaspi_amount,
    p_kaspi_before_midnight_amount: payload.kaspi_before_midnight_amount,
    p_kaspi_after_midnight_amount: payload.kaspi_after_midnight_amount,
    p_comment: payload.comment || null,
    p_source: payload.source || null,
    p_local_ref: payload.local_ref || null,
    p_items: payload.items,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function createPointInventoryReturn(
  supabase: AnySupabase,
  payload: {
    company_id: string
    location_id: string
    point_device_id?: string | null
    operator_id?: string | null
    sale_id: string
    return_date: string
    shift: 'day' | 'night'
    payment_method: 'cash' | 'kaspi' | 'mixed'
    cash_amount: number
    kaspi_amount: number
    kaspi_before_midnight_amount: number
    kaspi_after_midnight_amount: number
    comment?: string | null
    source?: string | null
    local_ref?: string | null
    // item_id = null + universal_name — возврат универсальной позиции чека
    items: Array<{ item_id: string | null; universal_name?: string | null; quantity: number; unit_price: number; comment?: string | null }>
  },
) {
  const nextArgs = {
    p_company_id: payload.company_id,
    p_location_id: payload.location_id,
    p_point_device_id: payload.point_device_id || null,
    p_operator_id: payload.operator_id || null,
    p_sale_id: payload.sale_id,
    p_return_date: payload.return_date,
    p_shift: payload.shift,
    p_payment_method: payload.payment_method,
    p_cash_amount: payload.cash_amount,
    p_kaspi_amount: payload.kaspi_amount,
    p_kaspi_before_midnight_amount: payload.kaspi_before_midnight_amount,
    p_kaspi_after_midnight_amount: payload.kaspi_after_midnight_amount,
    p_comment: payload.comment || null,
    p_source: payload.source || null,
    p_local_ref: payload.local_ref || null,
    p_items: payload.items,
  }

  let { data, error } = await supabase.rpc('inventory_create_point_return', nextArgs)

  if (error && /function .*inventory_create_point_return.*does not exist/i.test(String(error.message || ''))) {
    const fallbackArgs = {
      p_company_id: payload.company_id,
      p_location_id: payload.location_id,
      p_point_device_id: payload.point_device_id || null,
      p_operator_id: payload.operator_id || null,
      p_return_date: payload.return_date,
      p_shift: payload.shift,
      p_payment_method: payload.payment_method,
      p_cash_amount: payload.cash_amount,
      p_kaspi_amount: payload.kaspi_amount,
      p_kaspi_before_midnight_amount: payload.kaspi_before_midnight_amount,
      p_kaspi_after_midnight_amount: payload.kaspi_after_midnight_amount,
      p_comment: payload.comment || null,
      p_source: payload.source || null,
      p_local_ref: payload.local_ref || null,
      p_items: payload.items,
    }
    const fallbackResult = await supabase.rpc('inventory_create_point_return', fallbackArgs)
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function postInventoryWriteoff(
  supabase: AnySupabase,
  payload: {
    location_id: string
    written_at: string
    reason: string
    comment?: string | null
    created_by?: string | null
    items: Array<{ item_id: string; quantity: number; comment?: string | null }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_post_writeoff', {
    p_location_id: payload.location_id,
    p_written_at: payload.written_at,
    p_reason: payload.reason,
    p_comment: payload.comment || null,
    p_created_by: payload.created_by || null,
    p_items: payload.items,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function postInventoryStocktake(
  supabase: AnySupabase,
  payload: {
    location_id: string
    counted_at: string
    comment?: string | null
    created_by?: string | null
    items: Array<{ item_id: string; actual_qty: number; comment?: string | null }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_post_stocktake', {
    p_location_id: payload.location_id,
    p_counted_at: payload.counted_at,
    p_comment: payload.comment || null,
    p_created_by: payload.created_by || null,
    p_items: payload.items,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

const PLURAL_RELATION_KEYS = new Set(['items'])

function mapNestedRow<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const next: any = Array.isArray(row) ? [] : { ...row }
  for (const key of Object.keys(next)) {
    const value = next[key]
    if (Array.isArray(value)) {
      if (PLURAL_RELATION_KEYS.has(key)) {
        next[key] = value.map(mapNestedRow)
      } else {
        next[key] = value.length === 1 && value[0] && typeof value[0] === 'object' ? mapNestedRow(value[0]) : value.map(mapNestedRow)
      }
      continue
    }
    if (value && typeof value === 'object') {
      next[key] = mapNestedRow(value)
    }
  }
  return next
}

function mapNestedRows<T>(rows: T[]): T[] {
  return rows.map((row) => mapNestedRow(row))
}

export async function fetchConsumableDashboard(supabase: AnySupabase, scope?: InventoryScope) {
  const locationIds = await resolveScopeLocationIds(supabase, scope)
  const [
    { data: items, error: itemsError },
    { data: norms, error: normsError },
    { data: limits, error: limitsError },
    { data: balances, error: balancesError },
    { data: locations, error: locationsError },
    { data: companies, error: companiesError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, category_id, category:category_id(id, name)')
      .eq('item_type', 'consumable')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_consumption_norms')
      .select('id, item_id, location_id, monthly_qty, alert_days'),
    supabase
      .from('inventory_point_limits')
      .select('id, item_id, company_id, monthly_limit_qty'),
    fetchAllPagesResult((from, to) =>
      withLocationFilter(
        supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity, item:item_id(id, name), location:location_id(id, name, location_type, company_id, organization_id)')
          .gt('quantity', 0)
          .order('location_id', { ascending: true })
          .order('item_id', { ascending: true }),
        locationIds,
      ).range(from, to),
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, name, location_type, company_id, organization_id, company:company_id(id, name, code)')
      .eq('is_active', true),
      scope,
    ),
    scope?.allowedCompanyIds === null || !scope?.allowedCompanyIds
      ? supabase.from('companies').select('id, name, code').order('name', { ascending: true })
      : scope.allowedCompanyIds.length > 0
        ? supabase.from('companies').select('id, name, code').in('id', scope.allowedCompanyIds).order('name', { ascending: true })
        : Promise.resolve({ data: [], error: null } as const),
  ])

  if (itemsError) throw itemsError
  if (normsError) throw normsError
  if (limitsError) throw limitsError
  if (balancesError) throw balancesError
  if (locationsError) throw locationsError
  if (companiesError) throw companiesError

  return {
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    norms: norms || [],
    limits: filterByCompanyScope((limits || []) as any[], scope, (row: any) => [row.company_id]),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    locations: filterByCompanyScope(mapNestedRows(locations || []), scope, (row: any) => [row.company_id]),
    companies: companies || [],
  }
}

export async function upsertConsumptionNorm(
  supabase: AnySupabase,
  payload: { item_id: string; location_id: string; monthly_qty: number; alert_days?: number },
) {
  const { data, error } = await supabase
    .from('inventory_consumption_norms')
    .upsert(
      [{
        item_id: payload.item_id,
        location_id: payload.location_id,
        monthly_qty: payload.monthly_qty,
        alert_days: payload.alert_days || 14,
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'item_id,location_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function upsertPointLimit(
  supabase: AnySupabase,
  payload: { item_id: string; company_id: string; monthly_limit_qty: number },
) {
  const { data, error } = await supabase
    .from('inventory_point_limits')
    .upsert(
      [{
        item_id: payload.item_id,
        company_id: payload.company_id,
        monthly_limit_qty: payload.monthly_limit_qty,
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'item_id,company_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function issueInventoryRequest(
  supabase: AnySupabase,
  requestId: string,
  issuedBy: string | null,
) {
  const { data, error } = await supabase
    .from('inventory_requests')
    .update({ status: 'issued', issued_at: new Date().toISOString(), issued_by: issuedBy })
    .eq('id', requestId)
    .in('status', ['approved_full', 'approved_partial'])
    .select('id, status')
    .single()
  if (error) throw error
  if (!data) throw new Error('request-not-found-or-wrong-status')
  return data
}

export async function receiveInventoryRequest(
  supabase: AnySupabase,
  requestId: string,
  payload: { received_qty_confirmed: number; received_photo_url?: string | null },
) {
  const { data: request, error: fetchError } = await supabase
    .from('inventory_requests')
    .select('id, status, items:inventory_request_items(id, approved_qty)')
    .eq('id', requestId)
    .eq('status', 'issued')
    .single()
  if (fetchError) throw fetchError
  if (!request) throw new Error('request-not-found-or-not-issued')

  const totalApproved = (request.items || []).reduce((sum: number, item: any) => sum + Number(item.approved_qty || 0), 0)
  const confirmed = Number(payload.received_qty_confirmed || 0)
  const newStatus = confirmed < totalApproved * 0.95 ? 'disputed' : 'received'

  const { data, error } = await supabase
    .from('inventory_requests')
    .update({
      status: newStatus,
      received_at: new Date().toISOString(),
      received_qty_confirmed: confirmed,
      received_photo_url: payload.received_photo_url || null,
    })
    .eq('id', requestId)
    .select('id, status')
    .single()
  if (error) throw error
  return data
}
