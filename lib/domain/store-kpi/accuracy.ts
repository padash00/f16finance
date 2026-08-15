/**
 * Точность прогноза и бэктест бонусных уровней.
 *
 * Два вопроса, на которые нельзя отвечать «на глаз», прежде чем платить людям
 * по этой модели:
 *
 *   1. насколько ожидание вообще попадает в факт;
 *   2. какая доля смен берёт B1, B2 и B3.
 *
 * Второй важнее первого. Порог, который берут почти все, ничего не мотивирует;
 * порог, который не берёт никто, воспринимается как обман. Ориентир из ТЗ:
 * примерно 30–45% на B1, 15–25% на B2, 5–10% на B3.
 *
 * Бэктест идёт строго вперёд по времени: план на день считается по истории,
 * которая была известна К НАЧАЛУ этого дня. Иначе модель «предсказывает»
 * прошлое, зная его, и выглядит гораздо лучше, чем работает.
 */

import { addFactToBaselineIndex, emptyBaselineIndex, lookupBaseline } from './baseline'
import { computeShiftPlan, resolveBonus, type BonusLevel } from './plan'
import type { StoreKpiSettings } from './settings'
import type { ShiftFact } from './types'

export type AccuracyPair = {
  date: string
  expected: number
  actual: number
}

export type AccuracySummary = {
  /** Сколько смен участвовало. */
  n: number
  /**
   * WAPE — суммарная ошибка, делённая на суммарный факт. Устойчивее MAPE:
   * не взрывается на сменах с маленькой выручкой.
   */
  wape: number | null
  /** Смещение: >0 — систематически завышаем ожидание, <0 — занижаем. */
  bias: number | null
  /** Средняя абсолютная ошибка в тенге. */
  mae: number | null
}

export function forecastAccuracy(pairs: AccuracyPair[]): AccuracySummary {
  const usable = pairs.filter((p) => Number.isFinite(p.expected) && Number.isFinite(p.actual) && p.actual > 0)
  if (usable.length === 0) return { n: 0, wape: null, bias: null, mae: null }

  let absError = 0
  let signedError = 0
  let actualSum = 0

  for (const p of usable) {
    absError += Math.abs(p.expected - p.actual)
    signedError += p.expected - p.actual
    actualSum += p.actual
  }

  return {
    n: usable.length,
    wape: actualSum > 0 ? Math.round((absError / actualSum) * 1000) / 1000 : null,
    bias: actualSum > 0 ? Math.round((signedError / actualSum) * 1000) / 1000 : null,
    mae: Math.round(absError / usable.length),
  }
}

export type BacktestShift = {
  date: string
  shift: string
  revenue: number
  expected: number | null
  control: number
  b1: number
  b2: number
  b3: number
  level: BonusLevel
  bonus: number
  review: boolean
}

export type BacktestResult = {
  /** Смены, для которых истории хватило на план. */
  evaluated: number
  /** Смены, оставшиеся без плана: сегмент был слишком коротким. */
  skipped_no_history: number
  hit_rates: Record<BonusLevel, number>
  /** Доля смен ниже отметки «разобраться». */
  review_rate: number
  /** Сколько бонусов выплатили бы за период, ₸. */
  bonus_cost: number
  /** Выручка смен, участвовавших в бэктесте, ₸. */
  revenue: number
  accuracy: AccuracySummary
  shifts: BacktestShift[]
  /** Читаемая оценка калибровки уровней. */
  calibration: {
    level: BonusLevel
    rate: number
    target: [number, number]
    verdict: 'too_easy' | 'ok' | 'too_hard'
    /** Жёсткие границы из ТЗ: порог, который берут почти все или почти никто. */
    alarm: 'threshold_too_easy' | 'threshold_demotivating' | null
  }[]
}

/** Ориентиры из ТЗ: не жёсткое правило, а рамка для разговора. */
const TARGET_HIT_RATES: { level: BonusLevel; target: [number, number] }[] = [
  { level: 'b1', target: [0.3, 0.45] },
  { level: 'b2', target: [0.15, 0.25] },
  { level: 'b3', target: [0.05, 0.1] },
]

