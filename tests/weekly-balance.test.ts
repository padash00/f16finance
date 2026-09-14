import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWeeklyBalance, findMissingShifts, weekPlanStatus, type WeekExpenseRow, type WeekIncomeRow } from '@/lib/reports/weekly-balance'
import { datesBetween } from '@/lib/analysis/goal-pace'

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
  assert.equal(b.current.income.night, 60)
  assert.equal(b.days[0].current.income.cashless, 30)
  assert.equal(b.days[6].current.income.cashless, 30)
})

test('безналичный = терминал + онлайн + карта; отклонённые не считаются, на согласовании — считаются и видны', () => {
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-20',
    includeExtra: false,
    incomes: [inc('2026-09-08', 'arena', { cash_amount: 1000, kaspi_amount: 300, online_amount: 200, card_amount: 100 })],
    expenses: [
      exp('2026-09-08', 'arena', 'Аренда', 400, 250),
      exp('2026-09-09', 'arena', 'Аренда', 999, 999, 'declined'),
      exp('2026-09-10', 'arena', 'Ремонт', 100, 0, 'pending_approval'),
    ],
  })
  assert.equal(b.current.income.cashless, 600)
  assert.equal(b.current.expense.total, 750)
  assert.equal(b.current.netCashless, 350)
  assert.deepEqual(b.pending, { count: 1, total: 100 })
  assert.ok(b.alerts.some((a) => a.title.startsWith('Ждут согласования')))
})

test('идущая неделя сравнивается с теми же днями прошлой, а не со всей неделей', () => {
  const prevWeek = datesBetween('2026-08-31', '2026-09-06')
  const b = buildWeeklyBalance({
    companies,
    weekStart: WEEK,
    today: '2026-09-09',
    includeExtra: false,
    incomes: [...prevWeek.map((d) => inc(d, 'arena', { cash_amount: 100 })), inc('2026-09-07', 'arena', { cash_amount: 100 }), inc('2026-09-08', 'arena', { cash_amount: 100 })],
    expenses: [],
  })
  assert.equal(b.compareUntil, '2026-09-08')
  assert.equal(b.comparedDays, 2)
  assert.equal(b.previous.income.total, 200)
  assert.equal(b.compared.income.total, 200)
  assert.equal(b.days[3].future, true)
})

test('сравнение с 4 неделями назад и со средним за 8 недель', () => {
  // Прошлые 8 недель: понедельник N недель назад приносил 100 × N
  const incomes: WeekIncomeRow[] = []
  for (let w = 1; w <= 8; w++) {
    const monday = new Date(Date.parse(`${WEEK}T00:00:00Z`) - w * 7 * 86_400_000).toISOString().slice(0, 10)
    incomes.push(inc(monday, 'arena', { cash_amount: 100 * w }))
  }
  incomes.push(inc(WEEK, 'arena', { cash_amount: 500 }))
  const base = { companies, weekStart: WEEK, today: '2026-09-08', includeExtra: false, incomes, expenses: [] }

  assert.equal(buildWeeklyBalance({ ...base, compare: 'week' }).previous.income.total, 100)
  assert.equal(buildWeeklyBalance({ ...base, compare: 'month' }).previous.income.total, 400)
  const avg = buildWeeklyBalance({ ...base, compare: 'avg8' })
  assert.equal(avg.previous.income.total, 450) // (100+…+800)/8
  assert.equal(avg.days[0].previous.income.total, 450)
  assert.equal(avg.compareShort, 'Среднее за 8 недель')
})

test('F16 Extra: не в итогах без галочки, но видна в точках; с галочкой — в итогах', () => {
  const rows = [inc('2026-09-08', 'arena', { cash_amount: 1000 }), inc('2026-09-08', 'extra', { cash_amount: 500 })]
  const without = buildWeeklyBalance({ companies, weekStart: WEEK, today: '2026-09-20', includeExtra: false, incomes: rows, expenses: [] })
  assert.equal(without.current.income.total, 1000)
  assert.equal(without.extra.excludedIncome, 500)
  assert.equal(without.companies.find((c) => c.id === 'extra')!.inTotals, false)
  assert.equal(buildWeeklyBalance({ companies, weekStart: WEEK, today: '2026-09-20', includeExtra: true, incomes: rows, expenses: [] }).current.income.total, 1500)
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
  assert.equal(b.previous.profit + revenue.effect + salary.effect, b.compared.profit)
  assert.ok(b.alerts.some((a) => a.tone === 'danger' && a.title === 'Неделя в минусе'))
})

test('невнесённые смены: по привычному графику точки, по вчерашний день', () => {
  const history = datesBetween('2026-08-10', '2026-09-06')
  const incomes: WeekIncomeRow[] = [
    ...history.flatMap((d) => [inc(d, 'arena', { cash_amount: 1 }), inc(d, 'arena', { shift: 'night', cash_amount: 1 })]),
    ...datesBetween(WEEK, '2026-09-10').map((d) => inc(d, 'arena', { cash_amount: 1 })),
    inc('2026-09-07', 'arena', { shift: 'night', cash_amount: 1 }),
    inc('2026-09-09', 'arena', { shift: 'night', cash_amount: 1 }),
    // Магазин без истории — не проверяется
    inc('2026-09-07', 'shop', { cash_amount: 1 }),
  ]
  const missing = findMissingShifts({ incomes, companies: [...companies, { id: 'shop', name: 'Магазин' }], weekStart: WEEK, today: '2026-09-10' })
  assert.deepEqual(missing, [{ companyId: 'arena', company: 'Арена', date: '2026-09-08', shift: 'night' }])
})

test('неделя против плана месяца: темп и сколько нужно было за неделю', () => {
  const incomes = datesBetween('2026-09-01', '2026-09-08').map((d) => inc(d, 'arena', { cash_amount: 100 }))
  const status = weekPlanStatus({
    plans: [{ company_id: null, kind: 'month.revenue', target_amount: 3000, period_start: '2026-09-01' }],
    incomes,
    companies,
    weekStart: WEEK,
    today: '2026-09-09',
  })!
  assert.equal(status.source, 'org')
  assert.equal(status.fact, 800)
  assert.equal(status.pace.daysLeft, 22)
  assert.equal(status.pace.requiredPerDay, 100)
  assert.equal(status.weekExpected, 700)
  assert.equal(status.weekExpectedToDate, 200)
  assert.equal(status.weekFact, 200)

  // Без общей цели — сумма целей точек
  const points = weekPlanStatus({
    plans: [
      { company_id: 'arena', kind: 'month.revenue', target_amount: 2000, period_start: '2026-09-01' },
      { company_id: 'shop', kind: 'month.revenue', target_amount: 1000, period_start: '2026-09-01' },
    ],
    incomes,
    companies,
    weekStart: WEEK,
    today: '2026-09-09',
  })!
  assert.equal(points.source, 'points')
  assert.equal(points.target, 3000)
  assert.equal(weekPlanStatus({ plans: [], incomes, companies, weekStart: WEEK, today: '2026-09-09' }), null)
})
