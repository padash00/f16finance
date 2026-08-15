/**
 * Балл продавца и вывод по смене.
 *
 * Здесь живёт единственное, ради чего затевался модуль: ответ на вопрос
 * «касса просела из-за спроса или из-за продавца». Ответ строится из
 * сопоставления двух независимых величин — сколько людей купило и что
 * продавец сделал с каждым из них.
 *
 * Спрос меряется числом чеков. Отдельного счётчика посетителей у магазина
 * нет, но чек оставляет каждый купивший, а привести людей в помещение
 * продавец не может — значит число чеков это спрос, а не качество работы.
 *
 * Ограничения, заложенные намеренно:
 *   * низкая выручка сама по себе не даёт вывод «плохой продавец»;
 *   * высокая выручка сама по себе не даёт вывод «хороший продавец»;
 *   * много чеков при слабом среднем чеке — не повод считать смену успешной;
 *   * мало чеков бьёт по уверенности в оценке, а не по баллу продавца;
 *   * недостающие данные превращаются в «недостаточно данных», а не в ноль.
 */

import {
  LEVEL_CONFIDENCE,
  lookupBaseline,
  seasonOf,
  type BaselineIndex,
} from './baseline'
import { METRIC_KEYS, METRIC_LABELS, METRIC_MISSING_REASON, metricValue } from './metrics'
import type { StoreKpiSettings } from './settings'
import type {
  CashierStatus,
  CashierSummary,
  MetricKey,
  MetricRatio,
  ShiftAnalysis,
  ShiftFact,
  ShiftVerdict,
} from './types'

/**
 * Полоса «около нормы». Отклонения внутри неё считаются шумом: продавец не
 * обязан каждую смену бить свой же прошлый результат.
 */
export const NORMAL_BAND_LOW = 0.95
export const NORMAL_BAND_HIGH = 1.05

/** Спрос выше этого — касса выросла в основном из-за количества покупателей. */
export const HIGH_DEMAND_FROM = 1.1

/** Ниже этой уверенности выводы не делаются вовсе. */
export const MIN_CONFIDENCE_FOR_VERDICT = 0.35

