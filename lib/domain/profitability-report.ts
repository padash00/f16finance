/**
 * ОПиУ за период — один расчёт для страницы /profitability, приложения,
 * PDF по точке и печатной формы.
 *
 * Правила — как в /reports:
 *  - безналичный ночной смены после полуночи — на следующий день;
 *  - отклонённые расходы не считаются;
 *  - F16 Extra в итогах только по галочке.
 *
 * Налог — ставкой с выручки (упрощёнка, как на /tax). Налог из журнала
 * расходов — это его уплата: показывается справочно и второй раз из прибыли
 * не вычитается. Ручной ввод налога важнее ставки.
 *
 * Ручные вводы месяца (ФОТ, налоги на зарплату, комиссии, износ, прочие)
 * вводятся на всю организацию и разносятся по точкам пропорционально выручке
 * точки за месяц. Сумма точек сходится с итогом организации.
 */

import { findIncompleteMonths } from '@/lib/analysis/data-completeness'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import {
  computeMonthlyPnlFromParts,
  splitJournal,
  type JournalSplit,
  type MonthlyPnl,
  type ProfitabilityIncome,
  type ProfitabilityInputs,
} from '@/lib/domain/profitability'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { countImpreciseNightKaspiInRange, splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'

export type PnlIncomeRow = {
  id?: string | number
  date: string
  company_id: string
  shift?: 'day' | 'night' | null
  zone?: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight?: number | null
  online_amount: number | null
  card_amount: number | null
  comment?: string | null
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

export type ManualFlags = {
  revenue: boolean
  payroll: boolean
  payrollTaxes: boolean
  incomeTax: boolean
  posCommission: boolean
  depreciation: boolean
  amortization: boolean
  otherOperating: boolean
}

export type PnlMonth = MonthlyPnl & {
  parts: { income: ProfitabilityIncome; journal: JournalSplit }
  /** Какие строки месяца взяты из ручного ввода (у точки — разнесены по выручке) */
  manual: ManualFlags
}

export type CompanyPnl = {
  id: string
  name: string
  isExtra: boolean
  inTotals: boolean
  months: PnlMonth[]
  total: MonthlyPnl
  /** Доля выручки точки за период */
  share: number
}

export type CategoryRow = { name: string; group: FinancialGroup; amount: number }

export type ProfitabilityReport = {
  taxRate: number
  months: PnlMonth[]
  /** Месяц перед первым показанным — для «что изменилось» */
  previous: PnlMonth | null
  total: MonthlyPnl
  companies: CompanyPnl[]
  categoriesByMonth: Record<string, CategoryRow[]>
  /** Ночные смены без разбивки безнала до/после полуночи */
  impreciseNightByMonth: Record<string, number>
  incompleteMonths: Array<{ month: string; companyId: string; company: string; days: number; expectedDays: number }>
  extra: { names: string[]; included: boolean }
}

const num = (v: unknown) => {
  const x = Number(v || 0)
  return Number.isFinite(x) ? x : 0
}

const NO_FLAGS: ManualFlags = {
  revenue: false,
  payroll: false,
  payrollTaxes: false,
  incomeTax: false,
  posCommission: false,
  depreciation: false,
  amortization: false,
  otherOperating: false,
}

const TURNOVER_RATE_PAIRS: Array<[keyof ProfitabilityInputs, keyof ProfitabilityInputs]> = [
  ['kaspi_qr_turnover', 'kaspi_qr_rate'],
  ['kaspi_gold_turnover', 'kaspi_gold_rate'],
  ['qr_gold_turnover', 'qr_gold_rate'],
  ['other_cards_turnover', 'other_cards_rate'],
  ['kaspi_red_turnover', 'kaspi_red_rate'],
  ['kaspi_kredit_turnover', 'kaspi_kredit_rate'],
]

export function manualFlags(inputs: ProfitabilityInputs | null | undefined): ManualFlags {
  if (!inputs) return NO_FLAGS
  return {
    revenue: num(inputs.cash_revenue_override) > 0 || num(inputs.pos_revenue_override) > 0,
    payroll: num(inputs.payroll_amount) > 0,
    payrollTaxes: num(inputs.payroll_taxes_amount) > 0,
    incomeTax: num(inputs.income_tax_amount) > 0,
    posCommission: TURNOVER_RATE_PAIRS.some(([t, r]) => num(inputs[t]) > 0 && num(inputs[r]) > 0),
    depreciation: num(inputs.depreciation_amount) > 0,
    amortization: num(inputs.amortization_amount) > 0,
    otherOperating: num(inputs.other_operating_amount) > 0,
  }
}

const SCALED_FIELDS: Array<keyof ProfitabilityInputs> = [
  'payroll_amount',
  'payroll_taxes_amount',
  'income_tax_amount',
  'depreciation_amount',
  'amortization_amount',
  'other_operating_amount',
  'kaspi_qr_turnover',
  'kaspi_gold_turnover',
  'qr_gold_turnover',
  'other_cards_turnover',
  'kaspi_red_turnover',
  'kaspi_kredit_turnover',
]

/** Доля ручных вводов для точки. Ручная выручка на точки не разносится — у точки выручка из журнала. */
export function allocateInputs(inputs: ProfitabilityInputs, share: number): ProfitabilityInputs {
  const out: Record<string, unknown> = { ...inputs, cash_revenue_override: 0, pos_revenue_override: 0 }
  for (const field of SCALED_FIELDS) out[field] = num(inputs[field]) * share
  return out as ProfitabilityInputs
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

/** Итог нескольких месяцев той же цепочкой; маржа — от суммарной выручки */
export function sumPnl(month: string, list: MonthlyPnl[]): MonthlyPnl {
  const out: Record<string, number> = {}
  for (const key of SUM_KEYS) out[key] = list.reduce((s, m) => s + num(m[key]), 0)
  const sources = new Set(list.map((m) => m.incomeTaxSource))
  return {
    ...(out as unknown as MonthlyPnl),
    month,
    ebitdaMargin: out.revenue > 0 ? (out.ebitda / out.revenue) * 100 : 0,
    netMargin: out.revenue > 0 ? (out.netProfit / out.revenue) * 100 : 0,
    incomeTaxSource: sources.size === 1 ? [...sources][0] : 'mixed',
  }
}

const zeroIncome = (): ProfitabilityIncome => ({ cash: 0, kaspi: 0, card: 0, online: 0 })
const incomeTotal = (i: ProfitabilityIncome) => i.cash + i.kaspi + i.card + i.online
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function buildProfitabilityReport(input: {
  incomes: PnlIncomeRow[]
  expenses: PnlExpenseRow[]
  companies: PnlCompany[]
  categoryGroups: Record<string, string | null>
  inputsByMonth: Record<string, ProfitabilityInputs | null | undefined>
  /** Месяцы YYYY-MM по порядку */
  months: string[]
  /** Месяцы до этого считаются, но в итог не входят (нужны для сравнения) */
  visibleFrom?: string | null
  includeExtra: boolean
  taxRate: number
}): ProfitabilityReport {
  const { months, categoryGroups, taxRate } = input
  const monthSet = new Set(months)
  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const inTotals = (cid: string) => input.includeExtra || !extraIds.has(cid)
  const companyIds = input.companies.map((c) => String(c.id))

  const rawIncomes = input.incomes.map((r, i) => ({
    ...r,
    id: String(r.id ?? `row-${i}`),
    company_id: String(r.company_id),
    shift: (r.shift ?? 'day') as 'day' | 'night',
    zone: r.zone ?? null,
    comment: r.comment ?? null,
  })) as ReportIncomeCalendarRow[]
  const split = splitIncomeKaspiByCalendarDay(rawIncomes)

  const incomeBy = new Map<string, Map<string, ProfitabilityIncome>>()
  for (const r of split) {
    const month = String(r.date).slice(0, 7)
    if (!monthSet.has(month)) continue
    const byCompany = incomeBy.get(month) || new Map<string, ProfitabilityIncome>()
    const acc = byCompany.get(r.company_id) || zeroIncome()
    acc.cash += num(r.cash_amount)
    acc.kaspi += num(r.kaspi_amount)
    acc.card += num(r.card_amount)
    acc.online += num(r.online_amount)
    byCompany.set(r.company_id, acc)
    incomeBy.set(month, byCompany)
  }

  const expensesBy = new Map<string, Map<string, PnlExpenseRow[]>>()
  for (const r of input.expenses) {
    if (r.status === 'declined') continue
    const month = String(r.date).slice(0, 7)
    if (!monthSet.has(month)) continue
    const byCompany = expensesBy.get(month) || new Map<string, PnlExpenseRow[]>()
    const list = byCompany.get(String(r.company_id)) || []
    list.push(r)
    byCompany.set(String(r.company_id), list)
    expensesBy.set(month, byCompany)
  }

  const allMonths: PnlMonth[] = []
  const companyMonths = new Map<string, PnlMonth[]>(companyIds.map((id) => [id, []]))
  const categoriesByMonth: Record<string, CategoryRow[]> = {}

  for (const month of months) {
    const inputs = input.inputsByMonth[month] || null
    const flags = manualFlags(inputs)
    const incomes = incomeBy.get(month) || new Map<string, ProfitabilityIncome>()
    const expenses = expensesBy.get(month) || new Map<string, PnlExpenseRow[]>()

    const networkIncome = zeroIncome()
    const networkRows: PnlExpenseRow[] = []
    let networkRevenue = 0
    for (const cid of companyIds) {
      if (!inTotals(cid)) continue
      const inc = incomes.get(cid)
      if (inc) {
        networkIncome.cash += inc.cash
        networkIncome.kaspi += inc.kaspi
        networkIncome.card += inc.card
        networkIncome.online += inc.online
        networkRevenue += incomeTotal(inc)
      }
      networkRows.push(...(expenses.get(cid) || []))
    }

    const networkJournal = splitJournal(networkRows, month, categoryGroups)
    const pnl = computeMonthlyPnlFromParts(month, networkIncome, networkJournal, inputs, { taxRate })
    allMonths.push({ ...pnl, parts: { income: networkIncome, journal: networkJournal }, manual: flags })

    const categories = new Map<string, CategoryRow>()
    for (const r of networkRows) {
      const name = String(r.category || '').trim() || 'Без статьи'
      const group = resolveFinancialGroup(name, categoryGroups[name.toLowerCase()] ?? null)
      const row = categories.get(name) || { name, group, amount: 0 }
      row.amount += num(r.cash_amount) + num(r.kaspi_amount)
      categories.set(name, row)
    }
    categoriesByMonth[month] = Array.from(categories.values()).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount)

    for (const cid of companyIds) {
      const inc = incomes.get(cid) || zeroIncome()
      const rows = expenses.get(cid) || []
      const counted = inTotals(cid)
      const share = counted && networkRevenue > 0 ? incomeTotal(inc) / networkRevenue : 0
      const journal = splitJournal(rows, month, categoryGroups)
      // Ручной ввод организации заменяет журнал целиком — у точки тоже, иначе
      // сумма точек разойдётся с итогом
      if (counted) {
        if (flags.payroll) journal.payroll = 0
        if (flags.payrollTaxes) journal.payrollTaxes = 0
        if (flags.posCommission) journal.posCommission = 0
        if (flags.depreciation) journal.depreciation = 0
      }
      const companyInputs = counted && inputs ? allocateInputs(inputs, share) : null
      const cp = computeMonthlyPnlFromParts(month, inc, journal, companyInputs, { taxRate })
      companyMonths.get(cid)!.push({ ...cp, parts: { income: inc, journal }, manual: counted ? { ...flags, revenue: false } : NO_FLAGS })
    }
  }

  const visibleFrom = input.visibleFrom || null
  const visible = allMonths.filter((m) => !visibleFrom || m.month >= visibleFrom)
  const before = visibleFrom ? allMonths.filter((m) => m.month < visibleFrom) : []
  const total = sumPnl('total', visible)

  const companies: CompanyPnl[] = input.companies
    .map((c) => {
      const id = String(c.id)
      const list = (companyMonths.get(id) || []).filter((m) => !visibleFrom || m.month >= visibleFrom)
      const companyTotal = sumPnl('total', list)
      return {
        id,
        name: c.name,
        isExtra: extraIds.has(id),
        inTotals: inTotals(id),
        months: list,
        total: companyTotal,
        share: inTotals(id) && total.revenue > 0 ? companyTotal.revenue / total.revenue : 0,
      }
    })
    .filter((c) => c.months.some((m) => m.revenue || m.cogs || m.operatingExpenses || m.payroll || m.posCommission || m.capex || m.nonOperating || m.financialExpenses))
    .sort((a, b) => Number(b.inTotals) - Number(a.inTotals) || b.total.revenue - a.total.revenue)

  const countedRaw = rawIncomes.filter((r) => inTotals(r.company_id))
  const impreciseNightByMonth: Record<string, number> = {}
  for (const m of visible) impreciseNightByMonth[m.month] = countImpreciseNightKaspiInRange(countedRaw, `${m.month}-01`, monthEnd(m.month))

  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))
  const visibleMonths = new Set(visible.map((m) => m.month))
  const incompleteMonths = months.length
    ? findIncompleteMonths(
        split
          .filter((r) => inTotals(r.company_id))
          .map((r) => ({ company_id: r.company_id, date: r.date, cash: num(r.cash_amount), kaspi: num(r.kaspi_amount), card: num(r.card_amount), online: num(r.online_amount) })),
        nextMonth(months[months.length - 1]),
      )
        .filter((m) => visibleMonths.has(m.month))
        .map((m) => ({ month: m.month, companyId: m.companyId, company: nameOf.get(m.companyId) || '—', days: m.days, expectedDays: m.expectedDays }))
    : []

  return {
    taxRate,
    months: visible,
    previous: before.length ? before[before.length - 1] : null,
    total,
    companies,
    categoriesByMonth,
    impreciseNightByMonth,
    incompleteMonths,
    extra: { names: input.companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name), included: input.includeExtra },
  }
}

