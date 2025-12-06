"use client"

import { useEffect, useMemo, useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabaseClient"
import { getGeminiAdvice } from "../actions"
import {
  BrainCircuit,
  TrendingUp,
  CalendarDays,
  Sparkles,
  Info,
  HelpCircle,
  Search,
  History,
  Bot,
  Loader2,
} from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Bar,
  BarChart,
} from "recharts"

// ========== КОНФИГ ==========
const HISTORY_START = "2025-11-01" // если что – поменяешь на дату старта бизнеса
const FORECAST_DAYS = 30

const MIN_INCOME_ANOMALY_ABS = 10_000
const MIN_EXPENSE_ANOMALY_ABS = 10_000
const EXPENSE_CAP_MULTIPLIER = 3 // расход в прогнозе не выше 3× глобальной медианы

// ========== ТИПЫ ==========
type DataPoint = {
  date: string
  income: number
  expense: number
  dayOfWeek: number
  dayName: string
  type?: "fact" | "forecast"
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
  trend: number
  profitTrend: number
  avgIncome: number
  avgExpense: number
  avgProfit: number
  profitVolatility: number
  totalIncome: number
  totalExpense: number
  totalForecastIncome: number
  totalForecastProfit: number
}

const dayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

// ========== УТИЛИТЫ ==========
const formatMoney = (v: number) =>
  v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸"

const formatDateRu = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

