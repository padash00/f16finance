import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { bulkSyncInventoryItemsToPointProducts, ensureInventoryLocationAccess, fetchStoreReceipts, postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

type Body = {
  action: 'createReceipt'
  payload: {
    location_id: string
    supplier_id?: string | null
    received_at: string
    invoice_number?: string | null
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_cost: number
      sale_price?: number
      comment?: string | null
    }>
  }
}

function normalizeMoney(value: unknown) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

function normalizeQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const scopeParam = String(url.searchParams.get('scope') || 'all')
    const scope: 'all' | 'warehouse' | 'showcase' =
      scopeParam === 'warehouse' || scopeParam === 'showcase' ? scopeParam : 'all'
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const data = await fetchStoreReceipts(supabase as any, inventoryScope)
    const locationType = scope === 'showcase' ? 'point_display' : scope === 'warehouse' ? 'warehouse' : null
    if (locationType) {
      data.locations = (data.locations || []).filter((l: any) => l?.location_type === locationType)
      data.receipts = (data.receipts || []).filter((r: any) => r?.location?.location_type === locationType)
    }
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts.GET',
      message: error?.message || 'Store receipts GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить приемку магазина' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action || body.action !== 'createReceipt') return json({ error: 'invalid-action' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const result = await postInventoryReceipt(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      supplier_id: body.payload.supplier_id || null,
      received_at: body.payload.received_at,
      invoice_number: body.payload.invoice_number || null,
      comment: body.payload.comment || null,
      created_by: actorUserId,
      items: Array.isArray(body.payload.items)
        ? body.payload.items.map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            unit_cost: normalizeMoney(item.unit_cost),
            comment: item.comment || null,
          }))
        : [],
    })

    // Always update sale/default purchase prices globally from receipt lines
    if (Array.isArray(body.payload.items)) {
      const updatesRaw = body.payload.items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          unit_cost: normalizeMoney(item.unit_cost),
          sale_price: normalizeMoney(item.sale_price),
        }))
        .filter((item) => item.item_id && item.sale_price >= 0)

      const updatesMap = new Map<string, { item_id: string; unit_cost: number; sale_price: number }>()
      for (const row of updatesRaw) updatesMap.set(row.item_id, row)
      const updates = [...updatesMap.values()]
      const syncItems: Array<{ name: string; barcode: string; sale_price: number; is_active?: boolean }> = []

      for (const row of updates) {
        let query: any = supabase
          .from('inventory_items')
          .update({
            sale_price: row.sale_price,
            default_purchase_price: row.unit_cost,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.item_id)
          .select('name, barcode, sale_price, is_active')
          .single()
        if (!access.isSuperAdmin && access.activeOrganization?.id) {
          query = query.eq('organization_id', access.activeOrganization.id)
        }
        const { data: itemRow, error: upErr } = await query
        if (upErr) throw upErr
        if (itemRow?.name && itemRow?.barcode) {
          syncItems.push({
            name: String(itemRow.name),
            barcode: String(itemRow.barcode),
            sale_price: Number(itemRow.sale_price || 0),
            is_active: itemRow.is_active !== false,
          })
        }
      }

      if (syncItems.length > 0) {
        await bulkSyncInventoryItemsToPointProducts(supabase as any, syncItems, {
          organizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      }
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-receipt',
      entityId: String(result?.receipt_id || result?.id || ''),
      action: 'create',
      payload: {
        ...result,
        update_sale_price: true,
      },
    })

    return json({ ok: true, data: result })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts.POST',
      message: error?.message || 'Store receipts POST error',
    })
    return json({ error: error?.message || 'Не удалось провести приемку' }, 500)
  }
}
