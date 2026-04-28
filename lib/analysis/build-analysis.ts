import {
  ANOMALY_LOOKBACK_DAYS,
  ANOMALY_MAX_SHOWN,
  EXPENSE_CAP_MULTIPLIER,
  FORECAST_DAYS,
  MIN_EXPENSE_ANOMALY_ABS,
  MIN_INCOME_ANOMALY_ABS,
  PAYMENT_COLORS,
} from '@/lib/analysis/constants'
import {
  addDaysISO,
  clamp,
  dayNames,
  detectTrend,
  linearTrendSlope,
  mad,
  median,
  parseISODateSafe,
  safeMargin,
  toISODateLocal,
  winsorize,
} from '@/lib/analysis/core-utils'
import type { AnalysisResult, Anomaly, DataPoint, DayAverage, DayStats, PaymentMethod, PaymentTrend } from '@/lib/analysis/types'

const calculateSeasonalityStrength = (dayAverages: DayAverage[]): number => {
  const incomes = dayAverages.map((d) => d.income).filter((v) => v > 0)
  if (incomes.length < 2) return 0
  const avg = incomes.reduce((a, b) => a + b, 0) / incomes.length
  const variance = incomes.reduce((sum, v) => sum + (v - avg) ** 2, 0) / incomes.length
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 0
  return clamp(cv * 100, 0, 100)
}

const calculateGrowthRate = (history: DataPoint[]): number => {
  if (history.length < 14) return 0
  const firstWeek = history.slice(0, 7).reduce((s, d) => s + d.income, 0)
  const lastWeek = history.slice(-7).reduce((s, d) => s + d.income, 0)
  if (firstWeek <= 0) return 0
  return ((lastWeek - firstWeek) / firstWeek) * 100
}

const determineRiskLevel = (volatility: number, avgIncome: number, margin: number): 'low' | 'medium' | 'high' => {
  const cv = avgIncome > 0 ? volatility / avgIncome : 0
  if (cv > 0.8 || margin < 10) return 'high'
  if (cv > 0.5 || margin < 20) return 'medium'
  return 'low'
}

export const generateRecommendations = (analysis: AnalysisResult): string[] => {
  const recs: string[] = []

  if (analysis.onlineShare < 15) {
    recs.push('Добавьте онлайн-оплату — в типичных кейсах это снижает трения при оплате')
  }

  if (analysis.cashlessShare < 40) {
    recs.push('Стимулируйте безналичную оплату — меньше операционных рисков')
  }

  if (analysis.seasonalityStrength > 30) {
    recs.push('Высокая сезонность: планируйте запасы и персонал заранее')
  }

  if (analysis.growthRate < -10) {
    recs.push('Тренд дохода падает: сравните с прошлым годом и проверьте воронку продаж')
  } else if (analysis.growthRate > 20) {
    recs.push('Сильный рост дохода: проверьте, хватает ли мощностей (склад, люди)')
  }

  if (analysis.avgMargin < 25) {
    recs.push('Маржа ниже удобного коридора: проанализируйте себестоимость и ценообразование')
  }

  return recs.slice(0, 4)
}

