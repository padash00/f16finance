// Доступ к управлению магазином/финансами: владелец, управляющий или суперадмин.
// Блокирует операторов, маркетологов и роль "other".
export function isStoreManager(access: { isSuperAdmin?: boolean; staffRole?: string | null }): boolean {
  return !!access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}
