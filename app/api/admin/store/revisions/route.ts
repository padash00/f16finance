import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import {
  ensureInventoryLocationAccess,
  fetchOpenTransferRequestsForLocation,
  fetchStoreRevisions,
  postInventoryStocktake,
} from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function normalizeUserDisplayName(user: any): string | null {
  const meta = (user?.user_metadata || {}) as Record<string, unknown>
  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  if (fullName) return fullName
  if (name) return name
  if (email) return email
  return null
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
    const denied = await requireCapability(access, 'store-revisions.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

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
    const data = await fetchStoreRevisions(supabase as any, inventoryScope)
    const actorIds = Array.from(
      new Set(
        (data.stocktakes || [])
          .map((s: any) => String(s?.created_by || '').trim())
          .filter(Boolean),
      ),
    )
    if (actorIds.length > 0) {
      const actorById: Record<string, { id: string; full_name: string | null; role: string | null }> = {}
      const [{ data: staffRows }, { data: memberRows }] = await Promise.all([
        supabase.from('staff').select('id, full_name, role').in('id', actorIds),
        access.activeOrganization?.id
          ? supabase
              .from('organization_members')
              .select('user_id, staff_id, role')
              .eq('organization_id', access.activeOrganization.id)
              .eq('status', 'active')
              .in('user_id', actorIds)
          : Promise.resolve({ data: [] as any[] }),
      ])
      for (const row of staffRows || []) {
        const id = String((row as any)?.id || '').trim()
        if (!id) continue
        actorById[id] = {
          id,
          full_name: ((row as any)?.full_name as string) || null,
          role: ((row as any)?.role as string) || null,
        }
      }
      const staffIds = Array.from(
        new Set(
          (memberRows || [])
            .map((m: any) => String(m?.staff_id || '').trim())
            .filter(Boolean),
        ),
      )
      const staffById = new Map<string, { full_name: string | null; role: string | null }>()
      if (staffIds.length > 0) {
        const { data: staffByMemberRows } = await supabase
          .from('staff')
          .select('id, full_name, role')
          .in('id', staffIds)
        for (const row of staffByMemberRows || []) {
          const id = String((row as any)?.id || '').trim()
          if (!id) continue
          staffById.set(id, {
            full_name: ((row as any)?.full_name as string) || null,
            role: ((row as any)?.role as string) || null,
          })
        }
      }
      for (const row of memberRows || []) {
        const userId = String((row as any)?.user_id || '').trim()
        if (!userId || actorById[userId]) continue
        const staffId = String((row as any)?.staff_id || '').trim()
        const staffMeta = staffId ? staffById.get(staffId) : null
        actorById[userId] = {
          id: userId,
          full_name: staffMeta?.full_name || null,
          role: staffMeta?.role || ((row as any)?.role as string) || null,
        }
      }
      const unresolvedIds = actorIds.filter((id) => !actorById[id])
      if (unresolvedIds.length > 0 && hasAdminSupabaseCredentials()) {
        const admin = createAdminSupabaseClient()
        await Promise.all(
          unresolvedIds.map(async (userId) => {
            try {
              const { data: authUser, error } = await admin.auth.admin.getUserById(userId)
              if (error || !authUser?.user) return
              actorById[userId] = {
                id: userId,
                full_name: normalizeUserDisplayName(authUser.user),
                role: null,
              }
            } catch {
              // ignore unresolved legacy actor ids
            }
          }),
        )
      }
      data.stocktakes = (data.stocktakes || []).map((s: any) => ({
        ...s,
        created_by_staff: s?.created_by ? actorById[String(s.created_by)] || null : null,
      }))
    }
    const locationType = scope === 'showcase' ? 'point_display' : scope === 'warehouse' ? 'warehouse' : null
    if (locationType) {
      data.locations = (data.locations || []).filter((l: any) => l?.location_type === locationType)
      data.balances = (data.balances || []).filter((b: any) => b?.location?.location_type === locationType)
      data.stocktakes = (data.stocktakes || []).filter((s: any) => s?.location?.location_type === locationType)
    }
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
    const denied = await requireCapability(access, 'store-revisions.commit')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

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
    const locationId = String(body.payload.location_id || '').trim()
    await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)
    const openTransfers = await fetchOpenTransferRequestsForLocation(supabase as any, locationId, inventoryScope)
    if (openTransfers.length > 0) {
      return json(
        {
          error: 'inventory-stocktake-open-transfers',
          message: 'Есть заявки склад ↔ витрина в пути. Сначала выдайте и подтвердите получение товара, затем проводите ревизию.',
          requests: openTransfers.map((row: any) => ({ id: row.id, status: row.status, created_at: row.created_at })),
        },
        409,
      )
    }

    const result = await postInventoryStocktake(supabase as any, {
      location_id: locationId,
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
