import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  balanceAt,
  buildCashflowReport,
  dailyChannelNet,
  projectMonthEnd,
  splitIncomes,
  upcomingPayments,
  type BalanceAnchor,
  type CfExpenseRow,
  type CfIncomeRow,
} from '@/lib/domain/cashflow-report'

const companies = [
  { id: 'arena', name: 'Арена', code: 'arena' },
  { id: 'extra', name: 'F16 Extra', code: 'extra' },
]

const inc = (date: string, company_id: string, parts: Partial<CfIncomeRow> = {}): CfIncomeRow => ({
  date,
  company_id,
  shift: 'day',
  cash_amount: 0,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
  ...parts,
})
const exp = (date: string, company_id: string, category: string, cash: number, cashless = 0, status: string | null = null): CfExpenseRow => ({
  date,
  company_id,
  category,
  cash_amount: cash,
  kaspi_amount: cashless,
  status,
})

const base = { companies, categoryGroups: {}, includeExtra: false, companyId: null, anchors: [] as BalanceAnchor[] }

test('потоки по каналам, прошлый период, Extra и отклонённые расходы', () => {
  const r = buildCashflowReport({
    ...base,
    from: '2026-09-08',
    to: '2026-09-10',
    incomes: [
      inc('2026-09-08', 'arena', { cash_amount: 1000, kaspi_amount: 300, online_amount: 100, card_amount: 50 }),
      inc('2026-09-09', 'extra', { cash_amount: 700 }),
      inc('2026-09-06', 'arena', { cash_amount: 900 }), // прошлый период 05–07.09
    ],
    expenses: [exp('2026-09-09', 'arena', 'Аренда', 200, 100), exp('2026-09-10', 'arena', 'Аренда', 999, 0, 'declined')],
  })
  assert.equal(r.prevFrom, '2026-09-05')
  assert.equal(r.flows.cash.in, 1000)
  assert.equal(r.flows.cashless.in, 450)
  assert.equal(r.flows.total.out, 300)
  assert.equal(r.flows.total.net, 1150)
  assert.equal(r.previous.total.in, 900)
  // Все дни периода — даже без движений
  assert.equal(r.days.length, 3)
  assert.equal(r.days[2].net, 0)
  assert.equal(r.totals.daysCount, 2)
  assert.equal(r.totals.endingBalance, 1150)
  // Extra видна в точках, но не в итогах
  assert.equal(r.companies.find((c) => c.id === 'extra')!.flows.total.in, 700)
  assert.equal(r.companies.find((c) => c.id === 'extra')!.inTotals, false)
})

test('назначение расходов: вложения, выплаты партнёрам, налоги и текущие', () => {
  const r = buildCashflowReport({
    ...base,
    from: '2026-09-01',
    to: '2026-09-30',
    incomes: [inc('2026-09-02', 'arena', { cash_amount: 5000 })],
    expenses: [
      exp('2026-09-03', 'arena', 'Покупка оборудования', 1000),
      exp('2026-09-04', 'arena', 'Доля партнёра', 800),
      exp('2026-09-05', 'arena', 'Налог 3%', 150),
      exp('2026-09-06', 'arena', 'Аренда', 400),
      exp('2026-09-07', 'arena', 'Ремонт', 100, 0, 'pending_approval'),
    ],
  })
  const by = Object.fromEntries(r.activities.map((a) => [a.key, a.amount]))
  assert.equal(by.investing, 1000)
  assert.equal(by.owners, 800)
  assert.equal(by.taxes, 150)
  assert.equal(by.operating, 500)
  assert.deepEqual(r.pending, { count: 1, total: 100 })
})

