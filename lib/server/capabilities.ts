/**
 * Серверная логика capabilities — загрузка прав текущего пользователя
 * и проверка `requireCapability()` в API routes.
 *
 * Использование:
 *
 *   export async function POST(request: Request) {
 *     const access = await getRequestAccessContext(request)
 *     if ('response' in access) return access.response
 *
 *     const denied = await requireCapability(access, 'income.create')
 *     if (denied) return denied
 *
 *     // ... основная логика
 *   }
 *
 * Принципы:
 * - super_admin (isAdminEmail) — может всё, проверка пропускается
 * - на остальных загружаем capabilities из role_capabilities + overrides
 * - кэш в памяти процесса (TTL 60 секунд) чтобы не дёргать БД на каждом
 *   запросе
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { getAllCapabilityIds } from '@/lib/core/capabilities'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type CapabilitiesCache = {
  capabilities: Set<string>
  loadedAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CapabilitiesCache>()

function cacheKey(userId: string, role: string | null, organizationId?: string | null): string {
  return `${userId}:${role || ''}:${organizationId || ''}`
}

/**
 * Загружает все capabilities текущего пользователя из БД:
 *   role_capabilities (по роли) + user_capability_overrides (по юзеру)
 *
 * Возвращает Set<capability_id>. Если набор пустой — у юзера нет ни одного права.
 */
export async function loadUserCapabilities(
  userId: string,
  role: string | null,
  organizationId?: string | null,
): Promise<Set<string>> {
  if (!hasAdminSupabaseCredentials()) return new Set()

  const key = cacheKey(userId, role, organizationId)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.capabilities
  }

  const supabase = createAdminSupabaseClient()

  // FAIL-OPEN для STAFF-ролей (как и задумано сидом: «никто прав не теряет»).
  // Базово staff имеет ВСЕ права каталога; админ на /access их только ОТНИМАЕТ
  // (granted=false). Снимает лок-аут на новые права, которых ещё нет в
  // role_capabilities. Операторы (role='other') и без роли — пустой набор
  // (в админ-роуты их всё равно не пускает staffMember-проверка).
  const isStaffRole = !!role && role !== 'other'
  const result = new Set<string>(isStaffRole ? getAllCapabilityIds() : [])

  // Владелец организации = верхняя роль тенанта → ВСЕГДА полный набор прав.
  // Страницы ограничивает ПАКЕТ (orgFeatures), а не права владельца. Снятия из
  // глобальной role_capabilities к owner НЕ применяем: иначе платформенная
  // правка роли «owner» на одном арендаторе (таблица общая) урезала бы
  // владельцев ВСЕХ клиентов (напр. пропадала бы страница токенов /point-devices).
  if (role === 'owner') {
    cache.set(key, { capabilities: result, loadedAt: Date.now() })
    return result
  }

  // 1) role_capabilities — что ОТНЯТО у роли (granted=false). granted=true — no-op.
  if (role) {
    const { data: roleRows } = await supabase
      .from('role_capabilities')
      .select('capability, granted')
      .eq('role', role)
      .range(0, 999)

    for (const row of (roleRows || []) as Array<{ capability: string; granted: boolean }>) {
      if (!row.granted) result.delete(row.capability)
    }
  }

  // 2) org_role_capabilities — правка роли ВНУТРИ организации (слой 2).
  //    Суперадмин рулит глобальным дефолтом (слой 1 выше), а каждая орг режет/
  //    включает свои роли только у себя. Пусто/нет таблицы → no-op.
  if (role && organizationId) {
    try {
      const { data: orgRoleRows } = await supabase
        .from('org_role_capabilities')
        .select('capability, granted')
        .eq('organization_id', organizationId)
        .eq('role', role)
        .range(0, 999)
      for (const row of (orgRoleRows || []) as Array<{ capability: string; granted: boolean }>) {
        if (row.granted) result.add(row.capability)
        else result.delete(row.capability)
      }
    } catch {
      // Таблицы org_role_capabilities может ещё не быть (миграция не применена).
    }
  }

  // 3) user_capability_overrides — точечно по человеку (высший приоритет).
  const { data: overrideRows } = await supabase
    .from('user_capability_overrides')
    .select('capability, granted')
    .eq('user_id', userId)
    .range(0, 999)

  for (const row of (overrideRows || []) as Array<{ capability: string; granted: boolean }>) {
    if (row.granted) result.add(row.capability)
    else result.delete(row.capability)
  }

  cache.set(key, { capabilities: result, loadedAt: Date.now() })
  return result
}

