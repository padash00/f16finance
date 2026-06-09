export const PUBLIC_PATHS = [
  '/',
  '/club-management-system',
  '/operator-salary-system',
  '/profit-and-loss-ebitda',
  '/point-terminal',
  '/offer',
  '/privacy',
  '/terms',
  '/sla',
  '/cookies',
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

/** См. docs/roles.md — матрица staff/оператор/платформа и гостевой контур (`CLIENT_PATHS`, `customers.auth_user_id`).
 *
 * StaffRole = string (после Коммита 2 динамических ролей).
 * Раньше было union 4-х литералов — теперь любая строка валидна на TS-уровне.
 * Runtime-валидация в normalizeStaffRole() и STAFF_ROLE_MATRIX.
 */
export type StaffRole = string
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
export type RolePermissionOverride = {
  path: string
  enabled: boolean
}
export type AccessPage = {
  path: string
  label: string
}
export type AccessPageGroup = {
  group: string
  pages: readonly AccessPage[]
}

export const ADMIN_PATHS = [
  '/platform',
  '/platform/*',
  '/dashboard',
  '/welcome',
  '/subscription',
  '/ai-cfo',
  '/logs',
  '/point-devices',
  '/income',
  '/income/add',
  '/income/analytics',
  '/shift-telegram-audit',
  '/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/new',
  '/expenses/pending',
  '/expenses/analysis',
  '/expense-whitelist',
  '/salary',
  '/salary/*',
  '/salary/rules',
  '/point-debts',
  '/reports',
  '/analysis',
  '/weekly-report',
  '/cashflow',
  '/forecast',
  '/ratings',
  '/birthdays',
  '/structure',
  '/staff',
  '/hr',
  '/tax',
  '/profitability',
  '/goals',
  '/operators',
  '/operators/*',
  '/operator-analytics',
  '/tasks',
  '/shifts',
  '/shifts/*',
  '/debug',
  '/settings',
  '/telegram',
  '/access',
  '/knowledge-admin',
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
  '/shift-telegram-audit',
  '/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/new',
  '/expenses/pending',
  '/expenses/analysis',
  '/expense-whitelist',
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
  '/point-debts',
  '/categories',
  '/inventory',
  '/inventory/*',
  '/store',
  '/store/*',
  '/tax',
] as const

const MARKETER_PATHS = ['/welcome', '/tasks'] as const

const OWNER_PATHS = [
  '/dashboard',
  '/welcome',
  '/subscription',
  '/ai-cfo',
  '/planner',
  '/point-devices',
  '/income',
  '/income/add',
  '/income/analytics',
  '/shift-telegram-audit',
  '/analytics',
  '/expenses',
  '/expenses/add',
  '/expenses/new',
  '/expenses/pending',
  '/expenses/analysis',
  '/expense-whitelist',
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
  '/point-debts',
  '/operators',
  '/operators/*',
  '/operator-analytics',
  '/staff',
  '/hr',
  '/tasks',
  '/shifts',
  '/shifts/*',
  '/knowledge-admin',
] as const

/**
 * FALLBACK-данные системных ролей. Используются:
 *   1) на клиенте (т.к. БД-гидрация работает только на сервере)
 *   2) на сервере если БД недоступна
 *
 * Источник правды для рантайма — таблицы `positions` и `position_paths`.
 * См. lib/server/role-hydration.ts → ensureRoleMatrixHydrated().
 */
const STAFF_ROLE_MATRIX_FALLBACK: Record<string, RoleMatrixEntry> = {
  manager: {
    label: 'Руководитель',
    home: '/welcome',
    paths: MANAGER_PATHS,
    capabilities: ['tasks', 'shifts', 'salary', 'operator_structure', 'finance_create', 'operators'],
    summary:
      'Контролирует задачи, смены, зарплату и назначает операторов по точкам. Может добавлять доходы и расходы.',
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

// Динамический оверлей. Заполняется hydrateStaffRoleMatrix() из БД на сервере.
// Если роль есть в _DYNAMIC — она перекрывает FALLBACK.
let _DYNAMIC_MATRIX: Record<string, RoleMatrixEntry> = {}

/**
 * STAFF_ROLE_MATRIX — единая точка чтения данных о ролях.
 *
 * Прокси: при чтении STAFF_ROLE_MATRIX[role] сначала ищет в динамической
 * (БД-гидрированной) карте, затем в FALLBACK. На клиенте динамическая
 * карта пуста — работает только FALLBACK для системных ролей.
 */
export const STAFF_ROLE_MATRIX: Record<string, RoleMatrixEntry> = new Proxy(
  {} as Record<string, RoleMatrixEntry>,
  {
    get(_target, prop: string): RoleMatrixEntry | undefined {
      if (typeof prop !== 'string') return undefined
      return _DYNAMIC_MATRIX[prop] ?? STAFF_ROLE_MATRIX_FALLBACK[prop]
    },
    has(_target, prop: string): boolean {
      if (typeof prop !== 'string') return false
      return prop in _DYNAMIC_MATRIX || prop in STAFF_ROLE_MATRIX_FALLBACK
    },
    ownKeys() {
      const keys = new Set<string>([
        ...Object.keys(STAFF_ROLE_MATRIX_FALLBACK),
        ...Object.keys(_DYNAMIC_MATRIX),
      ])
      return Array.from(keys)
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (typeof prop !== 'string') return undefined
      const value = _DYNAMIC_MATRIX[prop] ?? STAFF_ROLE_MATRIX_FALLBACK[prop]
      if (value === undefined) return undefined
      return { configurable: true, enumerable: true, writable: false, value }
    },
  },
)

/**
 * Серверный мутатор: заполнить динамическую карту ролей данными из БД.
 * Вызывается из lib/server/role-hydration.ts.
 *
 * НЕ ВЫЗЫВАТЬ С КЛИЕНТА — на клиенте динамическая карта остаётся пустой,
 * fallback покрывает системные роли.
 */
export function _setDynamicRoleMatrix(matrix: Record<string, RoleMatrixEntry>): void {
  _DYNAMIC_MATRIX = matrix
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

/** Гостевой контур (клиент клуба); см. docs/roles.md. */
export const CLIENT_PATHS = ['/client', '/client/*'] as const

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

export const ACCESS_PAGE_GROUPS: readonly AccessPageGroup[] = [
  {
    group: 'Центр управления',
    pages: [
      { path: '/welcome', label: 'Главный вход' },
      { path: '/dashboard', label: 'Главная панель' },
      { path: '/workspace', label: 'Рабочее пространство' },
      { path: '/analysis', label: 'AI Разбор' },
      { path: '/forecast', label: 'AI Прогноз' },
      { path: '/goals', label: 'Цели и план' },
      { path: '/reports', label: 'Отчёты' },
      { path: '/reports/monthly', label: 'Ежемесячный отчёт' },
      { path: '/weekly-report', label: 'Недельный отчёт' },
    ],
  },
  {
    group: 'Финансы',
    pages: [
      { path: '/income', label: 'Доходы' },
      { path: '/income/add', label: 'Добавить доход' },
      { path: '/income/analytics', label: 'Аналитика доходов (старый маршрут)' },
      { path: '/shift-telegram-audit', label: 'Сверка Telegram и доходов' },
      { path: '/analytics', label: 'Аналитика доходов' },
      { path: '/expenses', label: 'Расходы' },
      { path: '/expenses/new', label: 'Добавить расход' },
      { path: '/expenses/pending', label: 'Ожидают одобрения расходов' },
      { path: '/expense-whitelist', label: 'Доверенные поставщики расходов' },
      { path: '/expenses/analysis', label: 'Анализ расходов' },
      { path: '/cashflow', label: 'Cash Flow' },
      { path: '/salary', label: 'Зарплата' },
      { path: '/salary/rules', label: 'Правила зарплаты' },
      { path: '/point-debts', label: 'Долги с точки' },
      { path: '/kaspi-terminal', label: 'Безналичный терминал' },
      { path: '/categories', label: 'Категории расходов' },
      { path: '/tax', label: 'Налоги' },
      { path: '/profitability', label: 'ОПиУ и EBITDA' },
      { path: '/customers', label: 'Клиенты' },
      { path: '/discounts', label: 'Скидки и промокоды' },
    ],
  },
  {
    group: 'Магазин и POS',
    pages: [
      { path: '/inventory', label: 'Склад' },
      { path: '/store', label: 'Обзор магазина' },
      { path: '/store/catalog', label: 'Каталог' },
      { path: '/store/warehouse', label: 'Склад' },
      { path: '/store/showcase', label: 'Витрина' },
      { path: '/store/receipts', label: 'Приёмка' },
      { path: '/store/postings', label: 'Оприходование' },
      { path: '/store/requests', label: 'Заявки' },
      { path: '/store/requests-journal', label: 'Журнал заявок' },
      { path: '/store/analytics', label: 'Аналитика точек' },
      { path: '/store/consumables', label: 'Расходники' },
      { path: '/store/writeoffs', label: 'Списания' },
      { path: '/store/revisions', label: 'Ревизия' },
      { path: '/store/movements', label: 'Движения' },
      { path: '/store/abc', label: 'ABC-анализ' },
      { path: '/store/forecast', label: 'Прогноз остатков' },
      { path: '/pos', label: 'Касса (Web POS)' },
      { path: '/pos-receipts', label: 'История чеков' },
      { path: '/pos-returns', label: 'Возвраты POS' },
    ],
  },
  {
    group: 'Склад (legacy-маршруты)',
    pages: [
      { path: '/inventory', label: 'Склад (legacy)' },
      { path: '/inventory/catalog', label: 'Каталог склада (legacy)' },
      { path: '/inventory/receipts', label: 'Приёмка склада (legacy)' },
      { path: '/inventory/requests', label: 'Заявки склада (legacy)' },
      { path: '/inventory/analytics', label: 'Аналитика склада (legacy)' },
      { path: '/inventory/consumables', label: 'Расходники склада (legacy)' },
      { path: '/inventory/writeoffs', label: 'Списания склада (legacy)' },
      { path: '/inventory/revisions', label: 'Ревизия склада (legacy)' },
      { path: '/inventory/movements', label: 'Движения склада (legacy)' },
      { path: '/inventory/abc', label: 'ABC-анализ склада (legacy)' },
      { path: '/inventory/forecast', label: 'Прогноз склада (legacy)' },
      { path: '/inventory/stocktakes', label: 'Инвентаризации склада (legacy)' },
    ],
  },
  {
    group: 'Операционная работа',
    pages: [
      { path: '/tasks', label: 'Задачи' },
      { path: '/shifts', label: 'Смены' },
      { path: '/shifts/add', label: 'Добавить смены' },
      { path: '/shifts/report', label: 'Отчёт по сменам' },
      { path: '/shifts/reports', label: 'Отчёты смен (точки)' },
      { path: '/shifts/reports/*', label: 'Карточка смены точки' },
      { path: '/incidents', label: 'Инциденты' },
      { path: '/incidents/*', label: 'Карточка инцидента' },
      { path: '/operators', label: 'Операторы' },
      { path: '/operators/*', label: 'Профиль оператора' },
      { path: '/operator-analytics', label: 'Аналитика операторов' },
      { path: '/ratings', label: 'Рейтинг операторов' },
      { path: '/birthdays', label: 'Дни рождения' },
      { path: '/stations/*', label: 'Станции проекта' },
    ],
  },
  {
    group: 'Команда',
    pages: [
      { path: '/staff', label: 'Сотрудники' },
      { path: '/hr', label: 'Кадры (увольнения и восстановление)' },
      { path: '/salary/*', label: 'Карточка зарплаты сотрудника' },
      { path: '/structure', label: 'Структура' },
      { path: '/pass', label: 'Доступы' },
    ],
  },
  {
    group: 'Операторское пространство',
    pages: [
      { path: '/operator', label: 'Старый кабинет оператора' },
      { path: '/operator-dashboard', label: 'Мой кабинет оператора' },
      { path: '/operator-lead', label: 'Моя точка' },
      { path: '/operator-schedule', label: 'График оператора' },
      { path: '/operator-tasks', label: 'Мои задачи' },
      { path: '/operator-chat', label: 'Чат операторов' },
      { path: '/operator-achievements', label: 'Достижения' },
      { path: '/operator-achievements-all', label: 'Общий рейтинг достижений' },
      { path: '/operator-settings', label: 'Настройки операторов' },
      { path: '/operator/profile', label: 'Профиль оператора (legacy)' },
      { path: '/operator/salary', label: 'Зарплата оператора (legacy)' },
      { path: '/operator/shifts', label: 'Смены оператора (legacy)' },
      { path: '/operator/tasks', label: 'Задачи оператора (legacy)' },
    ],
  },
  {
    group: 'Система',
    pages: [
      { path: '/settings', label: 'Настройки системы' },
      { path: '/access', label: 'Права и пароли' },
      { path: '/knowledge-admin', label: 'База знаний и чек-листы' },
      { path: '/telegram', label: 'Telegram Bot' },
      { path: '/point-devices', label: 'Точки и устройства' },
      { path: '/logs', label: 'Логирование' },
      { path: '/debug', label: 'Диагностика' },
    ],
  },
  {
    group: 'SaaS и платформа',
    pages: [
      { path: '/platform', label: 'Платформа SaaS' },
      { path: '/platform/billing', label: 'Биллинг платформы' },
      { path: '/platform/new', label: 'Создание организации' },
      { path: '/platform/organizations', label: 'Список организаций' },
      { path: '/platform/organizations/*', label: 'Карточка организации' },
      { path: '/select-organization', label: 'Выбор организации' },
      { path: '/setup-required', label: 'Требуется настройка' },
      { path: '/unauthorized', label: 'Нет доступа' },
    ],
  },
] as const

export function getConfigurablePagePaths(): string[] {
  return Array.from(new Set(ACCESS_PAGE_GROUPS.flatMap((group) => group.pages.map((page) => page.path))))
}

export function normalizeStaffRole(role: string | null | undefined): StaffRole {
  // Любая роль которая есть в STAFF_ROLE_MATRIX (включая будущие кастомные,
  // когда матрица будет гидрироваться из БД) — валидна. Иначе 'other'.
  if (role && Object.prototype.hasOwnProperty.call(STAFF_ROLE_MATRIX, role)) {
    return role
  }
  return 'other'
}

/**
 * Лейбл роли для UI. Заменяет 5 копий объекта { owner: 'Владелец', ... }.
 * Если роль не найдена в матрице — вернёт сам code (defensive).
 */
export function getStaffRoleLabel(role: string | null | undefined): string {
  if (!role) return ''
  const entry = STAFF_ROLE_MATRIX[role]
  return entry?.label ?? role
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
  return STAFF_ROLE_MATRIX[role]?.paths ?? STAFF_ROLE_MATRIX.other.paths
}

function matchesConfiguredPath(pathname: string, configuredPath: string): boolean {
  return pathname === configuredPath || pathname.startsWith(`${configuredPath}/`) || matchesPath(pathname, configuredPath)
}

function findRolePermissionOverride(
  pathname: string,
  overrides: readonly RolePermissionOverride[] | null | undefined,
): RolePermissionOverride | null {
  if (!overrides?.length) return null

  let bestMatch: RolePermissionOverride | null = null

  for (const override of overrides) {
    if (!matchesConfiguredPath(pathname, override.path)) continue
    if (!bestMatch || override.path.length > bestMatch.path.length) {
      bestMatch = override
    }
  }

  return bestMatch
}

const MANDATORY_MANAGER_OPERATIONAL_FINANCE_PATHS = [
  '/income/add',
  '/expenses',
  '/expenses/add',
  '/expenses/new',
  '/expenses/pending',
  '/expenses/analysis',
  '/expense-whitelist',
] as const

function isMandatoryStaffPath(role: StaffRole, pathname: string): boolean {
  if (role !== 'manager') return false
  return MANDATORY_MANAGER_OPERATIONAL_FINANCE_PATHS.some((rule) => matchesConfiguredPath(pathname, rule))
}

export function canStaffRoleAccessPath(
  role: StaffRole,
  pathname: string,
  rolePermissionOverrides?: readonly RolePermissionOverride[] | null,
): boolean {
  if (isMandatoryStaffPath(role, pathname)) return true

  const override = findRolePermissionOverride(pathname, rolePermissionOverrides)
  if (override) return override.enabled

  return getAllowedStaffPaths(role).some((rule) => matchesPath(pathname, rule))
}

export function canAccessPath(params: {
  pathname: string
  isStaff: boolean
  isOperator: boolean
  isCustomer?: boolean
  staffRole?: StaffRole | null
  isSuperAdmin?: boolean
  subscriptionFeatures?: Partial<Record<SubscriptionFeature, boolean>> | null
  rolePermissionOverrides?: readonly RolePermissionOverride[] | null
}): boolean {
  const {
    pathname,
    isStaff,
    isOperator,
    isCustomer,
    staffRole,
    isSuperAdmin,
    subscriptionFeatures,
    rolePermissionOverrides,
  } = params

  if (isSuperAdmin) {
    // Super admin has access to everything except public/auth-only paths
    return true
  }

  if (isStaff) {
    const staffAllowed = canStaffRoleAccessPath(normalizeStaffRole(staffRole), pathname, rolePermissionOverrides)
    return staffAllowed && canUsePathForSubscription(pathname, subscriptionFeatures)
  }

  if (isOperator) {
    const operatorAllowed = OPERATOR_PATHS.some((rule) => matchesPath(pathname, rule))
    return operatorAllowed && canUsePathForSubscription(pathname, subscriptionFeatures)
  }

  if (isCustomer) {
    return CLIENT_PATHS.some((rule) => matchesPath(pathname, rule)) && canUsePathForSubscription(pathname, subscriptionFeatures)
  }

  return false
}

export function getBuiltinRoleDefaultPaths(role: StaffRole): string[] {
  return getConfigurablePagePaths().filter((path) => canStaffRoleAccessPath(role, path))
}

export function getDefaultPathForStaffRole(
  role: StaffRole,
  rolePermissionOverrides?: readonly RolePermissionOverride[] | null,
) {
  const home = STAFF_ROLE_MATRIX[role]?.home ?? STAFF_ROLE_MATRIX.other.home
  if (canStaffRoleAccessPath(role, home, rolePermissionOverrides)) {
    return home
  }

  const fallbackPath = getConfigurablePagePaths().find((path) => canStaffRoleAccessPath(role, path, rolePermissionOverrides))
  return fallbackPath || home
}

export function getDefaultAppPath(params: {
  isSuperAdmin?: boolean
  isStaff?: boolean
  isOperator?: boolean
  isCustomer?: boolean
  staffRole?: StaffRole | null
  rolePermissionOverrides?: readonly RolePermissionOverride[] | null
}) {
  const { isSuperAdmin, isStaff, isOperator, isCustomer, staffRole, rolePermissionOverrides } = params

  if (isSuperAdmin) return '/platform'
  if (isStaff) return getDefaultPathForStaffRole(normalizeStaffRole(staffRole), rolePermissionOverrides)
  if (isOperator) return '/operator'
  if (isCustomer) return '/client'
  return '/unauthorized'
}

export function staffRoleHasCapability(role: StaffRole, capability: StaffCapability) {
  return STAFF_ROLE_MATRIX[role]?.capabilities.includes(capability) ?? false
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
