import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCashflowDays, computeCashflow, summarizeCashflow } from '@/lib/domain/cashflow'

const income = (date: string, amounts: Partial<Record<'cash' | 'kaspi' | 'online' | 'card', number>>) => ({
  date,
  cash_amount: amounts.cash ?? 0,
  kaspi_amount: amounts.kaspi ?? 0,
  online_amount: amounts.online ?? 0,
  card_amount: amounts.card ?? 0,
})

const expense = (date: string, cash: number, kaspi = 0) => ({
  date,
  cash_amount: cash,
  kaspi_amount: kaspi,
})

// ─── Свёртка по дням ────────────────────────────────────────────────────────

test('доход дня складывается из всех способов оплаты', () => {
  const days = buildCashflowDays([income('2026-08-01', { cash: 100, kaspi: 50, online: 30, card: 20 })], [])
  assert.equal(days.length, 1)
  assert.equal(days[0].income, 200)
})

test('расход дня складывается из наличной и безналичной части', () => {
  const days = buildCashflowDays([], [expense('2026-08-01', 100, 250)])
  assert.equal(days[0].expense, 350)
  assert.equal(days[0].net, -350)
})

test('несколько строк одного дня сливаются в одну', () => {
  const days = buildCashflowDays(
    [income('2026-08-01', { cash: 100 }), income('2026-08-01', { kaspi: 200 })],
    [expense('2026-08-01', 50), expense('2026-08-01', 30)],
  )
  assert.equal(days.length, 1)
  assert.equal(days[0].income, 300)
  assert.equal(days[0].expense, 80)
})

test('дни идут по возрастанию даты независимо от порядка строк', () => {
  const days = buildCashflowDays(
    [income('2026-08-03', { cash: 3 }), income('2026-08-01', { cash: 1 }), income('2026-08-02', { cash: 2 })],
    [],
  )
  assert.deepEqual(days.map((d) => d.date), ['2026-08-01', '2026-08-02', '2026-08-03'])
})

test('день только с расходом попадает в период', () => {
  // Иначе убыточный день исчез бы из графика, а баланс на нём просел бы
  // без видимой причины.
  const days = buildCashflowDays([income('2026-08-01', { cash: 100 })], [expense('2026-08-02', 40)])
  assert.deepEqual(days.map((d) => d.date), ['2026-08-01', '2026-08-02'])
})

// ─── Накопительный баланс ───────────────────────────────────────────────────

test('баланс накапливается от начала периода', () => {
  const days = buildCashflowDays(
    [
      income('2026-08-01', { cash: 1_000 }),
      income('2026-08-02', { cash: 500 }),
      income('2026-08-03', { cash: 200 }),
    ],
    [expense('2026-08-02', 900)],
  )
  assert.deepEqual(days.map((d) => d.balance), [1_000, 600, 800])
})

test('баланс уходит в минус, когда расходы обгоняют доходы', () => {
  const days = buildCashflowDays([income('2026-08-01', { cash: 100 })], [expense('2026-08-01', 400)])
  assert.equal(days[0].balance, -300)
})

// ─── Итоги ──────────────────────────────────────────────────────────────────

test('итоги считаются по дням периода', () => {
  const { totals } = computeCashflow(
    [income('2026-08-01', { cash: 1_000 }), income('2026-08-02', { kaspi: 1_000 })],
    [expense('2026-08-01', 500), expense('2026-08-02', 1_500)],
  )
  assert.equal(totals.income, 2_000)
  assert.equal(totals.expense, 2_000)
  assert.equal(totals.net, 0)
  assert.equal(totals.daysCount, 2)
})

test('маржа считается в процентах от выручки', () => {
  const { totals } = computeCashflow([income('2026-08-01', { cash: 1_000 })], [expense('2026-08-01', 250)])
  assert.equal(totals.margin, 75)
})

test('без выручки маржа равна нулю, а не бесконечности', () => {
  const { totals } = computeCashflow([], [expense('2026-08-01', 500)])
  assert.equal(totals.net, -500)
  assert.equal(totals.margin, 0)
})

test('убыточными считаются только дни с отрицательным итогом', () => {
  const { totals } = computeCashflow(
    [income('2026-08-01', { cash: 100 }), income('2026-08-02', { cash: 100 })],
    [expense('2026-08-01', 100), expense('2026-08-02', 300)],
  )
  // Первый день закрылся в ноль — это не убыток.
  assert.equal(totals.negativeDays, 1)
})

test('итоговый баланс равен балансу последнего дня', () => {
  const { days, totals } = computeCashflow(
    [income('2026-08-01', { cash: 1_000 }), income('2026-08-05', { cash: 100 })],
    [expense('2026-08-03', 400)],
  )
  assert.equal(totals.endingBalance, days[days.length - 1].balance)
  assert.equal(totals.endingBalance, 700)
})

test('пустой период не ломает итоги', () => {
  const totals = summarizeCashflow([])
  assert.equal(totals.daysCount, 0)
  assert.equal(totals.endingBalance, 0)
  assert.equal(totals.margin, 0)
})
