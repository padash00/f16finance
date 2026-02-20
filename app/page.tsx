'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Globe,
  LineChart,
  MinusIcon,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  Line,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  PieChart as RePieChart,
  Pie,
} from 'recharts'

/* =======================
   TYPES
======================= */
type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
  comment: string | null
}

type ExpenseRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type RangeType = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  incomeTotal: number

  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  profit: number

  netCash: number
  netNonCash: number
  netTotal: number

  incomeTxCount: number
  expenseTxCount: number
  operationsCount: number
  avgIncomeCheck: number
}

type AIInsight = {
  score: number
  status: 'critical' | 'warning' | 'good' | 'excellent'
  summary: string
  recommendation: string
  margin: number
  efficiency: number
  trends: {
    income: 'up' | 'down' | 'stable'
    expense: 'up' | 'down' | 'stable'
    profit: 'up' | 'down' | 'stable'
  }
  anomalies: Array<{
    type: 'spike' | 'drop' | 'unusual'
    date: string
    description: string
    severity: 'low' | 'medium' | 'high'
  }>
  predictions: {
    nextMonthProfit: number
    confidence: number
    recommendation: string
  }
  benchmarks: {
    vsPrevPeriod: number
    vsAvgDaily: number
  }
}

type ChartPoint = {
  date: string
  formattedDate: string
  income: number
  expense: number
  profit: number
  movingAvg: number
}

type CategoryData = {
  name: string
  value: number
  color: string
  percentage: number
}

type FeedItem = {
  id: string
  date: string
  company_id: string
  kind: 'income' | 'expense'
  title: string
  amount: number
  category?: string
  isAnomaly?: boolean
}

