/**
 * Гидрация STAFF_ROLE_MATRIX из БД (positions + position_paths + role_capabilities).
 *
 * Назначение: чтобы кастомные роли созданные через UI (/access → Должности)
 * работали в рантайме — давали доступ к нужным /url, имели свой label/home.
 *
 * Как работает:
 *   1. ensureRoleMatrixHydrated() читает БД (с TTL 60s)
 *   2. Преобразует positions + position_paths + role_capabilities
 *      в Record<role, RoleMatrixEntry>
 *   3. Вызывает _setDynamicRoleMatrix() — STAFF_ROLE_MATRIX[role] начинает
 *      возвращать БД-данные вместо FALLBACK
 *
 * Где вызывать:
 *   - proxy.ts middleware (один раз перед canAccessPath)
 *   - getRequestAccessContext (один раз — покрывает все API routes)
 *
 * Стоимость: 3 SELECT'а раз в 60 секунд per warm-инстанс. Не кэширует
 * на клиенте (там работает FALLBACK).
 */

import 'server-only'

import { _setDynamicRoleMatrix, type RoleMatrixEntry, type StaffCapability } from '@/lib/core/access'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const CACHE_TTL_MS = 60_000
let lastHydratedAt = 0
let inflight: Promise<void> | null = null

/** Только эти capabilities из role_capabilities считаем валидными для StaffCapability. */
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set([
  'tasks',
  'shifts',
  'salary',
  'staff',
  'staff_accounts',
  'operators',
  'operator_structure',
  'finance_create',
  'finance_manage',
])

export async function ensureRoleMatrixHydrated(): Promise<void> {
  if (!hasAdminSupabaseCredentials()) return
  if (Date.now() - lastHydratedAt < CACHE_TTL_MS) return
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const supabase = createAdminSupabaseClient()

      const [positionsRes, pathsRes, capsRes] = await Promise.all([
        supabase
          .from('positions')
          .select('name, label, home_path, summary, is_builtin')
          .range(0, 999),
        supabase
          .from('position_paths')
          .select('position_name, path')
          .range(0, 9999),
        supabase
          .from('role_capabilities')
          .select('role, capability, granted')
          .range(0, 9999),
      ])

      if (positionsRes.error || !positionsRes.data) return

      const pathsByRole = new Map<string, string[]>()
      for (const row of (pathsRes.data || []) as Array<{ position_name: string; path: string }>) {
        const arr = pathsByRole.get(row.position_name) ?? []
        arr.push(row.path)
        pathsByRole.set(row.position_name, arr)
      }

      const capsByRole = new Map<string, Set<StaffCapability>>()
      for (const row of (capsRes.data || []) as Array<{ role: string; capability: string; granted: boolean }>) {
        if (!row.granted) continue
        if (!KNOWN_CAPABILITIES.has(row.capability)) continue
        const set = capsByRole.get(row.role) ?? new Set()
        set.add(row.capability as StaffCapability)
        capsByRole.set(row.role, set)
      }

      const matrix: Record<string, RoleMatrixEntry> = {}
      for (const pos of positionsRes.data as Array<{
        name: string
        label: string | null
        home_path: string | null
        summary: string | null
        is_builtin: boolean
      }>) {
        matrix[pos.name] = {
          label: pos.label || pos.name,
          home: pos.home_path || '/welcome',
          paths: pathsByRole.get(pos.name) ?? [],
          capabilities: Array.from(capsByRole.get(pos.name) ?? []),
          summary: pos.summary || '',
          actions: [],
        }
      }

      _setDynamicRoleMatrix(matrix)
      lastHydratedAt = Date.now()
    } catch {
      // Не падаем — fallback в STAFF_ROLE_MATRIX покроет системные роли.
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Сбросить кэш гидрации — вызывать после CRUD-операций над ролями. */
export function invalidateRoleMatrixCache(): void {
  lastHydratedAt = 0
}
