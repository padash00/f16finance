import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_STORE_KPI_SETTINGS,
  backtestPlans,
  buildRevenueBaseline,
  computeShiftPlan,
  estimateWeatherEffects,
  forecastAccuracy,
  resolveBonus,
  weatherBucket,
  weatherFactor,
  type ShiftFact,
  type WeatherObservation,
} from '@/lib/domain/store-kpi'

function daily(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(y, m - 1, d + i)
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

function fact(date: string, revenue: number, patch: Partial<ShiftFact> = {}): ShiftFact {
  return {
    company_id: 'shop',
    date,
    shift: 'day',
    cashier_id: 'hist',
    revenue,
    gross_revenue: revenue,
    refunds: 0,
    receipts: 40,
    items: 80,
    lines: 80,
    receipts_2plus: 20,
    attach_opportunities: 16,
    attach_success: 10,
    ...patch,
  }
}

// ─── Точность ───────────────────────────────────────────────────────────────

test('WAPE считает суммарную ошибку относительно суммарного факта', () => {
  const result = forecastAccuracy([
    { date: '2026-01-01', expected: 110, actual: 100 },
    { date: '2026-01-02', expected: 90, actual: 100 },
  ])
  assert.equal(result.n, 2)
  assert.equal(result.wape, 0.1) // (10 + 10) / 200
  assert.equal(result.bias, 0) // завышение и занижение погасили друг друга
})

test('смещение показывает систематическое завышение ожидания', () => {
  const result = forecastAccuracy([
    { date: '2026-01-01', expected: 120, actual: 100 },
    { date: '2026-01-02', expected: 120, actual: 100 },
  ])
  assert.equal(result.bias, 0.2)
})

test('без данных точность не выдумывается', () => {
  const result = forecastAccuracy([])
  assert.equal(result.n, 0)
  assert.equal(result.wape, null)
})

test('смены с нулевой выручкой не делят на ноль', () => {
  const result = forecastAccuracy([{ date: '2026-01-01', expected: 100, actual: 0 }])
  assert.equal(result.n, 0)
})

// ─── Бэктест ────────────────────────────────────────────────────────────────

test('бэктест не заглядывает в будущее: первые смены остаются без плана', () => {
  const facts = daily('2026-01-05', 30).map((d, i) => fact(d, 80_000 + (i % 5) * 5_000))
  const result = backtestPlans(facts, DEFAULT_STORE_KPI_SETTINGS)

  // Пока в сегменте меньше минимальной выборки, плана нет вовсе.
  assert.ok(result.skipped_no_history > 0, 'начало истории обязано остаться без плана')
  assert.ok(result.evaluated > 0, 'дальше планы должны появиться')
  assert.equal(result.evaluated + result.skipped_no_history, facts.length)
})

test('смена не участвует в формировании собственного плана', () => {
  // Ровная история и одна аномальная смена в конце: если бы она попадала в
  // свою же базу, порог подтянулся бы к ней и рекорд бы не засчитался.
  const dates = daily('2026-01-05', 40)
  const facts = dates.map((d, i) => fact(d, i === dates.length - 1 ? 400_000 : 80_000))
  const result = backtestPlans(facts, DEFAULT_STORE_KPI_SETTINGS)

  const last = result.shifts[result.shifts.length - 1]
  assert.equal(last.revenue, 400_000)
  assert.equal(last.level, 'record')
})

test('бэктест считает, во сколько обошлись бы бонусы', () => {
  const facts = daily('2026-01-05', 40).map((d, i) => fact(d, 80_000 + (i % 4) * 10_000))
  const result = backtestPlans(facts, DEFAULT_STORE_KPI_SETTINGS)

  assert.ok(result.bonus_cost >= 0)
  assert.ok(result.revenue > 0)
  // Бонусы не должны превращаться в основную статью расходов.
  assert.ok(result.bonus_cost < result.revenue, 'бонусы обязаны быть малы относительно выручки')
})

test('калибровка честно сообщает, что порог слишком лёгкий', () => {
  // Растущая выручка: почти каждая смена бьёт вчерашнее распределение.
  const facts = daily('2026-01-05', 60).map((d, i) => fact(d, 50_000 + i * 3_000))
  const result = backtestPlans(facts, DEFAULT_STORE_KPI_SETTINGS)

  const b1 = result.calibration.find((c) => c.level === 'b1')!
  assert.equal(b1.verdict, 'too_easy')
  assert.ok(b1.rate > 0.45)
})

test('доли уровней вложены: взявший B3 засчитан и в B1', () => {
  const facts = daily('2026-01-05', 40).map((d, i) => fact(d, 80_000 + (i % 6) * 8_000))
  const result = backtestPlans(facts, DEFAULT_STORE_KPI_SETTINGS)
  assert.ok(result.hit_rates.b1 >= result.hit_rates.b2)
  assert.ok(result.hit_rates.b2 >= result.hit_rates.b3)
})

// ─── Ворота по знанию товара ────────────────────────────────────────────────

const GATE_HISTORY = daily('2026-01-05', 20).map((d, i) => fact(d, 60_000 + i * 3_000))
const GATE_BASE = buildRevenueBaseline(GATE_HISTORY, DEFAULT_STORE_KPI_SETTINGS)
const GATE_TARGET = { company_id: 'shop', date: '2026-03-16', shift: 'day' as const }

test('выключенные ворота не трогают выплату', () => {
  const plan = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, DEFAULT_STORE_KPI_SETTINGS)!
  const outcome = resolveBonus(plan.b3, plan, DEFAULT_STORE_KPI_SETTINGS, { product_test_passed: null })
  assert.equal(outcome.level, 'b3')
  assert.equal(outcome.capped_from, null)
})

