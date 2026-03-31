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
    label: 'Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ',
    home: '/welcome',
    paths: MANAGER_PATHS,
    capabilities: ['tasks', 'shifts', 'salary', 'finance_create', 'operator_structure'],
    summary: 'РљРѕРЅС‚СЂРѕР»РёСЂСѓРµС‚ Р·Р°РґР°С‡Рё, СЃРјРµРЅС‹, Р·Р°СЂРїР»Р°С‚Сѓ, РЅР°Р·РЅР°С‡Р°РµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ РїРѕ С‚РѕС‡РєР°Рј Рё РјРѕР¶РµС‚ РІРЅРѕСЃРёС‚СЊ РЅРѕРІС‹Рµ РґРѕС…РѕРґС‹ Рё СЂР°СЃС…РѕРґС‹ Р±РµР· РєСЂРёС‚РёС‡РЅС‹С… РїСЂР°РІРѕРє.',
    actions: [
      'РЎРјРѕС‚СЂРёС‚ РґРѕС…РѕРґС‹ Рё СЂР°СЃС…РѕРґС‹',
      'Р”РѕР±Р°РІР»СЏРµС‚ РЅРѕРІС‹Рµ РґРѕС…РѕРґС‹ Рё СЂР°СЃС…РѕРґС‹',
      'Р Р°Р±РѕС‚Р°РµС‚ СЃ Р·Р°РґР°С‡Р°РјРё',
      'РќР°Р·РЅР°С‡Р°РµС‚ Рё РјРµРЅСЏРµС‚ СЃРјРµРЅС‹',
      'РќР°Р·РЅР°С‡Р°РµС‚ РѕРїРµСЂР°С‚РѕСЂР°Рј РєРѕРјРїР°РЅРёРё Рё СЂРѕР»Рё РїРѕ С‚РѕС‡РєР°Рј',
      'Р’РёРґРёС‚ РѕСЂРіСЃС‚СЂСѓРєС‚СѓСЂСѓ РєРѕРјР°РЅРґС‹',
      'Р Р°Р±РѕС‚Р°РµС‚ СЃ Р·Р°СЂРїР»Р°С‚РѕР№',
      'РќРµ РјРѕР¶РµС‚ СѓРґР°Р»СЏС‚СЊ/РїСЂР°РІРёС‚СЊ РєСЂРёС‚РёС‡РЅС‹Рµ С„РёРЅР°РЅСЃС‹',
      'РќРµ СЃРѕР·РґР°С‘С‚ Рё РЅРµ СѓРґР°Р»СЏРµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ',
      'РќРµ СѓРїСЂР°РІР»СЏРµС‚ staff-Р°РєРєР°СѓРЅС‚Р°РјРё',
    ],
  },
  marketer: {
    label: 'РњР°СЂРєРµС‚РѕР»РѕРі',
    home: '/welcome',
    paths: MARKETER_PATHS,
    capabilities: ['tasks'],
    summary: 'Р Р°Р±РѕС‚Р°РµС‚ С‚РѕР»СЊРєРѕ РІ РєРѕРЅС‚СѓСЂРµ Р·Р°РґР°С‡ Рё РЅРµ РІРёРґРёС‚ РѕРїРµСЂР°С†РёРѕРЅРЅС‹Рµ Рё С„РёРЅР°РЅСЃРѕРІС‹Рµ СЂР°Р·РґРµР»С‹.',
    actions: [
      'РЎРјРѕС‚СЂРёС‚ Р·Р°РґР°С‡Рё',
      'РЎРѕР·РґР°С‘С‚ Р·Р°РґР°С‡Рё',
      'РњРµРЅСЏРµС‚ СЃС‚Р°С‚СѓСЃС‹ Р·Р°РґР°С‡',
      'РљРѕРјРјРµРЅС‚РёСЂСѓРµС‚ Р·Р°РґР°С‡Рё',
      'РќРµ РІРёРґРёС‚ СЃРјРµРЅС‹, Р·Р°СЂРїР»Р°С‚С‹, staff Рё С„РёРЅР°РЅСЃС‹',
    ],
  },
  owner: {
    label: 'Р’Р»Р°РґРµР»РµС†',
    home: '/welcome',
    paths: OWNER_PATHS,
    capabilities: ['tasks', 'salary', 'staff', 'operators', 'operator_structure', 'finance_create', 'finance_manage'],
    summary: 'РРјРµРµС‚ СѓРїСЂР°РІР»РµРЅС‡РµСЃРєРёР№ РґРѕСЃС‚СѓРї Рє РґРµРЅСЊРіР°Рј, РєРѕРјР°РЅРґРµ, РѕРїРµСЂР°С†РёРѕРЅРЅРѕР№ СЂР°Р±РѕС‚Рµ Рё Р°РЅР°Р»РёС‚РёРєРµ РѕРїРµСЂР°С‚РѕСЂРѕРІ Р±РµР· СЃРёСЃС‚РµРјРЅРѕРіРѕ Р°РґРјРёРЅРёСЃС‚СЂРёСЂРѕРІР°РЅРёСЏ.',
    actions: [
      'РЈРїСЂР°РІР»СЏРµС‚ РґРѕС…РѕРґР°РјРё Рё СЂР°СЃС…РѕРґР°РјРё',
      'Р’РёРґРёС‚ РєР°С‚РµРіРѕСЂРёРё СЂР°СЃС…РѕРґРѕРІ Рё РЅР°Р»РѕРіРё',
      'Р Р°Р±РѕС‚Р°РµС‚ СЃ KPI, Р·Р°РґР°С‡Р°РјРё Рё СЃРјРµРЅР°РјРё',
      'Р’РёРґРёС‚ Р°РЅР°Р»РёС‚РёРєСѓ РѕРїРµСЂР°С‚РѕСЂРѕРІ',
      'РЎРѕР·РґР°С‘С‚, СЂРµРґР°РєС‚РёСЂСѓРµС‚ Рё СѓРґР°Р»СЏРµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ',
      'РЈРїСЂР°РІР»СЏРµС‚ СѓСЃС‚СЂРѕР№СЃС‚РІР°РјРё С‚РѕС‡РµРє Рё С‚РѕРєРµРЅР°РјРё РєР°СЃСЃРѕРІС‹С… РїСЂРѕРіСЂР°РјРј',
      'Р’РёРґРёС‚ Рё РјРµРЅСЏРµС‚ РѕСЂРіСЃС‚СЂСѓРєС‚СѓСЂСѓ РїРѕ С‚РѕС‡РєР°Рј',
      'Р Р°Р±РѕС‚Р°РµС‚ СЃРѕ staff Рё Р·Р°СЂРїР»Р°С‚РѕР№',
      'РќРµ РІРёРґРёС‚ РґРѕСЃС‚СѓРїС‹, Р»РѕРіРё, РґРёР°РіРЅРѕСЃС‚РёРєСѓ Рё СЃРёСЃС‚РµРјРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё',
      'РќРµ СЃРѕР·РґР°С‘С‚ staff-Р°РєРєР°СѓРЅС‚С‹ Рё РЅРµ РїРѕРІС‹С€Р°РµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ',
    ],
  },
  other: {
    label: 'РЎРѕС‚СЂСѓРґРЅРёРє',
    home: '/unauthorized',
    paths: [],
    capabilities: [],
    summary: 'РўРµС…РЅРёС‡РµСЃРєР°СЏ СЂРѕР»СЊ Р±РµР· РґРѕСЃС‚СѓРїР° Рє staff-РєРѕРЅС‚СѓСЂСѓ.',
    actions: ['РќРµС‚ РґРѕСЃС‚СѓРїР° Рє staff-СЂР°Р·РґРµР»Р°Рј'],
  },
}

