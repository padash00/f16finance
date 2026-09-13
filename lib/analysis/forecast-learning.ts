import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

/**
 * Месячный прогноз, который учится на своих ошибках.
 *
 * Прогноз собирается из нескольких простых способов (среднее, тренд,
 * сезонность, «как прошлый месяц»). Модель прогоняется по всей истории так,
 * будто работала с первого месяца: на каждом шаге видит только прошлое, даёт
 * прогноз и сверяется с фактом. По этим сверкам она:
 *
 * - раздаёт веса способам — больше тому, кто меньше ошибался;
 * - снимает систематический перекос (стабильно занижала на 8% — поднимает);
 * - подгоняет коридор «пессимистичный — оптимистичный» так, чтобы факт
 *   попадал в него примерно в 8 месяцах из 10.
 *
 * Это калибровка по собственным промахам, а не «ИИ»: всё считается здесь,
 * детерминированно и проверяемо. Ошибка не падает бесконечно — у спроса есть
 * предел предсказуемости, и сверка это честно покажет.
 */

export const FORECAST_MODEL_VERSION = 'learn-v1'

export type Metric = 'income' | 'expense'
export type MethodId = 'avg3' | 'trend' | 'seasonal' | 'last'

export const METHOD_LABELS: Record<MethodId, string> = {
  avg3: 'Среднее за 3 месяца',
  trend: 'Среднее с трендом',
  seasonal: 'Сезонность (как год назад)',
  last: 'Как прошлый месяц',
}

const METHODS: MethodId[] = ['avg3', 'trend', 'seasonal', 'last']
const METRICS: Metric[] = ['income', 'expense']

/** Сколько последних сверок учитывать в весах и коридоре */
const WINDOW = 12
/** Перекос — по самым свежим сверкам: он меняется быстрее, чем разброс */
const BIAS_WINDOW = 6
const MIN_HISTORY = 3
const MIN_CHECKS = 3
const MIN_CHECKS_FOR_CORRIDOR = 4
/** Коридор по квантилям промахов 10% и 90% — факт внутри ~8 раз из 10 */
const CORRIDOR_LOW_Q = 0.1
const CORRIDOR_HIGH_Q = 0.9

// Расход в прогнозе — регулярный: разовые (CAPEX, штрафы) и распределение
// прибыли не предсказуемы и в модель не входят (как и в прежней модели).
const ONE_OFF_GROUPS = new Set<FinancialGroup>(['capex', 'non_operating'])
const EXCLUDED_GROUPS = new Set<FinancialGroup>(['profit_distribution'])

export type MonthPoint = { month: string; income: number; expense: number }
export type Triple = { income: number; expense: number; profit: number }
export type Scenarios = { pessimistic: Triple; realistic: Triple; optimistic: Triple }
export type Inside = { income: boolean; expense: boolean; profit: boolean }

type Band = { low: number; high: number; source: 'errors' | 'volatility' }

export type Calibration = {
  weights: Record<Metric, Partial<Record<MethodId, number>>>
  /** Множитель поправки на перекос: 1.06 — модель занижала на 6% и прогноз поднят */
  bias: Record<Metric, number>
  /** Коридор дохода и расхода — множители к реальному сценарию */
  corridor: Record<Metric, Band>
  /** Коридор прибыли — сдвиги в тенге относительно реального сценария */
  profitCorridor: Band
  /** Сколько сверок было к моменту прогноза */
  checks: number
}

export type BacktestRecord = {
  month: string
  methods: Record<Metric, Partial<Record<MethodId, number>>>
  raw: Record<Metric, number>
  scenarios: Scenarios
  actual: Triple
  /** |факт − реальный| / факт, доля (0.12 = 12%); null — факт нулевой */
  error: Record<Metric, number | null>
  inside: Inside
}

