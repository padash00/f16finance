/**
 * Индекс цен: приведение денег разных месяцев к сопоставимому виду.
 *
 * Зачем. После повышения цен средний чек растёт сам по себе — товаров в чеке
 * столько же, а денег больше. Без поправки модель прочитает это как «вся
 * команда разом стала работать лучше», а после отката цен — как общий провал.
 * Ни то, ни другое к работе продавцов отношения не имеет.
 *
 * Как считается. Классическая фиксированная корзина (индекс Ласпейреса):
 * берём набор товаров базового месяца и считаем, во сколько обошёлся бы тот же
 * набор по ценам целевого месяца.
 *
 *     индекс(месяц) = Σ(цена_месяца × количество_базы) / Σ(цена_базы × количество_базы)
 *
 * Количество берётся базовое намеренно: если брать текущее, индекс начнёт
 * реагировать на то, ЧТО продавали, а не на то, СКОЛЬКО это стоило — то есть
 * ровно на поведение продавца, которое мы и пытаемся отделить.
 *
 * Где применяется. Денежные метрики продавца сравниваются в ценах базы, а
 * бонусные пороги, наоборот, объявляются в сегодняшних деньгах: человек
 * зарабатывает тенге по нынешним ценникам, а не по прошлогодним.
 */

export type PriceHistoryRow = {
  month: string
  item_id: string
  avg_price: number
  quantity: number
  revenue: number
}

export type PriceIndexPoint = {
  month: string
  /** Во сколько раз тот же набор товаров стал дороже базового месяца. */
  index: number
  /** Какую долю выручки месяца покрывает корзина, 0..1. */
  coverage: number
  /** Сколько позиций попало в корзину. */
  basket_size: number
  /** Можно ли этим пользоваться. */
  usable: boolean
}

export type PriceIndex = {
  base_month: string | null
  points: Map<string, PriceIndexPoint>
  /** Пояснение для интерфейса и для AI. */
  note: string
}

/** Минимум позиций в корзине, иначе индекс — случайное число. */
const MIN_BASKET = 5
/** Минимальная доля выручки, которую должна покрывать корзина. */
const MIN_COVERAGE = 0.5
/**
 * Границы правдоподобия. Скачок цен вдвое за месяц скорее означает смену
 * ассортимента или ошибку в данных, чем настоящую инфляцию.
 */
const INDEX_MIN = 0.5
const INDEX_MAX = 2

/** Нейтральный индекс: применять нечего, но и ломаться незачем. */
export const NEUTRAL_PRICE_INDEX: PriceIndex = {
  base_month: null,
  points: new Map(),
  note: 'Индекс цен не считался: недостаточно истории продаж.',
}

/**
 * Строит индекс по истории цен.
 *
 * Базовый месяц — самый ранний с достаточной корзиной. Все сравнения ведутся
 * в его ценах.
 */
export function buildPriceIndex(rows: PriceHistoryRow[]): PriceIndex {
  if (rows.length === 0) return NEUTRAL_PRICE_INDEX

  const byMonth = new Map<string, Map<string, PriceHistoryRow>>()
  for (const row of rows) {
    if (!(row.avg_price > 0) || !(row.quantity > 0)) continue
    const monthMap = byMonth.get(row.month) || new Map<string, PriceHistoryRow>()
    monthMap.set(row.item_id, row)
    byMonth.set(row.month, monthMap)
  }

  const months = [...byMonth.keys()].sort()
  if (months.length === 0) return NEUTRAL_PRICE_INDEX

  // База — первый месяц, где корзина достаточно широкая.
  const baseMonth = months.find((m) => (byMonth.get(m)?.size ?? 0) >= MIN_BASKET) ?? months[0]
  const base = byMonth.get(baseMonth)!

  const points = new Map<string, PriceIndexPoint>()

  for (const month of months) {
    const current = byMonth.get(month)!
    let currentCost = 0
    let baseCost = 0
    let covered = 0
    let basketSize = 0

    for (const [itemId, baseRow] of base) {
      const row = current.get(itemId)
      if (!row) continue
      // Количество базового месяца — фиксированная корзина.
      currentCost += row.avg_price * baseRow.quantity
      baseCost += baseRow.avg_price * baseRow.quantity
      covered += row.revenue
      basketSize += 1
    }

    const monthRevenue = [...current.values()].reduce((sum, r) => sum + r.revenue, 0)
    const coverage = monthRevenue > 0 ? covered / monthRevenue : 0
    const raw = baseCost > 0 ? currentCost / baseCost : 1
    const usable =
      basketSize >= MIN_BASKET && coverage >= MIN_COVERAGE && raw >= INDEX_MIN && raw <= INDEX_MAX

    points.set(month, {
      month,
      index: usable ? Math.round(raw * 1000) / 1000 : 1,
      coverage: Math.round(coverage * 100) / 100,
      basket_size: basketSize,
      usable,
    })
  }

  return {
    base_month: baseMonth,
    points,
    note: `Цены приведены к ${baseMonth}. Корзина — товары, продававшиеся и тогда, и в сравниваемом месяце.`,
  }
}

/**
 * Множитель цен для конкретной даты.
 *
 * Возвращает 1, когда индекса нет или ему нельзя верить: лучше не поправлять
 * вовсе, чем поправлять выдуманным числом.
 */
export function priceIndexFor(index: PriceIndex, date: string): number {
  const point = index.points.get(date.slice(0, 7))
  return point && point.usable ? point.index : 1
}

/** Приводит сумму к ценам базового месяца. */
export function deflate(value: number, factor: number): number {
  return factor > 0 ? value / factor : value
}
