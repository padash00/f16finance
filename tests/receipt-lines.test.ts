/**
 * Себестоимость при повторе товара в накладной.
 *
 * Здесь охраняется правило «цена партии — средневзвешенная, а не последняя
 * строка». Нарушить его легко и незаметно: приёмка пройдёт, остаток сойдётся,
 * и только прибыль будет завышена — потому что система решит, что весь объём
 * куплен по акционной цене.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { foldReceiptLinesByItem } from '@/lib/domain/receipt-lines'

const ID = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

test('одна строка — цена не меняется', () => {
  const [row] = foldReceiptLinesByItem([
    { item_id: ID, quantity: 48, unit_cost: 417, sale_price: 700 },
  ])
  assert.equal(row.unit_cost, 417)
  assert.equal(row.sale_price, 700)
})

test('две строки одного товара — средневзвешенная по количеству', () => {
  // Реальный случай: 48 шт по 417 ₸ и 24 шт по акции 220 ₸.
  const [row] = foldReceiptLinesByItem([
    { item_id: ID, quantity: 48, unit_cost: 417, sale_price: 700 },
    { item_id: ID, quantity: 24, unit_cost: 220, sale_price: 700 },
  ])
  // (48×417 + 24×220) / 72 = 25 296 / 72 = 351,33
  assert.equal(row.unit_cost, 351.33)
})

test('порядок строк не влияет на результат', () => {
  const direct = foldReceiptLinesByItem([
    { item_id: ID, quantity: 48, unit_cost: 417, sale_price: 700 },
    { item_id: ID, quantity: 24, unit_cost: 220, sale_price: 700 },
  ])
  const reversed = foldReceiptLinesByItem([
    { item_id: ID, quantity: 24, unit_cost: 220, sale_price: 700 },
    { item_id: ID, quantity: 48, unit_cost: 417, sale_price: 700 },
  ])
  assert.equal(direct[0].unit_cost, reversed[0].unit_cost)
})

test('акционная строка больше не перебивает основную', () => {
  const [row] = foldReceiptLinesByItem([
    { item_id: ID, quantity: 48, unit_cost: 417, sale_price: 700 },
    { item_id: ID, quantity: 24, unit_cost: 220, sale_price: 700 },
  ])
  // Старое поведение записало бы 220 — весь объём «куплен по акции».
  assert.notEqual(row.unit_cost, 220)
  assert.ok(row.unit_cost > 220 && row.unit_cost < 417)
})

test('цена продажи берётся из строки с большим количеством', () => {
  const [row] = foldReceiptLinesByItem([
    { item_id: ID, quantity: 6, unit_cost: 417, sale_price: 900 },
    { item_id: ID, quantity: 60, unit_cost: 400, sale_price: 700 },
  ])
  assert.equal(row.sale_price, 700)
})

test('разные товары не смешиваются', () => {
  const rows = foldReceiptLinesByItem([
    { item_id: ID, quantity: 10, unit_cost: 100, sale_price: 200 },
    { item_id: OTHER, quantity: 10, unit_cost: 300, sale_price: 500 },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.item_id === ID)?.unit_cost, 100)
  assert.equal(rows.find((r) => r.item_id === OTHER)?.unit_cost, 300)
})

test('нулевое количество во всех строках не обнуляет себестоимость', () => {
  const [row] = foldReceiptLinesByItem([
    { item_id: ID, quantity: 0, unit_cost: 417, sale_price: 700 },
  ])
  assert.equal(row.unit_cost, 417)
})

test('строки без товара отбрасываются', () => {
  const rows = foldReceiptLinesByItem([
    { item_id: '', quantity: 10, unit_cost: 100, sale_price: 200 },
    { item_id: '   ', quantity: 10, unit_cost: 100, sale_price: 200 },
  ])
  assert.equal(rows.length, 0)
})
