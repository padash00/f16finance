import { NextResponse } from 'next/server'

import { getAllCapabilityIds } from '@/lib/core/capabilities'
import { writeAuditLog } from '@/lib/server/audit'
import { invalidateCapabilitiesCache } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * GET /api/admin/role-capabilities
 * → { items: [{ role, capability, granted }, ...], roles: string[] }
 *
 * Отдаёт все настройки прав для всех ролей. Используется страницей /access.
 */
export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  // Сначала собираем список всех ролей. Supabase по умолчанию режет до 1000 строк
  // (db.maxRows), но distinct по role даёт всего ~10 строк — точно влезет.
  const builtinRoles = ['owner', 'manager', 'marketer', 'other', 'super_admin']

  // Из таблицы positions (кастомные роли)
  const { data: positionRows } = await supabase
    .from('positions')
    .select('name')
    .range(0, 999)

  // Distinct из самой role_capabilities (через group_by нет, но distinct работает)
  const { data: distinctRoles } = await supabase
    .from('role_capabilities')
    .select('role')
    .order('role')
    .range(0, 999)

  const allRoleSet = new Set<string>(builtinRoles)
  for (const r of (positionRows || []) as Array<{ name: string }>) {
    if (r.name) allRoleSet.add(r.name)
  }
  for (const r of (distinctRoles || []) as Array<{ role: string }>) {
    if (r.role) allRoleSet.add(r.role)
  }
  const roles = Array.from(allRoleSet).sort()

  // Затем за каждой ролью идём отдельным запросом (265 строк, в лимит влезает).
  // Параллельно — быстро.
  const perRoleResults = await Promise.all(
    roles.map((role) =>
      supabase
        .from('role_capabilities')
        .select('role, capability, granted')
        .eq('role', role)
        .range(0, 999),
    ),
  )

  const items: Array<{ role: string; capability: string; granted: boolean }> = []
  for (const r of perRoleResults) {
    if (r.error) {
      console.warn('role-capabilities query error', r.error)
      continue
    }
    items.push(...(r.data || []))
  }

  return json({ items, roles })
}

/**
 * POST /api/admin/role-capabilities
 * Body: { action: 'set' | 'bulk_set' | 'reset_role', ... }
 *
 * 'set':       { role, capability, granted }                 — переключить одно
 * 'bulk_set':  { role, capabilities: string[], granted }     — пачкой
 * 'reset_role': { role }                                     — открыть всё для роли
 *
 * Только для super admin. Записывает в audit_log.
 */
export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

  const body = (await request.json().catch(() => null)) as
    | { action?: string; role?: string; capability?: string; capabilities?: string[]; granted?: boolean }
    | null

  if (!body?.action) return json({ error: 'action обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  const role = String(body.role || '').trim()
  if (!role) return json({ error: 'role обязателен' }, 400)

  // ─── set: одно переключение ────────────────────────────────────────────
  if (body.action === 'set') {
    const capability = String(body.capability || '').trim()
    if (!capability) return json({ error: 'capability обязателен' }, 400)
    const granted = body.granted !== false

    const { error } = await supabase
      .from('role_capabilities')
      .upsert(
        { role, capability, granted },
        { onConflict: 'role,capability' },
      )
    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:${capability}`,
      action: granted ? 'grant' : 'revoke',
      payload: { role, capability, granted },
    })

    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── bulk_set: пачка для одной роли ────────────────────────────────────
  if (body.action === 'bulk_set') {
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : []
    if (!capabilities.length) return json({ error: 'capabilities пуст' }, 400)
    const granted = body.granted !== false

    const rows = capabilities.map((capability) => ({
      role,
      capability,
      granted,
    }))

    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })

    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:bulk`,
      action: granted ? 'bulk-grant' : 'bulk-revoke',
      payload: { role, capabilities, granted, count: capabilities.length },
    })

    invalidateCapabilitiesCache()
    return json({ ok: true, count: rows.length })
  }

  // ─── reset_role: открыть всё для роли ───────────────────────────────────
  if (body.action === 'reset_role') {
    const allCaps = getAllCapabilityIds()
    const rows = allCaps.map((capability) => ({
      role,
      capability,
      granted: true,
    }))
    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })
    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:reset`,
      action: 'reset',
      payload: { role, count: rows.length },
    })

    invalidateCapabilitiesCache()
    return json({ ok: true, count: rows.length })
  }

  return json({ error: `Неизвестное action: ${body.action}` }, 400)
}
