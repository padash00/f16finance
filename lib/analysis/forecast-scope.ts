import {
  buildMonthPoints,
  evaluateInside,
  explainLearning,
  learnForecast,
  shiftMonth,
  type LearnedForecast,
  type LearnExpenseRow,
  type LearnIncomeRow,
  type RunningMonthOutlook,
  type Scenarios,
  type Triple,
  type Inside,
} from '@/lib/analysis/forecast-learning'
import { buildMonthlyForecast, type ForecastResult } from '@/lib/analysis/monthly-forecast'

/**
 * Прогноз для одной области — всей сети или одной точки — и то, в каком виде
 * его видит страница /analysis. Чистая логика: данные приходят снаружи.
 */

export type ScopeIncomeRow = LearnIncomeRow & { company_id: string }
export type ScopeExpenseRow = LearnExpenseRow & { company_id: string }

export type ScopeForecast = {
  /** Прогноз на следующий месяц — главное на странице */
  next: LearnedForecast & { explanation: string[] }
  /** Что модель говорит про идущий месяц (до фиксации — вместо снимка) */
  current: LearnedForecast
  /** Прежняя модель: история по месяцам, безубыточность, каналы, расходы по статьям */
  monthly: ForecastResult
}

export function forecastForScope(input: {
  incomes: ScopeIncomeRow[]
  expenses: ScopeExpenseRow[]
  categoryGroups: Record<string, string | null>
  today: string
  companyId: string | null
}): ScopeForecast {
  const incomes = input.companyId ? input.incomes.filter((r) => r.company_id === input.companyId) : input.incomes
  const expenses = input.companyId ? input.expenses.filter((r) => r.company_id === input.companyId) : input.expenses

  const currentMonth = input.today.slice(0, 7)
  const points = buildMonthPoints(incomes, expenses, input.categoryGroups, currentMonth)
  const next = learnForecast(points, shiftMonth(currentMonth, 1))

  return {
    next: { ...next, explanation: explainLearning(next) },
    current: learnForecast(points, currentMonth),
    monthly: buildMonthlyForecast(incomes, expenses, input.today, input.categoryGroups),
  }
}

// ==================== snapshots ====================

export type ForecastSnapshotView = {
  /** YYYY-MM */
  targetMonth: string
  scenarios: Scenarios
  actual: Triple | null
  error: { income: number | null; expense: number | null } | null
  inside: Inside | null
  createdAt: string
  /** Зафиксирован не 1-го числа (крон пропустил начало месяца) */
  late: boolean
  modelVersion: string
}

const num = (v: unknown) => Number(v || 0)

export function snapshotFromRow(row: Record<string, any>): ForecastSnapshotView {
  const scenarios: Scenarios = {
    pessimistic: { income: num(row.income_pessimistic), expense: num(row.expense_pessimistic), profit: num(row.profit_pessimistic) },
    realistic: { income: num(row.income_realistic), expense: num(row.expense_realistic), profit: num(row.profit_realistic) },
    optimistic: { income: num(row.income_optimistic), expense: num(row.expense_optimistic), profit: num(row.profit_optimistic) },
  }
  const hasActual = row.actual_income !== null && row.actual_income !== undefined
  const actual: Triple | null = hasActual
    ? { income: num(row.actual_income), expense: num(row.actual_expense), profit: num(row.actual_profit) }
    : null

  return {
    targetMonth: String(row.target_month).slice(0, 7),
    scenarios,
    actual,
    error: actual
      ? {
          income: actual.income > 0 ? Math.abs(scenarios.realistic.income - actual.income) / actual.income : null,
          expense: actual.expense > 0 ? Math.abs(scenarios.realistic.expense - actual.expense) / actual.expense : null,
        }
      : null,
    inside: actual ? evaluateInside(scenarios, actual) : null,
    createdAt: String(row.created_at),
    late: Boolean(row.details?.late),
    modelVersion: String(row.model_version || ''),
  }
}

// ==================== API ====================

export type ForecastByCompany = {
  id: string
  name: string
  scenarios: Scenarios
  recentError: number | null
  checks: number
}

export type MonthlyForecastResponse = {
  forecast: ForecastResult
  next: ScopeForecast['next']
  current: {
    month: string
    model: LearnedForecast
    snapshot: ForecastSnapshotView | null
    /** Сколько выйдет к концу идущего месяца с учётом факта */
    outlook: RunningMonthOutlook | null
  }
  snapshots: ForecastSnapshotView[]
  /** Таблица снимков не создана — миграцию ещё не применили */
  snapshotsWarning: string | null
  byCompany: ForecastByCompany[] | null
}
