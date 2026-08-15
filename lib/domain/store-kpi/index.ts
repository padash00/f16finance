/**
 * Эффективность продавцов магазина — точка входа доменного слоя.
 *
 * Вся арифметика модуля собрана здесь и в соседних файлах, без обращений к БД
 * и без участия языковой модели. Это принципиально: пороги, баллы и (в
 * следующей фазе) суммы бонусов должны быть воспроизводимыми и проверяемыми,
 * а ИИ — только объяснять уже посчитанное.
 */

import { buildBaselineIndex } from './baseline'
import { METRIC_KEYS, metricValue } from './metrics'
import { analyzeShift, summarizeCashier, type BaselineBundle } from './score'
import type { StoreKpiSettings } from './settings'
import type { CashierSummary, MetricKey, ShiftAnalysis, ShiftFact } from './types'

export * from './types'
export * from './settings'
export {
  buildBaselineIndex,
  lookupBaseline,
  revenueThresholds,
  percentile,
  median,
  seasonOf,
  weekdayOf,
  monthOf,
  isWeekend,
  SEGMENT_LEVELS,
  LEVEL_CONFIDENCE,
  emptyBaselineIndex,
  addFactToBaselineIndex,
  type BaselineIndex,
  type BaselineHit,
} from './baseline'
export {
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_MISSING_REASON,
  CLUB_REVENUE_UNIT,
  metricValue,
  attachFromReceipts,
  multiLineRate,
  refundRate,
} from './metrics'
export {
  computeShiftPlan,
  resolveBonus,
  isPlanLocked,
  roundUpTo,
  type ShiftPlan,
  type BonusLevel,
  type BonusOutcome,
  type BonusGate,
} from './plan'
export { explainShift, type ShiftExplanation, type MetricReading } from './explain'
export {
  forecastAccuracy,
  backtestPlans,
  type AccuracySummary,
  type AccuracyPair,
  type BacktestResult,
  type BacktestShift,
} from './accuracy'
export {
  weatherBucket,
  estimateWeatherEffects,
  weatherFactor,
  WEATHER_BUCKET_LABELS,
  type WeatherObservation,
  type WeatherBucket,
  type WeatherEffect,
} from './weather'
export {
  computeMonthlyIndex,
  type MonthlyIndexResult,
  type IndexComponent,
  type AcademicPeriod,
  type CalendarDay,
  type TrendObservation,
} from './monthly-index'
export {
  analyzeShift,
  summarizeCashier,
  NORMAL_BAND_LOW,
  NORMAL_BAND_HIGH,
  MIN_CONFIDENCE_FOR_VERDICT,
  type BaselineBundle,
} from './score'

/** Насколько полны данные, на которых всё посчитано. */
export type StoreKpiCoverage = {
  baseline_shifts: number
  baseline_from: string | null
  baseline_to: string | null
  /** Доля смен истории, где чеки пробиты построчно. */
  items_coverage: number
  /** Доля смен истории, где известна выручка клуба (поток). */
  club_coverage: number
  /** Доля смен истории, где известен кассир. */
  cashier_coverage: number
}

export type StoreKpiResult = {
  shifts: ShiftAnalysis[]
  cashiers: CashierSummary[]
  coverage: StoreKpiCoverage
  model_version: string
}

function share(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * 100) / 100
}

/**
 * База выручки — из неё берутся и ожидание смены, и бонусные пороги.
 *
 * Смены без чеков в базу не попадают: закрытая точка или день без продаж
 * занизили бы планку всем остальным.
 */
export function buildRevenueBaseline(facts: ShiftFact[], settings: StoreKpiSettings) {
  return buildBaselineIndex(facts, (f) => (f.receipts > 0 ? f.revenue : null), {
    summerMonths: settings.summer_months,
  })
}

function buildBundle(facts: ShiftFact[], settings: StoreKpiSettings): BaselineBundle {
  const metrics: Partial<Record<MetricKey, ReturnType<typeof buildBaselineIndex>>> = {}
  for (const metric of METRIC_KEYS) {
    metrics[metric] = buildBaselineIndex(facts, (f) => metricValue(f, metric), {
      summerMonths: settings.summer_months,
    })
  }

  return {
    metrics,
    revenue: buildRevenueBaseline(facts, settings),
    club: buildBaselineIndex(facts, (f) => f.club_revenue, {
      summerMonths: settings.summer_months,
    }),
  }
}

/**
 * Полный расчёт: история → ожидания → разбор смен периода → сводка по людям.
 *
 * `baselineFacts` — история ДО начала периода. Смешивать её с периодом нельзя:
 * смена не должна участвовать в формировании ожидания, с которым её же потом
 * сравнивают, иначе плохие смены сами себе занижают планку.
 */
export function analyzeStoreKpi(args: {
  baselineFacts: ShiftFact[]
  targetFacts: ShiftFact[]
  settings: StoreKpiSettings
}): StoreKpiResult {
  const { baselineFacts, targetFacts, settings } = args
  const bundle = buildBundle(baselineFacts, settings)

  const shifts = targetFacts.map((fact) => analyzeShift(fact, bundle, settings))

  const cashierIds = [...new Set(targetFacts.map((f) => f.cashier_id).filter(Boolean))] as string[]
  const cashiers = cashierIds
    .map((id) => summarizeCashier(id, shifts, settings))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  const dates = baselineFacts.map((f) => f.date).sort()

  return {
    shifts,
    cashiers,
    coverage: {
      baseline_shifts: baselineFacts.length,
      baseline_from: dates[0] ?? null,
      baseline_to: dates[dates.length - 1] ?? null,
      items_coverage: share(baselineFacts.filter((f) => f.items > 0).length, baselineFacts.length),
      club_coverage: share(
        baselineFacts.filter((f) => f.club_revenue != null && f.club_revenue > 0).length,
        baselineFacts.length,
      ),
      cashier_coverage: share(baselineFacts.filter((f) => f.cashier_id).length, baselineFacts.length),
    },
    model_version: settings.model_version,
  }
}
