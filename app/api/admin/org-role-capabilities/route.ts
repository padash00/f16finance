import { NextResponse } from 'next/server'

import { CAPABILITY_GROUPS, expandCapabilityDeps, getAllCapabilityIds } from '@/lib/core/capabilities'
import { writeAuditLog } from '@/lib/server/audit'
import { invalidateCapabilitiesCache, requireStaffCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Слой 2 RBAC: правка ролей ВНУТРИ организации (org_role_capabilities).
// В отличие от /api/admin/role-capabilities (глобал, только суперадмин), тут
// владелец/менеджер режет-включает свои роли ТОЛЬКО в своей орг. Скоуп жёстко
// по access.activeOrganization.id — чужую орг не тронуть.

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Роли, доступные для орг-редактирования (super_admin не редактируется — он в обходе).
const BUILTIN_ROLES = ['owner', 'manager', 'marketer', 'other']

// Базовый (глобальный) эффективный грант для роли/права ДО орг-слоя.
// Повторяет fail-open из loadUserCapabilities: staff-роли имеют всё, кроме явно
// снятого (granted=false) в глобальной role_capabilities; роль 'other' — пусто.
function baseGranted(role: string, capability: string, globalOff: Set<string>): boolean {
  if (role === 'other') return false
  return !globalOff.has(`${role}:${capability}`)
}

/**
 * При включении X.action автоматически включается X.view (страница нужна для
 * действия) + явные deps из каталога. Копия логики глобального роута.
 */
function autoEnableDeps(targets: string[]): string[] {
  const result = new Set<string>(targets)
  for (const cap of targets) {
    for (const dep of expandCapabilityDeps(cap)) result.add(dep)
    const dotIdx = cap.lastIndexOf('.')
    if (dotIdx > 0) {
      const pageId = cap.slice(0, dotIdx)
      const action = cap.slice(dotIdx + 1)
      if (action !== 'view') {
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

async function resolveScope(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return { error: access.response as NextResponse }
  // Доступ к редактированию прав — capability access.toggle_capability (staff-only).
  const denied = await requireStaffCapability(access as any, 'access.toggle_capability')
  if (denied) return { error: denied as NextResponse }

  const orgId = access.isSuperAdmin ? null : access.activeOrganization?.id || null
  // Суперадмину тут делать нечего — у него глобальный роут. Требуем реальную орг.
  if (!orgId) return { error: json({ error: 'Требуется активная организация' }, 400) }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  return { access, orgId, supabase }
}

// Список ролей орг: builtin + кастомные должности (positions глобальны, но
// применяются в каждой орг).
async function loadRoles(supabase: any): Promise<string[]> {
  const set = new Set<string>(BUILTIN_ROLES)
  try {
    const { data } = await supabase.from('positions').select('name').range(0, 999)
    for (const r of (data || []) as Array<{ name: string }>) if (r.name) set.add(r.name)
  } catch {
    /* positions может не быть */
  }
  return Array.from(set).sort()
}

// Глобальные «снятые» права (role_capabilities granted=false) — база fail-open.
async function loadGlobalOff(supabase: any): Promise<Set<string>> {
  const off = new Set<string>()
  const { data } = await supabase.from('role_capabilities').select('role, capability, granted').eq('granted', false).range(0, 100000)
  for (const r of (data || []) as Array<{ role: string; capability: string; granted: boolean }>) {
    off.add(`${r.role}:${r.capability}`)
  }
  return off
}

/**
 * GET → { items: [{ role, capability, granted }], roles }
 * items — ПЛОТНЫЙ эффективный срез (глобал fail-open ⊕ орг-слой), чтобы
 * панель показывала реальное текущее состояние даже при пустом орг-слое.
 */
export async function GET(request: Request) {
  const scope = await resolveScope(request)
  if ('error' in scope) return scope.error
  const { orgId, supabase } = scope

  const [roles, globalOff] = await Promise.all([loadRoles(supabase), loadGlobalOff(supabase)])

  // Орг-оверрайды.
  const orgMap = new Map<string, boolean>()
  const { data: orgRows } = await supabase
    .from('org_role_capabilities')
    .select('role, capability, granted')
    .eq('organization_id', orgId)
    .range(0, 100000)
  for (const r of (orgRows || []) as Array<{ role: string; capability: string; granted: boolean }>) {
    orgMap.set(`${r.role}:${r.capability}`, r.granted)
  }

  const allCaps = getAllCapabilityIds()
  const items: Array<{ role: string; capability: string; granted: boolean }> = []
  for (const role of roles) {
    for (const cap of allCaps) {
      const key = `${role}:${cap}`
      const granted = orgMap.has(key) ? orgMap.get(key)! : baseGranted(role, cap, globalOff)
      items.push({ role, capability: cap, granted })
    }
  }

  return json({ items, roles, scope: 'org' })
}

/**
 * POST — те же action, что у глобального роута, но пишут в org_role_capabilities
 * со скоупом organization_id. Действия: set | bulk_set | view_only | clear_all |
 * copy_from | reset_role.
 */
export async function POST(request: Request) {
  const scope = await resolveScope(request)
  if ('error' in scope) return scope.error
  const { access, orgId, supabase } = scope

  const body = (await request.json().catch(() => null)) as
    | { action?: string; role?: string; capability?: string; capabilities?: string[]; granted?: boolean; copy_from_role?: string }
    | null
  if (!body?.action) return json({ error: 'action обязателен' }, 400)

  const role = String(body.role || '').trim()
  if (!role) return json({ error: 'role обязателен' }, 400)
  if (role === 'super_admin') return json({ error: 'Роль super_admin не редактируется в организации' }, 400)

  const upsert = (rows: Array<{ capability: string; granted: boolean }>) =>
    supabase
      .from('org_role_capabilities')
      .upsert(
        rows.map((r) => ({ organization_id: orgId, role, capability: r.capability, granted: r.granted, updated_at: new Date().toISOString() })),
        { onConflict: 'organization_id,role,capability' },
      )

  const audit = (action: string, payload: Record<string, unknown>) =>
    writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'org-role-capability',
      entityId: `${orgId}:${role}`,
      action,
      payload: { organizationId: orgId, role, ...payload },
    })

  // ─── set ───────────────────────────────────────────────────────────────
  if (body.action === 'set') {
    const capability = String(body.capability || '').trim()
    if (!capability) return json({ error: 'capability обязателен' }, 400)
    const granted = body.granted !== false
    const targets = granted ? autoEnableDeps([capability]) : [capability]
    const { error } = await upsert(targets.map((c) => ({ capability: c, granted })))
    if (error) return json({ error: error.message }, 500)
    await audit(granted ? 'grant' : 'revoke', { capability, granted, autoEnabled: targets.length > 1 ? targets : undefined })
    invalidateCapabilitiesCache()
    return json({ ok: true, autoEnabled: targets })
  }

  // ─── bulk_set ──────────────────────────────────────────────────────────
  if (body.action === 'bulk_set') {
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : []
    if (!capabilities.length) return json({ error: 'capabilities пуст' }, 400)
    const granted = body.granted !== false
    const targets = granted ? autoEnableDeps(capabilities) : capabilities
    const { error } = await upsert(targets.map((c) => ({ capability: c, granted })))
    if (error) return json({ error: error.message }, 500)
    await audit(granted ? 'bulk-grant' : 'bulk-revoke', { capabilities: targets, granted, count: targets.length })
    invalidateCapabilitiesCache()
    return json({ ok: true, count: targets.length })
  }

  // ─── view_only ─────────────────────────────────────────────────────────
  if (body.action === 'view_only') {
    const allCaps = getAllCapabilityIds()
    const { error } = await upsert(allCaps.map((c) => ({ capability: c, granted: c.endsWith('.view') })))
    if (error) return json({ error: error.message }, 500)
    await audit('preset', { preset: 'view_only' })
    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── clear_all ─────────────────────────────────────────────────────────
  if (body.action === 'clear_all') {
    const allCaps = getAllCapabilityIds()
    const { error } = await upsert(allCaps.map((c) => ({ capability: c, granted: false })))
    if (error) return json({ error: error.message }, 500)
    await audit('preset', { preset: 'clear_all' })
    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── reset_role: снять орг-оверрайды роли → вернуться к глобальному дефолту ─
  if (body.action === 'reset_role') {
    const { error } = await supabase
      .from('org_role_capabilities')
      .delete()
      .eq('organization_id', orgId)
      .eq('role', role)
    if (error) return json({ error: error.message }, 500)
    await audit('reset', { note: 'org overrides cleared → global default' })
    invalidateCapabilitiesCache()
    return json({ ok: true })
  }

  // ─── copy_from: скопировать эффективные права другой роли в орг-слой ──────
  if (body.action === 'copy_from') {
    const source = String(body.copy_from_role || '').trim()
    if (!source) return json({ error: 'copy_from_role обязателен' }, 400)
    if (source === role) return json({ error: 'Нельзя копировать с самой себя' }, 400)
    const globalOff = await loadGlobalOff(supabase)
    const orgMap = new Map<string, boolean>()
    const { data: orgRows } = await supabase
      .from('org_role_capabilities')
      .select('role, capability, granted')
      .eq('organization_id', orgId)
      .eq('role', source)
      .range(0, 100000)
    for (const r of (orgRows || []) as Array<{ role: string; capability: string; granted: boolean }>) {
      orgMap.set(r.capability, r.granted)
    }
    const allCaps = getAllCapabilityIds()
    const rows = allCaps.map((c) => ({
      capability: c,
      granted: orgMap.has(c) ? orgMap.get(c)! : baseGranted(source, c, globalOff),
    }))
    const { error } = await upsert(rows)
    if (error) return json({ error: error.message }, 500)
    await audit('preset', { preset: 'copy_from', source, count: rows.length })
    invalidateCapabilitiesCache()
    return json({ ok: true, count: rows.length })
  }

  return json({ error: `Неизвестное action: ${body.action}` }, 400)
}