export const buildAnalysis = (history: DataPoint[], includeZeroDays: boolean): AnalysisResult | null => {
  if (!history.length) return null

  let lastActiveIndex = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.income > 0 || history[i]!.expense > 0) {
      lastActiveIndex = i
      break
    }
  }
  if (lastActiveIndex === -1) return null

  const effectiveAll = history.slice(0, lastActiveIndex + 1)

  const effectiveForStats = includeZeroDays ? effectiveAll : effectiveAll.filter((d) => d.income > 0 || d.expense > 0)

  if (!effectiveForStats.length) return null

  const totalPoints = effectiveAll.length
  const totalPointsStats = effectiveForStats.length

  let totalIncome = 0
  let totalExpense = 0
  let totalPlanIncome = 0

  let totalCash = 0
  let totalKaspi = 0
  let totalCard = 0
  let totalOnline = 0

  for (const d of effectiveAll) {
    totalIncome += d.income
    totalExpense += d.expense
    totalPlanIncome += d.planned_income || 0

    totalCash += d.incomeCash
    totalKaspi += d.incomeKaspi
    totalCard += d.incomeCard
    totalOnline += d.incomeOnline
  }

  const planIncomeAchievementPct = totalPlanIncome > 0 ? clamp((totalIncome / totalPlanIncome) * 100, 0, 999) : 0

  const weeksApprox = Math.max(1, Math.floor(totalPointsStats / 7))

  const dayStats: DayStats[] = Array.from({ length: 7 }, () => ({
    income: [],
    expense: [],
    incomeCash: [],
    incomeKaspi: [],
    incomeCard: [],
    incomeOnline: [],
  }))

  for (const d of effectiveForStats) {
    dayStats[d.dayOfWeek]!.income.push(d.income)
    dayStats[d.dayOfWeek]!.expense.push(d.expense)
    dayStats[d.dayOfWeek]!.incomeCash.push(d.incomeCash)
    dayStats[d.dayOfWeek]!.incomeKaspi.push(d.incomeKaspi)
    dayStats[d.dayOfWeek]!.incomeCard.push(d.incomeCard)
    dayStats[d.dayOfWeek]!.incomeOnline.push(d.incomeOnline)
  }

  const globalIncomeArr = effectiveForStats.map((d) => d.income)
  const globalExpenseArr = effectiveForStats.map((d) => d.expense)

  const globalIncomeMed = median(globalIncomeArr)
  const globalExpenseMed = median(globalExpenseArr)
  const globalIncomeMad = mad(globalIncomeArr, globalIncomeMed)
  const globalExpenseMad = mad(globalExpenseArr, globalExpenseMed)

  const globalIncomeSigma = globalIncomeMad * 1.4826 || 1
  const globalExpenseSigma = globalExpenseMad * 1.4826 || 1

  const dayAverages: DayAverage[] = dayStats.map((ds, dow) => {
    const incArr = ds.income
    const expArr = ds.expense
    const coverage = weeksApprox > 0 ? incArr.length / weeksApprox : 0

    const rawMedInc = incArr.length ? median(incArr) : globalIncomeMed
    const rawMedExp = expArr.length ? median(expArr) : globalExpenseMed

    const rawMadInc = incArr.length ? mad(incArr, rawMedInc) : globalIncomeMad
    const rawMadExp = expArr.length ? mad(expArr, rawMedExp) : globalExpenseMad

    const blendWeight = Math.min(1, coverage)
    const medInc = rawMedInc * blendWeight + globalIncomeMed * (1 - blendWeight)
    const medExp = rawMedExp * blendWeight + globalExpenseMed * (1 - blendWeight)

    return {
      dow,
      income: medInc,
      expense: medExp,
      incomeCash: ds.incomeCash.length ? median(ds.incomeCash) : 0,
      incomeKaspi: ds.incomeKaspi.length ? median(ds.incomeKaspi) : 0,
      incomeCard: ds.incomeCard.length ? median(ds.incomeCard) : 0,
      incomeOnline: ds.incomeOnline.length ? median(ds.incomeOnline) : 0,
      sigmaIncome: rawMadInc * 1.4826 || globalIncomeSigma,
      sigmaExpense: rawMadExp * 1.4826 || globalExpenseSigma,
      coverage,
      count: incArr.length,
      isEstimated: coverage < 0.4,
    }
  })

  const paymentTrends: PaymentTrend[] = [
    {
      method: 'cash',
      total: totalCash,
      percentage: totalIncome > 0 ? (totalCash / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map((d) => d.incomeCash)),
      avgDaily: totalCash / totalPoints,
      color: PAYMENT_COLORS.cash,
    },
    {
      method: 'kaspi',
      total: totalKaspi,
      percentage: totalIncome > 0 ? (totalKaspi / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map((d) => d.incomeKaspi)),
      avgDaily: totalKaspi / totalPoints,
      color: PAYMENT_COLORS.kaspi,
    },
    {
      method: 'card',
      total: totalCard,
      percentage: totalIncome > 0 ? (totalCard / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map((d) => d.incomeCard)),
      avgDaily: totalCard / totalPoints,
      color: PAYMENT_COLORS.card,
    },
    {
      method: 'online',
      total: totalOnline,
      percentage: totalIncome > 0 ? (totalOnline / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map((d) => d.incomeOnline)),
      avgDaily: totalOnline / totalPoints,
      color: PAYMENT_COLORS.online,
    },
  ]

  const effectiveForTrend = includeZeroDays ? effectiveAll : effectiveForStats
  const incomeTrendBase = winsorize(
    effectiveForTrend.map((d) => d.income),
    globalIncomeMed,
    globalIncomeSigma,
    4,
  )
  const expenseTrendBase = winsorize(
    effectiveForTrend.map((d) => d.expense),
    globalExpenseMed,
    globalExpenseSigma,
    4,
  )

  const trendStrength = clamp(weeksApprox / 8, 0.15, 1)
  const trendIncome = linearTrendSlope(incomeTrendBase) * trendStrength
  const trendExpense = linearTrendSlope(expenseTrendBase) * trendStrength

  const lastFactDateStr = effectiveAll[effectiveAll.length - 1]!.date
  const lastFactDate = parseISODateSafe(lastFactDateStr)

  const forecast: DataPoint[] = []
  let totalForecastIncome = 0
  let totalForecastExpense = 0

  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const d = new Date(lastFactDate)
    d.setDate(lastFactDate.getDate() + i)
    const iso = toISODateLocal(d)
    const dow = d.getDay()
    const base = dayAverages[dow]!

    const baseIncome = Math.max(0, base.income)
    const baseExpense = Math.max(0, base.expense)

    const trendFactor = 1 - (i - 1) / (FORECAST_DAYS * 2)

    const incomeTrendEffect = trendIncome * i * trendFactor * (base.isEstimated ? 0.5 : 1)
    const expenseTrendEffect = trendExpense * i * trendFactor * (base.isEstimated ? 0.5 : 1)

    const predictedIncome = Math.max(0, baseIncome + incomeTrendEffect)

    const expenseCap = (globalExpenseMed || baseExpense || 0) * EXPENSE_CAP_MULTIPLIER
    const predictedExpense = clamp(baseExpense + expenseTrendEffect, 0, expenseCap)

    const profit = predictedIncome - predictedExpense
    const margin = safeMargin(profit, predictedIncome)

    const sigmaInc = base.sigmaIncome || globalIncomeSigma
    const sigmaExp = base.sigmaExpense || globalExpenseSigma

    const income_p10 = Math.max(0, predictedIncome - 1.28 * sigmaInc)
    const income_p90 = Math.max(0, predictedIncome + 1.28 * sigmaInc)

    const profitSigma = Math.sqrt(sigmaInc * sigmaInc + sigmaExp * sigmaExp)
    const profit_p10 = profit - 1.28 * profitSigma
    const profit_p90 = profit + 1.28 * profitSigma

    const totalBase = base.incomeCash + base.incomeKaspi + base.incomeCard + base.incomeOnline
    const ratio = totalBase > 0 ? predictedIncome / totalBase : 0

    forecast.push({
      date: iso,
      income: predictedIncome,
      expense: predictedExpense,
      profit,
      margin,
      dayOfWeek: dow,
      dayName: dayNames[dow]!,
      type: 'forecast',
      income_p10,
      income_p90,
      profit_p10,
      profit_p90,
      planned_income: 0,
      planned_expense: 0,
      incomeCash: base.incomeCash * ratio,
      incomeKaspi: base.incomeKaspi * ratio,
      incomeCard: base.incomeCard * ratio,
      incomeOnline: base.incomeOnline * ratio,
    })

    totalForecastIncome += predictedIncome
    totalForecastExpense += predictedExpense
  }

  type AnomalyScored = Anomaly & { _z: number }

  const anomaliesRaw: AnomalyScored[] = []
  for (const d of effectiveAll) {
    const avg = dayAverages[d.dayOfWeek]!

    const incDiff = d.income - avg.income
    const expDiff = d.expense - avg.expense

    const sigmaInc = avg.sigmaIncome || globalIncomeSigma
    const sigmaExp = avg.sigmaExpense || globalExpenseSigma

    const zInc = sigmaInc ? incDiff / sigmaInc : 0
    const zExp = sigmaExp ? expDiff / sigmaExp : 0

    const absIncDiff = Math.abs(incDiff)
    const absExpDiff = Math.abs(expDiff)

    const incomeThresholdAbs = Math.max(globalIncomeMed * 0.3, MIN_INCOME_ANOMALY_ABS)
    const expenseThresholdAbs = Math.max(globalExpenseMed * 0.3, MIN_EXPENSE_ANOMALY_ABS)

    const strongIncomeHigh = zInc >= 3 && absIncDiff >= incomeThresholdAbs
    const strongIncomeLow = zInc <= -2.5 && absIncDiff >= incomeThresholdAbs
    const strongExpenseHigh = zExp >= 3 && absExpDiff >= expenseThresholdAbs

    if (!strongIncomeHigh && !strongIncomeLow && !strongExpenseHigh) continue

    let type: Anomaly['type']
    let amount: number
    let avgForDay: number
    let zForSort: number

    if (strongExpenseHigh) {
      type = 'expense_high'
      amount = d.expense
      avgForDay = avg.expense
      zForSort = Math.abs(zExp)
    } else if (strongIncomeHigh) {
      type = 'income_high'
      amount = d.income
      avgForDay = avg.income
      zForSort = Math.abs(zInc)
    } else {
      type = 'income_low'
      amount = d.income
      avgForDay = avg.income
      zForSort = Math.abs(zInc)
    }

    const methods: [PaymentMethod, number][] = [
      ['cash', d.incomeCash - avg.incomeCash],
      ['kaspi', d.incomeKaspi - avg.incomeKaspi],
      ['card', d.incomeCard - avg.incomeCard],
      ['online', d.incomeOnline - avg.incomeOnline],
    ]
    const maxDev = methods.reduce((max, curr) => (Math.abs(curr[1]) > Math.abs(max[1]) ? curr : max), methods[0]!)

    anomaliesRaw.push({
      date: d.date,
      type,
      amount,
      avgForDay,
      paymentMethod: maxDev[0],
      _z: zForSort,
    })
  }

  const anomalyWindowStart = addDaysISO(lastFactDateStr, -ANOMALY_LOOKBACK_DAYS)
  const inWindow = anomaliesRaw.filter((a) => a.date >= anomalyWindowStart)
  inWindow.sort((a, b) => b._z - a._z)
  const anomalies: Anomaly[] = inWindow.slice(0, ANOMALY_MAX_SHOWN).map(
    (row): Anomaly => ({
      date: row.date,
      type: row.type,
      amount: row.amount,
      avgForDay: row.avgForDay,
      paymentMethod: row.paymentMethod,
    }),
  )

  const avgCoverage = dayAverages.reduce((sum, d) => sum + d.coverage, 0) / 7
  const weeksFactor = Math.min(1, weeksApprox / 6)
  const activeShare = clamp(totalPointsStats / Math.max(1, totalPoints), 0, 1)
  const rawScore = weeksFactor * 0.55 + avgCoverage * 0.3 + activeShare * 0.15
  const confidenceScore = clamp(Math.round(rawScore * 100), 10, 100)

  const avgIncome = totalIncome / totalPoints || 0
  const avgExpense = totalExpense / totalPoints || 0
  const profits = effectiveAll.map((d) => d.income - d.expense)
  const avgProfit = profits.reduce((a, b) => a + b, 0) / (profits.length || 1)

  const profitVolatility = Math.sqrt(profits.reduce((s, p) => s + (p - avgProfit) ** 2, 0) / (profits.length || 1))

  const avgMargin = safeMargin(avgProfit, avgIncome)

  const best = { dow: 0, income: -1, profit: -1 }
  const worst = { dow: 0, income: 1e18, profit: 1e18 }
  for (const d of dayAverages) {
    const p = d.income - d.expense
    if (p > best.profit) {
      best.dow = d.dow
      best.income = d.income
      best.profit = p
    }
    if (p < worst.profit) {
      worst.dow = d.dow
      worst.income = d.income
      worst.profit = p
    }
  }

  const anomaliesMap = new Map(anomaliesRaw.map((a) => [a.date, a.type] as const))
  const chartData: DataPoint[] = [
    ...effectiveAll.map((d) => ({
      ...d,
      type: 'fact' as const,
      _anomaly: anomaliesMap.get(d.date),
    })),
    ...forecast,
  ]

  const seasonalityStrength = calculateSeasonalityStrength(dayAverages)
  const growthRate = calculateGrowthRate(effectiveAll)
  const riskLevel = determineRiskLevel(profitVolatility, avgIncome, avgMargin)

  const result: AnalysisResult = {
    dayAverages,
    forecastData: forecast,
    chartData,
    anomalies,
    confidenceScore,
    totalDataPoints: totalPoints,
    dataRangeStart: effectiveAll[0]!.date,
    dataRangeEnd: effectiveAll[effectiveAll.length - 1]!.date,
    lastFactDate: lastFactDateStr,
    trendIncome,
    trendExpense,
    avgIncome,
    avgExpense,
    avgProfit,
    avgMargin,
    profitVolatility,
    totalIncome,
    totalExpense,
    totalForecastIncome,
    totalForecastProfit: totalForecastIncome - totalForecastExpense,
    paymentTrends,
    totalCash,
    totalKaspi,
    totalCard,
    totalOnline,
    onlineShare: totalIncome > 0 ? (totalOnline / totalIncome) * 100 : 0,
    cashlessShare: totalIncome > 0 ? ((totalKaspi + totalCard + totalOnline) / totalIncome) * 100 : 0,
    totalPlanIncome,
    planIncomeAchievementPct,
    bestDow: best,
    worstDow: worst,
    seasonalityStrength,
    growthRate,
    riskLevel,
    recommendedActions: [],
  }

  result.recommendedActions = generateRecommendations(result)

  return result
}
