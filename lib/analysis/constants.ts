export const FORECAST_DAYS = 30

export const MIN_INCOME_ANOMALY_ABS = 10_000
export const MIN_EXPENSE_ANOMALY_ABS = 10_000
export const EXPENSE_CAP_MULTIPLIER = 3

/** Сколько дней от последнего факта смотрим аномалии (топ по силе сигнала). */
export const ANOMALY_LOOKBACK_DAYS = 90
export const ANOMALY_MAX_SHOWN = 8

export const MAX_DAYS_HARD_LIMIT = 730

export const PLANS_TABLE = 'plans_daily'

export const PAYMENT_COLORS: Record<'cash' | 'kaspi' | 'card' | 'online', string> = {
  cash: '#f59e0b',
  kaspi: '#2563eb',
  card: '#7c3aed',
  online: '#ec4899',
}

/** «Весь период»: с 1 января (текущий год − 2), а не жёсткая дата. */
export function getDefaultAllPeriodStartISO(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 2, 0, 1)
  d.setHours(12, 0, 0, 0)
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

export const DATA_SOURCE_NOTE =
  'Суммы из админ-API доходов и расходов (как в разделах «Доходы» / «Расходы») за выбранный период и компанию.'

/** Как оцениваем «достоверность» (0–100): недели истории, покрытие дней недели, доля дней с операциями. */
export const CONFIDENCE_FORMULA_RU =
  'Оценка 0–100: чем больше недель в выборке, плотнее дни по дням недели и выше доля дней с движением — тем выше число. Не путать с научной точностью прогноза.'
