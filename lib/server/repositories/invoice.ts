import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchedInvoiceItem, ParsedInvoice } from '@/lib/server/invoice-parser'

type AnySupabase = SupabaseClient<any, 'public', any>

export type InvoiceSessionData = {
  invoice: ParsedInvoice
  items: MatchedInvoiceItem[]
}

// ─── Name mappings ─────────────────────────────────────────────────────────────

export type InvoiceMappingRow = {
  invoice_name: string
  item_id: string
  supplier_id: string | null
  item_name?: string
  last_unit_cost?: number | null
  last_sale_price?: number | null
}

export async function fetchInvoiceNameMappings(
  supabase: AnySupabase,
  scope?: { organizationId?: string | null; supplierId?: string | null },
): Promise<InvoiceMappingRow[]> {
  let query: any = supabase
    .from('invoice_name_mappings')
    .select('invoice_name, item_id, supplier_id, last_unit_cost, last_sale_price, item:item_id(name)')
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .order('usage_count', { ascending: false })

  if (scope?.organizationId) {
    query = query.eq('organization_id', scope.organizationId)
  }
  // Supplier filter: if provided, fetch this supplier's mappings + global (null) ones as fallback.
  if (scope?.supplierId) {
    query = query.or(`supplier_id.eq.${scope.supplierId},supplier_id.is.null`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => ({
    invoice_name: row.invoice_name as string,
    item_id: row.item_id as string,
    supplier_id: (row.supplier_id || null) as string | null,
    item_name: row.item?.name as string | undefined,
    last_unit_cost: row.last_unit_cost == null ? null : Number(row.last_unit_cost),
    last_sale_price: row.last_sale_price == null ? null : Number(row.last_sale_price),
  }))
}

export async function upsertInvoiceNameMappings(
  supabase: AnySupabase,
  mappings: Array<{
    invoice_name: string
    item_id: string
    organization_id: string
    supplier_id?: string | null
    last_unit_cost?: number | null
    last_sale_price?: number | null
  }>,
) {
  if (mappings.length === 0) return

  const now = new Date().toISOString()
  for (const m of mappings) {
    const cleanName = String(m.invoice_name || '').trim()
    if (!cleanName || !m.item_id || !m.organization_id) continue

    let existingQuery: any = supabase
      .from('invoice_name_mappings')
      .select('id, usage_count')
      .eq('organization_id', m.organization_id)
      .ilike('invoice_name', cleanName)
      .limit(1)
    if (m.supplier_id) {
      existingQuery = existingQuery.eq('supplier_id', m.supplier_id)
    } else {
      existingQuery = existingQuery.is('supplier_id', null)
    }
    const { data: existing } = await existingQuery.maybeSingle()

    const updates: Record<string, unknown> = {
      item_id: m.item_id,
      updated_at: now,
      last_seen_at: now,
    }
    if (m.last_unit_cost != null) updates.last_unit_cost = m.last_unit_cost
    if (m.last_sale_price != null) updates.last_sale_price = m.last_sale_price

    if (existing?.id) {
      updates.usage_count = (Number(existing.usage_count || 0) + 1)
      await supabase.from('invoice_name_mappings').update(updates).eq('id', existing.id)
    } else {
      await supabase
        .from('invoice_name_mappings')
        .insert([
          {
            invoice_name: cleanName,
            item_id: m.item_id,
            organization_id: m.organization_id,
            supplier_id: m.supplier_id || null,
            usage_count: 1,
            last_unit_cost: m.last_unit_cost ?? null,
            last_sale_price: m.last_sale_price ?? null,
            last_seen_at: now,
          },
        ])
        .throwOnError()
    }
  }
}

// ─── Inventory items for matching ─────────────────────────────────────────────

export async function fetchInventoryItemsForMatching(
  supabase: AnySupabase,
  scope?: { organizationId?: string | null },
) {
  let query: any = supabase
    .from('inventory_items')
    .select('id, name, barcode, unit, organization_id')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (scope?.organizationId) {
    // Match org items + legacy null-org rows (kept for backward-compatibility).
    query = query.or(`organization_id.eq.${scope.organizationId},organization_id.is.null`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => ({
    id: row.id as string,
    name: row.name as string,
    barcode: row.barcode as string,
    unit: row.unit as string,
  })) as Array<{ id: string; name: string; barcode: string; unit: string }>
}

// ─── Warehouse location ────────────────────────────────────────────────────────

export async function fetchFirstWarehouseLocation(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name, organization_id')
    .eq('location_type', 'warehouse')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; name: string; organization_id: string | null } | null
}

// ─── Telegram invoice sessions ─────────────────────────────────────────────────

export async function createInvoiceSession(
  supabase: AnySupabase,
  params: {
    telegram_user_id: string
    chat_id: string
    message_id?: number | null
    parsed_data: InvoiceSessionData
    warehouse_location_id: string | null
  },
) {
  const { data, error } = await supabase
    .from('telegram_invoice_sessions')
    .insert([
      {
        telegram_user_id: params.telegram_user_id,
        chat_id: params.chat_id,
        message_id: params.message_id || null,
        parsed_data: params.parsed_data,
        warehouse_location_id: params.warehouse_location_id,
        status: 'pending',
      },
    ])
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function fetchInvoiceSession(supabase: AnySupabase, sessionId: string) {
  const { data, error } = await supabase
    .from('telegram_invoice_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function cancelInvoiceSession(supabase: AnySupabase, sessionId: string) {
  await supabase.from('telegram_invoice_sessions').update({ status: 'cancelled' }).eq('id', sessionId).throwOnError()
}

export async function confirmInvoiceSession(
  supabase: AnySupabase,
  sessionId: string,
  receiptId: string,
) {
  await supabase
    .from('telegram_invoice_sessions')
    .update({ status: 'confirmed', receipt_id: receiptId })
    .eq('id', sessionId)
    .throwOnError()
}
