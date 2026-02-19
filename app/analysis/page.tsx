"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabaseClient"
import { getGeminiAdvice } from "../actions"
import {
  BrainCircuit,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  Sparkles,
  Info,
  HelpCircle,
  Search,
  History,
  Bot,
  Loader2,
  RefreshCw,
  Download,
  SlidersHorizontal,
  PieChart,
  Target,
  Globe,
  Wallet,
  CreditCard,
  Banknote,
  AlertTriangle,
  CheckCircle2,
  Zap,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
  MinusIcon,
} from "lucide-react"
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Bar,
  BarChart,
  Area,
  PieChart as RePieChart,
  Pie,
  Cell,
} from "recharts"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"

// ================== КОНФИГ ==================
const FORECAST_DAYS = 30

const MIN_INCOME_ANOMALY_ABS = 10_000
const MIN_EXPENSE_ANOMALY_ABS = 10_000
const EXPENSE_CAP_MULTIPLIER = 3

const DEFAULT_START = "2025-11-01"
const MAX_DAYS_HARD_LIMIT = 730

const PLANS_TABLE = "plans_daily"

// ================== ТИПЫ ==================
type PaymentMethod = 'cash' | 'kaspi' | 'card' | 'online'

type DataPoint = {
  date: string
  income: number
  expense: number
  profit: number
  margin: number
  dayOfWeek: number
  dayName: string
  type?: "fact" | "forecast"

  // Детализация по способам оплаты
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

  _anomaly?: "income_high" | "income_low" | "expense_high"
}

type Anomaly = {
  date: string
  type: "income_high" | "income_low" | "expense_high"
  amount: number
  avgForDay: number
  paymentMethod?: PaymentMethod
}

type DayStats = {
  income: number[]
  expense: number[]
  incomeCash: number[]
  incomeKaspi: number[]
  incomeCard: number[]
  incomeOnline: number[]
}

type DayAverage = {
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

type PaymentTrend = {
  method: PaymentMethod
  total: number
  percentage: number
  trend: 'up' | 'down' | 'stable'
  avgDaily: number
  color: string
}

type AnalysisResult = {
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

  // Детализация по способам оплаты
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
  
  // AI метрики
  seasonalityStrength: number
  growthRate: number
  riskLevel: 'low' | 'medium' | 'high'
  recommendedActions: string[]
}

type RangePreset = "30" | "90" | "180" | "365" | "all"
type Granularity = "daily" | "weekly"

const dayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

const PAYMENT_COLORS = {
  cash: '#f59e0b',
  kaspi: '#2563eb',
  card: '#7c3aed',
  online: '#ec4899',
}

// ================== УТИЛИТЫ ==================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (dateStr: string) => new Date(`${dateStr}T12:00:00`)
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const formatMoney = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸"

const formatMoneyDetailed = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })

const formatPct = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(1)}%`

const formatDateRu = (dateStr: string) =>
  parseISODateSafe(dateStr).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

const generateDateRange = (start: Date, end: Date): string[] => {
  const res: string[] = []
  const s = new Date(start)
  const e = new Date(end)
  s.setHours(12, 0, 0, 0)
  e.setHours(12, 0, 0, 0)

  const days = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  for (let i = 0; i < days; i++) {
    const d = new Date(s)
    d.setDate(s.getDate() + i)
    res.push(toISODateLocal(d))
  }
  return res
}

const median = (arr: number[]): number => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const mad = (arr: number[], med: number): number => {
  if (!arr.length) return 0
  return median(arr.map((v) => Math.abs(v - med)))
}

const winsorize = (arr: number[], med: number, sigma: number, k = 4) => {
  if (!arr.length) return arr
  const lo = med - k * sigma
  const hi = med + k * sigma
  return arr.map((v) => clamp(v, lo, hi))
}

const linearTrendSlope = (y: number[]): number => {
  const n = y.length
  if (n <= 1) return 0
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]
    sxy += i * y[i]
    sxx += i * i
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return 0
  return (n * sxy - sx * sy) / denom
}

const safeMargin = (profit: number, income: number) => {
  if (!income || income <= 0) return 0
  return (profit / income) * 100
}

const detectTrend = (values: number[]): 'up' | 'down' | 'stable' => {
  if (values.length < 3) return 'stable'
  const first = values[0]
  const last = values[values.length - 1]
  const change = ((last - first) / (first || 1)) * 100
  if (change > 5) return 'up'
  if (change < -5) return 'down'
  return 'stable'
}

const startOfWeekISO = (dateStr: string) => {
  const d = parseISODateSafe(dateStr)
  const day = d.getDay()
  const diffToMon = (day + 6) % 7
  d.setDate(d.getDate() - diffToMon)
  return toISODateLocal(d)
}

const downloadCSV = (filename: string, rows: Record<string, any>[]) => {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = r[h]
          const s = val === null || val === undefined ? "" : String(val)
          if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`
          return s
        })
        .join(","),
    ),
  ].join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ================== AI АНАЛИТИКА ==================
