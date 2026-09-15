/**
 * ОПиУ за период — один расчёт для страницы /profitability, приложения,
 * PDF по точке и печатной формы.
 *
 * Только из журналов, без поправок, — поэтому цифры сходятся с /income и /expenses:
 *  - выручка по дате смены, как в «Доходах»;
 *  - налог — расходы со статьёй налога, как в «Расходах»;
 *  - ручные вводы месяца в расчёт не входят;
 *  - отклонённые расходы не считаются, но видны в сверке;
 *  - F16 Extra в итогах только по галочке — как на /income и /expenses.
 *
 * У точки — только её журналы, ничего не разносится по доле выручки: сумма
 * точек равна итогу, потому что итог считается из тех же строк.
 */

import { findIncompleteMonths } from '@/lib/analysis/data-completeness'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import { computeMonthlyPnlFromParts, splitJournal, type MonthlyPnl, type ProfitabilityIncome } from '@/lib/domain/profitability'
import { isExtraCompany } from '@/lib/reports/extra-company'

export type PnlIncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

export type PnlExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  status?: string | null
  comment?: string | null
}

export type PnlCompany = { id: string; name: string; code?: string | null }

/** Строка ОПиУ, в которую попадает статья расхода */
export type PnlLineKey = 'cogs' | 'operating' | 'pos' | 'payroll' | 'payrollTaxes' | 'depreciation' | 'financial' | 'tax' | 'nonOperating' | 'capex' | 'distribution'

const LINE_OF_GROUP: Record<FinancialGroup, PnlLineKey> = {
  cogs: 'cogs',
  operating: 'operating',
  pos_commission: 'pos',
  payroll: 'payroll',
  payroll_advance: 'payroll',
  payroll_tax: 'payrollTaxes',
  depreciation: 'depreciation',
  financial_expenses: 'financial',
  income_tax: 'tax',
  non_operating: 'nonOperating',
  capex: 'capex',
  profit_distribution: 'distribution',
}

export type CategoryAmount = { name: string; amount: number }

export type PnlMonth = MonthlyPnl & {
  income: ProfitabilityIncome
  /** Статьи расходов внутри каждой строки ОПиУ */
  categories: Partial<Record<PnlLineKey, CategoryAmount[]>>
  /** Для сверки с /expenses: все расходы журнала и отклонённые из них */
  check: { expensesAll: number; declined: number; declinedCount: number }
}

export type CompanyPnl = {
  id: string
  name: string
  isExtra: boolean
  inTotals: boolean
  months: PnlMonth[]
  /** Месяц перед первым показанным */
  previous: PnlMonth | null
  total: PnlMonth
}

export type ProfitabilityReport = {
  months: PnlMonth[]
  /** Месяц перед первым показанным — для сравнения */
  previous: PnlMonth | null
  total: PnlMonth
  companies: CompanyPnl[]
  incompleteMonths: Array<{ month: string; companyId: string; company: string; days: number; expectedDays: number }>
  extra: { names: string[]; included: boolean }
}

