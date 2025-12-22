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
type DataPoint = {
  date: string
  income: number
  expense: number
  profit: number
  margin: number
  dayOfWeek: number
  dayName: string
  type?: "fact" | "forecast"

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
}

type DayStats = {
  income: number[]
  expense: number[]
}

type DayAverage = {
  dow: number
  income: number
  expense: number
  sigmaIncome: number
  sigmaExpense: number
  coverage: number
  count: number
  isEstimated: boolean
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

  totalPlanIncome: number
  planIncomeAchievementPct: number

  bestDow: { dow: number; income: number; profit: number }
  worstDow: { dow: number; income: number; profit: number }
}

type RangePreset = "30" | "90" | "180" | "365" | "all"
type Granularity = "daily" | "weekly"

const dayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

// ================== УТИЛИТЫ ==================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (dateStr: string) => new Date(`${dateStr}T12:00:00`)
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const formatMoney = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸"

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

  for (const d of effectiveAll) {
    totalIncome += d.income
    totalExpense += d.expense
    totalPlanIncome += d.planned_income || 0
  }

  const planIncomeAchievementPct =
    totalPlanIncome > 0 ? clamp((totalIncome / totalPlanIncome) * 100, 0, 999) : 0

  const weeksApprox = Math.max(1, Math.floor(totalPointsStats / 7))

  const dayStats: DayStats[] = Array.from({ length: 7 }, () => ({ income: [], expense: [] }))
  for (const d of effectiveForStats) {
    dayStats[d.dayOfWeek].income.push(d.income)
    dayStats[d.dayOfWeek].expense.push(d.expense)
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
      sigmaIncome: rawMadInc * 1.4826 || globalIncomeSigma,
      sigmaExpense: rawMadExp * 1.4826 || globalExpenseSigma,
      coverage,
      count: incArr.length,
      isEstimated: coverage < 0.4,
    }
  })

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

    anomaliesRaw.push({ date: d.date, type, amount, avgForDay })
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

  return {
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
    totalPlanIncome,
    planIncomeAchievementPct,
    bestDow: best,
    worstDow: worst,
  }
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
      })
    } else {
      cur.income += d.income
      cur.expense += d.expense
      cur.profit += d.profit
      cur.margin = safeMargin(cur.profit, cur.income)
      cur.planned_income = (cur.planned_income || 0) + (d.planned_income || 0)
      cur.planned_expense = (cur.planned_expense || 0) + (d.planned_expense || 0)
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

      const allDates = generateDateRange(start, end)

      const [incRes, expRes] = await Promise.all([
        supabase
          .from("incomes")
          .select("date, cash_amount, kaspi_amount, card_amount")
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

      // планы — необязательные
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
            setPlansWarning(`Планы отключены: таблица "${PLANS_TABLE}" не найдена. Графики работают без плана.`)
          } else {
            throw planRes.error
          }
        } else {
          planRows = planRes.data ?? []
        }
      }

      const dbMap = new Map<string, { income: number; expense: number }>()
      const planMap = new Map<string, { planned_income: number; planned_expense: number }>()
      const catsMap: Record<string, number> = {}

      for (const r of incRes.data ?? []) {
        const date = (r as any).date as string
        const val = ((r as any).cash_amount || 0) + ((r as any).kaspi_amount || 0) + ((r as any).card_amount || 0)
        const cur = dbMap.get(date) || { income: 0, expense: 0 }
        cur.income += val
        dbMap.set(date, cur)
      }

      for (const r of expRes.data ?? []) {
        const date = (r as any).date as string
        const val = ((r as any).cash_amount || 0) + ((r as any).kaspi_amount || 0)
        const cur = dbMap.get(date) || { income: 0, expense: 0 }
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

      const fullHistory: DataPoint[] = allDates.map((date) => {
        const fact = dbMap.get(date) || { income: 0, expense: 0 }
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
    if (analysis.avgMargin < 18) warnings.push("Маржа низкая — проверь расходы/цены.")
    if (analysis.profitVolatility > analysis.avgIncome * 0.6) warnings.push("Прибыль сильно скачет — нужны стабильные источники дохода.")
    if (analysis.confidenceScore < 45) warnings.push("Прогноз пока слабый — мало равномерных данных по дням недели.")

    const best = analysis.bestDow
    const worst = analysis.worstDow

    const tips: string[] = [
      `Лучший день недели: ${dayNames[best.dow]} (типичная прибыль ~${formatMoney(best.profit)}).`,
      `Худший день недели: ${dayNames[worst.dow]} (типичная прибыль ~${formatMoney(worst.profit)}).`,
    ]

    if (analysis.trendIncome > 0) tips.push("Тренд дохода положительный — закрепи рост: акции/пакеты/апселл.")
    if (analysis.trendIncome < 0) tips.push("Доход падает — найди дни просадки и причину: маркетинг/график/цены.")
    if (analysis.totalPlanIncome > 0) tips.push(`Выполнение плана по доходу: ~${analysis.planIncomeAchievementPct.toFixed(0)}%.`)

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
      setAiAdvice("Не смог получить совет. Проверь ключ/лимиты Gemini и логи сервера.")
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
    <div className="flex flex-col md:flex-row min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-500/20 rounded-full">
                <BrainCircuit className="w-8 h-8 text-purple-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">AI Советник Pro</h1>
                <p className="text-muted-foreground text-sm">
                  Робастная статистика • прогноз • аномалии • планы • советы Gemini
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => loadData()}
                disabled={loading}
                variant="outline"
                className="border-white/10 bg-white/5 hover:bg-white/10"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Обновить
              </Button>

              <Button
                onClick={handleExport}
                disabled={!analysis}
                variant="outline"
                className="border-white/10 bg-white/5 hover:bg-white/10"
              >
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>

              <Button
                onClick={handleAskAi}
                disabled={aiLoading || !analysis}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border-0 shadow-[0_0_20px_rgba(124,58,237,0.4)]"
              >
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Bot className="w-4 h-4 mr-2" />}
                {aiAdvice ? "Обновить совет" : "Совет ИИ"}
              </Button>
            </div>
          </div>

          {/* Панель фильтров */}
          <Card className="p-4 border border-white/10 bg-card">
            <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SlidersHorizontal className="w-4 h-4" />
                  Период
                </div>

                <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as RangePreset)}>
                  <SelectTrigger className="w-[160px] bg-white/5 border-white/10">
                    <SelectValue placeholder="Период" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Последние 30</SelectItem>
                    <SelectItem value="90">Последние 90</SelectItem>
                    <SelectItem value="180">Последние 180</SelectItem>
                    <SelectItem value="365">Последние 365</SelectItem>
                    <SelectItem value="all">Всё</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">С</div>
                  <Input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-[160px] bg-white/5 border-white/10"
                  />
                  <div className="text-xs text-muted-foreground">по</div>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-[160px] bg-white/5 border-white/10"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">График</div>
                  <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                    <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
                      <SelectValue placeholder="График" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Дни</SelectItem>
                      <SelectItem value="weekly">Недели</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 items-center">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">Нули учитывать</div>
                  <Switch checked={includeZeroDays} onCheckedChange={setIncludeZeroDays} />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">Автообновление</div>
                  <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">Планы</div>
                  <Switch checked={plansEnabled} onCheckedChange={setPlansEnabled} />
                </div>
              </div>
            </div>

            {plansWarning && (
              <div className="mt-3 p-3 rounded border border-amber-500/20 bg-amber-500/10 text-amber-200 text-xs">
                {plansWarning}
              </div>
            )}

            {analysis && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <div className="px-2 py-1 rounded border border-white/10 bg-white/5 w-fit">
                  <History className="w-3 h-3 inline mr-1" />
                  {formatDateRu(analysis.dataRangeStart)} — {formatDateRu(analysis.dataRangeEnd)}
                </div>

                <div className="px-2 py-1 rounded border border-white/10 bg-white/5 w-fit">
                  Достоверность: <span className="text-purple-300 font-bold">{analysis.confidenceScore}%</span>
                </div>

                <div
                  className={`px-2 py-1 rounded border w-fit ${
                    analysis.trendIncome > 0
                      ? "text-green-400 bg-green-500/10 border-green-500/20"
                      : "text-red-400 bg-red-500/10 border-red-500/20"
                  }`}
                >
                  {analysis.trendIncome >= 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                  Тренд дохода: {analysis.trendIncome >= 0 ? "+" : ""}
                  {analysis.trendIncome.toFixed(0)} ₸/день
                </div>

                {analysis.totalPlanIncome > 0 && (
                  <div className="px-2 py-1 rounded border w-fit text-cyan-200 bg-cyan-500/10 border-cyan-500/20">
                    <Target className="w-3 h-3 inline mr-1" />
                    План выполнен: {analysis.planIncomeAchievementPct.toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* AI advice */}
          {aiAdvice && (
            <Card className="p-6 border border-purple-500/40 bg-purple-950/20 animate-in fade-in slide-in-from-top-4 shadow-[0_0_30px_rgba(168,85,247,0.15)]">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-purple-500/20 rounded-lg shrink-0 mt-1">
                  <Sparkles className="w-5 h-5 text-purple-300" />
                </div>
                <div className="space-y-2 w-full">
                  <h3 className="font-bold text-purple-100 text-lg">Мнение AI-директора</h3>
                  <div className="text-sm text-purple-100/90 whitespace-pre-wrap leading-relaxed">{aiAdvice}</div>
                </div>
              </div>
            </Card>
          )}

          {loading && <div className="p-12 text-center text-muted-foreground animate-pulse">Считаем математическую модель...</div>}

          {errorText && !loading && (
            <Card className="p-4 border border-red-500/30 bg-red-500/10 text-red-200 text-sm">Ошибка: {errorText}</Card>
          )}

          {!loading && analysis && (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
              {/* Left charts */}
              <div className="xl:col-span-3 space-y-8">
                {/* Fact + forecast */}
                <Card className="p-6 border border-purple-500/20 bg-card relative overflow-hidden">
                  <div className="mb-6 relative z-10 flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-purple-400" />
                        Факт + прогноз на {FORECAST_DAYS} дней
                      </h2>

                      <p className="text-sm text-muted-foreground mt-1">
                        Прогноз прибыли:{" "}
                        <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span> •
                        Прогноз дохода:{" "}
                        <span className="text-purple-300 font-bold">{formatMoney(analysis.totalForecastIncome)}</span>
                      </p>

                      <p className="text-xs text-muted-foreground mt-2">
                        Аномалии: 🟢 рекорд дохода • 🔴 низкий доход • 🟠 высокий расход • 🟦 план дохода
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Достоверность</span>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="h-2 w-20 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500" style={{ width: `${analysis.confidenceScore}%` }} />
                        </div>
                        <span className="text-xs font-bold text-purple-300">{analysis.confidenceScore}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="h-96 w-full relative z-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartViewData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                        <XAxis
                          dataKey="date"
                          stroke="#666"
                          fontSize={10}
                          tickFormatter={(val) => {
                            const d = parseISODateSafe(val as string)
                            return `${dayNames[d.getDay()]} ${d.getDate()}`
                          }}
                          interval="preserveStartEnd"
                          minTickGap={22}
                        />
                        <YAxis stroke="#666" fontSize={10} tickFormatter={(v) => `${(v as number) / 1000}k`} />

                        <Tooltip
                          contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "8px" }}
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
                                      : name === "income_p10"
                                        ? "Доход p10"
                                        : name === "income_p90"
                                          ? "Доход p90"
                                          : name === "profit_p10"
                                            ? "Прибыль p10"
                                            : name === "profit_p90"
                                              ? "Прибыль p90"
                                              : name
                            return [formatMoney(val as number), `${label} (${props?.payload?.type === "forecast" ? "прогноз" : "факт"})`]
                          }}
                          labelFormatter={(label: any) => {
                            const d = parseISODateSafe(label)
                            return formatDateRu(label) + ` (${dayNames[d.getDay()]})`
                          }}
                          cursor={{ stroke: "white", strokeWidth: 1, strokeDasharray: "3 3" }}
                        />

                        <ReferenceLine x={analysis.lastFactDate} stroke="#666" strokeDasharray="3 3" label="ПОСЛЕДНИЙ ФАКТ" />

                        {/* Доход */}
                        <Area
                          type="monotone"
                          dataKey="income"
                          name="income"
                          stroke="#8b5cf6"
                          strokeWidth={3}
                          fill="url(#incomeGradient)"
                          dot={<AnomalyDot />}
                        />

                        {/* План (доход) */}
                        <Line
                          type="monotone"
                          dataKey="planned_income"
                          name="planned_income"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          strokeDasharray="6 6"
                          dot={false}
                          strokeOpacity={0.9}
                        />

                        {/* Расход */}
                        <Line type="monotone" dataKey="expense" name="expense" stroke="#ef4444" strokeWidth={2} dot={false} strokeOpacity={0.55} />

                        {/* Прибыль */}
                        <Line type="monotone" dataKey="profit" name="profit" stroke="#22c55e" strokeWidth={2} dot={false} strokeOpacity={0.55} />

                        {granularity === "daily" && (
                          <>
                            <Line type="monotone" dataKey="income_p10" name="income_p10" stroke="#8b5cf6" strokeOpacity={0.2} dot={false} strokeDasharray="4 6" />
                            <Line type="monotone" dataKey="income_p90" name="income_p90" stroke="#8b5cf6" strokeOpacity={0.2} dot={false} strokeDasharray="4 6" />
                            <Line type="monotone" dataKey="profit_p10" name="profit_p10" stroke="#22c55e" strokeOpacity={0.18} dot={false} strokeDasharray="4 6" />
                            <Line type="monotone" dataKey="profit_p90" name="profit_p90" stroke="#22c55e" strokeOpacity={0.18} dot={false} strokeDasharray="4 6" />
                          </>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Типичная неделя */}
                <Card className="p-6 border-border bg-card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      Типичная неделя (медиана)
                    </h3>
                    <div className="flex gap-4 text-xs text-muted-foreground">
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
                        <XAxis dataKey="name" stroke="#666" fontSize={12} />
                        <Tooltip
                          cursor={{ fill: "transparent" }}
                          contentStyle={{ backgroundColor: "#111", border: "1px solid #333" }}
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
                <Card className="p-6 border border-white/10 bg-card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <PieChart className="w-4 h-4 text-purple-300" />
                      Топ категорий расходов
                    </h3>
                    <div className="text-xs text-muted-foreground">(берётся из таблицы expenses)</div>
                  </div>

                  {topExpenseCats.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-8">Нет расходов по категориям за выбранный период.</div>
                  ) : (
                    <div className="space-y-2">
                      {topExpenseCats.map((c) => (
                        <div key={c.name} className="flex items-center justify-between px-3 py-2 rounded border border-white/10 bg-white/5">
                          <div className="text-sm text-foreground">{c.name}</div>
                          <div className="text-sm text-red-300 font-semibold">{formatMoney(c.value)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Right panels */}
              <div className="xl:col-span-1 space-y-6">
                {/* KPI */}
                <Card className="p-5 border border-emerald-500/20 bg-emerald-900/5">
                  <h3 className="text-sm font-bold text-emerald-300 mb-3">Ключевые метрики</h3>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>Средний доход/день: <span className="text-foreground font-semibold">{formatMoney(analysis.avgIncome)}</span></p>
                    <p>Средний расход/день: <span className="text-foreground font-semibold">{formatMoney(analysis.avgExpense)}</span></p>
                    <p>Средняя прибыль/день: <span className="text-foreground font-semibold">{formatMoney(analysis.avgProfit)}</span></p>
                    <p>Средняя маржа: <span className="text-foreground font-semibold">{formatPct(analysis.avgMargin)}</span></p>
                    <p>Волатильность прибыли (σ): <span className="text-foreground font-semibold">{formatMoney(analysis.profitVolatility)}</span></p>
                    <p>Дней в выборке: <span className="text-foreground font-semibold">{analysis.totalDataPoints}</span></p>
                  </div>
                </Card>

                {/* План vs факт */}
                <Card className="p-5 border border-cyan-500/20 bg-cyan-900/5">
                  <h3 className="text-sm font-bold text-cyan-200 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    План vs Факт
                  </h3>
                  {analysis.totalPlanIncome <= 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Планов за период нет (или планы отключены).
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p>План дохода: <span className="text-foreground font-semibold">{formatMoney(analysis.totalPlanIncome)}</span></p>
                      <p>Факт дохода: <span className="text-foreground font-semibold">{formatMoney(analysis.totalIncome)}</span></p>
                      <p>
                        Выполнение:{" "}
                        <span className={`font-bold ${analysis.planIncomeAchievementPct >= 100 ? "text-green-400" : "text-amber-300"}`}>
                          {analysis.planIncomeAchievementPct.toFixed(0)}%
                        </span>
                      </p>
                    </div>
                  )}
                </Card>

                {/* Умные инсайты */}
                <Card className="p-5 border border-purple-500/20 bg-purple-900/5">
                  <h3 className="text-sm font-bold text-purple-300 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Умные инсайты
                  </h3>

                  {smartInsights && (
                    <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                      {smartInsights.warnings.length > 0 && (
                        <div className="p-3 rounded border border-amber-500/20 bg-amber-500/10 text-amber-200">
                          <div className="font-semibold mb-1">⚠️ Внимание</div>
                          <ul className="list-disc pl-4 space-y-1">
                            {smartInsights.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="p-3 rounded border border-white/10 bg-white/5">
                        <div className="font-semibold text-foreground mb-1">Что делать</div>
                        <ul className="list-disc pl-4 space-y-1">
                          {smartInsights.tips.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Аномалии */}
                <Card className="p-5 border border-border bg-card">
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4 text-yellow-400" />
                    Аномалии (умный детектор)
                  </h3>

                  {analysis.anomalies.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Выбросов не найдено.</p>
                  ) : (
                    <div className="space-y-2">
                      {analysis.anomalies.map((a, idx) => (
                        <div key={idx} className="p-2 bg-white/5 rounded border border-white/10 text-xs">
                          <div className="flex justify-between mb-1">
                            <span className="font-bold text-foreground">{formatDateRu(a.date)}</span>
                            <span className={a.type === "income_low" ? "text-red-400" : a.type === "expense_high" ? "text-amber-300" : "text-green-400"}>
                              {a.type === "income_low" ? "🔴 Низкий доход" : a.type === "expense_high" ? "🟠 Высокий расход" : "🟢 Рекорд дохода"}
                            </span>
                          </div>
                          <p className="text-muted-foreground">
                            Было: <span className="text-foreground">{formatMoney(a.amount)}</span> (норма: {formatMoney(a.avgForDay)})
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Как считает */}
                <Card className="p-5 border border-blue-500/20 bg-blue-900/5">
                  <h3 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    Как это считает
                  </h3>
                  <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                    <p>
                      <span className="text-blue-200 font-semibold">1) Робастная статистика:</span> медиана и MAD по дням недели.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">2) Тренды:</span> считаем отдельно тренд дохода и расхода, тренд “приглушается” при короткой истории.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">3) Прогноз:</span> сезонность + тренды + ограничение расхода (cap), плюс интервалы p10/p90.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">4) Аномалии:</span> z-score от sigma (из MAD) + пороги по сумме.
                    </p>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {!loading && !analysis && (
            <div className="text-center py-20 text-muted-foreground">
              <Info className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Недостаточно данных. Внесите хотя бы одну операцию.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
