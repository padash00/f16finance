import type { ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'

type Exp = { date: string; cash_amount: number | null; kaspi_amount: number | null }

function num(v: unknown) {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function sumIncomeExpenseInRange(
  incomes: ReportIncomeCalendarRow[],
  expenses: Exp[],
  from: string,
  to: string,
): { totalIncome: number; totalExpense: number; profit: number } {
  let totalIncome = 0
  for (const r of incomes) {
    if (r.date < from || r.date > to) continue
    const cash = num(r.cash_amount)
    const kaspi = num(r.kaspi_amount)
    const online = num(r.online_amount)
    const card = num(r.card_amount)
    totalIncome += cash + kaspi + online + card
  }
  let totalExpense = 0
  for (const r of expenses) {
    if (r.date < from || r.date > to) continue
    totalExpense += num(r.cash_amount) + num(r.kaspi_amount)
  }
  return { totalIncome, totalExpense, profit: totalIncome - totalExpense }
}
