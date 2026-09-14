import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCfoReview, scoreHealth, whatIf, type CfoExpenseRow, type CfoIncomeRow } from '@/lib/analysis/cfo-review'

const inc = (date: string, company_id: string, cash: number): CfoIncomeRow => ({
  date,
  company_id,
  cash_amount: cash,
  kaspi_amount: 0,
  online_amount: 0,
  card_amount: 0,
})
const exp = (date: string, company_id: string, category: string, cash: number): CfoExpenseRow => ({
  date,
  company_id,
  category,
  cash_amount: cash,
  kaspi_amount: 0,
})

const current = { from: '2026-08-01', to: '2026-08-31' }
const previous = { from: '2026-07-01', to: '2026-07-31' }
const companies = [
  { id: 'a', name: 'Арена' },
  { id: 'b', name: 'Магазин' },
]

function sample() {
  return buildCfoReview({
    current,
    previous,
    companies,
    categoryGroups: { 'закуп напитков': 'cogs' },
    incomes: [inc('2026-07-10', 'a', 1_000_000), inc('2026-07-10', 'b', 500_000), inc('2026-08-10', 'a', 900_000), inc('2026-08-10', 'b', 700_000)],
    expenses: [
      exp('2026-07-05', 'a', 'Аренда', 300_000),
      exp('2026-08-05', 'a', 'Аренда', 360_000),
      exp('2026-07-06', 'a', 'Зарплата', 200_000),
      exp('2026-08-06', 'a', 'Зарплата', 380_000),
      exp('2026-08-07', 'b', 'Закуп напитков', 100_000),
      exp('2026-08-20', 'a', 'Доля партнёра', 50_000),
    ],
  })
}

test('итоги: все расходы как в /reports, прибыль и изменения', () => {
  const r = sample()
  assert.equal(r.executive.revenue, 1_600_000)
  assert.equal(r.executive.expenses, 890_000)
  assert.equal(r.executive.profit, 710_000)
  assert.equal(r.previous.profit, 1_000_000)
  assert.equal(r.executive.profitDeltaPct, -29)
})

test('разбор прибыли сходится копейка в копейку и начинается с выручки', () => {
  const r = sample()
  const sum = r.bridge.lines.reduce((s, l) => s + l.effect, 0)
  assert.equal(r.bridge.startProfit + sum, r.bridge.endProfit)
  assert.equal(r.bridge.lines[0].key, 'revenue')
  assert.equal(r.bridge.lines[0].effect, 100_000)
  const salary = r.bridge.lines.find((l) => l.label === 'Зарплата')!
  assert.equal(salary.effect, -180_000)
  assert.equal(salary.group, 'payroll')
  // Самое сильное влияние среди статей — первым после выручки
  assert.equal(r.bridge.lines[1].label, 'Зарплата')
})

test('статья из справочника организации важнее догадки по названию', () => {
  const r = sample()
  assert.equal(r.costStructure.variableExpenses, 100_000)
  // ФОТ — по группе, распределение прибыли не в постоянных
  assert.equal(r.fot, 380_000)
  assert.equal(r.costStructure.fixedExpenses, 740_000)
  assert.equal(r.costStructure.profitDistribution, 50_000)
})

test('точки: вклад в изменение прибыли', () => {
  const r = sample()
  const arena = r.companies.find((c) => c.companyId === 'a')!
  const shop = r.companies.find((c) => c.companyId === 'b')!
  assert.equal(arena.profitDelta, 110_000 - 500_000)
  assert.equal(shop.profitDelta, 600_000 - 500_000)
  assert.equal(arena.profitDelta + shop.profitDelta, r.executive.profit - r.previous.profit)
})

test('полнота данных по каждой точке: один отчёт в сети не делает день полным', () => {
  const r = buildCfoReview({
    current: { from: '2026-08-01', to: '2026-08-10' },
    previous: { from: '2026-07-22', to: '2026-07-31' },
    companies,
    categoryGroups: {},
    incomes: [
      ...Array.from({ length: 10 }, (_, i) => inc(`2026-08-${String(i + 1).padStart(2, '0')}`, 'a', 100)),
      inc('2026-08-01', 'b', 100),
    ],
    expenses: [],
  })
  assert.equal(r.dataQuality.daysWithSales, 10)
  assert.equal(r.dataQuality.percent, 55)
  assert.deepEqual(r.dataQuality.gaps.map((g) => g.name), ['Магазин'])
})

test('много мелких статей сворачиваются в «остальные», сумма сохраняется', () => {
  const expenses = Array.from({ length: 12 }, (_, i) => exp('2026-08-03', 'a', `Статья ${i}`, 1000 * (i + 1)))
  const r = buildCfoReview({ current, previous, companies, categoryGroups: {}, incomes: [inc('2026-08-01', 'a', 100_000)], expenses })
  const other = r.bridge.lines.find((l) => l.kind === 'other')!
  assert.ok(other.label.startsWith('Остальные статьи'))
  assert.equal(r.bridge.lines.reduce((s, l) => s + l.effect, 0), r.bridge.endProfit - r.bridge.startProfit)
})

test('оценка здоровья: без данных компонент исключён, а не «100»', () => {
  const h = scoreHealth({
    revenue: 0,
    profit: 0,
    margin: 0,
    safetyMargin: 0,
    contributionRate: 0,
    fixed: 0,
    prevRevenue: 0,
    prevProfit: 0,
    fotShare: 0,
    concentrationPct: 0,
    companiesCount: 0,
    dataPercent: 0,
  })
  assert.equal(h.score, 0)
  assert.deepEqual(h.items.map((i) => i.key), ['data'])
  assert.ok(h.missing.some((m) => m.startsWith('Рентабельность')))
})

test('оценка здоровья одинакова при одинаковых цифрах и растёт с маржой', () => {
  const base = {
    revenue: 1_000_000,
    profit: 150_000,
    margin: 15,
    safetyMargin: 20,
    contributionRate: 0.8,
    fixed: 600_000,
    prevRevenue: 1_000_000,
    prevProfit: 150_000,
    fotShare: 20,
    concentrationPct: 60,
    companiesCount: 2,
    dataPercent: 100,
  }
  assert.deepEqual(scoreHealth(base), scoreHealth(base))
  assert.ok(scoreHealth({ ...base, margin: 30, profit: 300_000 }).score > scoreHealth(base).score)
})

test('что если: цена не увеличивает себестоимость, поток — увеличивает', () => {
  const base = { revenue: 1_000_000, variable: 300_000, fixed: 500_000 }
  assert.equal(whatIf(base, { pricePct: 5, volumePct: 0, fixedPct: 0 }).delta, 50_000)
  assert.equal(whatIf(base, { pricePct: 0, volumePct: 10, fixedPct: 0 }).delta, 70_000)
  assert.equal(whatIf(base, { pricePct: 0, volumePct: 0, fixedPct: -10 }).delta, 50_000)
})
