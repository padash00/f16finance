export const PUBLIC_PATHS = [
  '/login',
  '/operator-login',
  '/unauthorized',
  '/setup-required',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/auth/callback',
  '/auth/complete',
] as const

export type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'
export type StaffCapability = 'tasks' | 'shifts' | 'salary' | 'staff' | 'staff_accounts' | 'operators' | 'finance'

export const ADMIN_PATHS = [
  '/',
  '/welcome',
  '/logs',
  '/income',
  '/income/add',
  '/income/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/analysis',
  '/salary',
  '/salary/*',
  '/salary/rules',
  '/reports',
  '/analysis',
  '/weekly-report',
  '/staff',
  '/tax',
  '/operators',
  '/operators/*',
  '/operator-analytics',
  '/kpi',
  '/kpi/*',
  '/tasks',
  '/shifts',
  '/shifts/*',
  '/debug',
  '/settings',
  '/pass',
] as const

const MANAGER_PATHS = [
  '/welcome',
  '/tasks',
  '/income',
  '/income/add',
  '/income/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/analysis',
  '/weekly-report',
  '/shifts',
  '/shifts/*',
  '/salary',
  '/salary/*',
] as const

const MARKETER_PATHS = ['/welcome', '/tasks'] as const

const OWNER_PATHS = [
  '/',
  '/welcome',
  '/income',
  '/income/add',
  '/income/analytics',
  '/reports',
  '/analysis',
  '/weekly-report',
  '/salary',
  '/salary/*',
  '/salary/rules',
  '/operators',
  '/operators/*',
  '/staff',
  '/tasks',
] as const

export const OPERATOR_PATHS = [
  '/operator-dashboard',
  '/operator-dashboard/*',
  '/operator-schedule',
  '/operator-schedule/*',
  '/operator-tasks',
  '/operator-tasks/*',
  '/operator-profile',
  '/operator-profile/*',
  '/operator-chat',
  '/operator-chat/*',
  '/operator-settings',
  '/operator-settings/*',
  '/operator-achievements',
  '/operator-achievements/*',
] as const

export function normalizeStaffRole(role: string | null | undefined): StaffRole {
  if (role === 'manager' || role === 'marketer' || role === 'owner') {
    return role
  }

  return 'other'
}

export function matchesPath(pathname: string, rule: string): boolean {
  if (rule.endsWith('/*')) {
    return pathname.startsWith(rule.slice(0, -2))
  }

  return pathname === rule
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((rule) => matchesPath(pathname, rule))
}

export function getAllowedStaffPaths(role: StaffRole): readonly string[] {
  if (role === 'manager') return MANAGER_PATHS
  if (role === 'marketer') return MARKETER_PATHS
  if (role === 'owner') return OWNER_PATHS

  return []
}

export function canStaffRoleAccessPath(role: StaffRole, pathname: string): boolean {
  return getAllowedStaffPaths(role).some((rule) => matchesPath(pathname, rule))
}

export function canAccessPath(params: {
  pathname: string
  isStaff: boolean
  isOperator: boolean
  staffRole?: StaffRole | null
  isSuperAdmin?: boolean
}): boolean {
  const { pathname, isStaff, isOperator, staffRole, isSuperAdmin } = params

  if (isSuperAdmin) {
    return ADMIN_PATHS.some((rule) => matchesPath(pathname, rule))
  }

  const staffAllowed = isStaff && canStaffRoleAccessPath(normalizeStaffRole(staffRole), pathname)
  const operatorAllowed = isOperator && OPERATOR_PATHS.some((rule) => matchesPath(pathname, rule))

  if (isStaff) {
    return staffAllowed
  }

  return operatorAllowed
}

export function getDefaultPathForStaffRole(role: StaffRole) {
  if (role === 'manager') return '/welcome'
  if (role === 'marketer') return '/welcome'
  if (role === 'owner') return '/'
  return '/unauthorized'
}

export function getDefaultAppPath(params: {
  isSuperAdmin?: boolean
  isStaff?: boolean
  isOperator?: boolean
  staffRole?: StaffRole | null
}) {
  const { isSuperAdmin, isStaff, isOperator, staffRole } = params

  if (isSuperAdmin) return '/'
  if (isStaff) return getDefaultPathForStaffRole(normalizeStaffRole(staffRole))
  if (isOperator) return '/operator-dashboard'
  return '/login'
}

export function staffRoleHasCapability(role: StaffRole, capability: StaffCapability) {
  if (role === 'manager') {
    return capability === 'tasks' || capability === 'shifts' || capability === 'salary'
  }

  if (role === 'marketer') {
    return capability === 'tasks'
  }

  if (role === 'owner') {
    return (
      capability === 'tasks' ||
      capability === 'salary' ||
      capability === 'staff' ||
      capability === 'operators' ||
      capability === 'finance'
    )
  }

  return false
}