const generateDateRange = (startDate: Date, daysCount: number): string[] => {
  const dates: string[] = []
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

const median = (arr: number[]): number => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

const mad = (arr: number[], med: number): number => {
  if (!arr.length) return 0
  const devs = arr.map((v) => Math.abs(v - med))
  return median(devs)
}

// линейный тренд (наклон) методом наименьших квадратов
const linearTrendSlope = (y: number[]): number => {
  const n = y.length
  if (n <= 1) return 0

  const x = Array.from({ length: n }, (_, i) => i)
  const sx = x.reduce((a, b) => a + b, 0)
  const sy = y.reduce((a, b) => a + b, 0)
  const sxy = x.reduce((sum, v, i) => sum + v * y[i], 0)
  const sxx = x.reduce((sum, v) => sum + v * v, 0)

  const denom = n * sxx - sx * sx
  if (denom === 0) return 0

  return (n * sxy - sx * sy) / denom
}

// ========== ГЛАВНЫЙ АНАЛИЗАТОР ==========
const buildAnalysis = (history: DataPoint[] | null): AnalysisResult | null => {
  if (!history || history.length === 0) return null

  // ---- 1. Обрезаем хвост пустых дней (берём до последнего активного) ----
  let lastActiveIndex = history.length - 1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].income > 0 || history[i].expense > 0) {
      lastActiveIndex = i
      break
    }
  }

  const effectiveHistory = history.slice(0, lastActiveIndex + 1)
  if (!effectiveHistory.length) return null

  const totalPoints = effectiveHistory.length
  const totalIncome = effectiveHistory.reduce((s, d) => s + d.income, 0)
  const totalExpense = effectiveHistory.reduce((s, d) => s + d.expense, 0)

  const weeks = Math.max(1, Math.floor(totalPoints / 7))

  // ---- 2. Статы по дням недели ----
  const dayStats: DayStats[] = Array(7)
    .fill(null)
    .map(() => ({ income: [], expense: [] }))

  effectiveHistory.forEach((d) => {
    dayStats[d.dayOfWeek].income.push(d.income)
    dayStats[d.dayOfWeek].expense.push(d.expense)
  })

  const globalIncomeArr = effectiveHistory.map((d) => d.income)
  const globalExpenseArr = effectiveHistory.map((d) => d.expense)

  const globalIncomeMed = median(globalIncomeArr)
  const globalExpenseMed = median(globalExpenseArr)
  const globalIncomeMad = mad(globalIncomeArr, globalIncomeMed)
  const globalExpenseMad = mad(globalExpenseArr, globalExpenseMed)

  const globalIncomeSigma = globalIncomeMad * 1.4826 || 1
  const globalExpenseSigma = globalExpenseMad * 1.4826 || 1

  const dayAverages: DayAverage[] = dayStats.map((ds, dow) => {
    const incArr = ds.income
    const expArr = ds.expense
    const coverage = weeks > 0 ? incArr.length / weeks : 0

    const rawMedInc = incArr.length ? median(incArr) : globalIncomeMed
    const rawMedExp = expArr.length ? median(expArr) : globalExpenseMed

    const rawMadInc = incArr.length ? mad(incArr, rawMedInc) : globalIncomeMad
    const rawMadExp = expArr.length ? mad(expArr, rawMedExp) : globalExpenseMad

    const blendWeight = Math.min(1, coverage) // 0..1
    const medInc = rawMedInc * blendWeight + globalIncomeMed * (1 - blendWeight)
    const medExp = rawMedExp * blendWeight + globalExpenseMed * (1 - blendWeight)

    const sigmaIncome = rawMadInc * 1.4826 || globalIncomeSigma
    const sigmaExpense = rawMadExp * 1.4826 || globalExpenseSigma

    return {
      dow,
      income: medInc,
      expense: medExp,
      sigmaIncome,
      sigmaExpense,
      coverage,
      count: incArr.length,
      isEstimated: coverage < 0.4,
    }
  })

  // ---- 3. Тренды: доход и прибыль ----
  const yIncome = effectiveHistory.map((d) => d.income)
  const yProfit = effectiveHistory.map((d) => d.income - d.expense)

  const incomeTrend = linearTrendSlope(yIncome)
  const profitTrend = linearTrendSlope(yProfit)

  // ---- 4. Прогноз на 30 дней ----
  const forecast: DataPoint[] = []
  let totalForecastIncome = 0
  let totalForecastExpense = 0

  const lastFactDateStr = effectiveHistory[effectiveHistory.length - 1].date
  const lastFactDate = new Date(lastFactDateStr)

  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const date = new Date(lastFactDate)
    date.setDate(lastFactDate.getDate() + i)
    const iso = date.toISOString().slice(0, 10)
    const dow = date.getDay()
    const base = dayAverages[dow]

    const baseIncome = Math.max(0, base.income)
    const baseExpense = Math.max(0, base.expense)

    const trendFactor = 1 - (i - 1) / (FORECAST_DAYS * 2) // плавное затухание
    const trendEffect =
      incomeTrend * i * trendFactor * (base.isEstimated ? 0.5 : 1)

    const predictedIncome = Math.max(0, baseIncome + trendEffect)
    const predictedExpense = Math.min(
      Math.max(0, baseExpense),
      (globalExpenseMed || baseExpense || 0) * EXPENSE_CAP_MULTIPLIER,
    )

    forecast.push({
      date: iso,
      income: predictedIncome,
      expense: predictedExpense,
      dayOfWeek: dow,
      dayName: dayNames[dow],
      type: "forecast",
    })

    totalForecastIncome += predictedIncome
    totalForecastExpense += predictedExpense
  }

  // ---- 5. Аномалии ----
  const anomalies: Anomaly[] = effectiveHistory
    .filter((d) => {
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
      const expenseThresholdAbs = Math.max(
        globalExpenseMed * 0.3,
        MIN_EXPENSE_ANOMALY_ABS,
      )

      const strongIncomeHigh = zInc >= 3 && absIncDiff >= incomeThresholdAbs
      const strongIncomeLow = zInc <= -2.5 && absIncDiff >= incomeThresholdAbs
      const strongExpenseHigh = zExp >= 3 && absExpDiff >= expenseThresholdAbs

      return strongIncomeHigh || strongIncomeLow || strongExpenseHigh
    })
    .map((d) => {
      const avg = dayAverages[d.dayOfWeek]

      const incDiff = Math.abs(d.income - avg.income)
      const expDiff = Math.abs(d.expense - avg.expense)

      let type: Anomaly["type"]
      let amount: number
      let avgForDay: number

      if (
        d.expense - avg.expense >
        Math.max(globalExpenseMed * 0.3, MIN_EXPENSE_ANOMALY_ABS)
      ) {
        type = "expense_high"
        amount = d.expense
        avgForDay = avg.expense
      } else if (d.income > avg.income && incDiff >= expDiff) {
        type = "income_high"
        amount = d.income
        avgForDay = avg.income
      } else {
        type = "income_low"
        amount = d.income
        avgForDay = avg.income
      }

      return { date: d.date, type, amount, avgForDay }
    })
    .reverse()
    .slice(0, 5)

  // ---- 6. Достоверность прогноза ----
  const avgCoverage =
    dayAverages.reduce((sum, d) => sum + d.coverage, 0) / dayAverages.length

  const weeksFactor = Math.min(1, weeks / 4) // 4 недели = ок
  const rawScore = weeksFactor * 0.6 + avgCoverage * 0.4

  const confidenceScore = Math.max(10, Math.min(100, Math.round(rawScore * 100)))

  // ---- 7. Средние и волатильность прибыли ----
  const avgIncome = totalIncome / totalPoints || 0
  const avgExpense = totalExpense / totalPoints || 0
  const profits = effectiveHistory.map((d) => d.income - d.expense)
  const avgProfit = profits.reduce((a, b) => a + b, 0) / (profits.length || 1)

  const profitVolatility = Math.sqrt(
    profits.reduce((s, p) => s + Math.pow(p - avgProfit, 2), 0) /
      (profits.length || 1),
  )

  const chartData: DataPoint[] = [
    ...effectiveHistory.map((d) => ({ ...d, type: "fact" as const })),
    ...forecast,
  ]

  return {
    dayAverages,
    forecastData: forecast,
    chartData,
    anomalies,
    confidenceScore,
    totalDataPoints: totalPoints,
    dataRangeStart: effectiveHistory[0].date,
    dataRangeEnd: effectiveHistory[effectiveHistory.length - 1].date,
    lastFactDate: lastFactDateStr,
    trend: incomeTrend,
    profitTrend,
    avgIncome,
    avgExpense,
    avgProfit,
    profitVolatility,
    totalIncome,
    totalExpense,
    totalForecastIncome,
    totalForecastProfit: totalForecastIncome - totalForecastExpense,
  }
}

