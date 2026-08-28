/**
 * Свод остатков точки: строки `inventory_balances` двух локаций (склад и
 * витрина) → одна позиция на товар.
 *
 * Логика жила двумя копиями внутри роутов склада и витрины — одинаковая по суте,
 * но с разными именами полей, и проверить её было нечем. Здесь она чистая:
 * на вход строки, на выход позиции, никакой базы.
 */

export type StockBalanceRow = {
  item_id: string | null
  location_id: string
  quantity: unknown
  quantity_reserved?: unknown
  updated_at: string
  item?: unknown
}

export type ItemStock = {
  item_id: string
  item: unknown
  warehouse_quantity: number
  warehouse_reserved: number
  showcase_quantity: number
  updated_at: string
}

/**
 * Сгруппировать строки остатков по товару.
 *
 * Строки чужих локаций игнорируются: запрос уже ограничен двумя нужными, но
 * функция не обязана этому верить. Порядок результата — порядок первого
 * появления товара во входных строках.
 */
export function groupStockByItem(
  rows: StockBalanceRow[],
  locations: { warehouseId: string; showcaseId: string },
): ItemStock[] {
  const byItem = new Map<string, ItemStock>()

  for (const row of rows || []) {
    const itemId = row?.item_id
    if (!itemId) continue

    let bucket = byItem.get(itemId)
    if (!bucket) {
      bucket = {
        item_id: itemId,
        item: row.item,
        warehouse_quantity: 0,
        warehouse_reserved: 0,
        showcase_quantity: 0,
        updated_at: row.updated_at,
      }
      byItem.set(itemId, bucket)
    }

    if (row.location_id === locations.warehouseId) {
      bucket.warehouse_quantity = Number(row.quantity) || 0
      bucket.warehouse_reserved = Number(row.quantity_reserved) || 0
    } else if (row.location_id === locations.showcaseId) {
      bucket.showcase_quantity = Number(row.quantity) || 0
    }

    // Отдаём самую свежую отметку из строк товара: страница показывает её как
    // «когда позицию трогали в последний раз».
    if (row.updated_at > bucket.updated_at) bucket.updated_at = row.updated_at
  }

  return Array.from(byItem.values())
}

/**
 * Вид для страницы склада: показываем то, что лежит на складе, самое крупное
 * сверху. Каталог точки — это склад плюс витрина, отдельной локации у него нет.
 *
 * Позиция с нулём на складе, но с резервом, остаётся в списке: товар обещан по
 * заявке, и пропасть с экрана он не должен.
 */
export function warehouseStockView(stock: ItemStock[]) {
  return stock
    .map((row) => ({
      ...row,
      warehouse_available: Math.max(0, row.warehouse_quantity - row.warehouse_reserved),
      catalog_quantity: row.warehouse_quantity + row.showcase_quantity,
      // back-compat: интерфейс читает quantity как общий остаток точки
      quantity: row.warehouse_quantity + row.showcase_quantity,
    }))
    .filter((row) => row.warehouse_quantity > 0 || row.warehouse_reserved > 0)
    .sort((a, b) => b.warehouse_quantity - a.warehouse_quantity)
}

/** Вид для страницы витрины: только выставленное, самое крупное сверху. */
export function showcaseStockView(stock: ItemStock[]) {
  return stock
    .map((row) => ({
      item_id: row.item_id,
      item: row.item,
      warehouse_quantity: row.warehouse_quantity,
      point_display_quantity: row.showcase_quantity,
      updated_at: row.updated_at,
      showcase_quantity: row.showcase_quantity,
      // back-compat: интерфейс витрины читает quantity как остаток витрины
      quantity: row.showcase_quantity,
    }))
    .filter((row) => row.showcase_quantity > 0)
    .sort((a, b) => b.showcase_quantity - a.showcase_quantity)
}

/** Что можно выдать со склада — список для выпадашки заявки с витрины. */
export function warehouseAvailableItems(stock: ItemStock[]) {
  return stock
    .filter((row) => row.warehouse_quantity > 0)
    .map((row) => ({ item_id: row.item_id, item: row.item, quantity: row.warehouse_quantity }))
}
