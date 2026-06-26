import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
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
    const url = new URL(request.url)
    const locationId = String(url.searchParams.get('location_id') || '').trim()
    const date = String(url.searchParams.get('date') || '').trim() || todayISO()
    if (!locationId) return json({ error: 'location_id обязателен' }, 400)
    await ensureInventoryLocationAccess(s.supabase as any, locationId, s.inventoryScope)

    const { data, error } = await s.supabase
      .from(TABLE)
      .select('item_id, actual_qty, counted_by, updated_at')
      .eq('location_id', locationId)
      .eq('draft_date', date)
    if (error) return json({ error: error.message }, 500)

    const counts: Record<string, number> = {}
    for (const r of data || []) counts[String((r as any).item_id)] = Number((r as any).actual_qty || 0)
    return json({ ok: true, data: { counts, items: data || [] } })
  } catch (error: any) {
    if (error?.message === 'forbidden-location' || error?.message === 'inventory-location-not-found') return json({ error: 'forbidden' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'revisions/draft.GET', message: error?.message || 'draft get error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

// POST { location_id, item_id, actual_qty, date? } — записать подсчёт по позиции
export async function POST(request: Request) {
  try {
    const s = await setup(request)
    if ('response' in s) return s.response
    const body = (await request.json().catch(() => null)) as any
    const locationId = String(body?.location_id || '').trim()
    const itemId = String(body?.item_id || '').trim()
    const date = String(body?.date || '').trim() || todayISO()
    const qty = Number(body?.actual_qty)
    if (!locationId || !itemId || !Number.isFinite(qty)) return json({ error: 'location_id, item_id, actual_qty обязательны' }, 400)
    await ensureInventoryLocationAccess(s.supabase as any, locationId, s.inventoryScope)

    const { error } = await s.supabase.from(TABLE).upsert(
      {
        location_id: locationId,
        item_id: itemId,
        draft_date: date,
        actual_qty: qty,
        counted_by: s.actorUserId,
        organization_id: s.inventoryScope.organizationId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'location_id,item_id,draft_date' },
    )
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
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