export type AccuracySummary = {
  checks: number
  /** Средняя ошибка за последние до 6 сверок */
  recentError: Record<Metric, number | null>
  /** Попадание факта в коридор за последние до 12 сверок */
  coverage: { income: { inside: number; total: number }; profit: { inside: number; total: number } }
  /** Ошибка дохода во второй половине сверок против первой */
  trend: 'improving' | 'worsening' | 'flat' | null
}

export type LearnedForecast = {
  targetMonth: string
  scenarios: Scenarios | null
  calibration: Calibration | null
  backtest: BacktestRecord[]
  accuracy: AccuracySummary
  monthsOfData: number
}

// ==================== helpers ====================

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0)
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function median(a: number[]) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Квантиль с линейной интерполяцией */
export function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * clamp(q, 0, 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Сдвиг месяца `YYYY-MM` на delta месяцев */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const errorOf = (predicted: number, actual: number) => (actual > 0 ? Math.abs(predicted - actual) / actual : null)

/** Попал ли факт в коридор сценариев. Для расхода пессимистичный — верхняя граница */
export function evaluateInside(scenarios: Scenarios, actual: Triple): Inside {
  const between = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)
  return {
    income: between(actual.income, scenarios.pessimistic.income, scenarios.optimistic.income),
    expense: between(actual.expense, scenarios.optimistic.expense, scenarios.pessimistic.expense),
    profit: between(actual.profit, scenarios.pessimistic.profit, scenarios.optimistic.profit),
  }
}

export type CorridorBand = {
  incomeLow: number
  incomeHigh: number
  expenseLow: number
  expenseHigh: number
  /** Сдвиги прибыли в тенге */
  profitLow: number
  profitHigh: number
}

/**
 * Коридор, измеренный на отдельной выборке прогнозов (например, сделанных в
 * середине месяца): квантили 10/90% отношений факт/прогноз. Меньше 4 сверок — null.
 */
export function corridorFromChecks(checks: Array<{ predicted: Triple; actual: Triple }>): CorridorBand | null {
  const incomeRatios = checks.filter((c) => c.predicted.income > 0 && c.actual.income > 0).map((c) => c.actual.income / c.predicted.income)
  if (incomeRatios.length < MIN_CHECKS_FOR_CORRIDOR) return null
  const expenseRatios = checks.filter((c) => c.predicted.expense > 0 && c.actual.expense > 0).map((c) => c.actual.expense / c.predicted.expense)
  const profitShifts = checks.map((c) => c.actual.profit - c.predicted.profit)
  const hasExpense = expenseRatios.length >= MIN_CHECKS_FOR_CORRIDOR
  return {
    incomeLow: Math.min(1, quantile(incomeRatios, CORRIDOR_LOW_Q)),
    incomeHigh: Math.max(1, quantile(incomeRatios, CORRIDOR_HIGH_Q)),
    expenseLow: hasExpense ? Math.min(1, quantile(expenseRatios, CORRIDOR_LOW_Q)) : 1,
    expenseHigh: hasExpense ? Math.max(1, quantile(expenseRatios, CORRIDOR_HIGH_Q)) : 1,
    profitLow: Math.min(0, quantile(profitShifts, CORRIDOR_LOW_Q)),
    profitHigh: Math.max(0, quantile(profitShifts, CORRIDOR_HIGH_Q)),
  }
}

/** Сценарии вокруг реального по заданному коридору. Для расхода пессимистичный — верхняя граница */
export function scenariosWithCorridor(realistic: Triple, band: CorridorBand): Scenarios {
  return {
    pessimistic: {
      income: realistic.income * band.incomeLow,
      expense: realistic.expense * band.expenseHigh,
      profit: realistic.profit + band.profitLow,
    },
    realistic,
    optimistic: {
      income: realistic.income * band.incomeHigh,
      expense: realistic.expense * band.expenseLow,
      profit: realistic.profit + band.profitHigh,
    },
  }
}

