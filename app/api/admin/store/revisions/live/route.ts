import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/

// Живые изменения остатка локации с момента `since` — для «живой» ревизии.
// Возвращает свежие остатки локации + движения (со знаком: приход +, расход -),
// чтобы фронт мог обновить «Систему» и подкорректировать «Факт» по уже посчитанным
// товарам, если во время подсчёта прошла продажа/долг/возврат.
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const locationId = String(url.searchParams.get('location_id') || '').trim()
    const since = String(url.searchParams.get('since') || '').trim()
    if (!UUID_RE.test(locationId)) return json({ error: 'invalid-location' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    await ensureInventoryLocationAccess(supabase as any, locationId, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    })

    const nowIso = new Date().toISOString()

    let mq = supabase
      .from('inventory_movements')
      .select('id, item_id, movement_type, quantity, from_location_id, to_location_id, created_at')
      .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
      .order('created_at', { ascending: true })
      .limit(1000)
    if (since && /^[0-9T:.\-+Z ]{10,40}$/.test(since)) mq = mq.gt('created_at', since)
    const { data: moves, error: movesErr } = await mq
    if (movesErr) throw movesErr

    const rows = (moves || []) as any[]
    const itemIds = Array.from(new Set(rows.map((r) => String(r.item_id)).filter(Boolean)))
    const nameById = new Map<string, string>()
    if (itemIds.length) {
      const { data: items } = await supabase.from('inventory_items').select('id, name').in('id', itemIds)
      for (const it of items || []) nameById.set(String((it as any).id), String((it as any).name || ''))
    }

    const movements = rows
      .map((r) => {
        const isOut = String(r.from_location_id) === locationId
        const isIn = String(r.to_location_id) === locationId
        const qty = Number(r.quantity) || 0
        const delta = (isIn ? qty : 0) - (isOut ? qty : 0)
        return {
          id: String(r.id),
          item_id: String(r.item_id),
          item_name: nameById.get(String(r.item_id)) || '',
          movement_type: String(r.movement_type),
          delta,
          created_at: String(r.created_at),
        }
      })
      .filter((m) => m.delta !== 0)

    const { data: balances } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .eq('location_id', locationId)

    return json({ ok: true, data: { now: nowIso, movements, balances: balances || [] } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/revisions/live.GET',
      message: error?.message || 'live changes error',
    })
    return json({ error: error?.message || 'Не удалось получить изменения' }, 500)
  }
}
