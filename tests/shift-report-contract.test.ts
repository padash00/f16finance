/**
 * Контракт выгрузки.
 *
 * Главное, что здесь проверяется: PDF и Excel говорят ровно то же, что экран.
 * Отчёт, расходящийся с экраном, хуже отсутствия отчёта — верить нельзя ни
 * там, ни там. Поэтому перевод чисел в слова живёт в одном месте и покрыт
 * тестами.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildShiftReportContract,
  confidenceText,
  scoreText,
} from '@/lib/reports/build-shift-report-contract'
import { barChartSvg, lineChartSvg } from '@/lib/reports/shift-report-charts'

function shift(patch: Record<string, any> = {}) {
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
      paragraphs: ['Спрос. Покупателей за смену — 23 при обычных 36.'],
      metrics: [
        {
          metric: 'avg_ticket',
          label: 'Средний чек',
          actual: 1436,
          expected: 1240,
          delta_pct: 16,
          reading: 'Средний чек выше нормы на 16%.',
          sample: 24,
        },
      ],
      conclusion: 'Слабая касса объясняется потоком, а не работой.',
      action: 'Разбирать нечего — смена отработана нормально.',
      caveats: ['Допродажи: не настроены правила'],
    },
    context: {
      weather: {
        summary: 'от 16° до 18° — в часы смены.',
        label: 'Обычная погода',
        windowed: true,
        window_label: '21:00–09:00',
      },
      days: [{ name: 'День Республики', type_label: 'Государственный праздник' }],
      periods: [
        {
          name: 'Летние каникулы',
          type_label: 'Летние каникулы',
          audience_label: 'школьники',
          confirmed: true,
        },
      ],
    },
    ...patch,
  }
}

function cashier(patch: Record<string, any> = {}) {
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
    verdicts: { STRONG_CASHIER: 3, NORMAL: 4, LOW_DEMAND: 0 },
    ...patch,
  }
}

function build(patch: Record<string, any> = {}) {
  return buildShiftReportContract({
    companyName: 'F16 Ramen',
    period: { from: '2026-08-01', to: '2026-08-31' },
    periodLabel: 'Август 2026',
    generated: '16.08.2026, 12:00',
    shifts: [shift()] as any,
    cashiers: [cashier()] as any,
    warnings: ['История короткая'],
    minSampleSize: 8,
    ...patch,
  })
}

test('в отчёте нет сырых коэффициентов', () => {
  const c = build()

  assert.match(c.cashiers[0].score_text, /лучше на 12%/)
  assert.match(c.shifts[0].score_text, /лучше на 10%/)
  assert.equal(c.shifts[0].confidence_text, 'можно доверять')
  assert.equal(c.cashiers[0].confidence_text, 'можно доверять')
})

test('вердикты и статусы переведены на человеческий', () => {
  const c = build()
  assert.equal(c.shifts[0].verdict, 'Мало покупателей')
  assert.equal(c.cashiers[0].status, 'Сильный')
})

test('обстановка попадает в отчёт целиком', () => {
  const c = build()
  const ctx = c.shifts[0].context

  assert.match(String(ctx.weather), /Обычная погода/)
  assert.match(String(ctx.weather), /21:00–09:00/)
  assert.equal(ctx.days.length, 1)
  assert.match(ctx.periods[0], /школьники/)
})

test('неподтверждённый период помечен как не идущий в расчёт', () => {
  const c = build({
    shifts: [
      shift({
        context: {
          weather: null,
          days: [],
          periods: [{ name: 'Сессия', type_label: 'Сессия', audience_label: null, confirmed: false }],
        },
      }),
    ],
  })

  assert.match(c.shifts[0].context.periods[0], /не подтверждён/)
})

test('смена без данных не превращается в нули', () => {
  const c = build({
    shifts: [
      shift({ score: null, expected_revenue: null, expected_receipts: null, explanation: null }),
    ],
  })
  const s = c.shifts[0]

  assert.equal(s.score_text, 'нет оценки')
  assert.equal(s.expected_revenue, null)
  assert.equal(s.headline, '')
  assert.deepEqual(s.metrics, [])
})

test('сводка считает вердикты, а не выдумывает', () => {
  const c = build({
    shifts: [
      shift({ verdict: 'POSSIBLE_CASHIER_ISSUE' }),
      shift({ verdict: 'STRONG_CASHIER' }),
      shift({ verdict: 'STRONG_CASHIER' }),
    ],
  })
  const kpis = Object.fromEntries(c.summary.kpis.map((k) => [k.label, k.value]))

  assert.equal(kpis['Смен разобрано'], '3')
  assert.equal(kpis['Вопрос к продавцу'], '1')
  assert.equal(kpis['Сильных смен'], '2')
})

test('словарь объясняет каждое слово из отчёта', () => {
  const c = build()
  const terms = c.glossary.map((g) => g.term).join(' ')

  assert.match(terms, /Покупателей/)
  assert.match(terms, /Вопрос к продавцу/)
  assert.match(terms, /доверять/)
})

// ─── Слова из чисел ─────────────────────────────────────────────────────────

test('балл и доверие словами совпадают с экраном', () => {
  assert.equal(scoreText(1.13), 'лучше на 13%')
  assert.equal(scoreText(0.87), 'слабее на 13%')
  assert.equal(scoreText(1.01), 'как обычно')
  assert.equal(scoreText(null), 'нет оценки')

  assert.equal(confidenceText(0.9), 'можно доверять')
  assert.equal(confidenceText(0.5), 'есть сомнения')
  assert.equal(confidenceText(0.2), 'рано судить')
})

// ─── Графики ────────────────────────────────────────────────────────────────

test('пропуск в данных рисуется разрывом, а не нулём', () => {
  const svg = lineChartSvg({
    title: 'Касса',
    subtitle: 'август',
    actualLabel: 'было',
    expectedLabel: 'обычно',
    points: [
      { label: '08-01', actual: 100, expected: 90 },
      { label: '08-02', actual: 110, expected: 90 },
      { label: '08-03', actual: null, expected: 90 },
      { label: '08-04', actual: 120, expected: 90 },
      { label: '08-05', actual: 130, expected: 90 },
    ],
  })

  // Две отдельные ломаные факта вместо одной, провалившейся в ноль.
  const greenLines = (svg.match(/<polyline[^>]*#16a34a[^>]*>/g) || []).length
  assert.equal(greenLines, 2, 'разрыв обязан разбивать линию, а не тянуть её к нулю')

  // В ломаных ровно четыре точки факта: пятая (пустая) не подставлена нулём.
  const factPoints = (svg.match(/<polyline[^>]*#16a34a[^>]*>/g) || [])
    .map((line) => (line.match(/points="([^"]*)"/) || [])[1] || '')
    .join(' ')
    .trim()
    .split(/\s+/).length
  assert.equal(factPoints, 4, 'день без данных не должен появляться на линии')
})

test('одиночная точка не исчезает вместе с линией', () => {
  // Через одну точку линию не проведёшь, но и терять её нельзя: день с
  // продажами обязан остаться на графике.
  const svg = lineChartSvg({
    title: 'Касса',
    subtitle: '',
    actualLabel: 'было',
    expectedLabel: 'обычно',
    points: [
      { label: '08-01', actual: 100, expected: 90 },
      { label: '08-02', actual: null, expected: 90 },
      { label: '08-03', actual: 120, expected: 90 },
    ],
  })

  const dots = (svg.match(/<circle[^>]*>/g) || []).length
  assert.equal(dots, 2, 'обе одиночные точки обязаны остаться видимыми')
})

test('пустой период не рисует пустой график молча', () => {
  const svg = lineChartSvg({
    title: 'Касса',
    subtitle: '',
    actualLabel: 'было',
    expectedLabel: 'обычно',
    points: [],
  })
  assert.match(svg, /Данных за период нет/)
})

test('столбики не ломаются на нулях', () => {
  const svg = barChartSvg({
    title: 'Вердикты',
    subtitle: '',
    bars: [
      { label: 'Сильная смена', value: 0 },
      { label: 'Норма', value: 0 },
    ],
  })

  assert.ok(!svg.includes('NaN'), 'нулевой максимум не должен давать NaN в координатах')
  assert.ok(!svg.includes('Infinity'))
})