/** Раздвинуть коридор в `factor` раз относительно реального сценария */
export function widenScenarios(s: Scenarios, factor: number): Scenarios {
  const move = (realistic: number, bound: number) => realistic + (bound - realistic) * factor
  const edge = (bound: Triple): Triple => ({
    income: move(s.realistic.income, bound.income),
    expense: move(s.realistic.expense, bound.expense),
    profit: move(s.realistic.profit, bound.profit),
  })
  return { pessimistic: edge(s.pessimistic), realistic: s.realistic, optimistic: edge(s.optimistic) }
}

// ==================== data ====================

export type LearnIncomeRow = { date: string; cash?: number; kaspi?: number; card?: number; online?: number }
export type LearnExpenseRow = { date: string; category: string | null; cash?: number; kaspi?: number }

function groupOf(category: string | null, categoryGroups: Record<string, string | null>) {
  const key = String(category || '').trim().toLowerCase()
  return resolveFinancialGroup(category, categoryGroups[key] ?? null)
}

/** Доход и регулярный расход по месяцам (все месяцы, где есть хоть что-то) */
export function monthTotals(
  incomes: LearnIncomeRow[],
  expenses: LearnExpenseRow[],
  categoryGroups: Record<string, string | null>,
): Map<string, { income: number; expense: number }> {
  const out = new Map<string, { income: number; expense: number }>()
  const month = (key: string) => {
    let m = out.get(key)
    if (!m) {
      m = { income: 0, expense: 0 }
      out.set(key, m)
    }
    return m
  }
  for (const r of incomes) {
    if (!r.date) continue
    month(r.date.slice(0, 7)).income += (r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0)
  }
  for (const r of expenses) {
    if (!r.date) continue
    const group = groupOf(r.category, categoryGroups)
    if (EXCLUDED_GROUPS.has(group) || ONE_OFF_GROUPS.has(group)) continue
    month(r.date.slice(0, 7)).expense += (r.cash || 0) + (r.kaspi || 0)
  }
  return out
}

