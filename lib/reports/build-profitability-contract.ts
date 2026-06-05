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
export function buildProfitabilityContract(data: BranchData, generated: string) {
  const r2 = (n: number) => Math.round(Number(n) || 0)
  const money = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ')

  const categories = (data.expenses || [])
    .filter((e) => Number(e.amount) > 0)
    .map((e) => ({
      name: e.category || '—',
      amount: r2(e.amount),
      g: mapGroup(e.accountingGroup),
      sub: (e.comments && e.comments[0]) || undefined,
    }))
    .sort((a, b) => b.amount - a.amount)

  const fot = (data.expenses || [])
    .filter((e) => (e.accountingGroup === 'payroll' || e.accountingGroup === 'payroll_advance') && Number(e.amount) > 0)
    .map((e) => ({ label: e.category || 'ФОТ', amount: r2(e.amount) }))
    .sort((a, b) => b.amount - a.amount)

  const turnover = r2(data.turnover)
  const tax = r2(data.turnoverTax)
  const expensesTotal = r2(data.expensesTotal)
  const profit = r2(data.netProfit)
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
  }
}