/** Базы ожиданий: по каждой метрике, по выручке смены и по числу чеков. */
export type BaselineBundle = {
  metrics: Partial<Record<MetricKey, BaselineIndex>>
  revenue: BaselineIndex
  receipts: BaselineIndex
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function round(x: number, digits = 3): number {
  const k = 10 ** digits
  return Math.round(x * k) / k
}

function pct(ratio: number): string {
  const delta = Math.round((ratio - 1) * 100)
  return delta >= 0 ? `+${delta}%` : `${delta}%`
}

/** Разбор одной метрики: факт против ожидания для сопоставимых условий. */
function analyzeMetric(
  fact: ShiftFact,
  metric: MetricKey,
  bundle: BaselineBundle,
  settings: StoreKpiSettings,
): MetricRatio {
  const actual = metricValue(fact, metric)
  // Выполнение плана сравнивается с нормой выручки смены, остальные метрики —
  // со своей собственной базой.
  const index = metric === 'plan_attainment' ? bundle.revenue : bundle.metrics[metric]

  const hit =
    index && actual != null
      ? lookupBaseline(index, fact, {
          minSample: settings.min_sample_size,
          summerMonths: settings.summer_months,
          // Продавца нельзя сравнивать с базой, которую он сам и сформировал.
          excludeCashierId: fact.cashier_id,
        })
      : null

  if (actual == null || hit == null || hit.value <= 0) {
    return {
      metric,
      actual: actual == null ? null : round(actual, 4),
      expected: hit ? round(hit.value, 4) : null,
      raw_ratio: null,
      ratio: null,
      level: hit?.level ?? null,
      sample: hit?.sample ?? 0,
    }
  }

  const raw = actual / hit.value
  return {
    metric,
    actual: round(actual, 4),
    expected: round(hit.value, 4),
    raw_ratio: round(raw),
    ratio: round(clamp(raw, settings.ratio_clip_min, settings.ratio_clip_max)),
    level: hit.level,
    sample: hit.sample,
  }
}

/**
 * Взвешенный балл по доступным метрикам.
 *
 * Недоступная метрика не обнуляется, а исключается с перевзвешиванием
 * остальных. Магазин без настроенных правил допродаж не должен получать
 * балл ниже магазина, где они настроены.
 */
function weightedScore(
  metrics: MetricRatio[],
  weights: Record<MetricKey, number>,
): { score: number | null; usedWeight: number; totalWeight: number } {
  const totalWeight = METRIC_KEYS.reduce((sum, key) => sum + (weights[key] || 0), 0)
  let acc = 0
  let usedWeight = 0

  for (const m of metrics) {
    if (m.ratio == null) continue
    const w = weights[m.metric] || 0
    if (w <= 0) continue
    acc += w * m.ratio
    usedWeight += w
  }

  return {
    score: usedWeight > 0 ? round(acc / usedWeight) : null,
    usedWeight,
    totalWeight,
  }
}

/**
 * Уверенность в оценке: 0..1.
 *
 * Считается отдельно от балла именно для того, чтобы малое число чеков и
 * дырявые данные снижали доверие к выводу, а не сам балл продавца.
 */
function computeConfidence(
  fact: ShiftFact,
  metrics: MetricRatio[],
  used: { usedWeight: number; totalWeight: number },
  settings: StoreKpiSettings,
): number {
  const withRatio = metrics.filter((m) => m.ratio != null)

  const sampleFactor = withRatio.length
    ? withRatio.reduce(
        (sum, m) => sum + clamp(m.sample / (2 * settings.min_sample_size), 0.3, 1),
        0,
      ) / withRatio.length
    : 0.3

  const levelFactor = withRatio.length
    ? withRatio.reduce((sum, m) => sum + (m.level ? LEVEL_CONFIDENCE[m.level] : 0.6), 0) /
      withRatio.length
    : 0.6

  // Мало чеков — метрики скачут сами по себе, на такой выборке любой вывод
  // слабее. Бьём по уверенности, но не по баллу.
  const receiptsFactor = clamp(fact.receipts / settings.min_receipts_for_full_score, 0.3, 1)

  const completeness = used.totalWeight > 0 ? used.usedWeight / used.totalWeight : 0

  let raw = 0.3 * sampleFactor + 0.2 * levelFactor + 0.2 * receiptsFactor + 0.3 * completeness

  // Деловые события смены — отсутствие товара, акция, простой кассы. Продавец
  // не мог продать напиток, которого не было на витрине, поэтому такие смены
  // судим осторожнее. Балл при этом не трогаем: снижать оценку человеку за
  // чужую проблему нельзя.
  const events = fact.events || []
  if (events.length > 0) {
    const worst = events.some((e) => e.severity === 'high')
      ? 0.7
      : events.some((e) => e.severity === 'medium')
        ? 0.85
        : 0.95
    raw *= worst
  }

  // Короткая смена. Точка отработала меньше — покупателей закономерно меньше,
  // и сравнивать такую смену с полной по числу чеков честно нельзя.
  if (fact.duration_minutes != null && fact.duration_minutes > 0 && fact.duration_minutes < 300) {
    raw *= 0.8
  }

  // Смена помечена как аномальная — доверия к ней немного по определению.
  if (fact.is_anomaly) raw *= 0.7

  return round(clamp(raw, 0.05, 0.98), 2)
}

/** Вывод по смене и человеческие доказательства к нему. */
function decideVerdict(args: {
  score: number | null
  confidence: number
  revenueRatio: number | null
  demandRatio: number | null
  metrics: MetricRatio[]
}): { verdict: ShiftVerdict; evidence: string[] } {
  const { score, confidence, revenueRatio, demandRatio, metrics } = args
  const evidence: string[] = []

  if (demandRatio != null) {
    evidence.push(`Покупателей (чеков) к ожиданию: ${pct(demandRatio)}`)
  }
  if (revenueRatio != null) {
    evidence.push(`Касса к ожиданию: ${pct(revenueRatio)}`)
  }
  for (const m of metrics) {
    if (m.raw_ratio == null) continue
    if (Math.abs(m.raw_ratio - 1) < 0.03) continue
    evidence.push(`${METRIC_LABELS[m.metric]}: ${pct(m.raw_ratio)} к норме`)
  }

  if (score == null || confidence < MIN_CONFIDENCE_FOR_VERDICT) {
    return { verdict: 'INSUFFICIENT_DATA', evidence }
  }

  const demandWeak = demandRatio != null && demandRatio < NORMAL_BAND_LOW
  const demandOk = demandRatio == null || demandRatio >= NORMAL_BAND_LOW

  // Людей пришло меньше обычного, но с каждым пришедшим отработали не хуже —
  // это провал спроса, а не человека.
  if (demandWeak && score >= NORMAL_BAND_LOW) {
    return { verdict: 'LOW_DEMAND', evidence }
  }

  // Покупатели были (или их число неизвестно), а управляемые продавцом
  // метрики просели — вот это уже повод разбираться с человеком.
  if (demandOk && score < NORMAL_BAND_LOW) {
    return { verdict: 'POSSIBLE_CASHIER_ISSUE', evidence }
  }

  if (score >= NORMAL_BAND_HIGH) {
    return { verdict: 'STRONG_CASHIER', evidence }
  }

  // Касса выросла, но за счёт количества покупателей, а не качества продаж —
  // такую смену нельзя записывать продавцу в заслугу автоматически.
  if (demandRatio != null && demandRatio >= HIGH_DEMAND_FROM) {
    return { verdict: 'HIGH_DEMAND', evidence }
  }

  return { verdict: 'NORMAL', evidence }
}

/** Полный разбор одной смены. */
export function analyzeShift(
  fact: ShiftFact,
  bundle: BaselineBundle,
  settings: StoreKpiSettings,
): ShiftAnalysis {
  const metrics = METRIC_KEYS.map((metric) => analyzeMetric(fact, metric, bundle, settings))
  const { score, usedWeight, totalWeight } = weightedScore(metrics, settings.weights)
  const confidence = computeConfidence(fact, metrics, { usedWeight, totalWeight }, settings)

  const revenueHit = lookupBaseline(bundle.revenue, fact, {
    minSample: settings.min_sample_size,
    summerMonths: settings.summer_months,
    excludeCashierId: fact.cashier_id,
  })
  // Число покупателей продавец не делает, поэтому исключать его смены из
  // базы спроса незачем — это лишь сузило бы выборку.
  const receiptsHit = lookupBaseline(bundle.receipts, fact, {
    minSample: settings.min_sample_size,
    summerMonths: settings.summer_months,
  })
  const ticketHit = lookupBaseline(bundle.metrics.avg_ticket as BaselineIndex, fact, {
    minSample: settings.min_sample_size,
    summerMonths: settings.summer_months,
    excludeCashierId: fact.cashier_id,
  })

  // База хранится в ценах базового месяца — возвращаем ожидания в деньги той
  // смены, о которой идёт речь, иначе владелец увидит цифры прошлого года.
  const prices = fact.price_index && fact.price_index > 0 ? fact.price_index : 1
  const expectedRevenue = revenueHit ? revenueHit.value * prices : null
  const expectedTicket = ticketHit ? ticketHit.value * prices : null

  const revenueRatio = expectedRevenue && expectedRevenue > 0 ? round(fact.revenue / expectedRevenue) : null
  const demandRatio =
    receiptsHit && receiptsHit.value > 0 ? round(fact.receipts / receiptsHit.value) : null

  const { verdict, evidence } = decideVerdict({
    score,
    confidence,
    revenueRatio,
    demandRatio,
    metrics,
  })

  const missing: string[] = []
  for (const m of metrics) {
    if (m.ratio != null) continue
    const reason = m.actual == null ? METRIC_MISSING_REASON[m.metric] : 'истории для сравнения не хватило'
    missing.push(`${METRIC_LABELS[m.metric]}: ${reason}`)
  }
  if (demandRatio == null) missing.push('Спрос: нет сопоставимой истории по числу чеков')

  return {
    fact,
    season: seasonOf(fact.date, settings.summer_months),
    metrics,
    score,
    confidence,
    verdict,
    evidence,
    missing,
    expected_revenue: expectedRevenue == null ? null : Math.round(expectedRevenue),
    expected_receipts: receiptsHit ? Math.round(receiptsHit.value) : null,
    expected_avg_ticket: expectedTicket == null ? null : Math.round(expectedTicket),
  }
}

function statusFor(score: number | null, shifts: number, settings: StoreKpiSettings): CashierStatus {
  // Статус по одной смене не присваивается: разброс смен слишком велик,
  // чтобы навешивать на человека ярлык после единственного вечера.
  if (score == null || shifts < settings.min_qualifying_shifts) return 'INSUFFICIENT_DATA'
  if (score < settings.status_needs_training_below) return 'NEEDS_TRAINING'
  if (score >= settings.status_top_from) return 'TOP'
  if (score >= settings.status_strong_from) return 'STRONG'
  return 'NORMAL'
}

/** Сводка по продавцу за период. */
export function summarizeCashier(
  cashierId: string,
  shifts: ShiftAnalysis[],
  settings: StoreKpiSettings,
): CashierSummary {
  const mine = shifts.filter((s) => s.fact.cashier_id === cashierId)

  let scoreAcc = 0
  let scoreWeight = 0
  for (const s of mine) {
    if (s.score == null) continue
    // Смена с тремя чеками не должна весить как смена с шестьюдесятью.
    const weight = Math.max(1, s.fact.receipts)
    scoreAcc += s.score * weight
    scoreWeight += weight
  }
  const score = scoreWeight > 0 ? round(scoreAcc / scoreWeight) : null

  const ratioAcc = new Map<MetricKey, { sum: number; n: number }>()
  for (const s of mine) {
    for (const m of s.metrics) {
      if (m.ratio == null) continue
      const cur = ratioAcc.get(m.metric) || { sum: 0, n: 0 }
      cur.sum += m.ratio
      cur.n += 1
      ratioAcc.set(m.metric, cur)
    }
  }
  const metric_ratios: Partial<Record<MetricKey, number>> = {}
  for (const [metric, agg] of ratioAcc) metric_ratios[metric] = round(agg.sum / agg.n)

  const ranked = [...ratioAcc.entries()].map(([metric, agg]) => ({
    metric,
    ratio: agg.sum / agg.n,
  }))
  const strengths = ranked
    .filter((r) => r.ratio >= NORMAL_BAND_HIGH)
    .sort((a, b) => b.ratio - a.ratio)
    .map((r) => r.metric)
  const weaknesses = ranked
    .filter((r) => r.ratio <= NORMAL_BAND_LOW)
    .sort((a, b) => a.ratio - b.ratio)
    .map((r) => r.metric)

  const verdicts = {
    LOW_DEMAND: 0,
    POSSIBLE_CASHIER_ISSUE: 0,
    HIGH_DEMAND: 0,
    STRONG_CASHIER: 0,
    NORMAL: 0,
    INSUFFICIENT_DATA: 0,
  } as Record<ShiftVerdict, number>
  for (const s of mine) verdicts[s.verdict] += 1

  const avgConfidence = mine.length
    ? mine.reduce((sum, s) => sum + s.confidence, 0) / mine.length
    : 0
  // Мало смен — меньше доверия к статусу, даже если каждая смена посчитана точно.
  const confidence = round(
    avgConfidence * clamp(mine.length / settings.min_qualifying_shifts, 0.4, 1),
    2,
  )

  return {
    cashier_id: cashierId,
    shifts: mine.length,
    revenue: Math.round(mine.reduce((sum, s) => sum + s.fact.revenue, 0)),
    receipts: mine.reduce((sum, s) => sum + s.fact.receipts, 0),
    score,
    status: statusFor(score, mine.length, settings),
    confidence,
    metric_ratios,
    strengths,
    weaknesses,
    verdicts,
  }
}

/**
 * Флаг «нужно обучение» по нескольким сменам.
 *
 * Одна слабая смена ничего не значит. Флаг ставится, только если картина
 * повторяется и просели именно управляемые продавцом метрики. Это
 * рекомендация управляющему, а не наказание и не автоматическое решение.
 */
export function trainingFlag(
  summary: CashierSummary,
  shifts: ShiftAnalysis[],
  settings: StoreKpiSettings,
): { flagged: boolean; reason: string | null } {
  const mine = shifts
    .filter((s) => s.fact.cashier_id === summary.cashier_id && s.score != null)
    .slice(-settings.min_qualifying_shifts)

  if (mine.length < settings.min_qualifying_shifts) {
    return { flagged: false, reason: null }
  }

  const weakShifts = mine.filter((s) => (s.score ?? 1) < settings.status_needs_training_below).length
  const controllable: MetricKey[] = ['avg_ticket', 'items_per_receipt', 'attach_rate', 'revenue_efficiency']
  const weakMetrics = controllable.filter((m) => (summary.metric_ratios[m] ?? 1) < NORMAL_BAND_LOW)

  // Большинство смен слабые И минимум две управляемые метрики ниже нормы.
  const flagged = weakShifts >= Math.ceil(mine.length * 0.6) && weakMetrics.length >= 2

  return {
    flagged,
    reason: flagged
      ? `${weakShifts} из ${mine.length} последних смен ниже нормы, просели: ${weakMetrics
          .map((m) => METRIC_LABELS[m].toLowerCase())
          .join(', ')}`
      : null,
  }
}
