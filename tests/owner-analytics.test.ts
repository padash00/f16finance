import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregatePos,
  bucketIndex,
  bucketStart,
  buildExpenseCategories,
  buildOperators,
  buildSeries,
  buildWeekdays,
  comparisonRange,
  pickGroup,
  posCompareWindow,
  weekdayIndex,
} from '@/lib/domain/owner-analytics'

const income = (date: string, amount: number, over: Record<string, unknown> = {}) => ({
  id: `${date}-${amount}`,
  date,
  company_id: 'c1',
  operator_id: 'op1',
  cash_amount: amount,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
  ...over,
})

const expense = (date: string, amount: number, category = 'Аренда') => ({
  date,
  company_id: 'c1',
  category,
  cash_amount: amount,
  kaspi_amount: 0,
})

test('база сравнения: прошлый период той же длины и тот же период годом раньше', () => {
  assert.deepEqual(comparisonRange('2026-09-08', '2026-09-14', 'prev'), { prevFrom: '2026-09-01', prevTo: '2026-09-07' })
  assert.deepEqual(comparisonRange('2026-09-01', '2026-09-30', 'year'), { prevFrom: '2025-09-01', prevTo: '2025-09-30' })
  // Целый месяц — с прошлым календарным месяцем, квартал — с прошлым кварталом
  assert.deepEqual(comparisonRange('2026-09-01', '2026-09-30', 'prev'), { prevFrom: '2026-08-01', prevTo: '2026-08-31' })
  assert.deepEqual(comparisonRange('2026-03-01', '2026-03-31', 'prev'), { prevFrom: '2026-02-01', prevTo: '2026-02-28' })
  assert.deepEqual(comparisonRange('2026-07-01', '2026-09-30', 'prev'), { prevFrom: '2026-04-01', prevTo: '2026-06-30' })
  assert.deepEqual(comparisonRange('2026-01-01', '2026-12-31', 'prev'), { prevFrom: '2025-01-01', prevTo: '2025-12-31' })
  // 29 февраля → 28-е
  assert.deepEqual(comparisonRange('2028-02-29', '2028-02-29', 'year'), { prevFrom: '2027-02-28', prevTo: '2027-02-28' })
})

test('шаг графика зависит от длины периода', () => {
  assert.equal(pickGroup('2026-09-01', '2026-09-30'), 'day')
  assert.equal(pickGroup('2026-07-01', '2026-09-30'), 'week')
  assert.equal(pickGroup('2026-01-01', '2026-12-31'), 'month')
})

test('столбики месяца считаются от начала своего периода', () => {
  assert.equal(bucketIndex('2026-07-15', '2026-09-01', 'month'), 2)
  assert.equal(bucketStart('2026-07-15', 0, 'month'), '2026-07-15')
  assert.equal(bucketStart('2026-07-15', 2, 'month'), '2026-09-01')
  assert.equal(bucketStart('2026-11-01', 2, 'month'), '2027-01-01')
})

test('график: дни без выручки — нули, будущие дни не рисуются, база обрезана той же длиной', () => {
  const series = buildSeries({
    incomes: [income('2026-09-01', 100), income('2026-09-03', 50), income('2026-08-02', 70), income('2026-08-20', 999)],
    expenses: [expense('2026-09-01', 30)],
    from: '2026-09-01',
    to: '2026-09-30',
    prevFrom: '2026-08-01',
    prevTo: '2026-08-03',
    group: 'day',
    through: '2026-09-03',
  })
  assert.equal(series.length, 3)
  assert.deepEqual(series.map((p) => p.revenue), [100, 0, 50])
  assert.deepEqual(series.map((p) => p.prevRevenue), [0, 70, 0])
  assert.equal(series[0].profit, 70)
  assert.equal(series[1].prevDate, '2026-08-02')
})

test('дни недели: среднее делится на все такие дни периода, включая пустые', () => {
  // 2026-09-07 и 2026-09-14 — понедельники
  assert.equal(weekdayIndex('2026-09-07'), 0)
  const days = buildWeekdays({ incomes: [income('2026-09-07', 1000)], from: '2026-09-07', to: '2026-09-20' })
  assert.equal(days[0].days, 2)
  assert.equal(days[0].average, 500)
  assert.equal(days[6].average, 0)
})

test('статьи расходов с базой сравнения, крупные сверху', () => {
  const rows = buildExpenseCategories({
    expenses: [expense('2026-09-02', 100, 'Аренда'), expense('2026-09-03', 300, 'Товар'), expense('2026-08-02', 80, 'Аренда')],
    from: '2026-09-01',
    to: '2026-09-30',
    prevFrom: '2026-08-01',
    prevTo: '2026-08-30',
  })
  assert.deepEqual(rows.map((r) => r.name), ['Товар', 'Аренда'])
  assert.equal(rows[1].prevAmount, 80)
})

test('операторы: хвост ночного безнала не считается сменой, выручка без оператора — отдельно', () => {
  const { rows, unattributed } = buildOperators({
    incomes: [
      income('2026-09-01', 1000),
      income('2026-09-02', 500, { id: 'x:kaspi-next-day' }),
      income('2026-09-02', 300, { operator_id: null }),
    ],
    from: '2026-09-01',
    to: '2026-09-30',
    prevFrom: '2026-08-01',
    prevTo: '2026-08-30',
    operatorName: () => 'Айгерим',
  })
  assert.equal(rows[0].revenue, 1500)
  assert.equal(rows[0].shifts, 1)
  assert.equal(rows[0].perShift, 1500)
  assert.equal(unattributed, 300)
})

test('касса: час и день недели по Алматы, прибыль неизвестна без закупочной цены', () => {
  const pos = aggregatePos([
    // 2026-09-07 19:30 UTC = понедельник, 00:30 вторника по Алматы
    {
      sold_at: '2026-09-07T19:30:00Z',
      total_amount: 1000,
      cash_amount: 1000,
      items: [{ quantity: 2, total_price: 1000, inventory_items: { name: 'Кола', default_purchase_price: 200 } }],
    },
    { sold_at: '2026-09-08T05:00:00Z', total_amount: 500, kaspi_amount: 500, items: [{ quantity: 1, total_price: 500, universal_name: 'Услуга' }] },
  ])
  assert.equal(pos.receipts, 2)
  assert.equal(pos.avgCheck, 750)
  assert.equal(pos.heatmap[1][0], 1000)
  assert.equal(pos.heatmap[1][10], 500)
  assert.equal(pos.grossProfit, null)
  assert.equal(pos.topItems[0].name, 'Кола')
  assert.equal(pos.topItems[0].profit, 600)
  assert.equal(pos.topItems[1].profit, null)
})

test('касса: сегодня сравнивается с тем же часом вчера, а не с целыми сутками', () => {
  // 10:00 по Алматы = 05:00 UTC
  const now = new Date('2026-09-22T05:00:00Z')
  const w = posCompareWindow({ from: '2026-09-22', to: '2026-09-22', prevFrom: '2026-09-21', prevTo: '2026-09-21', now })
  assert.equal(w.truncated, true)
  assert.equal(w.previous.from, '2026-09-20T19:00:00.000Z')
  assert.equal(w.previous.to, '2026-09-21T05:00:00.000Z')
  assert.equal(w.current.to, now.toISOString())

  const past = posCompareWindow({ from: '2026-09-01', to: '2026-09-07', prevFrom: '2026-08-25', prevTo: '2026-08-31', now })
  assert.equal(past.truncated, false)
  assert.equal(past.previous.to, '2026-08-31T19:00:00.000Z')
})
