import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWeeklyBalance, type WeekExpenseRow, type WeekIncomeRow } from '@/lib/reports/weekly-balance'

const companies = [
  { id: 'arena', name: 'Арена', code: 'arena' },
  { id: 'extra', name: 'F16 Extra', code: 'extra' },
]

const inc = (date: string, company_id: string, parts: Partial<WeekIncomeRow> = {}): WeekIncomeRow => ({
  date,
  company_id,
  shift: 'day',
  cash_amount: 0,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
  kaspi_before_midnight: null,
  ...parts,
})
const exp = (date: string, company_id: string, category: string, cash: number, cashless = 0, status: string | null = null): WeekExpenseRow => ({
  date,
  company_id,
  category,
  cash_amount: cash,
  kaspi_amount: cashless,
  status,
})

// Неделя 7–13 сентября 2026 (пн–вс)
const WEEK = '2026-09-07'

test('безналичный ночной смены: воскресная ночь частично уходит, ночь перед понедельником приходит', () => {
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-20',
    includeExtra: false,
    incomes: [
      inc('2026-09-06', 'arena', { shift: 'night', kaspi_amount: 50, kaspi_before_midnight: 20 }), // 30 → пн 07.09
      inc('2026-09-13', 'arena', { shift: 'night', kaspi_amount: 100, kaspi_before_midnight: 30 }), // 70 → пн 14.09
    ],
    expenses: [],
  })
  assert.equal(b.current.income.terminal, 60)
  assert.equal(b.days[0].current.income.cashless, 30)
  assert.equal(b.days[6].current.income.cashless, 30)
})

test('безналичный = терминал + онлайн + карта; сальдо безнала — минус расходы безналом; отклонённые не считаются', () => {
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-20',
    includeExtra: false,
    incomes: [inc('2026-09-08', 'arena', { cash_amount: 1000, kaspi_amount: 300, online_amount: 200, card_amount: 100 })],
    expenses: [exp('2026-09-08', 'arena', 'Аренда', 400, 250), exp('2026-09-09', 'arena', 'Аренда', 999, 999, 'declined')],
  })
  assert.equal(b.current.income.cashless, 600)
  assert.equal(b.current.income.total, 1600)
  assert.equal(b.current.expense.total, 650)
  assert.equal(b.current.netCash, 600)
  assert.equal(b.current.netCashless, 350)
  assert.equal(b.current.profit, 950)
})

test('идущая неделя сравнивается с теми же днями прошлой, а не со всей неделей', () => {
  const prevWeek = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-09', // среда, отчёт за среду ещё не внесён
    includeExtra: false,
    incomes: [...prevWeek.map((d) => inc(d, 'arena', { cash_amount: 100 })), inc('2026-09-07', 'arena', { cash_amount: 100 }), inc('2026-09-08', 'arena', { cash_amount: 100 })],
    expenses: [],
  })
  assert.equal(b.compareUntil, '2026-09-08')
  assert.equal(b.comparedDays, 2)
  assert.equal(b.previous.income.total, 200)
  assert.equal(b.compared.income.total, 200)
  assert.ok(!b.alerts.some((a) => a.title.startsWith('Выручка ниже')))
  assert.equal(b.days[2].future, false)
  assert.equal(b.days[3].future, true)
})

test('F16 Extra: не в итогах без галочки, но видна в точках; с галочкой — в итогах', () => {
  const rows = [inc('2026-09-08', 'arena', { cash_amount: 1000 }), inc('2026-09-08', 'extra', { cash_amount: 500 })]
  const without = buildWeeklyBalance({ companies, weekStart: WEEK, today: '2026-09-20', includeExtra: false, incomes: rows, expenses: [] })
  assert.equal(without.current.income.total, 1000)
  assert.equal(without.extra.excludedIncome, 500)
  const extraRow = without.companies.find((c) => c.id === 'extra')!
  assert.equal(extraRow.inTotals, false)
  assert.equal(extraRow.current.income.total, 500)

  const withExtra = buildWeeklyBalance({ companies, weekStart: WEEK, today: '2026-09-20', includeExtra: true, incomes: rows, expenses: [] })
  assert.equal(withExtra.current.income.total, 1500)
})

test('что изменилось: выручка и статьи, минусовая неделя — предупреждение', () => {
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-20',
    includeExtra: false,
    incomes: [inc('2026-08-31', 'arena', { cash_amount: 1000 }), inc('2026-09-07', 'arena', { cash_amount: 800 })],
    expenses: [exp('2026-08-31', 'arena', 'Зарплата', 300), exp('2026-09-07', 'arena', 'Зарплата', 900)],
  })
  const revenue = b.changes.find((c) => c.kind === 'revenue')!
  const salary = b.changes.find((c) => c.label === 'Зарплата')!
  assert.equal(revenue.effect, -200)
  assert.equal(salary.effect, -600)
  assert.equal(b.previous.profit + revenue.effect + salary.effect, b.compared.profit)
  assert.ok(b.alerts.some((a) => a.tone === 'danger' && a.title === 'Неделя в минусе'))
  assert.ok(b.alerts.some((a) => a.title === 'Выручка ниже прошлой недели'))
})