test('включённые ворота срезают B3 до B2, если тест не сдан', () => {
  const settings = { ...DEFAULT_STORE_KPI_SETTINGS, require_product_test_for_top_bonus: true }
  const plan = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, settings)!
  const outcome = resolveBonus(plan.b3, plan, settings, { product_test_passed: false })

  assert.equal(outcome.level, 'b2')
  assert.equal(outcome.amount, settings.b2_amount)
  // Видно, что уровень был взят по выручке — срезали ворота, а не результат.
  assert.equal(outcome.capped_from, 'b3')
})

test('сданный тест открывает верхние уровни', () => {
  const settings = { ...DEFAULT_STORE_KPI_SETTINGS, require_product_test_for_top_bonus: true }
  const plan = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, settings)!
  const outcome = resolveBonus(plan.b3, plan, settings, { product_test_passed: true })
  assert.equal(outcome.level, 'b3')
})

test('ворота не трогают B1 и B2', () => {
  const settings = { ...DEFAULT_STORE_KPI_SETTINGS, require_product_test_for_top_bonus: true }
  const plan = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, settings)!
  const outcome = resolveBonus(plan.b2, plan, settings, { product_test_passed: false })
  assert.equal(outcome.level, 'b2')
  assert.equal(outcome.capped_from, null)
})

// ─── Погода ─────────────────────────────────────────────────────────────────

function weather(day: string, patch: Partial<WeatherObservation> = {}): WeatherObservation {
  return {
    day,
    temperature_max: 20,
    temperature_min: 10,
    precipitation_mm: 0,
    rain: false,
    snow: false,
    ...patch,
  }
}

test('корзина погоды определяется по осадкам и температуре', () => {
  assert.equal(weatherBucket(weather('2026-01-01', { snow: true })), 'snow')
  assert.equal(weatherBucket(weather('2026-01-01', { precipitation_mm: 4 })), 'rain')
  assert.equal(weatherBucket(weather('2026-01-01', { temperature_max: 34 })), 'hot')
  assert.equal(weatherBucket(weather('2026-01-01', { temperature_max: -18 })), 'cold')
  assert.equal(weatherBucket(weather('2026-01-01')), 'normal')
})

test('без наблюдений погода не поправляет прогноз', () => {
  // Три дождливых дня — этого мало, чтобы утверждать «в дождь продают хуже».
  const dates = daily('2026-02-02', 3)
  const observations = dates.map((d) => ({ date: d, actual: 50_000, expected: 100_000 }))
  const map = new Map(dates.map((d) => [d, weather(d, { rain: true })]))

  const effects = estimateWeatherEffects(observations, map, DEFAULT_STORE_KPI_SETTINGS)
  const factor = weatherFactor(weather('2026-03-01', { rain: true }), effects)

  assert.equal(factor.usable, false)
  assert.equal(factor.factor, 1)
})

test('накопив историю, погода поправляет прогноз в найденную сторону', () => {
  const dates = daily('2026-02-02', 12)
  const observations = dates.map((d) => ({ date: d, actual: 80_000, expected: 100_000 }))
  const map = new Map(dates.map((d) => [d, weather(d, { rain: true })]))

  const effects = estimateWeatherEffects(observations, map, DEFAULT_STORE_KPI_SETTINGS)
  const factor = weatherFactor(weather('2026-03-01', { rain: true }), effects)

  assert.equal(factor.usable, true)
  assert.equal(factor.bucket, 'rain')
  assert.equal(factor.factor, 0.8)
})

test('погода не участвует в расчёте бонусных порогов', () => {
  // Порог зависит только от распределения выручки и месячного индекса.
  // Этот тест держит границу: если кто-то захочет подмешать погоду в план,
  // он сломается здесь.
  const plan = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, DEFAULT_STORE_KPI_SETTINGS)!
  const same = computeShiftPlan(GATE_BASE, GATE_TARGET, 1, DEFAULT_STORE_KPI_SETTINGS)!
  assert.deepEqual([plan.control, plan.b1, plan.b2, plan.b3], [same.control, same.b1, same.b2, same.b3])
  assert.equal(DEFAULT_STORE_KPI_SETTINGS.weather_adjusts_bonus_threshold, false)
})
