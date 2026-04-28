import { calculatePrevPeriod } from '@/lib/reports/period'
import { getISOWeekKey, getISOWeekStartISO, getMonthKey, getYearKey } from '@/lib/reports/report-dates'

export type GroupMode = 'day' | 'week' | 'month' | 'year'

export type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
  remainingCash: number
  remainingKaspi: number
  totalBalance: number
  transactionCount: number
  avgTransaction: number
}

export type TimeAggregation = {
  /** Ключ ведра (день ISO, ISO-неделя, YYYY-MM, год) */
  key: string
  label: string
  sortISO: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  count: number
}

export type AnomalyType = 'income_spike' | 'expense_spike' | 'low_profit' | 'no_data' | 'high_cash_ratio'
export type Severity = 'low' | 'medium' | 'high' | 'critical'

export type Anomaly = {
  type: AnomalyType
  date: string
  description: string
  severity: Severity
  value: number
  companyId?: string
}

export type CompanyStat = {
  income: number
  expense: number
  profit: number
  cashIncome: number
  kaspiIncome: number
  onlineIncome: number
  cardIncome: number
  cashExpense: number
  kaspiExpense: number
  transactions: number
}

type IncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '0 ₸'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

const emptyTotals = (): FinancialTotals => ({
  incomeCash: 0,
  incomeKaspi: 0,
  incomeOnline: 0,
  incomeCard: 0,
  incomeNonCash: 0,
  expenseCash: 0,
  expenseKaspi: 0,
  totalIncome: 0,
  totalExpense: 0,
  profit: 0,
  remainingCash: 0,
  remainingKaspi: 0,
  totalBalance: 0,
  transactionCount: 0,
  avgTransaction: 0,
})

function finalize(t: FinancialTotals) {
  t.profit = t.totalIncome - t.totalExpense
  t.remainingCash = t.incomeCash - t.expenseCash
  t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
  t.totalBalance = t.profit
  t.avgTransaction = t.transactionCount > 0 ? t.totalIncome / t.transactionCount : 0
}