const calculateSeasonalityStrength = (dayAverages: DayAverage[]): number => {
  const incomes = dayAverages.map(d => d.income).filter(v => v > 0)
  if (incomes.length < 2) return 0
  const avg = incomes.reduce((a, b) => a + b, 0) / incomes.length
  const variance = incomes.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / incomes.length
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

const generateRecommendations = (analysis: AnalysisResult): string[] => {
  const recs: string[] = []
  
  if (analysis.onlineShare < 15) {
    recs.push("Добавьте онлайн-оплату — это увеличит средний чек на 10-15%")
  }
  
  if (analysis.cashlessShare < 40) {
    recs.push("Стимулируйте безналичную оплату — снижает риски и ускоряет оборот")
  }
  
  if (analysis.seasonalityStrength > 30) {
    recs.push("Высокая сезонность: планируйте запасы и персонал заранее")
  }
  
  if (analysis.growthRate < -10) {
    recs.push("Тренд падает: запустите акции или проверьте конкурентов")
  } else if (analysis.growthRate > 20) {
    recs.push("Отличный рост! Рассмотрите расширение ассортимента")
  }
  
  if (analysis.avgMargin < 25) {
    recs.push("Маржа ниже оптимума: проанализируйте себестоимость и ценообразование")
  }
  
  return recs.slice(0, 4)
}

// ================== АНАЛИЗАТОР ==================
const buildAnalysis = (history: DataPoint[], includeZeroDays: boolean): AnalysisResult | null => {
  if (!history.length) return null

  let lastActiveIndex = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].income > 0 || history[i].expense > 0) {
      lastActiveIndex = i
      break
    }
  }
  if (lastActiveIndex === -1) return null

  const effectiveAll = history.slice(0, lastActiveIndex + 1)

  const effectiveForStats = includeZeroDays
    ? effectiveAll
    : effectiveAll.filter((d) => d.income > 0 || d.expense > 0)

  if (!effectiveForStats.length) return null

  const totalPoints = effectiveAll.length
  const totalPointsStats = effectiveForStats.length

  let totalIncome = 0
  let totalExpense = 0
  let totalPlanIncome = 0
  
  // По способам оплаты
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

  const planIncomeAchievementPct =
    totalPlanIncome > 0 ? clamp((totalIncome / totalPlanIncome) * 100, 0, 999) : 0

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
    dayStats[d.dayOfWeek].income.push(d.income)
    dayStats[d.dayOfWeek].expense.push(d.expense)
    dayStats[d.dayOfWeek].incomeCash.push(d.incomeCash)
    dayStats[d.dayOfWeek].incomeKaspi.push(d.incomeKaspi)
    dayStats[d.dayOfWeek].incomeCard.push(d.incomeCard)
    dayStats[d.dayOfWeek].incomeOnline.push(d.incomeOnline)
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

  // Тренды по способам оплаты
  const paymentTrends: PaymentTrend[] = [
    {
      method: 'cash',
      total: totalCash,
      percentage: totalIncome > 0 ? (totalCash / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map(d => d.incomeCash)),
      avgDaily: totalCash / totalPoints,
      color: PAYMENT_COLORS.cash,
    },
    {
      method: 'kaspi',
      total: totalKaspi,
      percentage: totalIncome > 0 ? (totalKaspi / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map(d => d.incomeKaspi)),
      avgDaily: totalKaspi / totalPoints,
      color: PAYMENT_COLORS.kaspi,
    },
    {
      method: 'card',
      total: totalCard,
      percentage: totalIncome > 0 ? (totalCard / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map(d => d.incomeCard)),
      avgDaily: totalCard / totalPoints,
      color: PAYMENT_COLORS.card,
    },
    {
      method: 'online',
      total: totalOnline,
      percentage: totalIncome > 0 ? (totalOnline / totalIncome) * 100 : 0,
      trend: detectTrend(effectiveForStats.map(d => d.incomeOnline)),
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

  const lastFactDateStr = effectiveAll[effectiveAll.length - 1].date
  const lastFactDate = parseISODateSafe(lastFactDateStr)

  const forecast: DataPoint[] = []
  let totalForecastIncome = 0
  let totalForecastExpense = 0

  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const d = new Date(lastFactDate)
    d.setDate(lastFactDate.getDate() + i)
    const iso = toISODateLocal(d)
    const dow = d.getDay()
    const base = dayAverages[dow]

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

    // Распределение прогноза по способам оплаты на основе исторических долей
    const totalBase = base.incomeCash + base.incomeKaspi + base.incomeCard + base.incomeOnline
    const ratio = totalBase > 0 ? predictedIncome / totalBase : 0

    forecast.push({
      date: iso,
      income: predictedIncome,
      expense: predictedExpense,
      profit,
      margin,
      dayOfWeek: dow,
      dayName: dayNames[dow],
      type: "forecast",
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

  const anomaliesRaw: Anomaly[] = []
  for (const d of effectiveAll) {
    const avg = dayAverages[d.dayOfWeek]

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

    let type: Anomaly["type"]
    let amount: number
    let avgForDay: number

    if (strongExpenseHigh) {
      type = "expense_high"
      amount = d.expense
      avgForDay = avg.expense
    } else if (strongIncomeHigh) {
      type = "income_high"
      amount = d.income
      avgForDay = avg.income
    } else {
      type = "income_low"
      amount = d.income
      avgForDay = avg.income
    }

    // Определяем способ оплаты с максимальным отклонением
    const methods: [PaymentMethod, number][] = [
      ['cash', d.incomeCash - avg.incomeCash],
      ['kaspi', d.incomeKaspi - avg.incomeKaspi],
      ['card', d.incomeCard - avg.incomeCard],
      ['online', d.incomeOnline - avg.incomeOnline],
    ]
    const maxDev = methods.reduce((max, curr) => Math.abs(curr[1]) > Math.abs(max[1]) ? curr : max, methods[0])
    
    anomaliesRaw.push({ 
      date: d.date, 
      type, 
      amount, 
      avgForDay,
      paymentMethod: maxDev[0]
    })
  }

  const anomalies = anomaliesRaw.slice(-8).reverse()

  const avgCoverage = dayAverages.reduce((sum, d) => sum + d.coverage, 0) / 7
  const weeksFactor = Math.min(1, weeksApprox / 6)
  const activeShare = clamp(totalPointsStats / Math.max(1, totalPoints), 0, 1)
  const rawScore = weeksFactor * 0.55 + avgCoverage * 0.30 + activeShare * 0.15
  const confidenceScore = clamp(Math.round(rawScore * 100), 10, 100)

  const avgIncome = totalIncome / totalPoints || 0
  const avgExpense = totalExpense / totalPoints || 0
  const profits = effectiveAll.map((d) => d.income - d.expense)
  const avgProfit = profits.reduce((a, b) => a + b, 0) / (profits.length || 1)

  const profitVolatility = Math.sqrt(
    profits.reduce((s, p) => s + (p - avgProfit) ** 2, 0) / (profits.length || 1),
  )

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
      type: "fact" as const,
      _anomaly: anomaliesMap.get(d.date),
    })),
    ...forecast,
  ]

  // AI метрики
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
    dataRangeStart: effectiveAll[0].date,
    dataRangeEnd: effectiveAll[effectiveAll.length - 1].date,
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

