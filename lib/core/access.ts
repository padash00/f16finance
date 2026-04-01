export const PUBLIC_PATHS = [
  '/',
  '/club-management-system',
  '/operator-salary-system',
  '/profit-and-loss-ebitda',
  '/point-terminal',
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
export type SubscriptionFeature =
  | 'ai_reports'
  | 'inventory'
  | 'web_pos'
  | 'telegram'
  | 'custom_branding'
export type SubscriptionFeatureMeta = {
  label: string
  headline: string
  description: string
  recommendedPlanCode: string
  recommendedPlanName: string
  upgradeReason: string
}
export type SubscriptionFeatureBundle = {
  feature: SubscriptionFeature
  label: string
  description: string
  pages: readonly string[]
}
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
  '/platform',
  '/platform/*',
  '/dashboard',
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
  '/goals',
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
  '/access',
  '/pass',
  '/categories',
  '/inventory',
  '/inventory/*',
  '/store',
  '/store/*',
  '/operator-dashboard',
  '/operator-dashboard/*',
  '/operator-lead',
  '/operator-lead/*',
  '/operator-tasks',
  '/operator-tasks/*',
  '/operator-chat',
  '/operator-chat/*',
  '/operator-achievements',
  '/operator-achievements/*',
  '/operator-achievements-all',
  '/operator-settings',
  '/operator-settings/*',
] as const

const MANAGER_PATHS = [
  '/dashboard',
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
  '/goals',
  '/birthdays',
  '/weekly-report',
  '/profitability',
  '/reports',
  '/analysis',
  '/structure',
  '/operators',
  '/operators/*',
  '/shifts',
  '/shifts/*',
  '/salary',
  '/salary/*',
  '/categories',
  '/inventory',
  '/inventory/*',
  '/store',
  '/store/*',
  '/tax',
  '/kpi',
  '/kpi/*',
] as const

const MARKETER_PATHS = ['/welcome', '/tasks'] as const

const OWNER_PATHS = [
  '/dashboard',
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
  '/inventory',
  '/inventory/*',
  '/store',
  '/store/*',
  '/tax',
  '/profitability',
  '/goals',
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
    summary:
      'Контролирует задачи, смены, зарплату, назначает операторов по точкам и может вносить новые доходы и расходы без критичных правок.',
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
    home: '/welcome',
    paths: OWNER_PATHS,
    capabilities: ['tasks', 'salary', 'staff', 'operators', 'operator_structure', 'finance_create', 'finance_manage'],
    summary:
      'Имеет управленческий доступ к деньгам, команде, операционной работе и аналитике операторов без системного администрирования.',
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
  home: '/dashboard',
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
  '/operator',
  '/operator/*',
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
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt' || pathname === '/manifest.webmanifest') {
    return true
  }

  if (pathname === '/icon' || pathname === '/apple-icon' || pathname === '/og-image') {
    return true
  }

  if (pathname.startsWith('/google') && pathname.endsWith('.html')) {
    return true
  }

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
  subscriptionFeatures?: Partial<Record<SubscriptionFeature, boolean>> | null
}): boolean {
  const { pathname, isStaff, isOperator, staffRole, isSuperAdmin, subscriptionFeatures } = params

  if (isSuperAdmin) {
    // Super admin has access to everything except public/auth-only paths
    return true
  }

  const staffAllowed = isStaff && canStaffRoleAccessPath(normalizeStaffRole(staffRole), pathname)
  const operatorAllowed = isOperator && OPERATOR_PATHS.some((rule) => matchesPath(pathname, rule))

  if (isStaff) {
    return staffAllowed && canUsePathForSubscription(pathname, subscriptionFeatures)
  }

  return operatorAllowed && canUsePathForSubscription(pathname, subscriptionFeatures)
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

  if (isSuperAdmin) return '/dashboard'
  if (isStaff) return getDefaultPathForStaffRole(normalizeStaffRole(staffRole))
  if (isOperator) return '/operator'
  return '/unauthorized'
}

export function staffRoleHasCapability(role: StaffRole, capability: StaffCapability) {
  return STAFF_ROLE_MATRIX[role].capabilities.includes(capability)
}

