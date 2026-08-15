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
//   покупателей (чеков)          50
//   выручка смены           100 000 ₸
//   средний чек               2 000 ₸
//   товаров на чек                  2
//   допродажи                    0.60

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

// ─── Кейс 1 из ТЗ: мало покупателей при хорошей работе ──────────────────────

test('мало чеков, но с каждым отработали хорошо — виноват спрос, а не продавец', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 30, // покупателей вдвое меньше обычного
      revenue: 66_600, // средний чек 2220 — выше нормы
      items: 72, // 2.4 товара на чек
      attach_opportunities: 12,
      attach_success: 9, // 0.75 против 0.60
    }),
  )

  assert.equal(shift.verdict, 'LOW_DEMAND')
  assert.ok(shift.score !== null && shift.score >= 1, `балл продавца не должен просесть: ${shift.score}`)
})

// ─── Кейс 2 из ТЗ: покупатели были, работа слабая ──────────────────────────

test('покупателей больше обычного, а чек и допродажи просели — вопрос к продавцу', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 60,
      revenue: 78_000, // средний чек 1300 против 2000
      items: 66, // 1.1 товара на чек против 2
      attach_opportunities: 24,
      attach_success: 6, // 0.25 против 0.60
    }),
  )

  assert.equal(shift.verdict, 'POSSIBLE_CASHIER_ISSUE')
  assert.ok(shift.score !== null && shift.score < 0.95, `балл должен быть ниже нормы: ${shift.score}`)
})

// ─── Кейс 3 из ТЗ: кассу вытянул поток покупателей ─────────────────────────

test('много покупателей и большая касса при обычном качестве продаж — не заслуга продавца', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 75, // в полтора раза больше покупателей
      revenue: 142_500, // касса выросла ровно за счёт их числа
      items: 150, // качество продаж осталось обычным
      attach_opportunities: 30,
      attach_success: 18,
    }),
  )

  assert.equal(shift.verdict, 'HIGH_DEMAND')
  assert.notEqual(shift.verdict, 'STRONG_CASHIER')
})

// ─── Кейс 4 из ТЗ: сильная работа ──────────────────────────────────────────

test('при обычном числе покупателей выжали больше — сильная смена', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 50,
      revenue: 120_000, // средний чек 2400
      items: 130, // 2.6 товара на чек
      attach_opportunities: 20,
      attach_success: 15, // 0.75
    }),
  )

  assert.equal(shift.verdict, 'STRONG_CASHIER')
  assert.ok(shift.score !== null && shift.score >= 1.05, `балл: ${shift.score}`)
})

// ─── Кейс 5 из ТЗ: нет позиций в чеках ─────────────────────────────────────

test('чеки без позиций дают «нет данных», а не ноль товаров и ноль допродаж', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 50,
      revenue: 100_000,
      items: 0, // магазин пробил сумму, не расписывая товары
      lines: 0,
      receipts_2plus: 0,
      attach_opportunities: 0,
      attach_success: 0,
    }),
  )

  assert.equal(ratioOf(shift, 'items_per_receipt')?.actual, null)
  assert.equal(ratioOf(shift, 'attach_rate')?.actual, null)
  assert.ok(shift.missing.some((m) => m.includes('Товаров на чек')))
  assert.ok(shift.missing.some((m) => m.includes('Допродажи')))
  // Метрики чека остались — балл считается, но доверия к нему меньше.
  assert.ok(shift.score !== null)
  assert.ok(shift.confidence < 0.75, `уверенность обязана просесть: ${shift.confidence}`)
})

test('мало чеков бьёт по уверенности, а не по баллу', () => {
  const shift = analyzeOne(
    fact('2026-03-16', {
      cashier_id: 'A',
      receipts: 8,
      revenue: 20_000, // средний чек 2500 — выше нормы
      items: 24,
      attach_opportunities: 4,
      attach_success: 3,
    }),
  )

  assert.ok(shift.score !== null && shift.score > 1, `балл: ${shift.score}`)
  assert.ok(shift.confidence < 0.8, `уверенность: ${shift.confidence}`)
})

// ─── Отдача с покупателя дублирует средний чек ─────────────────────────────

test('отдача с покупателя — то же измерение, что и средний чек', () => {
  // Так решено в ТЗ осознанно: средний чек получает суммарный вес 40%.
  // Тест держит это явным, чтобы расхождение сразу бросалось в глаза.
  const shift = analyzeOne(fact('2026-03-16', { cashier_id: 'A', receipts: 40, revenue: 96_000 }))
  assert.equal(ratioOf(shift, 'revenue_efficiency')?.raw_ratio, ratioOf(shift, 'avg_ticket')?.raw_ratio)
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
    fact('2026-03-16', { cashier_id: 'A', receipts: 50, revenue: 300_000, items: 100 }),
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
      receipts: 50,
      revenue: 120_000,
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

const RULE = {
  id: 'r1',
  source_kind: 'category' as const,
  source_ref: 'ramen',
  target_kind: 'category' as const,
  target_ref: 'drink',
  weight: 1,
  active: true,
}

test('возможность допродажи считается по исходной позиции, успех — по целевой', () => {
  const receipts = [
    { categories: ['ramen', 'drink'] },
    { categories: ['ramen'] },
    { categories: ['drink'] }, // без рамена возможности не было
  ]

  assert.deepEqual(attachFromReceipts(receipts, [RULE]), { opportunities: 2, success: 1 })
})

test('правило может ссылаться на конкретный товар, а не только на категорию', () => {
  const rule = {
    ...RULE,
    id: 'r2',
    source_kind: 'item' as const,
    source_ref: 'item-ramen-spicy',
    target_kind: 'category' as const,
    target_ref: 'drink',
  }
  const receipts = [
    { categories: ['ramen', 'drink'], items: ['item-ramen-spicy'] },
    { categories: ['ramen'], items: ['item-ramen-mild'] }, // другой товар — не считается
  ]

  assert.deepEqual(attachFromReceipts(receipts, [rule]), { opportunities: 1, success: 1 })
})

test('выключенное правило не создаёт возможностей', () => {
  assert.deepEqual(attachFromReceipts([{ categories: ['ramen'] }], [{ ...RULE, active: false }]), {
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
