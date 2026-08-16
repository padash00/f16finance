/**
 * PDF-отчёт «Разбор смен и эффективности продавцов».
 *
 * Проверяется то, что ломается молча: подстановка нулей вместо отсутствующих
 * данных, `undefined` в разметке, пустые карточки ограничений, потерянные
 * продавцы при пагинации и слипшиеся учебные события.
 *
 * Сама печать здесь не запускается — она требует Chromium. Здесь проверяются
 * контракт и разметка, то есть всё, что можно сломать правкой шаблона.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mapReportToPdfDto,
  money,
  percent,
  scoreVsNorm,
} from '@/lib/reports/shift-efficiency-pdf-adapter'
import {
  SELLERS_PER_PAGE,
  renderGlossary,
  renderMonthSummary,
  renderSellersOverview,
  renderShiftReasoning,
  renderShiftSummary,
} from '@/lib/reports/shift-efficiency-pdf-pages'

// ─── Фикстуры ───────────────────────────────────────────────────────────────

function shift(patch: Record<string, any> = {}) {
  return {
    date: '2026-08-01',
    shift: 'day',
    cashier_id: 'c1',
    cashier_name: 'Камила',
    revenue: 50_445,
    expected_revenue: 47_250,
    receipts: 41,
    expected_receipts: 40,
    duration_minutes: 774,
    score: 1.06,
    confidence: 0.82,
    verdict: 'STRONG_CASHIER',
    metrics: [
      { metric: 'avg_ticket', actual: 1433, expected: 1177, ratio: 1.22 },
      { metric: 'items_per_receipt', actual: 1.65, expected: 1.53, ratio: 1.08 },
      { metric: 'attach_rate', actual: null, expected: null, ratio: null },
      { metric: 'revenue_efficiency', actual: 1433, expected: 1177, ratio: 1.22 },
      { metric: 'plan_attainment', actual: 50_445, expected: 47_250, ratio: 1.07 },
      { metric: 'product_knowledge', actual: null, expected: null, ratio: null },
    ],
    explanation: {
      headline: 'Из того же числа покупателей выжали заметно больше обычного.',
      paragraphs: [
        'Спрос. Покупателей за смену — 41 при обычных 40.',
        'Касса. Магазин сделал 50 445 ₸ при ожидаемых 47 250 ₸.',
        'Работа продавца. Считается по 5 из 6 метрик.',
        'Объём. За смену пробито 41 чек и 69 товаров.',
        'Длительность. Смена шла 12.9 ч.',
      ],
      metrics: [
        {
          metric: 'avg_ticket',
          label: 'Средний чек',
          actual: 1433,
          expected: 1177,
          delta_pct: 22,
          reading: 'Средний чек выше нормы на 22%.',
          sample: 24,
        },
        {
          metric: 'product_knowledge',
          label: 'Знание товара',
          actual: null,
          expected: null,
          delta_pct: null,
          reading: 'Посчитать не из чего.',
          sample: 0,
        },
      ],
      conclusion: 'Смена отработана лучше обычного.',
      action: 'Разберите, что сработало, с остальными.',
      caveats: [],
    },
    context: {
      weather: {
        label: 'Обычная погода',
        summary: 'от 20° до 28° — в часы смены.',
        windowed: true,
        window_label: '09:00–21:00',
      },
      days: [],
      periods: [],
    },
    ...patch,
  }
}

function cashier(patch: Record<string, any> = {}) {
  return {
    cashier_id: 'c1',
    name: 'Камила',
    shifts: 7,
    revenue: 379_142,
    receipts: 300,
    score: 1.04,
    status: 'NORMAL',
    confidence: 0.8,
    metric_ratios: { avg_ticket: 1.12, attach_rate: 0.9 },
    strengths: ['plan_attainment'],
    weaknesses: [],
    verdicts: { STRONG_CASHIER: 3, NORMAL: 4 },
    ...patch,
  }
}

function dto(patch: { shifts?: any[]; cashiers?: any[]; totals?: any } = {}) {
  const shifts = patch.shifts ?? [shift()]
  const cashiers = patch.cashiers ?? [cashier()]
  return mapReportToPdfDto({
    report: {
      period: { from: '2026-08-01', to: '2026-08-31' },
      shifts,
      cashiers,
      totals: patch.totals ?? {
        shifts: shifts.length,
        revenue: 1_775_599,
        receipts: 1_416,
        strong: 12,
        low_demand: 9,
        cashier_issue: 7,
        high_demand: 1,
        insufficient: 1,
      },
    } as any,
    point: { id: 'p1', name: 'F16 Ramen' },
    monthLabel: 'Август 2026',
    generatedAt: '16.08.2026, 22:10',
  })
}

/** Разметка не должна содержать следов недостающих данных. */
function assertClean(html: string) {
  assert.ok(!html.includes('undefined'), 'в разметке не должно быть undefined')
  assert.ok(!html.includes('[object Object]'), 'в разметке не должно быть [object Object]')
  assert.ok(!/>\s*null\s*</.test(html), 'в разметке не должно быть null')
  assert.ok(!html.includes('NaN'), 'в разметке не должно быть NaN')
}

