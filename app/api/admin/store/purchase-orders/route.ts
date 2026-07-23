import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { humanizeDbError } from '@/lib/server/db-error-humanize'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

type CreateBody = {
  supplier_id: string
  comment?: string | null
  items: Array<{
    item_id: string
    suggested_qty: number
    current_qty?: number | null
    threshold?: number | null
    comment?: string | null
  }>
}

function normalizeQty(value: unknown) {
  const amount = Number(String(value ?? 0).replace(',', '.'))
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-purchase-orders.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const statusParam = String(url.searchParams.get('status') || '').trim()

    let query: any = supabase
      .from('inventory_purchase_orders')
      .select('id, supplier_id, status, is_auto, comment, sent_at, received_at, cancelled_at, created_at, supplier:supplier_id(id, name, organization_name, sales_rep_name, sales_rep_phone), items:inventory_purchase_order_items(id)')
      .order('created_at', { ascending: false })
      .limit(300)
    // NEVER-pattern: не-супер без орг → нулевой uuid → 0 строк (fail-closed).
    const scopeOrg = access.isSuperAdmin ? null : (access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    if (scopeOrg) {
      query = query.eq('organization_id', scopeOrg)
    }
    if (statusParam) query = query.eq('status', statusParam)

    const { data: orders, error } = await query
    if (error) throw error

    const enriched = (orders || []).map((o: any) => ({
      ...o,
      item_count: Array.isArray(o.items) ? o.items.length : 0,
      items: undefined,
    }))

    return json({ ok: true, data: { orders: enriched } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/purchase-orders.GET',
      message: error?.message || 'Purchase orders GET error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить заявки поставщикам') }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-purchase-orders.create')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const body = (await request.json().catch(() => null)) as CreateBody | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const supplierId = String(body.supplier_id || '').trim()
    if (!supplierId) return json({ error: 'Выберите поставщика' }, 400)

    const items = (body.items || [])
      .map((i) => ({
        item_id: String(i.item_id || '').trim(),
        suggested_qty: normalizeQty(i.suggested_qty),
        current_qty: i.current_qty != null ? normalizeQty(i.current_qty) : 0,
        threshold: i.threshold != null ? normalizeQty(i.threshold) : null,
        comment: i.comment?.trim() || null,
      }))
      .filter((i) => i.item_id && i.suggested_qty > 0)

    if (items.length === 0) return json({ error: 'Добавьте хотя бы одну позицию с количеством' }, 400)

    // Поставщик должен существовать и быть в той же организации.
    let supplierQuery: any = supabase
      .from('inventory_suppliers')
      .select('id, organization_id, name')
      .eq('id', supplierId)
      .limit(1)
    // NEVER-pattern: не-супер без орг → нулевой uuid → чужой supplier не совпадёт.
    const scopeOrgSup = access.isSuperAdmin ? null : (access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    if (scopeOrgSup) {
      supplierQuery = supplierQuery.eq('organization_id', scopeOrgSup)
    }
    const { data: supplier, error: supplierError } = await supplierQuery.maybeSingle()
    if (supplierError) throw supplierError
    if (!supplier?.id) return json({ error: 'Поставщик не найден' }, 404)

    const { data: order, error: orderError } = await supabase
      .from('inventory_purchase_orders')
      .insert([
        {
          supplier_id: supplierId,
          organization_id: supplier.organization_id || access.activeOrganization?.id || null,
          status: 'draft',
          is_auto: false,
          comment: body.comment?.trim() || null,
          created_by: actorUserId,
        },
      ])
      .select('id')
      .single()
    if (orderError) throw orderError

    const orderId = String(order.id)
    const itemRows = items.map((i) => ({
      order_id: orderId,
      item_id: i.item_id,
      suggested_qty: i.suggested_qty,
      current_qty: i.current_qty,
      threshold: i.threshold,
      comment: i.comment,
    }))
    const { error: itemsError } = await supabase
      .from('inventory_purchase_order_items')
      .insert(itemRows)
    if (itemsError) {
      // откатываем шапку, чтобы не плодить пустые заявки
      await supabase.from('inventory_purchase_orders').delete().eq('id', orderId)
      throw itemsError
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-purchase-order',
      entityId: orderId,
      action: 'create',
      payload: { supplier_id: supplierId, supplier_name: supplier.name, item_count: items.length, is_auto: false },
    })

    return json({ ok: true, data: { id: orderId } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/purchase-orders.POST',
      message: error?.message || 'Purchase orders POST error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось создать заявку поставщику') }, 500)
  }
}
