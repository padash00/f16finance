import {
  getMonthKey,
  shiftMonthKey,
  summarizeMonthFacts,
  summarizeMonthForecast,
  dayNames,
  toISODateLocal,
} from '@/lib/analysis/core-utils'
import type { AnalysisResult, DataPoint } from '@/lib/analysis/types'
import type { AnalysisData } from '@/lib/ai-analysis'

function formatAnomalyTypeLabelInline(a: { type: 'income_high' | 'income_low' | 'expense_high' }) {
  return a.type === 'income_low' ? 'Низкий доход' : a.type === 'income_high' ? 'Высокий доход' : 'Высокий расход'
}

export function buildDataForAi(
  analysis: AnalysisResult,
  history: DataPoint[],
  expenseCategories: Record<string, number>,
): AnalysisData {
  const currentMonthKey = getMonthKey(toISODateLocal(new Date()))
  const previousMonthKey = shiftMonthKey(currentMonthKey, -1)
  const nextMonthKey = shiftMonthKey(currentMonthKey, 1)

  const currentMonthFacts = summarizeMonthFacts(history, currentMonthKey)
  const previousMonthFacts = summarizeMonthFacts(history, previousMonthKey)
  const currentMonthForecast = summarizeMonthForecast(analysis.forecastData, currentMonthKey)
  const nextMonthForecast = summarizeMonthForecast(analysis.forecastData, nextMonthKey)

  return {
    dataRangeStart: analysis.dataRangeStart,
    dataRangeEnd: analysis.dataRangeEnd,
    avgIncome: Math.round(analysis.avgIncome),
    avgExpense: Math.round(analysis.avgExpense),
    avgProfit: Math.round(analysis.avgProfit),
    avgMargin: Number(analysis.avgMargin.toFixed(1)),
    totalIncome: Math.round(analysis.totalIncome),
    totalExpense: Math.round(analysis.totalExpense),
    totalCash: Math.round(analysis.totalCash),
    totalKaspi: Math.round(analysis.totalKaspi),
    totalCard: Math.round(analysis.totalCard),
    totalOnline: Math.round(analysis.totalOnline),
    cashlessShare: Number(analysis.cashlessShare.toFixed(1)),
    onlineShare: Number(analysis.onlineShare.toFixed(1)),
    predictedIncome: Math.round(analysis.totalForecastIncome),
    predictedProfit: Math.round(analysis.totalForecastProfit),
    trend: analysis.trendIncome,
    trendExpense: analysis.trendExpense,
    confidenceScore: Number(analysis.confidenceScore.toFixed(1)),
    riskLevel: analysis.riskLevel,
    seasonalityStrength: Number(analysis.seasonalityStrength.toFixed(1)),
    growthRate: Number(analysis.growthRate.toFixed(1)),
    profitVolatility: Math.round(analysis.profitVolatility),
    totalPlanIncome: Math.round(analysis.totalPlanIncome),
    planIncomeAchievementPct: Number(analysis.planIncomeAchievementPct.toFixed(1)),
    bestDayName: analysis.bestDow ? dayNames[analysis.bestDow.dow]! : '—',
    worstDayName: analysis.worstDow ? dayNames[analysis.worstDow.dow]! : '—',
    expensesByCategory: expenseCategories,
    anomalies: analysis.anomalies.map((a) => ({
      date: a.date,
      type: formatAnomalyTypeLabelInline(a),
      amount: a.amount,
    })),
    currentMonth: {
      income: Math.round(currentMonthFacts.income),
      expense: Math.round(currentMonthFacts.expense),
      profit: Math.round(currentMonthFacts.profit),
      projectedIncome: Math.round(currentMonthFacts.income + currentMonthForecast.income),
      projectedProfit: Math.round(currentMonthFacts.profit + currentMonthForecast.profit),
    },
    previousMonth: {
      income: Math.round(previousMonthFacts.income),
      expense: Math.round(previousMonthFacts.expense),
      profit: Math.round(previousMonthFacts.profit),
    },
    nextMonthForecast: {
      income: Math.round(nextMonthForecast.income),
      profit: Math.round(nextMonthForecast.profit),
    },
  }
}

export { formatAnomalyTypeLabel } from '@/lib/analysis/core-utils'