export const SUBSCRIPTION_FEATURE_BUNDLES: readonly SubscriptionFeatureBundle[] = [
  {
    feature: 'ai_reports',
    label: 'AI-аналитика',
    description: 'Прогнозы, weekly report и AI-аналитические разделы.',
    pages: ['/analysis', '/forecast', '/weekly-report'],
  },
  {
    feature: 'inventory',
    label: 'Склад и номенклатура',
    description: 'Каталог, остатки, движения товара и store-контур.',
    pages: ['/inventory', '/inventory/*', '/store', '/store/*'],
  },
  {
    feature: 'web_pos',
    label: 'POS и терминал',
    description: 'POS-экран, чеки, возвраты и point terminal.',
    pages: ['/pos', '/pos-receipts', '/pos-returns', '/point-terminal'],
  },
  {
    feature: 'telegram',
    label: 'Telegram-интеграции',
    description: 'Telegram-боты, отчёты и коммуникации.',
    pages: ['/telegram'],
  },
  {
    feature: 'custom_branding',
    label: 'White-label и branding',
    description: 'Кастомные branding-настройки организации и продукта.',
    pages: ['/select-organization', '/settings'],
  },
] as const

const SUBSCRIPTION_FEATURE_META: Record<SubscriptionFeature, SubscriptionFeatureMeta> = {
  ai_reports: {
    label: 'AI-аналитика',
    headline: 'AI-аналитика закрыта на вашем тарифе',
    description:
      'В этом разделе собраны AI-отчёты, прогнозы и недельная аналитика. Для доступа нужен тариф с расширенной аналитикой.',
    recommendedPlanCode: 'growth',
    recommendedPlanName: 'Growth',
    upgradeReason: 'Откройте AI-отчёты, прогнозирование и недельные аналитические сводки.',
  },
  inventory: {
    label: 'Склад и номенклатура',
    headline: 'Складской контур недоступен на текущем тарифе',
    description:
      'Управление остатками, каталогом и внутренним store-контуром включается только в тарифах с модулем склада.',
    recommendedPlanCode: 'growth',
    recommendedPlanName: 'Growth',
    upgradeReason: 'Подключите склад, каталог и контроль остатков по точкам.',
  },
  web_pos: {
    label: 'POS и терминал',
    headline: 'POS-модуль не включен в ваш тариф',
    description:
      'Онлайн-касса, возвраты, чеки и терминальные сценарии доступны только в тарифах с POS-контуром.',
    recommendedPlanCode: 'enterprise',
    recommendedPlanName: 'Enterprise',
    upgradeReason: 'Подключите POS, чеки, возвраты и терминальный контур для точек.',
  },
  telegram: {
    label: 'Telegram-интеграции',
    headline: 'Telegram-модуль выключен для вашей подписки',
    description:
      'Автоматические отчёты, интеграции с ботами и Telegram-автоматизация доступны только в старших тарифах.',
    recommendedPlanCode: 'growth',
    recommendedPlanName: 'Growth',
    upgradeReason: 'Откройте Telegram-отчёты и автоматизацию по сообщениям.',
  },
  custom_branding: {
    label: 'Брендирование',
    headline: 'White-label настройки недоступны на текущем тарифе',
    description:
      'Логотипы, фирменные цвета и кастомное брендирование включены только в тарифах с white-label возможностями.',
    recommendedPlanCode: 'enterprise',
    recommendedPlanName: 'Enterprise',
    upgradeReason: 'Подключите фирменный стиль и кастомное брендирование интерфейса.',
  },
}

export function getRequiredSubscriptionFeature(pathname: string): SubscriptionFeature | null {
  for (const entry of SUBSCRIPTION_FEATURE_BUNDLES) {
    if (entry.pages.some((rule) => matchesPath(pathname, rule))) {
      return entry.feature
    }
  }

  return null
}

export function normalizeSubscriptionFeature(value: string | null | undefined): SubscriptionFeature | null {
  if (
    value === 'ai_reports' ||
    value === 'inventory' ||
    value === 'web_pos' ||
    value === 'telegram' ||
    value === 'custom_branding'
  ) {
    return value
  }

  return null
}

export function getSubscriptionFeatureMeta(feature: SubscriptionFeature | null | undefined): SubscriptionFeatureMeta | null {
  if (!feature) return null
  return SUBSCRIPTION_FEATURE_META[feature] ?? null
}

export function hasSubscriptionFeature(
  features: Partial<Record<SubscriptionFeature, boolean>> | null | undefined,
  feature: SubscriptionFeature | null,
) {
  if (!feature) return true
  return Boolean(features?.[feature])
}

export function canUsePathForSubscription(
  pathname: string,
  features: Partial<Record<SubscriptionFeature, boolean>> | null | undefined,
) {
  // SaaS subscription gating removed — all paths are accessible
  return true
}
