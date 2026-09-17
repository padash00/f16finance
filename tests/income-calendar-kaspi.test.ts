import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { sumIncomeExpenseInRange } from '@/lib/reports/sum-range-totals'

const row = (over: Partial<ReportIncomeCalendarRow>): ReportIncomeCalendarRow => ({
  id: 'i1',
  date: '2026-09-15',
  company_id: 'c1',
  shift: 'night',
  zone: null,
  cash_amount: 0,
  kaspi_amount: 0,
  kaspi_before_midnight: null,
  online_amount: 0,
  card_amount: 0,
  comment: null,
  ...over,
})

test('дневная смена не разбивается', () => {
  const out = splitIncomeKaspiByCalendarDay([row({ shift: 'day', kaspi_amount: 50_000 })])
  assert.equal(out.length, 1)
  assert.equal(out[0].kaspi_amount, 50_000)
  assert.equal(out[0].date, '2026-09-15')
})

test('ночная смена: безнал до полуночи остаётся, остальное уходит на следующий день', () => {
  const out = splitIncomeKaspiByCalendarDay([
    row({ kaspi_amount: 100_000, kaspi_before_midnight: 30_000, cash_amount: 20_000 }),
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].date, '2026-09-15')
  assert.equal(out[0].kaspi_amount, 30_000)
  assert.equal(out[0].cash_amount, 20_000, 'наличные не переносятся')
  assert.equal(out[1].date, '2026-09-16')
  assert.equal(out[1].kaspi_amount, 70_000)
  assert.equal(out[1].cash_amount, 0)
})

test('ночная смена без отметки до полуночи: весь безнал уходит на следующий день', () => {
  const out = splitIncomeKaspiByCalendarDay([row({ kaspi_amount: 80_000 })])
  assert.equal(out.length, 2)
  assert.equal(out[0].kaspi_amount, 0)
  assert.equal(out[1].kaspi_amount, 80_000)
})

test('отметка до полуночи больше суммы безнала не создаёт лишнюю строку', () => {
  const out = splitIncomeKaspiByCalendarDay([row({ kaspi_amount: 40_000, kaspi_before_midnight: 90_000 })])
  assert.equal(out.length, 1)
  assert.equal(out[0].kaspi_amount, 40_000)
})

test('сумма за диапазон: безнал ночи 30-го числа попадает в следующий месяц', () => {
  const rows = splitIncomeKaspiByCalendarDay([
    row({ date: '2026-09-30', kaspi_amount: 100_000, kaspi_before_midnight: 40_000 }),
  ])
  const september = sumIncomeExpenseInRange(rows, [], '2026-09-01', '2026-09-30')
  const october = sumIncomeExpenseInRange(rows, [], '2026-10-01', '2026-10-31')
  assert.equal(september.totalIncome, 40_000)
  assert.equal(october.totalIncome, 60_000)
})

test('сумма за диапазон: расходы вне диапазона не учитываются', () => {
  const res = sumIncomeExpenseInRange(
    [row({ date: '2026-09-10', shift: 'day', cash_amount: 500_000 })],
    [
      { date: '2026-09-10', cash_amount: 100_000, kaspi_amount: 0 },
      { date: '2026-10-01', cash_amount: 999_000, kaspi_amount: 0 },
    ],
    '2026-09-01',
    '2026-09-30',
  )
  assert.equal(res.totalIncome, 500_000)
  assert.equal(res.totalExpense, 100_000)
  assert.equal(res.profit, 400_000)
})
