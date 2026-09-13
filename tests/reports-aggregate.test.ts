import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'
import { isExtraCompany } from '@/lib/reports/extra-company'

const income = (date: string, cash: number, kaspi = 0) => ({
  date,
  company_id: 'c1',
  cash_amount: cash,
  kaspi_amount: kaspi,
  online_amount: 0,
  card_amount: 0,
})

const expense = (date: string, cash: number) => ({
  date,
  company_id: 'c1',
  category: 'Аренда',
  cash_amount: cash,
  kaspi_amount: 0,
})

const run = (incomes: ReturnType<typeof income>[], expenses: ReturnType<typeof expense>[]) =>
  aggregateReportFromRows({
    incomes,
    expenses,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-07',
    groupMode: 'day',
    companyName: () => 'Точка',
  })

// ─── Средняя запись дохода ──────────────────────────────────────────────────

test('расходы не попадают в счётчик записей дохода', () => {
  const agg = run(
    [income('2026-08-01', 100_000), income('2026-08-02', 50_000)],
    [expense('2026-08-01', 10_000), expense('2026-08-02', 5_000), expense('2026-08-03', 1_000)],
  )
  assert.equal(agg.totalsCur.transactionCount, 2)
  assert.equal(agg.totalsCur.avgTransaction, 75_000)
})

test('прошлый период считается отдельно и тоже без расходов', () => {
  const agg = run([income('2026-07-30', 40_000)], [expense('2026-07-30', 9_000)])
  assert.equal(agg.totalsPrev.transactionCount, 1)
  assert.equal(agg.totalsPrev.avgTransaction, 40_000)
  assert.equal(agg.totalsCur.transactionCount, 0)
})

// ─── Точка-экстра ───────────────────────────────────────────────────────────

test('экстра определяется по коду или точному имени', () => {
  assert.equal(isExtraCompany({ code: 'extra', name: 'Что угодно' }), true)
  assert.equal(isExtraCompany({ code: 'EXTRA', name: null }), true)
  assert.equal(isExtraCompany({ code: null, name: 'F16 Extra' }), true)
})

test('подстрока «extra» в названии чужой точки не делает её экстрой', () => {
  assert.equal(isExtraCompany({ code: 'shop1', name: 'Extra Store' }), false)
  assert.equal(isExtraCompany({ code: null, name: 'Магазин Extra' }), false)
})
