import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDateRanges, sameRangeLastYear } from '@/lib/reports/period'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'

// ─── Тот же период годом раньше ─────────────────────────────────────────────

test('период сдвигается ровно на год', () => {
  assert.deepEqual(sameRangeLastYear('2026-09-01', '2026-09-30'), { prevFrom: '2025-09-01', prevTo: '2025-09-30' })
})

test('29 февраля превращается в 28-е невисокосного года', () => {
  assert.deepEqual(sameRangeLastYear('2028-02-01', '2028-02-29'), { prevFrom: '2027-02-01', prevTo: '2027-02-28' })
})

// ─── Склейка диапазонов загрузки ────────────────────────────────────────────

test('соседние диапазоны склеиваются в один запрос', () => {
  assert.deepEqual(
    mergeDateRanges([
      { from: '2026-09-08', to: '2026-09-14' },
      { from: '2026-09-01', to: '2026-09-07' },
    ]),
    [{ from: '2026-09-01', to: '2026-09-14' }],
  )
})

test('год назад и текущий период остаются двумя отдельными кусками', () => {
  assert.deepEqual(
    mergeDateRanges([
      { from: '2026-09-08', to: '2026-09-14' },
      { from: '2025-09-08', to: '2025-09-14' },
    ]),
    [
      { from: '2025-09-08', to: '2025-09-14' },
      { from: '2026-09-08', to: '2026-09-14' },
    ],
  )
})

test('вложенный диапазон не расширяет и не дублирует внешний', () => {
  assert.deepEqual(
    mergeDateRanges([
      { from: '2026-08-01', to: '2026-08-31' },
      { from: '2026-08-02', to: '2026-08-31' },
    ]),
    [{ from: '2026-08-01', to: '2026-08-31' }],
  )
})

// ─── База сравнения в агрегаторе ────────────────────────────────────────────

test('агрегатор считает прошлый период по переданной базе, а не по соседним дням', () => {
  const agg = aggregateReportFromRows({
    incomes: [
      { date: '2025-09-10', company_id: 'c1', cash_amount: 70_000, kaspi_amount: 0, online_amount: 0, card_amount: 0 },
      { date: '2026-09-03', company_id: 'c1', cash_amount: 999, kaspi_amount: 0, online_amount: 0, card_amount: 0 },
      { date: '2026-09-10', company_id: 'c1', cash_amount: 100_000, kaspi_amount: 0, online_amount: 0, card_amount: 0 },
    ],
    expenses: [],
    dateFrom: '2026-09-08',
    dateTo: '2026-09-14',
    prevFrom: '2025-09-08',
    prevTo: '2025-09-14',
    groupMode: 'day',
    companyName: () => 'Точка',
  })
  assert.equal(agg.totalsCur.totalIncome, 100_000)
  assert.equal(agg.totalsPrev.totalIncome, 70_000)
  assert.equal(agg.prevFrom, '2025-09-08')
})
