// Каталог функций платформы (entitlements) — единый источник для панели и резолвера.
// Ключи совпадают с subscription_plans.features (jsonb).

export const PLATFORM_FEATURES = [
  { key: 'ai_reports', label: 'AI-аналитика', description: 'Прогнозы, weekly report, AI-разделы' },
  { key: 'inventory', label: 'Склад и номенклатура', description: 'Каталог, остатки, движения товара' },
  { key: 'web_pos', label: 'POS и терминал', description: 'POS-экран, чеки, возвраты' },
  { key: 'telegram', label: 'Telegram-боты и отчёты', description: 'Telegram-интеграции и рассылки' },
  { key: 'excel_exports', label: 'Excel-экспорт', description: 'Выгрузки в Excel' },
  { key: 'custom_branding', label: 'White-label и брендинг', description: 'Свой бренд кабинета' },
] as const

export type PlatformFeatureKey = (typeof PLATFORM_FEATURES)[number]['key']

export type EntitlementSource = 'plan' | 'override' | 'none'
export type EntitlementState = { enabled: boolean; source: EntitlementSource }

// Эффективное состояние фичи: override важнее тарифа; иначе берётся из features тарифа.
export function resolveFeatureState(
  feature: string,
  planFeatures: Record<string, unknown> | null | undefined,
  override: boolean | undefined,
): EntitlementState {
  if (override !== undefined) return { enabled: override, source: 'override' }
  const planOn = !!(planFeatures || {})[feature]
  return { enabled: planOn, source: planOn ? 'plan' : 'none' }
}