// ================== АГРЕГАЦИЯ НЕДЕЛЯ ==================
const aggregateWeekly = (data: DataPoint[]): DataPoint[] => {
  const map = new Map<string, DataPoint>()
  for (const d of data) {
    const wk = startOfWeekISO(d.date)
    const cur = map.get(wk)
    if (!cur) {
      map.set(wk, {
        date: wk,
        income: d.income,
        expense: d.expense,
        profit: d.profit,
        margin: d.margin,
        dayOfWeek: 1,
        dayName: "Нед",
        type: d.type,
        planned_income: d.planned_income || 0,
        planned_expense: d.planned_expense || 0,
        incomeCash: d.incomeCash,
        incomeKaspi: d.incomeKaspi,
        incomeCard: d.incomeCard,
        incomeOnline: d.incomeOnline,
      })
    } else {
      cur.income += d.income
      cur.expense += d.expense
      cur.profit += d.profit
      cur.margin = safeMargin(cur.profit, cur.income)
      cur.planned_income = (cur.planned_income || 0) + (d.planned_income || 0)
      cur.planned_expense = (cur.planned_expense || 0) + (d.planned_expense || 0)
      cur.incomeCash += d.incomeCash
      cur.incomeKaspi += d.incomeKaspi
      cur.incomeCard += d.incomeCard
      cur.incomeOnline += d.incomeOnline
      if (d.type === "forecast") cur.type = "forecast"
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ================== DOT ДЛЯ АНОМАЛИЙ ==================
function AnomalyDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload?._anomaly || payload.type !== "fact") return null

  const color =
    payload._anomaly === "income_high" ? "#22c55e" : payload._anomaly === "income_low" ? "#ef4444" : "#f59e0b"

  return <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="#111" strokeWidth={2} />
}

// ================== КОМПОНЕНТ ==================
export default function AIAnalysisPage() {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [expenseCategories, setExpenseCategories] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)

  const [plansEnabled, setPlansEnabled] = useState(true)
  const [plansWarning, setPlansWarning] = useState<string | null>(null)

  const [aiAdvice, setAiAdvice] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const [rangePreset, setRangePreset] = useState<RangePreset>("90")
  const [customStart, setCustomStart] = useState<string>("")
  const [customEnd, setCustomEnd] = useState<string>("")

  const [includeZeroDays, setIncludeZeroDays] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const [granularity, setGranularity] = useState<Granularity>("daily")

  const aliveRef = useRef(true)

  const computeRange = () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)

    let start: Date
    let end: Date = today

    if (rangePreset === "all") start = parseISODateSafe(DEFAULT_START)
    else {
      const days = Number(rangePreset)
      start = new Date(today)
      start.setDate(today.getDate() - days + 1)
    }

    if (customStart) start = parseISODateSafe(customStart)
    if (customEnd) end = parseISODateSafe(customEnd)

    const maxStart = new Date(end)
    maxStart.setDate(end.getDate() - MAX_DAYS_HARD_LIMIT + 1)
    if (start < maxStart) start = maxStart

    return { start, end }
  }

  const loadData = async () => {
    setLoading(true)
    setErrorText(null)
    setPlansWarning(null)

    try {
      const { start, end } = computeRange()
      const fromDateStr = toISODateLocal(start)
      const toDateStr = toISODateLocal(end)

      const [incRes, expRes] = await Promise.all([
        supabase
          .from("incomes")
          .select("date, cash_amount, kaspi_amount, card_amount, online_amount")
          .gte("date", fromDateStr)
          .lte("date", toDateStr)
          .order("date")
          .throwOnError(),
        supabase
          .from("expenses")
          .select("date, cash_amount, kaspi_amount, category")
          .gte("date", fromDateStr)
          .lte("date", toDateStr)
          .order("date")
          .throwOnError(),
      ])

      let planRows: any[] = []
      if (plansEnabled) {
        const planRes = await supabase
          .from(PLANS_TABLE)
          .select("date, planned_income, planned_expense")
          .gte("date", fromDateStr)
          .lte("date", toDateStr)
          .order("date")

        if (planRes.error) {
          const msg = String((planRes.error as any).message || planRes.error)
          const isMissingTable = msg.includes("Could not find the table") || msg.includes("schema cache")
          if (isMissingTable) {
            planRows = []
            setPlansWarning(`Планы отключены: таблица "${PLANS_TABLE}" не найдена.`)
          } else {
            throw planRes.error
          }
        } else {
          planRows = planRes.data ?? []
        }
      }

      const dbMap = new Map<string, { 
        income: number
        expense: number
        incomeCash: number
        incomeKaspi: number
        incomeCard: number
        incomeOnline: number
      }>()
      
      const planMap = new Map<string, { planned_income: number; planned_expense: number }>()
      const catsMap: Record<string, number> = {}

      for (const r of incRes.data ?? []) {
        const date = (r as any).date as string
        const cash = (r as any).cash_amount || 0
        const kaspi = (r as any).kaspi_amount || 0
        const card = (r as any).card_amount || 0
        const online = (r as any).online_amount || 0
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

      for (const r of expRes.data ?? []) {
        const date = (r as any).date as string
        const val = ((r as any).cash_amount || 0) + ((r as any).kaspi_amount || 0)
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
          const catName = ((r as any).category as string) || "Прочее"
          catsMap[catName] = (catsMap[catName] || 0) + val
        }
      }

      for (const r of planRows) {
        const date = (r as any).date as string
        planMap.set(date, {
          planned_income: Number((r as any).planned_income || 0),
          planned_expense: Number((r as any).planned_expense || 0),
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
          dayName: dayNames[dow],
          planned_income: plan.planned_income || 0,
          planned_expense: plan.planned_expense || 0,
          incomeCash: fact.incomeCash,
          incomeKaspi: fact.incomeKaspi,
          incomeCard: fact.incomeCard,
          incomeOnline: fact.incomeOnline,
        }
      })

      if (!aliveRef.current) return
      setHistory(fullHistory)
      setExpenseCategories(catsMap)
    } catch (e: any) {
      console.error("AIAnalysis loadData error:", e)
      if (!aliveRef.current) return
      setHistory([])
      setExpenseCategories({})
      setErrorText(e?.message || "Ошибка загрузки данных")
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    aliveRef.current = true
    loadData()
    return () => {
      aliveRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset, customStart, customEnd, plansEnabled])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => loadData(), 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, rangePreset, customStart, customEnd, plansEnabled])

  const analysis = useMemo(() => buildAnalysis(history, includeZeroDays), [history, includeZeroDays])

  useEffect(() => {
    if (!analysis) return
    if (analysis.totalDataPoints > 220) setGranularity("weekly")
    else setGranularity("daily")
  }, [analysis?.totalDataPoints]) // eslint-disable-line react-hooks/exhaustive-deps

  const chartViewData = useMemo(() => {
    if (!analysis) return []
    const base = analysis.chartData.map((d) => ({
      ...d,
      profit: d.profit ?? d.income - d.expense,
      margin: d.margin ?? safeMargin((d.profit ?? d.income - d.expense), d.income),
      planned_income: d.planned_income || 0,
      planned_expense: d.planned_expense || 0,
    }))
    return granularity === "weekly" ? aggregateWeekly(base) : base
  }, [analysis, granularity])

  const topExpenseCats = useMemo(() => {
    const entries = Object.entries(expenseCategories)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0)

    const top = entries.slice(0, 7)
    const rest = entries.slice(7).reduce((s, [, v]) => s + v, 0)
    if (rest > 0) top.push(["Другое", rest])

    return top.map(([name, value]) => ({ name, value }))
  }, [expenseCategories])

  const smartInsights = useMemo(() => {
    if (!analysis) return null

    const warnings: string[] = []
    if (analysis.avgMargin < 18) warnings.push("Маржа низкая — проверьте расходы и ценообразование")
    if (analysis.profitVolatility > analysis.avgIncome * 0.6) warnings.push("Высокая волатильность прибыли — диверсифицируйте источники дохода")
    if (analysis.confidenceScore < 45) warnings.push("Недостаточно данных для точного прогноза")
    if (analysis.onlineShare < 10) warnings.push("Низкая доля онлайн-оплат — потенциал роста")
    if (analysis.riskLevel === 'high') warnings.push("Высокий финансовый риск — срочно оптимизируйте расходы")

    const tips: string[] = analysis.recommendedActions

    return { warnings, tips }
  }, [analysis])

  const dataForAi = useMemo(() => {
    if (!analysis) return null
    return {
      range: { start: analysis.dataRangeStart, end: analysis.dataRangeEnd },
      includeZeroDays,
      granularity,
      avgIncome: Math.round(analysis.avgIncome),
      avgExpense: Math.round(analysis.avgExpense),
      avgProfit: Math.round(analysis.avgProfit),
      avgMargin: analysis.avgMargin,
      profitVolatility: Math.round(analysis.profitVolatility),
      predictedProfit: Math.round(analysis.totalForecastProfit),
      predictedIncome: Math.round(analysis.totalForecastIncome),
      trendIncomePerDay: analysis.trendIncome,
      trendExpensePerDay: analysis.trendExpense,
      bestDayOfWeek: dayNames[analysis.bestDow.dow],
      worstDayOfWeek: dayNames[analysis.worstDow.dow],
      paymentMethods: {
        cash: { total: analysis.totalCash, percentage: analysis.paymentTrends.find(p => p.method === 'cash')?.percentage || 0 },
        kaspi: { total: analysis.totalKaspi, percentage: analysis.paymentTrends.find(p => p.method === 'kaspi')?.percentage || 0 },
        card: { total: analysis.totalCard, percentage: analysis.paymentTrends.find(p => p.method === 'card')?.percentage || 0 },
        online: { total: analysis.totalOnline, percentage: analysis.paymentTrends.find(p => p.method === 'online')?.percentage || 0 },
      },
      onlineShare: analysis.onlineShare,
      cashlessShare: analysis.cashlessShare,
      seasonalityStrength: analysis.seasonalityStrength,
      growthRate: analysis.growthRate,
      riskLevel: analysis.riskLevel,
      expensesByCategory: expenseCategories,
      plan: {
        totalPlanIncome: Math.round(analysis.totalPlanIncome),
        incomeAchievementPct: Number(analysis.planIncomeAchievementPct.toFixed(1)),
      },
      anomalies: analysis.anomalies.map((a) => ({
        date: a.date,
        type: a.type === "income_low" ? "Низкий доход" : a.type === "income_high" ? "Высокий доход" : "Высокий расход",
        amount: a.amount,
        normalForDay: a.avgForDay,
        paymentMethod: a.paymentMethod,
      })),
      confidenceScore: analysis.confidenceScore,
    }
  }, [analysis, expenseCategories, includeZeroDays, granularity])

  const handleAskAi = async () => {
    if (!dataForAi) return
    setAiLoading(true)
    try {
      const text = await getGeminiAdvice(dataForAi)
      setAiAdvice(text)
    } catch (e) {
      console.error("getGeminiAdvice error:", e)
      setAiAdvice("Не удалось получить совет. Проверьте подключение к AI.")
    } finally {
      setAiLoading(false)
    }
  }

  const handleExport = () => {
    if (!analysis) return
    const rows = analysis.chartData.map((d) => ({
      date: d.date,
      type: d.type ?? "fact",
      income: Math.round(d.income),
      expense: Math.round(d.expense),
      profit: Math.round(d.profit ?? d.income - d.expense),
      income_cash: Math.round(d.incomeCash),
      income_kaspi: Math.round(d.incomeKaspi),
      income_card: Math.round(d.incomeCard),
      income_online: Math.round(d.incomeOnline),
      planned_income: Math.round(d.planned_income || 0),
      planned_expense: Math.round(d.planned_expense || 0),
      margin_pct: Number((d.margin ?? safeMargin((d.profit ?? d.income - d.expense), d.income)).toFixed(2)),
      income_p10: d.income_p10 ? Math.round(d.income_p10) : "",
      income_p90: d.income_p90 ? Math.round(d.income_p90) : "",
      profit_p10: d.profit_p10 ? Math.round(d.profit_p10) : "",
      profit_p90: d.profit_p90 ? Math.round(d.profit_p90) : "",
    }))
    downloadCSV(`ai-analysis-${analysis.dataRangeStart}_to_${analysis.dataRangeEnd}.csv`, rows)
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/20 rounded-xl">
                  <BrainCircuit className="w-8 h-8 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    AI Аналитика Pro
                  </h1>
                  <p className="text-gray-400 text-sm mt-1">
                    Умная аналитика • Прогнозирование • Аномалии • Рекомендации
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => loadData()}
                  disabled={loading}
                  variant="outline"
                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  Обновить
                </Button>

                <Button
                  onClick={handleExport}
                  disabled={!analysis}
                  variant="outline"
                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Экспорт CSV
                </Button>

                <Button
                  onClick={handleAskAi}
                  disabled={aiLoading || !analysis}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25"
                >
                  {aiLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {aiAdvice ? "Обновить совет" : "Совет AI"}
                </Button>
              </div>
            </div>
          </div>

          {/* Панель фильтров */}
          <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
            <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <SlidersHorizontal className="w-4 h-4" />
                  Период
                </div>

                <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as RangePreset)}>
                  <SelectTrigger className="w-[160px] bg-gray-900 border-gray-700 text-gray-300">
                    <SelectValue placeholder="Период" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="30">Последние 30 дней</SelectItem>
                    <SelectItem value="90">Последние 90 дней</SelectItem>
                    <SelectItem value="180">Последние 180 дней</SelectItem>
                    <SelectItem value="365">Последние 365 дней</SelectItem>
                    <SelectItem value="all">Весь период</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">С</div>
                  <Input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-[160px] bg-gray-900 border-gray-700 text-gray-300"
                  />
                  <div className="text-xs text-gray-500">по</div>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-[160px] bg-gray-900 border-gray-700 text-gray-300"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">График</div>
                  <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                    <SelectTrigger className="w-[140px] bg-gray-900 border-gray-700 text-gray-300">
                      <SelectValue placeholder="График" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      <SelectItem value="daily">По дням</SelectItem>
                      <SelectItem value="weekly">По неделям</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 items-center">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Учитывать нули</div>
                  <Switch checked={includeZeroDays} onCheckedChange={setIncludeZeroDays} />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Автообновление</div>
                  <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Планы</div>
                  <Switch checked={plansEnabled} onCheckedChange={setPlansEnabled} />
                </div>
              </div>
            </div>

            {plansWarning && (
              <div className="mt-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-200 text-xs">
                <AlertTriangle className="w-4 h-4 inline mr-2" />
                {plansWarning}
              </div>
            )}

            {analysis && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <div className="px-2 py-1 rounded-lg border border-gray-700 bg-gray-900/50 text-gray-400">
                  <History className="w-3 h-3 inline mr-1" />
                  {formatDateRu(analysis.dataRangeStart)} — {formatDateRu(analysis.dataRangeEnd)}
                </div>

                <div className="px-2 py-1 rounded-lg border border-gray-700 bg-gray-900/50 text-gray-400">
                  Достоверность: <span className="text-purple-400 font-bold">{analysis.confidenceScore}%</span>
                </div>

                <div
                  className={`px-2 py-1 rounded-lg border w-fit ${
                    analysis.trendIncome > 0
                      ? "text-green-400 bg-green-500/10 border-green-500/20"
                      : "text-red-400 bg-red-500/10 border-red-500/20"
                  }`}
                >
                  {analysis.trendIncome >= 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                  Тренд: {analysis.trendIncome >= 0 ? "+" : ""}
                  {analysis.trendIncome.toFixed(0)} ₸/день
                </div>

                <div
                  className={`px-2 py-1 rounded-lg border w-fit ${
                    analysis.riskLevel === 'low' 
                      ? "text-green-400 bg-green-500/10 border-green-500/20"
                      : analysis.riskLevel === 'medium'
                        ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
                        : "text-red-400 bg-red-500/10 border-red-500/20"
                  }`}
                >
                  Риск: {analysis.riskLevel === 'low' ? 'Низкий' : analysis.riskLevel === 'medium' ? 'Средний' : 'Высокий'}
                </div>

                {analysis.totalPlanIncome > 0 && (
                  <div className="px-2 py-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                    <Target className="w-3 h-3 inline mr-1" />
                    План: {analysis.planIncomeAchievementPct.toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* AI advice */}
          {aiAdvice && (
            <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 backdrop-blur-sm shadow-lg shadow-purple-500/10">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-purple-500/20 rounded-xl shrink-0">
                  <Sparkles className="w-6 h-6 text-purple-400" />
                </div>
                <div className="space-y-2 w-full">
                  <h3 className="font-bold text-white text-lg">Рекомендации AI-директора</h3>
                  <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{aiAdvice}</div>
                </div>
              </div>
            </Card>
          )}

          {loading && (
            <div className="p-12 text-center">
              <div className="relative inline-block">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500" />
                <BrainCircuit className="w-8 h-8 text-purple-400 absolute top-4 left-4" />
              </div>
              <p className="text-gray-400 mt-4">Анализируем данные и строим прогнозы...</p>
            </div>
          )}

          {errorText && !loading && (
            <Card className="p-4 border-0 bg-red-500/10 text-red-300 text-sm">
              <AlertTriangle className="w-5 h-5 inline mr-2" />
              Ошибка: {errorText}
            </Card>
          )}

          {!loading && analysis && (
            <div className="space-y-6">
              {/* Верхний ряд: график + способы оплаты */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* График факт + прогноз */}
                <div className="lg:col-span-2">
                  <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm h-full">
                    <div className="mb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                          <CalendarDays className="w-5 h-5 text-purple-400" />
                          Факт + прогноз на {FORECAST_DAYS} дней
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                          Прогноз прибыли:{" "}
                          <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span> •
                          Прогноз дохода:{" "}
                          <span className="text-purple-400 font-bold">{formatMoney(analysis.totalForecastIncome)}</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          Аномалии: 🟢 рекорд • 🔴 просадка • 🟠 высокий расход • 🟦 план
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase text-gray-500 tracking-wider">Достоверность</span>
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-2 w-24 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500" style={{ width: `${analysis.confidenceScore}%` }} />
                          </div>
                          <span className="text-sm font-bold text-purple-400">{analysis.confidenceScore}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartViewData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                            </linearGradient>
                          </defs>

                          <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                          <XAxis
                            dataKey="date"
                            stroke="#6b7280"
                            fontSize={10}
                            tickFormatter={(val) => {
                              const d = parseISODateSafe(val as string)
                              return `${dayNames[d.getDay()]} ${d.getDate()}`
                            }}
                            interval="preserveStartEnd"
                            minTickGap={22}
                          />
                          <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => `${Math.round((v as number) / 1000)}k`} />

                          <Tooltip
                            contentStyle={{ 
                              backgroundColor: "#1f2937", 
                              border: "1px solid #374151", 
                              borderRadius: "8px",
                              color: "#fff"
                            }}
                            formatter={(val: any, name: any, props: any) => {
                              const label =
                                name === "income"
                                  ? "Доход"
                                  : name === "planned_income"
                                    ? "План дохода"
                                    : name === "expense"
                                      ? "Расход"
                                      : name === "profit"
                                        ? "Прибыль"
                                        : name
                              return [formatMoney(val as number), `${label} (${props?.payload?.type === "forecast" ? "прогноз" : "факт"})`]
                            }}
                            labelFormatter={(label: any) => {
                              const d = parseISODateSafe(label)
                              return formatDateRu(label) + ` (${dayNames[d.getDay()]})`
                            }}
                          />

                          <ReferenceLine x={analysis.lastFactDate} stroke="#6b7280" strokeDasharray="3 3" />

                          <Area
                            type="monotone"
                            dataKey="income"
                            name="income"
                            stroke="#8b5cf6"
                            strokeWidth={3}
                            fill="url(#incomeGradient)"
                            dot={<AnomalyDot />}
                          />

                          <Line
                            type="monotone"
                            dataKey="planned_income"
                            name="planned_income"
                            stroke="#38bdf8"
                            strokeWidth={2}
                            strokeDasharray="6 6"
                            dot={false}
                          />

                          <Line type="monotone" dataKey="expense" name="expense" stroke="#ef4444" strokeWidth={2} dot={false} strokeOpacity={0.6} />
                          <Line type="monotone" dataKey="profit" name="profit" stroke="#22c55e" strokeWidth={2} dot={false} strokeOpacity={0.6} />

                          {granularity === "daily" && (
                            <>
                              <Line type="monotone" dataKey="income_p10" name="income_p10" stroke="#8b5cf6" strokeOpacity={0.15} dot={false} strokeDasharray="4 6" />
                              <Line type="monotone" dataKey="income_p90" name="income_p90" stroke="#8b5cf6" strokeOpacity={0.15} dot={false} strokeDasharray="4 6" />
                            </>
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>

                {/* Способы оплаты */}
                <div className="space-y-6">
                  <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                    <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-purple-400" />
                      Структура оплат
                    </h3>
                    
                    <div className="h-48 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie
                            data={analysis.paymentTrends}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="total"
                          >
                            {analysis.paymentTrends.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            formatter={(val: number, name: string, props: any) => [
                              formatMoney(val), 
                              props.payload.method === 'cash' ? 'Наличные' :
                              props.payload.method === 'kaspi' ? 'Kaspi' :
                              props.payload.method === 'card' ? 'Карта' : 'Онлайн'
                            ]}
                            contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                          />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="space-y-2">
                      {analysis.paymentTrends.map((trend) => (
                        <div key={trend.method} className="flex items-center justify-between p-2 rounded-lg bg-gray-900/50">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: trend.color }} />
                            <span className="text-xs text-gray-400">
                              {trend.method === 'cash' ? 'Наличные' :
                               trend.method === 'kaspi' ? 'Kaspi' :
                               trend.method === 'card' ? 'Карта' : 'Онлайн'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white font-medium">{trend.percentage.toFixed(1)}%</span>
                            {trend.trend === 'up' ? <TrendingUp className="w-3 h-3 text-green-400" /> :
                             trend.trend === 'down' ? <TrendingDown className="w-3 h-3 text-red-400" /> :
                             <MinusIcon className="w-3 h-3 text-gray-500" />}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <div className="flex justify-between text-xs mb-2">
                        <span className="text-gray-500">Доля онлайн</span>
                        <span className={analysis.onlineShare < 15 ? "text-yellow-400" : "text-green-400"}>
                          {analysis.onlineShare.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Безналичные</span>
                        <span className="text-purple-400">{analysis.cashlessShare.toFixed(1)}%</span>
                      </div>
                    </div>
                  </Card>

                  {/* Быстрые метрики */}
                  <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/20 to-indigo-900/20 backdrop-blur-sm">
                    <h3 className="text-sm font-bold text-white mb-4">AI Метрики</h3>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">Сезонность</span>
                          <span className="text-purple-400">{analysis.seasonalityStrength.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500" style={{ width: `${analysis.seasonalityStrength}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">Рост</span>
                          <span className={analysis.growthRate >= 0 ? "text-green-400" : "text-red-400"}>
                            {analysis.growthRate >= 0 ? '+' : ''}{analysis.growthRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${analysis.growthRate >= 0 ? 'bg-green-500' : 'bg-red-500'}`} 
                            style={{ width: `${clamp(Math.abs(analysis.growthRate), 0, 100)}%` }} 
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>

              {/* Средний ряд: типичная неделя + категории */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Типичная неделя */}
                <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-blue-400" />
                      Типичная неделя
                    </h3>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        Доход
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-red-500 rounded-full" />
                        Расход
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                        Прибыль
                      </div>
                    </div>
                  </div>

                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={analysis.dayAverages.map((d) => ({
                          name: dayNames[d.dow],
                          income: d.income,
                          expense: d.expense,
                          profit: d.income - d.expense,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                        <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
                          formatter={(val: any, name: any) => [
                            formatMoney(val as number),
                            name === "income" ? "Типичный доход" : name === "expense" ? "Типичный расход" : "Типичная прибыль",
                          ]}
                        />
                        <Bar dataKey="income" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="profit" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Категории расходов */}
                <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-purple-400" />
                    Топ категорий расходов
                  </h3>

                  {topExpenseCats.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Info className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      Нет данных о расходах
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {topExpenseCats.map((c, idx) => (
                        <div key={c.name} className="flex items-center justify-between p-3 rounded-xl bg-gray-900/50 border border-gray-800">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-lg bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                              {idx + 1}
                            </div>
                            <span className="text-sm text-gray-300">{c.name}</span>
                          </div>
                          <div className="text-sm text-red-400 font-semibold">{formatMoney(c.value)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Нижний ряд: инсайты + аномалии + методология */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Умные инсайты */}
                <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/20 to-indigo-900/20 backdrop-blur-sm">
                  <h3 className="text-sm font-bold text-purple-300 mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Умные инсайты
                  </h3>

                  {smartInsights && (
                    <div className="space-y-3 text-xs">
                      {smartInsights.warnings.length > 0 && (
                        <div className="p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 text-yellow-200">
                          <div className="font-semibold mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Внимание
                          </div>
                          <ul className="space-y-1">
                            {smartInsights.warnings.map((w, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-yellow-500">•</span>
                                {w}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="p-3 rounded-xl border border-gray-700 bg-gray-900/50">
                        <div className="font-semibold text-white mb-2 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                          Рекомендации
                        </div>
                        <ul className="space-y-2">
                          {smartInsights.tips.map((t, i) => (
                            <li key={i} className="flex items-start gap-2 text-gray-400">
                              <span className="text-purple-400 mt-0.5">→</span>
                              {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Аномалии */}
                <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Search className="w-4 h-4 text-yellow-400" />
                    Обнаруженные аномалии
                  </h3>

                  {analysis.anomalies.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">Аномалий не найдено</p>
                      <p className="text-xs text-gray-600">Все показатели в норме</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {analysis.anomalies.map((a, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-gray-900/50 border border-gray-800">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-gray-300">{formatDateRu(a.date)}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              a.type === "income_low" ? "bg-red-500/20 text-red-400" : 
                              a.type === "expense_high" ? "bg-orange-500/20 text-orange-400" : 
                              "bg-green-500/20 text-green-400"
                            }`}>
                              {a.type === "income_low" ? "↓ Доход" : 
                               a.type === "expense_high" ? "↑ Расход" : "↑ Доход"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            {formatMoney(a.amount)} (норма: {formatMoney(a.avgForDay)})
                          </p>
                          {a.paymentMethod && (
                            <p className="text-xs text-gray-600 mt-1">
                              Через: {a.paymentMethod === 'cash' ? 'наличные' : 
                                      a.paymentMethod === 'kaspi' ? 'Kaspi' :
                                      a.paymentMethod === 'card' ? 'карта' : 'онлайн'}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Методология */}
                <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
                  <h3 className="text-sm font-bold text-blue-300 mb-4 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    Как это работает
                  </h3>
                  <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
                    <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-blue-500">
                      <span className="text-blue-400 font-semibold">1. Робастная статистика</span>
                      <p className="mt-1">Медиана и MAD для устойчивости к выбросам</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-purple-500">
                      <span className="text-purple-400 font-semibold">2. Многомерный тренд</span>
                      <p className="mt-1">Отдельные тренды для каждого способа оплаты</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-900/50 border-l-2 border-green-500">
                      <span className="text-green-400 font-semibold">3. AI Прогноз</span>
                      <p className="mt-1">Сезонность + тренды + доверительные интервалы</p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {!loading && !analysis && (
            <div className="text-center py-20">
              <Info className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400">Недостаточно данных для анализа</p>
              <p className="text-sm text-gray-600 mt-2">Добавьте операции доходов и расходов</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
