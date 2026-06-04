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

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type CapabilitiesCache = {
  capabilities: Set<string>
  loadedAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CapabilitiesCache>()

function cacheKey(userId: string, role: string | null): string {
  return `${userId}:${role || ''}`
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
): Promise<Set<string>> {
  if (!hasAdminSupabaseCredentials()) return new Set()

  const key = cacheKey(userId, role)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.capabilities
  }

  const supabase = createAdminSupabaseClient()
  const result = new Set<string>()

  // 1) role_capabilities — права роли
  if (role) {
    const { data: roleRows } = await supabase
      .from('role_capabilities')
      .select('capability, granted')
      .eq('role', role)
      .range(0, 999)

    for (const row of (roleRows || []) as Array<{ capability: string; granted: boolean }>) {
      if (row.granted) result.add(row.capability)
    }
  }

  // 2) user_capability_overrides — переопределения для конкретного человека
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
  const capabilities = await loadUserCapabilities(userId, role)

  if (!capabilities.has(capability)) {
    return NextResponse.json(
      { error: 'forbidden', capability, message: `Нет права: ${capability}` },
      { status: 403 },
    )
  }

  return null
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
  const capabilities = await loadUserCapabilities(userId, role)
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
  const capabilities = await loadUserCapabilities(userId, role)
  return Array.from(capabilities)
}
