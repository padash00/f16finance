import 'server-only'

// Маппинг фин-групп приложения → ключи групп шаблона (goods/fot/ops/pos/tax/other).
const GROUP_MAP: Record<string, string> = {
  cogs: 'goods',
  payroll: 'fot',
  payroll_advance: 'fot',
  pos_commission: 'pos',
  payroll_tax: 'tax',
  operating: 'ops',
}
const mapGroup = (g: string) => GROUP_MAP[g] || 'other'

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
function fmtMonth(ym: string): string {
  const [y, m] = String(ym || '').split('-')
  const mi = Number(m)
  if (!mi || mi < 1 || mi > 12) return ym
  const name = MONTHS[mi - 1]
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}
export function periodLabel(from: string, to: string): string {
  return from === to ? fmtMonth(from) : `${fmtMonth(from)} — ${fmtMonth(to)}`
}

export type BranchExpense = { category: string; amount: number; comments?: string[]; accountingGroup: string }
export type BranchCapex = { category: string; amount: number; items?: Array<{ date: string; amount: number; comment: string }> }
export type BranchData = {
  company: { id: string; name: string; code: string | null }
  period: { from: string; to: string }
  turnover: number
  turnoverTax: number
  turnoverTaxRate: number
  expenses: BranchExpense[]
  expensesTotal: number
  netProfit: number
  capex: BranchCapex[]
  capexTotal: number
}

// Превращает ответ branch-report в JSON-контракт для orda-report-template.
export type ProfitabilityOptions = {
  /** Ручной ФОТ — адм. сотрудники (₸). >0 включает override. */
  payrollStaff?: number
  /** Ручной ФОТ — операторы по сменам (₸). */
  payrollOps?: number
  /** Пояснение к отчёту (рендерится внизу PDF). */
  note?: string
  /** Распределение чистой прибыли по партнёрам. */
  partners?: Array<{ name: string; percent: number }>
}

export function buildProfitabilityContract(data: BranchData, generated: string, opts: ProfitabilityOptions = {}) {
  const r2 = (n: number) => Math.round(Number(n) || 0)
  const money = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ')

  type Cat = { name: string; amount: number; g: string; sub: string | undefined }
  let categories: Cat[] = (data.expenses || [])
    .filter((e) => Number(e.amount) > 0)
    .map((e) => ({
      name: e.category || '—',
      amount: r2(e.amount),
      g: mapGroup(e.accountingGroup),
      sub: (e.comments && e.comments[0]) || undefined,
    }))

  const turnover = r2(data.turnover)
  const tax = r2(data.turnoverTax)

  // Ручной ФОТ: заменяет журнальную зарплату/аванс (группа ФОТ) и в блоке ФОТ,
  // и в строках расходов, и пересчитывает чистую прибыль — полная согласованность.
  const payStaff = Math.max(0, r2(opts.payrollStaff ?? 0))
  const payOps = Math.max(0, r2(opts.payrollOps ?? 0))
  const hasPayrollOverride = payStaff > 0 || payOps > 0

  let fot: Array<{ label: string; amount: number }>
  let expensesTotal: number

  if (hasPayrollOverride) {
    const oldPayroll = categories.filter((c) => c.g === 'fot').reduce((s, c) => s + c.amount, 0)
    const overrideLines: Cat[] = []
    if (payStaff > 0) overrideLines.push({ name: 'Адм. сотрудники', amount: payStaff, g: 'fot', sub: 'ФОТ (вручную)' })
    if (payOps > 0) overrideLines.push({ name: 'Операторы по сменам', amount: payOps, g: 'fot', sub: 'ФОТ (вручную)' })
    categories = [...categories.filter((c) => c.g !== 'fot'), ...overrideLines]
    fot = overrideLines.map((l) => ({ label: l.name, amount: l.amount })).sort((a, b) => b.amount - a.amount)
    expensesTotal = r2(data.expensesTotal) - oldPayroll + (payStaff + payOps)
  } else {
    fot = (data.expenses || [])
      .filter((e) => (e.accountingGroup === 'payroll' || e.accountingGroup === 'payroll_advance') && Number(e.amount) > 0)
      .map((e) => ({ label: e.category || 'ФОТ', amount: r2(e.amount) }))
      .sort((a, b) => b.amount - a.amount)
    expensesTotal = r2(data.expensesTotal)
  }

  categories.sort((a, b) => b.amount - a.amount)

  const profit = hasPayrollOverride ? turnover - tax - expensesTotal : r2(data.netProfit)
  const margin = turnover > 0 ? Number(((profit / turnover) * 100).toFixed(1)) : 0

  const top = categories[0]
  const insight = top && expensesTotal > 0
    ? `Основная нагрузка на расходы — ${top.name}: ${money(top.amount)} ₸, или ${((top.amount / expensesTotal) * 100).toFixed(1)}% всех расходов.`
    : undefined

  const capex = Number(data.capexTotal) > 0 && data.capex?.length
    ? {
        title: 'Капитальные вложения',
        total: r2(data.capexTotal),
        groups: data.capex.map((g) => ({
          name: g.category || '—',
          total: r2(g.amount),
          items: (g.items || []).map((i) => [i.date, i.comment || '—', r2(i.amount)] as [string, string, number]),
        })),
      }
    : undefined

  // Распределение чистой прибыли по партнёрам (доля от пересчитанной прибыли).
  const partners = (Array.isArray(opts.partners) ? opts.partners : [])
    .map((p) => ({ name: String(p?.name || '').trim(), percent: Number(p?.percent) || 0 }))
    .filter((p) => p.name && p.percent > 0)
    .map((p) => ({ name: p.name, percent: p.percent, amount: Math.round((profit * p.percent) / 100) }))

  const note = String(opts.note || '').trim() || undefined

  return {
    name: data.company.name,
    period: periodLabel(data.period.from, data.period.to),
    generated,
    turnover,
    expenses: expensesTotal,
    tax,
    taxRate: `${Math.round((Number(data.turnoverTaxRate) || 0) * 100)}%`,
    profit,
    margin,
    insight,
    fot,
    fotTotal: fot.reduce((s, f) => s + f.amount, 0),
    categories,
    capex,
    partners,
    note,
  }
}
