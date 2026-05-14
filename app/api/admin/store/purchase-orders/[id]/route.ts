import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { humanizeDbError } from '@/lib/server/db-error-humanize'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

const VALID_STATUSES = ['draft', 'sent', 'received', 'cancelled'] as const
type Status = (typeof VALID_STATUSES)[number]

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let orderQuery: any = supabase
      .from('inventory_purchase_orders')
      .select('id, supplier_id, organization_id, status, is_auto, comment, sent_at, received_at, cancelled_at, cancel_reason, created_at, supplier:supplier_id(id, name, organization_name, bin_iin, phone, sales_rep_name, sales_rep_phone, lead_time_days), items:inventory_purchase_order_items(id, item_id, current_qty, threshold, suggested_qty, comment, item:item_id(id, name, barcode, unit))')
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      orderQuery = orderQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: order, error } = await orderQuery.maybeSingle()
    if (error) throw error
    if (!order?.id) return json({ error: 'Заявка не найдена' }, 404)

    return json({ ok: true, data: { order } })
  } catch (error: any) {
    return json({ error: humanizeDbError(error, 'Не удалось загрузить заявку') }, 500)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const body = (await request.json().catch(() => null)) as {
      status?: string
      cancel_reason?: string | null
    } | null
    if (!body?.status) return json({ error: 'status-required' }, 400)
    const nextStatus = String(body.status).trim() as Status
    if (!VALID_STATUSES.includes(nextStatus)) return json({ error: 'invalid-status' }, 400)

    let currentQuery: any = supabase
      .from('inventory_purchase_orders')
      .select('id, status, organization_id')
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      currentQuery = currentQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: current, error: currentError } = await currentQuery.maybeSingle()
    if (currentError) throw currentError
    if (!current?.id) return json({ error: 'Заявка не найдена' }, 404)

    const nowIso = new Date().toISOString()
    const patch: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'sent') patch.sent_at = nowIso
    if (nextStatus === 'received') patch.received_at = nowIso
    if (nextStatus === 'cancelled') {
      patch.cancelled_at = nowIso
      patch.cancel_reason = body.cancel_reason?.trim() || null
    }

    const { error: updateError } = await supabase
      .from('inventory_purchase_orders')
      .update(patch)
      .eq('id', id)
    if (updateError) throw updateError

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-purchase-order',
      entityId: id,
      action: `status_${nextStatus}`,
      payload: { from: current.status, to: nextStatus, cancel_reason: patch.cancel_reason || null },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/purchase-orders/[id].PATCH',
      message: error?.message || 'Purchase order PATCH error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось обновить заявку') }, 500)
  }
}
