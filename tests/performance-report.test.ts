import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildPerformanceReport } from '../lib/server/performance-report'

/**
 * Отчёт по эффективности собирается при любых входных данных.
 *
 * Он падал с 500, когда процент бонуса выключен: колонки «Бонус» в книге нет,
 * а раскраска денег всё равно просила ячейку по её имени. exceljs принимает
 * незнакомое имя за адрес столбца, а имя длиннее трёх букв — это столбец за
 * пределами листа: «Out of bounds. Excel supports columns from 1 to 16384».
 *
 * Ошибка в журнале выглядела как поломка Excel, хотя дело было в выключенной
 * галочке. Тест держит все ветки, где колонка может отсутствовать.
 */
const operator = (over: Record<string, unknown> = {}) => ({
  operator_name: 'Иванов Иван',
  operator_short_name: 'Иванов',
  shifts: 2,
  total_revenue: 100_000,
  avg_revenue_per_shift: 50_000,
  pi: 1.1,
  qualifying: true,
  expected_total: 90_000,
  shift_details: [
    { date: '2026-08-01', shift: 'day', company_id: 'c1', expected: 45_000, actual: 50_000 },
    { date: '2026-08-02', shift: 'night', company_id: 'c1', expected: 45_000, actual: 40_000 },
  ],
  ...over,
})

const build = (rows: unknown[], bonusPct: number, companies: Record<string, string> = { c1: 'Точка №1' }) =>
  buildPerformanceReport({
    rows: rows as never,
    bonusPct,
    companies,
    period: { from: '2026-08-01', to: '2026-08-31' },
  })

describe('отчёт по эффективности', () => {
  it('собирается с выключенным бонусом — колонки «Бонус» нет', async () => {
    const buffer = await build([operator()], 0)
    assert.ok(buffer.byteLength > 0)
  })

  it('собирается с включённым бонусом', async () => {
    const buffer = await build([operator()], 10)
    assert.ok(buffer.byteLength > 0)
  })

  it('оператор без смен не ломает книгу', async () => {
    const buffer = await build([operator({ shifts: 0, shift_details: [] })], 5)
    assert.ok(buffer.byteLength > 0)
  })

  it('точка без названия не ломает книгу', async () => {
    const buffer = await build([operator()], 0, {})
    assert.ok(buffer.byteLength > 0)
  })

  it('нулевая норма не ломает книгу', async () => {
    const rows = [
      operator({
        expected_total: 0,
        shift_details: [{ date: '2026-08-01', shift: 'day', company_id: 'c1', expected: 0, actual: 0 }],
      }),
    ]
    const buffer = await build(rows, 7)
    assert.ok(buffer.byteLength > 0)
  })

  it('несколько операторов и точек', async () => {
    const rows = [
      operator(),
      operator({ operator_name: 'Петров Пётр', qualifying: false }),
      operator({
        operator_name: 'Сидоров Сидор',
        shift_details: [{ date: '2026-08-09', shift: 'day', company_id: 'c2', expected: 30_000, actual: 45_000 }],
      }),
    ]
    const buffer = await build(rows, 12, { c1: 'Точка №1', c2: 'Точка №2' })
    assert.ok(buffer.byteLength > 0)
  })
})
