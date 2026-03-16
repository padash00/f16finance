export const PUBLIC_PATHS = [
  '/',
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
export type StaffCapability =
  | 'tasks'
  | 'shifts'
  | 'salary'
  | 'staff'
  | 'staff_accounts'
  | 'operators'
  | 'operator_structure'
  | 'finance_create'
  | 'finance_manage'
export type RoleMatrixEntry = {
  label: string
  home: string
  paths: readonly string[]
  capabilities: readonly StaffCapability[]
  summary: string
  actions: readonly string[]
}

export const ADMIN_PATHS = [
  '/',
  '/welcome',
  '/logs',
  '/point-devices',
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
  '/cashflow',
  '/forecast',
  '/ratings',
  '/birthdays',
  '/structure',
  '/staff',
  '/tax',
  '/profitability',
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
  '/telegram',
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
  '/cashflow',
  '/forecast',
  '/ratings',
  '/birthdays',
  '/weekly-report',
  '/structure',
  '/operators',
  '/operators/*',
  '/shifts',
  '/shifts/*',
  '/salary',
  '/salary/*',
] as const

const MARKETER_PATHS = ['/welcome', '/tasks'] as const

const OWNER_PATHS = [
  '/',
  '/welcome',
  '/point-devices',
  '/income',
  '/income/add',
  '/income/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/analysis',
  '/cashflow',
  '/forecast',
  '/ratings',
  '/categories',
  '/tax',
  '/profitability',
  '/reports',
  '/analysis',
  '/birthdays',
  '/weekly-report',
  '/structure',
  '/salary',
  '/salary/*',
  '/salary/rules',
  '/operators',
  '/operators/*',
  '/operator-analytics',
  '/staff',
  '/kpi',
  '/kpi/*',
  '/tasks',
  '/shifts',
  '/shifts/*',
] as const

export const STAFF_ROLE_MATRIX: Record<StaffRole, RoleMatrixEntry> = {
  manager: {
    label: 'Руководитель',
    home: '/welcome',
    paths: MANAGER_PATHS,
    capabilities: ['tasks', 'shifts', 'salary', 'finance_create', 'operator_structure'],
    summary: 'Контролирует задачи, смены, зарплату, назначает операторов по точкам и может вносить новые доходы и расходы без критичных правок.',
    actions: [
      'Смотрит доходы и расходы',
      'Добавляет новые доходы и расходы',
      'Работает с задачами',
      'Назначает и меняет смены',
      'Назначает операторам компании и роли по точкам',
      'Видит оргструктуру команды',
      'Работает с зарплатой',
      'Не может удалять/править критичные финансы',
      'Не создаёт и не удаляет операторов',
      'Не управляет staff-аккаунтами',
    ],
  },
  marketer: {
    label: 'Маркетолог',
    home: '/welcome',
    paths: MARKETER_PATHS,
    capabilities: ['tasks'],
    summary: 'Работает только в контуре задач и не видит операционные и финансовые разделы.',
    actions: [
      'Смотрит задачи',
      'Создаёт задачи',
      'Меняет статусы задач',
      'Комментирует задачи',
      'Не видит смены, зарплаты, staff и финансы',
    ],
  },
  owner: {
    label: 'Владелец',
    home: '/',
    paths: OWNER_PATHS,
    capabilities: ['tasks', 'salary', 'staff', 'operators', 'operator_structure', 'finance_create', 'finance_manage'],
    summary: 'Имеет управленческий доступ к деньгам, команде, операционной работе и аналитике операторов без системного администрирования.',
    actions: [
      'Управляет доходами и расходами',
      'Видит категории расходов и налоги',
      'Работает с KPI, задачами и сменами',
      'Видит аналитику операторов',
      'Создаёт, редактирует и удаляет операторов',
      'Управляет устройствами точек и токенами кассовых программ',
      'Видит и меняет оргструктуру по точкам',
      'Работает со staff и зарплатой',
      'Не видит доступы, логи, диагностику и системные настройки',
      'Не создаёт staff-аккаунты и не повышает операторов',
    ],
  },
  other: {
    label: 'Сотрудник',
    home: '/unauthorized',
    paths: [],
    capabilities: [],
    summary: 'Техническая роль без доступа к staff-контуру.',
    actions: ['Нет доступа к staff-разделам'],
  },
}

export const SUPER_ADMIN_MATRIX_ENTRY = {
  label: 'Супер-администратор',
  home: '/',
  paths: ADMIN_PATHS,
  capabilities: ['tasks', 'shifts', 'salary', 'staff', 'staff_accounts', 'operators', 'operator_structure', 'finance_create', 'finance_manage'] as const,
  summary: 'Имеет полный доступ ко всем разделам, аккаунтам, настройкам, логам и системным операциям.',
  actions: [
    'Видит все разделы',
    'Создаёт staff-аккаунты и отправляет инвайты',
    'Повышает операторов',
    'Управляет устройствами точек и API-токенами',
    'Управляет системными настройками, логами и диагностикой',
    'Имеет полный доступ к финансам, задачам, сменам и зарплатам',
  ],
} satisfies RoleMatrixEntry

export const OPERATOR_PATHS = [
  '/operator-dashboard',
  '/operator-dashboard/*',
  '/operator-lead',
  '/operator-lead/*',
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
  return STAFF_ROLE_MATRIX[role].paths
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
  return STAFF_ROLE_MATRIX[role].home
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
  return STAFF_ROLE_MATRIX[role].capabilities.includes(capability)
}
