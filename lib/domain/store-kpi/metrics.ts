/**
 * Метрики продавца: что именно он контролирует.
 *
 * Выручка смены в этот список не входит намеренно. Выручку делает поток и
 * продавец вместе, а мерить нужно вклад продавца. Поэтому все метрики здесь
 * либо нормированы на поток (на 1000 ₸ выручки клуба), либо считаются внутри
 * чека (средний чек, товаров на чек, допродажи) и от размера потока не зависят.
 */

import type { CrossSellRule, MetricKey, ShiftFact } from './types'

export const METRIC_KEYS: MetricKey[] = [
  'revenue_per_club',
  'receipts_per_club',
  'avg_ticket',
  'items_per_receipt',
  'attach_rate',
  'product_knowledge',
]

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue_per_club: 'Выручка на 1000 ₸ клуба',
  receipts_per_club: 'Чеков на 1000 ₸ клуба',
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  product_knowledge: 'Знание товара',
}

/**
 * Почему метрика недоступна — это показывается владельцу и уходит в AI,
 * чтобы никто не принял «нет данных» за «плохо сработал».
 */
export const METRIC_MISSING_REASON: Record<MetricKey, string> = {
  revenue_per_club: 'нет выручки клуба за эту смену — поток измерить нечем',
  receipts_per_club: 'нет выручки клуба за эту смену — поток измерить нечем',
  avg_ticket: 'в смене нет валидных чеков',
  items_per_receipt: 'чеки без позиций — товары в них не пробиты построчно',
  attach_rate: 'не настроены правила допродаж или у товаров нет категорий',
  product_knowledge: 'тест на знание товара не сдавался',
}

/** Масштаб нормировки на поток: «на 1000 ₸ выручки клуба». */
export const CLUB_REVENUE_UNIT = 1000

/**
 * Значение метрики для смены. null — посчитать не из чего.
 *
 * Ноль вместо null здесь был бы ошибкой: смена без пробитых позиций дала бы
 * «0 товаров на чек» и утащила продавца вниз за проблему учёта.
 */
export function metricValue(fact: ShiftFact, metric: MetricKey): number | null {
  switch (metric) {
    case 'revenue_per_club':
      if (!fact.club_revenue || fact.club_revenue <= 0) return null
      return (fact.revenue / fact.club_revenue) * CLUB_REVENUE_UNIT

    case 'receipts_per_club':
      if (!fact.club_revenue || fact.club_revenue <= 0) return null
      return (fact.receipts / fact.club_revenue) * CLUB_REVENUE_UNIT

    case 'avg_ticket':
      if (fact.receipts <= 0) return null
      return fact.revenue / fact.receipts

    case 'items_per_receipt':
      // items === 0 означает «позиции не пробивались», а не «продали ноль штук»:
      // чеки-то есть. Считать это нулевой допродажей нельзя.
      if (fact.receipts <= 0 || fact.items <= 0) return null
      return fact.items / fact.receipts

    case 'attach_rate':
      if (fact.attach_opportunities <= 0) return null
      return fact.attach_success / fact.attach_opportunities

    case 'product_knowledge':
      // Появится вместе с воротами по тесту знания товара (следующая фаза).
      return null
  }
}

/** Чек в виде, нужном для допродаж: какие категории в нём оказались. */
export type ReceiptCategories = { categories: string[] }

/**
 * Attach rate по правилам вида «рамен → напиток».
 *
 * Возможность засчитывается, когда в чеке есть исходная категория; успех —
 * когда рядом оказалась целевая. Категории правил задаёт администратор:
 * зашивать «рамен» и «напиток» в код нельзя, у каждой точки свой ассортимент.
 */
export function attachFromReceipts(
  receipts: ReceiptCategories[],
  rules: CrossSellRule[],
): { opportunities: number; success: number } {
  const active = rules.filter((r) => r.active && r.source_category_id && r.target_category_id)
  if (active.length === 0) return { opportunities: 0, success: 0 }

  let opportunities = 0
  let success = 0

  for (const receipt of receipts) {
    const inReceipt = new Set(receipt.categories)
    for (const rule of active) {
      if (!inReceipt.has(rule.source_category_id)) continue
      const weight = rule.weight > 0 ? rule.weight : 1
      opportunities += weight
      if (inReceipt.has(rule.target_category_id)) success += weight
    }
  }

  return { opportunities, success }
}

/** Доля чеков с двумя и более строками — диагностическая метрика допродаж. */
export function multiLineRate(fact: ShiftFact): number | null {
  if (fact.receipts <= 0) return null
  if (fact.lines <= 0) return null
  return fact.receipts_2plus / fact.receipts
}

/** Доля возвратов в обороте — сигнал аномалии, а не оценка продавца. */
export function refundRate(fact: ShiftFact): number | null {
  if (fact.gross_revenue <= 0) return null
  return fact.refunds / fact.gross_revenue
}
