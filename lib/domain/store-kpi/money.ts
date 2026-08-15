/**
 * Деньги модуля: месячный бонус и окупаемость бонусной программы.
 *
 * Цель бонусов — не сэкономить на выплатах, а получить прирост валовой
 * прибыли больше, чем стоит сама программа. Поэтому здесь считается не только
 * сколько выплачено, но и что это принесло.
 *
 * Вся арифметика детерминированная. ИИ к суммам не допускается ни на каком
 * этапе — он может объяснить результат, но не назначить его.
 */

import type { StoreKpiSettings } from './settings'
import type { CashierStatus, ShiftAnalysis } from './types'

/**
 * Месячный бонус за статус продавца.
 *
 * Не начисляется при «недостаточно данных»: платить за статус, которого мы не
 * смогли определить, нельзя ни в плюс, ни в минус.
 */
export function monthlyBonus(
  status: CashierStatus,
  settings: StoreKpiSettings,
): { amount: number; level: 'none' | 'strong' | 'top' } {
  if (status === 'TOP') return { amount: settings.monthly_bonus_top, level: 'top' }
  if (status === 'STRONG') return { amount: settings.monthly_bonus_strong, level: 'strong' }
  return { amount: 0, level: 'none' }
}

export type BonusRoi = {
  /** Смен, по которым можно было сравнить факт с нормой. */
  shifts: number
  /** Сумма выплат за период, ₸. */
  bonus_cost: number
  /**
   * Прирост выручки: факт минус норма для сопоставимых условий.
   * Может быть отрицательным — это тоже результат.
   */
  incremental_revenue: number
  /** Доля валовой прибыли в выручке за период. */
  gross_margin: number | null
  /** Прирост валовой прибыли, ₸. null — себестоимость неизвестна. */
  incremental_gross_profit: number | null
  /** Прирост прибыли минус стоимость бонусов. */
  net_effect: number | null
  /** Во сколько раз прирост прибыли покрывает выплаты. */
  roi: number | null
  /** Оговорки: где числа слабые и почему. */
  caveats: string[]
}

/**
 * Окупаемость бонусной программы.
 *
 * «Прирост» здесь — это отклонение факта от нормы, посчитанной по истории до
 * периода. Это не эксперимент с контрольной группой: если бы выручка выросла
 * и без бонусов (сезон, реклама, новый ассортимент), метод припишет рост
 * программе. Поэтому цифра идёт с оговорками, а не как доказательство.
 */
export function bonusRoi(
  shifts: ShiftAnalysis[],
  bonusCost: number,
  settings: StoreKpiSettings,
): BonusRoi {
  const comparable = shifts.filter((s) => s.expected_revenue != null && s.expected_revenue > 0)

  let actual = 0
  let expected = 0
  let revenue = 0
  let cogs = 0

  for (const s of comparable) {
    actual += s.fact.revenue
    expected += s.expected_revenue as number
  }
  for (const s of shifts) {
    revenue += s.fact.revenue
    cogs += s.fact.cogs
  }

  const incrementalRevenue = Math.round(actual - expected)
  const grossMargin = revenue > 0 && cogs > 0 ? Math.max(0, (revenue - cogs) / revenue) : null
  const incrementalGrossProfit =
    grossMargin != null ? Math.round(incrementalRevenue * grossMargin) : null

  const caveats: string[] = []
  if (comparable.length < settings.min_sample_size) {
    caveats.push(
      `Сравнимых смен всего ${comparable.length} — на такой выборке прирост считать рано.`,
    )
  }
  if (grossMargin == null) {
    caveats.push(
      'Себестоимость неизвестна, поэтому прирост прибыли не посчитан: без закупочных цен видно только выручку.',
    )
  }
  caveats.push(
    'Прирост считается как отклонение от нормы по прошлой истории. Это не контрольный эксперимент: рост из-за сезона, рекламы или нового ассортимента метод припишет бонусам.',
  )

  return {
    shifts: comparable.length,
    bonus_cost: Math.round(bonusCost),
    incremental_revenue: incrementalRevenue,
    gross_margin: grossMargin == null ? null : Math.round(grossMargin * 1000) / 1000,
    incremental_gross_profit: incrementalGrossProfit,
    net_effect: incrementalGrossProfit == null ? null : incrementalGrossProfit - Math.round(bonusCost),
    roi:
      incrementalGrossProfit == null || bonusCost <= 0
        ? null
        : Math.round((incrementalGrossProfit / bonusCost) * 100) / 100,
    caveats,
  }
}

/** Диагностические показатели периода — не входят в балл, но объясняют его. */
export type RetailDiagnostics = {
  receipts: number
  revenue: number
  gross_profit: number | null
  avg_ticket: number | null
  items_per_receipt: number | null
  receipts_2plus_rate: number | null
  receipts_3plus_rate: number | null
  discount_rate: number | null
  discounted_receipts_rate: number | null
  refund_rate: number | null
  unique_skus: number
}

export function retailDiagnostics(shifts: ShiftAnalysis[]): RetailDiagnostics {
  let receipts = 0
  let revenue = 0
  let gross = 0
  let cogs = 0
  let items = 0
  let two = 0
  let three = 0
  let discount = 0
  let discounted = 0
  let refunds = 0
  let skus = 0
  let withCogs = 0

  for (const s of shifts) {
    const f = s.fact
    receipts += f.receipts
    revenue += f.revenue
    gross += f.gross_revenue
    cogs += f.cogs
    items += f.items
    two += f.receipts_2plus
    three += f.receipts_3plus
    discount += f.discount_amount
    discounted += f.discounted_receipts
    refunds += f.refunds
    skus = Math.max(skus, f.unique_skus)
    if (f.cogs > 0) withCogs += 1
  }

  const div = (a: number, b: number) => (b > 0 ? a / b : null)

  return {
    receipts,
    revenue: Math.round(revenue),
    // Прибыль показываем только если себестоимость известна хотя бы где-то:
    // иначе получится «прибыль равна выручке», а это неправда.
    gross_profit: withCogs > 0 ? Math.round(revenue - cogs) : null,
    avg_ticket: div(revenue, receipts),
    items_per_receipt: items > 0 ? div(items, receipts) : null,
    receipts_2plus_rate: div(two, receipts),
    receipts_3plus_rate: div(three, receipts),
    discount_rate: div(discount, gross),
    discounted_receipts_rate: div(discounted, receipts),
    refund_rate: div(refunds, gross),
    unique_skus: skus,
  }
}
