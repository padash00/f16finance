import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysISO,
  addMonthsClamped,
  buildSeriesRows,
  isDateInSeriesPeriod,
  matchExistingExpenses,
  splitPeriodAmount,
  splitTotalAcrossPeriods,
  seriesMaxPeriods,
  seriesPeriodLabel,
  seriesPresets,
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

// ─── По дням ───
test('buildSeriesRows: день шагает по одному дню через конец месяца', () => {
  const days = buildSeriesRows('2026-08-30', 'day', 4, 1500, 0)
  assert.deepEqual(days.map((r) => r.date), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  assert.equal(days.every((r) => r.amount_cash === 1500), true)
})

test('seriesPeriodLabel: день подписан датой и днём недели', () => {
  // 17.09.2026 — четверг
  assert.equal(seriesPeriodLabel('2026-09-17', 'day'), '17.09.2026, чт')
  assert.equal(seriesPeriodLabel('2026-09-20', 'day'), '20.09.2026, вс')
})

test('seriesMaxPeriods: дней до 31, остальных периодов до 24', () => {
  assert.equal(seriesMaxPeriods('day'), 31)
  assert.equal(seriesMaxPeriods('week'), SERIES_MAX_PERIODS)
  assert.equal(buildSeriesRows('2026-08-01', 'day', 100, 1, 0).length, 31)
})

// ─── Общая сумма на все периоды ───
test('splitTotalAcrossPeriods: делит поровну, остаток — в последний период', () => {
  assert.deepEqual(splitTotalAcrossPeriods(84_000, 6), [14_000, 14_000, 14_000, 14_000, 14_000, 14_000])
  assert.deepEqual(splitTotalAcrossPeriods(100_000, 3), [33_333, 33_333, 33_334])
  assert.equal(splitTotalAcrossPeriods(100_001, 7).reduce((s, v) => s + v, 0), 100_001)
  assert.deepEqual(splitTotalAcrossPeriods(500, 0), [])
})

// ─── Быстрые даты ───
test('seriesPresets: по дням — неделя с понедельника, с 1-го числа, прошлый месяц', () => {
  // 17.09.2026 — четверг
  const presets = seriesPresets('day', '2026-09-17')
  const byKey = Object.fromEntries(presets.map((p) => [p.key, p]))
  assert.deepEqual(byKey['this-week'], { key: 'this-week', label: 'Эта неделя', start: '2026-09-14', count: 4 })
  assert.deepEqual(byKey['this-month'], { key: 'this-month', label: 'С 1-го числа', start: '2026-09-01', count: 17 })
  assert.deepEqual(byKey['last-month'], { key: 'last-month', label: 'Прошлый месяц', start: '2026-08-01', count: 31 })
})

test('seriesPresets: вариант меньше двух периодов не предлагается', () => {
  // 01.09.2026 — вторник: «с 1-го числа» дал бы один день
  assert.equal(seriesPresets('day', '2026-09-01').some((p) => p.key === 'this-month'), false)
  // январь: «с января» — один месяц
  assert.equal(seriesPresets('month', '2026-01-20').some((p) => p.key === 'this-year'), false)
})

test('seriesPresets: месяцы и кварталы', () => {
  const months = Object.fromEntries(seriesPresets('month', '2026-09-17').map((p) => [p.key, p]))
  assert.equal(months['this-year'].start, '2026-01-01')
  assert.equal(months['this-year'].count, 9)
  assert.equal(months['last-6'].start, '2026-04-01')
  const quarters = Object.fromEntries(seriesPresets('quarter', '2026-09-17').map((p) => [p.key, p]))
  assert.equal(quarters['this-year'].count, 3)
  assert.equal(quarters['last-4'].start, '2025-10-01')
})

// ─── Что уже лежит в периоде ───
test('matchExistingExpenses: показывает расходы периода, та же сумма — признак дубля', () => {
  const existing = [
    { id: 'a', date: '2026-08-11', cash_amount: 14_000, kaspi_amount: 0, comment: 'Аренда', status: 'approved' },
    { id: 'b', date: '2026-08-12', cash_amount: 3_000, kaspi_amount: 500, comment: 'Вода', status: null },
    { id: 'c', date: '2026-08-13', cash_amount: 14_000, kaspi_amount: 0, comment: 'Отклонён', status: 'declined' },
    { id: 'd', date: '2026-08-20', cash_amount: 14_000, kaspi_amount: 0, comment: 'Другая неделя', status: null },
  ]
  const match = matchExistingExpenses(existing, '2026-08-10', 'week', 14_000)
  assert.deepEqual(match.items.map((i) => i.id), ['a', 'b'])
  assert.equal(match.sameAmountCount, 1)
  assert.equal(match.items[0].sameAmount, true)
  assert.equal(match.items[1].amount, 3_500)
})

test('isDateInSeriesPeriod: день — только тот же день', () => {
  assert.equal(isDateInSeriesPeriod('2026-09-17', '2026-09-17', 'day'), true)
  assert.equal(isDateInSeriesPeriod('2026-09-18', '2026-09-17', 'day'), false)
})