/**
 * Границы, за которыми порог перестаёт работать как мотивация.
 *
 * Выше первой — бонус превращается в надбавку за выход на смену. Ниже второй —
 * в недостижимую морковку, которая скорее злит, чем мотивирует.
 */
const TOO_EASY_FROM = 0.7
const DEMOTIVATING_BELOW = 0.15

/**
 * Бэктест: прогоняет историю так, как её проживала бы модель.
 *
 * `monthlyIndex` берётся одинаковым для всего периода: в прошлом индексов не
 * существовало, и подставлять сегодняшние было бы подгонкой.
 */
export function backtestPlans(
  facts: ShiftFact[],
  settings: StoreKpiSettings,
  opts: { monthlyIndex?: number } = {},
): BacktestResult {
  const index = emptyBaselineIndex()
  const monthlyIndex = opts.monthlyIndex ?? 1

  const byDate = new Map<string, ShiftFact[]>()
  for (const fact of facts) {
    if (fact.receipts <= 0) continue
    const list = byDate.get(fact.date) || []
    list.push(fact)
    byDate.set(fact.date, list)
  }
  const dates = [...byDate.keys()].sort()

  const shifts: BacktestShift[] = []
  const pairs: AccuracyPair[] = []
  let skipped = 0

  for (const date of dates) {
    const dayFacts = byDate.get(date)!

    // Сначала оцениваем все смены дня по истории ДО него…
    for (const fact of dayFacts) {
      const plan = computeShiftPlan(index, fact, monthlyIndex, settings)
      if (!plan) {
        skipped += 1
        continue
      }

      const expected = lookupBaseline(index, fact, {
        minSample: settings.min_sample_size,
        summerMonths: settings.summer_months,
      })
      const outcome = resolveBonus(fact.revenue, plan, settings)

      shifts.push({
        date: fact.date,
        shift: fact.shift,
        revenue: Math.round(fact.revenue),
        expected: expected ? Math.round(expected.value) : null,
        control: plan.control,
        b1: plan.b1,
        b2: plan.b2,
        b3: plan.b3,
        level: outcome.level,
        bonus: outcome.amount,
        review: outcome.review,
      })

      if (expected) pairs.push({ date: fact.date, expected: expected.value, actual: fact.revenue })
    }

    // …и только потом добавляем день в историю.
    for (const fact of dayFacts) {
      addFactToBaselineIndex(index, fact, fact.revenue, { summerMonths: settings.summer_months })
    }
  }

  const counts: Record<BonusLevel, number> = { none: 0, b1: 0, b2: 0, b3: 0, record: 0 }
  let bonusCost = 0
  let revenue = 0
  let reviews = 0

  for (const s of shifts) {
    counts[s.level] += 1
    bonusCost += s.bonus
    revenue += s.revenue
    if (s.review) reviews += 1
  }

  const total = shifts.length || 1
  const rate = (n: number) => Math.round((n / total) * 1000) / 1000

  // Уровень «взят» — это достигнут он или выше: смена с B3 засчитывается и в
  // B1, иначе доли не сравнить с ориентирами.
  const atLeast = (level: BonusLevel): number => {
    const order: BonusLevel[] = ['none', 'b1', 'b2', 'b3', 'record']
    const from = order.indexOf(level)
    return order.slice(from).reduce((sum, l) => sum + counts[l], 0)
  }

  return {
    evaluated: shifts.length,
    skipped_no_history: skipped,
    hit_rates: {
      none: rate(counts.none),
      b1: rate(atLeast('b1')),
      b2: rate(atLeast('b2')),
      b3: rate(atLeast('b3')),
      record: rate(counts.record),
    },
    review_rate: rate(reviews),
    bonus_cost: bonusCost,
    revenue,
    accuracy: forecastAccuracy(pairs),
    shifts,
    calibration: TARGET_HIT_RATES.map(({ level, target }) => {
      const value = rate(atLeast(level))
      return {
        level,
        rate: value,
        target,
        verdict: value > target[1] ? 'too_easy' : value < target[0] ? 'too_hard' : 'ok',
        alarm:
          value > TOO_EASY_FROM
            ? ('threshold_too_easy' as const)
            : value < DEMOTIVATING_BELOW
              ? ('threshold_demotivating' as const)
              : null,
      }
    }),
  }
}
