/**
 * Мост между экзаменом и оценкой продавца.
 *
 * Проверяется главное ограничение: несданный или непроведённый экзамен не
 * должен превращаться в ноль. Ноль означал бы «знает на ноль» и утащил бы
 * человека вниз за то, чего он не делал, — а на деле мы просто не проверяли.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { metricValue, type ShiftFact } from '@/lib/domain/store-kpi'

function fact(patch: Partial<ShiftFact> = {}): ShiftFact {
  return {
    company_id: 'c1',
    date: '2026-08-01',
    shift: 'day',
    cashier_id: 'op1',
    revenue: 50_000,
    gross_revenue: 50_000,
    refunds: 0,
    receipts: 40,
    items: 60,
    lines: 60,
    receipts_2plus: 20,
    receipts_3plus: 5,
    attach_opportunities: 10,
    attach_success: 4,
    cogs: 20_000,
    discount_amount: 0,
    discounted_receipts: 0,
    unique_skus: 12,
    price_index: 1,
    ...patch,
  } as ShiftFact
}

test('экзамен не сдавали — метрика пустая, а не нулевая', () => {
  assert.equal(metricValue(fact({ exam_score: null }), 'product_knowledge'), null)
  assert.equal(metricValue(fact(), 'product_knowledge'), null)
})

test('сданный экзамен становится метрикой', () => {
  assert.equal(metricValue(fact({ exam_score: 0.85 }), 'product_knowledge'), 0.85)
})

test('ноль баллов — это ноль, а не отсутствие данных', () => {
  // Разница принципиальная: человек прошёл тест и не ответил ни на что — это
  // результат, и прятать его нельзя.
  assert.equal(metricValue(fact({ exam_score: 0 }), 'product_knowledge'), 0)
})

test('экзамен не влияет на остальные метрики', () => {
  // Знание товара не должно подмешиваться в средний чек и допродажи: это
  // разные вещи, и смешать их значит потерять обе.
  const withExam = fact({ exam_score: 1 })
  const without = fact({ exam_score: null })

  assert.equal(metricValue(withExam, 'avg_ticket'), metricValue(without, 'avg_ticket'))
  assert.equal(metricValue(withExam, 'attach_rate'), metricValue(without, 'attach_rate'))
})
