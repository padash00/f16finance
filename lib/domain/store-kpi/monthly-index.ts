/**
 * Месячный индекс спроса.
 *
 * Это поправка на то, что месяц месяцу рознь: в одном пять суббот и учебный
 * сезон в разгаре, в другом — каникулы и три праздника. Индекс поднимает или
 * опускает бонусные пороги целиком, чтобы planка оставалась одинаково
 * достижимой круглый год.
 *
 * Индекс НЕ выдумывается моделью. Он собирается из четырёх измеримых частей,
 * каждая из которых сама по себе объяснима владельцу:
 *
 *   40%  историческая сезонность  — чем этот месяц был в прошлом
 *   30%  недавний тренд           — как идут дела последние недели
 *   15%  учебный контекст         — семестр, каникулы, сессия
 *   15%  состав календаря         — сколько в месяце выходных и праздников
 *
 * Границы жёсткие (по умолчанию 0.85–1.20), а изменение больше допустимого
 * шага требует подтверждения человеком: коэффициент, который двигает деньги
 * людей, не должен меняться сам по себе на десятки процентов.
 */

import { median, monthOf, seasonOf, weekdayOf } from './baseline'
import type { StoreKpiSettings } from './settings'
import type { ShiftFact } from './types'

export type AcademicPeriod = {
  start_date: string
  end_date: string
  /** Множитель спроса периода. 1.00 = нейтрально. */
  index: number
}

export type CalendarDay = {
  date: string
  /** Множитель спроса дня: праздник может как поднимать, так и ронять. */
  impact_index: number
}

export type TrendObservation = {
  date: string
  actual: number
  /** Ожидание для этой смены. Сезонность и день недели уже сняты. */
  expected: number
}

export type IndexComponent = {
  key: 'historical_seasonality' | 'recent_trend' | 'academic_context' | 'calendar_composition'
  value: number
  weight: number
  /** Вклад в итог: weight × (value − 1). */
  impact: number
  explanation: string
  /** Хватило ли данных. false — компонент взят нейтральным (1.00). */
  available: boolean
}

export type MonthlyIndexResult = {
  /** До ограничения границами. */
  recommended: number
  /** То, что можно применять. */
  value: number
  components: IndexComponent[]
  drivers_positive: IndexComponent[]
  drivers_negative: IndexComponent[]
  approval_required: boolean
  approval_reason: string | null
  confidence: number
  notes: string[]
}

const WEIGHTS = {
  historical_seasonality: 0.4,
  recent_trend: 0.3,
  academic_context: 0.15,
  calendar_composition: 0.15,
} as const

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Выручка по дням: смены одного дня складываются. */
function dailyRevenue(history: ShiftFact[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of history) out.set(f.date, (out.get(f.date) || 0) + f.revenue)
  return out
}

/**
 * Чем этот месяц был в прошлом относительно своего сезона.
 * Сравнение внутри сезона, а не со всем годом: иначе июль всегда «проседал» бы
 * относительно ноября просто потому, что это лето.
 */
function historicalSeasonality(
  history: ShiftFact[],
  targetMonth: number,
  settings: StoreKpiSettings,
): IndexComponent {
  const daily = dailyRevenue(history)
  const targetValues: number[] = []
  const seasonValues: number[] = []

  const targetSeason = settings.summer_months.includes(targetMonth) ? 'summer' : 'academic'

  for (const [date, revenue] of daily) {
    if (revenue <= 0) continue
    const season = seasonOf(date, settings.summer_months)
    if (season !== targetSeason) continue
    seasonValues.push(revenue)
    if (monthOf(date) === targetMonth) targetValues.push(revenue)
  }

  const targetMedian = median(targetValues)
  const seasonMedian = median(seasonValues)

  if (targetValues.length < settings.min_sample_size || !targetMedian || !seasonMedian) {
    return {
      key: 'historical_seasonality',
      value: 1,
      weight: WEIGHTS.historical_seasonality,
      impact: 0,
      explanation: 'Истории по этому месяцу мало — сезонность взята нейтральной.',
      available: false,
    }
  }

  const value = targetMedian / seasonMedian
  return {
    key: 'historical_seasonality',
    value: round2(value),
    weight: WEIGHTS.historical_seasonality,
    impact: round2(WEIGHTS.historical_seasonality * (value - 1)),
    explanation:
      value >= 1
        ? `Этот месяц исторически сильнее среднего дня сезона на ${Math.round((value - 1) * 100)}%.`
        : `Этот месяц исторически слабее среднего дня сезона на ${Math.round((1 - value) * 100)}%.`,
    available: true,
  }
}