/* =======================
   UTILS
======================= */
const DateUtils = {
  toISODateLocal: (d: Date): string => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },
  todayISO: (): string => DateUtils.toISODateLocal(new Date()),
  addDaysISO: (iso: string, diff: number): string => {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },
  formatDate: (iso: string, mode: 'short' | 'full' = 'short'): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    if (mode === 'short') return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },
  getRelativeDay: (iso: string): string => {
    const today = DateUtils.fromISO(DateUtils.todayISO())
    const date = DateUtils.fromISO(iso)
    const diffDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000)
    if (diffDays === 0) return 'Сегодня'
    if (diffDays === 1) return 'Вчера'
    if (diffDays === 2) return '2 дня назад'
    if (diffDays === 3) return '3 дня назад'
    if (diffDays === 4) return '4 дня назад'
    if (diffDays < 7) return `${diffDays} дней назад`
    return DateUtils.formatDate(iso)
  },
  getQuarterBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0)),
    }
  },
  getYearBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31)),
    }
  },
  calculatePrevPeriod: (dateFrom: string, dateTo: string) => {
    const dFrom = DateUtils.fromISO(dateFrom)
    const dTo = DateUtils.fromISO(dateTo)
    const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
    return {
      prevFrom: DateUtils.addDaysISO(dateFrom, -durationDays),
      prevTo: DateUtils.addDaysISO(dateFrom, -1),
      durationDays,
    }
  },
  getDatesInRange: (from: string, to: string): string[] => {
    const dates: string[] = []
    let cur = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    while (cur <= end) {
      dates.push(DateUtils.toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  },
}

const Formatters = {
  moneyDetailed: (v: number) =>
    (Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸',
  percentChange: (current: number, previous: number): { value: string; isPositive: boolean } => {
    if (!previous) return { value: '—', isPositive: true }
    const change = ((current - previous) / Math.abs(previous)) * 100
    return { value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, isPositive: change >= 0 }
  },
  tooltip: {
    contentStyle: {
      backgroundColor: '#0b1220',
      border: '1px solid rgba(139,92,246,.35)',
      borderRadius: 14,
      padding: '12px 14px',
      boxShadow: '0 16px 40px rgba(0,0,0,.55)',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#aab', fontSize: 12 },
  } as const,
}

const COLORS = {
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
}

/* =======================
   AI / ANALYTICS
======================= */
class AIAnalytics {
  static detectTrends(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 3) return 'stable'
    const first = data[0]
    const last = data[data.length - 1]
    const change = ((last - first) / (first || 1)) * 100
    if (change > 5) return 'up'
    if (change < -5) return 'down'
    return 'stable'
  }

  static detectAnomalies(points: ChartPoint[], threshold = 2.5) {
    const values = points.map(p => p.income).filter(v => v > 0)
    if (!values.length) return [] as AIInsight['anomalies']

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length)

    const anomalies: AIInsight['anomalies'] = []
    for (const p of points) {
      if (!p.income) continue
      const z = Math.abs((p.income - mean) / (stdDev || 1))
      if (z <= threshold) continue

      const type: 'spike' | 'drop' = p.income > mean ? 'spike' : 'drop'
      const severity: 'low' | 'medium' | 'high' = z > 4 ? 'high' : z > 3 ? 'medium' : 'low'
      anomalies.push({
        type,
        date: p.date,
        description: `${type === 'spike' ? 'Всплеск' : 'Падение'} дохода: ${Formatters.moneyDetailed(p.income)}`,
        severity,
      })
    }

    return anomalies
  }

  // простая линейная регрессия по прибыли (по дням)
  static predictNextMonth(points: ChartPoint[]): { value: number; confidence: number } {
    const profits = points.map(p => p.profit).filter(v => v !== 0)
    if (profits.length < 7) return { value: 0, confidence: 0 }

    const x = Array.from({ length: profits.length }, (_, i) => i)
    const n = x.length

    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = profits.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((a, _, i) => a + x[i] * profits[i], 0)
    const sumXX = x.reduce((a, _, i) => a + x[i] * x[i], 0)

    const denom = n * sumXX - sumX * sumX || 1
    const slope = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n

    const next = slope * (n + 30) + intercept

    // R^2
    const yMean = sumY / n
    const ssRes = profits.reduce((acc, y, i) => acc + Math.pow(y - (slope * x[i] + intercept), 2), 0)
    const ssTot = profits.reduce((acc, y) => acc + Math.pow(y - yMean, 2), 0)
    const r2 = 1 - ssRes / (ssTot || 1)

    const confidence = Math.min(100, Math.max(0, r2 * 100))
    return { value: Math.max(0, next), confidence: Math.round(confidence * 100) / 100 }
  }

  static calculateScore(cur: FinancialTotals, prev: FinancialTotals): number {
    let score = 50

    const margin = cur.incomeTotal ? (cur.profit / cur.incomeTotal) * 100 : 0
    if (margin > 30) score += 20
    else if (margin > 20) score += 15
    else if (margin > 10) score += 10
    else if (margin > 5) score += 5
    else if (margin < 0) score -= 20

    const incomeGrowth = ((cur.incomeTotal - prev.incomeTotal) / (prev.incomeTotal || 1)) * 100
    const profitGrowth = ((cur.profit - prev.profit) / (Math.abs(prev.profit) || 1)) * 100

    if (incomeGrowth > 20) score += 12
    else if (incomeGrowth > 10) score += 8
    else if (incomeGrowth > 0) score += 4
    else if (incomeGrowth < -10) score -= 10

    if (profitGrowth > 20) score += 18
    else if (profitGrowth > 10) score += 12
    else if (profitGrowth > 0) score += 8
    else if (profitGrowth < -10) score -= 15

    const efficiency = cur.expenseTotal ? cur.incomeTotal / cur.expenseTotal : cur.incomeTotal ? 10 : 0
    if (efficiency > 2) score += 12
    else if (efficiency > 1.5) score += 8
    else if (efficiency > 1.2) score += 4
    else if (efficiency < 0.8) score -= 10

    return Math.min(100, Math.max(0, Math.round(score)))
  }
}

/* =======================
   PAGE
======================= */
export default function SmartDashboardPage() {
  // период
  const [dateFrom, setDateFrom] = useState(() => DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(() => DateUtils.todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('month')

  // фильтры / UI
  const [includeExtra, setIncludeExtra] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<'income' | 'expense' | 'profit'>('profit')
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'forecast'>('overview')
  const [showPredictions, setShowPredictions] = useState(true)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  // данные
  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // загрузка данных (берём текущий период + предыдущий период для сравнения)
  useEffect(() => {
    let alive = true

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const { prevFrom } = DateUtils.calculatePrevPeriod(dateFrom, dateTo)

        const [compRes, incRes, expRes] = await Promise.all([
          supabase.from('companies').select('id,name,code').order('name'),
          supabase
            .from('incomes')
            .select('id,date,company_id,cash_amount,kaspi_amount,card_amount,online_amount,comment')
            .gte('date', prevFrom)
            .lte('date', dateTo)
            .order('date', { ascending: false }),
          supabase
            .from('expenses')
            .select('id,date,company_id,category,cash_amount,kaspi_amount,comment')
            .gte('date', prevFrom)
            .lte('date', dateTo)
            .order('date', { ascending: false }),
        ])

        if (!alive) return

        if (compRes.error) throw new Error(compRes.error.message)
        if (incRes.error) throw new Error(incRes.error.message)
        if (expRes.error) throw new Error(expRes.error.message)

        setCompanies(compRes.data || [])
        setIncomes(incRes.data || [])
        setExpenses(expRes.data || [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [dateFrom, dateTo])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const hasExtraCompany = useMemo(
    () => companies.some(c => (c.code || '').toLowerCase() === 'extra'),
    [companies]
  )

  const isExtraCompany = useCallback(
    (companyId: string) => (companyById[companyId]?.code || '').toLowerCase() === 'extra',
    [companyById]
  )

  const companyName = useCallback((id: string) => companyById[id]?.name ?? '—', [companyById])

  const setQuickRange = useCallback((type: RangeType) => {
    const today = DateUtils.todayISO()

    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
      setRangeType('today')
      return
    }

    if (type === 'week') {
      setDateFrom(DateUtils.addDaysISO(today, -6))
      setDateTo(today)
      setRangeType('week')
      return
    }

    if (type === 'month') {
      setDateFrom(DateUtils.addDaysISO(today, -29))
      setDateTo(today)
      setRangeType('month')
      return
    }

    if (type === 'quarter') {
      const { start, end } = DateUtils.getQuarterBounds()
      setDateFrom(start)
      setDateTo(end)
      setRangeType('quarter')
      return
    }

    if (type === 'year') {
      const { start, end } = DateUtils.getYearBounds()
      setDateFrom(start)
      setDateTo(end)
      setRangeType('year')
      return
    }

    setRangeType('custom')
  }, [])

  const handleDateFrom = useCallback((v: string) => {
    setDateFrom(v)
    setRangeType('custom')
  }, [])
  const handleDateTo = useCallback((v: string) => {
    setDateTo(v)
    setRangeType('custom')
  }, [])

  const analytics = useMemo(() => {
    const { prevFrom, prevTo } = DateUtils.calculatePrevPeriod(dateFrom, dateTo)
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)

    const inCur = (d: string) => d >= dateFrom && d <= dateTo
    const inPrev = (d: string) => d >= prevFrom && d <= prevTo

    const cur: FinancialTotals = {
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
      incomeTotal: 0,

      expenseCash: 0,
      expenseKaspi: 0,
      expenseTotal: 0,

      profit: 0,

      netCash: 0,
      netNonCash: 0,
      netTotal: 0,

      incomeTxCount: 0,
      expenseTxCount: 0,
      operationsCount: 0,
      avgIncomeCheck: 0,
    }

    const prev: FinancialTotals = {
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
      incomeTotal: 0,

      expenseCash: 0,
      expenseKaspi: 0,
      expenseTotal: 0,

      profit: 0,

      netCash: 0,
      netNonCash: 0,
      netTotal: 0,

      incomeTxCount: 0,
      expenseTxCount: 0,
      operationsCount: 0,
      avgIncomeCheck: 0,
    }

    // chart base
    const map = new Map<string, ChartPoint>()
    for (const d of dates) {
      map.set(d, {
        date: d,
        formattedDate: DateUtils.formatDate(d),
        income: 0,
        expense: 0,
        profit: 0,
        movingAvg: 0,
      })
    }

    const incomeCats: Record<string, number> = {}
    const expenseCats: Record<string, number> = {}

    // incomes
    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const online = Number(r.online_amount || 0)
      const total = cash + kaspi + card + online
      if (total <= 0) continue

      const cat = (r.comment || 'Продажи').trim()
      incomeCats[cat] = (incomeCats[cat] || 0) + total

      if (inCur(r.date)) {
        cur.incomeTotal += total
        cur.incomeCash += cash
        cur.incomeKaspi += kaspi
        cur.incomeCard += card
        cur.incomeOnline += online
        cur.incomeTxCount += 1

        const p = map.get(r.date)
        if (p) p.income += total
      } else if (inPrev(r.date)) {
        prev.incomeTotal += total
        prev.incomeCash += cash
        prev.incomeKaspi += kaspi
        prev.incomeCard += card
        prev.incomeOnline += online
        prev.incomeTxCount += 1
      }
    }

    // expenses
    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const cat = (r.category || r.comment || 'Прочее').trim()
      expenseCats[cat] = (expenseCats[cat] || 0) + total

      if (inCur(r.date)) {
        cur.expenseTotal += total
        cur.expenseCash += cash
        cur.expenseKaspi += kaspi
        cur.expenseTxCount += 1

        const p = map.get(r.date)
        if (p) p.expense += total
      } else if (inPrev(r.date)) {
        prev.expenseTotal += total
        prev.expenseCash += cash
        prev.expenseKaspi += kaspi
        prev.expenseTxCount += 1
      }
    }

    const finalize = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      const nonCashIncome = t.incomeKaspi + t.incomeCard + t.incomeOnline
      t.netNonCash = nonCashIncome - t.expenseKaspi
      t.netTotal = t.profit
      t.operationsCount = t.incomeTxCount + t.expenseTxCount
      t.avgIncomeCheck = t.incomeTxCount ? t.incomeTotal / t.incomeTxCount : 0
    }
    finalize(cur)
    finalize(prev)

    // chart profit + MA
    const chartData = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
    for (const p of chartData) p.profit = p.income - p.expense

    const window = 7
    for (let i = 0; i < chartData.length; i++) {
      const start = Math.max(0, i - window + 1)
      const slice = chartData.slice(start, i + 1)
      const avg = slice.reduce((s, x) => s + x.profit, 0) / slice.length
      chartData[i].movingAvg = avg
    }

    const margin = cur.incomeTotal ? (cur.profit / cur.incomeTotal) * 100 : 0
    const efficiency = cur.expenseTotal ? cur.incomeTotal / cur.expenseTotal : cur.incomeTotal ? 10 : 0

    const profitVals = chartData.map(x => x.profit).filter(v => v !== 0)
    const incomeVals = chartData.map(x => x.income).filter(v => v !== 0)
    const expenseVals = chartData.map(x => x.expense).filter(v => v !== 0)

    const trends = {
      profit: AIAnalytics.detectTrends(profitVals.length ? profitVals : [0]),
      income: AIAnalytics.detectTrends(incomeVals.length ? incomeVals : [0]),
      expense: AIAnalytics.detectTrends(expenseVals.length ? expenseVals : [0]),
    }

    const anomalies = AIAnalytics.detectAnomalies(chartData)
    const pred = AIAnalytics.predictNextMonth(chartData)
    const score = AIAnalytics.calculateScore(cur, prev)

    const status: AIInsight['status'] =
      score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'warning' : 'critical'

    const recommendation =
      status === 'excellent'
        ? 'Отлично! Закрепляйте результат: расширение ассортимента/услуг и контроль качества.'
        : status === 'good'
          ? 'Неплохо! Упритесь в рост среднего чека и контроль топ-расходов.'
          : status === 'warning'
            ? 'Жёлтая зона: расходы начинают кусаться. Проверьте категории и убыточные дни.'
            : 'Красная зона: срочно режем лишнее и пересматриваем цены/маржу.'

    const avgDaily = chartData.length ? chartData.reduce((s, x) => s + x.profit, 0) / chartData.length : 0

    const insight: AIInsight = {
      score,
      status,
      summary: getStatusSummary(status, trends),
      recommendation,
      margin,
      efficiency,
      trends,
      anomalies: anomalies.slice(0, 3),
      predictions: {
        nextMonthProfit: pred.value,
        confidence: pred.confidence,
        recommendation: pred.confidence >= 70 ? 'Прогноз ок, можно опираться.' : 'Прогноз слабый: данных мало или шумно.',
      },
      benchmarks: {
        vsPrevPeriod: cur.profit - prev.profit,
        vsAvgDaily: avgDaily,
      },
    }

    const topIncomeCategories: CategoryData[] = Object.entries(incomeCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], i) => ({
        name,
        value,
        percentage: cur.incomeTotal ? (value / cur.incomeTotal) * 100 : 0,
        color: COLORS.chart[i % COLORS.chart.length],
      }))

    const topExpenseCategories: CategoryData[] = Object.entries(expenseCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], i) => ({
        name,
        value,
        percentage: cur.expenseTotal ? (value / cur.expenseTotal) * 100 : 0,
        color: COLORS.chart[(i + 2) % COLORS.chart.length],
      }))

    return { cur, prev, chartData, insight, topIncomeCategories, topExpenseCategories, anomaliesAll: anomalies }
  }, [companies, incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  const feedItems = useMemo(() => {
    const items: FeedItem[] = []
    const { insight } = analytics
    const anomalyDates = new Set(insight.anomalies.map(a => a.date))

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      if (amount <= 0) continue
      items.push({
        id: `inc-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'income',
        title: (r.comment || 'Продажа').trim(),
        amount,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (amount <= 0) continue
      items.push({
        id: `exp-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'expense',
        title: (r.category || r.comment || 'Расход').trim(),
        amount,
        category: r.category || undefined,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    return items.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount).slice(0, 10)
  }, [analytics, incomes, expenses, includeExtra, isExtraCompany, dateFrom, dateTo])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-6" />
              <Brain className="w-8 h-8 text-purple-400 absolute top-4 left-1/2 -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаю аналитику…</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="p-8 max-w-md text-center border-red-500/30 bg-red-950/10 backdrop-blur-sm">
            <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Ошибка загрузки</h2>
            <p className="text-gray-400 mb-6 break-words">{error}</p>
            <Button onClick={() => window.location.reload()} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30">
              Перезагрузить
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const { cur, prev, chartData, insight, topIncomeCategories, topExpenseCategories } = analytics

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto relative">
        <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
          {/* HEADER */}
          <div className="relative z-50">
            <div className="overflow-visible rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />

              <SmartHeader
                dateFrom={dateFrom}
                dateTo={dateTo}
                rangeType={rangeType}
                includeExtra={includeExtra}
                hasExtraCompany={hasExtraCompany}
                insight={insight}
                isCalendarOpen={isCalendarOpen}
                onRangeChange={setQuickRange}
                onIncludeExtraChange={setIncludeExtra}
                onDateFromChange={handleDateFrom}
                onDateToChange={handleDateTo}
                onToggleCalendar={() => setIsCalendarOpen(v => !v)}
              />
            </div>
          </div>

          {/* TABS */}
          <div className="relative z-10 space-y-6">
            <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
              <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
              <TabButton active={activeTab === 'details'} onClick={() => setActiveTab('details')} icon={<BarChart2 className="w-4 h-4" />} label="Детали" />
              <TabButton active={activeTab === 'forecast'} onClick={() => setActiveTab('forecast')} icon={<Sparkles className="w-4 h-4" />} label="Прогноз" />
            </div>

            {activeTab === 'overview' && (
              <OverviewContent
                insight={insight}
                current={cur}
                previous={prev}
                selectedMetric={selectedMetric}
                onMetricChange={setSelectedMetric}
                chartData={chartData}
                showPredictions={showPredictions}
                onTogglePredictions={() => setShowPredictions(v => !v)}
                topIncomeCategories={topIncomeCategories}
                topExpenseCategories={topExpenseCategories}
                anomalies={insight.anomalies}
                showAnomalies={showAnomalies}
                onToggleAnomalies={() => setShowAnomalies(v => !v)}
                feedItems={feedItems}
                companyName={companyName}
                dateFrom={dateFrom}
                dateTo={dateTo}
                prediction={insight.predictions}
              />
            )}

            {activeTab === 'details' && (
              <DetailsView
                current={cur}
                previous={prev}
                topIncomeCategories={topIncomeCategories}
                topExpenseCategories={topExpenseCategories}
              />
            )}

            {activeTab === 'forecast' && <ForecastView prediction={insight.predictions} chartData={chartData} trends={insight.trends} margin={insight.margin} efficiency={insight.efficiency} />}
          </div>
        </div>
      </main>
    </div>
  )
}