/**
 * Сбросить кэш капабилити для конкретного пользователя.
 * Вызывать после изменения прав через UI на странице /access.
 */
export function invalidateCapabilitiesCache(userId?: string): void {
  if (!userId) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key)
  }
}

type AccessLike = {
  user?: { id?: string | null } | null
  isSuperAdmin?: boolean
  staffRole?: string | null
  staffMember?: { role?: string | null } | null
  activeOrganization?: { id?: string | null } | null
}

/**
 * Главная функция-проверка для API routes.
 *
 * Возвращает Response (403) если права нет, или null если разрешено.
 * Super admin всегда получает null.
 */
export async function requireCapability(
  access: AccessLike,
  capability: string,
): Promise<Response | null> {
  if (access.isSuperAdmin) return null

  // requireCapability вызывается ТОЛЬКО в admin-роутах. Не-staff (операторы
  // заходят как role='other', гости) не должны их проходить — даже если сид
  // выдал роли 'other' все права. Operators работают через /api/operator/*.
  if (!access.staffMember) {
    return NextResponse.json({ error: 'forbidden', reason: 'staff-only' }, { status: 403 })
  }

  const userId = access.user?.id
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthorized', capability },
      { status: 401 },
    )
  }

  const role = access.staffRole || access.staffMember?.role || null
  const capabilities = await loadUserCapabilities(userId, role, access.activeOrganization?.id || null)

  if (!capabilities.has(capability)) {
    return NextResponse.json(
      { error: 'forbidden', capability, message: `Нет права: ${capability}` },
      { status: 403 },
    )
  }

  return null
}

/**
 * Только super-admin. Для роутов УПРАВЛЕНИЯ правами (role_capabilities,
 * user_capability_overrides, set-password, role-permissions) — их нельзя
 * завязывать на capability, потому что при fail-open менеджеры имеют access.*
 * и смогли бы менять права. Эти роуты — платформенные, только super-admin.
 */
export function requireSuperAdmin(access: AccessLike): Response | null {
  if (access.isSuperAdmin) return null
  return NextResponse.json({ error: 'forbidden', reason: 'super-admin-only' }, { status: 403 })
}

/**
 * Staff-only + capability для admin-роутов.
 *
 * Сначала отсекает НЕ-staff (операторы/гости заходят с role='other' без
 * staffMember и иначе проходили бы проверки), затем гранулярно проверяет
 * capability. Так оператор не попадёт в админский контур, даже если по
 * текущему сиду у роли 'other' формально выданы все права.
 */
export async function requireStaffCapability(
  access: AccessLike,
  capability: string,
): Promise<Response | null> {
  if (!access.isSuperAdmin && !access.staffMember) {
    return NextResponse.json({ error: 'forbidden', reason: 'staff-only' }, { status: 403 })
  }
  return requireCapability(access, capability)
}

/**
 * Проверить право без возврата HTTP-ответа.
 * Удобно когда нужно условно показать секцию или поле в ответе API.
 */
export async function hasCapability(
  access: AccessLike,
  capability: string,
): Promise<boolean> {
  if (access.isSuperAdmin) return true
  const userId = access.user?.id
  if (!userId) return false
  const role = access.staffRole || access.staffMember?.role || null
  const capabilities = await loadUserCapabilities(userId, role, access.activeOrganization?.id || null)
  return capabilities.has(capability)
}

/**
 * Вернуть весь набор capabilities пользователя (для UI и API /me).
 * Super admin получает специальный маркер ['*'] — фронт интерпретирует как "всё разрешено".
 */
export async function getEffectiveCapabilities(access: AccessLike): Promise<string[]> {
  if (access.isSuperAdmin) return ['*']
  const userId = access.user?.id
  if (!userId) return []
  const role = access.staffRole || access.staffMember?.role || null
  const capabilities = await loadUserCapabilities(userId, role, access.activeOrganization?.id || null)
  return Array.from(capabilities)
}
