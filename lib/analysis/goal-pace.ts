/**
 * Цели (/goals): темп выполнения плана — чистые расчёты без базы.
 *
 *  - ритм недели: выходные клуба дают в разы больше будней, поэтому «сколько
 *    должно быть к сегодняшнему дню» считается не ровной линией, а по весам
 *    дней недели за последние 8 недель;
 *  - сколько нужно зарабатывать в день до конца периода;
 *  - вывод по прогнозу из /analysis: успеем ли;
 *  - итог года по месячным планам;
 *  - подсказка цели.
 *
 * Без server-only: считается и в браузере, и в кроне уведомлений.
 */

export type DayValue = { date: string; value: number }
export type Triple = { income: number; expense: number; profit: number }
export type ScenarioSet = { pessimistic: Triple; realistic: Triple; optimistic: Triple }

const DAY_MS = 86_400_000
const r0 = (v: number) => Math.round(v)

export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d)
  return out
}

/** Минимум дней с выручкой, чтобы доверять ритму недели */
const MIN_DAYS_FOR_RHYTHM = 14

/**
 * Вес каждого дня недели (0 = вс): средняя выручка дня недели к средней по
 * всем дням. Сумма весов за неделю = 7. Мало данных — все дни равны.
 */
export function weekdayWeights(days: DayValue[]): number[] {
  const worked = days.filter((d) => d.value > 0)
  if (worked.length < MIN_DAYS_FOR_RHYTHM) return new Array(7).fill(1)
  const sum = new Array(7).fill(0)
  const count = new Array(7).fill(0)
  for (const d of worked) {
    const wd = weekdayOf(d.date)
    sum[wd] += d.value
    count[wd] += 1
  }
  const overall = worked.reduce((s, d) => s + d.value, 0) / worked.length
  if (!(overall > 0)) return new Array(7).fill(1)
  // День недели без данных — как средний день
  return sum.map((s, wd) => (count[wd] ? s / count[wd] / overall : 1))
}

/** Накопленная цель на каждую дату периода с учётом ритма недели */
export function cumulativeTargetCurve(dates: string[], target: number, weights: number[]): number[] {
  const w = dates.map((d) => weights[weekdayOf(d)] ?? 1)
  const total = w.reduce((s, v) => s + v, 0) || 1
  let acc = 0
  return w.map((v) => {
    acc += v
    return r0((target * acc) / total)
  })
}

export type GoalPace = {
  target: number
  fact: number
  /** Сколько по ритму должно было набраться к последнему дню с фактом */
  expectedByNow: number
  /** Факт − ожидаемое: < 0 — отстаём */
  gap: number
  daysPassed: number
  daysLeft: number
  /** Сколько нужно в среднем в день до конца периода */
  requiredPerDay: number
  /** Сколько получается в среднем в день сейчас */
  currentPerDay: number
  /** Доля плана выполнена, 0..∞ */
  doneShare: number
  /** Доля периода по ритму недели, 0..1 */
  timeShare: number
}

/**
 * lastFactDate — последний день с внесённым фактом (обычно вчера). Период
 * целиком в прошлом или будущем тоже поддерживается.
 */
export function goalPace(params: {
  target: number
  fact: number
  start: string
  end: string
  lastFactDate: string
  weights: number[]
}): GoalPace | null {
  const { target, fact, start, end, weights } = params
  if (!(target > 0)) return null
  const dates = datesBetween(start, end)
  if (!dates.length) return null
  const lastFact = params.lastFactDate < start ? shiftDate(start, -1) : params.lastFactDate > end ? end : params.lastFactDate
  const passed = dates.filter((d) => d <= lastFact)
  const left = dates.length - passed.length
  const curve = cumulativeTargetCurve(dates, target, weights)
  const expectedByNow = passed.length ? curve[passed.length - 1] : 0
  const totalWeight = dates.reduce((s, d) => s + (weights[weekdayOf(d)] ?? 1), 0) || 1
  const passedWeight = passed.reduce((s, d) => s + (weights[weekdayOf(d)] ?? 1), 0)
  return {
    target: r0(target),
    fact: r0(fact),
    expectedByNow,
    gap: r0(fact - expectedByNow),
    daysPassed: passed.length,
    daysLeft: left,
    requiredPerDay: left > 0 ? r0(Math.max(0, target - fact) / left) : 0,
    currentPerDay: passed.length ? r0(fact / passed.length) : 0,
    doneShare: fact / target,
    timeShare: passedWeight / totalWeight,
  }
}

