/**
 * Сборка Excel-отчёта.
 *
 * Тест намеренно собирает файл целиком, а не проверяет отдельные ячейки.
 * Причина конкретная: ExcelJS проверяет структуру правил не при их
 * добавлении, а при записи файла. Полоски в ячейках без границ шкалы
 * добавлялись молча и роняли выгрузку уже на кнопке — «Cannot read properties
 * of undefined». Поймать такое можно только доведя книгу до буфера.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildShiftReportContract } from '@/lib/reports/build-shift-report-contract'
import { buildSalesKpiWorkbook } from '@/lib/server/sales-kpi-xlsx'

const BASE = {
  companyName: 'F16 Ramen',
  period: { from: '2026-08-01', to: '2026-08-31' },
  periodLabel: 'Август 2026',
  generated: '16.08.2026, 12:00',
  warnings: ['История короткая'],
  minSampleSize: 8,
}

function fullShift() {
  return {
    date: '2026-08-02',
    shift: 'night',
    cashier_name: 'Айгерим',
    revenue: 33_039,
    expected_revenue: 36_700,
    receipts: 23,
    expected_receipts: 36,
    score: 1.1,
    confidence: 0.82,
    verdict: 'LOW_DEMAND',
    explanation: {
      headline: 'Покупателей было меньше обычного.',
      paragraphs: ['Спрос ниже нормы.'],
      metrics: [
        {
          metric: 'avg_ticket',
          label: 'Средний чек',
          actual: 1436,
          expected: 1240,
          delta_pct: 16,
          reading: 'Выше нормы на 16%.',
          sample: 24,
        },
      ],
      conclusion: 'Слабая касса объясняется потоком.',
      action: 'Разбирать нечего.',
      caveats: ['Допродажи не настроены'],
    },
    context: {
      weather: {
        summary: 'от 16° до 18° — в часы смены.',
        label: 'Обычная погода',
        windowed: true,
        window_label: '21:00–09:00',
      },
      days: [],
      periods: [],
    },
  }
}

function fullCashier() {
  return {
    cashier_id: 'c1',
    name: 'Айгерим',
    shifts: 7,
    revenue: 288_000,
    receipts: 210,
    score: 1.12,
    status: 'STRONG',
    confidence: 0.8,
    metric_ratios: { avg_ticket: 1.16, attach_rate: 0.9 },
    strengths: ['avg_ticket'],
    weaknesses: ['attach_rate'],
    verdicts: { STRONG_CASHIER: 3, NORMAL: 4 },
  }
}

test('книга с данными собирается до конца', async () => {
  const contract = buildShiftReportContract({
    ...BASE,
    shifts: [fullShift()] as any,
    cashiers: [fullCashier()] as any,
  })

  const buffer = await buildSalesKpiWorkbook(contract, [])
  assert.ok(buffer.length > 5000, 'файл не должен быть пустым')
  // PK — сигнатура zip: xlsx это архив, и повреждённый файл Excel не откроет.
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK')
})

test('пустой период не роняет выгрузку', async () => {
  const contract = buildShiftReportContract({ ...BASE, shifts: [], cashiers: [] })
  const buffer = await buildSalesKpiWorkbook(contract, [])

  // Автофильтр и полоски по пустому диапазону — типичное место падения.
  assert.ok(buffer.length > 1000)
})

test('смена без разбора и продавец без метрик не роняют выгрузку', async () => {
  const contract = buildShiftReportContract({
    ...BASE,
    shifts: [
      {
        date: '2026-08-01',
        shift: 'day',
        cashier_name: null,
        revenue: 0,
        expected_revenue: null,
        receipts: 0,
        expected_receipts: null,
        score: null,
        confidence: 0,
        verdict: 'INSUFFICIENT_DATA',
        explanation: null,
        context: null,
      },
    ] as any,
    cashiers: [
      {
        cashier_id: 'x',
        name: 'Без имени',
        shifts: 1,
        revenue: 0,
        receipts: 0,
        score: null,
        status: 'INSUFFICIENT_DATA',
        confidence: 0,
        metric_ratios: {},
        strengths: [],
        weaknesses: [],
        verdicts: {},
      },
    ] as any,
  })

  const buffer = await buildSalesKpiWorkbook(contract, [])
  assert.ok(buffer.length > 1000)
})

test('графики картинками вставляются без ошибок', async () => {
  const contract = buildShiftReportContract({ ...BASE, shifts: [], cashiers: [] })
  // Минимальный валидный PNG: содержимое не важно, важна сама вставка.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const withCharts = await buildSalesKpiWorkbook(contract, [{ title: 'Касса по дням', png }])
  const without = await buildSalesKpiWorkbook(contract, [])

  assert.ok(withCharts.length > without.length, 'лист с графиками обязан попасть в файл')
})
