/**
 * План смены и бонусные уровни.
 *
 * План — не прогноз. Прогноз меняется каждый день вслед за погодой и потоком,
 * а планка, за которую человек получает деньги, должна быть устойчивой и
 * известной заранее. Поэтому уровни берутся не из прогноза выручки, а из
 * распределения выручки сопоставимых смен: B1 — то, что достигается чаще
 * половины раз, B3 — то, что даётся редко.
 *
 * Три правила, которые здесь защищены кодом:
 *   1. платится только максимальный достигнутый уровень, а не сумма уровней;
 *   2. рекорд заменяет B3, а не добавляется к нему;
 *   3. CONTROL — не штраф, а отметка «разобраться», и штрафов тут нет вовсе.
 */

import { revenueThresholds, type BaselineIndex } from './baseline'
import type { StoreKpiSettings } from './settings'
import type { SegmentLevel, ShiftFact } from './types'

export type BonusLevel = 'none' | 'b1' | 'b2' | 'b3' | 'record'

export type ShiftPlan = {
  /** Отметка «ниже — разобраться». Не штрафной порог. */
  control: number
  b1: number
  b2: number
  b3: number
  /**
   * Рекорд сегмента: выручка выше него даёт особый бонус. Берётся как есть,
   * без месячного индекса — рекорд должен быть настоящим, а не подкрученным.
   */
  record_threshold: number | null
  monthly_index: number
  /** На каком уровне сегментации нашлось распределение и по скольким сменам. */
  level: SegmentLevel
  sample: number
}

export type BonusOutcome = {
  level: BonusLevel
  amount: number
  /** Ниже CONTROL — повод разобраться в смене, а не наказать продавца. */
  review: boolean
  /** Следующий уровень и сколько до него — то, что видит продавец. */
  next_level: BonusLevel | null
  to_next: number | null
  /**
   * Уровень, до которого смена дотянулась по выручке, если выплату срезали
   * ворота по знанию товара. null — ничего не срезали.
   */
  capped_from: BonusLevel | null
}

/**
 * Ворота верхних уровней: B3 и рекорд доступны, только если продавец сдал тест
 * на знание товара.
 *
 * Смысл ворот — не наказать, а не поощрять «продал много, но не знает, что
 * продаёт». B1 и B2 остаются доступны в любом случае.
 */
export type BonusGate = {
  /** true — тест сдан, false — не сдан, null — данных о тесте нет. */
  product_test_passed: boolean | null
}

/** Округление вверх до шага: план должен запоминаться, а не читаться по цифрам. */
export function roundUpTo(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (step <= 0) return Math.round(value)
  return Math.ceil(value / step) * step
}

/**
 * Пороги смены из распределения выручки сопоставимых смен.
 *
 * null — если история сегмента короче минимальной выборки. Назначать план по
 * двум сменам нельзя: он будет случайным числом, за которое платят деньги.
 */
export function computeShiftPlan(
  revenueIndex: BaselineIndex,
  fact: Pick<ShiftFact, 'company_id' | 'date' | 'shift'>,
  monthlyIndex: number,
  settings: StoreKpiSettings,
): ShiftPlan | null {
  const hit = revenueThresholds(
    revenueIndex,
    { ...(fact as ShiftFact) },
    {
      minSample: settings.min_sample_size,
      summerMonths: settings.summer_months,
      percentiles: [
        settings.control_percentile,
        settings.b1_percentile,
        settings.b2_percentile,
        settings.b3_percentile,
        1, // максимум сегмента — планка рекорда
      ],
    },
  )
  if (!hit) return null

  const [control, b1, b2, b3, max] = hit.values
  const step = settings.rounding_step
  const index = monthlyIndex > 0 ? monthlyIndex : 1

  const levels = [control, b1, b2, b3].map((v) => roundUpTo(v * index, step))

  // После округления уровни могут слипнуться (например, при шаге 5000 и
  // близких перцентилях). Слипшиеся уровни означали бы, что B2 достигается
  // ровно тогда же, когда B1 — то есть один из бонусов не существует.
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] <= levels[i - 1]) levels[i] = levels[i - 1] + step
  }

  return {
    control: levels[0],
    b1: levels[1],
    b2: levels[2],
    b3: levels[3],
    record_threshold: max > 0 ? roundUpTo(max, step) : null,
    monthly_index: index,
    level: hit.level,
    sample: hit.sample,
  }
}

/**
 * Что заработала смена по факту.
 *
 * Уровни не суммируются: смена, взявшая B3, приносит сумму B3, а не
 * B1 + B2 + B3. Иначе бонусный фонд растёт втрое быстрее, чем выручка.
 */
export function resolveBonus(
  revenue: number,
  plan: ShiftPlan,
  settings: StoreKpiSettings,
  gate?: BonusGate,
): BonusOutcome {
  const review = revenue < plan.control

  const earned: BonusLevel =
    plan.record_threshold != null && revenue > plan.record_threshold
      ? 'record'
      : revenue >= plan.b3
        ? 'b3'
        : revenue >= plan.b2
          ? 'b2'
          : revenue >= plan.b1
            ? 'b1'
            : 'none'

  // Ворота срезают выплату до B2, но только если они включены. Выключенные
  // ворота при отсутствии тестов — намеренное значение по умолчанию: иначе
  // все теряли бы B3 за то, что тестов в организации просто не проводят.
  const gated =
    settings.require_product_test_for_top_bonus &&
    gate?.product_test_passed !== true &&
    (earned === 'b3' || earned === 'record')

  const reached: BonusLevel = gated ? 'b2' : earned

  const amount =
    reached === 'record'
      ? settings.record_amount
      : reached === 'b3'
        ? settings.b3_amount
        : reached === 'b2'
          ? settings.b2_amount
          : reached === 'b1'
            ? settings.b1_amount
            : 0

  const ladder: { level: BonusLevel; threshold: number }[] = [
    { level: 'b1', threshold: plan.b1 },
    { level: 'b2', threshold: plan.b2 },
    { level: 'b3', threshold: plan.b3 },
  ]
  if (plan.record_threshold != null) {
    ladder.push({ level: 'record', threshold: plan.record_threshold + 1 })
  }

  const next = ladder.find((l) => revenue < l.threshold) || null

  return {
    level: reached,
    amount,
    review,
    next_level: next?.level ?? null,
    to_next: next ? Math.max(0, Math.round(next.threshold - revenue)) : null,
    capped_from: gated ? earned : null,
  }
}

/**
 * Можно ли ещё менять план автоматически.
 *
 * После фиксации пересчёт запрещён: если утром план был 90 000, а к вечеру
 * поток оказался лучше прогноза, поднимать планку задним числом нельзя —
 * человек работал под тот план, который ему объявили.
 */
export function isPlanLocked(plan: { locked_at?: string | null } | null | undefined): boolean {
  return Boolean(plan?.locked_at)
}