// ─── Почему изменилась прибыль ──────────────────────────────────────────────

export type ProfitBridgeLine = { key: string; label: string; current: number; previous: number; effect: number }

/** Изменение чистой прибыли по строкам ОПиУ; сумма влияний = изменение прибыли */
export function profitBridge(current: MonthlyPnl, previous: MonthlyPnl): ProfitBridgeLine[] {
  const rows: Array<[string, string, 1 | -1, (p: MonthlyPnl) => number]> = [
    ['revenue', 'Выручка', 1, (p) => p.revenue],
    ['cogs', 'Себестоимость', -1, (p) => p.cogs],
    ['operating', 'Операционные расходы', -1, (p) => p.operatingExpenses],
    ['pos', 'Комиссия банка', -1, (p) => p.posCommission],
    ['payroll', 'Зарплаты', -1, (p) => p.payroll],
    ['payrollTaxes', 'Налоги на зарплату', -1, (p) => p.payrollTaxes],
    ['other', 'Прочие операционные', -1, (p) => p.otherOperating],
    ['depreciation', 'Износ и амортизация', -1, (p) => p.depreciation + p.amortization],
    ['financial', 'Проценты по кредитам', -1, (p) => p.financialExpenses],
    ['tax', 'Налог', -1, (p) => p.incomeTax],
    ['nonOperating', 'Разовые', -1, (p) => p.nonOperating],
  ]
  return rows
    .map(([key, label, sign, get]) => ({ key, label, current: get(current), previous: get(previous), effect: sign * (get(current) - get(previous)) }))
    .filter((line) => line.key === 'revenue' || Math.round(line.effect) !== 0)
}

