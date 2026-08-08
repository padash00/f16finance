import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMonthlyPnl } from '@/lib/domain/profitability'

const MONTH = '2026-08'
const noIncome = { cash: 0, kaspi: 0, card: 0, online: 0 }

const expense = (category: string, amount: number, date = `${MONTH}-10`) => ({
  date,
  category,
  cash_amount: amount,
  kaspi_amount: 0,
})

// ─── Выручка ────────────────────────────────────────────────────────────────

test('выручка складывается из всех способов оплаты', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 100, kaspi: 50, card: 30, online: 20 }, [], null)
  assert.equal(pnl.revenue, 200)
  assert.equal(pnl.cashRevenue, 100)
  assert.equal(pnl.cashlessRevenue, 100)
})

test('ручная выручка перекрывает журнал целиком', () => {
  const pnl = computeMonthlyPnl(
    MONTH,
    { cash: 100, kaspi: 50, card: 0, online: 0 },
    [],
    { cash_revenue_override: 500, pos_revenue_override: 300 },
  )
  assert.equal(pnl.revenue, 800)
  assert.equal(pnl.cashRevenue, 500)
  assert.equal(pnl.cashlessRevenue, 300)
})

test('частичная ручная выручка всё равно перекрывает журнал', () => {
  // Заполнена только наличная часть — безналичная становится нулём, а не
  // подставляется из журнала: иначе получилась бы смесь двух источников.
  const pnl = computeMonthlyPnl(MONTH, { cash: 100, kaspi: 900, card: 0, online: 0 }, [], {
    cash_revenue_override: 500,
  })
  assert.equal(pnl.revenue, 500)
  assert.equal(pnl.cashlessRevenue, 0)
})

// ─── Строки журнала ─────────────────────────────────────────────────────────

test('строки других месяцев не попадают в расчёт', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 1000, kaspi: 0, card: 0, online: 0 }, [
    expense('Продукты', 100, '2026-07-31'),
    expense('Продукты', 200, '2026-08-01'),
    expense('Продукты', 400, '2026-09-01'),
  ], null, { 'продукты': 'cogs' })

  assert.equal(pnl.cogs, 200)
})

test('наличная и безналичная части строки складываются', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    { date: `${MONTH}-05`, category: 'Аренда', cash_amount: 100, kaspi_amount: 250 },
  ], null, { 'аренда': 'operating' })

  assert.equal(pnl.operatingExpenses, 350)
})

test('аванс попадает в ФОТ, а не в операционные', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    expense('Аванс', 300),
  ], null, { 'аванс': 'payroll_advance' })

  assert.equal(pnl.payroll, 300)
  assert.equal(pnl.operatingExpenses, 0)
})

test('неизвестная категория считается операционным расходом', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [expense('Что-то новое', 700)], null)
  assert.equal(pnl.operatingExpenses, 700)
})

test('CAPEX и распределение прибыли не входят в EBITDA', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 1000, kaspi: 0, card: 0, online: 0 }, [
    expense('Оборудование', 400),
    expense('Дивиденды', 300),
  ], null, { 'оборудование': 'capex', 'дивиденды': 'profit_distribution' })

  assert.equal(pnl.capex, 400)
  assert.equal(pnl.profitDistribution, 300)
  assert.equal(pnl.ebitda, 1000)
  assert.equal(pnl.netProfit, 1000)
})

// ─── Комиссии эквайринга ────────────────────────────────────────────────────

test('комиссия считается по обороту и ставке', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 0, kaspi: 10_000, card: 0, online: 0 }, [], {
    kaspi_qr_turnover: 10_000,
    kaspi_qr_rate: 2,
  })
  assert.equal(pnl.posCommission, 200)
})

test('старое поле QR+Gold игнорируется, когда заполнены новые', () => {
  // Иначе один и тот же оборот дал бы комиссию дважды.
  const pnl = computeMonthlyPnl(MONTH, noIncome, [], {
    kaspi_qr_turnover: 10_000,
    kaspi_qr_rate: 1,
    qr_gold_turnover: 10_000,
    qr_gold_rate: 1,
  })
  assert.equal(pnl.posCommission, 100)
})