export const SUPER_ADMIN_MATRIX_ENTRY = {
  label: 'РЎСѓРїРµСЂ-Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ',
  home: '/dashboard',
  paths: ADMIN_PATHS,
  capabilities: ['tasks', 'shifts', 'salary', 'staff', 'staff_accounts', 'operators', 'operator_structure', 'finance_create', 'finance_manage'] as const,
  summary: 'РРјРµРµС‚ РїРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї РєРѕ РІСЃРµРј СЂР°Р·РґРµР»Р°Рј, Р°РєРєР°СѓРЅС‚Р°Рј, РЅР°СЃС‚СЂРѕР№РєР°Рј, Р»РѕРіР°Рј Рё СЃРёСЃС‚РµРјРЅС‹Рј РѕРїРµСЂР°С†РёСЏРј.',
  actions: [
    'Р’РёРґРёС‚ РІСЃРµ СЂР°Р·РґРµР»С‹',
    'РЎРѕР·РґР°С‘С‚ staff-Р°РєРєР°СѓРЅС‚С‹ Рё РѕС‚РїСЂР°РІР»СЏРµС‚ РёРЅРІР°Р№С‚С‹',
    'РџРѕРІС‹С€Р°РµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ',
    'РЈРїСЂР°РІР»СЏРµС‚ СѓСЃС‚СЂРѕР№СЃС‚РІР°РјРё С‚РѕС‡РµРє Рё API-С‚РѕРєРµРЅР°РјРё',
    'РЈРїСЂР°РІР»СЏРµС‚ СЃРёСЃС‚РµРјРЅС‹РјРё РЅР°СЃС‚СЂРѕР№РєР°РјРё, Р»РѕРіР°РјРё Рё РґРёР°РіРЅРѕСЃС‚РёРєРѕР№',
    'РРјРµРµС‚ РїРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї Рє С„РёРЅР°РЅСЃР°Рј, Р·Р°РґР°С‡Р°Рј, СЃРјРµРЅР°Рј Рё Р·Р°СЂРїР»Р°С‚Р°Рј',
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
  return hasSubscriptionFeature(features, getRequiredSubscriptionFeature(pathname))
}
