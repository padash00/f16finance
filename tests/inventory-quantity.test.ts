import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeQty } from '@/lib/domain/inventory-quantity'

test('normalizeQty: держит три знака после запятой', () => {
  assert.equal(normalizeQty(1.2345), 1.235)
  assert.equal(normalizeQty(0.0004), 0)
  assert.equal(normalizeQty(2), 2)
})

test('normalizeQty: запятая как десятичный разделитель', () => {
  // На русской раскладке набирают «1,5» — Number('1,5') это NaN, и полтора
  // килограмма молча превращались в ноль.
  assert.equal(normalizeQty('1,5'), 1.5)
  assert.equal(normalizeQty('1.5'), 1.5)
})

test('normalizeQty: мусор и пустота — это ноль, а не NaN', () => {
  assert.equal(normalizeQty(null), 0)
  assert.equal(normalizeQty(undefined), 0)
  assert.equal(normalizeQty(''), 0)
  assert.equal(normalizeQty('шт'), 0)
  assert.equal(normalizeQty(Number.NaN), 0)
})

test('normalizeQty: копится без плавающего хвоста', () => {
  // 0.1 + 0.2 = 0.30000000000000004; в остатке такой хвост расходится
  // с тем, что человек видит на экране.
  assert.equal(normalizeQty(0.1 + 0.2), 0.3)
})

test('normalizeQty: отрицательное не отбрасывается', () => {
  // Минус приходит из корректировок и разницы ревизии — глушить его здесь
  // нельзя, это решает вызывающий код.
  assert.equal(normalizeQty(-3.5), -3.5)
})
