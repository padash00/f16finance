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

  // Supabase по умолчанию отдаёт макс 1000 строк, а у нас 6 ролей × 265 = 1590.
  // Явно расширяем диапазон чтобы получить всё.
  const { data: rows, error } = await supabase
    .from('role_capabilities')
    .select('role, capability, granted')
    .range(0, 9999)

  if (error) return json({ error: error.message }, 500)

  // Список всех ролей: те что в БД + builtin
  const dbRoles = Array.from(new Set((rows || []).map((r: any) => r.role)))
  const builtinRoles = ['owner', 'manager', 'marketer', 'other', 'super_admin']
  const roles = Array.from(new Set([...builtinRoles, ...dbRoles])).sort()

  return json({ items: rows || [], roles })
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
        { role, capability, granted, updated_at: new Date().toISOString() },
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
      updated_at: new Date().toISOString(),
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
      updated_at: new Date().toISOString(),
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