/** Закрытые месяцы до `beforeMonth` (не включая) с выручкой — вход для обучения */
export function buildMonthPoints(
  incomes: LearnIncomeRow[],
  expenses: LearnExpenseRow[],
  categoryGroups: Record<string, string | null>,
  beforeMonth: string,
): MonthPoint[] {
  return [...monthTotals(incomes, expenses, categoryGroups)]
    .filter(([month, t]) => month < beforeMonth && t.income > 0)
    .map(([month, t]) => ({ month, income: t.income, expense: t.expense }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// ==================== model ====================

function methodPrediction(history: MonthPoint[], metric: Metric, method: MethodId, targetMonth: string): number | null {
  const values = history.map((p) => p[metric])
  if (!values.length) return null
  const avg3 = mean(values.slice(-3))

  if (method === 'last') return values[values.length - 1]
  if (method === 'avg3') return avg3

  if (method === 'trend') {
    if (values.length < MIN_HISTORY) return null
    const recent = values.slice(-7)
    const growths: number[] = []
    for (let i = 1; i < recent.length; i++) if (recent[i - 1] > 0) growths.push(recent[i] / recent[i - 1] - 1)
    if (!growths.length) return null
    return Math.max(0, avg3 * (1 + clamp(median(growths), -0.3, 0.3)))
  }

  // Сезонность: тот же месяц год назад × насколько бизнес сейчас больше/меньше,
  // чем тогда (последние 3 известных месяца против тех же месяцев годом раньше)
  const byMonth = new Map(history.map((p) => [p.month, p[metric]] as const))
  const sameLastYear = byMonth.get(shiftMonth(targetMonth, -12))
  if (sameLastYear === undefined) return null
  const nowMonths = history.slice(-3).map((p) => p.month)
  if (nowMonths.length < 3) return null
  const thenValues = nowMonths.map((m) => byMonth.get(shiftMonth(m, -12)))
  if (thenValues.some((v) => v === undefined)) return null
  const thenAvg = mean(thenValues as number[])
  if (thenAvg <= 0) return null
  return Math.max(0, sameLastYear * clamp(mean(nowMonths.map((m) => byMonth.get(m) || 0)) / thenAvg, 0.5, 2))
}

function methodWeights(records: BacktestRecord[], metric: Metric, available: MethodId[]) {
  const recent = records.slice(-WINDOW)
  const errors = new Map<MethodId, number>()
  for (const method of available) {
    const errs = recent
      .map((r) => {
        const predicted = r.methods[metric][method]
        return predicted === undefined ? null : errorOf(predicted, r.actual[metric])
      })
      .filter((e): e is number => e !== null)
    if (errs.length >= MIN_CHECKS) errors.set(method, mean(errs))
  }

  const weights: Partial<Record<MethodId, number>> = {}
  if (!errors.size) {
    for (const method of available) weights[method] = 1 / available.length
    return weights
  }
  // Способ без истории сверок оцениваем как худший из проверенных — осторожно
  const worst = Math.max(...errors.values())
  let total = 0
  for (const method of available) {
    // Квадрат обратной ошибки: способ, который стабильно точнее, получает решающий
    // вес. С мягким 1/ошибка идеально точная сезонность отдавала 40% веса отстающим
    // способам и ошибалась на 20%. Добавка 0.02 — чтобы нулевая ошибка не давала ∞.
    const w = 1 / ((errors.get(method) ?? worst) + 0.02) ** 2
    weights[method] = w
    total += w
  }
  for (const method of available) weights[method] = (weights[method] || 0) / total
  return weights
}

function volatilityBand(history: MonthPoint[], metric: Metric): Band {
  const values = history.slice(-6).map((p) => p[metric])
  const m = mean(values) || 1
  const cv = values.length >= 2 ? Math.sqrt(mean(values.map((v) => (v - m) ** 2))) / m : 0.25
  const band = clamp(cv, 0.05, 0.5)
  return { low: 1 - band, high: 1 + band, source: 'volatility' }
}

function predictAt(history: MonthPoint[], targetMonth: string, records: BacktestRecord[]) {
  const recent = records.slice(-WINDOW)
  const methods: BacktestRecord['methods'] = { income: {}, expense: {} }
  const raw: BacktestRecord['raw'] = { income: 0, expense: 0 }
  const weights: Calibration['weights'] = { income: {}, expense: {} }
  const bias: Calibration['bias'] = { income: 1, expense: 1 }
  const corridor = {} as Calibration['corridor']
  const realistic = { income: 0, expense: 0 }

  for (const metric of METRICS) {
    for (const method of METHODS) {
      const value = methodPrediction(history, metric, method, targetMonth)
      if (value !== null && Number.isFinite(value)) methods[metric][method] = value
    }
    const available = Object.keys(methods[metric]) as MethodId[]
    weights[metric] = methodWeights(records, metric, available)
    raw[metric] = available.reduce((s, m) => s + (weights[metric][m] || 0) * (methods[metric][m] || 0), 0)

    const ratios = records
      .slice(-BIAS_WINDOW)
      .filter((r) => r.raw[metric] > 0 && r.actual[metric] > 0)
      .map((r) => r.actual[metric] / r.raw[metric])
    bias[metric] = ratios.length >= MIN_CHECKS ? clamp(median(ratios), 0.75, 1.25) : 1
    realistic[metric] = raw[metric] * bias[metric]

    const residuals = recent
      .filter((r) => r.scenarios.realistic[metric] > 0 && r.actual[metric] > 0)
      .map((r) => r.actual[metric] / r.scenarios.realistic[metric])
    corridor[metric] =
      residuals.length >= MIN_CHECKS_FOR_CORRIDOR
        ? {
            low: Math.min(1, quantile(residuals, CORRIDOR_LOW_Q)),
            high: Math.max(1, quantile(residuals, CORRIDOR_HIGH_Q)),
            source: 'errors',
          }
        : volatilityBand(history, metric)
  }

  const profit = realistic.income - realistic.expense
  const profitResiduals = recent.map((r) => r.actual.profit - r.scenarios.realistic.profit)
  const profitCorridor: Band =
    profitResiduals.length >= MIN_CHECKS_FOR_CORRIDOR
      ? {
          low: Math.min(0, quantile(profitResiduals, CORRIDOR_LOW_Q)),
          high: Math.max(0, quantile(profitResiduals, CORRIDOR_HIGH_Q)),
          source: 'errors',
        }
      : {
          // Пока сверок мало: худшее — доход у нижней границы и расход у верхней
          low: -(realistic.income * (1 - corridor.income.low) + realistic.expense * (corridor.expense.high - 1)),
          high: realistic.income * (corridor.income.high - 1) + realistic.expense * (1 - corridor.expense.low),
          source: 'volatility',
        }

  const scenarios: Scenarios = {
    pessimistic: {
      income: realistic.income * corridor.income.low,
      expense: realistic.expense * corridor.expense.high,
      profit: profit + profitCorridor.low,
    },
    realistic: { income: realistic.income, expense: realistic.expense, profit },
    optimistic: {
      income: realistic.income * corridor.income.high,
      expense: realistic.expense * corridor.expense.low,
      profit: profit + profitCorridor.high,
    },
  }

  const calibration: Calibration = { weights, bias, corridor, profitCorridor, checks: records.length }
  return { methods, raw, scenarios, calibration }
}

function summarize(records: BacktestRecord[]): AccuracySummary {
  const recentErrors = (metric: Metric) => {
    const errs = records
      .slice(-6)
      .map((r) => r.error[metric])
      .filter((e): e is number => e !== null)
    return errs.length ? mean(errs) : null
  }
  const window = records.slice(-WINDOW)
  const incomeErrors = records.map((r) => r.error.income).filter((e): e is number => e !== null)

  let trend: AccuracySummary['trend'] = null
  if (incomeErrors.length >= 6) {
    const half = Math.floor(incomeErrors.length / 2)
    const first = mean(incomeErrors.slice(0, half))
    const second = mean(incomeErrors.slice(half))
    trend = second < first * 0.85 ? 'improving' : second > first * 1.15 ? 'worsening' : 'flat'
  }

  return {
    checks: records.length,
    recentError: { income: recentErrors('income'), expense: recentErrors('expense') },
    coverage: {
      income: { inside: window.filter((r) => r.inside.income).length, total: window.length },
      profit: { inside: window.filter((r) => r.inside.profit).length, total: window.length },
    },
    trend,
  }
}

/**
 * Прогноз на `targetMonth` по закрытым месяцам до него.
 * Попутно — сверки «как если бы модель работала с начала истории».
 */
export function learnForecast(
  points: MonthPoint[],
  targetMonth: string,
  options: {
    /**
     * Идущий месяц, достроенный оценкой. Входит в историю для прогноза, но не
     * в сверки: факта у него ещё нет, и учиться на оценке нельзя.
     */
    provisional?: MonthPoint | null
  } = {},
): LearnedForecast {
  const provisional = options.provisional && options.provisional.month < targetMonth ? options.provisional : null
  const history = points
    .filter((p) => p.month < targetMonth && p.month !== provisional?.month)
    .sort((a, b) => a.month.localeCompare(b.month))
  const records: BacktestRecord[] = []

  for (let i = MIN_HISTORY; i < history.length; i++) {
    const target = history[i]
    const prediction = predictAt(history.slice(0, i), target.month, records)
    const actual: Triple = { income: target.income, expense: target.expense, profit: target.income - target.expense }
    records.push({
      month: target.month,
      methods: prediction.methods,
      raw: prediction.raw,
      scenarios: prediction.scenarios,
      actual,
      error: {
        income: errorOf(prediction.scenarios.realistic.income, actual.income),
        expense: errorOf(prediction.scenarios.realistic.expense, actual.expense),
      },
      inside: evaluateInside(prediction.scenarios, actual),
    })
  }

  const basis = provisional ? [...history, provisional].sort((a, b) => a.month.localeCompare(b.month)) : history
  const final = basis.length ? predictAt(basis, targetMonth, records) : null
  return {
    targetMonth,
    scenarios: final?.scenarios ?? null,
    calibration: final?.calibration ?? null,
    backtest: records,
    accuracy: summarize(records),
    monthsOfData: history.length,
  }
}

// ==================== идущий месяц ====================

export type RunningMonthOutlook = {
  /** YYYY-MM */
  month: string
  dayOfMonth: number
  daysInMonth: number
  /** Дней с фактом: по вчера — сегодняшние отчёты смен обычно ещё не внесены */
  knownDays: number
  knownShare: number
  fact: Triple
  /** Прогноз на начало месяца (зафиксированный 1-го числа или расчёт модели) */
  start: Scenarios
  /** Прогноз к концу месяца с учётом факта */
  outlook: Scenarios
  /** Доход к концу месяца, если остаток пойдёт темпом последних 8 недель по дням недели */
  paceIncome: number | null
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDaysIso = (iso: string, days: number) => {
  const d = dateOf(iso)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Сколько выйдет к концу идущего месяца: факт по вчерашний день плюс оценка
 * оставшихся дней. Коридор сценариев применяется только к оставшейся части,
 * поэтому с каждым днём он сужается сам.
 *
 * - доход остатка — смесь прогноза на начало месяца и свежего темпа по дням
 *   недели (у клуба выходные сильнее будней); чем больше месяца прошло, тем
 *   больше веса темпу;
 * - расход — не меньше прогноза на начало месяца: аренда и ФОТ известны
 *   заранее и платятся в определённые дни, растягивать факт на месяц нельзя.
 *   Уже потратили больше — считаем по факту.
 */
export function projectRunningMonth(input: {
  incomes: LearnIncomeRow[]
  expenses: LearnExpenseRow[]
  categoryGroups: Record<string, string | null>
  today: string
  start: Scenarios
}): RunningMonthOutlook {
  const { today, start } = input
  const month = today.slice(0, 7)
  const monthStart = `${month}-01`
  const [year, monthNum] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNum, 0).getDate()
  const dayOfMonth = Number(today.slice(8, 10))
  const knownDays = Math.max(0, dayOfMonth - 1)
  const remainingDays = daysInMonth - knownDays
  const knownShare = knownDays / daysInMonth

  const paceFrom = addDaysIso(today, -56)
  const daily = new Map<string, number>()
  let factIncome = 0
  for (const r of input.incomes) {
    if (!r.date || r.date >= today) continue
    const amount = (r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0)
    if (r.date >= monthStart) factIncome += amount
    if (r.date >= paceFrom) daily.set(r.date, (daily.get(r.date) || 0) + amount)
  }

  let factExpense = 0
  for (const r of input.expenses) {
    if (!r.date || r.date < monthStart || r.date >= today) continue
    const group = groupOf(r.category, input.categoryGroups)
    if (EXCLUDED_GROUPS.has(group) || ONE_OFF_GROUPS.has(group)) continue
    factExpense += (r.cash || 0) + (r.kaspi || 0)
  }

  // Средний доход по дням недели за 8 недель. Дни без записей не считаем
  // нулём — это чаще невнесённый отчёт, чем закрытая точка.
  const byWeekday = Array.from({ length: 7 }, () => [] as number[])
  for (const [date, amount] of daily) if (amount > 0) byWeekday[dateOf(date).getDay()].push(amount)
  const workedDays = [...daily.values()].filter((v) => v > 0)
  let pace: number | null = null
  if (workedDays.length >= 7) {
    const overall = mean(workedDays)
    pace = 0
    for (let i = 0; i < remainingDays; i++) {
      const samples = byWeekday[dateOf(addDaysIso(today, i)).getDay()]
      pace += samples.length >= 2 ? mean(samples) : overall
    }
  }

  const modelRemainingIncome = start.realistic.income * (remainingDays / daysInMonth)
  const remainingIncome = pace === null ? modelRemainingIncome : knownShare * pace + (1 - knownShare) * modelRemainingIncome
  const remainingExpense = Math.max(0, start.realistic.expense - factExpense)

  const ratio = (a: number, b: number) => (b > 0 ? a / b : 1)
  const scenario = (incomeK: number, expenseK: number): Triple => {
    const income = factIncome + remainingIncome * incomeK
    const expense = factExpense + remainingExpense * expenseK
    return { income, expense, profit: income - expense }
  }

  return {
    month,
    dayOfMonth,
    daysInMonth,
    knownDays,
    knownShare,
    fact: { income: factIncome, expense: factExpense, profit: factIncome - factExpense },
    start,
    outlook: {
      pessimistic: scenario(ratio(start.pessimistic.income, start.realistic.income), ratio(start.pessimistic.expense, start.realistic.expense)),
      realistic: scenario(1, 1),
      optimistic: scenario(ratio(start.optimistic.income, start.realistic.income), ratio(start.optimistic.expense, start.realistic.expense)),
    },
    paceIncome: pace === null ? null : factIncome + pace,
  }
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** Человеческое объяснение: как модель пришла к прогнозу и чему научилась */
export function explainLearning(learned: LearnedForecast): string[] {
  const lines: string[] = []
  const { calibration, accuracy } = learned
  if (!calibration || !learned.scenarios) {
    lines.push('Данных пока нет — прогноз появится после первого закрытого месяца.')
    return lines
  }

  if (learned.monthsOfData < MIN_HISTORY) {
    lines.push(`Закрытых месяцев всего ${learned.monthsOfData} — прогноз очень грубый, учиться пока не на чем.`)
  }

  const weights = Object.entries(calibration.weights.income)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([method, w]) => `${METHOD_LABELS[method as MethodId]} ${pct(w || 0)}`)
  if (weights.length) {
    lines.push(
      accuracy.checks >= MIN_CHECKS
        ? `Доход собран из нескольких способов, больше веса у тех, кто меньше ошибался: ${weights.join(', ')}.`
        : `Доход собран из нескольких способов поровну — сверок пока мало, чтобы выбрать лучший: ${weights.join(', ')}.`,
    )
  }

  const incomeBias = calibration.bias.income
  if (Math.abs(incomeBias - 1) >= 0.02) {
    lines.push(
      `В последние месяцы модель ${incomeBias > 1 ? 'занижала' : 'завышала'} доход в среднем на ${pct(Math.abs(incomeBias - 1))} — прогноз поправлен на ${incomeBias > 1 ? '+' : '−'}${pct(Math.abs(incomeBias - 1))}.`,
    )
  } else if (accuracy.checks >= MIN_CHECKS) {
    lines.push('Систематического перекоса в доходе нет — поправка не нужна.')
  }

  const band = calibration.corridor.income
  if (band.source === 'errors') {
    const cover = accuracy.coverage.income
    lines.push(
      `Коридор дохода подогнан по прошлым промахам: пессимистичный −${pct(1 - band.low)}, оптимистичный +${pct(band.high - 1)}. Факт попадал в коридор ${cover.inside} из ${cover.total} месяцев.`,
    )
  } else {
    lines.push(`Сверок пока мало — коридор дохода по разбросу последних месяцев: ±${pct(band.high - 1)}.`)
  }

  const recent = accuracy.recentError.income
  if (recent !== null) {
    const trendText =
      accuracy.trend === 'improving'
        ? ' Ошибка со временем снижается.'
        : accuracy.trend === 'worsening'
          ? ' Ошибка со временем растёт — бизнес меняется быстрее, чем модель успевает подстроиться.'
          : accuracy.trend === 'flat'
            ? ' Ошибка держится на одном уровне — похоже на предел предсказуемости спроса.'
            : ''
    lines.push(`Средняя ошибка дохода за последние месяцы — ${pct(recent)}.${trendText}`)
  }

  return lines
}
