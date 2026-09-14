import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMonthlyPnl } from '@/lib/domain/profitability'
import {
  buildProfitabilityReport,
  companyExpenseLines,
  profitBridge,
  type PnlExpenseRow,
  type PnlIncomeRow,
} from '@/lib/domain/profitability-report'

const companies = [
  { id: 'arena', name: 'Арена', code: 'arena' },
  { id: 'shop', name: 'Магазин', code: 'shop' },
  { id: 'extra', name: 'F16 Extra', code: 'extra' },
]

const inc = (date: string, company_id: string, cash: number, parts: Partial<PnlIncomeRow> = {}): PnlIncomeRow => ({
  date,
  company_id,
  shift: 'day',
  cash_amount: cash,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
  ...parts,
})
const exp = (date: string, company_id: string, category: string, amount: number, status: string | null = null): PnlExpenseRow => ({
  date,
  company_id,
  category,
  cash_amount: amount,
  kaspi_amount: 0,
  status,
})

const groups = { аренда: 'operating', зарплата: 'payroll', 'налог 2%': 'income_tax', оборудование: 'capex', 'доля партнёра': 'profit_distribution' }

test('налог — ставкой с выручки; уплаченный налог из журнала второй раз не вычитается', () => {
  const byRate = computeMonthlyPnl('2026-08', { cash: 1_000_000, kaspi: 0, card: 0, online: 0 }, [exp('2026-08-10', 'arena', 'Налог 2%', 20_000)], null, groups, { taxRate: 2 })
  assert.equal(byRate.incomeTax, 20_000)
  assert.equal(byRate.incomeTaxPaid, 20_000)
  assert.equal(byRate.incomeTaxSource, 'rate')
  assert.equal(byRate.netProfit, 980_000)

  const manual = computeMonthlyPnl('2026-08', { cash: 1_000_000, kaspi: 0, card: 0, online: 0 }, [], { income_tax_amount: 35_000 }, groups, { taxRate: 2 })
  assert.equal(manual.incomeTax, 35_000)
  assert.equal(manual.incomeTaxSource, 'manual')

  // Без ставки — как раньше, из журнала (приложение и старые тесты)
  const journal = computeMonthlyPnl('2026-08', { cash: 1_000_000, kaspi: 0, card: 0, online: 0 }, [exp('2026-08-10', 'arena', 'Налог 2%', 20_000)], null, groups)
  assert.equal(journal.incomeTaxSource, 'journal')
  assert.equal(journal.netProfit, 980_000)
})

test('отклонённые расходы не считаются, F16 Extra — только по галочке', () => {
  const base = {
    companies,
    categoryGroups: groups,
    inputsByMonth: {},
    months: ['2026-08'],
    taxRate: 2,
    incomes: [inc('2026-08-05', 'arena', 1000), inc('2026-08-05', 'extra', 500)],
    expenses: [exp('2026-08-06', 'arena', 'Аренда', 100), exp('2026-08-07', 'arena', 'Аренда', 999, 'declined')],
  }
  const without = buildProfitabilityReport({ ...base, includeExtra: false })
  assert.equal(without.total.revenue, 1000)
  assert.equal(without.total.operatingExpenses, 100)
  assert.equal(without.companies.find((c) => c.id === 'extra')!.inTotals, false)
  assert.equal(buildProfitabilityReport({ ...base, includeExtra: true }).total.revenue, 1500)
})

test('безнал ночной смены 31-го без разбивки уходит в следующий месяц — как в отчётах', () => {
  const r = buildProfitabilityReport({
    companies,
    categoryGroups: {},
    inputsByMonth: {},
    months: ['2026-08', '2026-09'],
    taxRate: 2,
    includeExtra: false,
    incomes: [inc('2026-08-31', 'arena', 100, { shift: 'night', kaspi_amount: 400, kaspi_before_midnight: 150 })],
    expenses: [],
  })
  assert.equal(r.months[0].revenue, 250)
  assert.equal(r.months[1].revenue, 250)
})

