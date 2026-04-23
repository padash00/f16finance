import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { decideInventoryRequest, ensureInventoryRequestAccess } from '@/lib/server/repositories/inventory'
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

function humanizeDecisionError(raw: string | null | undefined) {
  const code = String(raw || '').trim()
  const lowered = code.toLowerCase()
  if (code === 'inventory-insufficient-stock' || lowered.includes('inventory-insufficient-stock') || lowered.includes('inventory_balances_quantity_check')) {
    return 'Недостаточно остатка на складе для полного одобрения'
  }
  if (code === 'already-decided') return 'Заявка уже обработана'
  if (code === 'not-found') return 'Заявка не найдена'
  return code || 'failed'
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
    const requestIds = Array.isArray(body?.requestIds) ? body.requestIds.map((id: unknown) => String(id || '').trim()).filter(Boolean) : []
    const action = String(body?.action || '').trim()
    if (!requestIds.length) return json({ error: 'request-ids-required' }, 400)
    if (!['approve-full', 'reject'].includes(action)) return json({ error: 'invalid-action' }, 400)

    const succeeded: string[] = []
    const failed: Array<{ requestId: string; error: string }> = []
    const actorUserId = access.user?.id || null

    for (const requestId of requestIds) {
      try {
        await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)
        const { data: requestRow, error: requestError } = await supabase
          .from('inventory_requests')
          .select('id, status, items:inventory_request_items(id, requested_qty)')
          .eq('id', requestId)
          .maybeSingle()
        if (requestError) throw requestError
        if (!requestRow) throw new Error('not-found')
        if (!['new', 'disputed'].includes(String((requestRow as any).status || ''))) {
          throw new Error('already-decided')
        }

        const decisionItems =
          action === 'approve-full'
            ? (Array.isArray((requestRow as any).items) ? (requestRow as any).items : []).map((row: any) => ({
                request_item_id: String(row.id),
                approved_qty: normalizeQty(row.requested_qty),
              }))
            : []

        await decideInventoryRequest(supabase as any, {
          request_id: requestId,
          approved: action === 'approve-full',
          decision_comment: null,
          actor_user_id: actorUserId,
          items: decisionItems,
        })
        succeeded.push(requestId)
      } catch (error: any) {
        failed.push({ requestId, error: humanizeDecisionError(String(error?.message || 'failed')) })
      }
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-request',
      entityId: succeeded[0] || requestIds[0],
      action: action === 'approve-full' ? 'bulk-approve-full' : 'bulk-reject',
      payload: { requestIds, succeeded, failed },
    })

    return json({ ok: true, data: { succeeded, failed } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/requests/bulk.POST',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось выполнить массовое действие' }, 500)
  }
}