// ========== КОМПОНЕНТ ==========
export default function AIAnalysisPage() {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [expenseCategories, setExpenseCategories] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [aiAdvice, setAiAdvice] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // 1. ЗАГРУЗКА ДАННЫХ
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)

      const startDate = new Date(HISTORY_START)
      const today = new Date()

      const diffTime = Math.abs(today.getTime() - startDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1

      const fromDateStr = startDate.toISOString().slice(0, 10)
      const allDates = generateDateRange(startDate, diffDays)

      const [incRes, expRes] = await Promise.all([
        supabase
          .from("incomes")
          .select("date, cash_amount, kaspi_amount, card_amount")
          .gte("date", fromDateStr)
          .order("date"),
        supabase
          .from("expenses")
          .select("date, cash_amount, kaspi_amount, category")
          .gte("date", fromDateStr)
          .order("date"),
      ])

      const dbMap = new Map<string, { income: number; expense: number }>()
      const catsMap: Record<string, number> = {}

      incRes.data?.forEach((r: any) => {
        const val =
          (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.card_amount || 0)
        const cur = dbMap.get(r.date) || { income: 0, expense: 0 }
        cur.income += val
        dbMap.set(r.date, cur)
      })

      expRes.data?.forEach((r: any) => {
        const val = (r.cash_amount || 0) + (r.kaspi_amount || 0)
        const cur = dbMap.get(r.date) || { income: 0, expense: 0 }
        cur.expense += val
        dbMap.set(r.date, cur)

        if (val > 0) {
          const catName = r.category || "Прочее"
          catsMap[catName] = (catsMap[catName] || 0) + val
        }
      })

      const fullHistory: DataPoint[] = allDates.map((date) => {
        const data = dbMap.get(date) || { income: 0, expense: 0 }
        const dObj = new Date(date)
        const dayOfWeek = dObj.getDay()
        return {
          date,
          income: data.income,
          expense: data.expense,
          dayOfWeek,
          dayName: dayNames[dayOfWeek],
        }
      })

      setHistory(fullHistory)
      setExpenseCategories(catsMap)
      setLoading(false)
    }

    loadData()
  }, [])

  const analysis = useMemo(() => buildAnalysis(history), [history])

  // --- ЗАПРОС К ИИ ---
  const handleAskAi = async () => {
    if (!analysis) return
    setAiLoading(true)

    const dataForAi = {
      avgIncome: Math.round(analysis.avgIncome),
      avgExpense: Math.round(analysis.avgExpense),
      predictedProfit: Math.round(analysis.totalForecastProfit),
      trendIncomePerDay: analysis.trend,
      trendProfitPerDay: analysis.profitTrend,
      expensesByCategory: expenseCategories,
      anomalies: analysis.anomalies.map((a) => ({
        date: a.date,
        type:
          a.type === "income_low"
            ? "Низкий доход"
            : a.type === "income_high"
            ? "Высокий доход"
            : "Высокий расход",
        amount: a.amount,
        normalForDay: a.avgForDay,
      })),
      confidenceScore: analysis.confidenceScore,
      avgProfit: analysis.avgProfit,
      profitVolatility: analysis.profitVolatility,
    }

    const text = await getGeminiAdvice(dataForAi)
    setAiAdvice(text)
    setAiLoading(false)
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Хедер */}
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-500/20 rounded-full">
                <BrainCircuit className="w-8 h-8 text-purple-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">AI Советник Pro</h1>
                <p className="text-muted-foreground text-sm">
                  Робастная статистика + прогноз + советы Gemini
                </p>
              </div>
            </div>
            <Button
              onClick={handleAskAi}
              disabled={aiLoading || !analysis}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border-0 shadow-[0_0_20px_rgba(124,58,237,0.4)]"
            >
              {aiLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Bot className="w-4 h-4 mr-2" />
              )}
              {aiAdvice ? "Обновить совет" : "Получить совет от ИИ"}
            </Button>
          </div>

          {aiAdvice && (
            <Card className="p-6 border border-purple-500/40 bg-purple-950/20 animate-in fade-in slide-in-from-top-4 shadow-[0_0_30px_rgba(168,85,247,0.15)]">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-purple-500/20 rounded-lg shrink-0 mt-1">
                  <Sparkles className="w-5 h-5 text-purple-300" />
                </div>
                <div className="space-y-2 w-full">
                  <h3 className="font-bold text-purple-100 text-lg">
                    Мнение AI-директора:
                  </h3>
                  <div className="text-sm text-purple-100/90 whitespace-pre-wrap leading-relaxed">
                    {aiAdvice}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {loading && (
            <div className="p-12 text-center text-muted-foreground animate-pulse">
              Считаем математическую модель...
            </div>
          )}

          {!loading && analysis && (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
              {/* Левая часть: график + неделя */}
              <div className="xl:col-span-3 space-y-8">
                {/* Прогноз */}
                <Card className="p-6 border border-purple-500/20 bg-card relative overflow-hidden">
                  <div className="mb-6 relative z-10 flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-purple-400" />
                        Прогноз на {FORECAST_DAYS} дней
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Ожидаемая прибыль:{" "}
                        <span className="text-green-400 font-bold">
                          {formatMoney(analysis.totalForecastProfit)}
                        </span>
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <div className="text-[11px] text-blue-300 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20 w-fit">
                          <History className="w-3 h-3 inline mr-1" />
                          Данные: {formatDateRu(analysis.dataRangeStart)} —{" "}
                          {formatDateRu(analysis.dataRangeEnd)}
                        </div>
                        <div
                          className={`text-[11px] px-2 py-1 rounded border w-fit ${
                            analysis.trend > 0
                              ? "text-green-400 bg-green-500/10 border-green-500/20"
                              : "text-red-400 bg-red-500/10 border-red-500/20"
                          }`}
                        >
                          <TrendingUp
                            className={`w-3 h-3 inline mr-1 ${
                              analysis.trend < 0 ? "rotate-180" : ""
                            }`}
                          />
                          Тренд дохода: {analysis.trend > 0 ? "+" : ""}
                          {analysis.trend.toFixed(0)} ₸/день
                        </div>
                        <div className="text-[11px] px-2 py-1 rounded border w-fit text-amber-300 bg-amber-500/10 border-amber-500/30">
                          Тренд прибыли:{" "}
                          {analysis.profitTrend >= 0 ? "+" : ""}
                          {analysis.profitTrend.toFixed(0)} ₸/день
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
                        Достоверность
                      </span>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="h-2 w-20 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500"
                            style={{ width: `${analysis.confidenceScore}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-purple-300">
                          {analysis.confidenceScore}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="h-80 w-full relative z-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={analysis.chartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="forecastGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#a855f7"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#a855f7"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          opacity={0.1}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          stroke="#666"
                          fontSize={10}
                          tickFormatter={(val) => {
                            const d = new Date(val as string)
                            return `${dayNames[d.getDay()]} ${d.getDate()}`
                          }}
                          interval="preserveStartEnd"
                          minTickGap={20}
                        />
                        <YAxis
                          stroke="#666"
                          fontSize={10}
                          tickFormatter={(v) => `${(v as number) / 1000}k`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#111",
                            border: "1px solid #333",
                            borderRadius: "8px",
                          }}
                          formatter={(val: any, _name, props: any) => [
                            formatMoney(val as number),
                            props.payload.type === "forecast"
                              ? "Прогноз"
                              : "Факт",
                          ]}
                          labelFormatter={(label: any) => {
                            const d = new Date(label)
                            return formatDateRu(label) + ` (${dayNames[d.getDay()]})`
                          }}
                          cursor={{
                            stroke: "white",
                            strokeWidth: 1,
                            strokeDasharray: "3 3",
                          }}
                        />
                        <ReferenceLine
                          x={analysis.lastFactDate}
                          stroke="#666"
                          strokeDasharray="3 3"
                          label="СЕГОДНЯ"
                        />

                        <Area
                          type="monotone"
                          dataKey="income"
                          name="Доход"
                          stroke="#8b5cf6"
                          strokeWidth={3}
                          fill="url(#forecastGradient)"
                        />
                        <Line
                          type="monotone"
                          dataKey="expense"
                          name="Расход"
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                          strokeOpacity={0.5}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Профиль недели */}
                <Card className="p-6 border-border bg-card neon-glow">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      Типичная неделя (медиана)
                    </h3>
                    <div className="flex gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        Доход
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-red-500 rounded-full" />
                        Расход
                      </div>
                    </div>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={analysis.dayAverages.map((d) => ({
                          ...d,
                          name: dayNames[d.dow],
                        }))}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          opacity={0.1}
                          vertical={false}
                        />
                        <XAxis dataKey="name" stroke="#666" fontSize={12} />
                        <Tooltip
                          cursor={{ fill: "transparent" }}
                          contentStyle={{
                            backgroundColor: "#111",
                            border: "1px solid #333",
                          }}
                          formatter={(val: any, name: any) => [
                            formatMoney(val as number),
                            name === "income"
                              ? "Типичный доход"
                              : "Типичный расход",
                          ]}
                        />
                        <Bar dataKey="income" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              {/* Правая колонка */}
              <div className="xl:col-span-1 space-y-6">
                {/* Краткая статистика */}
                <Card className="p-5 border border-emerald-500/20 bg-emerald-900/5">
                  <h3 className="text-sm font-bold text-emerald-300 mb-3">
                    Краткая статистика
                  </h3>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Средний дневной доход:{" "}
                      <span className="text-foreground font-semibold">
                        {formatMoney(analysis.avgIncome)}
                      </span>
                    </p>
                    <p>
                      Средний дневной расход:{" "}
                      <span className="text-foreground font-semibold">
                        {formatMoney(analysis.avgExpense)}
                      </span>
                    </p>
                    <p>
                      Средняя дневная прибыль:{" "}
                      <span className="text-foreground font-semibold">
                        {formatMoney(analysis.avgProfit)}
                      </span>
                    </p>
                    <p>
                      Волатильность прибыли (σ):{" "}
                      <span className="text-foreground font-semibold">
                        {formatMoney(analysis.profitVolatility)}
                      </span>
                    </p>
                    <p>
                      Дней в выборке:{" "}
                      <span className="text-foreground font-semibold">
                        {analysis.totalDataPoints}
                      </span>
                    </p>
                  </div>
                </Card>

                {/* Объяснение алгоритма */}
                <Card className="p-5 border border-blue-500/20 bg-blue-900/5">
                  <h3 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    Как это считает
                  </h3>
                  <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                    <p>
                      <span className="text-blue-200 font-semibold">
                        1. Робастные оценки:
                      </span>{" "}
                      вместо среднего используем медиану и MAD по каждому дню
                      недели + подмешиваем общую статистику, если по дню мало
                      данных.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">
                        2. Два тренда:
                      </span>{" "}
                      отдельный тренд по доходу и по прибыли, чтобы видеть, растёт
                      ли бизнес реально, а не только оборот.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">
                        3. Аномалии:
                      </span>{" "}
                      ищем выбросы через z-score и пороги по сумме, отдельно для
                      дохода и расходов.
                    </p>
                    <p>
                      <span className="text-blue-200 font-semibold">
                        4. Достоверность:
                      </span>{" "}
                      учитываем длину истории и равномерность данных по дням
                      недели – так строится рейтинг доверия к прогнозу.
                    </p>
                  </div>
                </Card>

                {/* Аномалии */}
                <Card className="p-5 border border-border bg-card neon-glow">
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4 text-yellow-400" />
                    Умный детектор (аномалии)
                  </h3>
                  {analysis.anomalies.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Выбросов не найдено.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {analysis.anomalies.map((a, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-white/5 rounded border border-white/5 text-xs"
                        >
                          <div className="flex justify-between mb-1">
                            <span className="font-bold text-foreground">
                              {formatDateRu(a.date)}
                            </span>
                            <span
                              className={
                                a.type === "income_low"
                                  ? "text-red-400"
                                  : a.type === "expense_high"
                                  ? "text-red-400"
                                  : "text-green-400"
                              }
                            >
                              {a.type === "income_low"
                                ? "📉 Мало выручки"
                                : a.type === "expense_high"
                                ? "⚠️ Высокий расход"
                                : "🚀 Рекорд выручки"}
                            </span>
                          </div>
                          <p className="text-muted-foreground">
                            Было:{" "}
                            <span className="text-foreground">
                              {formatMoney(a.amount)}
                            </span>{" "}
                            (норма: {formatMoney(a.avgForDay)})
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
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