test('старое поле QR+Gold работает, пока новые пусты', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [], {
    qr_gold_turnover: 10_000,
    qr_gold_rate: 1.5,
  })
  assert.equal(pnl.posCommission, 150)
})

test('ручная комиссия заменяет журнальную, а не складывается', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    expense('Комиссия Kaspi', 999),
  ], { kaspi_qr_turnover: 10_000, kaspi_qr_rate: 2 }, { 'комиссия kaspi': 'pos_commission' })

  assert.equal(pnl.posCommission, 200)
})

test('без ручных оборотов комиссия берётся из журнала', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    expense('Комиссия Kaspi', 350),
  ], null, { 'комиссия kaspi': 'pos_commission' })

  assert.equal(pnl.posCommission, 350)
})

// ─── Приоритет ручного ввода ────────────────────────────────────────────────

test('ручной ФОТ перекрывает журнальный', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    expense('Зарплата', 100),
  ], { payroll_amount: 900 }, { 'зарплата': 'payroll' })

  assert.equal(pnl.payroll, 900)
})

test('нулевой ручной ввод означает «не заполнено»', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [
    expense('Зарплата', 100),
  ], { payroll_amount: 0 }, { 'зарплата': 'payroll' })

  assert.equal(pnl.payroll, 100)
})

// ─── Порядок P&L ────────────────────────────────────────────────────────────

test('полная цепочка от выручки до чистой прибыли', () => {
  const pnl = computeMonthlyPnl(
    MONTH,
    { cash: 10_000, kaspi: 0, card: 0, online: 0 },
    [
      expense('Товар', 3_000),
      expense('Аренда', 1_000),
      expense('Зарплата', 2_000),
      expense('ОПВ', 200),
      expense('Проценты по кредиту', 300),
      expense('Штраф', 100),
      expense('Износ', 400),
      expense('КПН', 500),
    ],
    null,
    {
      'товар': 'cogs',
      'аренда': 'operating',
      'зарплата': 'payroll',
      'опв': 'payroll_tax',
      'проценты по кредиту': 'financial_expenses',
      'штраф': 'non_operating',
      'износ': 'depreciation',
      'кпн': 'income_tax',
    },
  )

  assert.equal(pnl.grossProfit, 7_000)          // 10000 − 3000
  assert.equal(pnl.ebitda, 3_800)               // 7000 − 1000 − 2000 − 200
  assert.equal(pnl.operatingProfit, 3_400)      // − износ 400
  assert.equal(pnl.netProfit, 2_500)            // − 300 финансовые − 500 КПН − 100 неоперац.
})

test('амортизация уменьшает операционную прибыль, но не EBITDA', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 1_000, kaspi: 0, card: 0, online: 0 }, [], {
    amortization_amount: 250,
  })
  assert.equal(pnl.ebitda, 1_000)
  assert.equal(pnl.operatingProfit, 750)
})

// ─── Маржа ──────────────────────────────────────────────────────────────────

test('маржа считается в процентах от выручки', () => {
  const pnl = computeMonthlyPnl(MONTH, { cash: 1_000, kaspi: 0, card: 0, online: 0 }, [
    expense('Аренда', 250),
  ], null, { 'аренда': 'operating' })

  assert.equal(pnl.ebitdaMargin, 75)
})

test('без выручки маржа равна нулю, а не бесконечности', () => {
  const pnl = computeMonthlyPnl(MONTH, noIncome, [expense('Аренда', 500)], null, {
    'аренда': 'operating',
  })
  assert.equal(pnl.revenue, 0)
  assert.equal(pnl.ebitda, -500)
  assert.equal(pnl.ebitdaMargin, 0)
  assert.equal(pnl.netMargin, 0)
})
