/**
 * Ходовые товары и отсутствие их на витрине.
 *
 * Смысл в одном: продавец не может продать то, чего нет. Смена, в которой
 * половина витрины пустая, сравнивается с нормой, набранной по полной витрине,
 * и человек выглядит хуже, чем работал.
 *
 * Отмечать это руками бесполезно — в конце смены об этом никто не вспомнит.
 * Поэтому находит система.
 *
 * Два ограничения, которые здесь важнее точности.
 *
 * Первое: пустой остаток редкого товара — не стокаут. Если позицию берут раз в
 * две недели, её отсутствие ничего не меняет, а событие на каждую такую
 * позицию превратит журнал в шум, который перестанут читать.
 *
 * Второе: событие снижает уверенность в оценке, но НЕ меняет балл. Отсутствие
 * товара — не заслуга продавца и не его вина.
 */

/** Продажи одной позиции: в скольких днях окна она вообще продавалась. */
export type ItemSalesFrequency = {
  item_id: string
  name: string
  /** Дней с продажами этой позиции внутри окна. */
  days_with_sales: number
  /** Штук продано за окно — для порядка важности. */
  quantity: number
}

export type StockLevel = {
  item_id: string
  quantity: number
}

/**
 * Доля дней окна, начиная с которой позиция считается ходовой.
 *
 * 0.4 — то есть продавалась хотя бы в двух днях из пяти. Ниже порог опускать
 * нельзя: сезонная позиция, взятая пару раз, начнёт порождать события.
 */
export const REGULAR_ITEM_SHARE = 0.4

/** Минимум дней в окне, иначе доля считается по слишком короткой истории. */
export const MIN_WINDOW_DAYS = 14

export type StockoutCandidate = {
  item_id: string
  name: string
  days_with_sales: number
  quantity: number
}

/**
 * Ходовые позиции, которых сейчас нет на витрине.
 *
 * `windowDays` — длина окна, по которому считалась частота продаж. Короткое
 * окно возвращает пустой список: лучше не найти стокаут, чем объявить им
 * позицию, о которой мы ничего не знаем.
 */
export function findStockouts(args: {
  sales: ItemSalesFrequency[]
  stock: StockLevel[]
  windowDays: number
  minShare?: number
}): StockoutCandidate[] {
  if (args.windowDays < MIN_WINDOW_DAYS) return []

  const share = args.minShare ?? REGULAR_ITEM_SHARE
  const threshold = args.windowDays * share

  const onShelf = new Map<string, number>()
  for (const row of args.stock) onShelf.set(row.item_id, row.quantity)

  return args.sales
    .filter((item) => item.days_with_sales >= threshold)
    .filter((item) => {
      const quantity = onShelf.get(item.item_id)
      // Позиции нет в остатках вовсе — это тоже ноль на витрине: строку
      // заводят при первом приходе, и её отсутствие означает «не завозили».
      return quantity == null || quantity <= 0
    })
    .map((item) => ({
      item_id: item.item_id,
      name: item.name,
      days_with_sales: item.days_with_sales,
      quantity: item.quantity,
    }))
    // Сначала то, что берут чаще: если список придётся обрезать, обрежется
    // наименее важное.
    .sort((a, b) => b.days_with_sales - a.days_with_sales || b.quantity - a.quantity)
}

/** Заголовок события: перечисление с хвостом, а не список на десять строк. */
export function stockoutTitle(items: StockoutCandidate[], limit = 3): string {
  if (items.length === 0) return 'Нет ходовых позиций на витрине'
  const names = items.slice(0, limit).map((i) => i.name)
  const rest = items.length - names.length
  return `Нет на витрине: ${names.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`
}

/**
 * Насколько серьёзно отсутствие сказывается на смене.
 *
 * Не «сколько позиций пусто», а сколько из них ходовых: одна ежедневная
 * позиция мешает сильнее, чем пять редких.
 */
export function stockoutSeverity(items: StockoutCandidate[], windowDays: number): 'low' | 'medium' | 'high' {
  if (items.length === 0) return 'low'
  const daily = items.filter((i) => i.days_with_sales >= windowDays * 0.8).length
  if (daily >= 2 || items.length >= 5) return 'high'
  if (daily >= 1 || items.length >= 2) return 'medium'
  return 'low'
}