export function aggregateReportFromRows(input: {
  incomes: IncomeRow[]
  expenses: ExpenseRow[]
  dateFrom: string
  dateTo: string
  groupMode: GroupMode
  companyName: (id: string) => string
}): {
  totalsCur: FinancialTotals
  totalsPrev: FinancialTotals
  chartData: TimeAggregation[]
  expenseByCategoryMap: Map<string, number>
  incomeByCompanyMap: Map<
    string,
    { companyId: string; name: string; value: number; cash: number; kaspi: number; online: number; card: number; count: number }
  >
  companyStats: Map<string, CompanyStat>
  anomalies: Anomaly[]
  prevFrom: string
  prevTo: string
  dailyIncome: Map<string, number>
  dailyExpense: Map<string, number>
} {
  const { dateFrom, dateTo, groupMode, companyName } = input
  const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

  const totalsCur = emptyTotals()
  const totalsPrev = emptyTotals()

  const expenseByCategoryMap = new Map<string, number>()
  const incomeByCompanyMap = new Map<
    string,
    { companyId: string; name: string; value: number; cash: number; kaspi: number; online: number; card: number; count: number }
  >()
  const chartDataMap = new Map<string, TimeAggregation>()
  const companyStats = new Map<string, CompanyStat>()
  const dailyIncome = new Map<string, number>()
  const dailyExpense = new Map<string, number>()

  const getRangeBucket = (iso: string): 'current' | 'previous' | null => {
    if (iso >= dateFrom && iso <= dateTo) return 'current'
    if (iso >= prevFrom && iso <= prevTo) return 'previous'
    return null
  }

  const getKey = (iso: string) => {
    if (groupMode === 'day') return { key: iso, label: iso.slice(5), sortISO: iso }
    if (groupMode === 'week') {
      const wk = getISOWeekKey(iso)
      return { key: wk, label: wk, sortISO: getISOWeekStartISO(iso) }
    }
    if (groupMode === 'month') {
      const mk = getMonthKey(iso)
      return { key: mk, label: mk, sortISO: `${mk}-01` }
    }
    const y = getYearKey(iso)
    return { key: y, label: y, sortISO: `${y}-01-01` }
  }

  const ensureBucket = (key: string, label: string, sortISO: string): TimeAggregation => {
    const b = chartDataMap.get(key)
    if (b) return b
    const newBucket: TimeAggregation = {
      key,
      label,
      sortISO,
      income: 0,
      expense: 0,
      profit: 0,
      incomeCash: 0,
      incomeKaspi: 0,
      incomeOnline: 0,
      incomeCard: 0,
      incomeNonCash: 0,
      expenseCash: 0,
      expenseKaspi: 0,
      count: 0,
    }
    chartDataMap.set(key, newBucket)
    return newBucket
  }

  for (const r of input.incomes) {
    const range = getRangeBucket(r.date)
    if (!range) continue

    const cash = safeNumber(r.cash_amount)
    const kaspi = safeNumber(r.kaspi_amount)
    const online = safeNumber(r.online_amount)
    const card = safeNumber(r.card_amount)
    const nonCash = kaspi + online + card
    const total = cash + nonCash

    if (total <= 0 && cash === 0 && kaspi === 0 && online === 0) continue

    const tgt = range === 'current' ? totalsCur : totalsPrev
    tgt.incomeCash += cash
    tgt.incomeKaspi += kaspi
    tgt.incomeOnline += online
    tgt.incomeCard += card
    tgt.incomeNonCash += nonCash
    tgt.totalIncome += total
    tgt.transactionCount += 1

    if (range === 'current') {
      dailyIncome.set(r.date, (dailyIncome.get(r.date) || 0) + total)

      const { key, label, sortISO } = getKey(r.date)
      const bucket = ensureBucket(key, label, sortISO)
      bucket.income += total
      bucket.incomeCash += cash
      bucket.incomeKaspi += kaspi
      bucket.incomeOnline += online
      bucket.incomeCard += card
      bucket.incomeNonCash += nonCash
      bucket.count += 1

      const existing = incomeByCompanyMap.get(r.company_id)
      if (!existing) {
        incomeByCompanyMap.set(r.company_id, {
          companyId: r.company_id,
          name: companyName(r.company_id),
          value: total,
          cash,
          kaspi,
          online,
          card,
          count: 1,
        })
      } else {
        existing.value += total
        existing.cash += cash
        existing.kaspi += kaspi
        existing.online += online
        existing.card += card
        existing.count += 1
      }

      const cs = companyStats.get(r.company_id) || {
        income: 0,
        expense: 0,
        profit: 0,
        cashIncome: 0,
        kaspiIncome: 0,
        onlineIncome: 0,
        cardIncome: 0,
        cashExpense: 0,
        kaspiExpense: 0,
        transactions: 0,
      }
      cs.income += total
      cs.cashIncome += cash
      cs.kaspiIncome += kaspi
      cs.onlineIncome += online
      cs.cardIncome += card
      cs.transactions += 1
      companyStats.set(r.company_id, cs)
    }
  }

  for (const r of input.expenses) {
    const range = getRangeBucket(r.date)
    if (!range) continue

    const cash = safeNumber(r.cash_amount)
    const kaspi = safeNumber(r.kaspi_amount)
    const total = cash + kaspi

    if (total <= 0 && cash === 0 && kaspi === 0) continue

    const tgt = range === 'current' ? totalsCur : totalsPrev
    tgt.expenseCash += cash
    tgt.expenseKaspi += kaspi
    tgt.totalExpense += total
    tgt.transactionCount += 1

    if (range === 'current') {
      dailyExpense.set(r.date, (dailyExpense.get(r.date) || 0) + total)

      const category = r.category || 'Без категории'
      expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) || 0) + total)

      const { key, label, sortISO } = getKey(r.date)
      const bucket = ensureBucket(key, label, sortISO)
      bucket.expense += total
      bucket.expenseCash += cash
      bucket.expenseKaspi += kaspi

      const cs = companyStats.get(r.company_id) || {
        income: 0,
        expense: 0,
        profit: 0,
        cashIncome: 0,
        kaspiIncome: 0,
        onlineIncome: 0,
        cardIncome: 0,
        cashExpense: 0,
        kaspiExpense: 0,
        transactions: 0,
      }
      cs.expense += total
      cs.cashExpense += cash
      cs.kaspiExpense += kaspi
      companyStats.set(r.company_id, cs)
    }
  }

  finalize(totalsCur)
  finalize(totalsPrev)

  for (const [, stats] of companyStats) {
    stats.profit = stats.income - stats.expense
  }

  const anomalies: Anomaly[] = []
  const avgIncome = totalsCur.totalIncome / (dailyIncome.size || 1)
  const avgExpense = totalsCur.totalExpense / (dailyExpense.size || 1)

  for (const [date, amount] of dailyIncome) {
    if (amount > avgIncome * 2.5) {
      anomalies.push({
        type: 'income_spike',
        date,
        description: `Всплеск выручки: ${fmtMoney(amount)}`,
        severity: 'medium',
        value: amount,
      })
    }
  }

  for (const [date, amount] of dailyExpense) {
    if (amount > avgExpense * 2.5) {
      anomalies.push({
        type: 'expense_spike',
        date,
        description: `Аномальный расход: ${fmtMoney(amount)}`,
        severity: 'high',
        value: amount,
      })
    }
  }

  for (const agg of chartDataMap.values()) {
    agg.profit = agg.income - agg.expense
    if (agg.income > 0) {
      const margin = agg.profit / agg.income
      if (margin < 0.05) {
        anomalies.push({
          type: 'low_profit',
          date: agg.label,
          description: `Критически низкая маржа: ${(margin * 100).toFixed(1)}%`,
          severity: 'critical',
          value: agg.profit,
        })
      } else if (margin < 0.15) {
        anomalies.push({
          type: 'low_profit',
          date: agg.label,
          description: `Низкая маржа: ${(margin * 100).toFixed(1)}%`,
          severity: 'medium',
          value: agg.profit,
        })
      }
    }
  }

  if (totalsCur.totalIncome > 0) {
    const cashRatio = totalsCur.incomeCash / totalsCur.totalIncome
    if (cashRatio > 0.8) {
      anomalies.push({
        type: 'high_cash_ratio',
        date: dateTo,
        description: `Высокая доля наличных: ${(cashRatio * 100).toFixed(0)}%`,
        severity: 'low',
        value: cashRatio,
      })
    }
  }

  const chartData = Array.from(chartDataMap.values()).sort((a, b) => a.sortISO.localeCompare(b.sortISO))

  return {
    totalsCur,
    totalsPrev,
    chartData,
    expenseByCategoryMap,
    incomeByCompanyMap,
    companyStats,
    anomalies,
    prevFrom,
    prevTo,
    dailyIncome,
    dailyExpense,
  }
}
