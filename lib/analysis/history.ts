import { generateDateRange, dayNames, parseISODateSafe, safeMargin } from '@/lib/analysis/core-utils'
import type { DataPoint } from '@/lib/analysis/types'

type DayAgg = {
  income: number
  expense: number
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
}

export function buildFullHistory(
  start: Date,
  end: Date,
  incomeRows: Array<{
    date: string
    cash_amount?: number | null
    kaspi_amount?: number | null
    card_amount?: number | null
    online_amount?: number | null
  }>,
  expenseRows: Array<{
    date: string
    category?: string | null
    cash_amount?: number | null
    kaspi_amount?: number | null
  }>,
  planRows: Array<{ date: string; planned_income?: number | null; planned_expense?: number | null }>,
): { history: DataPoint[]; expenseCategories: Record<string, number> } {
  const dbMap = new Map<string, DayAgg>()

  for (const r of incomeRows) {
    const date = r.date
    const cash = Number(r.cash_amount || 0)
    const kaspi = Number(r.kaspi_amount || 0)
    const card = Number(r.card_amount || 0)
    const online = Number(r.online_amount || 0)
    const val = cash + kaspi + card + online

    const cur = dbMap.get(date) || {
      income: 0,
      expense: 0,
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
    }
    cur.income += val
    cur.incomeCash += cash
    cur.incomeKaspi += kaspi
    cur.incomeCard += card
    cur.incomeOnline += online
    dbMap.set(date, cur)
  }

  const catsMap: Record<string, number> = {}
  for (const r of expenseRows) {
    const date = r.date
    const val = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    const cur = dbMap.get(date) || {
      income: 0,
      expense: 0,
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
    }
    cur.expense += val
    dbMap.set(date, cur)

    if (val > 0) {
      const catName = (r.category as string) || 'Прочее'
      catsMap[catName] = (catsMap[catName] || 0) + val
    }
  }

  const planMap = new Map<string, { planned_income: number; planned_expense: number }>()
  for (const r of planRows) {
    const date = r.date
    planMap.set(date, {
      planned_income: Number(r.planned_income || 0),
      planned_expense: Number(r.planned_expense || 0),
    })
  }

  const allDates = generateDateRange(start, end)
  const fullHistory: DataPoint[] = allDates.map((date) => {
    const fact = dbMap.get(date) || {
      income: 0,
      expense: 0,
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
    }
    const plan = planMap.get(date) || { planned_income: 0, planned_expense: 0 }
    const profit = fact.income - fact.expense

    const dObj = parseISODateSafe(date)
    const dow = dObj.getDay()

    return {
      date,
      income: fact.income,
      expense: fact.expense,
      profit,
      margin: safeMargin(profit, fact.income),
      dayOfWeek: dow,
      dayName: dayNames[dow]!,
      planned_income: plan.planned_income || 0,
      planned_expense: plan.planned_expense || 0,
      incomeCash: fact.incomeCash,
      incomeKaspi: fact.incomeKaspi,
      incomeCard: fact.incomeCard,
      incomeOnline: fact.incomeOnline,
    }
  })

  return { history: fullHistory, expenseCategories: catsMap }
}