test('остаток: от отметки вперёд и назад, по всем точкам организации', () => {
  const anchor: BalanceAnchor = { id: 'a', company_id: null, as_of_date: '2026-09-05', cash_amount: 1000, cashless_amount: 500 }
  const incomes = [
    inc('2026-09-05', 'arena', { cash_amount: 100 }),
    inc('2026-09-06', 'arena', { kaspi_amount: 200 }),
    inc('2026-09-08', 'extra', { cash_amount: 50 }), // Extra: не в итогах, но в деньгах
  ]
  const expenses = [exp('2026-09-07', 'arena', 'Аренда', 300)]
  const r = buildCashflowReport({ ...base, from: '2026-09-07', to: '2026-09-08', incomes, expenses, anchors: [anchor] })
  assert.equal(r.balance!.scope, 'organization')
  // На конец 06.09: 1000+100 нал, 500+200 безнал
  assert.deepEqual(r.balance!.start, { cash: 1100, cashless: 700, total: 1800 })
  assert.deepEqual(r.balance!.end, { cash: 850, cashless: 700, total: 1550 })
  assert.equal(r.days[0].onHand!.cash, 800)
  assert.equal(r.flows.total.in, 0) // Extra не в итогах
  assert.equal(r.balance!.lowest.date, '2026-09-07')

  // Отметка позже дня — отматываем назад
  const daily = dailyChannelNet(splitIncomes(incomes), expenses, () => true)
  const later: BalanceAnchor = { id: 'b', company_id: null, as_of_date: '2026-09-08', cash_amount: 800, cashless_amount: 700 }
  assert.deepEqual(balanceAt('2026-09-06', later, daily), { cash: 1100, cashless: 700, total: 1800 })
})

test('остаток точки — только по её отметке', () => {
  const anchors: BalanceAnchor[] = [
    { id: 'org', company_id: null, as_of_date: '2026-09-01', cash_amount: 9999, cashless_amount: 0 },
    { id: 'arena', company_id: 'arena', as_of_date: '2026-09-01', cash_amount: 100, cashless_amount: 0 },
  ]
  const r = buildCashflowReport({ ...base, companyId: 'arena', from: '2026-09-01', to: '2026-09-02', incomes: [inc('2026-09-02', 'arena', { cash_amount: 50 })], expenses: [], anchors })
  assert.equal(r.balance!.scope, 'company')
  assert.equal(r.balance!.end.cash, 150)
})

test('регулярные платежи: 31-е в коротком месяце, уже созданные не повторяются', () => {
  const payments = upcomingPayments({
    today: '2026-09-20',
    horizonDays: 45,
    companies,
    include: () => true,
    templates: [
      { id: 't1', name: 'Аренда', category: 'Аренда', amount: 500000, payment_type: 'kaspi', company_id: 'arena', recurring_day_of_month: 31, recurring_active: true },
      { id: 't2', name: 'Интернет', category: 'Связь', amount: 30000, payment_type: 'cash', company_id: 'arena', recurring_day_of_month: 20, recurring_active: true, recurring_last_run_at: '2026-09-20' },
      { id: 't3', name: 'Выключен', category: null, amount: 1, payment_type: 'cash', company_id: 'arena', recurring_day_of_month: 25, recurring_active: false },
    ],
  })
  assert.deepEqual(
    payments.map((p) => [p.date, p.name, p.cashless]),
    [
      ['2026-09-30', 'Аренда', true],
      ['2026-10-20', 'Интернет', false],
      ['2026-10-31', 'Аренда', true],
    ],
  )
})

test('прогноз до конца месяца находит кассовый разрыв в день крупного платежа', () => {
  const projection = projectMonthEnd({
    today: '2026-09-26',
    incomeLeft: 500,
    expenseLeft: 1000,
    weights: new Array(7).fill(1),
    balanceStart: 300,
    source: 'model',
    payments: [{ date: '2026-09-27', templateId: 't', name: 'Аренда', category: 'Аренда', amount: 800, cashless: true, companyId: 'arena', company: 'Арена' }],
  })
  assert.equal(projection.monthEnd, '2026-09-30')
  assert.equal(projection.paymentsLeft, 800)
  assert.equal(projection.otherSpendLeft, 200)
  assert.equal(projection.netLeft, -500)
  assert.equal(projection.balanceEnd, -200)
  // Самая низкая точка — день аренды, а не конец месяца: дальше выручка подтягивает остаток
  assert.equal(projection.lowest!.date, '2026-09-27')
  assert.equal(Math.round(projection.lowest!.balance), -380)
})
