/**
 * Бэктест: проверяем не метрики, а честность процедуры.
 *
 * Модель, которая подглядывает в ответ, на бумаге выглядит великолепно.
 * Поэтому главные тесты здесь не про точность, а про то, что прогноз на смену
 * физически не мог видеть ни саму смену, ни то, что было после неё.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { calibration, compareModels } from '@/lib/domain/store-kpi/probability/backtest'
import { walkForward } from '@/lib/domain/store-kpi/probability/walk-forward'
import { createRng } from '@/lib/domain/store-kpi/probability'
import type { ShiftFact } from '@/lib/domain/store-kpi'

const OPTS = { minSample: 8, summerMonths: [6, 7, 8], iterations: 500 }

function fact(patch: Partial<ShiftFact>): ShiftFact {
  return {
    company_id: 'c1',
    date: '2026-05-01',
    shift: 'day',
    cashier_id: 'op1',
    revenue: 50_000,
    gross_revenue: 50_000,
    refunds: 0,
    receipts: 40,
    items: 60,
    lines: 60,
    receipts_2plus: 20,
    receipts_3plus: 5,
    attach_opportunities: 10,
    attach_success: 4,
    cogs: 20_000,
    discount_amount: 0,
    discounted_receipts: 0,
    unique_skus: 12,
    price_index: 1,
    ...patch,
  } as ShiftFact
}

/** Полгода правдоподобной истории: будни тише выходных, ночь тише дня. */
function history(days: number, seed = 4242): ShiftFact[] {
  const rng = createRng(seed)
  const facts: ShiftFact[] = []
  const start = new Date('2026-03-01T00:00:00Z')

  for (let d = 0; d < days; d++) {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + d)
    const iso = date.toISOString().slice(0, 10)
    const dow = date.getUTCDay()
    const weekend = dow === 0 || dow === 6

    for (const shift of ['day', 'night'] as const) {
      const base = (weekend ? 55 : 35) * (shift === 'day' ? 1 : 0.7)
      const receipts = Math.max(1, Math.round(base + (rng() - 0.5) * base * 0.8))
      const avgTicket = 1100 + rng() * 400
      facts.push(
        fact({
          date: iso,
          shift,
          cashier_id: rng() < 0.5 ? 'op1' : 'op2',
          receipts,
          revenue: Math.round(receipts * avgTicket),
          gross_revenue: Math.round(receipts * avgTicket),
        }),
      )
    }
  }
  return facts
}

test('прогноз на смену не видит саму смену', () => {
  // Ставим в конец истории смену с диким выбросом. Если прогноз на неё
  // изменится от того, что мы поменяли ЕЁ ЖЕ факт, значит модель подглядывает.
  const base = history(60)
  const target = base[base.length - 1]

  const normal = walkForward(base, OPTS)
  const spiked = walkForward(
    base.map((f) => (f === target ? fact({ ...f, receipts: 5000, revenue: 9_000_000 }) : f)),
    OPTS,
  )

  const a = normal.demandPoints[normal.demandPoints.length - 1]
  const b = spiked.demandPoints[spiked.demandPoints.length - 1]

  assert.equal(a.v1Expected, b.v1Expected, 'старая модель увидела саму смену')
  assert.equal(a.v2?.expectedReceipts, b.v2?.expectedReceipts, 'новая модель увидела саму смену')
  assert.notEqual(a.actual, b.actual, 'подмена факта не сработала — тест бессмысленный')
})

test('прогноз не видит будущего', () => {
  // Меняем ПОСЛЕДНЮЮ смену и смотрим на прогноз для СЕРЕДИНЫ истории: он
  // обязан остаться прежним, потому что тогда этих данных ещё не было.
  const base = history(60)
  const changed = base.map((f, i) =>
    i >= base.length - 10 ? fact({ ...f, receipts: 4000, revenue: 8_000_000 }) : f,
  )

  const normal = walkForward(base, OPTS)
  const withFuture = walkForward(changed, OPTS)

  const middle = Math.floor(normal.demandPoints.length / 2)
  assert.equal(normal.demandPoints[middle].v1Expected, withFuture.demandPoints[middle].v1Expected)
  assert.equal(
    normal.demandPoints[middle].v2?.expectedReceipts,
    withFuture.demandPoints[middle].v2?.expectedReceipts,
  )
})

test('первые смены прогноза не получают — истории ещё нет', () => {
  const result = walkForward(history(40), OPTS)
  const first = result.demandPoints[0]
  assert.equal(first.v1Expected, null)
  assert.equal(first.v2, null)
})

test('порядок фактов на входе не влияет на результат', () => {
  // Прогон обязан сам приводить смены в хронологический порядок: иначе
  // результат зависел бы от того, как база вернула строки.
  const base = history(50)
  const shuffled = [...base].reverse()

  const a = walkForward(base, OPTS)
  const b = walkForward(shuffled, OPTS)

  assert.equal(a.demandPoints.length, b.demandPoints.length)
  assert.deepEqual(
    a.demandPoints.map((p) => p.v2?.expectedReceipts ?? null),
    b.demandPoints.map((p) => p.v2?.expectedReceipts ?? null),
  )
})

