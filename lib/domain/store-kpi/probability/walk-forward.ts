/**
 * Прогон обеих моделей по истории — честно, день за днём.
 *
 * Здесь соблюдается главное правило бэктеста: прогнозируя смену, модель видит
 * только то, что было известно до её начала. Смена попадает в историю ПОСЛЕ
 * того, как по ней сделан прогноз, — за счёт этого утечка будущего невозможна
 * не потому, что мы её проверяем, а потому, что для неё нет пути.
 *
 * Заодно решается вопрос производительности. Смены одного сегмента дают одну и
 * ту же подгонку, пока в сегмент не добавилось новых наблюдений. Поэтому
 * подогнанное распределение и симуляция кэшируются по составу выборки: за
 * месяц сегментов полтора десятка, а смен под сотню — считать одно и то же
 * заново сотню раз незачем.
 */

import {
  addFactToBaselineIndex,
  emptyBaselineIndex,
  lookupBaseline,
  lookupBaselineSamples,
  revenueThresholds,
} from '../baseline'
import type { ShiftFact } from '../types'
import { forecastDemand } from './demand'
import { simulateShift } from './monte-carlo'
import { seedFromString } from './math'
import type { BacktestPoint, CalibrationPoint, RevenuePoint } from './backtest'
import type { DemandForecast } from './types'

export type WalkForwardOptions = {
  minSample: number
  summerMonths: number[]
  /** Перцентили для порогов плана — те же, что у модуля. */
  planPercentiles?: { control: number; b1: number; b2: number; b3: number }
  /** Сколько симуляций на сегмент. В бэктесте меньше: сегментов много. */
  iterations?: number
}

export type WalkForwardResult = {
  demandPoints: BacktestPoint[]
  /** Прогноз выручки против факта — вторая половина ответа, рядом со спросом. */
  revenuePoints: RevenuePoint[]
  /** Вероятность B1 против того, взяли его или нет. */
  b1Calibration: CalibrationPoint[]
  /** Сколько раз распределение подгонялось заново — мера работы кэша. */
  fits: number
  /** Сколько смен обслужено из кэша. */
  cacheHits: number
}

const DEFAULT_PERCENTILES = { control: 0.4, b1: 0.55, b2: 0.7, b3: 0.85 }