const num = (v: unknown) => {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

const zeroIncome = (): ProfitabilityIncome => ({ cash: 0, kaspi: 0, card: 0, online: 0 })

const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const groupOf = (row: PnlExpenseRow, categoryGroups: Record<string, string | null>) =>
  resolveFinancialGroup(row.category, categoryGroups[String(row.category || '').trim().toLowerCase()] ?? null)

const sortedCategories = (map: Map<string, number>) =>
  Array.from(map, ([name, amount]) => ({ name, amount }))
    .filter((c) => Math.round(c.amount) !== 0)
    .sort((a, b) => b.amount - a.amount)

/** ОПиУ месяца из строк журналов. Отклонённые расходы попадают только в сверку. */
export function monthPnl(month: string, income: ProfitabilityIncome, rows: PnlExpenseRow[], categoryGroups: Record<string, string | null>): PnlMonth {
  const counted = rows.filter((r) => r.status !== 'declined')
  const pnl = computeMonthlyPnlFromParts(month, income, splitJournal(counted, month, categoryGroups), null)

  const byLine = new Map<PnlLineKey, Map<string, number>>()
  const check = { expensesAll: 0, declined: 0, declinedCount: 0 }
  for (const r of rows) {
    const amount = num(r.cash_amount) + num(r.kaspi_amount)
    check.expensesAll += amount
    if (r.status === 'declined') {
      check.declined += amount
      check.declinedCount += 1
      continue
    }
    const line = LINE_OF_GROUP[groupOf(r, categoryGroups)]
    const name = String(r.category || '').trim() || 'Без статьи'
    const map = byLine.get(line) || new Map<string, number>()
    map.set(name, (map.get(name) || 0) + amount)
    byLine.set(line, map)
  }

  const categories: PnlMonth['categories'] = {}
  for (const [line, map] of byLine) categories[line] = sortedCategories(map)
  return { ...pnl, income, categories, check }
}

const SUM_KEYS = [
  'revenue',
  'cashRevenue',
  'cashlessRevenue',
  'cogs',
  'grossProfit',
  'operatingExpenses',
  'posCommission',
  'payroll',
  'payrollTaxes',
  'otherOperating',
  'ebitda',
  'depreciation',
  'amortization',
  'operatingProfit',
  'financialExpenses',
  'incomeTax',
  'nonOperating',
  'netProfit',
  'capex',
  'profitDistribution',
  'incomeTaxPaid',
] as const

/** Итог нескольких месяцев; маржа — от суммарной выручки */
export function sumMonths(month: string, list: PnlMonth[]): PnlMonth {
  const out: Record<string, number> = {}
  for (const key of SUM_KEYS) out[key] = list.reduce((s, m) => s + num(m[key]), 0)

  const income = zeroIncome()
  const check = { expensesAll: 0, declined: 0, declinedCount: 0 }
  const byLine = new Map<PnlLineKey, Map<string, number>>()
  for (const m of list) {
    income.cash += m.income.cash
    income.kaspi += m.income.kaspi
    income.card += m.income.card
    income.online += m.income.online
    check.expensesAll += m.check.expensesAll
    check.declined += m.check.declined
    check.declinedCount += m.check.declinedCount
    for (const [line, cats] of Object.entries(m.categories) as Array<[PnlLineKey, CategoryAmount[]]>) {
      const map = byLine.get(line) || new Map<string, number>()
      for (const c of cats) map.set(c.name, (map.get(c.name) || 0) + c.amount)
      byLine.set(line, map)
    }
  }
  const categories: PnlMonth['categories'] = {}
  for (const [line, map] of byLine) categories[line] = sortedCategories(map)

  return {
    ...(out as unknown as MonthlyPnl),
    month,
    ebitdaMargin: out.revenue > 0 ? (out.ebitda / out.revenue) * 100 : 0,
    netMargin: out.revenue > 0 ? (out.netProfit / out.revenue) * 100 : 0,
    incomeTaxSource: 'journal',
    income,
    categories,
    check,
  }
}

const hasActivity = (m: PnlMonth) => m.revenue !== 0 || m.check.expensesAll !== 0

export function buildProfitabilityReport(input: {
  incomes: PnlIncomeRow[]
  expenses: PnlExpenseRow[]
  companies: PnlCompany[]
  categoryGroups: Record<string, string | null>
  /** Месяцы YYYY-MM по порядку */
  months: string[]
  /** Месяцы до этого считаются, но в итог не входят (нужны для сравнения) */
  visibleFrom?: string | null
  includeExtra: boolean
}): ProfitabilityReport {
  const { months, categoryGroups } = input
  const monthSet = new Set(months)
  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const inTotals = (cid: string) => input.includeExtra || !extraIds.has(cid)
  const companyIds = input.companies.map((c) => String(c.id))

  const incomeBy = new Map<string, ProfitabilityIncome>()
  for (const r of input.incomes) {
    const month = String(r.date).slice(0, 7)
    if (!monthSet.has(month)) continue
    const key = `${month}|${r.company_id}`
    const acc = incomeBy.get(key) || zeroIncome()
    acc.cash += num(r.cash_amount)
    acc.kaspi += num(r.kaspi_amount)
    acc.card += num(r.card_amount)
    acc.online += num(r.online_amount)
    incomeBy.set(key, acc)
  }

  const expensesBy = new Map<string, PnlExpenseRow[]>()
  for (const r of input.expenses) {
    const month = String(r.date).slice(0, 7)
    if (!monthSet.has(month)) continue
    const key = `${month}|${r.company_id}`
    const list = expensesBy.get(key) || []
    list.push(r)
    expensesBy.set(key, list)
  }

  const networkMonths: PnlMonth[] = []
  const companyMonths = new Map<string, PnlMonth[]>(companyIds.map((id) => [id, []]))

  for (const month of months) {
    const networkIncome = zeroIncome()
    const networkRows: PnlExpenseRow[] = []
    for (const cid of companyIds) {
      const inc = incomeBy.get(`${month}|${cid}`) || zeroIncome()
      const rows = expensesBy.get(`${month}|${cid}`) || []
      companyMonths.get(cid)!.push(monthPnl(month, inc, rows, categoryGroups))
      if (!inTotals(cid)) continue
      networkIncome.cash += inc.cash
      networkIncome.kaspi += inc.kaspi
      networkIncome.card += inc.card
      networkIncome.online += inc.online
      networkRows.push(...rows)
    }
    networkMonths.push(monthPnl(month, networkIncome, networkRows, categoryGroups))
  }

  const visibleFrom = input.visibleFrom || null
  const isVisible = (m: PnlMonth) => !visibleFrom || m.month >= visibleFrom
  const lastBefore = (list: PnlMonth[]) => {
    const before = visibleFrom ? list.filter((m) => m.month < visibleFrom) : []
    return before.length ? before[before.length - 1] : null
  }

  const visible = networkMonths.filter(isVisible)

  const companies: CompanyPnl[] = input.companies
    .map((c) => {
      const id = String(c.id)
      const all = companyMonths.get(id) || []
      const list = all.filter(isVisible)
      return {
        id,
        name: c.name,
        isExtra: extraIds.has(id),
        inTotals: inTotals(id),
        months: list,
        previous: lastBefore(all),
        total: sumMonths('total', list),
      }
    })
    .filter((c) => c.months.some(hasActivity) || (c.previous && hasActivity(c.previous)))
    .sort((a, b) => Number(b.inTotals) - Number(a.inTotals) || b.total.revenue - a.total.revenue)

  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))
  const visibleMonths = new Set(visible.map((m) => m.month))
  const incompleteMonths = months.length
    ? findIncompleteMonths(
        input.incomes
          .filter((r) => inTotals(String(r.company_id)))
          .map((r) => ({ company_id: String(r.company_id), date: String(r.date), cash: num(r.cash_amount), kaspi: num(r.kaspi_amount), card: num(r.card_amount), online: num(r.online_amount) })),
        nextMonth(months[months.length - 1]),
      )
        .filter((m) => visibleMonths.has(m.month))
        .map((m) => ({ month: m.month, companyId: m.companyId, company: nameOf.get(m.companyId) || '—', days: m.days, expectedDays: m.expectedDays }))
    : []

  return {
    months: visible,
    previous: lastBefore(networkMonths),
    total: sumMonths('total', visible),
    companies,
    incompleteMonths,
    extra: { names: input.companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name), included: input.includeExtra },
  }
}