export type GoalVerdict = {
  status: 'done' | 'safe' | 'likely' | 'at_risk' | 'unlikely'
  label: string
  /** План − реальный прогноз: > 0 — столько не хватит */
  shortfall: number
}

/**
 * Успеем ли выполнить план, по прогнозу к концу месяца (коридор из /analysis).
 * safe — даже осторожный сценарий выше плана; likely — реальный выше;
 * at_risk — только оптимистичный; unlikely — не дотягивает и он.
 */
export function goalVerdict(target: number, fact: number, outlook: { pessimistic: number; realistic: number; optimistic: number } | null): GoalVerdict | null {
  if (!(target > 0)) return null
  if (fact >= target) return { status: 'done', label: 'План выполнен', shortfall: r0(target - fact) }
  if (!outlook) return null
  const shortfall = r0(target - outlook.realistic)
  if (outlook.pessimistic >= target) return { status: 'safe', label: 'Выполним с запасом', shortfall }
  if (outlook.realistic >= target) return { status: 'likely', label: 'Вероятно выполним', shortfall }
  if (outlook.optimistic >= target) return { status: 'at_risk', label: 'Под угрозой', shortfall }
  return { status: 'unlikely', label: 'Не успеваем', shortfall }
}

export type MonthPlanFact = { month: number; target: number | null; fact: number; closed: boolean }

export function yearPlanSummary(months: MonthPlanFact[]) {
  const withPlan = months.filter((m) => m.closed && m.target && m.target > 0)
  const hit = withPlan.filter((m) => m.fact >= (m.target || 0))
  return {
    closedWithPlan: withPlan.length,
    hit: hit.length,
    missed: withPlan
      .filter((m) => m.fact < (m.target || 0))
      .map((m) => ({ month: m.month, target: r0(m.target || 0), fact: r0(m.fact), shortfall: r0((m.target || 0) - m.fact), pct: Math.round((m.fact / (m.target || 1)) * 100) })),
    totalTarget: r0(withPlan.reduce((s, m) => s + (m.target || 0), 0)),
    totalFact: r0(withPlan.reduce((s, m) => s + m.fact, 0)),
  }
}

export type TargetSuggestion = { key: 'careful' | 'real' | 'ambitious'; label: string; revenue: number; expense: number; source: 'forecast' | 'last_year' }

/**
 * Подсказка цели. Для идущего и следующего месяца — сценарии прогноза
 * (осторожно / реально / амбициозно), расход — реальный сценарий. Для других
 * месяцев — тот же месяц прошлого года с поправкой на рост этого года.
 */
export function suggestTargets(input: {
  scenarios: ScenarioSet | null
  lastYear: { revenue: number; expense: number } | null
  growth: number | null
}): TargetSuggestion[] {
  const round = (v: number) => Math.max(0, Math.round(v / 10_000) * 10_000)
  if (input.scenarios) {
    const s = input.scenarios
    const expense = round(s.realistic.expense)
    return [
      { key: 'careful', label: 'Осторожно', revenue: round(s.pessimistic.income), expense, source: 'forecast' },
      { key: 'real', label: 'Реально', revenue: round(s.realistic.income), expense, source: 'forecast' },
      { key: 'ambitious', label: 'Амбициозно', revenue: round(s.optimistic.income), expense, source: 'forecast' },
    ]
  }
  if (input.lastYear && input.lastYear.revenue > 0) {
    const g = input.growth && Number.isFinite(input.growth) ? Math.max(0.5, Math.min(2, input.growth)) : 1
    const base = input.lastYear.revenue * g
    const expense = round(input.lastYear.expense * g)
    return [
      { key: 'careful', label: 'Осторожно', revenue: round(base * 0.95), expense, source: 'last_year' },
      { key: 'real', label: 'Как в прошлом году', revenue: round(base), expense, source: 'last_year' },
      { key: 'ambitious', label: 'Амбициозно', revenue: round(base * 1.1), expense, source: 'last_year' },
    ]
  }
  return []
}
