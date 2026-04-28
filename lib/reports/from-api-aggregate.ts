import type { Anomaly, CompanyStat, FinancialTotals, TimeAggregation } from '@/lib/reports/aggregate-from-rows'

export type ReportBundleAggregate = {
  dateFrom: string
  dateTo: string
  totalsCur: FinancialTotals
  totalsPrev: FinancialTotals
  chartData: TimeAggregation[]
  expenseByCategory: Record<string, number>
  incomeByCompany: Record<
    string,
    {
      companyId: string
      name: string
      value: number
      cash: number
      kaspi: number
      online: number
      card: number
      count: number
    }
  >
  companyStats: Record<string, CompanyStat>
  anomalies: Anomaly[]
  prevFrom: string
  prevTo: string
  dailyIncome: Record<string, number>
  dailyExpense: Record<string, number>
}

export type ProcessedReportShape = {
  totalsCur: FinancialTotals
  totalsPrev: FinancialTotals
  chartDataMap: Map<string, TimeAggregation>
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
}

const emptyFinancialTotals = (): FinancialTotals => ({
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

export function emptyProcessedReport(): ProcessedReportShape {
  const z = emptyFinancialTotals()
  return {
    totalsCur: { ...z },
    totalsPrev: { ...z },
    chartDataMap: new Map(),
    expenseByCategoryMap: new Map(),
    incomeByCompanyMap: new Map(),
    companyStats: new Map(),
    anomalies: [],
    prevFrom: '',
    prevTo: '',
    dailyIncome: new Map(),
    dailyExpense: new Map(),
  }
}

export function processedFromBundleAggregate(a: ReportBundleAggregate): ProcessedReportShape {
  return {
    totalsCur: a.totalsCur,
    totalsPrev: a.totalsPrev,
    chartDataMap: new Map(a.chartData.map((row) => [row.key, row])),
    expenseByCategoryMap: new Map(Object.entries(a.expenseByCategory)),
    incomeByCompanyMap: new Map(Object.entries(a.incomeByCompany)),
    companyStats: new Map(Object.entries(a.companyStats)),
    anomalies: a.anomalies,
    prevFrom: a.prevFrom,
    prevTo: a.prevTo,
    dailyIncome: new Map(Object.entries(a.dailyIncome).map(([k, v]) => [k, Number(v)])),
    dailyExpense: new Map(Object.entries(a.dailyExpense).map(([k, v]) => [k, Number(v)])),
  }
}
