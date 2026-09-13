import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findIncompleteMonths } from '@/lib/analysis/data-completeness'

/** Доход каждый день [from, to], кроме дней недели из skipWeekdays (0 = вс) и дат из skipDates */
const incomeDays = (companyId: string, from: string, to: string, skipWeekdays: number[] = [], skipDates: string[] = []) => {
  const rows = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (skipWeekdays.includes(d.getUTCDay()) || skipDates.includes(iso)) continue
    rows.push({ company_id: companyId, date: iso, cash: 10_000 })
  }
  return rows
}

test('полные месяцы не помечаются', () => {
  const result = findIncompleteMonths(incomeDays('arena', '2026-05-01', '2026-08-31'), '2026-09')
  assert.deepEqual(result, [])
})

test('месяц, где не внесли 5 дней, помечается неполным', () => {
  const skip = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14']
  const result = findIncompleteMonths(incomeDays('ramen', '2026-05-01', '2026-08-31', [], skip), '2026-09')
  assert.deepEqual(result, [{ month: '2026-07', companyId: 'ramen', days: 26, expectedDays: 31, daysInMonth: 31 }])
})

test('выходной по воскресеньям — обычный график, а не неполные месяцы', () => {
  const result = findIncompleteMonths(incomeDays('store', '2026-04-01', '2026-08-31', [0]), '2026-09')
  assert.deepEqual(result, [])
})

test('месяц без единой записи между рабочими — неполный', () => {
  const rows = [...incomeDays('arena', '2026-05-01', '2026-06-30'), ...incomeDays('arena', '2026-08-01', '2026-08-31')]
  const result = findIncompleteMonths(rows, '2026-09')
  assert.deepEqual(result.map((r) => [r.month, r.days]), [['2026-07', 0]])
})

test('точка перестала вносить в прошлом месяце — прошлый месяц неполный', () => {
  const result = findIncompleteMonths(incomeDays('arena', '2026-05-01', '2026-07-31'), '2026-09')
  assert.deepEqual(result.map((r) => [r.month, r.days]), [['2026-08', 0]])
})

test('текущий месяц не проверяется — он ещё идёт', () => {
  const result = findIncompleteMonths(incomeDays('arena', '2026-06-01', '2026-09-05'), '2026-09')
  assert.deepEqual(result, [])
})

test('первый месяц открытия с середины — неполный, дальше нормально', () => {
  const result = findIncompleteMonths(incomeDays('new', '2026-06-20', '2026-08-31'), '2026-09')
  assert.deepEqual(result.map((r) => r.month), ['2026-06'])
})
