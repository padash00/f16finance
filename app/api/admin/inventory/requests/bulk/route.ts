import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { decideInventoryRequest, ensureInventoryRequestAccess } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageInventory(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
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
  if (code === 'invalid-transition') return 'Недопустимый переход статуса (заявка уже в другом состоянии)'
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
    if (!['approve-full', 'reject', 'issue', 'receive'].includes(action)) return json({ error: 'invalid-action' }, 400)

    const capabilityByAction: Record<string, string> = {
      'approve-full': 'store-requests.bulk_approve',
      reject: 'store-requests.bulk_reject',
      // Массовая выдача/получение = то же право, что и одиночный переход статуса
      issue: 'store-requests.transition_status',
      receive: 'store-requests.transition_status',
    }
    const denied = await requireCapability(access, capabilityByAction[action])
    if (denied) return denied as any

    const succeeded: string[] = []
    const failed: Array<{ requestId: string; error: string }> = []
    const actorUserId = access.user?.id || null

    for (const requestId of requestIds) {
      try {
        await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

        if (action === 'issue' || action === 'receive') {
          const { data: req, error: reqErr } = await supabase
            .from('inventory_requests')
            .select('status')
            .eq('id', requestId)
            .maybeSingle()
          if (reqErr) throw reqErr
          if (!req) throw new Error('not-found')

          if (action === 'issue') {
            if (!['approved_full', 'approved_partial'].includes(String(req.status || ''))) throw new Error('invalid-transition')
            const nowIso = new Date().toISOString()
            const { error: updErr } = await supabase
              .from('inventory_requests')
              .update({ status: 'issued', issued_at: nowIso, issued_by: actorUserId, updated_at: nowIso })
              .eq('id', requestId)
            if (updErr) throw updErr
          } else {
            if (String(req.status || '') !== 'issued') throw new Error('invalid-transition')
            const { error: rpcErr } = await supabase.rpc('inventory_receive_request', {
              p_request_id: requestId,
              p_actor_user_id: actorUserId,
            })
            if (rpcErr) throw rpcErr
          }
          succeeded.push(requestId)
          continue
        }

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
      action: `bulk-${action === 'approve-full' ? 'approve-full' : action}`,
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
