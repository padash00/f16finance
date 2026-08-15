/**
 * Метрики продавца: что именно он контролирует.
 *
 * Число чеков в этот список не входит намеренно. Чек оставляет каждый
 * купивший, но привести людей в помещение продавец не может — количество
 * покупателей это спрос, а не качество работы. Поэтому все метрики здесь
 * считаются ВНУТРИ чека и от числа покупателей не зависят.
 *
 * Отдельная оговорка про `revenue_efficiency`. По формуле из ТЗ это
 *
 *     Выручка / (Чеки × ОжидаемыйСреднийЧек)
 *
 * а «Выручка / Чеки» и есть фактический средний чек. То есть метрика
 * тождественно равна отношению среднего чека к ожидаемому — тому же числу,
 * что и `avg_ticket`. Владелец решил оставить обе в баллах (25% + 15%),
 * зная об этом: так средний чек получает суммарный вес 40%. В интерфейсе
 * обе строки честно помечены как одно и то же измерение.
 */

import type { CrossSellRule, MetricKey, ShiftFact } from './types'

export const METRIC_KEYS: MetricKey[] = [
  'avg_ticket',
  'items_per_receipt',
  'attach_rate',
  'revenue_efficiency',
  'plan_attainment',
  'product_knowledge',
]

export const METRIC_LABELS: Record<MetricKey, string> = {
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  revenue_efficiency: 'Отдача с покупателя',
  plan_attainment: 'Выполнение плана',
  product_knowledge: 'Знание товара',
}

/**
 * Почему метрика недоступна — это показывается владельцу и уходит в AI,
 * чтобы никто не принял «нет данных» за «плохо сработал».
 */
export const METRIC_MISSING_REASON: Record<MetricKey, string> = {
  avg_ticket: 'в смене нет валидных чеков',
  items_per_receipt: 'чеки без позиций — товары в них не пробиты построчно',
  attach_rate: 'не настроены правила допродаж или у товаров нет категорий',
  revenue_efficiency: 'в смене нет валидных чеков',
  plan_attainment: 'нет сопоставимой истории, чтобы понять норму выручки',
  product_knowledge: 'тест на знание товара не сдавался',
}

/** Метрики, которые считаются от одного и того же измерения. */
export const METRIC_DUPLICATE_OF: Partial<Record<MetricKey, MetricKey>> = {
  revenue_efficiency: 'avg_ticket',
}

/**
 * Значение метрики для смены. null — посчитать не из чего.
 *
 * Ноль вместо null здесь был бы ошибкой: смена без пробитых позиций дала бы
 * «0 товаров на чек» и утащила продавца вниз за проблему учёта.
 *
 * `plan_attainment` и `product_knowledge` считаются не отсюда: первому нужна
 * норма выручки из базы, второму — результат теста.
 */
export function metricValue(fact: ShiftFact, metric: MetricKey): number | null {
  // Денежные метрики считаются в ценах базового месяца: иначе повышение цен
  // само по себе поднимало бы средний чек и выглядело работой продавца.
  const priceFactor = fact.price_index && fact.price_index > 0 ? fact.price_index : 1
  const realRevenue = fact.revenue / priceFactor

  switch (metric) {
    case 'avg_ticket':
    case 'revenue_efficiency':
      if (fact.receipts <= 0) return null
      return realRevenue / fact.receipts

    case 'items_per_receipt':
      // items === 0 означает «позиции не пробивались», а не «продали ноль штук»:
      // чеки-то есть. Считать это нулевой допродажей нельзя.
      if (fact.receipts <= 0 || fact.items <= 0) return null
      return fact.items / fact.receipts

    case 'attach_rate':
      if (fact.attach_opportunities <= 0) return null
      return fact.attach_success / fact.attach_opportunities

    case 'plan_attainment':
      if (fact.receipts <= 0) return null
      return realRevenue

    case 'product_knowledge':
      // Появится вместе с воротами по тесту знания товара.
      return null
  }
}

/** Число чеков — мера спроса. Считается отдельно от качества работы. */
export function demandValue(fact: ShiftFact): number | null {
  return fact.receipts > 0 ? fact.receipts : null
}

/** Чек в виде, нужном для допродаж: какие категории и товары в нём оказались. */
export type ReceiptContents = { categories: string[]; items?: string[] }

/**
 * Attach rate по правилам вида «рамен → напиток».
 *
 * Возможность засчитывается, когда в чеке есть исходная позиция правила;
 * успех — когда рядом оказалась целевая. Правило может ссылаться и на
 * категорию, и на конкретный товар: у ассортимента бывает и то и другое —
 * «любой напиток» это категория, а «фирменный соус» товар.
 */
export function attachFromReceipts(
  receipts: ReceiptContents[],
  rules: CrossSellRule[],
): { opportunities: number; success: number } {
  const active = rules.filter((r) => r.active && r.source_ref && r.target_ref)
  if (active.length === 0) return { opportunities: 0, success: 0 }

  let opportunities = 0
  let success = 0

  for (const receipt of receipts) {
    const categories = new Set(receipt.categories)
    const items = new Set(receipt.items || [])
    const has = (kind: 'category' | 'item', ref: string) =>
      kind === 'category' ? categories.has(ref) : items.has(ref)

    for (const rule of active) {
      if (!has(rule.source_kind, rule.source_ref)) continue
      const weight = rule.weight > 0 ? rule.weight : 1
      opportunities += weight
      if (has(rule.target_kind, rule.target_ref)) success += weight
    }
  }

  return { opportunities, success }
}

/** Доля чеков с двумя и более позициями — независимый признак допродаж. */
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
