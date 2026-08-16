/**
 * Эффективность продавцов магазина — точка входа доменного слоя.
 *
 * Вся арифметика модуля собрана здесь и в соседних файлах, без обращений к БД
 * и без участия языковой модели. Это принципиально: пороги, баллы и суммы
 * бонусов должны быть воспроизводимыми и проверяемыми, а ИИ — только
 * объяснять уже посчитанное.
 */

import { buildBaselineIndex, lookupBaseline } from './baseline'
import { METRIC_KEYS, metricValue } from './metrics'
import { analyzeShift, summarizeCashier, trainingFlag, type BaselineBundle } from './score'
import type { StoreKpiSettings } from './settings'
import type { CashierSummary, MetricKey, ShiftAnalysis, ShiftFact, ShiftType } from './types'

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
  METRIC_DUPLICATE_OF,
  metricValue,
  demandValue,
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
export {
  computeMonthlyIndex,
  type MonthlyIndexResult,
  type IndexComponent,
  type AcademicPeriod,
  type CalendarDay,
  type TrendObservation,
} from './monthly-index'
export { explainShift, type ShiftExplanation, type MetricReading } from './explain'
export {
  detectAnomalies,
  dataQualityScore,
  type Anomaly,
  type AnomalyKind,
  type DataQuality,
  type DataQualityCheck,
} from './quality'
export {
  buildPriceIndex,
  priceIndexFor,
  deflate,
  NEUTRAL_PRICE_INDEX,
  type PriceHistoryRow,
  type PriceIndex,
  type PriceIndexPoint,
} from './price-index'
export {
  categoryShares,
  cashierMixDeviations,
  type CategorySalesRow,
  type CategoryShare,
  type CashierMixDeviation,
} from './category-mix'
export {
  monthlyBonus,
  bonusRoi,
  retailDiagnostics,
  type BonusRoi,
  type RetailDiagnostics,
} from './money'
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
  observationForWindow,
  shiftWindow,
  weatherForShift,
  weatherFactor,
  WEATHER_BUCKET_LABELS,
  type HourlySeries,
  type WeatherObservation,
  type WeatherBucket,
  type WeatherEffect,
} from './weather'
export {
  analyzeShift,
  summarizeCashier,
  trainingFlag,
  NORMAL_BAND_LOW,
  NORMAL_BAND_HIGH,
  HIGH_DEMAND_FROM,
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
  /** Доля смен истории, где известен кассир. */
  cashier_coverage: number
  /** Доля смен истории, где сработало хотя бы одно правило допродаж. */
  attach_coverage: number
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
 * Смены, из которых строится норма.
 *
 * Помеченные как «не учитывать» выбрасываются: дубль, сбой кассы или тестовые
 * чеки не должны формировать планку, по которой оценивают живых людей. Из
 * отчётов такие смены при этом не исчезают.
 */
function baselineSource(facts: ShiftFact[]): ShiftFact[] {
  return facts.filter((f) => !f.exclude_from_baseline)
}

/**
 * База выручки — из неё берутся и ожидание смены, и бонусные пороги.
 *
 * Смены без чеков в базу не попадают: закрытая точка или день без продаж
 * занизили бы планку всем остальным.
 */
export function buildRevenueBaseline(facts: ShiftFact[], settings: StoreKpiSettings) {
  // Выручка складывается в базу в ценах базового месяца — иначе после
  // подорожания норма и пороги поехали бы вверх сами собой.
  return buildBaselineIndex(
    baselineSource(facts),
    (f) => (f.receipts > 0 ? f.revenue / (f.price_index && f.price_index > 0 ? f.price_index : 1) : null),
    { summerMonths: settings.summer_months },
  )
}

/** База спроса — число чеков сопоставимых смен. */
export function buildReceiptsBaseline(facts: ShiftFact[], settings: StoreKpiSettings) {
  return buildBaselineIndex(baselineSource(facts), (f) => (f.receipts > 0 ? f.receipts : null), {
    summerMonths: settings.summer_months,
  })
}

export function buildBundle(facts: ShiftFact[], settings: StoreKpiSettings): BaselineBundle {
  const metrics: Partial<Record<MetricKey, ReturnType<typeof buildBaselineIndex>>> = {}
  for (const metric of METRIC_KEYS) {
    if (metric === 'plan_attainment') continue // сравнивается с базой выручки
    metrics[metric] = buildBaselineIndex(baselineSource(facts), (f) => metricValue(f, metric), {
      summerMonths: settings.summer_months,
    })
  }

  return {
    metrics,
    revenue: buildRevenueBaseline(facts, settings),
    receipts: buildReceiptsBaseline(facts, settings),
  }
}

/** Прогноз спроса на смену: чеки, средний чек и выручка с диапазонами. */
export type DemandForecast = {
  expected_receipts: number | null
  receipts_range: [number, number] | null
  expected_avg_ticket: number | null
  expected_revenue: number | null
  revenue_range: [number, number] | null
  confidence: number
  /** По какому уровню сегментации и скольким сменам построен прогноз. */
  level: string | null
  sample: number
}

/**
 * Прогноз на будущую смену.
 *
 * Выручка получается перемножением ожидаемых чеков и среднего чека — так
 * видно, из чего она складывается. А вот диапазон берётся из распределения
 * самой выручки, а не перемножением границ: произведение крайних значений
 * дало бы неправдоподобно широкую вилку.
 */
export function forecastShift(
  bundle: BaselineBundle,
  target: { company_id: string; date: string; shift: ShiftType },
  settings: StoreKpiSettings,
): DemandForecast {
  const fact = target as ShiftFact
  const opts = { minSample: settings.min_sample_size, summerMonths: settings.summer_months }

  const receipts = lookupBaseline(bundle.receipts, fact, opts)
  const ticket = bundle.metrics.avg_ticket
    ? lookupBaseline(bundle.metrics.avg_ticket, fact, opts)
    : null

  const receiptsLow = lookupBaseline(bundle.receipts, fact, { ...opts, percentile: 0.25 })
  const receiptsHigh = lookupBaseline(bundle.receipts, fact, { ...opts, percentile: 0.75 })
  const revenueLow = lookupBaseline(bundle.revenue, fact, { ...opts, percentile: 0.25 })
  const revenueHigh = lookupBaseline(bundle.revenue, fact, { ...opts, percentile: 0.75 })

  const expectedReceipts = receipts ? Math.round(receipts.value) : null
  const expectedTicket = ticket ? Math.round(ticket.value) : null

  // Чем грубее сегмент и меньше выборка, тем меньше веры прогнозу.
  const levelWeight = receipts ? LEVEL_CONFIDENCE_MAP[receipts.level] ?? 0.6 : 0.4
  const sampleWeight = receipts
    ? Math.max(0.3, Math.min(1, receipts.sample / (2 * settings.min_sample_size)))
    : 0.3
  const completeness = expectedReceipts != null && expectedTicket != null ? 1 : 0.5

  return {
    expected_receipts: expectedReceipts,
    receipts_range:
      receiptsLow && receiptsHigh
        ? [Math.round(receiptsLow.value), Math.round(receiptsHigh.value)]
        : null,
    expected_avg_ticket: expectedTicket,
    expected_revenue:
      expectedReceipts != null && expectedTicket != null ? expectedReceipts * expectedTicket : null,
    revenue_range:
      revenueLow && revenueHigh ? [Math.round(revenueLow.value), Math.round(revenueHigh.value)] : null,
    confidence: Math.round(Math.min(0.98, 0.45 * levelWeight + 0.35 * sampleWeight + 0.2 * completeness) * 100) / 100,
    level: receipts?.level ?? null,
    sample: receipts?.sample ?? 0,
  }
}

const LEVEL_CONFIDENCE_MAP: Record<string, number> = {
  season_month_weekday_shift: 1,
  season_weekday_shift: 0.95,
  season_weekday_group_shift: 0.85,
  season_shift: 0.75,
  all: 0.6,
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
      cashier_coverage: share(baselineFacts.filter((f) => f.cashier_id).length, baselineFacts.length),
      attach_coverage: share(
        baselineFacts.filter((f) => f.attach_opportunities > 0).length,
        baselineFacts.length,
      ),
    },
    model_version: settings.model_version,
  }
}

export { trainingFlag as computeTrainingFlag }

export {
  findStockouts,
  stockoutSeverity,
  stockoutTitle,
  MIN_WINDOW_DAYS,
  REGULAR_ITEM_SHARE,
  type ItemSalesFrequency,
  type StockLevel,
  type StockoutCandidate,
} from './stockouts'