/**
 * Недавний тренд: факт против того, чего мы и так ждали.
 *
 * Сравнивается не абсолютная выручка, а отношение к ожиданию — сезонность и
 * день недели из тренда уже вычтены, иначе месяц с пятью субботами выглядел бы
 * «ростом бизнеса».
 */
/**
 * Минимум наблюдений в окне тренда. Намеренно не берётся из
 * `min_sample_size`: там порог для сегментов истории (по умолчанию 8), а в
 * семидневное окно столько смен просто не помещается.
 */
const MIN_TREND_OBSERVATIONS = 3

function recentTrend(observations: TrendObservation[], asOf: string): IndexComponent {
  const windows: { days: number; weight: number }[] = [
    { days: 7, weight: 0.2 },
    { days: 14, weight: 0.3 },
    { days: 30, weight: 0.5 },
  ]

  const [y, m, d] = asOf.split('-').map(Number)
  const asOfTime = new Date(y || 1970, (m || 1) - 1, d || 1).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  let acc = 0
  let accWeight = 0
  const perWindow: string[] = []

  for (const w of windows) {
    let actual = 0
    let expected = 0
    let count = 0
    for (const o of observations) {
      const [oy, om, od] = o.date.split('-').map(Number)
      const t = new Date(oy || 1970, (om || 1) - 1, od || 1).getTime()
      const ageDays = (asOfTime - t) / dayMs
      if (ageDays < 0 || ageDays > w.days) continue
      if (o.expected <= 0) continue
      actual += o.actual
      expected += o.expected
      count += 1
    }
    // Окно суммируется целиком, а не усредняется по дням: так один сильный
    // день не двигает коэффициент месяца.
    if (count >= MIN_TREND_OBSERVATIONS && expected > 0) {
      const ratio = actual / expected
      acc += ratio * w.weight
      accWeight += w.weight
      perWindow.push(`${w.days} дн. — ${Math.round(ratio * 100)}%`)
    }
  }

  if (accWeight === 0) {
    return {
      key: 'recent_trend',
      value: 1,
      weight: WEIGHTS.recent_trend,
      impact: 0,
      explanation: 'Свежих смен для тренда не хватило — взят нейтральным.',
      available: false,
    }
  }

  const value = acc / accWeight
  return {
    key: 'recent_trend',
    value: round2(value),
    weight: WEIGHTS.recent_trend,
    impact: round2(WEIGHTS.recent_trend * (value - 1)),
    explanation: `Последние недели относительно ожидания: ${perWindow.join(', ')}.`,
    available: true,
  }
}

/** Учебный контекст: доля дней месяца под действием периодов и их множители. */
function academicContext(
  periods: AcademicPeriod[],
  year: number,
  month: number,
): IndexComponent {
  const total = daysInMonth(year, month)
  let sum = 0
  let covered = 0

  for (let day = 1; day <= total; day++) {
    const iso = isoOf(year, month, day)
    const period = periods.find((p) => p.start_date <= iso && iso <= p.end_date)
    if (period && Number.isFinite(period.index) && period.index > 0) {
      sum += period.index
      covered += 1
    } else {
      sum += 1
    }
  }

  if (covered === 0) {
    return {
      key: 'academic_context',
      value: 1,
      weight: WEIGHTS.academic_context,
      impact: 0,
      explanation: 'Учебные периоды на этот месяц не заданы.',
      available: false,
    }
  }

  const value = sum / total
  return {
    key: 'academic_context',
    value: round2(value),
    weight: WEIGHTS.academic_context,
    impact: round2(WEIGHTS.academic_context * (value - 1)),
    explanation: `Учебные периоды покрывают ${covered} из ${total} дней месяца.`,
    available: true,
  }
}

/**
 * Состав календаря: сколько в месяце сильных дней.
 *
 * Вес дня недели берётся из собственной истории точки, а не из общих
 * представлений о том, что суббота сильнее вторника.
 */
