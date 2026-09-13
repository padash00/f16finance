import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'

const income = (date: string, companyId: string, cash: number) => ({
  date,
  company_id: companyId,
  cash_amount: cash,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
})

const expense = (date: string, companyId: string, cash: number) => ({
  date,
  company_id: companyId,
  category: 'Аренда',
  cash_amount: cash,
  kaspi_amount: 0,
})

const agg = aggregateReportFromRows({
  incomes: [
    income('2026-09-01', 'arena', 100_000),
    income('2026-09-01', 'arena', 20_000),
    income('2026-09-02', 'ramen', 50_000),
    income('2026-08-30', 'arena', 70_000), // база сравнения
  ],
  expenses: [
    expense('2026-09-02', 'arena', 30_000),
    expense('2026-08-31', 'ramen', 9_000), // база сравнения
  ],
  dateFrom: '2026-09-01',
  dateTo: '2026-09-02',
  groupMode: 'day',
  companyName: (id) => id,
})

test('дневной ряд точки складывает строки одного дня', () => {
  assert.deepEqual(agg.companyDaily.get('arena')?.get('2026-09-01'), { income: 120_000, expense: 0 })
  assert.deepEqual(agg.companyDaily.get('arena')?.get('2026-09-02'), { income: 0, expense: 30_000 })
  assert.deepEqual(agg.companyDaily.get('ramen')?.get('2026-09-02'), { income: 50_000, expense: 0 })
})

test('база сравнения в дневной ряд не попадает', () => {
  assert.equal(agg.companyDaily.get('arena')?.has('2026-08-30'), false)
  assert.equal(agg.companyDaily.get('ramen')?.has('2026-08-31'), false)
})

test('итоги точек за прошлый период считаются отдельно, с прибылью', () => {
  assert.deepEqual(agg.companyStatsPrev.get('arena'), { income: 70_000, expense: 0, profit: 70_000 })
  assert.deepEqual(agg.companyStatsPrev.get('ramen'), { income: 0, expense: 9_000, profit: -9_000 })
})
