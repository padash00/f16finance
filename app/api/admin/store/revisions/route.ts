import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess, fetchStoreRevisions, postInventoryStocktake } from '@/lib/server/repositories/inventory'
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
  action: 'createRevision'
  payload: {
    location_id: string
    counted_at: string
    comment?: string | null
    items: Array<{
      item_id: string
      actual_qty: number
      comment?: string | null
    }>
  }
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
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const data = await fetchStoreRevisions(supabase as any, inventoryScope)
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/revisions.GET',
      message: error?.message || 'Store revisions GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить ревизии магазина' }, 500)
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
    if (!body?.action || body.action !== 'createRevision') return json({ error: 'invalid-action' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const result = await postInventoryStocktake(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      counted_at: body.payload.counted_at,
      comment: body.payload.comment || null,
      created_by: actorUserId,
      items: Array.isArray(body.payload.items)
        ? body.payload.items.map((item) => ({
            item_id: String(item.item_id || '').trim(),
            actual_qty: normalizeQty(item.actual_qty),
            comment: item.comment || null,
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-stocktake',
      entityId: String(result?.stocktake_id || result?.id || ''),
      action: 'create',
      payload: result,
    })

    return json({ ok: true, data: result })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/revisions.POST',
      message: error?.message || 'Store revisions POST error',
    })
    return json({ error: error?.message || 'Не удалось провести ревизию' }, 500)
  }
}