// ─── Формат ─────────────────────────────────────────────────────────────────

test('деньги пишутся пробелом и тенге', () => {
  assert.equal(money(1_775_599), '1 775 599 ₸'.replace(/ /g, ' '))
  assert.equal(money(50_445), '50 445 ₸'.replace(/ /g, ' '))
  assert.ok(!money(1_775_599).includes(','), 'запятая как разделитель запрещена')
  assert.equal(money(null), '—', 'нет данных — прочерк, а не ноль')
})

test('проценты со знаком, а отсутствие нормы — словами', () => {
  assert.equal(percent(13), '+13%')
  assert.equal(percent(-9), '−9%')
  assert.equal(percent(0), 'как обычно')
  assert.equal(percent(null), 'нет нормы')
  assert.equal(scoreVsNorm(null), 'нет оценки')
})

// ─── Контракт ───────────────────────────────────────────────────────────────

test('метрика без данных не превращается в ноль', () => {
  const r = dto()
  const knowledge = r.shifts[0].metrics.productKnowledge

  assert.equal(knowledge.state, 'no_data')
  assert.equal(knowledge.factLabel, '—')
  assert.equal(knowledge.normLabel, '—')
  assert.equal(knowledge.deltaLabel, 'нет нормы')
})

test('состояние метрики решает контракт, а не шаблон', () => {
  const r = dto()
  const m = r.shifts[0].metrics

  assert.equal(m.avgCheck.state, 'positive')
  assert.equal(m.avgCheck.deltaLabel, '+22%')
  assert.equal(m.itemsPerCheck.state, 'positive')
})

test('отклонение внутри шума не красится в зелёное', () => {
  // +2% — это не достижение, а колебание. Правило «больше нуля значит
  // хорошо» покрасило бы такую метрику зелёным и создало бы повод для
  // разговора там, где разговаривать не о чем.
  const r = dto({
    shifts: [
      shift({
        metrics: [
          { metric: 'items_per_receipt', actual: 1.53, expected: 1.5, raw_ratio: 1.02, ratio: 1.02 },
        ],
        explanation: null,
      }),
    ],
  })

  assert.equal(r.shifts[0].metrics.itemsPerCheck.state, 'neutral')
  assert.equal(r.shifts[0].metrics.itemsPerCheck.deltaLabel, '+2%')
})

test('абзацы разбора раскладываются по своим карточкам', () => {
  const r = dto()
  const reasoning = r.shifts[0].reasoning

  assert.match(reasoning.demandText, /Покупателей за смену/)
  assert.match(reasoning.revenueText, /Магазин сделал/)
  assert.match(reasoning.sellerWorkText, /5 из 6 метрик/)
  assert.match(reasoning.durationText, /12\.9 ч/)
  // Ни один абзац не должен продублироваться в чужую карточку.
  assert.ok(!reasoning.demandText.includes('Магазин сделал'))
})

test('учебные события группируются, но не теряются', () => {
  const r = dto({
    shifts: [
      shift({
        context: {
          weather: null,
          days: [],
          periods: [
            { name: 'Вузы — приём документов', type_label: 'Приёмная кампания', audience_label: 'студенты', confirmed: true },
            { name: 'Вузы — творческие экзамены', type_label: 'Приёмная кампания', audience_label: 'студенты', confirmed: true },
            { name: 'Колледжи — приём', type_label: 'Приёмная кампания', audience_label: 'колледжи', confirmed: true },
          ],
        },
      }),
    ],
  })
  const ctx = r.shifts[0].context

  assert.ok(ctx.universities?.includes('приём документов'))
  assert.ok(ctx.universities?.includes('творческие экзамены'), 'уникальное событие терять нельзя')
  assert.ok(ctx.colleges?.includes('Колледжи'))
})

test('пустые категории обстановки отсутствуют, а не пишутся «нет»', () => {
  const r = dto({
    shifts: [shift({ context: { weather: null, days: [], periods: [] } })],
  })
  const ctx = r.shifts[0].context

  assert.equal(ctx.weather, undefined)
  assert.equal(ctx.schools, undefined)
  assert.equal(ctx.events, undefined)
})

// ─── Страницы ───────────────────────────────────────────────────────────────

test('сводка месяца собирается и не содержит мусора', () => {
  const html = renderMonthSummary(dto())
  assertClean(html)

  assert.ok(html.includes('class="pdf-page landscape"'))
  assert.match(html, /ORDA CONTROL/)
  assert.match(html, /Как читать отчёт/i)
})

test('нулевая категория не рисует сегмент полосы', () => {
  const html = renderMonthSummary(
    dto({ totals: { shifts: 10, revenue: 1, receipts: 1, strong: 10, low_demand: 0, cashier_issue: 0, high_demand: 0, insufficient: 0 } }),
  )
  const segments = (html.match(/class="bar-seg"/g) || []).length
  assert.equal(segments, 1, 'пустые категории на полосе не рисуются')
})

