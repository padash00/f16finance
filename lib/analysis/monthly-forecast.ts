// Месячный прогноз дохода/расхода на следующий месяц.
// Честная, прозрачная модель: тренд по месяцам + run-rate текущего месяца +
// (сезонность только при ≥13 мес данных). Расход разложен на постоянные /
// переменные (% от дохода) / разовые (вне прогноза). Чистая логика, без сети.

import { inferFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

export type ForecastIncomeRow = { date: string; cash?: number; kaspi?: number; card?: number; online?: number }
export type ForecastExpenseRow = { date: string; category: string | null; cash?: number; kaspi?: number }

const VARIABLE_GROUPS = new Set<FinancialGroup>(['cogs', 'pos_commission'])
const ONEOFF_GROUPS = new Set<FinancialGroup>(['capex', 'non_operating'])
const EXCLUDE_GROUPS = new Set<FinancialGroup>(['profit_distribution'])

export type MonthAgg = {
  month: string
  income: number
  cash: number; kaspi: number; card: number; online: number
  fixed: number; variable: number; oneOff: number
  expense: number
  profit: number
  marginPct: number
  isPartial: boolean
}

export type ForecastResult = {
  months: MonthAgg[]
  targetMonth: string
  targetMonthLabel: string
  income: { expected: number; low: number; high: number; recentAvg: number; momGrowthPct: number; seasonalIndex: number; runRate: number | null }
  channels: { cash: number; kaspi: number; card: number; online: number }
  expense: { expected: number; fixed: number; variable: number; variableRatePct: number; oneOffAvg: number }
  profit: { expected: number; low: number; high: number; marginPct: number }
  scenarios: { best: number; expected: number; worst: number }
  breakeven: { revenue: number; safetyMarginPct: number }
  current: { month: string; factToDate: number; projected: number | null; dayOfMonth: number; daysInMonth: number } | null
  backtest: { month: string; predictedIncome: number; actualIncome: number; incomeErrorPct: number } | null
  expenseByGroup: Array<{ group: FinancialGroup; label: string; amount: number; bucket: 'fixed' | 'variable' }>
  explanation: string[]
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
const monthOf = (iso: string) => iso.slice(0, 7)
function addMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[(m - 1) % 12]} ${y}` }
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

// Проекция дохода из истории полных месяцев (без run-rate) — для прогноза и backtest.
function projectIncome(history: MonthAgg[], targetMonthNum: number): { value: number; recentAvg: number; momGrowthPct: number; seasonalIndex: number; seasonalityAvailable: boolean } {
  const recentAvg = mean(history.slice(-3).map((m) => m.income))
  const growths: number[] = []
  for (let i = 1; i < history.length; i++) { const p = history[i - 1].income; if (p > 0) growths.push(history[i].income / p - 1) }
  const momGrowth = clamp(median(growths), -0.3, 0.3)
  const seasonalityAvailable = history.length >= 13
  let seasonalIndex = 1
  if (seasonalityAvailable) {
    const overall = mean(history.map((m) => m.income))
    const same = history.filter((m) => Number(m.month.slice(5, 7)) === targetMonthNum).map((m) => m.income)
    if (overall > 0 && same.length) seasonalIndex = clamp(mean(same) / overall, 0.6, 1.6)
  }
  return { value: Math.max(0, recentAvg * (1 + momGrowth) * seasonalIndex), recentAvg, momGrowthPct: momGrowth * 100, seasonalIndex, seasonalityAvailable }
}

export function buildMonthlyForecast(incomes: ForecastIncomeRow[], expenses: ForecastExpenseRow[], todayISO: string): ForecastResult {
  const curMonth = monthOf(todayISO)
  const dayOfMonth = Number(todayISO.slice(8, 10))

  const map = new Map<string, MonthAgg>()
  const ensure = (ym: string) => {
    let e = map.get(ym)
    if (!e) { e = { month: ym, income: 0, cash: 0, kaspi: 0, card: 0, online: 0, fixed: 0, variable: 0, oneOff: 0, expense: 0, profit: 0, marginPct: 0, isPartial: ym === curMonth }; map.set(ym, e) }
    return e
  }
  for (const r of incomes) {
    if (!r.date) continue
    const e = ensure(monthOf(r.date))
    e.cash += r.cash || 0; e.kaspi += r.kaspi || 0; e.card += r.card || 0; e.online += r.online || 0
    e.income += (r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0)
  }
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
    groupTotals.set(g, (groupTotals.get(g) || 0) + amt)
  }
  for (const e of map.values()) { e.expense = e.fixed + e.variable; e.profit = e.income - e.expense; e.marginPct = e.income > 0 ? e.profit / e.income * 100 : 0 }

  const months = [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
  const complete = months.filter((m) => !m.isPartial && m.income > 0)
  const partial = months.find((m) => m.isPartial && m.income > 0) || null
  const monthsOfData = complete.length

  const targetMonth = addMonth(curMonth)
  const targetMonthNum = Number(targetMonth.slice(5, 7))

  const proj = projectIncome(complete, targetMonthNum)
  let incomeExpected = proj.value

  let runRate: number | null = null
  let current: ForecastResult['current'] = null
  const daysInCur = new Date(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)), 0).getDate()
  if (partial) {
    if (dayOfMonth >= 7) {
      runRate = partial.income / dayOfMonth * daysInCur
      incomeExpected = 0.5 * incomeExpected + 0.5 * runRate
    }
    current = { month: curMonth, factToDate: partial.income, projected: runRate, dayOfMonth, daysInMonth: daysInCur }
  }
  incomeExpected = Math.max(0, incomeExpected)

  const incVals = complete.map((m) => m.income)
  const incMean = mean(incVals) || 1
  const incCv = incVals.length >= 2 ? Math.sqrt(mean(incVals.map((v) => (v - incMean) ** 2))) / incMean : 0.25
  const band = clamp(incCv, 0.05, 0.5)
  const incomeLow = Math.max(0, incomeExpected * (1 - band))
  const incomeHigh = incomeExpected * (1 + band)

  // Расход
  const recentN = complete.slice(-3)
  const fixedForecast = median(recentN.map((m) => m.fixed)) || median(complete.map((m) => m.fixed))
  const varSum = sum(complete.map((m) => m.variable))
  const incSum = sum(complete.map((m) => m.income))
  const variableRate = incSum > 0 ? varSum / incSum : 0
  const variableForecast = variableRate * incomeExpected
  const expenseExpected = fixedForecast + variableForecast
  const oneOffAvg = mean(complete.map((m) => m.oneOff))

  const profitExpected = incomeExpected - expenseExpected
  const best = incomeHigh - (fixedForecast + variableRate * incomeHigh)
  const worst = incomeLow - (fixedForecast + variableRate * incomeLow)
  const marginPct = incomeExpected > 0 ? profitExpected / incomeExpected * 100 : 0

  // Точка безубыточности: выручка, при которой прибыль = 0 (постоянные / (1 - доля переменных))
  const beRevenue = variableRate < 1 ? fixedForecast / (1 - variableRate) : 0
  const safetyMarginPct = incomeExpected > 0 ? (incomeExpected - beRevenue) / incomeExpected * 100 : 0

  // Каналы дохода — доля по последним 3 полным месяцам × прогноз
  const chSum = (k: 'cash' | 'kaspi' | 'card' | 'online') => sum(recentN.map((m) => m[k]))
  const chTotal = chSum('cash') + chSum('kaspi') + chSum('card') + chSum('online') || 1
  const channels = {
    cash: incomeExpected * chSum('cash') / chTotal,
    kaspi: incomeExpected * chSum('kaspi') / chTotal,
    card: incomeExpected * chSum('card') / chTotal,
    online: incomeExpected * chSum('online') / chTotal,
  }

  // Backtest: предсказываем последний полный месяц по данным ДО него, сравниваем с фактом
  let backtest: ForecastResult['backtest'] = null
  if (complete.length >= 3) {
    const hist = complete.slice(0, -1)
    const actualM = complete[complete.length - 1]
    const p = projectIncome(hist, Number(actualM.month.slice(5, 7)))
    const err = actualM.income > 0 ? Math.abs(p.value - actualM.income) / actualM.income * 100 : 0
    backtest = { month: actualM.month, predictedIncome: p.value, actualIncome: actualM.income, incomeErrorPct: err }
  }

  // Расход по группам (среднее/мес)
  const expenseByGroup: ForecastResult['expenseByGroup'] = []
  for (const [g, total] of groupTotals) {
    if (ONEOFF_GROUPS.has(g)) continue
    expenseByGroup.push({ group: g, label: groupLabel(g), amount: monthsOfData > 0 ? total / Math.max(1, monthsOfData) : total, bucket: VARIABLE_GROUPS.has(g) ? 'variable' : 'fixed' })
  }
  expenseByGroup.sort((a, b) => b.amount - a.amount)

  // Объяснение «почему столько»
  const explanation: string[] = []
  explanation.push(`Средний доход за последние ${recentN.length || 0} мес — ${fmt(proj.recentAvg)}.`)
  explanation.push(`Тренд по месяцам ${proj.momGrowthPct >= 0 ? '+' : ''}${proj.momGrowthPct.toFixed(1)}%/мес.`)
  if (proj.seasonalityAvailable) explanation.push(`Сезонность ${monthLabel(targetMonth).split(' ')[0]} ×${proj.seasonalIndex.toFixed(2)} (учтена).`)
  else explanation.push(`Сезонность пока не учитываем — меньше года данных.`)
  if (runRate !== null) explanation.push(`Текущий месяц идёт темпом на ${fmt(runRate)} к концу (run-rate) — учли наполовину.`)
  explanation.push(`→ Ожидаемый доход ${fmt(incomeExpected)}.`)
  explanation.push(`Расход: постоянные ${fmt(fixedForecast)} + переменные ${(variableRate * 100).toFixed(0)}% от дохода = ${fmt(variableForecast)} → ${fmt(expenseExpected)}.`)
  explanation.push(`Прибыль ${fmt(profitExpected)} (маржа ${marginPct.toFixed(1)}%). Безубыточность при доходе ${fmt(beRevenue)}.`)

  const notes: string[] = []
  if (monthsOfData < 3) notes.push('Меньше 3 полных месяцев — прогноз очень грубый.')
  if (!proj.seasonalityAvailable) notes.push('Сезонность по месяцам появится после года данных (нужно ≥13 месяцев).')
  if (incCv > 0.35) notes.push('Высокая волатильность дохода между месяцами — диапазон широкий.')
  if (backtest && backtest.incomeErrorPct > 20) notes.push(`Backtest: в прошлом месяце модель ошиблась на ${backtest.incomeErrorPct.toFixed(0)}% — относитесь к прогнозу осторожно.`)
  let score = 40
  score += clamp(monthsOfData * 5, 0, 35)
  score += proj.seasonalityAvailable ? 10 : 0
  score -= clamp((incCv - 0.2) * 60, 0, 25)
  if (backtest) score -= clamp(backtest.incomeErrorPct * 0.5, 0, 20)
  score = Math.round(clamp(score, 5, 95))

  return {
    months, targetMonth, targetMonthLabel: monthLabel(targetMonth),
    income: { expected: incomeExpected, low: incomeLow, high: incomeHigh, recentAvg: proj.recentAvg, momGrowthPct: proj.momGrowthPct, seasonalIndex: proj.seasonalIndex, runRate },
    channels,
    expense: { expected: expenseExpected, fixed: fixedForecast, variable: variableForecast, variableRatePct: variableRate * 100, oneOffAvg },
    profit: { expected: profitExpected, low: worst, high: best, marginPct },
    scenarios: { best, expected: profitExpected, worst },
    breakeven: { revenue: beRevenue, safetyMarginPct },
    current, backtest, expenseByGroup, explanation,
    confidence: { score, monthsOfData, seasonalityAvailable: proj.seasonalityAvailable, volatilityPct: incCv * 100, notes },
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