test('кэш сегментов реально работает', () => {
  // Иначе месячный отчёт будет пересчитывать одно и то же распределение
  // на каждой смене.
  const result = walkForward(history(90), OPTS)
  assert.ok(result.cacheHits > 0, 'кэш не сработал ни разу')
})

test('сравнение моделей считает только общие смены', () => {
  const points = [
    { v1Expected: 40, v1Interval: { low: 30, high: 50 }, v2: null, actual: 42 },
    { v1Expected: null, v1Interval: null, v2: null, actual: 38 },
  ]
  const result = compareModels(points as any)
  assert.equal(result.v1.observations, 0, 'смена без прогноза V2 не должна засчитываться V1')
  assert.equal(result.verdict.winner, 'tie')
})

test('на реальной истории обе модели дают осмысленные метрики', () => {
  const result = walkForward(history(120), OPTS)
  const comparison = compareModels(result.demandPoints)

  assert.ok(comparison.v1.observations > 50, 'слишком мало сравнимых смен')
  assert.ok(comparison.v1.mae! > 0 && comparison.v1.mae! < 100)
  assert.ok(comparison.v2.mae! > 0 && comparison.v2.mae! < 100)
  assert.ok(comparison.v2.coverage80! > 0.5, `охват 80% всего ${comparison.v2.coverage80}`)
  assert.ok(comparison.v2.intervalWidth! > 0)
  assert.ok(comparison.verdict.summary.length > 10)
})

test('вердикт не объявляет победителя по шуму', () => {
  const identical = Array.from({ length: 40 }, (_, i) => ({
    v1Expected: 40,
    v1Interval: { low: 30, high: 50 },
    v2: {
      model: 'poisson' as const,
      expectedReceipts: 40,
      medianReceipts: 40,
      p10: 30,
      p25: 35,
      p50: 40,
      p75: 45,
      p90: 50,
      interval80: { low: 30, high: 50 },
      probabilityBelowExpected: 0.5,
      probabilityLowDemand: 0.25,
      probabilityHighDemand: 0.25,
      dispersion: 1,
      sampleSize: 30,
      confidence: 0.8,
      fallbackReason: null,
    },
    actual: 38 + (i % 5),
  }))

  const result = compareModels(identical)
  assert.equal(result.verdict.winner, 'tie')
  assert.match(result.verdict.summary, /одинаково точно/)
})

test('калибровка ловит вруна', () => {
  // Модель, которая всем подряд обещает 90%, а сбывается в половине случаев.
  const liar = Array.from({ length: 100 }, (_, i) => ({ probability: 0.9, happened: i % 2 === 0 }))
  const honest = Array.from({ length: 100 }, (_, i) => ({ probability: 0.5, happened: i % 2 === 0 }))

  const liarResult = calibration(liar)
  const honestResult = calibration(honest)

  assert.ok(liarResult.brierScore! > honestResult.brierScore!, 'вруну обязано быть хуже')
  const bucket = liarResult.buckets.find((b) => b.predicted > 0.8)!
  assert.ok(Math.abs(bucket.observed - 0.5) < 0.01, 'разбивка не показала расхождение')
})

test('калибровка вероятностей плана считается на реальном прогоне', () => {
  const result = walkForward(history(150), OPTS)
  assert.ok(result.b1Calibration.length > 20, `точек калибровки всего ${result.b1Calibration.length}`)

  const calibrated = calibration(result.b1Calibration)
  assert.ok(calibrated.brierScore !== null)

  // Сравнивать Брайер с 0.25 бессмысленно: B1 стоит на 55-м перцентиле, то
  // есть берётся примерно в половине смен, и для такого события даже идеально
  // калиброванная модель даёт около 0.247. Осмысленный ориентир один — модель
  // обязана быть не хуже «всегда называю среднюю частоту».
  const baseRate = result.b1Calibration.filter((p) => p.happened).length / result.b1Calibration.length
  const climatology =
    result.b1Calibration.reduce((sum, p) => sum + (baseRate - (p.happened ? 1 : 0)) ** 2, 0) /
    result.b1Calibration.length

  assert.ok(
    calibrated.brierScore! <= climatology + 0.02,
    `Брайер ${calibrated.brierScore} против ${climatology.toFixed(4)} у «всегда средняя частота» — модель хуже, чем ничего`,
  )
  for (const bucket of calibrated.buckets) {
    assert.ok(bucket.observed >= 0 && bucket.observed <= 1)
    assert.ok(bucket.count > 0)
  }
})

test('пустая история не ломает ничего', () => {
  const result = walkForward([], OPTS)
  assert.equal(result.demandPoints.length, 0)
  const comparison = compareModels(result.demandPoints)
  assert.equal(comparison.v1.mae, null)
  assert.equal(comparison.verdict.winner, 'tie')
  assert.equal(calibration([]).brierScore, null)
})
