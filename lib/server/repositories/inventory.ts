import type { SupabaseClient } from '@supabase/supabase-js'

type AnySupabase = SupabaseClient<any, 'public', any>

export type InventoryScope = {
  organizationId?: string | null
  allowedCompanyIds?: string[] | null
  isSuperAdmin?: boolean
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

export type StoreOverview = {
  items: any[]
  locations: any[]
  balances: any[]
  requests: any[]
  receipts: any[]
  movements: any[]
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
  items: any[]
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

function isRestrictedScope(scope?: InventoryScope) {
  return Boolean(scope && !scope.isSuperAdmin && scope.allowedCompanyIds !== null)
}

function hasOrganizationScope(scope?: InventoryScope) {
  return Boolean(scope?.organizationId && !scope?.isSuperAdmin)
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
  return rows.filter((row) =>
    getCompanyIds(row).some((companyId) => companyId && allowed.has(String(companyId))),
  )
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
    if (location.organization_id && organizationId) {
      return String(location.organization_id) === organizationId
    }
    return location.company_id ? allowed.has(String(location.company_id)) : false
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
  if (data.organization_id && organizationId && String(data.organization_id) === organizationId) {
    return
  }

  if (data.company_id && allowed.has(String(data.company_id))) {
    return
  }

  throw new Error('forbidden-location')
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
    .select('id, source_location_id, target_location_id, requesting_company_id, status, comment, decision_comment, created_by, approved_by, approved_at, created_at, updated_at, source_location:source_location_id(id, name, code, location_type), target_location:target_location_id(id, name, code, location_type), company:requesting_company_id(id, name, code), items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return filterByCompanyScope(mapNestedRows(data || []), scope, (row: any) => [row.requesting_company_id, row.company?.id])
}

export async function fetchStoreOverview(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreOverview> {
  const [
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: requests, error: requestsError },
    { data: receipts, error: receiptsError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, sale_price, unit, item_type, low_stock_threshold, is_active, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, low_stock_threshold), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .gt('quantity', 0)
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_requests')
      .select('id, requesting_company_id, status, comment, decision_comment, created_at, approved_at, company:requesting_company_id(id, name, code), source_location:source_location_id(id, name, code, location_type, organization_id), target_location:target_location_id(id, name, code, location_type, organization_id), items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('inventory_receipts')
      .select('id, received_at, total_amount, invoice_number, comment, location:location_id(id, name, code, location_type, organization_id, company_id), supplier:supplier_id(id, name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('inventory_movements')
      .select('id, movement_type, quantity, unit_cost, total_amount, reference_type, comment, created_at, item:item_id(id, name, barcode, unit), from_location:from_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('created_at', { ascending: false })
      .limit(16),
  ])

  if (itemsError) throw itemsError
  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (requestsError) throw requestsError
  if (receiptsError) throw receiptsError
  if (movementsError) throw movementsError

  return {
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    requests: filterByCompanyScope(mapNestedRows(requests || []), scope, (row: any) => [row.requesting_company_id, row.company?.id]),
    receipts: filterByLocationScope(mapNestedRows(receipts || []), scope, (row: any) => row.location),
    movements: filterByMovementScope(mapNestedRows(movements || []), scope),
  }
}

export async function fetchStoreAnalytics(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreAnalyticsData> {
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
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, low_stock_threshold), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .gt('quantity', 0)
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_movements')
      .select('id, movement_type, quantity, total_amount, created_at, item:item_id(id, name, barcode, unit), from_location:from_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('created_at', { ascending: false })
      .limit(320),
  ])

  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (movementsError) throw movementsError

  return {
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    movements: filterByMovementScope(mapNestedRows(movements || []), scope),
  }
}

export async function fetchStoreReceipts(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreReceiptsData> {
  const [
    { data: items, error: itemsError },
    { data: suppliers, error: suppliersError },
    { data: locations, error: locationsError },
    { data: receipts, error: receiptsError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, default_purchase_price, item_type, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    applyOrganizationFilter(supabase.from('inventory_suppliers').select('*').order('name', { ascending: true }), scope),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('location_type', 'warehouse')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_receipts')
      .select('id, location_id, supplier_id, received_at, invoice_number, comment, total_amount, status, created_at, location:location_id(id, name, code, location_type, organization_id, company_id), supplier:supplier_id(id, name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  if (itemsError) throw itemsError
  if (suppliersError) throw suppliersError
  if (locationsError) throw locationsError
  if (receiptsError) throw receiptsError

  return {
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    suppliers: filterByOrganizationScope((suppliers || []) as any[], scope, (row: any) => row.organization_id),
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
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
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
  }
}

export async function fetchStoreWriteoffs(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreWriteoffsData> {
  const [
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: writeoffs, error: writeoffsError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, item_type, is_active, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, item_type), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .gt('quantity', 0)
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_writeoffs')
      .select('id, location_id, written_at, reason, comment, total_amount, created_at, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_writeoff_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (itemsError) throw itemsError
  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (writeoffsError) throw writeoffsError

  return {
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    writeoffs: filterByLocationScope(mapNestedRows(writeoffs || []), scope, (row: any) => row.location),
  }
}

export async function fetchStoreRevisions(supabase: AnySupabase, scope?: InventoryScope): Promise<StoreRevisionsData> {
  const [
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: stocktakes, error: stocktakesError },
  ] = await Promise.all([
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, item_type, is_active, category:category_id(id, name)')
      .eq('is_active', true)
      .order('name', { ascending: true }),
      scope,
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, item_type), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_stocktakes')
      .select('id, location_id, counted_at, comment, created_at, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_stocktake_items(id, item_id, expected_qty, actual_qty, delta_qty, comment, item:item_id(id, name, barcode, unit))')
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (itemsError) throw itemsError
  if (locationsError) throw locationsError
  if (balancesError) throw balancesError
  if (stocktakesError) throw stocktakesError

  return {
    items: filterByOrganizationScope(mapNestedRows(items || []), scope, (row: any) => row.organization_id),
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    stocktakes: filterByLocationScope(mapNestedRows(stocktakes || []), scope, (row: any) => row.location),
  }
}

export async function fetchInventoryOverview(supabase: AnySupabase, scope?: InventoryScope): Promise<InventoryOverview> {
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
    applyOrganizationFilter(
      supabase
      .from('inventory_items')
      .select('id, name, barcode, organization_id, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)')
      .order('name', { ascending: true }),
      scope,
    ),
    applyOrganizationFilter(
      supabase
      .from('inventory_locations')
      .select('id, company_id, organization_id, name, code, location_type, is_active, created_at, updated_at, company:company_id(id, name, code)')
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
      scope,
    ),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode), location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code))')
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_receipts')
      .select('id, location_id, supplier_id, received_at, invoice_number, comment, total_amount, status, created_by, created_at, location:location_id(id, name, code, location_type, company_id, organization_id), supplier:supplier_id(id, name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode))')
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
      .select('id, location_id, counted_at, comment, created_by, created_at, location:location_id(id, name, code, location_type, company_id, organization_id, company:company_id(id, name, code)), items:inventory_stocktake_items(id, item_id, expected_qty, actual_qty, delta_qty, comment, item:item_id(id, name, barcode))')
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
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
    balances: filterByLocationScope(mapNestedRows(balances || []), scope, (row: any) => row.location),
    receipts: filterByLocationScope(mapNestedRows(receipts || []), scope, (row: any) => row.location),
    requests: filterByCompanyScope(mapNestedRows(requests || []), scope, (row: any) => [row.requesting_company_id, row.company?.id]),
    writeoffs: filterByLocationScope(mapNestedRows(writeoffs || []), scope, (row: any) => row.location),
    stocktakes: filterByLocationScope(mapNestedRows(stocktakes || []), scope, (row: any) => row.location),
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
  payload: { name: string; contact_name?: string | null; phone?: string | null; notes?: string | null },
  scope?: InventoryScope,
) {
  const { data, error } = await supabase
    .from('inventory_suppliers')
    .insert([
      {
        organization_id: scope?.organizationId || null,
        name: payload.name.trim(),
        contact_name: payload.contact_name?.trim() || null,
        phone: payload.phone?.trim() || null,
        notes: payload.notes?.trim() || null,
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
  },
  scope?: InventoryScope,
) {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert([
      {
        organization_id: scope?.organizationId || null,
        name: payload.name.trim(),
        barcode: payload.barcode.trim(),
        category_id: payload.category_id || null,
        sale_price: payload.sale_price,
        default_purchase_price: payload.default_purchase_price || 0,
        unit: payload.unit?.trim() || 'шт',
        notes: payload.notes?.trim() || null,
        item_type: payload.item_type || 'product',
        low_stock_threshold: payload.low_stock_threshold ?? null,
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

export async function updateInventorySupplier(
  supabase: AnySupabase,
  id: string,
  payload: { name: string; contact_name?: string | null; phone?: string | null; notes?: string | null },
  scope?: InventoryScope,
) {
  let query: any = supabase
    .from('inventory_suppliers')
    .update({
      name: payload.name.trim(),
      contact_name: payload.contact_name?.trim() || null,
      phone: payload.phone?.trim() || null,
      notes: payload.notes?.trim() || null,
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
    comment?: string | null
    created_by?: string | null
    items: Array<{ item_id: string; quantity: number; unit_cost: number; comment?: string | null }>
  },
) {
  const { data, error } = await supabase.rpc('inventory_post_receipt', {
    p_location_id: payload.location_id,
    p_received_at: payload.received_at,
    p_supplier_id: payload.supplier_id || null,
    p_invoice_number: payload.invoice_number || null,
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
    items: Array<{ item_id: string; quantity: number; unit_price: number; comment?: string | null }>
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
    items: Array<{ item_id: string; quantity: number; unit_price: number; comment?: string | null }>
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

function mapNestedRow<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const next: any = Array.isArray(row) ? [] : { ...row }
  for (const key of Object.keys(next)) {
    const value = next[key]
    if (Array.isArray(value)) {
      next[key] = value.length === 1 && value[0] && typeof value[0] === 'object' ? mapNestedRow(value[0]) : value.map(mapNestedRow)
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
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, item:item_id(id, name), location:location_id(id, name, location_type, company_id, organization_id)')
      .gt('quantity', 0),
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
    locations: filterByOrganizationScope(mapNestedRows(locations || []), scope, (row: any) => row.organization_id),
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
