import 'server-only'

type IncomeAgg = { cash: number; kaspi: number; online: number; card: number; total: number }
type DailyRow = { date: string; income: number; expense: number; net: number }
type ExpenseCat = { category: string; amount: number }
type CompanyBlock = {
  id: string
  name: string
  code: string | null
  income: IncomeAgg
  expenses: ExpenseCat[]
  expense_total: number
  expense_cash: number
  expense_kaspi: number
  net: number
  remain_cash: number
  remain_kaspi: number
  daily: DailyRow[]
}
export type WeeklyActData = {
  from: string
  to: string
  days: string[]
  companies: CompanyBlock[]
  totals: {
    income: IncomeAgg
    expense_total: number
    expense_cash: number
    expense_kaspi: number
    net: number
    remain_cash: number
    remain_kaspi: number
  } | null
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
function humanDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}
function ddmm(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
function wdShort(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short' })
}

// Превращает ответ /api/admin/weekly-act в JSON-контракт для orda-weekly-template.
export function buildWeeklyContract(data: WeeklyActData, generated: string) {
  const r2 = (n: number) => Math.round(Number(n) || 0)
  const year = new Date(data.to + 'T00:00:00').getFullYear()
  const period = `${humanDate(data.from)} — ${humanDate(data.to)} ${year}`
  const t = data.totals
  const total = {
    income: r2(t?.income.total || 0),
    expense: r2(t?.expense_total || 0),
    net: r2(t?.net || 0),
    cashLeft: r2(t?.remain_cash || 0),
    cashlessLeft: r2(t?.remain_kaspi || 0),
  }
  const points = (data.companies || []).map((c) => ({
    name: c.name,
    income: r2(c.income.total),
    expense: r2(c.expense_total),
    net: r2(c.net),
    incomeCash: r2(c.income.cash),
    incomeCashless: r2(c.income.kaspi + c.income.online + c.income.card),
    leftCash: r2(c.remain_cash),
    leftCashless: r2(c.remain_kaspi),
    days: (c.daily || []).map((d) => {
      const hasOps = (d.income || 0) !== 0 || (d.expense || 0) !== 0
      return {
        d: ddmm(d.date),
        wd: wdShort(d.date),
        income: d.income ? r2(d.income) : null,
        expense: d.expense ? r2(d.expense) : null,
        net: hasOps ? r2(d.net) : null,
      }
    }),
    categories: (c.expenses || []).map((e) => ({ name: e.category, amount: r2(e.amount) })),
  }))
  return { period, generated, total, points }
}
