import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  ensureInventoryCompanyAccess,
  ensureInventoryLocationAccess,
  ensureInventoryRequestAccess,
  fetchConsumableDashboard,
  issueInventoryRequest,
  receiveInventoryRequest,
  upsertConsumptionNorm,
  upsertPointLimit,
} from '@/lib/server/repositories/inventory'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageInventory(access: { isSuperAdmin: boolean; staffRole: 'manager' | 'marketer' | 'owner' | 'other' }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
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
    const data = await fetchConsumableDashboard(supabase as any, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    })
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/consumables.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)
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
    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    if (body.action === 'upsertNorm') {
      const { item_id, location_id, monthly_qty, alert_days } = body.payload || {}
      if (!item_id || !location_id || !monthly_qty) return json({ error: 'norm-fields-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, location_id, inventoryScope)
      const norm = await upsertConsumptionNorm(supabase as any, { item_id, location_id, monthly_qty: Number(monthly_qty), alert_days: Number(alert_days || 14) })
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-consumption-norm', entityId: String(norm.id), action: 'upsert', payload: norm })
      return json({ ok: true, data: norm })
    }

    if (body.action === 'upsertLimit') {
      const { item_id, company_id, monthly_limit_qty } = body.payload || {}
      if (!item_id || !company_id || !monthly_limit_qty) return json({ error: 'limit-fields-required' }, 400)
      await ensureInventoryCompanyAccess(supabase as any, company_id, inventoryScope)
      const limit = await upsertPointLimit(supabase as any, { item_id, company_id, monthly_limit_qty: Number(monthly_limit_qty) })
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-point-limit', entityId: String(limit.id), action: 'upsert', payload: limit })
      return json({ ok: true, data: limit })
    }

    if (body.action === 'issueRequest') {
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)
      await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)
      const result = await issueInventoryRequest(supabase as any, requestId, actorUserId)
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-request', entityId: requestId, action: 'issue', payload: result })
      return json({ ok: true, data: result })
    }

    if (body.action === 'receiveRequest') {
      const requestId = String(body.requestId || '').trim()
      const received_qty_confirmed = Number(body.received_qty_confirmed || 0)
      const received_photo_url = body.received_photo_url || null
      if (!requestId) return json({ error: 'request-id-required' }, 400)
      await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)
      const result = await receiveInventoryRequest(supabase as any, requestId, { received_qty_confirmed, received_photo_url })
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-request', entityId: requestId, action: result.status === 'disputed' ? 'dispute' : 'receive', payload: result })
      return json({ ok: true, data: result })
    }

    return json({ error: 'unsupported-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/consumables.POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
