export type PaymentMethod = 'cash' | 'kaspi' | 'card' | 'online'

export type CompanyOption = {
  id: string
  name: string
  code?: string | null
}

export type DataPoint = {
  date: string
  income: number
  expense: number
  profit: number
  margin: number
  dayOfWeek: number
  dayName: string
  type?: 'fact' | 'forecast'

  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number

  planned_income?: number
  planned_expense?: number

  income_p10?: number
  income_p90?: number
  profit_p10?: number
  profit_p90?: number

  _anomaly?: 'income_high' | 'income_low' | 'expense_high'
}

export type Anomaly = {
  date: string
  type: 'income_high' | 'income_low' | 'expense_high'
  amount: number
  avgForDay: number
  paymentMethod?: PaymentMethod
}

export type DayStats = {
  income: number[]
  expense: number[]
  incomeCash: number[]
  incomeKaspi: number[]
  incomeCard: number[]
  incomeOnline: number[]
}

export type DayAverage = {
  dow: number
  income: number
  expense: number
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  sigmaIncome: number
  sigmaExpense: number
  coverage: number
  count: number
  isEstimated: boolean
}

export type PaymentTrend = {
  method: PaymentMethod
  total: number
  percentage: number
  trend: 'up' | 'down' | 'stable'
  avgDaily: number
  color: string
}

export type AnalysisResult = {
  dayAverages: DayAverage[]
  forecastData: DataPoint[]
  chartData: DataPoint[]
  anomalies: Anomaly[]
  confidenceScore: number
  totalDataPoints: number
  dataRangeStart: string
  dataRangeEnd: string
  lastFactDate: string
  trendIncome: number
  trendExpense: number
  avgIncome: number
  avgExpense: number
  avgProfit: number
  avgMargin: number
  profitVolatility: number
  totalIncome: number
  totalExpense: number
  totalForecastIncome: number
  totalForecastProfit: number
  paymentTrends: PaymentTrend[]
  totalCash: number
  totalKaspi: number
  totalCard: number
  totalOnline: number
  onlineShare: number
  cashlessShare: number
  totalPlanIncome: number
  planIncomeAchievementPct: number
  bestDow: { dow: number; income: number; profit: number }
  worstDow: { dow: number; income: number; profit: number }
  seasonalityStrength: number
  growthRate: number
  riskLevel: 'low' | 'medium' | 'high'
  recommendedActions: string[]
}

export type RangePreset = '30' | '90' | '180' | '365' | 'all'
export type Granularity = 'daily' | 'weekly'