// ─── Строки расходов точки для PDF ──────────────────────────────────────────

export type BranchLine = { category: string; accountingGroup: string; amount: number; cashAmount: number; kaspiAmount: number; count: number; comments: string[] }
export type BranchCapexLine = { category: string; amount: number; count: number; comments: string[]; items: Array<{ date: string; amount: number; comment: string }> }

/**
 * Расходы точки строками — ровно те суммы, из которых сложилась её прибыль:
 * выручка − налог − сумма строк = чистая прибыль. Где месяц взят из ручного
 * ввода, журнальные строки этой группы заменяются одной строкой «ручной ввод».
 * Налог из журнала не входит (он отдельной строкой), выплаты партнёрам — вне
 * ОПиУ, покупка оборудования — отдельным блоком.
 */
export function companyExpenseLines(input: { months: PnlMonth[]; expenses: PnlExpenseRow[]; categoryGroups: Record<string, string | null> }) {
  const lines = new Map<string, BranchLine>()
  const capex = new Map<string, BranchCapexLine>()
  const add = (category: string, accountingGroup: string, amount: number, cash: number, kaspi: number, comment?: string) => {
    if (!amount) return
    const line = lines.get(category) || { category, accountingGroup, amount: 0, cashAmount: 0, kaspiAmount: 0, count: 0, comments: [] }
    line.amount += amount
    line.cashAmount += cash
    line.kaspiAmount += kaspi
    line.count += 1
    if (comment && line.comments.length < 3 && !line.comments.includes(comment)) line.comments.push(comment)
    lines.set(category, line)
  }

  for (const m of input.months) {
    for (const r of input.expenses) {
      if (r.status === 'declined' || !String(r.date).startsWith(m.month)) continue
      const cash = num(r.cash_amount)
      const kaspi = num(r.kaspi_amount)
      const amount = cash + kaspi
      if (!amount) continue
      const category = String(r.category || '').trim() || 'Без статьи'
      const group = resolveFinancialGroup(category, input.categoryGroups[category.toLowerCase()] ?? null)
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
      if (m.manual.payroll && (group === 'payroll' || group === 'payroll_advance')) continue
      if (m.manual.payrollTaxes && group === 'payroll_tax') continue
      if (m.manual.posCommission && group === 'pos_commission') continue
      if (m.manual.depreciation && group === 'depreciation') continue
      add(category, group, amount, cash, kaspi, comment)
    }
    if (m.manual.payroll) add('ФОТ — ручной ввод', 'payroll', m.payroll, 0, 0)
    if (m.manual.payrollTaxes) add('Налоги на зарплату — ручной ввод', 'payroll_tax', m.payrollTaxes, 0, 0)
    if (m.manual.posCommission) add('Комиссия банка — по оборотам', 'pos_commission', m.posCommission, 0, 0)
    if (m.manual.depreciation) add('Износ — ручной ввод', 'depreciation', m.depreciation, 0, 0)
    if (m.amortization) add('Амортизация', 'depreciation', m.amortization, 0, 0)
    if (m.otherOperating) add('Прочие операционные — ручной ввод', 'operating', m.otherOperating, 0, 0)
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
