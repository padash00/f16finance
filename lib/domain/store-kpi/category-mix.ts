/**
 * Структура продаж по категориям.
 *
 * В балл продавца не входит — это диагностика. Но она часто и объясняет балл:
 * «средний чек просел» и «продавали в основном напитки вместо горячего» — одно
 * и то же наблюдение с разных сторон.
 *
 * Полезен здесь не столько общий набор точки, сколько отклонение конкретного
 * человека от него. «У тебя доля горячего вдвое ниже, чем у остальных» — это
 * разговор по существу, в отличие от «работай лучше».
 *
 * Осторожность в формулировках обязательна: отклонение может объясняться не
 * продавцом, а сменой (ночью берут другое), отсутствием товара или тем, что
 * человек работал в другие дни. Поэтому модуль показывает факт и оставляет
 * толкование управляющему.
 */

export type CategorySalesRow = {
  category_id: string | null
  category_name: string
  cashier_id: string | null
  revenue: number
  quantity: number
  lines: number
}

export type CategoryShare = {
  category_id: string | null
  category_name: string
  revenue: number
  /** Доля в выручке, 0..1. */
  share: number
}

export type CashierMixDeviation = {
  cashier_id: string
  revenue: number
  /** Категории, где продавец сильнее всего отличается от точки. */
  notable: {
    category_id: string | null
    category_name: string
    share: number
    point_share: number
    /** Разница в процентных пунктах: >0 — продаёт больше остальных. */
    delta_pp: number
  }[]
}

/** Доля каждой категории в выручке. */
export function categoryShares(rows: CategorySalesRow[]): CategoryShare[] {
  const byCategory = new Map<string, CategoryShare>()
  let total = 0

  for (const row of rows) {
    const key = row.category_id ?? 'none'
    const current = byCategory.get(key) || {
      category_id: row.category_id,
      category_name: row.category_name,
      revenue: 0,
      share: 0,
    }
    current.revenue += row.revenue
    byCategory.set(key, current)
    total += row.revenue
  }

  const out = [...byCategory.values()]
  for (const c of out) c.share = total > 0 ? Math.round((c.revenue / total) * 1000) / 1000 : 0
  return out.sort((a, b) => b.revenue - a.revenue)
}

/**
 * Чем продавцы отличаются от точки в целом.
 *
 * `minRevenue` отсекает тех, у кого выручки слишком мало: на паре чеков любая
 * структура выглядит перекошенной, и говорить об этом человеку бессмысленно.
 */
export function cashierMixDeviations(
  rows: CategorySalesRow[],
  opts: { minRevenue?: number; topN?: number } = {},
): CashierMixDeviation[] {
  const minRevenue = opts.minRevenue ?? 50_000
  const topN = opts.topN ?? 3

  const pointShares = new Map(categoryShares(rows).map((c) => [c.category_id ?? 'none', c.share]))

  const byCashier = new Map<string, CategorySalesRow[]>()
  for (const row of rows) {
    if (!row.cashier_id) continue
    const list = byCashier.get(row.cashier_id) || []
    list.push(row)
    byCashier.set(row.cashier_id, list)
  }

  const out: CashierMixDeviation[] = []

  for (const [cashierId, list] of byCashier) {
    const revenue = list.reduce((sum, r) => sum + r.revenue, 0)
    if (revenue < minRevenue) continue

    const shares = categoryShares(list)
    const notable = shares
      .map((c) => {
        const pointShare = pointShares.get(c.category_id ?? 'none') ?? 0
        return {
          category_id: c.category_id,
          category_name: c.category_name,
          share: c.share,
          point_share: pointShare,
          delta_pp: Math.round((c.share - pointShare) * 1000) / 10,
        }
      })
      // Отклонения меньше трёх процентных пунктов — шум, о них говорить не о чем.
      .filter((c) => Math.abs(c.delta_pp) >= 3)
      .sort((a, b) => Math.abs(b.delta_pp) - Math.abs(a.delta_pp))
      .slice(0, topN)

    out.push({ cashier_id: cashierId, revenue: Math.round(revenue), notable })
  }

  return out.sort((a, b) => b.revenue - a.revenue)
}
