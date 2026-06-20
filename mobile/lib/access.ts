import type { SessionRole } from './auth'

/**
 * Может ли текущая роль видеть страницу (по web-пути).
 * Логика зеркалит сайт: суперадмин и владелец видят всё; для остальных ролей
 * владелец в /access может выключить отдельные пути — это приходит в
 * rolePermissionOverrides ({path, enabled}). Явно выключенное → скрываем.
 * Остальное видно (как и на сайте по умолчанию).
 */
export function canSee(role: SessionRole | null, path: string): boolean {
  if (!role) return false
  if (role.isSuperAdmin || role.staffRole === 'owner') return true
  // оператор/клиент сюда не попадают (у них свой кабинет), но на всякий случай:
  if (!role.isStaff) return false
  const ov = role.rolePermissionOverrides.find((o) => o.path === path)
  if (ov && !ov.enabled) return false
  return true
}

/** Видна ли фича организации (тариф/пакет). Пустой список + !allAccess → не ограничиваем. */
export function hasFeature(role: SessionRole | null, feature?: string): boolean {
  if (!role || !feature) return true
  if (role.featuresAllAccess) return true
  if (!role.orgFeatures.length) return true
  return role.orgFeatures.includes(feature)
}
