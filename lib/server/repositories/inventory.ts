import type { SupabaseClient } from '@supabase/supabase-js'

type AnySupabase = SupabaseClient<any, 'public', any>

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

export async function fetchInventoryOverview(supabase: AnySupabase): Promise<InventoryOverview> {
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
    supabase.from('inventory_categories').select('*').order('name', { ascending: true }),
    supabase.from('inventory_suppliers').select('*').order('name', { ascending: true }),
    supabase
      .from('inventory_items')
      .select('id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)')
      .order('name', { ascending: true }),
    supabase
      .from('inventory_locations')
      .select('id, company_id, name, code, location_type, is_active, created_at, updated_at, company:company_id(id, name, code)')
      .order('location_type', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode), location:location_id(id, name, code, location_type, company_id, company:company_id(id, name, code))')
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_receipts')
      .select('id, location_id, supplier_id, received_at, invoice_number, comment, total_amount, status, created_by, created_at, location:location_id(id, name, code, location_type), supplier:supplier_id(id, name), items:inventory_receipt_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_requests')
      .select('id, source_location_id, target_location_id, requesting_company_id, status, comment, decision_comment, created_by, approved_by, approved_at, created_at, updated_at, source_location:source_location_id(id, name, code, location_type), target_location:target_location_id(id, name, code, location_type), company:requesting_company_id(id, name, code), items:inventory_request_items(id, item_id, requested_qty, approved_qty, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_writeoffs')
      .select('id, location_id, written_at, reason, comment, total_amount, created_by, created_at, location:location_id(id, name, code, location_type, company_id, company:company_id(id, name, code)), items:inventory_writeoff_items(id, item_id, quantity, unit_cost, total_cost, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_stocktakes')
      .select('id, location_id, counted_at, comment, created_by, created_at, location:location_id(id, name, code, location_type, company_id, company:company_id(id, name, code)), items:inventory_stocktake_items(id, item_id, expected_qty, actual_qty, delta_qty, comment, item:item_id(id, name, barcode))')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inventory_movements')
      .select('id, item_id, movement_type, from_location_id, to_location_id, quantity, unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id, created_at, item:item_id(id, name, barcode), from_location:from_location_id(id, name, code, location_type, company_id, company:company_id(id, name, code)), to_location:to_location_id(id, name, code, location_type, company_id, company:company_id(id, name, code))')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
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
    categories: mapNestedRows(categories || []),
    suppliers: suppliers || [],
    items: mapNestedRows(items || []),
    locations: mapNestedRows(locations || []),
    balances: mapNestedRows(balances || []),
    receipts: mapNestedRows(receipts || []),
    requests: mapNestedRows(requests || []),
    writeoffs: mapNestedRows(writeoffs || []),
    stocktakes: mapNestedRows(stocktakes || []),
    movements: mapNestedRows(movements || []),
    companies: companies || [],
  }
}

export async function createInventoryCategory(
  supabase: AnySupabase,
  payload: { name: string; description?: string | null },
) {
  const { data, error } = await supabase
    .from('inventory_categories')
    .insert([
      {
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
) {
  const { data, error } = await supabase
    .from('inventory_suppliers')
    .insert([
      {
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
  },
) {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert([
      {
        name: payload.name.trim(),
        barcode: payload.barcode.trim(),
        category_id: payload.category_id || null,
        sale_price: payload.sale_price,
        default_purchase_price: payload.default_purchase_price || 0,
        unit: payload.unit?.trim() || 'шт',
        notes: payload.notes?.trim() || null,
        item_type: payload.item_type || 'product',
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
  },
) {
  const normalizedBarcode = String(payload.barcode || '').trim()
  const normalizedName = String(payload.name || '').trim()
  if (!normalizedBarcode || !normalizedName) return { syncedCompanyIds: [] as string[] }

  const { data: locations, error: locationsError } = await supabase
    .from('inventory_locations')
    .select('company_id')
    .eq('location_type', 'point_display')
    .eq('is_active', true)
    .not('company_id', 'is', null)

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

export async function updateInventoryCategory(
  supabase: AnySupabase,
  id: string,
  payload: { name: string; description?: string | null },
) {
  const { data, error } = await supabase
    .from('inventory_categories')
    .update({ name: payload.name.trim(), description: payload.description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateInventorySupplier(
  supabase: AnySupabase,
  id: string,
  payload: { name: string; contact_name?: string | null; phone?: string | null; notes?: string | null },
) {
  const { data, error } = await supabase
    .from('inventory_suppliers')
    .update({
      name: payload.name.trim(),
      contact_name: payload.contact_name?.trim() || null,
      phone: payload.phone?.trim() || null,
      notes: payload.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
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
  },
) {
  const { data, error } = await supabase
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
    })
    .eq('id', id)
    .select('id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, created_at, updated_at, category:category_id(id, name)')
    .single()
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
  const { data, error } = await supabase.rpc('inventory_create_point_return', {
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
  })

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

export async function fetchConsumableDashboard(supabase: AnySupabase) {
  const [
    { data: items, error: itemsError },
    { data: norms, error: normsError },
    { data: limits, error: limitsError },
    { data: balances, error: balancesError },
    { data: locations, error: locationsError },
    { data: companies, error: companiesError },
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, category_id, category:category_id(id, name)')
      .eq('item_type', 'consumable')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('inventory_consumption_norms')
      .select('id, item_id, location_id, monthly_qty, alert_days'),
    supabase
      .from('inventory_point_limits')
      .select('id, item_id, company_id, monthly_limit_qty'),
    supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, item:item_id(id, name), location:location_id(id, name, location_type, company_id)')
      .gt('quantity', 0),
    supabase
      .from('inventory_locations')
      .select('id, name, location_type, company_id, company:company_id(id, name, code)')
      .eq('is_active', true),
    supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
  ])

  if (itemsError) throw itemsError
  if (normsError) throw normsError
  if (limitsError) throw limitsError
  if (balancesError) throw balancesError
  if (locationsError) throw locationsError
  if (companiesError) throw companiesError

  return {
    items: mapNestedRows(items || []),
    norms: norms || [],
    limits: limits || [],
    balances: mapNestedRows(balances || []),
    locations: mapNestedRows(locations || []),
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
