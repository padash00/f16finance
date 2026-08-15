import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_STORE_KPI_SETTINGS,
  analyzeStoreKpi,
  attachFromReceipts,
  normalizeStoreKpiSettings,
  percentile,
  summarizeCashier,
  type ShiftFact,
} from '@/lib/domain/store-kpi'

// ─── Данные для тестов ──────────────────────────────────────────────────────
//
// История: десять понедельничных дневных смен учебного сезона, все отработаны
// «историческим» продавцом. На их фоне и проверяется разбор смен продавца A.
//
// Ожидания, которые из неё следуют:
//   выручка магазина        100 000 ₸
//   выручка клуба (поток)   300 000 ₸
//   средний чек               2 000 ₸
//   товаров на чек                  2
//   допродажи                    0.60
//   выручка на 1000 ₸ клуба    333.33 ₸

function weekly(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(y, m - 1, d + i * 7)
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

function fact(date: string, patch: Partial<ShiftFact> = {}): ShiftFact {
  const revenue = patch.revenue ?? 100_000
  return {
    company_id: 'shop',
    date,
    shift: 'day',
    cashier_id: 'hist',
    revenue,
    gross_revenue: patch.gross_revenue ?? revenue,
    refunds: 0,
    receipts: 50,
    items: 100,
    lines: 100,
    receipts_2plus: 25,
    attach_opportunities: 20,
    attach_success: 12,
    club_revenue: 300_000,
    ...patch,
  }
}

const HISTORY: ShiftFact[] = weekly('2026-01-05', 10).map((d) => fact(d))

function analyzeOne(target: ShiftFact) {
  const result = analyzeStoreKpi({
    baselineFacts: HISTORY,
    targetFacts: [target],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })
  return result.shifts[0]
}

function ratioOf(shift: ReturnType<typeof analyzeOne>, metric: string) {
  return shift.metrics.find((m) => m.metric === metric)
}

// ─── Статистика ─────────────────────────────────────────────────────────────

test('перцентиль интерполирует между соседними значениями', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25)
  assert.equal(percentile([10, 20, 30, 40], 0), 10)
  assert.equal(percentile([10, 20, 30, 40], 1), 40)
})

test('пустая выборка не даёт ноль — она не даёт ничего', () => {
  // Ноль здесь означал бы «ожидание = 0» и любую смену делал бы рекордной.
  assert.equal(percentile([], 0.5), null)
})

test('один рекордный день не задирает медиану сегмента', () => {
  const withRecord = [100, 100, 100, 100, 100, 100, 100, 100, 100, 900]
  assert.equal(percentile(withRecord, 0.5), 100)
})

// ─── Кейс 1 из ТЗ: слабый поток при хорошей работе продавца ─────────────────

test('низкий поток и низкая касса при здоровых метриках — вина потока, не продавца', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 75_000, // 0.75 от ожидания
      club_revenue: 200_000, // поток 0.67 от ожидания
      receipts: 35,
      items: 78, // 2.23 товара на чек — выше нормы
      attach_opportunities: 14,
      attach_success: 10, // 0.71 против 0.60
    }),
  )

  assert.equal(shift.verdict, 'TRAFFIC_DRIVEN')
  assert.ok(shift.score !== null && shift.score >= 1, `балл продавца не должен просесть: ${shift.score}`)
  assert.ok(shift.confidence > 0.5, `уверенность должна быть высокой: ${shift.confidence}`)
})

// ─── Кейс 2 из ТЗ: поток был, работа слабая ────────────────────────────────

test('поток на месте, а средний чек и допродажи просели — повод разбираться с продавцом', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 70_000,
      club_revenue: 300_000, // поток ровно как обычно
      receipts: 40,
      items: 44, // 1.1 товара на чек против 2
      attach_opportunities: 20,
      attach_success: 6, // 0.30 против 0.60
    }),
  )

  assert.equal(shift.verdict, 'POSSIBLE_CASHIER_ISSUE')
  assert.ok(shift.score !== null && shift.score < 0.95, `балл должен быть ниже нормы: ${shift.score}`)
})

// ─── Кейс 3 из ТЗ: касса большая, но вытянул её поток ──────────────────────

