import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupStockByItem,
  showcaseStockView,
  warehouseAvailableItems,
  warehouseStockView,
  type StockBalanceRow,
} from '@/lib/domain/inventory-balances'

const WH = 'wh-1'
const SC = 'sc-1'

const row = (over: Partial<StockBalanceRow> & { item_id: string; location_id: string }): StockBalanceRow => ({
  quantity: 0,
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

test('свод: склад и витрина одного товара — одна позиция', () => {
  const stock = groupStockByItem(
    [
      row({ item_id: 'a', location_id: WH, quantity: 7, quantity_reserved: 2 }),
      row({ item_id: 'a', location_id: SC, quantity: 3 }),
    ],
    { warehouseId: WH, showcaseId: SC },
  )

  assert.equal(stock.length, 1)
  assert.deepEqual(
    { wh: stock[0].warehouse_quantity, res: stock[0].warehouse_reserved, sc: stock[0].showcase_quantity },
    { wh: 7, res: 2, sc: 3 },
  )
})

test('свод: строки чужих локаций не попадают в остаток', () => {
  const stock = groupStockByItem(
    [
      row({ item_id: 'a', location_id: WH, quantity: 5 }),
      row({ item_id: 'a', location_id: 'чужой-склад', quantity: 100 }),
    ],
    { warehouseId: WH, showcaseId: SC },
  )

  assert.equal(stock[0].warehouse_quantity, 5)
  assert.equal(stock[0].showcase_quantity, 0)
})

test('свод: берётся самая свежая отметка времени', () => {
  const stock = groupStockByItem(
    [
      row({ item_id: 'a', location_id: WH, quantity: 1, updated_at: '2026-01-01T00:00:00Z' }),
      row({ item_id: 'a', location_id: SC, quantity: 1, updated_at: '2026-03-05T12:00:00Z' }),
    ],
    { warehouseId: WH, showcaseId: SC },
  )

  assert.equal(stock[0].updated_at, '2026-03-05T12:00:00Z')
})

test('свод: строка без товара пропускается', () => {
  const stock = groupStockByItem(
    [{ item_id: null, location_id: WH, quantity: 9, updated_at: '2026-01-01T00:00:00Z' }],
    { warehouseId: WH, showcaseId: SC },
  )

  assert.equal(stock.length, 0)
})

test('склад: каталог точки — это склад плюс витрина', () => {
  const view = warehouseStockView(
    groupStockByItem(
      [
        row({ item_id: 'a', location_id: WH, quantity: 4 }),
        row({ item_id: 'a', location_id: SC, quantity: 6 }),
      ],
      { warehouseId: WH, showcaseId: SC },
    ),
  )

  assert.equal(view[0].catalog_quantity, 10)
  assert.equal(view[0].quantity, 10)
})

test('склад: доступно = остаток минус резерв, и никогда не минус', () => {
  const view = warehouseStockView(
    groupStockByItem(
      [
        row({ item_id: 'a', location_id: WH, quantity: 10, quantity_reserved: 3 }),
        row({ item_id: 'b', location_id: WH, quantity: 1, quantity_reserved: 5 }),
      ],
      { warehouseId: WH, showcaseId: SC },
    ),
  )

  const byId = Object.fromEntries(view.map((r) => [r.item_id, r.warehouse_available]))
  assert.equal(byId.a, 7)
  assert.equal(byId.b, 0)
})

test('склад: позиция с нулём, но с резервом остаётся в списке', () => {
  // Товар обещан по заявке — пропасть с экрана склада он не должен.
  const view = warehouseStockView(
    groupStockByItem(
      [row({ item_id: 'a', location_id: WH, quantity: 0, quantity_reserved: 2 })],
      { warehouseId: WH, showcaseId: SC },
    ),
  )

  assert.equal(view.length, 1)
  assert.equal(view[0].warehouse_available, 0)
})

test('склад: только витрина — на складе не показываем', () => {
  const view = warehouseStockView(
    groupStockByItem([row({ item_id: 'a', location_id: SC, quantity: 5 })], { warehouseId: WH, showcaseId: SC }),
  )

  assert.equal(view.length, 0)
})

test('склад: крупные остатки сверху', () => {
  const view = warehouseStockView(
    groupStockByItem(
      [
        row({ item_id: 'мало', location_id: WH, quantity: 2 }),
        row({ item_id: 'много', location_id: WH, quantity: 50 }),
        row({ item_id: 'средне', location_id: WH, quantity: 10 }),
      ],
      { warehouseId: WH, showcaseId: SC },
    ),
  )

  assert.deepEqual(view.map((r) => r.item_id), ['много', 'средне', 'мало'])
})

test('витрина: показываем только выставленное', () => {
  const stock = groupStockByItem(
    [
      row({ item_id: 'на-витрине', location_id: SC, quantity: 3 }),
      row({ item_id: 'только-склад', location_id: WH, quantity: 8 }),
    ],
    { warehouseId: WH, showcaseId: SC },
  )
  const view = showcaseStockView(stock)

  assert.deepEqual(view.map((r) => r.item_id), ['на-витрине'])
  // back-compat: интерфейс витрины читает quantity как остаток витрины
  assert.equal(view[0].quantity, 3)
  assert.equal(view[0].point_display_quantity, 3)
})

test('витрина: список для заявки — то, что есть на складе', () => {
  const stock = groupStockByItem(
    [
      row({ item_id: 'есть', location_id: WH, quantity: 8 }),
      row({ item_id: 'кончился', location_id: WH, quantity: 0 }),
      row({ item_id: 'кончился', location_id: SC, quantity: 2 }),
    ],
    { warehouseId: WH, showcaseId: SC },
  )

  assert.deepEqual(warehouseAvailableItems(stock).map((r) => r.item_id), ['есть'])
})
