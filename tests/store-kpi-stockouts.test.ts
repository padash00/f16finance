/**
 * Отсутствие ходовых позиций на витрине.
 *
 * Главное, что здесь защищается: событие не должно порождаться на каждую
 * редкую позицию. Журнал, в котором каждый день по десять записей, перестают
 * читать — и тогда настоящий стокаут пройдёт незамеченным.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_WINDOW_DAYS,
  findStockouts,
  stockoutSeverity,
  stockoutTitle,
  type ItemSalesFrequency,
} from '@/lib/domain/store-kpi'

const WINDOW = 60

function item(patch: Partial<ItemSalesFrequency> & { item_id: string }): ItemSalesFrequency {
  return { name: patch.item_id, days_with_sales: 30, quantity: 100, ...patch }
}

test('ходовая позиция с нулём на витрине попадает в стокаут', () => {
  const found = findStockouts({
    sales: [item({ item_id: 'ramen', name: 'Рамен', days_with_sales: 55 })],
    stock: [{ item_id: 'ramen', quantity: 0 }],
    windowDays: WINDOW,
  })

  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'Рамен')
})

test('редкая позиция стокаутом не считается', () => {
  // Продавалась 5 дней из 60 — её отсутствие ничего не меняет, а событие на
  // такую позицию превратит журнал в шум.
  const found = findStockouts({
    sales: [item({ item_id: 'rare', days_with_sales: 5 })],
    stock: [{ item_id: 'rare', quantity: 0 }],
    windowDays: WINDOW,
  })

  assert.equal(found.length, 0)
})

test('позиции нет в остатках вовсе — это тоже ноль', () => {
  // Строка остатка заводится при первом приходе. Её отсутствие означает «не
  // завозили», а не «данных нет».
  const found = findStockouts({
    sales: [item({ item_id: 'cola', name: 'Кола', days_with_sales: 50 })],
    stock: [],
    windowDays: WINDOW,
  })

  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'Кола')
})

test('товар на витрине стокаутом не считается', () => {
  const found = findStockouts({
    sales: [item({ item_id: 'ramen', days_with_sales: 55 })],
    stock: [{ item_id: 'ramen', quantity: 4 }],
    windowDays: WINDOW,
  })

  assert.equal(found.length, 0)
})

test('короткая история не даёт объявлять стокауты', () => {
  // По неделе наблюдений нельзя сказать, ходовая позиция или разовая.
  const found = findStockouts({
    sales: [item({ item_id: 'ramen', days_with_sales: 7 })],
    stock: [{ item_id: 'ramen', quantity: 0 }],
    windowDays: MIN_WINDOW_DAYS - 1,
  })

  assert.equal(found.length, 0)
})

test('первым идёт то, что берут чаще', () => {
  const found = findStockouts({
    sales: [
      item({ item_id: 'b', name: 'Сок', days_with_sales: 30 }),
      item({ item_id: 'a', name: 'Рамен', days_with_sales: 58 }),
    ],
    stock: [],
    windowDays: WINDOW,
  })

  assert.deepEqual(
    found.map((f) => f.name),
    ['Рамен', 'Сок'],
  )
})

test('заголовок перечисляет три позиции и хвост', () => {
  const found = findStockouts({
    sales: ['a', 'b', 'c', 'd', 'e'].map((id) => item({ item_id: id, name: id.toUpperCase() })),
    stock: [],
    windowDays: WINDOW,
  })

  const title = stockoutTitle(found)
  assert.match(title, /Нет на витрине/)
  assert.match(title, /и ещё 2/)
})

test('серьёзность считается по ежедневным позициям, а не по их числу', () => {
  const daily = findStockouts({
    sales: [
      item({ item_id: 'a', days_with_sales: 55 }),
      item({ item_id: 'b', days_with_sales: 52 }),
    ],
    stock: [],
    windowDays: WINDOW,
  })
  assert.equal(stockoutSeverity(daily, WINDOW), 'high')

  const occasional = findStockouts({
    sales: [item({ item_id: 'a', days_with_sales: 25 })],
    stock: [],
    windowDays: WINDOW,
  })
  assert.equal(stockoutSeverity(occasional, WINDOW), 'low')

  assert.equal(stockoutSeverity([], WINDOW), 'low')
})
