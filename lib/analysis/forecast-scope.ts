import { findIncompleteMonths, type IncompleteMonth } from '@/lib/analysis/data-completeness'
import {
  buildMonthPoints,
  corridorFromChecks,
  evaluateInside,
  explainLearning,
  learnForecast,
  projectRunningMonth,
  scenariosWithCorridor,
  shiftMonth,
  widenScenarios,
  type Inside,
  type LearnedForecast,
  type LearnExpenseRow,
  type LearnIncomeRow,
  type MonthPoint,
  type RunningMonthOutlook,
  type Scenarios,
  type Triple,
} from '@/lib/analysis/forecast-learning'
import { buildMonthlyForecast, type ForecastResult } from '@/lib/analysis/monthly-forecast'

/**
 * Прогноз для одной области — всей сети или одной точки — и то, в каком виде
 * его видит страница /analysis. Чистая логика: данные приходят снаружи.
 *
 * - неполные месяцы (недовнесённые отчёты) в обучение не идут;
 * - идущий месяц достраивается оценкой и учитывается в прогнозе на следующий,
 *   а коридор такого прогноза измерен на прогнозах, сделанных того же числа
 *   прошлых месяцев.
 */

export type ScopeIncomeRow = LearnIncomeRow & { company_id: string }
export type ScopeExpenseRow = LearnExpenseRow & { company_id: string }

export type MidMonthAccuracy = {
  /** Число месяца, на которое сделан прогноз */
  day: number
  checks: number
  /** Средняя ошибка дохода прогнозов, сделанных этого числа */
  error: number | null
  /** Для сравнения — ошибка прогнозов, сделанных после закрытия месяца */
  closedError: number | null
}

export type NextForecast = LearnedForecast & {
  explanation: string[]
  basis: {
    /** Идущий месяц, учтённый оценкой; null — прогноз только по закрытым месяцам */
    provisionalMonth: string | null
    knownDays: number
    midMonth: MidMonthAccuracy | null
  }
}

export type ScopeForecast = {
  next: NextForecast
  current: LearnedForecast
  outlook: RunningMonthOutlook | null
  monthly: ForecastResult
  incompleteMonths: IncompleteMonth[]
}

const MID_MONTH_WINDOW = 12
const MONTH_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthIndex = (ym: string) => (Number(ym.slice(5, 7)) - 1) % 12
const pct = (share: number) => `${Math.round(share * 100)}%`
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

/**
 * Прогнозы на следующий месяц, сделанные `day`-го числа прошлых месяцев:
 * месяц t достраивается оценкой по данным до этого дня, прогноз на t+1
 * сравнивается с фактом t+1. Заодно — ошибка прогнозов после закрытия t.
 */
function midMonthChecks(input: {
  incomes: LearnIncomeRow[]
  expenses: LearnExpenseRow[]
  categoryGroups: Record<string, string | null>
  points: MonthPoint[]
  day: number
}) {
  const checks: Array<{ predicted: Triple; actual: Triple }> = []
  const midErrors: number[] = []
  const closedErrors: number[] = []
  const byMonth = new Map(input.points.map((p) => [p.month, p] as const))

  for (const t of input.points.slice(-(MID_MONTH_WINDOW + 1), -1)) {
    const nextMonth = shiftMonth(t.month, 1)
    const actualNext = byMonth.get(nextMonth)
    if (!actualNext) continue
    const before = input.points.filter((p) => p.month < t.month)
    if (before.length < 3) continue
    const start = learnForecast(before, t.month).scenarios
    if (!start) continue

    const daysInT = new Date(Number(t.month.slice(0, 4)), Number(t.month.slice(5, 7)), 0).getDate()
    const asOf = `${t.month}-${String(Math.min(input.day, daysInT)).padStart(2, '0')}`
    const estimate = projectRunningMonth({
      incomes: input.incomes,
      expenses: input.expenses,
      categoryGroups: input.categoryGroups,
      today: asOf,
      start,
    })
    const mid = learnForecast(before, nextMonth, {
      provisional: { month: t.month, income: estimate.outlook.realistic.income, expense: estimate.outlook.realistic.expense },
    }).scenarios
    const closed = learnForecast(input.points.filter((p) => p.month <= t.month), nextMonth).scenarios
    if (!mid || !closed) continue

    const actual: Triple = { income: actualNext.income, expense: actualNext.expense, profit: actualNext.income - actualNext.expense }
    checks.push({ predicted: mid.realistic, actual })
    if (actual.income > 0) {
      midErrors.push(Math.abs(mid.realistic.income - actual.income) / actual.income)
      closedErrors.push(Math.abs(closed.realistic.income - actual.income) / actual.income)
    }
  }

  return { checks, error: mean(midErrors), closedError: mean(closedErrors) }
}