/* =======================
   HELPERS
======================= */
function getStatusSummary(status: AIInsight['status'], trends: AIInsight['trends']): string {
  const emoji = trends.profit === 'up' ? '📈' : trends.profit === 'down' ? '📉' : '📊'
  if (status === 'excellent') return `${emoji} Отлично: прибыль в росте, держите темп`
  if (status === 'good') return `${emoji} Хорошо: есть запас для улучшений`
  if (status === 'warning') return `${emoji} Внимание: расходы поджимают`
  return `⚠️ Критично: нужен план оптимизации`
}

/* =======================
   UI COMPONENTS
======================= */
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function SmartHeader(props: {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  includeExtra: boolean
  hasExtraCompany: boolean
  insight: AIInsight
  isCalendarOpen: boolean
  onRangeChange: (t: RangeType) => void
  onIncludeExtraChange: (v: boolean) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onToggleCalendar: () => void
}) {
  const { dateFrom, dateTo, rangeType, includeExtra, hasExtraCompany, insight, isCalendarOpen, onRangeChange, onIncludeExtraChange, onDateFromChange, onDateToChange, onToggleCalendar } =
    props

  const statusColors: Record<AIInsight['status'], string> = {
    excellent: 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-300',
    good: 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border-purple-500/30 text-purple-200',
    warning: 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30 text-yellow-200',
    critical: 'bg-gradient-to-r from-red-500/20 to-rose-500/20 border-red-500/30 text-red-200',
  }

  return (
    <div className="relative">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/20 rounded-xl">
              <Brain className="w-6 h-6 text-purple-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">AI Финансовый Дашборд</h1>
              <p className="text-xs text-gray-400">умная аналитика, без шаманства</p>
            </div>

            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border ${statusColors[insight.status]}`}>
              {insight.status === 'excellent' ? '🚀 Отлично' : insight.status === 'good' ? '✅ Хорошо' : insight.status === 'warning' ? '⚠️ Внимание' : '🔴 Критично'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={onToggleCalendar}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-purple-500/50 transition-colors"
            >
              <CalendarIcon className="w-4 h-4 text-purple-300" />
              <span className="text-gray-200">
                {DateUtils.formatDate(dateFrom, 'full')} — {DateUtils.formatDate(dateTo, 'full')}
              </span>
              <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
            </button>

            {hasExtraCompany && (
              <button
                type="button"
                onClick={() => onIncludeExtraChange(!includeExtra)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                  includeExtra ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${includeExtra ? 'bg-red-400' : 'bg-gray-500'}`} />
                {includeExtra ? 'Extra включён' : 'Extra исключён'}
              </button>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
              <Sparkles className="w-4 h-4 text-yellow-300" />
              <span className="text-gray-300">Достоверность:</span>
              <span className="font-medium text-purple-200">{insight.predictions.confidence}%</span>
            </div>
          </div>
        </div>
      </div>

      {isCalendarOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100]">
          <div className="p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl shadow-2xl">
            <DateFilters
              dateFrom={dateFrom}
              dateTo={dateTo}
              rangeType={rangeType}
              onRangeChange={onRangeChange}
              onDateFromChange={onDateFromChange}
              onDateToChange={onDateToChange}
              onClose={onToggleCalendar}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DateFilters(props: {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  onRangeChange: (t: RangeType) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onClose: () => void
}) {
  const { dateFrom, dateTo, rangeType, onRangeChange, onDateFromChange, onDateToChange, onClose } = props

  const ranges: Array<{ type: RangeType; label: string }> = [
    { type: 'today', label: 'Сегодня' },
    { type: 'week', label: 'Неделя' },
    { type: 'month', label: 'Месяц' },
    { type: 'quarter', label: 'Квартал' },
    { type: 'year', label: 'Год' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ranges.map(r => (
          <button
            key={r.type}
            type="button"
            onClick={() => onRangeChange(r.type)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
              rangeType === r.type ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-800">
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Начало</label>
          <div className="relative">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-300" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => onDateFromChange(e.target.value)}
              className="w-full bg-gray-800 text-white pl-10 pr-4 py-3 rounded-xl border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Конец</label>
          <div className="relative">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-300" />
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={e => onDateToChange(e.target.value)}
              className="w-full bg-gray-800 text-white pl-10 pr-4 py-3 rounded-xl border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onClose} className="bg-purple-500 hover:bg-purple-600 text-white">
          Применить
        </Button>
      </div>
    </div>
  )
}

/* =======================
   OVERVIEW
======================= */
function OverviewContent(props: {
  insight: AIInsight
  current: FinancialTotals
  previous: FinancialTotals
  selectedMetric: 'income' | 'expense' | 'profit'
  onMetricChange: (m: 'income' | 'expense' | 'profit') => void
  chartData: ChartPoint[]
  showPredictions: boolean
  onTogglePredictions: () => void
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
  anomalies: AIInsight['anomalies']
  showAnomalies: boolean
  onToggleAnomalies: () => void
  feedItems: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
  prediction: AIInsight['predictions']
}) {
  const {
    insight,
    current,
    previous,
    selectedMetric,
    onMetricChange,
    chartData,
    showPredictions,
    onTogglePredictions,
    topIncomeCategories,
    topExpenseCategories,
    anomalies,
    showAnomalies,
    onToggleAnomalies,
    feedItems,
    companyName,
    dateFrom,
    dateTo,
    prediction,
  } = props

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <AICard insight={insight} />
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            label="Доход"
            value={current.incomeTotal}
            previousValue={previous.incomeTotal}
            icon={<TrendingUp className="w-5 h-5" />}
            badgeColor="from-green-500 to-emerald-500"
            isSelected={selectedMetric === 'income'}
            onClick={() => onMetricChange('income')}
          />
          <MetricCard
            label="Расход"
            value={current.expenseTotal}
            previousValue={previous.expenseTotal}
            icon={<TrendingDown className="w-5 h-5" />}
            badgeColor="from-red-500 to-rose-500"
            isSelected={selectedMetric === 'expense'}
            onClick={() => onMetricChange('expense')}
          />
          <MetricCard
            label="Прибыль"
            value={current.profit}
            previousValue={previous.profit}
            icon={<Target className="w-5 h-5" />}
            badgeColor="from-purple-500 to-indigo-500"
            isSelected={selectedMetric === 'profit'}
            onClick={() => onMetricChange('profit')}
          />
        </div>
      </div>

      <AdvancedChart data={chartData} selectedMetric={selectedMetric} showPredictions={showPredictions} anomalies={anomalies} onTogglePredictions={onTogglePredictions} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CategoryPieChart title="Структура доходов" data={topIncomeCategories} total={current.incomeTotal} icon={<TrendingUp className="w-4 h-4" />} />
        <CategoryPieChart title="Структура расходов" data={topExpenseCategories} total={current.expenseTotal} icon={<TrendingDown className="w-4 h-4" />} />
        <AnomaliesCard anomalies={anomalies} isVisible={showAnomalies} onToggle={onToggleAnomalies} />
        <FeedCard feedItems={feedItems} companyName={companyName} dateFrom={dateFrom} dateTo={dateTo} />
      </div>

      <PredictionCardFull prediction={prediction} currentProfit={current.profit} insight={insight} />
    </div>
  )
}

function AICard({ insight }: { insight: AIInsight }) {
  return (
    <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/30 via-gray-900 to-indigo-900/30 backdrop-blur-sm relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500 rounded-full blur-3xl opacity-20" />
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <Brain className="w-5 h-5 text-purple-200" />
          </div>
          <span className="text-sm font-medium text-gray-300">AI Анализ</span>
        </div>

        <div className="mb-4">
          <div className="text-4xl font-bold bg-gradient-to-r from-purple-300 to-indigo-200 bg-clip-text text-transparent">{insight.score}</div>
          <div className="text-xs text-gray-500">из 100</div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Маржа</span>
              <span className="text-purple-200 font-medium">{insight.margin.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-300 to-indigo-200 rounded-full" style={{ width: `${Math.min(100, insight.margin * 2)}%` }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Эффективность</span>
              <span className="text-green-300 font-medium">{insight.efficiency.toFixed(2)}x</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-300 to-emerald-200 rounded-full" style={{ width: `${Math.min(100, insight.efficiency * 30)}%` }} />
            </div>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-400 mb-2">Рекомендация</p>
            <p className="text-sm text-gray-300">{insight.recommendation}</p>
          </div>
        </div>
      </div>
    </Card>
  )
}

function MetricCard(props: {
  label: string
  value: number
  previousValue: number
  icon: ReactNode
  badgeColor: string
  isSelected: boolean
  onClick: () => void
}) {
  const { label, value, previousValue, icon, badgeColor, isSelected, onClick } = props
  const change = Formatters.percentChange(value, previousValue)

  return (
    <Card
      onClick={onClick}
      className={`p-6 cursor-pointer transition-all border-0 bg-gray-800/50 backdrop-blur-sm hover:bg-gray-800/80 ${isSelected ? 'ring-2 ring-purple-500' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">{label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${badgeColor} bg-opacity-20`}>{icon}</div>
      </div>

      <div className="text-2xl font-bold text-white mb-2 break-all">{Formatters.moneyDetailed(value)}</div>

      <div className="flex items-center gap-2 text-xs">
        <span className={change.isPositive ? 'text-green-400' : 'text-red-400'}>{change.value}</span>
        <span className="text-gray-500">к прошлому периоду</span>
      </div>

      {isSelected && (
        <div className="mt-4 text-xs text-purple-300 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          Сейчас на графике
        </div>
      )}
    </Card>
  )
}

function AdvancedChart(props: {
  data: ChartPoint[]
  selectedMetric: 'income' | 'expense' | 'profit'
  showPredictions: boolean
  anomalies: AIInsight['anomalies']
  onTogglePredictions: () => void
}) {
  const { data, selectedMetric, showPredictions, onTogglePredictions } = props

  const metricNames = { income: 'Доход', expense: 'Расход', profit: 'Прибыль' } as const
  const metricColor = selectedMetric === 'income' ? COLORS.income : selectedMetric === 'expense' ? COLORS.expense : COLORS.profit

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <LineChart className="w-5 h-5 text-purple-200" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Динамика: {metricNames[selectedMetric]}</h3>
            <p className="text-xs text-gray-500">{data.length ? `с ${DateUtils.formatDate(data[0].date)} по ${DateUtils.formatDate(data[data.length - 1].date)}` : 'Нет данных'}</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onTogglePredictions} className="text-xs h-8 bg-gray-700/50 hover:bg-gray-700 text-gray-300">
          {showPredictions ? 'Скрыть среднюю' : 'Показать среднюю'}
        </Button>
      </div>

      {!data.length ? (
        <div className="h-80 flex items-center justify-center text-gray-500">Нет данных за выбранный период</div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.12} stroke="#374151" vertical={false} />
              <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => Formatters.moneyDetailed(v)} />

              <Tooltip {...Formatters.tooltip} formatter={(v: number) => [Formatters.moneyDetailed(v), '']} />
              <Legend />

              <Area type="monotone" dataKey={selectedMetric} name={metricNames[selectedMetric]} stroke={metricColor} strokeWidth={2} fill="url(#metricFill)" />
              {showPredictions && <Line type="monotone" dataKey="movingAvg" name="Среднее (7 дней)" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function CategoryPieChart(props: { title: string; data: CategoryData[]; total: number; icon: ReactNode }) {
  const { title, data, total, icon } = props

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl bg-gray-700/50">{icon}</div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>

      {!data.length ? (
        <div className="h-48 flex items-center justify-center text-gray-500">Нет данных</div>
      ) : (
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={58} outerRadius={80} paddingAngle={2} dataKey="value">
                  {data.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [Formatters.moneyDetailed(v), '']} contentStyle={Formatters.tooltip.contentStyle} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-32 overflow-auto">
            {data.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-gray-400 truncate max-w-[120px]">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(item.value)}</span>
                  <span className="text-gray-500">({item.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Всего</span>
              <span className="text-white font-medium">{Formatters.moneyDetailed(total)}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomaliesCard(props: { anomalies: AIInsight['anomalies']; isVisible: boolean; onToggle: () => void }) {
  const { anomalies, isVisible, onToggle } = props
  const severity: Record<'low' | 'medium' | 'high', string> = {
    high: 'bg-red-500/20 border-red-500/30 text-red-300',
    medium: 'bg-orange-500/20 border-orange-500/30 text-orange-200',
    low: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-200',
  }

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-yellow-200" />
          </div>
          <h3 className="text-sm font-semibold text-white">Аномалии</h3>
          {!!anomalies.length && <span className="px-2 py-0.5 bg-red-500/20 text-red-200 text-xs rounded-full">{anomalies.length}</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} className="text-xs h-7 bg-gray-700/50 hover:bg-gray-700 text-gray-300">
          {isVisible ? 'Скрыть' : 'Показать'}
        </Button>
      </div>

      {isVisible && (
        <div className="space-y-2 max-h-64 overflow-auto">
          {!anomalies.length ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Аномалий нет</p>
              <p className="text-xs text-gray-500">это редкость, цените 😄</p>
            </div>
          ) : (
            anomalies.map((a, i) => (
              <div key={i} className={`p-3 rounded-xl border ${severity[a.severity]}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">
                    {a.type === 'spike' ? '📈 Всплеск' : '📉 Падение'} <span className="text-[10px] opacity-75">({a.severity})</span>
                  </span>
                  <span className="text-[10px] opacity-75">{DateUtils.getRelativeDay(a.date)}</span>
                </div>
                <p className="text-xs">{a.description}</p>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  )
}

function FeedCard(props: { feedItems: FeedItem[]; companyName: (id: string) => string; dateFrom: string; dateTo: string }) {
  const { feedItems, companyName, dateFrom, dateTo } = props

  return (
    <Card className="p-0 border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-xl">
            <Activity className="w-5 h-5 text-blue-200" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Лента</h3>
            <p className="text-xs text-gray-500">последние операции</p>
          </div>
          {!!feedItems.length && <span className="ml-auto px-2 py-0.5 bg-blue-500/20 text-blue-200 text-xs rounded-full">{feedItems.length}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[300px] p-2 space-y-1">
        {!feedItems.length ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">Нет операций</p>
          </div>
        ) : (
          feedItems.map(op => <FeedItemRow key={op.id} item={op} companyName={companyName(op.company_id)} />)
        )}
      </div>

      <div className="p-3 border-t border-gray-700 bg-gray-900/50">
        <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
          <Button variant="ghost" size="sm" className="w-full text-xs h-8 text-gray-400 hover:text-white hover:bg-gray-700">
            Все операции
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function FeedItemRow({ item, companyName }: { item: FeedItem; companyName: string }) {
  const isIncome = item.kind === 'income'
  return (
    <div
      className={`group flex items-center justify-between p-3 rounded-xl transition-all ${
        item.isAnomaly ? 'bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/20' : 'hover:bg-gray-700/50'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative">
          <div className={`w-2.5 h-2.5 rounded-full ${isIncome ? 'bg-green-500 shadow-lg shadow-green-500/25' : 'bg-red-500 shadow-lg shadow-red-500/25'}`} />
          {item.isAnomaly && <AlertTriangle className="w-3 h-3 text-yellow-200 absolute -top-1 -right-2" />}
        </div>

        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-white truncate">{item.title}</span>
          <span className="text-[10px] text-gray-500 truncate">
            {companyName} • {DateUtils.getRelativeDay(item.date)}
          </span>
        </div>
      </div>

      <span className={`text-xs font-bold font-mono whitespace-nowrap ml-2 ${isIncome ? 'text-green-300' : 'text-red-300'}`}>
        {isIncome ? '+' : '-'}
        {Formatters.moneyDetailed(item.amount)}
      </span>
    </div>
  )
}

function PredictionCardFull({ prediction, currentProfit, insight }: { prediction: AIInsight['predictions']; currentProfit: number; insight: AIInsight }) {
  const change = prediction.nextMonthProfit - currentProfit
  const changePercent = currentProfit ? (change / Math.abs(currentProfit)) * 100 : 0

  return (
    <Card className="p-6 border-0 bg-gradient-to-br from-blue-900/30 via-gray-900 to-purple-900/30 backdrop-blur-sm">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-blue-200" />
            </div>
            <h3 className="text-sm font-semibold text-white">Прогноз на месяц</h3>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">Ожидаемая прибыль</p>
            <p className="text-3xl font-bold bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent">{Formatters.moneyDetailed(prediction.nextMonthProfit)}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-lg text-sm font-medium ${change >= 0 ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'}`}>
              {change >= 0 ? '↗' : '↘'} {Math.abs(changePercent).toFixed(1)}%
            </div>
            <span className="text-xs text-gray-500">к текущей прибыли</span>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-gray-400">Достоверность</span>
              <span className={prediction.confidence >= 70 ? 'text-green-300' : 'text-yellow-200'}>{prediction.confidence}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-200 to-purple-200 rounded-full" style={{ width: `${Math.min(100, Math.max(0, prediction.confidence))}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">{prediction.recommendation}</p>
          </div>
        </div>

        <div className="space-y-4 lg:border-l lg:border-r border-gray-800 lg:px-6">
          <h4 className="text-sm font-medium text-gray-300">Тренды</h4>
          <TrendRow label="Доходы" trend={insight.trends.income} />
          <TrendRow label="Расходы" trend={insight.trends.expense} invertColor />
          <TrendRow label="Прибыль" trend={insight.trends.profit} />
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium text-gray-300">Подсказки</h4>
          <HintCard
            icon={<Target className="w-4 h-4 text-purple-200" />}
            title="Маржинальность"
            text={insight.margin < 20 ? 'Маржа низкая — проверь цены/себестоимость/скидки.' : 'Маржа норм — держи и масштабируй.'}
            tint="purple"
          />
          <HintCard
            icon={<Sparkles className="w-4 h-4 text-blue-200" />}
            title="Эффективность"
            text={insight.efficiency < 1.5 ? 'Расходы высоковаты относительно доходов.' : 'Соотношение доход/расход выглядит здорово.'}
            tint="blue"
          />
          <HintCard
            icon={<TrendingUp className="w-4 h-4 text-green-200" />}
            title="Сравнение"
            text={
              insight.benchmarks.vsPrevPeriod >= 0
                ? `Прибыль выросла на ${Formatters.moneyDetailed(insight.benchmarks.vsPrevPeriod)} к прошлому периоду.`
                : `Прибыль упала на ${Formatters.moneyDetailed(Math.abs(insight.benchmarks.vsPrevPeriod))} к прошлому периоду.`
            }
            tint="green"
          />
        </div>
      </div>
    </Card>
  )
}

function TrendRow({ label, trend, invertColor = false }: { label: string; trend: 'up' | 'down' | 'stable'; invertColor?: boolean }) {
  const icon =
    trend === 'up' ? <TrendingUp className="w-4 h-4" /> : trend === 'down' ? <TrendingDown className="w-4 h-4" /> : <MinusIcon className="w-4 h-4" />

  const color =
    trend === 'stable'
      ? 'text-gray-300'
      : trend === 'up'
        ? invertColor
          ? 'text-red-200'
          : 'text-green-200'
        : invertColor
          ? 'text-green-200'
          : 'text-red-200'

  const text = trend === 'up' ? 'Растут' : trend === 'down' ? 'Падают' : 'Стабильны'

  return (
    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-xl">
      <span className="text-sm text-gray-400">{label}</span>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-sm">{text}</span>
      </div>
    </div>
  )
}

function HintCard({ icon, title, text, tint }: { icon: ReactNode; title: string; text: string; tint: 'purple' | 'blue' | 'green' }) {
  const style =
    tint === 'purple'
      ? 'bg-purple-500/10 border-purple-500/20'
      : tint === 'blue'
        ? 'bg-blue-500/10 border-blue-500/20'
        : 'bg-green-500/10 border-green-500/20'

  return (
    <div className={`p-3 ${style} border rounded-xl`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-sm font-medium text-white">{title}</span>
      </div>
      <p className="text-xs text-gray-400">{text}</p>
    </div>
  )
}

/* =======================
   DETAILS
======================= */
function DetailsView({ current, previous, topIncomeCategories, topExpenseCategories }: { current: FinancialTotals; previous: FinancialTotals; topIncomeCategories: CategoryData[]; topExpenseCategories: CategoryData[] }) {
  const paymentStats = [
    { name: 'Наличные', value: current.incomeCash, color: '#f59e0b' },
    { name: 'Kaspi', value: current.incomeKaspi, color: '#2563eb' },
    { name: 'Карта', value: current.incomeCard, color: '#7c3aed' },
    { name: 'Онлайн', value: current.incomeOnline, color: '#ec4899' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Операций" value={current.operationsCount} previousValue={previous.operationsCount} icon={<Activity className="w-4 h-4" />} />
        <StatCard label="Средний чек (доход)" value={current.avgIncomeCheck} previousValue={previous.avgIncomeCheck} icon={<DollarSign className="w-4 h-4" />} isMoney />
        <StatCard
          label="Нал / Безнал"
          value={current.incomeCash}
          secondaryValue={current.incomeKaspi + current.incomeCard + current.incomeOnline}
          icon={<Globe className="w-4 h-4" />}
          isComparison
        />
        <StatCard label="Онлайн" value={current.incomeOnline} previousValue={previous.incomeOnline} icon={<Globe className="w-4 h-4" />} isMoney />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Способы оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentStats}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v: number) => Formatters.moneyDetailed(v)} />
                <Tooltip formatter={(v: number) => Formatters.moneyDetailed(v)} contentStyle={Formatters.tooltip.contentStyle} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {paymentStats.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">ТОП категории</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MiniList title="Доходы" data={topIncomeCategories} />
            <MiniList title="Расходы" data={topExpenseCategories} />
          </div>
        </Card>
      </div>
    </div>
  )
}

function StatCard(props: {
  label: string
  value: number
  previousValue?: number
  secondaryValue?: number
  icon: ReactNode
  isMoney?: boolean
  isComparison?: boolean
}) {
  const { label, value, previousValue, secondaryValue, icon, isMoney = false, isComparison = false } = props
  const change = previousValue ? ((value - previousValue) / (previousValue || 1)) * 100 : 0

  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-gray-700/50">{icon}</div>
        <span className="text-xs text-gray-400">{label}</span>
      </div>

      {isComparison ? (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Нал:</span>
            <span className="text-white font-medium">{Formatters.moneyDetailed(value)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Безнал:</span>
            <span className="text-white font-medium">{Formatters.moneyDetailed(secondaryValue || 0)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="text-xl font-bold text-white">{isMoney ? Formatters.moneyDetailed(value) : value.toLocaleString('ru-RU')}</div>
          {previousValue !== undefined && (
            <div className="flex items-center gap-1 mt-1 text-xs">
              <span className={change >= 0 ? 'text-green-300' : 'text-red-300'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(1)}%
              </span>
              <span className="text-gray-500">к прошлому</span>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function MiniList({ title, data }: { title: string; data: CategoryData[] }) {
  return (
    <div className="p-4 bg-gray-900/40 rounded-xl border border-gray-700">
      <div className="text-xs text-gray-400 mb-3">{title}</div>
      {!data.length ? (
        <div className="text-xs text-gray-500">Нет данных</div>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 5).map((x, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: x.color }} />
                <span className="text-gray-300 truncate max-w-[140px]">{x.name}</span>
              </div>
              <span className="text-white font-medium">{Formatters.moneyDetailed(x.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* =======================
   FORECAST
======================= */
function ForecastView({ prediction, chartData, trends, margin, efficiency }: { prediction: AIInsight['predictions']; chartData: ChartPoint[]; trends: AIInsight['trends']; margin: number; efficiency: number }) {
  const last7 = chartData.slice(-7).reduce((s, d) => s + d.profit, 0)
  const prev7 = chartData.slice(-14, -7).reduce((s, d) => s + d.profit, 0)
  const weeklyGrowth = prev7 ? ((last7 - prev7) / prev7) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ForecastCard title="Тренд прибыли" value={trends.profit === 'up' ? 'Растущий' : trends.profit === 'down' ? 'Падающий' : 'Стабильный'} />
        <ForecastCard title="Недельный рост" value={`${weeklyGrowth >= 0 ? '+' : ''}${weeklyGrowth.toFixed(1)}%`} />
        <ForecastCard title="Прогноз" value={Formatters.moneyDetailed(prediction.nextMonthProfit)} />
      </div>

      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-sm font-semibold text-white mb-4">Рекомендации</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecommendationCard title="Маржинальность" description={`Текущая маржа ${margin.toFixed(1)}%. Цель: 25%`} impact="+ прибыль" />
          <RecommendationCard title="Эффективность" description={`Коэффициент ${efficiency.toFixed(2)}x. Цель: 2.0x`} impact="- расходы" />
          <RecommendationCard title="Контроль расходов" description={trends.expense === 'up' ? 'Расходы растут. Проверь топ-категории.' : 'Держите дисциплину — и будет красота.'} impact="стабильность" />
          <RecommendationCard title="Повторные продажи" description="Увеличьте частоту повторных покупок и апсейл." impact="+ LTV" />
        </div>
      </Card>
    </div>
  )
}

function ForecastCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="text-xs text-gray-400 mb-2">{title}</div>
      <div className="text-lg font-bold text-white">{value}</div>
    </Card>
  )
}

function RecommendationCard({ title, description, impact }: { title: string; description: string; impact: string }) {
  return (
    <div className="p-4 bg-gray-700/30 rounded-xl border border-gray-700 hover:border-purple-500/30 transition-colors">
      <h4 className="text-sm font-medium text-white mb-1">{title}</h4>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <div className="text-xs font-medium text-green-300">{impact}</div>
    </div>
  )
}