test('ручные вводы разносятся по точкам: сумма точек = итог организации', () => {
  const r = buildProfitabilityReport({
    companies,
    categoryGroups: groups,
    months: ['2026-08'],
    taxRate: 2,
    includeExtra: false,
    inputsByMonth: {
      '2026-08': { payroll_amount: 600_000, kaspi_qr_turnover: 1_000_000, kaspi_qr_rate: 1, depreciation_amount: 30_000, other_operating_amount: 10_000 },
    },
    incomes: [inc('2026-08-05', 'arena', 3_000_000), inc('2026-08-05', 'shop', 1_000_000)],
    expenses: [
      exp('2026-08-06', 'arena', 'Зарплата', 400_000), // заменяется ручным ФОТ
      exp('2026-08-06', 'shop', 'Зарплата', 50_000),
      exp('2026-08-07', 'arena', 'Аренда', 200_000),
      exp('2026-08-08', 'shop', 'Оборудование', 90_000),
    ],
  })
  assert.equal(r.total.payroll, 600_000)
  assert.equal(r.total.posCommission, 10_000)
  const arena = r.companies.find((c) => c.id === 'arena')!
  const shop = r.companies.find((c) => c.id === 'shop')!
  assert.equal(arena.total.payroll, 450_000)
  assert.equal(shop.total.payroll, 150_000)
  assert.equal(Math.round(arena.total.netProfit + shop.total.netProfit), Math.round(r.total.netProfit))
  assert.equal(arena.share, 0.75)
  assert.equal(shop.total.capex, 90_000)
})

test('разбор изменения прибыли сходится с разницей чистой прибыли', () => {
  const r = buildProfitabilityReport({
    companies,
    categoryGroups: groups,
    months: ['2026-07', '2026-08'],
    visibleFrom: '2026-08',
    taxRate: 2,
    includeExtra: false,
    inputsByMonth: { '2026-08': { payroll_amount: 300_000 } },
    incomes: [inc('2026-07-05', 'arena', 2_000_000), inc('2026-08-05', 'arena', 2_500_000)],
    expenses: [exp('2026-07-06', 'arena', 'Аренда', 200_000), exp('2026-08-06', 'arena', 'Аренда', 260_000), exp('2026-07-07', 'arena', 'Зарплата', 250_000)],
  })
  assert.equal(r.months.length, 1)
  assert.equal(r.previous!.month, '2026-07')
  assert.equal(r.total.revenue, 2_500_000) // июль в итог не входит
  const lines = profitBridge(r.months[0], r.previous!)
  const sum = lines.reduce((s, l) => s + l.effect, 0)
  assert.equal(Math.round(sum), Math.round(r.months[0].netProfit - r.previous!.netProfit))
  assert.equal(lines.find((l) => l.key === 'tax')!.effect, -10_000)
})

test('строки PDF точки: выручка − налог − строки = чистая прибыль, ручной ФОТ заменяет журнальный', () => {
  const expenses = [
    exp('2026-08-06', 'arena', 'Зарплата', 400_000),
    exp('2026-08-07', 'arena', 'Аренда', 200_000),
    exp('2026-08-08', 'arena', 'Налог 2%', 55_000),
    exp('2026-08-09', 'arena', 'Доля партнёра', 100_000),
    exp('2026-08-09', 'arena', 'Оборудование', 70_000),
  ]
  const r = buildProfitabilityReport({
    companies,
    categoryGroups: groups,
    months: ['2026-08'],
    taxRate: 2,
    includeExtra: false,
    inputsByMonth: { '2026-08': { payroll_amount: 600_000, amortization_amount: 12_000 } },
    incomes: [inc('2026-08-05', 'arena', 3_000_000), inc('2026-08-05', 'shop', 1_000_000)],
    expenses: [...expenses, exp('2026-08-06', 'shop', 'Аренда', 10_000)],
  })
  const arena = r.companies.find((c) => c.id === 'arena')!
  const out = companyExpenseLines({ months: arena.months, expenses, categoryGroups: groups })
  assert.equal(Math.round(arena.total.revenue - arena.total.incomeTax - out.total), Math.round(arena.total.netProfit))
  assert.ok(out.lines.some((l) => l.category === 'ФОТ — ручной ввод' && Math.round(l.amount) === 450_000))
  assert.ok(!out.lines.some((l) => l.category === 'Зарплата' || l.category === 'Налог 2%' || l.category === 'Доля партнёра'))
  assert.equal(out.capexTotal, 70_000)
})