test('огромный поток и большая касса при низкой отдаче с потока — это не «топ»', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 150_000, // касса в полтора раза выше обычной
      club_revenue: 600_000, // но поток вдвое выше обычного
      receipts: 70,
      items: 140,
      attach_opportunities: 20,
      attach_success: 12,
    }),
  )

  assert.notEqual(shift.verdict, 'CASHIER_DRIVEN')
  const rpv = ratioOf(shift, 'revenue_per_club')
  assert.ok(rpv?.ratio != null && rpv.ratio < 1, 'отдача с потока должна быть ниже нормы')
})

// ─── Кейс 4 из ТЗ: маленький поток, маленькая касса, хорошая работа ────────

test('слабая смена по деньгам не мешает признать работу продавца хорошей', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 40_000,
      club_revenue: 100_000,
      receipts: 18,
      items: 42,
      attach_opportunities: 10,
      attach_success: 7,
    }),
  )

  assert.equal(shift.verdict, 'TRAFFIC_DRIVEN')
  // Мало чеков — это удар по уверенности, а не по баллу.
  assert.ok(shift.score !== null && shift.score >= 1, `балл: ${shift.score}`)
  assert.ok(shift.confidence < 0.86, `уверенность должна просесть: ${shift.confidence}`)
})

// ─── Кейс 5 из ТЗ: нет данных о потоке ─────────────────────────────────────

test('без выручки клуба метрики потока не выдумываются, а отключаются', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 90_000,
      club_revenue: null,
      receipts: 45,
    }),
  )

  assert.equal(ratioOf(shift, 'revenue_per_club')?.actual, null)
  assert.equal(ratioOf(shift, 'receipts_per_club')?.actual, null)
  assert.ok(shift.missing.some((m) => m.includes('Выручка на 1000')))
  // Метрики внутри чека остались — балл считается, но доверия к нему меньше.
  assert.ok(shift.score !== null)
  assert.ok(shift.confidence < 0.7, `уверенность обязана просесть: ${shift.confidence}`)
})

// ─── Главная ловушка учёта ─────────────────────────────────────────────────

test('чеки без позиций дают «нет данных», а не ноль товаров на чек', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 100_000,
      receipts: 50,
      items: 0, // магазин пробил сумму, не расписывая товары
      lines: 0,
      receipts_2plus: 0,
    }),
  )

  const items = ratioOf(shift, 'items_per_receipt')
  assert.equal(items?.actual, null)
  assert.equal(items?.ratio, null)
  assert.ok(shift.missing.some((m) => m.includes('Товаров на чек')))
})

// ─── Защита базы сравнения ─────────────────────────────────────────────────

test('продавца не сравнивают с базой, которую сформировал он сам', () => {
  const own = weekly('2026-01-05', 10).map((d) => fact(d, { cashier_id: 'A' }))
  const result = analyzeStoreKpi({
    baselineFacts: own,
    targetFacts: [fact('2026-03-16', { cashier_id: 'A', revenue: 60_000 })],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })

  // Вся история — его собственная, сравнивать не с кем: это «нет данных»,
  // а не «отработал ровно как всегда».
  assert.equal(result.shifts[0].score, null)
  assert.equal(result.shifts[0].verdict, 'INSUFFICIENT_DATA')
})

test('на выборке меньше минимальной ожидание не строится', () => {
  const thin = weekly('2026-01-05', 3).map((d) => fact(d))
  const result = analyzeStoreKpi({
    baselineFacts: thin,
    targetFacts: [fact('2026-03-16', { cashier_id: 'A' })],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })

  assert.equal(result.shifts[0].score, null)
  assert.equal(result.shifts[0].verdict, 'INSUFFICIENT_DATA')
})

// ─── Ограничение аномалий ──────────────────────────────────────────────────

test('разовая аномалия ограничивается клипом и не переворачивает балл', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      revenue: 300_000,
      club_revenue: 300_000,
      receipts: 50,
      items: 100,
    }),
  )

  const ticket = ratioOf(shift, 'avg_ticket')
  assert.ok(ticket?.raw_ratio != null && ticket.raw_ratio >= 2.9, 'сырое отношение сохраняется как есть')
  assert.equal(ticket?.ratio, DEFAULT_STORE_KPI_SETTINGS.ratio_clip_max)
})

// ─── Статус продавца ───────────────────────────────────────────────────────

