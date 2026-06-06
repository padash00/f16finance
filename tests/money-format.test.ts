import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney } from '@/lib/core/format'
import { parseMoney, parseUnitCost, parseQty } from '@/lib/store/receipts/format'

// toLocaleString('ru-RU') разделяет разряды неразрывным/узким пробелом —
// нормализуем все пробелы к обычному, чтобы сравнение было стабильным.
const norm = (s: string) => s.replace(/[\s  ]/g, ' ')

test('formatMoney: разряды + ₸, без копеек', () => {
  assert.equal(norm(formatMoney(10000)), '10 000 ₸')
  assert.equal(norm(formatMoney(0)), '0 ₸')
  assert.equal(norm(formatMoney(1234567)), '1 234 567 ₸')
})

test('formatMoney: округляет дробное до целого тенге', () => {
  assert.equal(norm(formatMoney(10000.4)), '10 000 ₸')
  assert.equal(norm(formatMoney(10000.5)), '10 001 ₸')
  assert.equal(norm(formatMoney(99.99)), '100 ₸')
})

test('formatMoney: пустое/мусор → 0 ₸ (не падает)', () => {
  assert.equal(norm(formatMoney(null as unknown as number)), '0 ₸')
  assert.equal(norm(formatMoney(undefined as unknown as number)), '0 ₸')
  assert.equal(norm(formatMoney(NaN)), '0 ₸')
})

test('parseMoney: точка и запятая как разделитель', () => {
  assert.equal(parseMoney('1234.56'), 1234.56)
  assert.equal(parseMoney('1234,56'), 1234.56)
})

test('parseMoney: пробелы, мусор, пусто → безопасно', () => {
  assert.equal(parseMoney('  100  '), 100)
  assert.equal(parseMoney('abc'), 0)
  assert.equal(parseMoney(''), 0)
})

test('parseMoney: округление до 2 знаков (копейки)', () => {
  assert.equal(parseMoney('10.005'), 10.01)
  assert.equal(parseMoney('10.004'), 10)
})

test('parseUnitCost: до 4 знаков (закупочная цена)', () => {
  assert.equal(parseUnitCost('1.23456'), 1.2346)
  assert.equal(parseUnitCost('2,5'), 2.5)
})

test('parseQty: до 3 знаков (количество)', () => {
  assert.equal(parseQty('1.2345'), 1.235)
  assert.equal(parseQty('3'), 3)
  assert.equal(parseQty('х'), 0)
})
