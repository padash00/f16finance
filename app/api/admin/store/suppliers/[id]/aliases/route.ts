import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type CreateBody = {
  invoice_name?: string
  item_id?: string
  last_unit_cost?: number | null
  last_sale_price?: number | null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: supplierId } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'store-suppliers.add_alias')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as CreateBody | null
    const invoiceName = String(body?.invoice_name || '').trim()
    const itemId = String(body?.item_id || '').trim()
    if (!invoiceName || !itemId) return json({ error: 'invoice_name и item_id обязательны' }, 400)

    let supplierQuery: any = supabase
      .from('inventory_suppliers')
      .select('id, organization_id')
      .eq('id', supplierId)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      supplierQuery = supplierQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: supplier } = await supplierQuery.maybeSingle()
    if (!supplier?.id) return json({ error: 'Поставщик не найден' }, 404)

    const { upsertInvoiceNameMappings } = await import('@/lib/server/repositories/invoice')
    await upsertInvoiceNameMappings(supabase as any, [
      {
        invoice_name: invoiceName,
        item_id: itemId,
        organization_id: supplier.organization_id,
        supplier_id: supplierId,
        last_unit_cost: body?.last_unit_cost ?? null,
        last_sale_price: body?.last_sale_price ?? null,
      },
    ])

    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось добавить алиас' }, 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: supplierId } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'store-suppliers.delete_alias')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const aliasId = String(url.searchParams.get('alias_id') || '').trim()
    if (!aliasId) return json({ error: 'alias_id обязателен' }, 400)

    let supplierQuery: any = supabase
      .from('inventory_suppliers')
      .select('id, organization_id')
      .eq('id', supplierId)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      supplierQuery = supplierQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: supplier } = await supplierQuery.maybeSingle()
    if (!supplier?.id) return json({ error: 'Поставщик не найден' }, 404)

    let deleteQuery: any = supabase
      .from('invoice_name_mappings')
      .delete()
      .eq('id', aliasId)
      .eq('supplier_id', supplierId)
      .eq('organization_id', supplier.organization_id)

    const { error: deleteError } = await deleteQuery
    if (deleteError) throw deleteError

    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось удалить алиас' }, 500)
  }
}
