/**
 * Динамические роли — чтение справочника `roles` и `role_paths` из БД.
 *
 * На этом коммите helper только ЧИТАЕТ. Cтарый STAFF_ROLE_MATRIX
 * остаётся в lib/core/access.ts как fallback — это аддитивный коммит.
 *
 * Использование:
 *
 *   import { getRole, getRolePaths, getAllRoles } from '@/lib/server/roles'
 *
 *   const role = await getRole('owner')          // { code, label, home_path, ... }
 *   const paths = await getRolePaths('owner')    // ['/welcome', '/dashboard', ...]
 *   const all = await getAllRoles()              // [...]
 */

import 'server-only'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type RoleRecord = {
  code: string
  label: string
  home_path: string
  summary: string | null
  sort_order: number
  is_system: boolean
}

const CACHE_TTL_MS = 60_000

type CacheEntry<T> = { value: T; loadedAt: number }

const rolesCache: { entry: CacheEntry<RoleRecord[]> | null } = { entry: null }
const pathsCache = new Map<string, CacheEntry<string[]>>()

function isFresh(loadedAt: number): boolean {
  return Date.now() - loadedAt < CACHE_TTL_MS
}

/**
 * Получить все роли отсортированные по sort_order.
 * Возвращает [] если БД недоступна — caller сам решает что делать
 * (например fallback на STAFF_ROLE_MATRIX).
 */
export async function getAllRoles(): Promise<RoleRecord[]> {
  if (!hasAdminSupabaseCredentials()) return []

  const cached = rolesCache.entry
  if (cached && isFresh(cached.loadedAt)) return cached.value

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('roles')
    .select('code, label, home_path, summary, sort_order, is_system')
    .order('sort_order', { ascending: true })
    .range(0, 199)

  if (error || !data) return cached?.value ?? []

  const value = data as RoleRecord[]
  rolesCache.entry = { value, loadedAt: Date.now() }
  return value
}

/**
 * Найти роль по code. null если такой нет в справочнике.
 */
export async function getRole(code: string | null | undefined): Promise<RoleRecord | null> {
  if (!code) return null
  const all = await getAllRoles()
  return all.find((r) => r.code === code) ?? null
}

/**
 * Список путей доступных роли. [] если роли нет или БД недоступна.
 */
export async function getRolePaths(code: string | null | undefined): Promise<string[]> {
  if (!code) return []
  if (!hasAdminSupabaseCredentials()) return []

  const cached = pathsCache.get(code)
  if (cached && isFresh(cached.loadedAt)) return cached.value

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('role_paths')
    .select('path')
    .eq('role', code)
    .range(0, 999)

  if (error || !data) return cached?.value ?? []

  const value = data.map((r: any) => r.path as string)
  pathsCache.set(code, { value, loadedAt: Date.now() })
  return value
}

/**
 * Сбросить кэш — вызывать после CRUD-операций над ролями.
 * Если code не передан — сбрасывает всё.
 */
export function invalidateRolesCache(code?: string): void {
  rolesCache.entry = null
  if (!code) {
    pathsCache.clear()
    return
  }
  pathsCache.delete(code)
}

/**
 * Удобный helper-замена для STAFF_ROLE_LABELS в UI.
 * Возвращает label или сам code если роли нет в БД.
 */
export async function getRoleLabel(code: string | null | undefined): Promise<string> {
  if (!code) return ''
  const role = await getRole(code)
  return role?.label ?? code
}
