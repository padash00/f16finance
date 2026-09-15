import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProfitabilityReport,
  companyExpenseLines,
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

const groups = { аренда: 'operating', зарплата: 'payroll', 'налог 3%': 'income_tax', оборудование: 'capex', 'доля партнёра': 'profit_distribution' }
const base = { companies, categoryGroups: groups, includeExtra: false }

test('выручка — как в «Доходах» по дате смены, налог — из журнала расходов', () => {
  const r = buildProfitabilityReport({
    ...base,
    months: ['2026-08', '2026-09'],
    incomes: [inc('2026-08-31', 'arena', 100, { kaspi_amount: 400 })],
    expenses: [exp('2026-08-10', 'arena', 'Налог 3%', 30)],
  })
  assert.equal(r.months[0].revenue, 500)
  assert.equal(r.months[1].revenue, 0)
  assert.equal(r.months[0].incomeTax, 30)
  assert.equal(r.months[0].netProfit, 470)
})

test('сверка: расходы журнала − отклонённые − оборудование − партнёры = выручка − чистая прибыль', () => {
  const r = buildProfitabilityReport({
    ...base,
    months: ['2026-08'],
    incomes: [inc('2026-08-05', 'arena', 1000), inc('2026-08-05', 'extra', 500)],
    expenses: [
      exp('2026-08-06', 'arena', 'Аренда', 100),
      exp('2026-08-07', 'arena', 'Аренда', 999, 'declined'),
      exp('2026-08-08', 'arena', 'Оборудование', 70),
      exp('2026-08-09', 'arena', 'Доля партнёра', 50),
      exp('2026-08-09', 'extra', 'Аренда', 40),
    ],
  })
  const m = r.months[0]
  assert.equal(m.revenue, 1000)
  assert.equal(m.operatingExpenses, 100)
  assert.equal(m.check.declined, 999)
  assert.equal(m.check.declinedCount, 1)
  assert.equal(m.check.expensesAll - m.check.declined - m.capex - m.profitDistribution, m.revenue - m.netProfit)
  assert.deepEqual(m.categories.operating, [{ name: 'Аренда', amount: 100 }])
  assert.equal(r.companies.find((c) => c.id === 'extra')!.inTotals, false)
  assert.equal(buildProfitabilityReport({ ...base, includeExtra: true, months: ['2026-08'], incomes: [inc('2026-08-05', 'arena', 1000), inc('2026-08-05', 'extra', 500)], expenses: [] }).total.revenue, 1500)
})

test('у точки только её журналы, сумма точек = итог; прошлый месяц для сравнения', () => {
  const r = buildProfitabilityReport({
    ...base,
    months: ['2026-07', '2026-08'],
    visibleFrom: '2026-08',
    incomes: [inc('2026-07-05', 'arena', 2_000_000), inc('2026-08-05', 'arena', 3_000_000), inc('2026-08-05', 'shop', 1_000_000)],
    expenses: [exp('2026-08-06', 'arena', 'Зарплата', 400_000), exp('2026-08-06', 'shop', 'Зарплата', 50_000), exp('2026-07-07', 'arena', 'Аренда', 200_000)],
  })
  assert.equal(r.months.length, 1)
  assert.equal(r.previous!.month, '2026-07')
  assert.equal(r.previous!.netProfit, 1_800_000)
  assert.equal(r.total.revenue, 4_000_000)
  const arena = r.companies.find((c) => c.id === 'arena')!
  const shop = r.companies.find((c) => c.id === 'shop')!
  assert.equal(arena.total.payroll, 400_000)
  assert.equal(shop.total.payroll, 50_000)
  assert.equal(arena.total.netProfit + shop.total.netProfit, r.total.netProfit)
  assert.equal(arena.previous!.revenue, 2_000_000)
})

test('строки PDF точки: выручка − налог − строки = чистая прибыль', () => {
  const expenses = [
    exp('2026-08-06', 'arena', 'Зарплата', 400_000),
    exp('2026-08-07', 'arena', 'Аренда', 200_000),
    exp('2026-08-07', 'arena', 'Аренда', 5_000, 'declined'),
    exp('2026-08-08', 'arena', 'Налог 3%', 55_000),
    exp('2026-08-09', 'arena', 'Доля партнёра', 100_000),
    exp('2026-08-09', 'arena', 'Оборудование', 70_000),
  ]
  const r = buildProfitabilityReport({ ...base, months: ['2026-08'], incomes: [inc('2026-08-05', 'arena', 3_000_000)], expenses })
  const arena = r.companies.find((c) => c.id === 'arena')!
  const out = companyExpenseLines({ months: ['2026-08'], expenses, categoryGroups: groups })
  assert.equal(arena.total.revenue - arena.total.incomeTax - out.total, arena.total.netProfit)
  assert.ok(!out.lines.some((l) => l.category === 'Налог 3%' || l.category === 'Доля партнёра'))
  assert.equal(out.capexTotal, 70_000)
})