test('после одной смены статус не присваивается', () => {
  const result = analyzeStoreKpi({
    baselineFacts: HISTORY,
    targetFacts: [fact('2026-03-16', { cashier_id: 'A', revenue: 130_000 })],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })

  assert.equal(result.cashiers[0].status, 'INSUFFICIENT_DATA')
})

test('набрав достаточно смен, сильный продавец получает статус', () => {
  const targets = weekly('2026-03-02', 8).map((d) =>
    fact(d, {
      cashier_id: 'A',
      revenue: 120_000,
      receipts: 50,
      items: 120,
      attach_opportunities: 20,
      attach_success: 16,
    }),
  )
  const result = analyzeStoreKpi({
    baselineFacts: HISTORY,
    targetFacts: targets,
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })

  const cashier = result.cashiers[0]
  assert.equal(cashier.shifts, 8)
  assert.ok(cashier.score !== null && cashier.score > 1.05, `балл: ${cashier.score}`)
  assert.ok(['STRONG', 'TOP'].includes(cashier.status), `статус: ${cashier.status}`)
  assert.ok(cashier.strengths.length > 0)
})

test('смена с тремя чеками не весит как смена с шестьюдесятью', () => {
  const big = fact('2026-03-02', { cashier_id: 'A', revenue: 120_000, receipts: 60, items: 150 })
  const tiny = fact('2026-03-09', { cashier_id: 'A', revenue: 3_000, receipts: 3, items: 3 })
  const result = analyzeStoreKpi({
    baselineFacts: HISTORY,
    targetFacts: [big, tiny],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  })

  const weighted = result.cashiers[0].score
  const shifts = result.shifts.map((s) => s.score).filter((s): s is number => s != null)
  const plain = shifts.reduce((a, b) => a + b, 0) / shifts.length
  assert.ok(weighted !== null && weighted > plain, 'крупная смена должна тянуть сильнее мелкой')
})

// ─── Допродажи ─────────────────────────────────────────────────────────────

test('возможность допродажи считается по исходной категории, успех — по целевой', () => {
  const rules = [
    { id: 'r1', source_category_id: 'ramen', target_category_id: 'drink', weight: 1, active: true },
  ]
  const receipts = [
    { categories: ['ramen', 'drink'] },
    { categories: ['ramen'] },
    { categories: ['drink'] }, // без рамена возможности не было
  ]

  assert.deepEqual(attachFromReceipts(receipts, rules), { opportunities: 2, success: 1 })
})

test('выключенное правило не создаёт возможностей', () => {
  const rules = [
    { id: 'r1', source_category_id: 'ramen', target_category_id: 'drink', weight: 1, active: false },
  ]
  assert.deepEqual(attachFromReceipts([{ categories: ['ramen'] }], rules), {
    opportunities: 0,
    success: 0,
  })
})

// ─── Настройки ─────────────────────────────────────────────────────────────

test('кривые настройки заменяются значениями по умолчанию, а не ломают расчёт', () => {
  const s = normalizeStoreKpiSettings({
    min_sample_size: 0,
    ratio_clip_min: 2, // больше максимума — перевёрнутый клип обессмыслил бы защиту
    ratio_clip_max: 1.3,
    weights: { avg_ticket: 'нет' },
  })

  assert.equal(s.min_sample_size, DEFAULT_STORE_KPI_SETTINGS.min_sample_size)
  assert.equal(s.ratio_clip_min, DEFAULT_STORE_KPI_SETTINGS.ratio_clip_min)
  assert.equal(s.weights.avg_ticket, DEFAULT_STORE_KPI_SETTINGS.weights.avg_ticket)
})

test('сводка по продавцу считает только его смены', () => {
  const shifts = analyzeStoreKpi({
    baselineFacts: HISTORY,
    targetFacts: [
      fact('2026-03-02', { cashier_id: 'A', revenue: 120_000 }),
      fact('2026-03-09', { cashier_id: 'B', revenue: 40_000 }),
    ],
    settings: DEFAULT_STORE_KPI_SETTINGS,
  }).shifts

  const a = summarizeCashier('A', shifts, DEFAULT_STORE_KPI_SETTINGS)
  assert.equal(a.shifts, 1)
  assert.equal(a.revenue, 120_000)
})
