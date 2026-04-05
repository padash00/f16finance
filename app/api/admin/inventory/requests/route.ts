import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { decideInventoryRequest, ensureInventoryRequestAccess, fetchInventoryRequests } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageInventory(access: { isSuperAdmin: boolean; staffRole: 'manager' | 'marketer' | 'owner' | 'other' }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
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
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const requests = await fetchInventoryRequests(supabase as any, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    })

    return json({
      ok: true,
      data: {
        requests,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/requests.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить заявки магазина' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const body = await request.json().catch(() => null)
    if (!body?.action || body.action !== 'decideRequest') return json({ error: 'invalid-action' }, 400)

    const actorUserId = access.staffMember?.id || null
    const requestId = String(body.requestId || '').trim()
    if (!requestId) return json({ error: 'request-id-required' }, 400)
    await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

    const decision = await decideInventoryRequest(supabase as any, {
      request_id: requestId,
      approved: body.approved === true,
      decision_comment: body.decision_comment || null,
      actor_user_id: actorUserId,
      items: Array.isArray(body.items)
        ? body.items.map((item: any) => ({
            request_item_id: String(item.request_item_id || '').trim(),
            approved_qty: normalizeQty(item.approved_qty),
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-request',
      entityId: requestId,
      action: body.approved ? 'approve' : 'reject',
      payload: {
        request_id: requestId,
        approved: body.approved === true,
        decision,
      },
    })

    return json({ ok: true, data: decision })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/requests.POST',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось обработать заявку магазина' }, 500)
  }
}