export function forecastForScope(input: {
  incomes: ScopeIncomeRow[]
  expenses: ScopeExpenseRow[]
  categoryGroups: Record<string, string | null>
  today: string
  companyId: string | null
  /** Прогноз на идущий месяц, зафиксированный 1-го числа; без него — расчёт модели */
  startScenarios?: Scenarios | null
}): ScopeForecast {
  const incomes = input.companyId ? input.incomes.filter((r) => r.company_id === input.companyId) : input.incomes
  const expenses = input.companyId ? input.expenses.filter((r) => r.company_id === input.companyId) : input.expenses
  const { categoryGroups, today } = input

  const currentMonth = today.slice(0, 7)
  const nextMonth = shiftMonth(currentMonth, 1)

  const incompleteMonths = findIncompleteMonths(incomes, currentMonth)
  const excluded = new Set(incompleteMonths.map((m) => m.month))
  const points = buildMonthPoints(incomes, expenses, categoryGroups, currentMonth).filter((p) => !excluded.has(p.month))

  const current = learnForecast(points, currentMonth)
  const start = input.startScenarios ?? current.scenarios
  const outlook = start ? projectRunningMonth({ incomes, expenses, categoryGroups, today, start }) : null

  const provisional: MonthPoint | null =
    outlook && outlook.knownDays > 0
      ? { month: currentMonth, income: outlook.outlook.realistic.income, expense: outlook.outlook.realistic.expense }
      : null
  const learned = learnForecast(points, nextMonth, { provisional })

  let scenarios = learned.scenarios
  let midMonth: MidMonthAccuracy | null = null
  if (provisional && outlook && scenarios) {
    const mid = midMonthChecks({ incomes, expenses, categoryGroups, points, day: outlook.dayOfMonth })
    midMonth = { day: outlook.dayOfMonth, checks: mid.checks.length, error: mid.error, closedError: mid.closedError }
    const band = corridorFromChecks(mid.checks)
    // Коридор измерен на таких же прогнозах середины месяца. Сверок мало —
    // раздвигаем обычный коридор на неизвестную часть месяца.
    scenarios = band ? scenariosWithCorridor(scenarios.realistic, band) : widenScenarios(scenarios, 1 + (1 - outlook.knownShare) * 0.5)
  }

  const next: LearnedForecast = { ...learned, scenarios }
  const explanation = explainLearning(next)
  if (provisional && outlook) {
    explanation.unshift(
      `Учтён идущий ${MONTH_NAMES[monthIndex(currentMonth)]}: факт за ${outlook.knownDays} дн. и оценка остатка. Пока месяц не закрыт, коридор шире.`,
    )
    if (midMonth?.error != null) {
      explanation.push(
        `Прогнозы, сделанные ${midMonth.day}-го числа, раньше ошибались в среднем на ${pct(midMonth.error)}${
          midMonth.closedError != null ? `, сделанные после закрытия месяца — на ${pct(midMonth.closedError)}` : ''
        } (${midMonth.checks} сверок).`,
      )
    }
  }
  const recentIncomplete = incompleteMonths.filter((m) => m.month >= shiftMonth(currentMonth, -12))
  if (recentIncomplete.length) {
    const months = [...new Set(recentIncomplete.map((m) => m.month))]
      .map((m) => `${MONTH_NAMES[monthIndex(m)]} ${m.slice(0, 4)}`)
      .join(', ')
    explanation.push(`Не участвуют в обучении из-за неполных данных: ${months}. Когда отчёты внесут, месяц вернётся в расчёт сам.`)
  }

  return {
    next: {
      ...next,
      explanation,
      basis: { provisionalMonth: provisional?.month ?? null, knownDays: outlook?.knownDays ?? 0, midMonth },
    },
    current,
    outlook,
    monthly: buildMonthlyForecast(incomes, expenses, today, categoryGroups),
    incompleteMonths,
  }
}

export const monthGenitive = (ym: string) => MONTH_GENITIVE[monthIndex(ym)]

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
  next: NextForecast
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
  /** Неполные месяцы за последний год — в обучение не идут */
  dataQuality: Array<IncompleteMonth & { companyName: string }>
}
