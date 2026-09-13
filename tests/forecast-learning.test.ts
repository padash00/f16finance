import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMonthPoints,
  evaluateInside,
  learnForecast,
  quantile,
  shiftMonth,
  type MonthPoint,
} from '@/lib/analysis/forecast-learning'

const series = (start: string, incomes: number[], expenseShare = 0.6): MonthPoint[] =>
  incomes.map((income, i) => ({ month: shiftMonth(start, i), income, expense: Math.round(income * expenseShare) }))

// ─── Мелочи ────────────────────────────────────────────────────────────────

test('квантиль с интерполяцией', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(quantile([10, 20], 0.5), 15)
  assert.equal(quantile([7], 0.9), 7)
})

test('сдвиг месяца через границу года', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2025-12', 1), '2026-01')
  assert.equal(shiftMonth('2026-09', -12), '2025-09')
})

test('коридор расхода: пессимистичный — верхняя граница', () => {
  const inside = evaluateInside(
    {
      pessimistic: { income: 80, expense: 70, profit: 0 },
      realistic: { income: 100, expense: 60, profit: 40 },
      optimistic: { income: 120, expense: 50, profit: 70 },
    },
    { income: 90, expense: 65, profit: 25 },
  )
  assert.deepEqual(inside, { income: true, expense: true, profit: true })
})

// ─── Данные ────────────────────────────────────────────────────────────────

test('точки месяцев: текущий месяц и разовые расходы не входят, статья из справочника важнее названия', () => {
  const points = buildMonthPoints(
    [
      { date: '2026-07-10', cash: 100_000 },
      { date: '2026-08-10', cash: 120_000 },
      { date: '2026-09-02', cash: 50_000 }, // текущий месяц
    ],
    [
      { date: '2026-07-11', category: 'Аренда', cash: 40_000 },
      { date: '2026-07-12', category: 'Покупка оборудования', cash: 300_000 }, // CAPEX — разовый
      { date: '2026-08-12', category: 'Ремонт зала', cash: 10_000 }, // в справочнике — разовый
    ],
    { 'ремонт зала': 'non_operating' },
    '2026-09',
  )
  assert.deepEqual(points, [
    { month: '2026-07', income: 100_000, expense: 40_000 },
    { month: '2026-08', income: 120_000, expense: 0 },
  ])
})

// ─── Обучение ──────────────────────────────────────────────────────────────

test('модель снимает перекос: ряд стабильно растёт — прогноз поднимается выше простого среднего', () => {
  // +5% каждый месяц: «среднее за 3» всегда отстаёт, модель должна это заметить
  const incomes = Array.from({ length: 18 }, (_, i) => Math.round(1_000_000 * 1.05 ** i))
  const learned = learnForecast(series('2025-01', incomes), '2026-07')
  const lastActual = incomes[incomes.length - 1]
  assert.ok(learned.scenarios)
  assert.ok(learned.scenarios.realistic.income > lastActual, 'прогноз выше последнего месяца растущего ряда')
  const avg3 = (incomes.at(-1)! + incomes.at(-2)! + incomes.at(-3)!) / 3
  assert.ok(learned.scenarios.realistic.income > avg3 * 1.05)
})

test('сезонный бизнес: вес сезонности растёт, ошибка снижается', () => {
  // Два года с сильным летним провалом: летом доход вдвое ниже
  const pattern = [100, 100, 100, 100, 100, 50, 50, 50, 100, 100, 100, 100]
  const incomes = [...pattern, ...pattern, ...pattern.slice(0, 8)].map((v) => v * 10_000)
  const learned = learnForecast(series('2024-01', incomes), '2026-09')
  const weights = learned.calibration!.weights.income
  const seasonal = weights.seasonal || 0
  for (const [method, w] of Object.entries(weights)) {
    if (method !== 'seasonal') assert.ok(seasonal >= (w || 0), `сезонность (${seasonal}) не легче ${method} (${w})`)
  }
  // Сентябрь после летнего провала — сезонная модель ждёт возврата к 100
  assert.ok(learned.scenarios!.realistic.income > 800_000)
})

test('коридор по ошибкам: факт попадает в него в большинстве месяцев', () => {
  // Шум ±10% вокруг стабильного уровня
  const noise = [1, 1.1, 0.92, 1.05, 0.9, 1.08, 0.95, 1.1, 0.93, 1.02, 0.97, 1.09, 0.91, 1.04, 0.96, 1.07, 0.94, 1.03, 0.99, 1.06]
  const learned = learnForecast(series('2025-01', noise.map((k) => Math.round(1_000_000 * k))), '2026-09')
  assert.equal(learned.calibration!.corridor.income.source, 'errors')
  const { inside, total } = learned.accuracy.coverage.income
  assert.ok(total >= 8)
  assert.ok(inside / total >= 0.6, `попаданий ${inside} из ${total}`)
  // Сценарии упорядочены
  const s = learned.scenarios!
  assert.ok(s.pessimistic.income <= s.realistic.income && s.realistic.income <= s.optimistic.income)
  assert.ok(s.optimistic.expense <= s.realistic.expense && s.realistic.expense <= s.pessimistic.expense)
  assert.ok(s.pessimistic.profit <= s.realistic.profit && s.realistic.profit <= s.optimistic.profit)
})

test('сверка идёт только по прошлому: прогноз месяца не видит его факта', () => {
  const incomes = [100, 100, 100, 100, 1000].map((v) => v * 1000)
  const learned = learnForecast(series('2026-01', incomes), '2026-06')
  const may = learned.backtest.find((r) => r.month === '2026-05')!
  // Если бы модель подглядывала, прогноз мая был бы близок к 1 000 000
  assert.ok(may.scenarios.realistic.income < 200_000)
  assert.ok((may.error.income ?? 0) > 0.8)
})

test('мало данных: прогноз есть, сверок нет, коридор по разбросу', () => {
  const learned = learnForecast(series('2026-06', [900_000, 1_000_000]), '2026-09')
  assert.ok(learned.scenarios)
  assert.equal(learned.backtest.length, 0)
  assert.equal(learned.calibration!.corridor.income.source, 'volatility')
})