function calendarComposition(
  history: ShiftFact[],
  specialDays: CalendarDay[],
  year: number,
  month: number,
  settings: StoreKpiSettings,
): IndexComponent {
  const daily = dailyRevenue(history)
  const byWeekday = new Map<number, number[]>()
  for (const [date, revenue] of daily) {
    if (revenue <= 0) continue
    const dow = weekdayOf(date)
    const list = byWeekday.get(dow) || []
    list.push(revenue)
    byWeekday.set(dow, list)
  }

  const factors = new Map<number, number>()
  const allDays = [...daily.values()].filter((v) => v > 0)
  const overall = median(allDays)

  if (!overall || allDays.length < settings.min_sample_size) {
    return {
      key: 'calendar_composition',
      value: 1,
      weight: WEIGHTS.calendar_composition,
      impact: 0,
      explanation: 'Истории мало — состав календаря не учитывается.',
      available: false,
    }
  }

  for (let dow = 0; dow < 7; dow++) {
    const values = byWeekday.get(dow) || []
    const m = median(values)
    factors.set(dow, m && values.length >= 3 ? m / overall : 1)
  }

  const total = daysInMonth(year, month)
  let sum = 0
  let holidays = 0
  for (let day = 1; day <= total; day++) {
    const iso = isoOf(year, month, day)
    const base = factors.get(weekdayOf(iso)) ?? 1
    const special = specialDays.find((s) => s.date === iso)
    if (special && Number.isFinite(special.impact_index) && special.impact_index > 0) {
      sum += base * special.impact_index
      holidays += 1
    } else {
      sum += base
    }
  }

  // Нейтральный месяц — тот, где дни недели встречаются поровну.
  const meanFactor = [...factors.values()].reduce((a, b) => a + b, 0) / 7
  const value = meanFactor > 0 ? sum / (total * meanFactor) : 1

  return {
    key: 'calendar_composition',
    value: round2(value),
    weight: WEIGHTS.calendar_composition,
    impact: round2(WEIGHTS.calendar_composition * (value - 1)),
    explanation:
      holidays > 0
        ? `В месяце ${total} дней, из них ${holidays} особых (праздники и переносы).`
        : `Состав дней недели этого месяца оценён по истории точки.`,
    available: true,
  }
}

/**
 * Итоговый индекс месяца.
 *
 * `asOf` — момент, на который строится расчёт. Данные позже него не берутся:
 * иначе оценка задним числом всегда выглядела бы точнее, чем была.
 */
export function computeMonthlyIndex(args: {
  targetMonth: string // YYYY-MM
  asOf: string // YYYY-MM-DD
  history: ShiftFact[]
  trend: TrendObservation[]
  academicPeriods: AcademicPeriod[]
  specialDays: CalendarDay[]
  previousIndex: number | null
  settings: StoreKpiSettings
}): MonthlyIndexResult {
  const { targetMonth, asOf, settings } = args
  const [year, month] = targetMonth.split('-').map(Number)

  const history = args.history.filter((f) => f.date < asOf)
  const trend = args.trend.filter((o) => o.date < asOf)

  const components: IndexComponent[] = [
    historicalSeasonality(history, month || 1, settings),
    recentTrend(trend, asOf),
    academicContext(args.academicPeriods, year || 1970, month || 1),
    calendarComposition(history, args.specialDays, year || 1970, month || 1, settings),
  ]

  const recommended = components.reduce((sum, c) => sum + c.weight * c.value, 0)
  const value = round2(clamp(recommended, settings.monthly_index_min, settings.monthly_index_max))

  const notes: string[] = []
  let approvalRequired = false
  let approvalReason: string | null = null

  if (round2(recommended) !== value) {
    approvalRequired = true
    approvalReason = `Расчёт дал ${round2(recommended)} — вне допустимых границ ${settings.monthly_index_min}–${settings.monthly_index_max}.`
    notes.push(approvalReason)
  }

  if (args.previousIndex != null) {
    const delta = Math.abs(value - args.previousIndex)
    if (delta > settings.auto_adjust_max_delta) {
      approvalRequired = true
      const reason = `Изменение с ${args.previousIndex} до ${value} больше допустимого шага ${settings.auto_adjust_max_delta}.`
      approvalReason = approvalReason ? `${approvalReason} ${reason}` : reason
      notes.push(reason)
    }
  }

  const unavailable = components.filter((c) => !c.available)
  for (const c of unavailable) notes.push(c.explanation)

  // Чем больше частей взято нейтральными, тем меньше смысла в самом индексе.
  const confidence = round2(
    clamp(
      components.reduce((sum, c) => sum + (c.available ? c.weight : 0), 0),
      0.1,
      1,
    ),
  )

  const withImpact = components.filter((c) => c.available && Math.abs(c.impact) >= 0.005)

  return {
    recommended: round2(recommended),
    value,
    components,
    drivers_positive: withImpact.filter((c) => c.impact > 0).sort((a, b) => b.impact - a.impact),
    drivers_negative: withImpact.filter((c) => c.impact < 0).sort((a, b) => a.impact - b.impact),
    approval_required: approvalRequired,
    approval_reason: approvalReason,
    confidence,
    notes,
  }
}
