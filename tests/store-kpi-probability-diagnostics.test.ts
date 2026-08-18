/**
 * Диагностика модели должна говорить правду о самой себе.
 *
 * Проверяем, что она не хвалит модель, работающую вслепую, и не паникует
 * там, где всё в порядке. Это единственное место, где система признаётся,
 * чего она не знает, — и оно обязано работать.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { dispersionSummary, probabilityDiagnostics } from '@/lib/domain/store-kpi/probability'
import type { DemandForecast, MonteCarloForecast, RateEstimate } from '@/lib/domain/store-kpi/probability'

function demand(model: DemandForecast['model'], dispersion: number | null = 1.5): DemandForecast {
  return {
    model,
    expectedReceipts: 40,
    medianReceipts: 40,
    p10: 25,
    p25: 33,
    p50: 40,
    p75: 47,
    p90: 55,
    interval80: { low: 25, high: 55 },
    probabilityBelowExpected: 0.5,
    probabilityLowDemand: 0.25,
    probabilityHighDemand: 0.25,
    dispersion,
    sampleSize: 30,
    confidence: 0.8,
    fallbackReason: null,
  }
}

function attach(opportunities: number): RateEstimate {
  return {
    successes: Math.round(opportunities / 2),
    opportunities,
    observedRate: 0.5,
    posteriorMean: 0.5,
    credibleInterval80: { low: 0.3, high: 0.7 },
    probabilityAboveBaseline: 0.5,
    probabilityBelowBaseline: 0.5,
    confidence: 0.6,
  }
}

function simulation(ticketModel: MonteCarloForecast['ticketModel']): MonteCarloForecast {
  return {
    iterations: 1000,
    expectedRevenue: 50_000,
    medianRevenue: 50_000,
    revenueP10: 40_000,
    revenueP25: 45_000,
    revenueP50: 50_000,
    revenueP75: 55_000,
    revenueP90: 60_000,
    interval80: { low: 40_000, high: 60_000 },
    probabilityB1: 0.7,
    probabilityB2: 0.4,
    probabilityB3: 0.2,
    probabilityRecord: 0.05,
    probabilityBelowB1: 0.3,
    demandModel: 'negative_binomial',
    ticketModel,
    confidence: 0.8,
  }
}

test('модель без истории не получает высокой оценки', () => {
  const result = probabilityDiagnostics({
    shifts: Array.from({ length: 10 }, () => ({ demand: null, attach: null, simulation: null })),
  })
  assert.ok(result.score < 0.4, `оценка ${result.score} слишком высока для модели без данных`)
  assert.equal(result.worst?.key, 'forecast_coverage')
})

test('работа на прежней модели признаётся честно', () => {
  const result = probabilityDiagnostics({
    shifts: Array.from({ length: 10 }, () => ({
      demand: demand('empirical'),
      attach: attach(40),
      simulation: null,
    })),
  })
  const check = result.checks.find((c) => c.key === 'parametric_share')!
  assert.equal(check.ok, false)
  assert.match(check.hint, /перцентилях/)
})

test('отсутствие отдельных чеков названо своими словами', () => {
  const result = probabilityDiagnostics({
    shifts: Array.from({ length: 10 }, () => ({
      demand: demand('negative_binomial'),
      attach: attach(40),
      simulation: simulation('shift_average'),
    })),
  })
  const check = result.checks.find((c) => c.key === 'receipt_level')!
  assert.equal(check.value, 0)
  assert.match(check.hint, /увереннее, чем данные позволяют/)
})

test('короткие смены помечаются как непригодные для вывода о продавце', () => {
  const result = probabilityDiagnostics({
    shifts: Array.from({ length: 10 }, (_, i) => ({
      demand: demand('poisson'),
      attach: attach(i < 6 ? 5 : 40),
      simulation: null,
    })),
  })
  const check = result.checks.find((c) => c.key === 'attach_sample')!
  assert.equal(check.ok, false)
  assert.match(check.hint, /6 сменах/)
})

test('узкий диапазон ловится как самоуверенность', () => {
  const result = probabilityDiagnostics({
    shifts: [{ demand: demand('negative_binomial'), attach: attach(40), simulation: null }],
    coverage80: 0.55,
  })
  const check = result.checks.find((c) => c.key === 'interval_coverage')!
  assert.equal(check.ok, false)
  assert.match(check.hint, /слишком узкий/)
})

test('слишком широкий диапазон тоже не считается хорошим', () => {
  const result = probabilityDiagnostics({
    shifts: [{ demand: demand('negative_binomial'), attach: attach(40), simulation: null }],
    coverage80: 0.97,
  })
  const check = result.checks.find((c) => c.key === 'interval_coverage')!
  assert.equal(check.ok, false)
  assert.match(check.hint, /шире необходимого/)
})

test('здоровая модель получает высокую оценку', () => {
  const result = probabilityDiagnostics({
    shifts: Array.from({ length: 20 }, () => ({
      demand: demand('negative_binomial'),
      attach: attach(45),
      simulation: simulation('bootstrap'),
    })),
    coverage80: 0.79,
    relativeWidth: 0.45,
  })
  assert.ok(result.score > 0.9, `оценка ${result.score}`)
  assert.ok(result.checks.every((c) => c.ok))
})

test('считает, какими моделями работали', () => {
  const result = probabilityDiagnostics({
    shifts: [
      { demand: demand('negative_binomial'), attach: null, simulation: simulation('bootstrap') },
      { demand: demand('poisson'), attach: null, simulation: simulation('empirical') },
      { demand: demand('poisson'), attach: null, simulation: null },
    ],
  })
  assert.equal(result.models.demand.poisson, 2)
  assert.equal(result.models.demand.negative_binomial, 1)
  assert.equal(result.models.ticket.bootstrap, 1)
})

test('разброс потока сводится в понятные числа', () => {
  const summary = dispersionSummary([
    { demand: demand('negative_binomial', 1.2) },
    { demand: demand('negative_binomial', 2.4) },
    { demand: demand('negative_binomial', 5.0) },
    { demand: null },
  ])
  assert.equal(summary.median, 2.4)
  assert.equal(summary.max, 5)
})

test('без данных о разбросе возвращается null, а не ноль', () => {
  const summary = dispersionSummary([{ demand: null }, { demand: demand('empirical', null) }])
  assert.equal(summary.median, null)
  assert.equal(summary.max, null)
})
