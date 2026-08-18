/**
 * Симуляция смены: от распределения спроса к вероятностям планов.
 *
 * Идея буквально такая: проиграть предстоящую смену десять тысяч раз. В каждой
 * версии сначала выпадает своё число покупателей, потом каждому из них — своя
 * сумма чека. Складываем — получаем выручку этой версии смены. Десять тысяч
 * версий дают распределение выручки, а из него уже читаются ответы: сколько
 * ждать, в каких границах и с какой вероятностью возьмут B2.
 *
 * ЧЕГО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ. Он не пересчитывает план. Пороги B1/B2/B3
 * приходят снаружи уже готовыми и опубликованными; здесь они только мишени.
 * Если бы прогноз двигал план, план перестал бы быть обещанием.
 */

import { createRng, quantile } from './math'
import { sampleNegativeBinomial, fitNegativeBinomial } from './negative-binomial'
import { samplePoisson } from './poisson'
import type { DemandForecast, MonteCarloForecast, PlanThresholds, TicketModel } from './types'

export const DEFAULT_ITERATIONS = 10_000

export type SimulationInput = {
  demand: DemandForecast
  /**
   * Реальные суммы отдельных чеков из сопоставимых смен, приведённые к
   * сегодняшним ценам. Из них берётся бутстрап — розыгрыш настоящих чеков, а
   * не подгон под кривую.
   */
  ticketSamples: number[]
  /**
   * Средний чек как запасной вариант, если отдельных чеков нет. Тогда модель
   * честно помечается как empirical: сказать «это распределение чеков» про
   * поделённую на количество выручку было бы обманом.
   */
  fallbackAvgTicket: number | null
  thresholds: PlanThresholds
  iterations?: number
  /** Один и тот же seed обязан давать один и тот же ответ. */
  seed: number
}

export function simulateShift(input: SimulationInput): MonteCarloForecast | null {
  const iterations = Math.max(100, Math.min(100_000, input.iterations || DEFAULT_ITERATIONS))
  const rng = createRng(input.seed)

  const tickets = (input.ticketSamples || []).filter((v) => Number.isFinite(v) && v > 0)
  const ticketModel: TicketModel = tickets.length >= 30 ? 'bootstrap' : 'empirical'

  if (ticketModel === 'empirical' && (!input.fallbackAvgTicket || input.fallbackAvgTicket <= 0)) {
    return null
  }

  const drawReceipts = receiptSampler(input.demand, rng)
  if (!drawReceipts) return null

  const revenues: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    const receipts = drawReceipts()
    let revenue = 0
    if (ticketModel === 'bootstrap') {
      for (let r = 0; r < receipts; r++) {
        revenue += tickets[Math.floor(rng() * tickets.length)]
      }
    } else {
      revenue = receipts * (input.fallbackAvgTicket as number)
    }
    revenues[i] = revenue
  }

  revenues.sort((a, b) => a - b)

  const share = (threshold: number | null): number | null => {
    if (threshold === null || !Number.isFinite(threshold)) return null
    // Доля версий смены, где выручка дотянула до порога. Сортированный массив
    // позволяет найти её двоичным поиском вместо прохода по всем итерациям.
    return 1 - lowerBound(revenues, threshold) / revenues.length
  }

  const p = (q: number) => quantile(revenues, q) ?? 0
  const expected = revenues.reduce((sum, value) => sum + value, 0) / revenues.length
  const probabilityB1 = share(input.thresholds.b1)

  return {
    iterations,
    expectedRevenue: Math.round(expected),
    medianRevenue: Math.round(p(0.5)),
    revenueP10: Math.round(p(0.1)),
    revenueP25: Math.round(p(0.25)),
    revenueP50: Math.round(p(0.5)),
    revenueP75: Math.round(p(0.75)),
    revenueP90: Math.round(p(0.9)),
    interval80: { low: Math.round(p(0.1)), high: Math.round(p(0.9)) },
    probabilityB1,
    probabilityB2: share(input.thresholds.b2),
    probabilityB3: share(input.thresholds.b3),
    probabilityRecord: share(input.thresholds.record),
    probabilityBelowB1: probabilityB1 === null ? null : 1 - probabilityB1,
    demandModel: input.demand.model,
    ticketModel,
    // Симуляция не может быть увереннее, чем модель спроса под ней, а на
    // подменном среднем чеке — ещё осторожнее.
    confidence: input.demand.confidence * (ticketModel === 'bootstrap' ? 1 : 0.7),
  }
}

/**
 * Как разыгрывать число чеков.
 *
 * Для параметрических моделей — из самого распределения. Для эмпирической
 * розыгрыш идёт по её же перцентилям: это грубее, но не притворяется большим,
 * чем есть, и позволяет считать вероятности планов даже на коротком сегменте.
 */
function receiptSampler(demand: DemandForecast, rng: () => number): (() => number) | null {
  if (demand.model === 'negative_binomial' && demand.dispersion !== null) {
    const fit = fitNegativeBinomial(demand.expectedReceipts, demand.dispersion * demand.expectedReceipts)
    if (fit) return () => sampleNegativeBinomial(rng, fit)
  }
  if (demand.model === 'poisson' || demand.model === 'negative_binomial') {
    const lambda = demand.expectedReceipts
    if (lambda > 0) return () => samplePoisson(rng, lambda)
  }

  const ladder: Array<[number, number]> = [
    [0.1, demand.p10],
    [0.25, demand.p25],
    [0.5, demand.p50],
    [0.75, demand.p75],
    [0.9, demand.p90],
  ]
  if (!ladder.every(([, value]) => Number.isFinite(value))) return null
  return () => {
    const u = rng()
    for (let i = 0; i < ladder.length; i++) {
      if (u <= ladder[i][0]) return Math.round(ladder[i][1])
    }
    return Math.round(ladder[ladder.length - 1][1])
  }
}

/** Индекс первого элемента, который не меньше порога. */
function lowerBound(sorted: number[], target: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sorted[mid] < target) low = mid + 1
    else high = mid
  }
  return low
}
