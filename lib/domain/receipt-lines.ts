/**
 * Свод строк накладной по товару.
 *
 * Зачем это отдельным модулем: один товар может идти в накладной несколькими
 * строками с разной закупочной ценой — часть по обычной, часть по акции.
 * У поставщика это разные номенклатурные номера, у нас — один товар каталога.
 *
 * Раньше строки складывались в Map по item_id и побеждала последняя: в карточку
 * уезжала акционная цена, и система считала, что весь объём куплен дёшево.
 * Себестоимость занижалась, прибыль завышалась — а по default_purchase_price
 * считаются маржа, бизнес-аналитика, план закупа и себестоимость техкарт.
 */

export type ReceiptPriceLine = {
  item_id: string
  quantity: number
  unit_cost: number
  sale_price: number | null
}

export type FoldedPrice = {
  item_id: string
  unit_cost: number
  sale_price: number | null
}

/**
 * Закупочная цена — средневзвешенная по количеству:
 *
 *     (48 шт × 417 ₸ + 24 шт × 220 ₸) / 72 шт = 351,33 ₸
 *
 * Цена продажи не усредняется: это розничное решение, а не арифметика.
 * Берём её из строки с наибольшим количеством — доминирующая партия задаёт
 * ценник.
 *
 * Для одной строки на товар поведение не меняется вообще: средневзвешенная от
 * одного значения равна ему самому.
 */
export function foldReceiptLinesByItem(rows: ReceiptPriceLine[]): FoldedPrice[] {
  type Acc = {
    qty: number
    cost: number
    lastCost: number
    sale_price: number | null
    saleQty: number
  }
  const acc = new Map<string, Acc>()

  for (const row of rows) {
    const itemId = String(row?.item_id || '').trim()
    if (!itemId) continue

    const qty = Number.isFinite(row.quantity) && row.quantity > 0 ? row.quantity : 0
    const cost = Number.isFinite(row.unit_cost) && row.unit_cost > 0 ? row.unit_cost : 0

    const prev = acc.get(itemId)
    if (!prev) {
      acc.set(itemId, {
        qty,
        cost: qty * cost,
        lastCost: cost,
        sale_price: row.sale_price,
        saleQty: row.sale_price != null ? qty : -1,
      })
      continue
    }

    prev.qty += qty
    prev.cost += qty * cost
    if (cost > 0) prev.lastCost = cost
    if (row.sale_price != null && qty > prev.saleQty) {
      prev.sale_price = row.sale_price
      prev.saleQty = qty
    }
  }

  return [...acc.entries()].map(([item_id, r]) => ({
    item_id,
    // Все строки с нулевым количеством (редкий случай) — не обнуляем
    // себестоимость, оставляем последнюю ненулевую цену.
    unit_cost: r.qty > 0 ? Math.round((r.cost / r.qty) * 100) / 100 : r.lastCost,
    sale_price: r.sale_price,
  }))
}
