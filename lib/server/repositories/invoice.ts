import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchedInvoiceItem, ParsedInvoice } from '@/lib/server/invoice-parser'

type AnySupabase = SupabaseClient<any, 'public', any>

export type InvoiceSessionData = {
  invoice: ParsedInvoice
  items: MatchedInvoiceItem[]
}

// ─── Name mappings ─────────────────────────────────────────────────────────────

export async function fetchInvoiceNameMappings(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('invoice_name_mappings')
    .select('invoice_name, item_id, item:item_id(name)')
    .order('usage_count', { ascending: false })

  if (error) throw error
  return (data || []).map((row: any) => ({
    invoice_name: row.invoice_name as string,
    item_id: row.item_id as string,
    item_name: row.item?.name as string | undefined,
  }))
}

export async function upsertInvoiceNameMappings(
  supabase: AnySupabase,
  mappings: Array<{ invoice_name: string; item_id: string }>,
) {
  if (mappings.length === 0) return

  for (const m of mappings) {
    // Try update first (increment usage_count)
    const { data: existing } = await supabase
      .from('invoice_name_mappings')
      .select('id, usage_count')
      .ilike('invoice_name', m.invoice_name)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('invoice_name_mappings')
        .update({ item_id: m.item_id, usage_count: existing.usage_count + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('invoice_name_mappings')
        .insert([{ invoice_name: m.invoice_name, item_id: m.item_id, usage_count: 1 }])
        .throwOnError()
    }
  }
}

// ─── Inventory items for matching ─────────────────────────────────────────────

export async function fetchInventoryItemsForMatching(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, barcode, unit')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return (data || []) as Array<{ id: string; name: string; barcode: string; unit: string }>
}

// ─── Warehouse location ────────────────────────────────────────────────────────

export async function fetchFirstWarehouseLocation(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name')
    .eq('location_type', 'warehouse')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; name: string } | null
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
