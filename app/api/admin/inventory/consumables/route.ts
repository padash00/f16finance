import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import {
  createInventoryRequest,
  decideInventoryRequest,
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
    const denied = await requireCapability(access, 'store-consumables.view')
    if (denied) return denied as any
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
    const { data: issueRows, error: issuesError } = await supabase
      .from('inventory_requests')
      .select('id, created_at, approved_at, issued_at, received_at, issued_by, approved_by, created_by, status, comment, requesting_company_id, company:requesting_company_id(id, name), target_location:target_location_id(id, name), items:inventory_request_items(id, item_id, approved_qty, requested_qty, item:item_id(id, name, barcode, unit, item_type))')
      .in('status', ['issued', 'received', 'approved_full', 'approved_partial'])
      .order('created_at', { ascending: false })
      .limit(120)
    if (issuesError) throw issuesError

    const allowedCompanyIds = companyScope.allowedCompanyIds
    const issueJournal = (issueRows || [])
      .filter((row: any) => String(row?.comment || '').includes('[consumable-issue]'))
      .filter((row: any) => {
        if (allowedCompanyIds === null) return true
        const companyId = String(row?.requesting_company_id || '')
        return !!companyId && allowedCompanyIds.includes(companyId)
      })
      .map((row: any) => ({
        id: String(row?.id || ''),
        created_at: row?.created_at || null,
        approved_at: row?.approved_at || null,
        issued_at: row?.issued_at || null,
        received_at: row?.received_at || null,
        issued_by: row?.issued_by || null,
        approved_by: row?.approved_by || null,
        created_by: row?.created_by || null,
        status: String(row?.status || ''),
        comment: row?.comment || null,
        company: Array.isArray(row?.company) ? row.company[0] : row?.company || null,
        target_location: Array.isArray(row?.target_location) ? row.target_location[0] : row?.target_location || null,
        items: (Array.isArray(row?.items) ? row.items : [])
          .map((line: any) => ({
            id: String(line?.id || ''),
            requested_qty: Number(line?.requested_qty || 0),
            approved_qty: Number(line?.approved_qty || 0),
            item: Array.isArray(line?.item) ? line.item[0] : line?.item || null,
          }))
          .filter((line: any) => String(line?.item?.item_type || '') === 'consumable'),
      }))
      .filter((row: any) => Array.isArray(row.items) && row.items.length > 0)

    ;(data as any).issues = issueJournal
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
    const denied = await requireCapability(access, 'store-consumables.create')
    if (denied) return denied as any
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

    if (body.action === 'recordIssue') {
      const pointLocationId = String(body.payload?.point_location_id || '').trim()
      const issueDate = String(body.payload?.issue_date || '').trim()
      const issueComment = String(body.payload?.comment || '').trim()
      const itemsRaw = Array.isArray(body.payload?.items) ? body.payload.items : []
      if (!pointLocationId) return json({ error: 'point-location-required' }, 400)
      if (!issueDate) return json({ error: 'issue-date-required' }, 400)
      if (!itemsRaw.length) return json({ error: 'issue-items-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, pointLocationId, inventoryScope)

      const normalizedItems = itemsRaw
        .map((item: any) => ({
          item_id: String(item?.item_id || '').trim(),
          requested_qty: Number(item?.requested_qty || 0),
          comment: item?.comment ? String(item.comment).trim() : null,
        }))
        .filter((item: any) => item.item_id && Number.isFinite(item.requested_qty) && item.requested_qty > 0)
      if (!normalizedItems.length) return json({ error: 'issue-items-invalid' }, 400)

      const itemIds = normalizedItems.map((item: any) => item.item_id)
      const { data: itemRows, error: itemRowsError } = await supabase
        .from('inventory_items')
        .select('id, item_type')
        .in('id', itemIds)
      if (itemRowsError) throw itemRowsError
      const consumableIds = new Set((itemRows || []).filter((row: any) => row?.item_type === 'consumable').map((row: any) => String(row.id)))
      if (consumableIds.size !== normalizedItems.length) return json({ error: 'issue-non-consumable-item' }, 400)

      const { data: pointLoc, error: pointLocError } = await supabase
        .from('inventory_locations')
        .select('id, company_id')
        .eq('id', pointLocationId)
        .eq('location_type', 'point_display')
        .maybeSingle()
      if (pointLocError) throw pointLocError
      if (!pointLoc?.company_id) return json({ error: 'point-location-invalid' }, 400)

      const companyId = String(pointLoc.company_id)
      await ensureInventoryCompanyAccess(supabase as any, companyId, inventoryScope)

      const { data: warehouseLoc, error: warehouseErr } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('company_id', companyId)
        .eq('location_type', 'warehouse')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (warehouseErr) throw warehouseErr
      if (!warehouseLoc?.id) return json({ error: 'warehouse-location-not-found' }, 400)

      const requestComment = `[consumable-issue] ${issueDate}${issueComment ? ` · ${issueComment}` : ''}`
      const requestId = await createInventoryRequest(supabase as any, {
        source_location_id: String(warehouseLoc.id),
        target_location_id: pointLocationId,
        requesting_company_id: companyId,
        comment: requestComment,
        created_by: actorUserId,
        items: normalizedItems,
      })

      const { data: requestItems, error: requestItemsError } = await supabase
        .from('inventory_request_items')
        .select('id, item_id, requested_qty')
        .eq('request_id', requestId)
      if (requestItemsError) throw requestItemsError
      const decisionItems = (requestItems || []).map((line: any) => ({
        request_item_id: String(line.id),
        approved_qty: Number(line.requested_qty || 0),
      }))
      await decideInventoryRequest(supabase as any, {
        request_id: String(requestId),
        approved: true,
        decision_comment: requestComment,
        actor_user_id: actorUserId,
        items: decisionItems,
      })
      await issueInventoryRequest(supabase as any, String(requestId), actorUserId)
      const totalApproved = decisionItems.reduce((sum: number, item: any) => sum + Number(item.approved_qty || 0), 0)
      await receiveInventoryRequest(supabase as any, String(requestId), {
        received_qty_confirmed: totalApproved,
        received_photo_url: null,
      })

      const result = { request_id: String(requestId), status: 'received', issue_date: issueDate }
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-consumable-issue',
        entityId: String(requestId),
        action: 'create',
        payload: { ...result, items: normalizedItems, point_location_id: pointLocationId },
      })
      return json({ ok: true, data: result })
    }

    return json({ error: 'unsupported-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/consumables.POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
