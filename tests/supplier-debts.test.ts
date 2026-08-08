import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSupplierDebtOverdue, summarizeSupplierDebts } from '@/lib/domain/supplier-debts'

const NOW = new Date('2026-08-09T10:00:00Z')

test('открытые долги складываются и считаются', () => {
  const totals = summarizeSupplierDebts([
    { status: 'open', total_amount: 120_000 },
    { status: 'open', total_amount: 80_000 },
  ], NOW)

  assert.equal(totals.open, 200_000)
  assert.equal(totals.open_count, 2)
})

test('оплаченные и списанные в долг не входят', () => {
  const totals = summarizeSupplierDebts([
    { status: 'open', total_amount: 100 },
    { status: 'paid', total_amount: 900 },
    { status: 'written_off', total_amount: 500 },
  ], NOW)

  assert.equal(totals.open, 100)
  assert.equal(totals.open_count, 1)
})

test('просроченным считается открытый долг со сроком в прошлом', () => {
  const totals = summarizeSupplierDebts([
    { status: 'open', total_amount: 300, due_date: '2026-08-01' },
    { status: 'open', total_amount: 700, due_date: '2026-09-01' },
  ], NOW)

  assert.equal(totals.overdue, 300)
  assert.equal(totals.overdue_count, 1)
  // Просроченный долг остаётся и в общей сумме открытых: это не две разные
  // корзины, а сумма и её часть.
  assert.equal(totals.open, 1_000)
})

test('долг без срока не просрочен', () => {
  const totals = summarizeSupplierDebts([
    { status: 'open', total_amount: 400, due_date: null },
  ], NOW)

  assert.equal(totals.open, 400)
  assert.equal(totals.overdue, 0)
})

test('оплаченный долг не становится просроченным из-за прошедшего срока', () => {
  const totals = summarizeSupplierDebts([
    { status: 'paid', total_amount: 400, due_date: '2026-01-01' },
  ], NOW)

  assert.equal(totals.overdue, 0)
  assert.equal(totals.overdue_count, 0)
})

test('битая дата срока не даёт просрочку', () => {
  const totals = summarizeSupplierDebts([
    { status: 'open', total_amount: 400, due_date: 'скоро' },
  ], NOW)

  assert.equal(totals.overdue, 0)
})

test('сумма строкой читается как число', () => {
  const totals = summarizeSupplierDebts([{ status: 'open', total_amount: '1500' }], NOW)
  assert.equal(totals.open, 1_500)
})

test('признак строки и свод судят о просрочке одинаково', () => {
  // Строка помечается красным тем же правилом, каким счёт попадает в сумму
  // просроченного: иначе шапка и список под ней противоречили бы друг другу.
  const rows = [
    { status: 'open', total_amount: 300, due_date: '2026-08-01' },
    { status: 'open', total_amount: 700, due_date: '2026-09-01' },
    { status: 'paid', total_amount: 500, due_date: '2026-01-01' },
  ]
  const flagged = rows.filter((row) => isSupplierDebtOverdue(row, NOW))
  const totals = summarizeSupplierDebts(rows, NOW)

  assert.equal(flagged.length, totals.overdue_count)
  assert.equal(flagged.reduce((sum, row) => sum + row.total_amount, 0), totals.overdue)
})

test('день срока уже считается просрочкой', () => {
  assert.equal(isSupplierDebtOverdue({ status: 'open', due_date: '2026-08-09' }, NOW), true)
})

test('пустой список даёт нули, а не ошибку', () => {
  const totals = summarizeSupplierDebts([], NOW)
  assert.deepEqual(totals, { open: 0, open_count: 0, overdue: 0, overdue_count: 0 })
})
