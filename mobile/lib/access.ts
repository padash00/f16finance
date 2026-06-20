import type { SessionRole } from './auth'

/** Полный доступ: суперадмин (capabilities=['*']) или владелец. */
function isAllAccess(role: SessionRole): boolean {
  return role.isSuperAdmin || role.staffRole === 'owner' || role.capabilities.includes('*')
}

/** Есть ли конкретный capability (income.view, expenses-pending.approve, …). */
export function canDo(role: SessionRole | null, capability: string): boolean {
  if (!role) return false
  if (isAllAccess(role)) return true
  return role.capabilities.includes(capability)
}

/**
 * Видна ли страница. Источник правды — capabilities из /access:
 * страница видна, если у роли есть ЛЮБОЙ её capability (page.view или page.*).
 * Плюс слой role_permissions: если владелец явно выключил путь — скрываем.
 */
export function canSee(role: SessionRole | null, opts: { path?: string; page?: string }): boolean {
  if (!role) return false
  if (isAllAccess(role)) return true
  if (!role.isStaff) return false // операторы/клиенты сюда не ходят

  // 1) явный запрет пути из /access (role_permissions)
  if (opts.path) {
    const ov = role.rolePermissionOverrides.find((o) => o.path === opts.path)
    if (ov && !ov.enabled) return false
  }

  // 2) capability страницы (если задана) — нужен хоть один code этой страницы
  if (opts.page) {
    const prefix = `${opts.page}.`
    return role.capabilities.some((c) => c === opts.page || c.startsWith(prefix))
  }

  // страница без capability-маппинга (напр. Арена) — показываем, если путь не выключен
  return true
}

/** Видна ли фича организации (тариф/пакет). Пусто + !allAccess → не ограничиваем. */
export function hasFeature(role: SessionRole | null, feature?: string): boolean {
  if (!role || !feature) return true
  if (role.featuresAllAccess) return true
  if (!role.orgFeatures.length) return true
  return role.orgFeatures.includes(feature)
}
