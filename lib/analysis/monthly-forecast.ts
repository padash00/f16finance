// Месячный прогноз дохода/расхода на следующий месяц.
// Честная, прозрачная модель: тренд по месяцам + run-rate текущего месяца +
// (сезонность только при ≥13 мес данных). Расход разложен на постоянные /
// переменные (% от дохода) / разовые (вне прогноза). Чистая логика, без сети.

import { inferFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

export type ForecastIncomeRow = { date: string; cash?: number; kaspi?: number; card?: number; online?: number }
export type ForecastExpenseRow = { date: string; category: string | null; cash?: number; kaspi?: number }

// Группы расходов → корзина прогноза
const VARIABLE_GROUPS = new Set<FinancialGroup>(['cogs', 'pos_commission'])
const ONEOFF_GROUPS = new Set<FinancialGroup>(['capex', 'non_operating'])
const EXCLUDE_GROUPS = new Set<FinancialGroup>(['profit_distribution']) // распределение прибыли — не расход

export type MonthAgg = {
  month: string // YYYY-MM
  income: number
  fixed: number
  variable: number
  oneOff: number
  expense: number // fixed + variable (операционный расход, без разовых)
  profit: number // income - expense
  isPartial: boolean
}

export type ForecastResult = {
  months: MonthAgg[]
  targetMonth: string
  targetMonthLabel: string
  income: { expected: number; low: number; high: number; recentAvg: number; momGrowthPct: number; seasonalIndex: number; runRate: number | null }
  expense: { expected: number; fixed: number; variable: number; variableRatePct: number; oneOffAvg: number }
  profit: { expected: number; low: number; high: number }
  scenarios: { best: number; expected: number; worst: number } // прибыль
  expenseByGroup: Array<{ group: FinancialGroup; label: string; amount: number; bucket: 'fixed' | 'variable' }>
  confidence: { score: number; monthsOfData: number; seasonalityAvailable: boolean; volatilityPct: number; notes: string[] }
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0)
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
function median(a: number[]) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function monthOf(iso: string) { return iso.slice(0, 7) }
function addMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1) // m (1-based) → следующий месяц как 0-based индекс
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[(m - 1) % 12]} ${y}`
}

/**
 * @param todayISO — сегодня (для определения текущего/частичного месяца и run-rate).
 */
export function buildMonthlyForecast(
  incomes: ForecastIncomeRow[],
  expenses: ForecastExpenseRow[],
  todayISO: string,
): ForecastResult {
  const curMonth = monthOf(todayISO)
  const dayOfMonth = Number(todayISO.slice(8, 10))

  // ── Месячные агрегаты ──
  const map = new Map<string, MonthAgg>()
  const ensure = (ym: string) => {
    let e = map.get(ym)
    if (!e) { e = { month: ym, income: 0, fixed: 0, variable: 0, oneOff: 0, expense: 0, profit: 0, isPartial: ym === curMonth }; map.set(ym, e) }
    return e
  }
  for (const r of incomes) {
    if (!r.date) continue
    ensure(monthOf(r.date)).income += (r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0)
  }
  // расход по группам (для разложения и для блока «по категориям»)
  const groupTotals = new Map<FinancialGroup, number>()
  for (const r of expenses) {
    if (!r.date) continue
    const g = inferFinancialGroup(r.category)
    if (EXCLUDE_GROUPS.has(g)) continue
    const amt = (r.cash || 0) + (r.kaspi || 0)
    const e = ensure(monthOf(r.date))
    if (VARIABLE_GROUPS.has(g)) e.variable += amt
    else if (ONEOFF_GROUPS.has(g)) e.oneOff += amt
    else e.fixed += amt
    // группы считаем только за полные месяцы ниже; здесь копим за последние месяцы — посчитаем отдельно
    groupTotals.set(g, (groupTotals.get(g) || 0) + amt)
  }
  for (const e of map.values()) { e.expense = e.fixed + e.variable; e.profit = e.income - e.expense }

  const months = [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
  const complete = months.filter((m) => !m.isPartial && m.income > 0)
  const partial = months.find((m) => m.isPartial) || null
  const monthsOfData = complete.length

  // ── ДОХОД: recentAvg × (1 + тренд) × сезонность, затем блендим с run-rate ──
  const recentN = complete.slice(-3)
  const recentAvg = mean(recentN.map((m) => m.income))

  // месяц-к-месяцу рост (медиана отношений по полным месяцам)
  const growths: number[] = []
  for (let i = 1; i < complete.length; i++) {
    const prev = complete[i - 1].income
    if (prev > 0) growths.push(complete[i].income / prev - 1)
  }
  const momGrowth = clamp(median(growths), -0.3, 0.3) // ограничитель: не больше ±30%/мес

  const targetMonth = addMonth(curMonth)
  const targetMonthNum = Number(targetMonth.slice(5, 7))

  // сезонность только при ≥13 месяцах (есть тот же месяц год назад)
  const seasonalityAvailable = monthsOfData >= 13
  let seasonalIndex = 1
  if (seasonalityAvailable) {
    const overall = mean(complete.map((m) => m.income))
    const sameMonth = complete.filter((m) => Number(m.month.slice(5, 7)) === targetMonthNum).map((m) => m.income)
    if (overall > 0 && sameMonth.length) seasonalIndex = clamp(mean(sameMonth) / overall, 0.6, 1.6)
  }

  let incomeExpected = recentAvg * (1 + momGrowth) * seasonalIndex

  // run-rate текущего месяца: если месяц частичный и прошло ≥7 дней — блендим
  let runRate: number | null = null
  if (partial && dayOfMonth >= 7) {
    const daysInCur = new Date(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)), 0).getDate()
    runRate = partial.income / dayOfMonth * daysInCur
    incomeExpected = 0.5 * incomeExpected + 0.5 * runRate
  }
  incomeExpected = Math.max(0, incomeExpected)

  // волатильность дохода (CV полных месяцев) → диапазон
  const incVals = complete.map((m) => m.income)
  const incMean = mean(incVals) || 1
  const incCv = incVals.length >= 2 ? Math.sqrt(mean(incVals.map((v) => (v - incMean) ** 2))) / incMean : 0.25
  const band = clamp(incCv, 0.05, 0.5)
  const incomeLow = Math.max(0, incomeExpected * (1 - band))
  const incomeHigh = incomeExpected * (1 + band)

  // ── РАСХОД: постоянные (медиана) + переменные (% от дохода) ──
  const fixedForecast = median(recentN.map((m) => m.fixed)) || median(complete.map((m) => m.fixed))
  const varSum = sum(complete.map((m) => m.variable))
  const incSum = sum(complete.map((m) => m.income))
  const variableRate = incSum > 0 ? varSum / incSum : 0
  const variableForecast = variableRate * incomeExpected
  const expenseExpected = fixedForecast + variableForecast
  const oneOffAvg = mean(complete.map((m) => m.oneOff))

  const profitExpected = incomeExpected - expenseExpected
  // сценарии прибыли: лучший = высокий доход (переменные растут с ним) − постоянные; худший наоборот
  const best = incomeHigh - (fixedForecast + variableRate * incomeHigh)
  const worst = incomeLow - (fixedForecast + variableRate * incomeLow)

  // разложение расхода по группам (на базе последних 3 полных месяцев, среднее/мес)
  const groupByMonth = new Map<FinancialGroup, number[]>()
  // пересчёт по группам помесячно для последних 3 — упрощённо берём средние из суммарных групп / число полных мес
  // (groupTotals копит за всю историю; для прогноза показываем среднее за месяц по последним полным)
  const expenseByGroup: ForecastResult['expenseByGroup'] = []
  for (const [g, total] of groupTotals) {
    if (ONEOFF_GROUPS.has(g)) continue
    const perMonth = monthsOfData > 0 ? total / Math.max(1, monthsOfData) : total
    expenseByGroup.push({
      group: g,
      label: groupLabel(g),
      amount: perMonth,
      bucket: VARIABLE_GROUPS.has(g) ? 'variable' : 'fixed',
    })
  }
  expenseByGroup.sort((a, b) => b.amount - a.amount)
  void groupByMonth

  // ── Уверенность ──
  const notes: string[] = []
  if (monthsOfData < 3) notes.push('Меньше 3 полных месяцев — прогноз очень грубый.')
  if (!seasonalityAvailable) notes.push('Сезонность по месяцам появится после года данных (нужно ≥13 месяцев).')
  if (incCv > 0.35) notes.push('Высокая волатильность дохода между месяцами — диапазон широкий.')
  if (runRate !== null) notes.push('Учтён run-rate текущего месяца (фактический темп).')
  let score = 40
  score += clamp(monthsOfData * 5, 0, 35)
  score += seasonalityAvailable ? 10 : 0
  score -= clamp((incCv - 0.2) * 60, 0, 25)
  score = Math.round(clamp(score, 5, 95))

  return {
    months,
    targetMonth,
    targetMonthLabel: monthLabel(targetMonth),
    income: { expected: incomeExpected, low: incomeLow, high: incomeHigh, recentAvg, momGrowthPct: momGrowth * 100, seasonalIndex, runRate },
    expense: { expected: expenseExpected, fixed: fixedForecast, variable: variableForecast, variableRatePct: variableRate * 100, oneOffAvg },
    profit: { expected: profitExpected, low: worst, high: best },
    scenarios: { best, expected: profitExpected, worst },
    expenseByGroup,
    confidence: { score, monthsOfData, seasonalityAvailable, volatilityPct: incCv * 100, notes },
  }
}

function groupLabel(g: FinancialGroup): string {
  const map: Record<FinancialGroup, string> = {
    cogs: 'Себестоимость (COGS)', operating: 'Операционные', pos_commission: 'Комиссия POS',
    payroll: 'ФОТ', payroll_advance: 'Авансы', payroll_tax: 'Налоги на ЗП',
    depreciation: 'Амортизация', financial_expenses: 'Финансовые', income_tax: 'Налог на прибыль',
    capex: 'CAPEX', profit_distribution: 'Распределение прибыли', non_operating: 'Разовые',
  }
  return map[g] || g
}
