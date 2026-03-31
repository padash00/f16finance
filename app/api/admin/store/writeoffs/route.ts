import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess, fetchStoreWriteoffs, postInventoryWriteoff } from '@/lib/server/repositories/inventory'
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
  action: 'createWriteoff'
  payload: {
    location_id: string
    written_at: string
    reason: string
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
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
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const data = await fetchStoreWriteoffs(supabase as any, inventoryScope)
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/writeoffs.GET',
      message: error?.message || 'Store writeoffs GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить списания магазина' }, 500)
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
    if (!body?.action || body.action !== 'createWriteoff') return json({ error: 'invalid-action' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const result = await postInventoryWriteoff(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      written_at: body.payload.written_at,
      reason: String(body.payload.reason || '').trim(),
      comment: body.payload.comment || null,
      created_by: actorUserId,
      items: Array.isArray(body.payload.items)
        ? body.payload.items.map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            comment: item.comment || null,
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-writeoff',
      entityId: String(result?.writeoff_id || result?.id || ''),
      action: 'create',
      payload: result,
    })

    return json({ ok: true, data: result })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/writeoffs.POST',
      message: error?.message || 'Store writeoffs POST error',
    })
    return json({ error: error?.message || 'Не удалось провести списание' }, 500)
  }
}
