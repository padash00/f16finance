import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const TABLE = 'inventory_revision_drafts'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// PostgREST молча режет ответ до 1000 строк — черновик большой ревизии забираем постранично.
const PAGE_SIZE = 1000
async function fetchAllPages<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

async function setup(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return { response: access.response as Response }
  if (!canManageStore(access)) return { response: json({ error: 'forbidden' }, 403) }
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
  return { access, supabase, inventoryScope, actorUserId: access.user?.id || null }
}

// GET ?location_id=&date= — общий черновик точки (подсчёты всех кассиров)
export async function GET(request: Request) {
  try {
    const s = await setup(request)
    if ('response' in s) return s.response
    const denied = await requireCapability(s.access, 'store-revisions.view')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(s.access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard
    const url = new URL(request.url)
    const locationId = String(url.searchParams.get('location_id') || '').trim()
    const date = String(url.searchParams.get('date') || '').trim() || todayISO()
    if (!locationId) return json({ error: 'location_id обязателен' }, 400)
    await ensureInventoryLocationAccess(s.supabase as any, locationId, s.inventoryScope)

    // Ревизия большой локации — >1000 посчитанных позиций: постранично,
    // иначе часть подсчётов молча пропадает из общего черновика.
    const data = await fetchAllPages((from, to) =>
      s.supabase
        .from(TABLE)
        .select('item_id, actual_qty, counted_by, updated_at')
        .eq('location_id', locationId)
        .eq('draft_date', date)
        .order('item_id')
        .range(from, to),
    )

    const counts: Record<string, number> = {}
    for (const r of data || []) counts[String((r as any).item_id)] = Number((r as any).actual_qty || 0)
    return json({ ok: true, data: { counts, items: data || [] } })
  } catch (error: any) {
    if (error?.message === 'forbidden-location' || error?.message === 'inventory-location-not-found') return json({ error: 'forbidden' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'revisions/draft.GET', message: error?.message || 'draft get error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

// POST — записать подсчёт. Один: { location_id, item_id, actual_qty, date? }
// ИЛИ пачкой: { location_id, items: [{item_id, actual_qty}], date? }
export async function POST(request: Request) {
  try {
    const s = await setup(request)
    if ('response' in s) return s.response
    const denied = await requireCapability(s.access, 'store-revisions.edit')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(s.access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard
    const body = (await request.json().catch(() => null)) as any
    const locationId = String(body?.location_id || '').trim()
    const date = String(body?.date || '').trim() || todayISO()
    if (!locationId) return json({ error: 'location_id обязателен' }, 400)
    await ensureInventoryLocationAccess(s.supabase as any, locationId, s.inventoryScope)

    const now = new Date().toISOString()
    const rawItems = Array.isArray(body?.items)
      ? body.items
      : [{ item_id: body?.item_id, actual_qty: body?.actual_qty }]
    const rows = rawItems
      .map((it: any) => ({ item_id: String(it?.item_id || '').trim(), qty: Number(it?.actual_qty) }))
      .filter((it: any) => it.item_id && Number.isFinite(it.qty))
      .map((it: any) => ({
        location_id: locationId,
        item_id: it.item_id,
        draft_date: date,
        actual_qty: it.qty,
        counted_by: s.actorUserId,
        organization_id: s.inventoryScope.organizationId,
        updated_at: now,
      }))
    if (rows.length === 0) return json({ error: 'нет валидных позиций' }, 400)

    const { error } = await s.supabase.from(TABLE).upsert(rows, { onConflict: 'location_id,item_id,draft_date' })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, data: { saved: rows.length } })
  } catch (error: any) {
    if (error?.message === 'forbidden-location' || error?.message === 'inventory-location-not-found') return json({ error: 'forbidden' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'revisions/draft.POST', message: error?.message || 'draft post error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

// DELETE ?location_id=&date= — очистить черновик (после проведения / сброса)
export async function DELETE(request: Request) {
  try {
    const s = await setup(request)
    if ('response' in s) return s.response
    const denied = await requireCapability(s.access, 'store-revisions.cancel')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(s.access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard
    const url = new URL(request.url)
    const locationId = String(url.searchParams.get('location_id') || '').trim()
    const date = String(url.searchParams.get('date') || '').trim() || todayISO()
    if (!locationId) return json({ error: 'location_id обязателен' }, 400)
    await ensureInventoryLocationAccess(s.supabase as any, locationId, s.inventoryScope)
    const { error } = await s.supabase.from(TABLE).delete().eq('location_id', locationId).eq('draft_date', date)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  } catch (error: any) {
    if (error?.message === 'forbidden-location' || error?.message === 'inventory-location-not-found') return json({ error: 'forbidden' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'revisions/draft.DELETE', message: error?.message || 'draft delete error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