test('страница смены книжная и не содержит мусора', () => {
  const r = dto()
  const html = renderShiftSummary(r, r.shifts[0])
  assertClean(html)

  assert.ok(html.includes('class="pdf-page portrait"'))
  assert.match(html, /Главный вывод/)
  assert.match(html, /Что это значит/)
  assert.match(html, /Что делать/)
  // Шесть метрик, ни одной меньше.
  assert.equal((html.match(/class="metric bg-/g) || []).length, 6)
})

test('без ограничений блок не рисуется вовсе', () => {
  const r = dto()
  const html = renderShiftSummary(r, r.shifts[0])
  assert.ok(!html.includes('Где выводу нельзя доверять'), 'пустая карточка ограничений запрещена')
})

test('с ограничениями блок появляется', () => {
  const r = dto({
    shifts: [
      shift({
        explanation: {
          ...shift().explanation,
          caveats: ['Знание товара: тест не сдавался', 'Допродажи: не настроены правила'],
        },
      }),
    ],
  })
  const html = renderShiftSummary(r, r.shifts[0])

  assert.match(html, /Где выводу нельзя доверять/)
  assert.equal((html.match(/<li>/g) || []).length, 2)
})

test('страница «почему такой вывод» объясняет спрос и кассу', () => {
  const r = dto()
  const html = renderShiftReasoning(r, r.shifts[0])
  assertClean(html)

  assert.ok(html.includes('class="pdf-page portrait"'))
  assert.match(html, /Спрос/)
  assert.match(html, /Касса/)
  assert.match(html, /Работа продавца/)
  assert.match(html, /Обстановка в этот день/)
})

test('без обстановки страница говорит об этом прямо', () => {
  const r = dto({ shifts: [shift({ context: { weather: null, days: [], periods: [] } })] })
  const html = renderShiftReasoning(r, r.shifts[0])

  assert.match(html, /кассу нечем\s+объяснить, кроме работы/)
})

// ─── Продавцы ───────────────────────────────────────────────────────────────

test('шесть продавцов помещаются на одну страницу', () => {
  const sellers = Array.from({ length: 6 }, (_, i) => cashier({ cashier_id: `c${i}`, name: `Продавец ${i}` }))
  const pages = renderSellersOverview(dto({ cashiers: sellers }))

  assert.equal(pages.length, 1)
  assert.equal((pages[0].match(/class="seller"/g) || []).length, 6)
})

test('седьмой продавец создаёт вторую страницу и не теряется', () => {
  const sellers = Array.from({ length: 7 }, (_, i) => cashier({ cashier_id: `c${i}`, name: `Продавец ${i}` }))
  const pages = renderSellersOverview(dto({ cashiers: sellers }))

  assert.equal(pages.length, 2)
  const all = pages.join('')
  assert.equal((all.match(/class="seller"/g) || []).length, 7)
  assert.match(all, /Продавец 6/)
  assert.equal(SELLERS_PER_PAGE, 6)
})

test('один продавец не дополняется фальшивыми карточками', () => {
  const pages = renderSellersOverview(dto({ cashiers: [cashier()] }))
  assert.equal((pages[0].match(/class="seller"/g) || []).length, 1)
})

test('длинное имя не обрезается многоточием', () => {
  const pages = renderSellersOverview(
    dto({ cashiers: [cashier({ name: 'Анастасия Александровна' })] }),
  )

  assert.match(pages[0], /Анастасия Александровна/)
  assert.ok(!pages[0].includes('Анастасия Алекс…'))
  assert.match(pages[0], /seller-name long/, 'длинное имя уменьшается, а не режется')
})

test('нет продавцов — честная страница, а не пустая сетка', () => {
  const pages = renderSellersOverview(dto({ cashiers: [] }))

  assert.equal(pages.length, 1)
  assert.match(pages[0], /нет смен с указанным продавцом/)
})

// ─── Крайние значения ───────────────────────────────────────────────────────

test('большая выручка не ломает карточку', () => {
  const r = dto({ shifts: [shift({ revenue: 123_456_789_999 })] })
  const html = renderShiftSummary(r, r.shifts[0])

  assertClean(html)
  assert.match(html, /kpi2-value small/, 'длинная сумма печатается меньшим кеглем, а не рвёт вёрстку')
})

test('смена без нормы и без разбора не превращается в нули', () => {
  const r = dto({
    shifts: [
      shift({
        score: null,
        expected_revenue: null,
        expected_receipts: null,
        duration_minutes: null,
        explanation: null,
        metrics: [],
        verdict: 'INSUFFICIENT_DATA',
      }),
    ],
  })
  const html = renderShiftSummary(r, r.shifts[0])

  assertClean(html)
  assert.match(html, /обычно —/)
  assert.ok(!html.includes('обычно 0 ₸'))
})

// ─── Словарь ────────────────────────────────────────────────────────────────

test('в словаре все обязательные термины', () => {
  const html = renderGlossary(dto())
  assertClean(html)

  for (const term of [
    'Обычно бывает',
    'Покупателей',
    'Мало покупателей',
    'Вопрос к продавцу',
    'Вытянул поток',
    'Допродажи',
    'Обстановка',
  ]) {
    assert.ok(html.includes(term), `в словаре нет термина «${term}»`)
  }
  assert.match(html, /Главный принцип/i)
})