/** Число чеков смены. null — считать не на чем, и такая смена в базу не идёт. */
function receiptsOf(fact: ShiftFact): number | null {
  const value = Number(fact.receipts)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function revenueOf(fact: ShiftFact): number | null {
  const gross = Number(fact.revenue ?? fact.gross_revenue)
  return Number.isFinite(gross) ? gross : null
}

/**
 * Множитель цен смены.
 *
 * База выручки хранится в ценах базового месяца, а сравнивается с фактом в
 * сегодняшних. Без обратного пересчёта подорожание меню читалось бы как
 * систематическое превышение плана — и модель выглядела бы вечно занижающей.
 * Ровно так это уже сделано в рабочем модуле, и бэктест обязан повторять его
 * поведение, иначе он мерит не ту модель, что работает.
 */
function priceOf(fact: ShiftFact): number {
  const value = Number(fact.price_index)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/** Выручка в ценах базового месяца — в таком виде она и ложится в базу. */
function deflatedRevenueOf(fact: ShiftFact): number | null {
  const gross = revenueOf(fact)
  return gross === null ? null : gross / priceOf(fact)
}

/**
 * Ключ кэша по составу выборки.
 *
 * Именно по составу, а не по имени сегмента: сегмент тот же, но с новой сменой
 * внутри — это уже другая выборка и другая подгонка. Длина плюс сумма дают
 * достаточно надёжный отпечаток для набора чисел такого размера.
 */
function sampleKey(level: string, values: number[]): string {
  let sum = 0
  for (const value of values) sum += value
  return `${level}|${values.length}|${sum}`
}

export function walkForward(facts: ShiftFact[], options: WalkForwardOptions): WalkForwardResult {
  const percentiles = options.planPercentiles || DEFAULT_PERCENTILES
  const iterations = options.iterations || 2000

  // Хронологический порядок — обязательное условие. Дневная смена идёт перед
  // ночной того же дня: ночная уже знает её результат.
  const ordered = [...facts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.shift === b.shift) return 0
    return a.shift === 'day' ? -1 : 1
  })

  const receiptsIndex = emptyBaselineIndex()
  const revenueIndex = emptyBaselineIndex()
  // Средний чек каждой прошлой смены. Отдельная база, потому что средний чек
  // гуляет ото дня ко дню сам по себе, и без этого разброса выручка в
  // симуляции получалась бы ровнее, чем в жизни.
  const avgTicketIndex = emptyBaselineIndex()

  const demandPoints: BacktestPoint[] = []
  const revenuePoints: RevenuePoint[] = []
  const b1Calibration: CalibrationPoint[] = []

  const demandCache = new Map<string, DemandForecast | null>()
  const probabilityCache = new Map<string, number | null>()
  let fits = 0
  let cacheHits = 0

  for (const fact of ordered) {
    const actual = receiptsOf(fact)
    const actualRevenue = revenueOf(fact)

    // ── Прогноз строится строго на том, что уже лежит в индексе ──────────
    const lookupOpts = { minSample: options.minSample, summerMonths: options.summerMonths }

    const v1Median = lookupBaseline(receiptsIndex, fact, { ...lookupOpts, percentile: 0.5 })
    const v1Low = lookupBaseline(receiptsIndex, fact, { ...lookupOpts, percentile: 0.25 })
    const v1High = lookupBaseline(receiptsIndex, fact, { ...lookupOpts, percentile: 0.75 })

    const samples = lookupBaselineSamples(receiptsIndex, fact, lookupOpts)

    let v2: DemandForecast | null = null
    if (samples) {
      // Длительность целевой смены — часть ключа: тот же сегмент, но смена
      // вдвое короче, даёт другой прогноз, и отдать ей кэш полной смены
      // значило бы вернуть заведомо завышенное ожидание.
      const key = sampleKey(samples.level, samples.values) + '|' + (fact.duration_minutes ?? 'x')
      if (demandCache.has(key)) {
        v2 = demandCache.get(key) ?? null
        cacheHits += 1
      } else {
        v2 = forecastDemand(samples.values, {
          exposures: samples.durations,
          targetExposure: fact.duration_minutes ?? null,
        })
        demandCache.set(key, v2)
        fits += 1
      }
    }

    if (actual !== null) {
      demandPoints.push({
        v1Expected: v1Median?.value ?? null,
        v1Interval:
          v1Low && v1High ? { low: v1Low.value, high: v1High.value } : null,
        v2,
        actual,
      })
    }

    // ── Вероятность B1 против того, что случилось ───────────────────────
    if (v2 && actualRevenue !== null) {
      const thresholds = revenueThresholds(revenueIndex, fact, {
        minSample: options.minSample,
        summerMonths: options.summerMonths,
        percentiles: [percentiles.control, percentiles.b1, percentiles.b2, percentiles.b3, 1],
      })
      const avgTickets = lookupBaselineSamples(avgTicketIndex, fact, lookupOpts)
      const avgTicketHit = lookupBaseline(avgTicketIndex, fact, { ...lookupOpts, percentile: 0.5 })

      if (thresholds && avgTicketHit && v2.expectedReceipts > 0) {
        // Чеков по отдельности в фактах смены нет, и притворяться, что есть,
        // нельзя. Зато есть средний чек каждой прошлой смены — из него и
        // берём разброс.
        //
        // Всё, что пришло из базы, лежит в ценах базового месяца, а пороги
        // плана объявлены в сегодняшних. Переводим базу в сегодняшние деньги.
        const prices = priceOf(fact)
        const avgTicket = avgTicketHit.value * prices
        const key = `${sampleKey(samples!.level, samples!.values)}|${Math.round(thresholds.values[1])}|${avgTickets ? sampleKey('t', avgTickets.values) : Math.round(avgTicket)}`

        let probability: number | null
        let simulation: ReturnType<typeof simulateShift> = null
        if (probabilityCache.has(key)) {
          probability = probabilityCache.get(key) ?? null
          cacheHits += 1
        } else {
          simulation = simulateShift({
            demand: v2,
            ticketSamples: [],
            shiftAvgTicketSamples: (avgTickets?.values || []).map((v) => v * prices),
            fallbackAvgTicket: avgTicket,
            thresholds: {
              control: thresholds.values[0] * prices,
              b1: thresholds.values[1] * prices,
              b2: thresholds.values[2] * prices,
              b3: thresholds.values[3] * prices,
              record: thresholds.values[4] * prices,
            },
            iterations,
            seed: seedFromString(key),
          })
          probability = simulation?.probabilityB1 ?? null
          probabilityCache.set(key, probability)
          fits += 1
        }

        if (probability !== null) {
          b1Calibration.push({ probability, happened: actualRevenue >= thresholds.values[1] * prices })
        }

        // Прогноз выручки нынешней модели — медиана сопоставимых смен: ровно
        // то, что модуль показывает как «обычная касса».
        const v1Revenue = lookupBaseline(revenueIndex, fact, { ...lookupOpts, percentile: 0.5 })
        if (simulation && v1Revenue) {
          revenuePoints.push({
            v1Expected: v1Revenue.value * prices,
            v2Expected: simulation.medianRevenue,
            v2Interval: simulation.interval80,
            actual: actualRevenue,
          })
        }
      }
    }

    // ── И только теперь смена становится историей ───────────────────────
    addFactToBaselineIndex(receiptsIndex, fact, actual, { summerMonths: options.summerMonths })
    // В базу — в ценах базового месяца, как это делает рабочий модуль.
    const deflated = deflatedRevenueOf(fact)
    addFactToBaselineIndex(revenueIndex, fact, deflated, { summerMonths: options.summerMonths })
    addFactToBaselineIndex(
      avgTicketIndex,
      fact,
      actual !== null && actual > 0 && deflated !== null ? deflated / actual : null,
      { summerMonths: options.summerMonths },
    )
  }

  return { demandPoints, revenuePoints, b1Calibration, fits, cacheHits }
}
