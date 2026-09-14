/**
 * «Финдиректор» (/ai-cfo) — разбор периода, посчитанный кодом.
 *
 * Всё, что показывает страница цифрами, считается здесь: итоги как в /reports,
 * разбор изменения прибыли по статьям, вклад точек, безубыточность, оценка
 * здоровья и калькулятор «что если». ИИ получает этот разбор готовым и только
 * объясняет — своих сумм не придумывает.
 *
 * Без server-only: калькулятор «что если» работает и в браузере.
 */

import { FINANCIAL_GROUP_OPTIONS, resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

export type CfoIncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

export type CfoExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

export type Period = { from: string; to: string }

/** Как статья ведёт себя при росте выручки */
export type CostBucket = 'variable' | 'fixed' | 'oneOff' | 'tax' | 'distribution'

const BUCKET_OF: Record<FinancialGroup, CostBucket> = {
  cogs: 'variable',
  pos_commission: 'variable',
  operating: 'fixed',
  payroll: 'fixed',
  payroll_advance: 'fixed',
  payroll_tax: 'fixed',
  depreciation: 'fixed',
  financial_expenses: 'fixed',
  non_operating: 'oneOff',
  capex: 'oneOff',
  income_tax: 'tax',
  profit_distribution: 'distribution',
}

const PAYROLL_GROUPS = new Set<FinancialGroup>(['payroll', 'payroll_advance', 'payroll_tax'])

// Подписи групп простыми словами — для строк разбора
const GROUP_PLAIN: Partial<Record<FinancialGroup, string>> = {
  cogs: 'себестоимость',
  pos_commission: 'комиссия банка',
  operating: 'операционные',
  payroll: 'зарплата',
  payroll_advance: 'зарплата',
  payroll_tax: 'налоги на зарплату',
  depreciation: 'амортизация',
  financial_expenses: 'кредиты',
  income_tax: 'налог',
  non_operating: 'разовые',
  capex: 'оборудование',
  profit_distribution: 'выплаты партнёрам',
}

export const groupPlainLabel = (group: FinancialGroup) =>
  GROUP_PLAIN[group] || FINANCIAL_GROUP_OPTIONS.find((g) => g.value === group)?.label || 'расходы'

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Изменение в процентах; прошлого нет — 100 при появлении, 0 при нуле (старый контракт ответа) */
export const deltaPct = (cur: number, prev: number) => (!prev ? (cur ? 100 : 0) : ((cur - prev) / Math.abs(prev)) * 100)

export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

// ── Итоги периода ───────────────────────────────────────────────────────────

type PeriodAgg = {
  revenue: number
  expenses: number
  buckets: Record<CostBucket, number>
  payroll: number
  byCategory: Map<string, { amount: number; group: FinancialGroup }>
  byCompany: Map<string, { revenue: number; expenses: number }>
  salesDays: Map<string, Set<string>>
  salesDaysAll: Set<string>
  expenseDays: Set<string>
}

const emptyAgg = (): PeriodAgg => ({
  revenue: 0,
  expenses: 0,
  buckets: { variable: 0, fixed: 0, oneOff: 0, tax: 0, distribution: 0 },
  payroll: 0,
  byCategory: new Map(),
  byCompany: new Map(),
  salesDays: new Map(),
  salesDaysAll: new Set(),
  expenseDays: new Set(),
})

function companyOf(agg: PeriodAgg, id: string) {
  let c = agg.byCompany.get(id)
  if (!c) {
    c = { revenue: 0, expenses: 0 }
    agg.byCompany.set(id, c)
  }
  return c
}

// ── Результат ───────────────────────────────────────────────────────────────

export type BridgeLine = {
  key: string
  label: string
  kind: 'revenue' | 'expense' | 'other'
  group: FinancialGroup | null
  groupLabel: string | null
  current: number
  previous: number
  /** Влияние на прибыль: + добавило, − отняло */
  effect: number
}

export type CfoCompanyRow = {
  companyId: string
  name: string
  revenue: number
  expenses: number
  profit: number
  margin: number
  profitShare: number
  revenueDeltaPct: number
  profitDeltaPct: number
  previousProfit: number
  /** На сколько изменилась прибыль точки */
  profitDelta: number
}

export type HealthItem = { key: 'profitability' | 'dynamics' | 'risks' | 'data'; label: string; points: number; max: number; note: string }

export type CfoHealth = {
  score: number
  band: 'healthy' | 'attention' | 'problem'
  items: HealthItem[]
  missing: string[]
}

export type CfoReview = {
  executive: {
    revenue: number
    revenueDeltaPct: number
    expenses: number
    expensesDeltaPct: number
    profit: number
    profitDeltaPct: number
    margin: number
    marginDeltaPp: number
  }
  previous: { revenue: number; expenses: number; profit: number; margin: number }
  bridge: { startProfit: number; endProfit: number; lines: BridgeLine[] }
  companies: CfoCompanyRow[]
  ranking: { profitLeader: string | null; worst: string | null; efficiencyLeader: string | null; growthLeader: string | null } | null
  expenseChanges: Array<{ label: string; group: FinancialGroup; current: number; prev: number; deltaPct: number }>
  costStructure: {
    variableExpenses: number
    fixedExpenses: number
    /** Разовые: CAPEX и неоперационные (старое имя поля — для приложения) */
    capex: number
    oneOffExpenses: number
    incomeTax: number
    profitDistribution: number
    payroll: number
    contributionRatePct: number
    breakevenRevenue: number
    safetyMarginPct: number
    operatingProfit: number
  }
  fot: number
  fotShare: number
  concentrationPct: number
  dataQuality: {
    percent: number
    daysInPeriod: number
    daysWithSales: number
    salesCompleteness: number
    daysWithExpenses: number
    expenseCompleteness: number
    gaps: Array<{ companyId: string; name: string; daysWithSales: number; missingDays: number }>
  }
  health: CfoHealth
}

/** Сколько статей показывать в разборе отдельно — остальные одной строкой */
export const BRIDGE_TOP = 8
/** Точка «с пробелами», если не хватает стольких дней с доходом */
const GAP_DAYS = 3

export function buildCfoReview(input: {
  incomes: CfoIncomeRow[]
  expenses: CfoExpenseRow[]
  categoryGroups: Record<string, string | null>
  companies: Array<{ id: string; name: string }>
  current: Period
  previous: Period
}): CfoReview {
  const { current, previous } = input
  const cur = emptyAgg()
  const prev = emptyAgg()
  const bucketOf = (date: string) =>
    date >= current.from && date <= current.to ? cur : date >= previous.from && date <= previous.to ? prev : null

  for (const row of input.incomes) {
    const agg = bucketOf(row.date)
    if (!agg) continue
    const v = n(row.cash_amount) + n(row.kaspi_amount) + n(row.online_amount) + n(row.card_amount)
    if (!v) continue
    agg.revenue += v
    companyOf(agg, row.company_id).revenue += v
    const days = agg.salesDays.get(row.company_id) || new Set<string>()
    days.add(row.date)
    agg.salesDays.set(row.company_id, days)
    agg.salesDaysAll.add(row.date)
  }

  for (const row of input.expenses) {
    const agg = bucketOf(row.date)
    if (!agg) continue
    const v = n(row.cash_amount) + n(row.kaspi_amount)
    if (!v) continue
    const label = String(row.category || '').trim() || 'Без статьи'
    const group = resolveFinancialGroup(label, input.categoryGroups[label.toLowerCase()] ?? null)
    agg.expenses += v
    agg.buckets[BUCKET_OF[group]] += v
    if (PAYROLL_GROUPS.has(group)) agg.payroll += v
    const cat = agg.byCategory.get(label) || { amount: 0, group }
    cat.amount += v
    agg.byCategory.set(label, cat)
    companyOf(agg, row.company_id).expenses += v
    agg.expenseDays.add(row.date)
  }

  const profitCur = cur.revenue - cur.expenses
  const profitPrev = prev.revenue - prev.expenses
  const marginCur = cur.revenue ? (profitCur / cur.revenue) * 100 : 0
  const marginPrev = prev.revenue ? (profitPrev / prev.revenue) * 100 : 0

  // ── Почему изменилась прибыль ──
  const categories = new Set([...cur.byCategory.keys(), ...prev.byCategory.keys()])
  const expenseLines: BridgeLine[] = Array.from(categories).map((label) => {
    const c = cur.byCategory.get(label)
    const p = prev.byCategory.get(label)
    const group = (c || p)!.group
    const curAmount = c?.amount || 0
    const prevAmount = p?.amount || 0
    return {
      key: `cat:${label}`,
      label,
      kind: 'expense',
      group,
      groupLabel: groupPlainLabel(group),
      current: r0(curAmount),
      previous: r0(prevAmount),
      effect: r0(-(curAmount - prevAmount)),
    }
  })
  expenseLines.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
  const shown = expenseLines.slice(0, BRIDGE_TOP).filter((l) => l.effect !== 0)
  const rest = expenseLines.filter((l) => !shown.includes(l))
  const lines: BridgeLine[] = [
    {
      key: 'revenue',
      label: 'Выручка',
      kind: 'revenue',
      group: null,
      groupLabel: null,
      current: r0(cur.revenue),
      previous: r0(prev.revenue),
      effect: r0(cur.revenue - prev.revenue),
    },
    ...shown,
  ]
  const restEffect = rest.reduce((s, l) => s + l.effect, 0)
  if (rest.length && (restEffect !== 0 || rest.some((l) => l.effect !== 0))) {
    lines.push({
      key: 'other',
      label: `Остальные статьи (${rest.length})`,
      kind: 'other',
      group: null,
      groupLabel: null,
      current: rest.reduce((s, l) => s + l.current, 0),
      previous: rest.reduce((s, l) => s + l.previous, 0),
      effect: restEffect,
    })
  }
  // Округления строк не должны давать расхождение с итогом — остаток в строку выручки
  const startProfit = r0(profitPrev)
  const endProfit = r0(profitCur)
  const residual = endProfit - startProfit - lines.reduce((s, l) => s + l.effect, 0)
  if (residual) lines[0].effect += residual

  // ── Точки ──
  const nameOf = new Map(input.companies.map((c) => [c.id, c.name]))
  const companyIds = new Set([...cur.byCompany.keys(), ...prev.byCompany.keys()])
  const companies: CfoCompanyRow[] = Array.from(companyIds)
    .map((id) => {
      const c = cur.byCompany.get(id) || { revenue: 0, expenses: 0 }
      const p = prev.byCompany.get(id) || { revenue: 0, expenses: 0 }
      const profit = c.revenue - c.expenses
      const pProfit = p.revenue - p.expenses
      return {
        companyId: id,
        name: nameOf.get(id) || '—',
        revenue: r0(c.revenue),
        expenses: r0(c.expenses),
        profit: r0(profit),
        margin: r1(c.revenue ? (profit / c.revenue) * 100 : 0),
        profitShare: r1(profitCur ? (profit / profitCur) * 100 : 0),
        revenueDeltaPct: r1(deltaPct(c.revenue, p.revenue)),
        profitDeltaPct: r1(deltaPct(profit, pProfit)),
        previousProfit: r0(pProfit),
        profitDelta: r0(profit - pProfit),
      }
    })
    .sort((a, b) => b.profit - a.profit)

  const ranking = companies.length
    ? {
        profitLeader: companies[0].name,
        worst: companies[companies.length - 1].name,
        efficiencyLeader: [...companies].filter((c) => c.revenue > 0).sort((a, b) => b.margin - a.margin)[0]?.name || null,
        growthLeader: [...companies].sort((a, b) => b.profitDelta - a.profitDelta)[0]?.name || null,
      }
    : null

  const expenseChanges = expenseLines
    .filter((l) => l.current || l.previous)
    .slice(0, 8)
    .map((l) => ({ label: l.label, group: l.group!, current: l.current, prev: l.previous, deltaPct: r1(deltaPct(l.current, l.previous)) }))

  // ── Безубыточность ──
  const variable = cur.buckets.variable
  const fixed = cur.buckets.fixed
  const contributionRate = cur.revenue ? (cur.revenue - variable) / cur.revenue : 0
  const breakeven = contributionRate > 0 ? fixed / contributionRate : 0
  const safetyMargin = cur.revenue && contributionRate > 0 ? ((cur.revenue - breakeven) / cur.revenue) * 100 : 0
  const costStructure = {
    variableExpenses: r0(variable),
    fixedExpenses: r0(fixed),
    capex: r0(cur.buckets.oneOff),
    oneOffExpenses: r0(cur.buckets.oneOff),
    incomeTax: r0(cur.buckets.tax),
    profitDistribution: r0(cur.buckets.distribution),
    payroll: r0(cur.payroll),
    contributionRatePct: r1(contributionRate * 100),
    breakevenRevenue: r0(breakeven),
    safetyMarginPct: r1(safetyMargin),
    operatingProfit: r0(cur.revenue - variable - fixed),
  }
  const fotShare = cur.revenue ? (cur.payroll / cur.revenue) * 100 : 0
  const topRevenue = companies.length ? Math.max(...companies.map((c) => c.revenue)) : 0
  const concentrationPct = cur.revenue ? r1((topRevenue / cur.revenue) * 100) : 0

  // ── Полнота данных: по каждой точке, а не «был ли хоть один отчёт в сети» ──
  const daysInPeriod = daysInclusive(current.from, current.to)
  const activeIds = Array.from(new Set([...cur.salesDays.keys(), ...prev.salesDays.keys()]))
  const coverage = activeIds.map((id) => {
    const days = cur.salesDays.get(id)?.size || 0
    return { companyId: id, name: nameOf.get(id) || '—', daysWithSales: days, missingDays: Math.max(0, daysInPeriod - days) }
  })
  const salesCompleteness = coverage.length
    ? (coverage.reduce((s, c) => s + Math.min(1, c.daysWithSales / daysInPeriod), 0) / coverage.length) * 100
    : 0
  const dataQuality = {
    percent: Math.round(salesCompleteness),
    daysInPeriod,
    daysWithSales: cur.salesDaysAll.size,
    salesCompleteness: r1(salesCompleteness),
    daysWithExpenses: cur.expenseDays.size,
    expenseCompleteness: r1(Math.min(100, (cur.expenseDays.size / daysInPeriod) * 100)),
    gaps: coverage.filter((c) => c.missingDays >= GAP_DAYS).sort((a, b) => b.missingDays - a.missingDays),
  }

  const executive = {
    revenue: r0(cur.revenue),
    revenueDeltaPct: r1(deltaPct(cur.revenue, prev.revenue)),
    expenses: r0(cur.expenses),
    expensesDeltaPct: r1(deltaPct(cur.expenses, prev.expenses)),
    profit: r0(profitCur),
    profitDeltaPct: r1(deltaPct(profitCur, profitPrev)),
    margin: r1(marginCur),
    marginDeltaPp: r1(marginCur - marginPrev),
  }

  const health = scoreHealth({
    revenue: cur.revenue,
    profit: profitCur,
    margin: marginCur,
    safetyMargin,
    contributionRate,
    fixed,
    prevRevenue: prev.revenue,
    prevProfit: profitPrev,
    fotShare,
    concentrationPct,
    companiesCount: companies.filter((c) => c.revenue > 0).length,
    dataPercent: dataQuality.percent,
  })

  return {
    executive,
    previous: { revenue: r0(prev.revenue), expenses: r0(prev.expenses), profit: r0(profitPrev), margin: r1(marginPrev) },
    bridge: { startProfit, endProfit, lines },
    companies,
    ranking,
    expenseChanges,
    costStructure,
    fot: r0(cur.payroll),
    fotShare: r1(fotShare),
    concentrationPct,
    dataQuality,
    health,
  }
}

// ── Оценка здоровья: формула, одинаковая при каждом открытии ───────────────

export function scoreHealth(m: {
  revenue: number
  profit: number
  margin: number
  safetyMargin: number
  contributionRate: number
  fixed: number
  prevRevenue: number
  prevProfit: number
  fotShare: number
  concentrationPct: number
  companiesCount: number
  dataPercent: number
}): CfoHealth {
  const items: HealthItem[] = []
  const missing: string[] = ['Деньги — остатки на счетах и долги в разбор не передаются']

  if (m.revenue > 0) {
    const marginPts = clamp01(m.margin / 30) * 15
    const safetyPts = m.contributionRate <= 0 ? 0 : m.fixed <= 0 ? 15 : clamp01(m.safetyMargin / 40) * 15
    items.push({
      key: 'profitability',
      label: 'Рентабельность',
      points: r0(marginPts + safetyPts),
      max: 30,
      note: `маржа ${r1(m.margin)}% (30% и выше — полный балл), запас прочности ${r1(m.safetyMargin)}% (40% и выше)`,
    })
  } else {
    missing.push('Рентабельность — за период нет выручки')
  }

  if (m.prevRevenue > 0) {
    const revDelta = deltaPct(m.revenue, m.prevRevenue)
    const revPts = clamp01((revDelta + 10) / 20) * 15
    const profitPts =
      m.prevProfit > 0
        ? clamp01((deltaPct(m.profit, m.prevProfit) + 20) / 40) * 15
        : m.profit > m.prevProfit
          ? 15
          : m.profit === m.prevProfit
            ? 7.5
            : 0
    items.push({
      key: 'dynamics',
      label: 'Динамика',
      points: r0(revPts + profitPts),
      max: 30,
      note: `выручка ${revDelta >= 0 ? '+' : ''}${r1(revDelta)}% к прошлому периоду, прибыль ${m.profit >= m.prevProfit ? 'выросла' : 'снизилась'}`,
    })
  } else {
    missing.push('Динамика — в прошлом периоде нет выручки для сравнения')
  }

  if (m.revenue > 0) {
    const fotPts = m.fotShare <= 25 ? 10 : m.fotShare <= 35 ? 6 : m.fotShare <= 45 ? 3 : 0
    let points = fotPts
    let max = 10
    let note = `зарплаты ${r1(m.fotShare)}% выручки (до 25% — норма)`
    if (m.companiesCount >= 2) {
      points += m.concentrationPct < 35 ? 10 : m.concentrationPct < 50 ? 6 : m.concentrationPct < 70 ? 3 : 0
      max += 10
      note += `, крупнейшая точка — ${r1(m.concentrationPct)}% выручки`
    }
    items.push({ key: 'risks', label: 'Риски', points, max, note })
  }

  items.push({
    key: 'data',
    label: 'Полнота данных',
    points: r0(m.dataPercent * 0.2),
    max: 20,
    note: `отчёты внесены за ${m.dataPercent}% дней по точкам`,
  })

  const max = items.reduce((s, i) => s + i.max, 0)
  const score = max ? r0((items.reduce((s, i) => s + i.points, 0) / max) * 100) : 0
  return { score, band: score >= 80 ? 'healthy' : score >= 60 ? 'attention' : 'problem', items, missing }
}

// ── Что если ────────────────────────────────────────────────────────────────

export type WhatIfChange = { pricePct: number; volumePct: number; fixedPct: number }

/**
 * Операционная прибыль при изменениях. Цена меняет только выручку; поток
 * гостей/продаж — выручку и переменные расходы; постоянные — сами по себе.
 * Разовые, налог и выплаты партнёрам не трогаем.
 */
export function whatIf(base: { revenue: number; variable: number; fixed: number }, change: WhatIfChange) {
  const revenue = base.revenue * (1 + change.pricePct / 100) * (1 + change.volumePct / 100)
  const variable = base.variable * (1 + change.volumePct / 100)
  const fixed = base.fixed * (1 + change.fixedPct / 100)
  const operatingProfit = revenue - variable - fixed
  const baseProfit = base.revenue - base.variable - base.fixed
  return {
    revenue: r0(revenue),
    variable: r0(variable),
    fixed: r0(fixed),
    operatingProfit: r0(operatingProfit),
    delta: r0(operatingProfit - baseProfit),
  }
}
