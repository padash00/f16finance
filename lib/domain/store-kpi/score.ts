/**
 * Балл продавца и вывод по смене.
 *
 * Здесь живёт единственное, ради чего затевался модуль: ответ на вопрос
 * «касса просела из-за потока или из-за продавца». Ответ строится из
 * сопоставления двух независимых величин — был ли поток и что продавец сделал
 * с каждым пришедшим клиентом.
 *
 * Ограничения, заложенные намеренно:
 *   * низкая выручка сама по себе не даёт вывод «плохой продавец»;
 *   * высокая выручка сама по себе не даёт вывод «хороший продавец»;
 *   * слабый поток бьёт по уверенности в оценке, а не по баллу продавца;
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

/** Ниже этой уверенности выводы не делаются вовсе. */
export const MIN_CONFIDENCE_FOR_VERDICT = 0.35

/** Базы ожиданий: по каждой метрике, по выручке магазина и по потоку. */
export type BaselineBundle = {
  metrics: Partial<Record<MetricKey, BaselineIndex>>
  revenue: BaselineIndex
  club: BaselineIndex
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

/** Разбор одной метрики: факт, ожидание и их отношение с клипом. */
function analyzeMetric(
  fact: ShiftFact,
  metric: MetricKey,
  bundle: BaselineBundle,
  settings: StoreKpiSettings,
): MetricRatio {
  const actual = metricValue(fact, metric)
  const index = bundle.metrics[metric]

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
 * Недоступные метрики не обнуляются, а исключаются с перевзвешиванием
 * остальных: магазин, где не настроены правила допродаж, не должен получать
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
 * Считается отдельно от балла именно для того, чтобы слабый поток и дырявые
 * данные снижали доверие к выводу, а не сам балл продавца.
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

  const receiptsFactor = clamp(fact.receipts / settings.min_receipts_for_full_score, 0.3, 1)

  const completeness = used.totalWeight > 0 ? used.usedWeight / used.totalWeight : 0

  let raw = 0.3 * sampleFactor + 0.2 * levelFactor + 0.2 * receiptsFactor + 0.3 * completeness

  // Без прокси потока модуль не может ответить на свой главный вопрос — поток
  // просел или продавец. Метрики внутри чека остаются, вывод по ним сделать
  // можно, но это вывод с одним закрытым глазом, и цена ошибки тут высокая:
  // человека можно записать в слабые за чужой пустой вечер.
  if (fact.club_revenue == null || fact.club_revenue <= 0) raw *= 0.8

  return round(clamp(raw, 0.05, 0.98), 2)
}

/** Вывод по смене и человеческие доказательства к нему. */
function decideVerdict(args: {
  score: number | null
  confidence: number
  revenueRatio: number | null
  trafficRatio: number | null
  metrics: MetricRatio[]
}): { verdict: ShiftVerdict; evidence: string[] } {
  const { score, confidence, revenueRatio, trafficRatio, metrics } = args
  const evidence: string[] = []

  if (trafficRatio != null) {
    evidence.push(`Поток (выручка клуба) к ожиданию: ${pct(trafficRatio)}`)
  }
  if (revenueRatio != null) {
    evidence.push(`Касса магазина к ожиданию: ${pct(revenueRatio)}`)
  }
  for (const m of metrics) {
    if (m.raw_ratio == null) continue
    if (Math.abs(m.raw_ratio - 1) < 0.03) continue
    evidence.push(`${METRIC_LABELS[m.metric]}: ${pct(m.raw_ratio)} к норме`)
  }

  if (score == null || confidence < MIN_CONFIDENCE_FOR_VERDICT) {
    return { verdict: 'INSUFFICIENT_DATA', evidence }
  }

  const trafficWeak = trafficRatio != null && trafficRatio < NORMAL_BAND_LOW
  const trafficOk = trafficRatio == null || trafficRatio >= NORMAL_BAND_LOW
  const revenueWeak = revenueRatio != null && revenueRatio < NORMAL_BAND_LOW

  // Поток просел, касса просела, но работа продавца не хуже обычной —
  // это провал потока, а не человека.
  if (trafficWeak && revenueWeak && score >= NORMAL_BAND_LOW) {
    return { verdict: 'TRAFFIC_DRIVEN', evidence }
  }

  // Поток был (или неизвестен), а управляемые продавцом метрики просели —
  // вот это уже повод разбираться с человеком.
  if (trafficOk && score < NORMAL_BAND_LOW) {
    return { verdict: 'POSSIBLE_CASHIER_ISSUE', evidence }
  }

  if (score >= NORMAL_BAND_HIGH) {
    return { verdict: 'CASHIER_DRIVEN', evidence }
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
  // Выручку клуба продавец магазина не делает, поэтому исключать его смены
  // из базы потока незачем — наоборот, это сузило бы выборку без причины.
  const clubHit = lookupBaseline(bundle.club, fact, {
    minSample: settings.min_sample_size,
    summerMonths: settings.summer_months,
  })

  const revenueRatio = revenueHit && revenueHit.value > 0 ? round(fact.revenue / revenueHit.value) : null
  const trafficRatio =
    clubHit && clubHit.value > 0 && fact.club_revenue != null
      ? round(fact.club_revenue / clubHit.value)
      : null

  const { verdict, evidence } = decideVerdict({
    score,
    confidence,
    revenueRatio,
    trafficRatio,
    metrics,
  })

  const missing: string[] = []
  for (const m of metrics) {
    if (m.ratio != null) continue
    const reason = m.actual == null ? METRIC_MISSING_REASON[m.metric] : 'истории для сравнения не хватило'
    missing.push(`${METRIC_LABELS[m.metric]}: ${reason}`)
  }
  if (trafficRatio == null) missing.push('Поток: нет сопоставимой истории выручки клуба')

  return {
    fact,
    season: seasonOf(fact.date, settings.summer_months),
    metrics,
    score,
    confidence,
    verdict,
    evidence,
    missing,
    expected_revenue: revenueHit ? Math.round(revenueHit.value) : null,
    expected_club_revenue: clubHit ? Math.round(clubHit.value) : null,
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
    TRAFFIC_DRIVEN: 0,
    POSSIBLE_CASHIER_ISSUE: 0,
    CASHIER_DRIVEN: 0,
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
