import { NextResponse } from 'next/server'

import { CAPABILITY_GROUPS, expandCapabilityDeps, getAllCapabilityIds } from '@/lib/core/capabilities'
import { writeAuditLog } from '@/lib/server/audit'
import { invalidateCapabilitiesCache, requireSuperAdmin } from '@/lib/server/capabilities'
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
  const denied = await requireSuperAdmin(access)
  if (denied) return denied

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
  const denied = await requireSuperAdmin(access)
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as
    | { action?: string; role?: string; capability?: string; capabilities?: string[]; granted?: boolean; copy_from_role?: string }
    | null

  if (!body?.action) return json({ error: 'action обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  const role = String(body.role || '').trim()
  if (!role) return json({ error: 'role обязателен' }, 400)

  /**
   * При включении X.action автоматически включается X.view (страница нужна
   * для самого действия). А также явные deps из каталога capabilities.
   */
  function autoEnableDeps(targets: string[]): string[] {
    const result = new Set<string>(targets)
    for (const cap of targets) {
      // 1. Явные deps из каталога (например tasks.create deps: ['operators.view'])
      for (const dep of expandCapabilityDeps(cap)) result.add(dep)
      // 2. Неявная: для action != 'view' добавить '<page>.view'
      const dotIdx = cap.lastIndexOf('.')
      if (dotIdx > 0) {
        const pageId = cap.slice(0, dotIdx)
        const action = cap.slice(dotIdx + 1)
        if (action !== 'view') {
          // Найти страницу с этим pageId и добавить её view
          for (const group of CAPABILITY_GROUPS) {
            for (const page of group.pages) {
              if (page.id === pageId) {
                const viewCap = page.capabilities.find((c) => c.id === `${pageId}.view`)
                if (viewCap) result.add(viewCap.id)
                break
              }
            }
          }
        }
      }
    }
    return Array.from(result)
  }

  // ─── set: одно переключение ────────────────────────────────────────────
  if (body.action === 'set') {
    const capability = String(body.capability || '').trim()
    if (!capability) return json({ error: 'capability обязателен' }, 400)
    const granted = body.granted !== false

    // При granted=true — включаем capability + все её зависимости (autoEnableDeps).
    // При granted=false — выключаем только её саму (без каскада, чтобы не убить
    // зависимые права у других capabilities).
    const targets = granted ? autoEnableDeps([capability]) : [capability]
    const rows = targets.map((cap) => ({ role, capability: cap, granted }))

    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })
    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:${capability}`,
      action: granted ? 'grant' : 'revoke',
      payload: { role, capability, granted, autoEnabled: targets.length > 1 ? targets : undefined },
    })

    invalidateCapabilitiesCache()
    return json({ ok: true, autoEnabled: targets })
  }

  // ─── bulk_set: пачка для одной роли ────────────────────────────────────
  if (body.action === 'bulk_set') {
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : []
    if (!capabilities.length) return json({ error: 'capabilities пуст' }, 400)
    const granted = body.granted !== false

    const targets = granted ? autoEnableDeps(capabilities) : capabilities
    const rows = targets.map((cap) => ({ role, capability: cap, granted }))

    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })

    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:bulk`,
      action: granted ? 'bulk-grant' : 'bulk-revoke',
      payload: { role, capabilities: targets, granted, count: targets.length },
    })

    invalidateCapabilitiesCache()
    return json({ ok: true, count: rows.length })
  }

  // ─── view_only: только просмотр (все *.view = true, остальные = false) ──
  if (body.action === 'view_only') {
    const allCaps = getAllCapabilityIds()
    const rows = allCaps.map((cap) => ({
      role,
      capability: cap,
      granted: cap.endsWith('.view'),
    }))
    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })
    if (error) return json({ error: error.message }, 500)
    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:view-only`,
      action: 'preset',
      payload: { role, preset: 'view_only' },
    })
    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── clear_all: всё выключено для роли ──────────────────────────────────
  if (body.action === 'clear_all') {
    const allCaps = getAllCapabilityIds()
    const rows = allCaps.map((cap) => ({ role, capability: cap, granted: false }))
    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })
    if (error) return json({ error: error.message }, 500)
    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:clear`,
      action: 'preset',
      payload: { role, preset: 'clear_all' },
    })
    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── copy_from: скопировать права с другой роли ─────────────────────────
  if (body.action === 'copy_from') {
    const sourceRole = String(body.copy_from_role || '').trim()
    if (!sourceRole) return json({ error: 'copy_from_role обязателен' }, 400)
    if (sourceRole === role) return json({ error: 'Нельзя копировать с самой себя' }, 400)
    const { data: source } = await supabase
      .from('role_capabilities')
      .select('capability, granted')
      .eq('role', sourceRole)
      .range(0, 999)
    const rows = (source || []).map((r: any) => ({
      role,
      capability: r.capability,
      granted: r.granted,
    }))
    if (rows.length === 0) return json({ error: 'У исходной роли нет прав' }, 400)
    const { error } = await supabase
      .from('role_capabilities')
      .upsert(rows, { onConflict: 'role,capability' })
    if (error) return json({ error: error.message }, 500)
    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'role-capability',
      entityId: `${role}:copy-from-${sourceRole}`,
      action: 'preset',
      payload: { role, preset: 'copy_from', source: sourceRole, count: rows.length },
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
