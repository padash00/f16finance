import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysISO,
  addMonthsClamped,
  buildSeriesRows,
  isDateInSeriesPeriod,
  splitPeriodAmount,
  seriesPeriodLabel,
  SERIES_MAX_PERIODS,
} from '@/lib/domain/expense-series'

// ─── addMonthsClamped: месяц не должен «перепрыгивать» ───
test('addMonthsClamped: 31 января + 1 месяц → конец февраля, а не март', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29') // високосный
})

test('addMonthsClamped: обычный день сохраняется', () => {
  assert.equal(addMonthsClamped('2026-03-01', 5), '2026-08-01')
  assert.equal(addMonthsClamped('2026-03-15', 1), '2026-04-15')
})

test('addMonthsClamped: отрицательное смещение уходит через границу года', () => {
  assert.equal(addMonthsClamped('2026-01-01', -1), '2025-12-01')
  assert.equal(addMonthsClamped('2026-08-01', -5), '2026-03-01')
})

test('addMonthsClamped: мусор на входе не роняет расчёт', () => {
  assert.equal(addMonthsClamped('', 1), '')
  assert.equal(addMonthsClamped('не-дата', 1), 'не-дата')
})

// ─── addDaysISO ───
test('addDaysISO: переход через конец месяца и года', () => {
  assert.equal(addDaysISO('2026-02-26', 6), '2026-03-04')
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28')
})

// ─── buildSeriesRows: главный кейс — налог за полгода ───
test('buildSeriesRows: 6 месяцев от марта → март…август, сумма в каждом периоде', () => {
  const rows = buildSeriesRows('2026-03-01', 'month', 6, 60000, 0)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map((r) => r.date), [
    '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01',
  ])
  assert.equal(rows.every((r) => r.amount_cash === 60000 && r.amount_kaspi === 0), true)
  assert.equal(rows[0].label, 'март 2026')
  assert.equal(rows[5].label, 'август 2026')
})

test('buildSeriesRows: квартал шагает по 3 месяца, неделя — по 7 дней', () => {
  const quarters = buildSeriesRows('2026-01-01', 'quarter', 4, 0, 1000)
  assert.deepEqual(quarters.map((r) => r.date), ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
  assert.deepEqual(quarters.map((r) => r.label), ['1 кв. 2026', '2 кв. 2026', '3 кв. 2026', '4 кв. 2026'])

  const weeks = buildSeriesRows('2026-03-02', 'week', 3, 500, 0)
  assert.deepEqual(weeks.map((r) => r.date), ['2026-03-02', '2026-03-09', '2026-03-16'])
})

test('buildSeriesRows: количество периодов ограничено потолком', () => {
  assert.equal(buildSeriesRows('2026-01-01', 'month', 100, 1, 0).length, SERIES_MAX_PERIODS)
  assert.equal(buildSeriesRows('2026-01-01', 'month', -5, 1, 0).length, 0)
})

// ─── isDateInSeriesPeriod: защита от задвоенного налога ───
test('isDateInSeriesPeriod: месяц — совпадение по месяцу, не по дню', () => {
  assert.equal(isDateInSeriesPeriod('2026-03-28', '2026-03-01', 'month'), true)
  assert.equal(isDateInSeriesPeriod('2026-04-01', '2026-03-01', 'month'), false)
})

test('isDateInSeriesPeriod: квартал накрывает три месяца', () => {
  assert.equal(isDateInSeriesPeriod('2026-05-31', '2026-03-01', 'quarter'), true)
  assert.equal(isDateInSeriesPeriod('2026-06-01', '2026-03-01', 'quarter'), false)
  assert.equal(isDateInSeriesPeriod('2026-02-28', '2026-03-01', 'quarter'), false)
})

test('isDateInSeriesPeriod: неделя — 7 дней включительно', () => {
  assert.equal(isDateInSeriesPeriod('2026-03-08', '2026-03-02', 'week'), true)
  assert.equal(isDateInSeriesPeriod('2026-03-09', '2026-03-02', 'week'), false)
  assert.equal(isDateInSeriesPeriod('', '2026-03-02', 'week'), false)
})

// ─── splitPeriodAmount: деньги не должны теряться при правке суммы ───
test('splitPeriodAmount: только наличные / только безнал', () => {
  assert.deepEqual(splitPeriodAmount(5000, 1000, 0), { amount_cash: 5000, amount_kaspi: 0 })
  assert.deepEqual(splitPeriodAmount(5000, 0, 1000), { amount_cash: 0, amount_kaspi: 5000 })
})

test('splitPeriodAmount: смешанная оплата делится по пропорции карточки без потери копеек', () => {
  const split = splitPeriodAmount(1000, 300, 700)
  assert.deepEqual(split, { amount_cash: 300, amount_kaspi: 700 })

  const odd = splitPeriodAmount(1001, 1, 2)
  assert.equal(odd.amount_cash + odd.amount_kaspi, 1001)
})

test('splitPeriodAmount: отрицательное и мусорное значение → 0', () => {
  assert.deepEqual(splitPeriodAmount(-100, 1000, 0), { amount_cash: 0, amount_kaspi: 0 })
  assert.deepEqual(splitPeriodAmount(Number.NaN, 1000, 0), { amount_cash: 0, amount_kaspi: 0 })
})

test('seriesPeriodLabel: неделя подписана датой начала', () => {
  assert.equal(seriesPeriodLabel('2026-03-02', 'week'), 'неделя с 02.03.2026')
})
