import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  distributeAmountByWeights,
  resolveSeniorityPercent,
  fullMonthsBetween,
} from '@/lib/domain/salary'

const round2 = (n: number) => Math.round(n * 100) / 100
const roundedSum = (m: Map<string, number>) => round2([...m.values()].reduce((a, b) => a + b, 0))

// ─── distributeAmountByWeights: разнос суммы по весам (зарплата по точкам) ───

test('distribute: равные веса делят поровну', () => {
  const r = distributeAmountByWeights(100, [
    { key: 'a', weight: 1 },
    { key: 'b', weight: 1 },
  ])
  assert.equal(r.get('a'), 50)
  assert.equal(r.get('b'), 50)
})

test('distribute: ИНВАРИАНТ — сумма частей == исходной (деньги не теряются и не плодятся)', () => {
  for (const amount of [100, 10, 999.99, 1, 33.33, 7, 250000]) {
    const r = distributeAmountByWeights(amount, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 2 },
      { key: 'c', weight: 1 },
    ])
    assert.equal(roundedSum(r), round2(amount), `amount=${amount}`)
  }
})

test('distribute: остаток округления распределяется, сумма ровная (10 на троих)', () => {
  const r = distributeAmountByWeights(10, [
    { key: 'a', weight: 1 },
    { key: 'b', weight: 1 },
    { key: 'c', weight: 1 },
  ])
  assert.equal(roundedSum(r), 10)
  assert.deepEqual([...r.values()].sort((x, y) => x - y), [3.33, 3.33, 3.34])
})

test('distribute: нулевая сумма → пустая карта', () => {
  assert.equal(distributeAmountByWeights(0, [{ key: 'a', weight: 1 }]).size, 0)
})

test('distribute: нулевые веса → всё первому (ничего не теряется)', () => {
  const r = distributeAmountByWeights(100, [
    { key: 'a', weight: 0 },
    { key: 'b', weight: 0 },
  ])
  assert.equal(r.get('a'), 100)
  assert.equal(roundedSum(r), 100)
})

// ─── resolveSeniorityPercent: надбавка за стаж ───

const tier = (min_months: number, bonus_percent: number, effective_from = '2020-01-01', is_active = true) => ({
  min_months,
  bonus_percent,
  effective_from,
  is_active,
})

test('стаж: нет тиров → 0', () => {
  assert.equal(resolveSeniorityPercent([], '2020-01-01', '2026-01-01'), 0)
  assert.equal(resolveSeniorityPercent(undefined, '2020-01-01', '2026-01-01'), 0)
})

test('стаж: подходящий тир → его процент', () => {
  assert.equal(resolveSeniorityPercent([tier(6, 5)], '2025-01-01', '2026-01-01'), 5)
})

test('стаж: жёсткий потолок 15% (намеренный — UI это тоже запрещает)', () => {
  assert.equal(resolveSeniorityPercent([tier(6, 20)], '2024-01-01', '2026-01-01'), 15)
})

test('стаж: берётся ТОП-тир по min_months среди подходящих', () => {
  const tiers = [tier(3, 3), tier(12, 8), tier(24, 12)]
  // стаж ~19 мес → подходят тиры 3 и 12, берётся 12 → 8%
  assert.equal(resolveSeniorityPercent(tiers, '2024-06-01', '2026-01-01'), 8)
})

test('стаж: тир с будущей датой вступления НЕ применяется (нет ретроактива)', () => {
  assert.equal(resolveSeniorityPercent([tier(6, 10, '2099-01-01')], '2020-01-01', '2026-01-01'), 0)
})

test('стаж: нет даты найма → 0', () => {
  assert.equal(resolveSeniorityPercent([tier(0, 5)], null, '2026-01-01'), 0)
})

test('стаж: неактивный тир игнорируется', () => {
  assert.equal(resolveSeniorityPercent([tier(0, 5, '2020-01-01', false)], '2024-01-01', '2026-01-01'), 0)
})

// ─── fullMonthsBetween: целых месяцев между датами (для стажа) ───

test('месяцы: тот же месяц → 0', () => {
  assert.equal(fullMonthsBetween('2026-01-01', '2026-01-20'), 0)
})

test('месяцы: ровно месяц → 1', () => {
  assert.equal(fullMonthsBetween('2026-01-10', '2026-02-10'), 1)
})

test('месяцы: день конца меньше дня начала → месяц не засчитан', () => {
  assert.equal(fullMonthsBetween('2026-01-15', '2026-02-10'), 0)
})

test('месяцы: конец раньше начала → 0', () => {
  assert.equal(fullMonthsBetween('2026-03-01', '2026-01-01'), 0)
})

test('месяцы: невалидные даты → 0 (не падает)', () => {
  assert.equal(fullMonthsBetween('abc', '2026-01-01'), 0)
  assert.equal(fullMonthsBetween('2026-01-01', null), 0)
})