// ─── Строки расходов точки для PDF ──────────────────────────────────────────

export type BranchLine = { category: string; accountingGroup: string; amount: number; cashAmount: number; kaspiAmount: number; count: number; comments: string[] }
export type BranchCapexLine = { category: string; amount: number; count: number; comments: string[]; items: Array<{ date: string; amount: number; comment: string }> }

/**
 * Расходы точки строками — ровно те суммы, из которых сложилась её прибыль:
 * выручка − налог − сумма строк = чистая прибыль. Налог из журнала идёт
 * отдельной строкой, выплаты партнёрам — вне ОПиУ, покупка оборудования —
 * отдельным блоком, отклонённые не считаются.
 */
export function companyExpenseLines(input: { months: string[]; expenses: PnlExpenseRow[]; categoryGroups: Record<string, string | null> }) {
  const monthSet = new Set(input.months)
  const lines = new Map<string, BranchLine>()
  const capex = new Map<string, BranchCapexLine>()

  for (const r of input.expenses) {
    if (r.status === 'declined' || !monthSet.has(String(r.date).slice(0, 7))) continue
    const cash = num(r.cash_amount)
    const kaspi = num(r.kaspi_amount)
    const amount = cash + kaspi
    if (!amount) continue
    const category = String(r.category || '').trim() || 'Без статьи'
    const group = groupOf(r, input.categoryGroups)
    const comment = String(r.comment || '').trim()
    if (group === 'capex') {
      const line = capex.get(category) || { category, amount: 0, count: 0, comments: [], items: [] }
      line.amount += amount
      line.count += 1
      if (comment && line.comments.length < 3 && !line.comments.includes(comment)) line.comments.push(comment)
      line.items.push({ date: String(r.date), amount, comment })
      capex.set(category, line)
      continue
    }
    if (group === 'profit_distribution' || group === 'income_tax') continue
    const line = lines.get(category) || { category, accountingGroup: group, amount: 0, cashAmount: 0, kaspiAmount: 0, count: 0, comments: [] }
    line.amount += amount
    line.cashAmount += cash
    line.kaspiAmount += kaspi
    line.count += 1
    if (comment && line.comments.length < 3 && !line.comments.includes(comment)) line.comments.push(comment)
    lines.set(category, line)
  }

  const lineList = Array.from(lines.values()).filter((l) => Math.abs(l.amount) >= 0.005).sort((a, b) => b.amount - a.amount)
  const capexList = Array.from(capex.values()).sort((a, b) => b.amount - a.amount)
  return {
    lines: lineList,
    capex: capexList,
    total: lineList.reduce((s, l) => s + l.amount, 0),
    capexTotal: capexList.reduce((s, l) => s + l.amount, 0),
  }
}
