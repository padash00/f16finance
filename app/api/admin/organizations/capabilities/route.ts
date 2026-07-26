import { NextResponse } from 'next/server'

import { getAllCapabilityIds } from '@/lib/core/capabilities'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { invalidateOrgCapabilitiesCache, requireSuperAdmin } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Список выключенных супер-админом действий для организации. */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = requireSuperAdmin(access)
    if (denied) return denied

    const url = new URL(request.url)
    const organizationId = url.searchParams.get('organization_id') || ''
    if (!organizationId) return json({ error: 'organization_id обязателен' }, 400)
    if (!hasAdminSupabaseCredentials()) return json({ ok: true, disabled: [] })

    const supabase = createAdminSupabaseClient()
    const { data } = await supabase
      .from('organization_capability_overrides')
      .select('capability, enabled')
      .eq('organization_id', organizationId)
      .eq('enabled', false)
      .range(0, 9999)

    const disabled = (data || []).map((r: any) => String(r.capability)).filter(Boolean)
    return json({ ok: true, disabled })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organizations/capabilities GET',
      message: error?.message || 'org caps GET failed',
    })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

type Item = { capability: string; disabled: boolean }

/** Выключить/включить действие(я) для всей организации (общий рубильник). */
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = requireSuperAdmin(access)
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const organizationId = String(body?.organization_id || '').trim()
    if (!organizationId) return json({ error: 'organization_id обязателен' }, 400)

    // Поддерживаем и одиночную правку, и массовую.
    const rawItems: Item[] = Array.isArray(body?.items)
      ? body.items
      : body?.capability != null
        ? [{ capability: String(body.capability), disabled: !!body.disabled }]
        : []
    if (rawItems.length === 0) return json({ error: 'Нет изменений' }, 400)

    const validIds = new Set(getAllCapabilityIds())
    const items = rawItems
      .map((i) => ({ capability: String(i.capability || '').trim(), disabled: !!i.disabled }))
      .filter((i) => i.capability && validIds.has(i.capability))
    if (items.length === 0) return json({ error: 'Неизвестные действия' }, 400)

    if (!hasAdminSupabaseCredentials()) return json({ error: 'Нет admin-доступа к БД' }, 500)
    const supabase = createAdminSupabaseClient()

    const toDisable = items.filter((i) => i.disabled).map((i) => i.capability)
    const toEnable = items.filter((i) => !i.disabled).map((i) => i.capability)

    if (toDisable.length > 0) {
      const rows = toDisable.map((capability) => ({
        organization_id: organizationId,
        capability,
        enabled: false,
        updated_at: new Date().toISOString(),
        updated_by: access.user?.id || null,
      }))
      const { error } = await supabase
        .from('organization_capability_overrides')
        .upsert(rows, { onConflict: 'organization_id,capability' })
      if (error) throw error
    }

    if (toEnable.length > 0) {
      // Включить обратно = убрать оверрайд (вернуться к дефолту «доступно»).
      const { error } = await supabase
        .from('organization_capability_overrides')
        .delete()
        .eq('organization_id', organizationId)
        .in('capability', toEnable)
      if (error) throw error
    }

    invalidateOrgCapabilitiesCache(organizationId)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'organization',
      entityId: organizationId,
      action: 'update',
      payload: { org_capability_overrides: { disabled: toDisable, enabled: toEnable } },
    })

    // Актуальный список выключенных — вернём фронту.
    const { data } = await supabase
      .from('organization_capability_overrides')
      .select('capability')
      .eq('organization_id', organizationId)
      .eq('enabled', false)
      .range(0, 9999)
    const disabled = (data || []).map((r: any) => String(r.capability)).filter(Boolean)

    return json({ ok: true, disabled })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organizations/capabilities POST',
      message: error?.message || 'org caps POST failed',
    })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
