'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  BarChart2,
  Brain,
  AlertTriangle,
  CheckCircle2,
  Activity,
  CalendarDays,
  DollarSign,
  Target,
  Award,
  Sparkles,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
  ArrowRight,
  LineChart,
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
} from 'recharts'

// ==================== ТИПЫ ====================

type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  comment: string | null
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type RangeType = 'today' | 'week' | 'month30' | 'currentMonth' | 'custom' | 'quarter' | 'year'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  netCash: number
  netKaspi: number
  netTotal: number
  avgCheck?: number
  transactionsCount?: number
}

type AIInsight = {
  score: number
  status: 'critical' | 'warning' | 'healthy' | 'excellent'
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
    vsLastWeek: number
    vsLastMonth: number
    vsAvg: number
  }
}

type ChartPoint = {
  date: string
  income: number
  expense: number
  profit: number
  movingAvg?: number
}

type CategoryAnalysis = {
  name: string
  amount: number
  percentage: number
  trend: 'up' | 'down' | 'stable'
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

// ==================== УТИЛИТЫ ====================

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

  formatRuDate: (iso: string): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  },

  formatRuFull: (iso: string): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },

  getCurrentMonthBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    return {
      start: DateUtils.toISODateLocal(new Date(y, m, 1)),
      end: DateUtils.toISODateLocal(new Date(y, m + 1, 0))
    }
  },

  getQuarterBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0))
    }
  },

  getYearBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31))
    }
  },

  calculatePrevPeriod: (dateFrom: string, dateTo: string) => {
    const dFrom = DateUtils.fromISO(dateFrom)
    const dTo = DateUtils.fromISO(dateTo)
    const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
    return {
      prevFrom: DateUtils.addDaysISO(dateFrom, -durationDays),
      prevTo: DateUtils.addDaysISO(dateFrom, -1),
      durationDays
    }
  },

  getDatesInRange: (from: string, to: string): string[] => {
    const dates: string[] = []
    let current = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    
    while (current <= end) {
      dates.push(DateUtils.toISODateLocal(current))
      current.setDate(current.getDate() + 1)
    }
    return dates
  }
}

const Formatters = {
  money: (v: number): string => 
    v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }),

  moneyShort: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
    return v.toString()
  },

  percent: (val: number): string => {
    const sign = val > 0 ? '+' : ''
    return `${sign}${val.toFixed(1)}%`
  },

  tooltip: {
    contentStyle: {
      backgroundColor: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: 8,
      padding: '8px 12px',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#999' },
  } as const
}

// ==================== AI-АНАЛИТИКА ====================

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

  static detectAnomalies(
    points: ChartPoint[],
    threshold: number = 2.5
  ): Array<{ type: 'spike' | 'drop' | 'unusual'; date: string; description: string; severity: 'low' | 'medium' | 'high' }> {
    const anomalies = []
    const values = points.map(p => p.income).filter(v => v > 0)
    
    if (values.length === 0) return []
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length)
    
    for (let i = 0; i < points.length; i++) {
      const point = points[i]
      if (point.income === 0) continue
      
      const zScore = Math.abs((point.income - mean) / (stdDev || 1))
      
      if (zScore > threshold) {
        const type = point.income > mean ? 'spike' : 'drop'
        const severity = zScore > 4 ? 'high' : zScore > 3 ? 'medium' : 'low'
        
        anomalies.push({
          type,
          date: point.date,
          description: `${type === 'spike' ? 'Всплеск' : 'Падение'} доходов: ${Formatters.moneyShort(point.income)}`,
          severity
        })
      }
    }
    
    return anomalies
  }

  static predictNextMonth(data: ChartPoint[]): { value: number; confidence: number } {
    if (data.length < 7) return { value: 0, confidence: 0 }
    
    const profits = data.map(d => d.profit).filter(v => v !== 0)
    if (profits.length < 3) return { value: 0, confidence: 0 }
    
    const x = Array.from({ length: profits.length }, (_, i) => i)
    
    const n = x.length
    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = profits.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((a, _, i) => a + x[i] * profits[i], 0)
    const sumXX = x.reduce((a, _, i) => a + x[i] * x[i], 0)
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1)
    const intercept = (sumY - slope * sumX) / n
    
    const nextValue = slope * (n + 30) + intercept
    
    const yMean = sumY / n
    const ssRes = profits.reduce((a, y, i) => a + Math.pow(y - (slope * x[i] + intercept), 2), 0)
    const ssTot = profits.reduce((a, y) => a + Math.pow(y - yMean, 2), 0)
    const r2 = 1 - (ssRes / (ssTot || 1))
    
    const confidence = Math.min(100, Math.max(0, r2 * 100))
    
    return {
      value: Math.max(0, nextValue),
      confidence: Math.round(confidence * 100) / 100
    }
  }

  static calculateScore(current: FinancialTotals, previous: FinancialTotals, trends: any): number {
    let score = 50
    
    const margin = current.incomeTotal > 0 ? (current.profit / current.incomeTotal) * 100 : 0
    if (margin > 30) score += 20
    else if (margin > 20) score += 15
    else if (margin > 10) score += 10
    else if (margin > 5) score += 5
    else if (margin < 0) score -= 20
    
    const incomeGrowth = ((current.incomeTotal - previous.incomeTotal) / (previous.incomeTotal || 1)) * 100
    const profitGrowth = ((current.profit - previous.profit) / (Math.abs(previous.profit) || 1)) * 100
    
    if (incomeGrowth > 20) score += 15
    else if (incomeGrowth > 10) score += 10
    else if (incomeGrowth > 0) score += 5
    else if (incomeGrowth < -10) score -= 10
    
    if (profitGrowth > 20) score += 20
    else if (profitGrowth > 10) score += 15
    else if (profitGrowth > 0) score += 10
    else if (profitGrowth < -10) score -= 15
    
    const efficiency = current.expenseTotal > 0 
      ? current.incomeTotal / current.expenseTotal 
      : current.incomeTotal > 0 ? 10 : 0
    
    if (efficiency > 2) score += 15
    else if (efficiency > 1.5) score += 10
    else if (efficiency > 1.2) score += 5
    else if (efficiency < 0.8) score -= 10
    
    return Math.min(100, Math.max(0, score))
  }
}

// ==================== ОСНОВНОЙ КОМПОНЕНТ ====================

export default function SmartDashboardPage() {
  // Состояния
  const [dateFrom, setDateFrom] = useState(() => DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('month30')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<'income' | 'expense' | 'profit'>('profit')
  const [showPredictions, setShowPredictions] = useState(true)
  const [showAnomalies, setShowAnomalies] = useState(true)

  // Данные
  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Загрузка данных
  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const { prevFrom } = DateUtils.calculatePrevPeriod(dateFrom, dateTo)

        const [
          { data: compData, error: compErr },
          { data: incomeData, error: incomeErr },
          { data: expenseData, error: expenseErr },
        ] = await Promise.all([
          supabase.from('companies').select('id,name,code').order('name'),
          supabase
            .from('incomes')
            .select('id,date,company_id,cash_amount,kaspi_amount,card_amount,comment')
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

        if (!mounted) return

        if (compErr || incomeErr || expenseErr) {
          throw new Error('Ошибка загрузки данных')
        }

        setCompanies(compData || [])
        setIncomes(incomeData || [])
        setExpenses(expenseData || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    }

    loadData()
    return () => { mounted = false }
  }, [dateFrom, dateTo])

  // Мемоизированные значения
  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    companies.forEach(c => {
      map[c.id] = c
    })
    return map
  }, [companies])

  const isExtraCompany = useCallback((companyId: string) => {
    return (companyById[companyId]?.code || '').toLowerCase() === 'extra'
  }, [companyById])

  const companyName = useCallback((id: string) => {
    return companyById[id]?.name ?? '—'
  }, [companyById])

  // Обработчики
  const setQuickRange = useCallback((type: RangeType) => {
    const today = DateUtils.todayISO()

    switch (type) {
      case 'today':
        setDateFrom(today)
        setDateTo(today)
        break
      case 'week':
        setDateFrom(DateUtils.addDaysISO(today, -6))
        setDateTo(today)
        break
      case 'month30':
        setDateFrom(DateUtils.addDaysISO(today, -29))
        setDateTo(today)
        break
      case 'currentMonth': {
        const { start, end } = DateUtils.getCurrentMonthBounds()
        setDateFrom(start)
        setDateTo(end)
        break
      }
      case 'quarter': {
        const { start, end } = DateUtils.getQuarterBounds()
        setDateFrom(start)
        setDateTo(end)
        break
      }
      case 'year': {
        const { start, end } = DateUtils.getYearBounds()
        setDateFrom(start)
        setDateTo(end)
        break
      }
      default:
        setDateFrom(today)
        setDateTo(today)
    }
    setRangeType(type)
  }, [])

  // Основная аналитика
  const analytics = useMemo(() => {
    const { prevFrom, prevTo } = DateUtils.calculatePrevPeriod(dateFrom, dateTo)
    const allDates = DateUtils.getDatesInRange(dateFrom, dateTo)

    const inCurrent = (date: string) => date >= dateFrom && date <= dateTo
    const inPrev = (date: string) => date >= prevFrom && date <= prevTo

    // Инициализация
    const current: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0,
      transactionsCount: 0
    }

    const previous: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0
    }

    // Карта для графика
    const chartMap = new Map<string, ChartPoint>()
    allDates.forEach(date => {
      chartMap.set(date, { date, income: 0, expense: 0, profit: 0 })
    })

    // Категории
    const incomeCategories: Record<string, number> = {}
    const expenseCategories: Record<string, number> = {}

    // Обработка доходов (ИСПРАВЛЕНО: используется row вместо r)
    incomes.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return

      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const card = Number(row.card_amount || 0)
      const total = cash + kaspi + card
      
      if (total <= 0) return

      const category = row.comment || 'Продажи'
      incomeCategories[category] = (incomeCategories[category] || 0) + total

      if (inCurrent(row.date)) {
        current.incomeTotal += total
        current.incomeCash += cash
        current.incomeKaspi += kaspi
        current.incomeCard += card
        current.transactionsCount!++

        const point = chartMap.get(row.date)
        if (point) point.income += total
      } else if (inPrev(row.date)) {
        previous.incomeTotal += total
        previous.incomeCash += cash
        previous.incomeKaspi += kaspi
        previous.incomeCard += card
      }
    })

    // Обработка расходов (ИСПРАВЛЕНО: используется row вместо r)
    expenses.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return

      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const total = cash + kaspi
      
      if (total <= 0) return

      const category = row.category || row.comment || 'Прочее'
      expenseCategories[category] = (expenseCategories[category] || 0) + total

      if (inCurrent(row.date)) {
        current.expenseTotal += total
        current.expenseCash += cash
        current.expenseKaspi += kaspi
        current.transactionsCount!++

        const point = chartMap.get(row.date)
        if (point) point.expense += total
      } else if (inPrev(row.date)) {
        previous.expenseTotal += total
        previous.expenseCash += cash
        previous.expenseKaspi += kaspi
      }
    })

    // Финальные расчеты
    const finalizeTotals = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      t.netKaspi = t.incomeKaspi + t.incomeCard - t.expenseKaspi
      t.netTotal = t.profit
      t.avgCheck = t.transactionsCount ? t.incomeTotal / t.transactionsCount : 0
    }

    finalizeTotals(current)
    finalizeTotals(previous)

    chartMap.forEach(point => {
      point.profit = point.income - point.expense
    })

    const chartData = Array.from(chartMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))

    // Скользящее среднее
    const windowSize = 7
    chartData.forEach((point, i) => {
      const start = Math.max(0, i - windowSize + 1)
      const window = chartData.slice(start, i + 1)
      const avg = window.reduce((sum, p) => sum + p.profit, 0) / window.length
      point.movingAvg = avg
    })

    const margin = current.incomeTotal > 0 ? (current.profit / current.incomeTotal) * 100 : 0
    const efficiency = current.expenseTotal > 0 
      ? current.incomeTotal / current.expenseTotal 
      : current.incomeTotal > 0 ? 10 : 0

    // Тренды
    const profitValues = chartData.map(d => d.profit).filter(v => v !== 0)
    const incomeValues = chartData.map(d => d.income).filter(v => v !== 0)
    const expenseValues = chartData.map(d => d.expense).filter(v => v !== 0)

    const trends = {
      profit: AIAnalytics.detectTrends(profitValues.length > 0 ? profitValues : [0]),
      income: AIAnalytics.detectTrends(incomeValues.length > 0 ? incomeValues : [0]),
      expense: AIAnalytics.detectTrends(expenseValues.length > 0 ? expenseValues : [0])
    }

    const anomalies = AIAnalytics.detectAnomalies(chartData)
    const prediction = AIAnalytics.predictNextMonth(chartData)
    const score = AIAnalytics.calculateScore(current, previous, trends)

    let status: AIInsight['status'] = 'healthy'
    if (score >= 80) status = 'excellent'
    else if (score >= 55) status = 'healthy'
    else if (score >= 35) status = 'warning'
    else status = 'critical'

    let recommendation = ''
    if (score >= 80) {
      recommendation = "Отличные результаты! Рекомендуем реинвестировать прибыль."
    } else if (score >= 60) {
      recommendation = "Хорошая работа! Оптимизируйте расходы для роста."
    } else if (score >= 40) {
      recommendation = "Требуется оптимизация. Проверьте рентабельность."
    } else {
      recommendation = "Критическая ситуация! Срочно проанализируйте расходы."
    }

    const benchmarks = {
      vsLastWeek: current.profit - previous.profit,
      vsLastMonth: current.profit - previous.profit * 4,
      vsAvg: current.profit - (chartData.reduce((sum, d) => sum + d.profit, 0) / chartData.length)
    }

    const insight: AIInsight = {
      score,
      status,
      summary: `${status === 'excellent' ? 'Отлично' : 
                status === 'healthy' ? 'Хорошо' : 
                status === 'warning' ? 'Внимание' : 'Критично'}`,
      recommendation,
      margin,
      efficiency,
      trends,
      anomalies: anomalies.slice(0, 3),
      predictions: {
        nextMonthProfit: prediction.value,
        confidence: prediction.confidence,
        recommendation: prediction.confidence > 70 ? 'Прогноз надежен' : 'Низкая достоверность'
      },
      benchmarks
    }

    const topIncomeCategories = Object.entries(incomeCategories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: (amount / current.incomeTotal) * 100,
        trend: 'stable' as const
      }))

    const topExpenseCategories = Object.entries(expenseCategories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: (amount / current.expenseTotal) * 100,
        trend: 'stable' as const
      }))

    return { 
      current, 
      previous, 
      chartData, 
      insight,
      topIncomeCategories,
      topExpenseCategories,
      anomalies
    }
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  // Лента событий
  const feedItems = useMemo(() => {
    const items: FeedItem[] = []

    incomes.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return
      if (row.date < dateFrom || row.date > dateTo) return

      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
      if (amount <= 0) return

      items.push({
        id: `inc-${row.id}`,
        date: row.date,
        company_id: row.company_id,
        kind: 'income',
        title: row.comment || 'Продажа',
        amount,
        category: 'income'
      })
    })

    expenses.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return
      if (row.date < dateFrom || row.date > dateTo) return

      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)
      if (amount <= 0) return

      items.push({
        id: `exp-${row.id}`,
        date: row.date,
        company_id: row.company_id,
        kind: 'expense',
        title: row.category || row.comment || 'Расход',
        amount,
        category: row.category || undefined
      })
    })

    const anomalyDates = new Set(analytics.anomalies.map(a => a.date))
    items.forEach(item => {
      if (anomalyDates.has(item.date)) {
        item.isAnomaly = true
      }
    })

    return items
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
      .slice(0, 10)
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany, analytics.anomalies])

  const { current, previous, chartData, insight, topIncomeCategories, topExpenseCategories } = analytics
  const hasExtraCompany = companies.some(c => (c.code || '').toLowerCase() === 'extra')

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4" />
            <p className="text-muted-foreground">Загрузка дашборда...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="p-8 max-w-md text-center border-red-500/30 bg-red-950/10">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Ошибка загрузки</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => window.location.reload()}>
              Попробовать снова
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Хедер */}
          <SmartHeader
            dateFrom={dateFrom}
            dateTo={dateTo}
            rangeType={rangeType}
            includeExtra={includeExtra}
            hasExtraCompany={hasExtraCompany}
            insight={insight}
            onRangeChange={setQuickRange}
            onIncludeExtraChange={setIncludeExtra}
            onDateFromChange={(value) => {
              setDateFrom(value)
              setRangeType('custom')
            }}
            onDateToChange={(value) => {
              setDateTo(value)
              setRangeType('custom')
            }}
          />

          {/* Инсайты */}
          <InsightDashboard
            insight={insight}
            current={current}
            previous={previous}
            onMetricChange={setSelectedMetric}
            selectedMetric={selectedMetric}
          />

          {/* Аналитика */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              <AdvancedChart
                data={chartData}
                selectedMetric={selectedMetric}
                showPredictions={showPredictions}
                anomalies={insight.anomalies}
                onTogglePredictions={() => setShowPredictions(!showPredictions)}
              />
            </div>

            <div className="lg:col-span-1 space-y-6">
              <CategoryAnalysis
                title="Топ доходов"
                categories={topIncomeCategories}
                total={current.incomeTotal}
                icon={<TrendingUp className="w-4 h-4 text-green-400" />}
              />
              
              <CategoryAnalysis
                title="Топ расходов"
                categories={topExpenseCategories}
                total={current.expenseTotal}
                icon={<TrendingDown className="w-4 h-4 text-red-400" />}
              />

              <PredictionCard
                prediction={insight.predictions}
                currentProfit={current.profit}
              />
            </div>
          </div>

          {/* Аномалии и лента */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <AnomaliesCard
              anomalies={insight.anomalies}
              isVisible={showAnomalies}
              onToggle={() => setShowAnomalies(!showAnomalies)}
            />
            
            <FeedCard
              feedItems={feedItems}
              companyName={companyName}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
            
            <BenchmarksCard
              benchmarks={insight.benchmarks}
              profit={current.profit}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

// ==================== ПОДКОМПОНЕНТЫ ====================

interface SmartHeaderProps {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  includeExtra: boolean
  hasExtraCompany: boolean
  insight: AIInsight
  onRangeChange: (type: RangeType) => void
  onIncludeExtraChange: (value: boolean) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
}

function SmartHeader({
  dateFrom,
  dateTo,
  rangeType,
  includeExtra,
  hasExtraCompany,
  insight,
  onRangeChange,
  onIncludeExtraChange,
  onDateFromChange,
  onDateToChange
}: SmartHeaderProps) {
  const statusColors = {
    excellent: 'text-green-400 border-green-500/30 bg-green-950/20',
    healthy: 'text-purple-400 border-purple-500/30 bg-purple-950/20',
    warning: 'text-yellow-400 border-yellow-500/30 bg-yellow-950/20',
    critical: 'text-red-400 border-red-500/30 bg-red-950/20',
  }

  return (
    <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="w-8 h-8 text-purple-500" />
            AI Dashboard
          </h1>
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[insight.status]}`}>
            {insight.status === 'excellent' ? 'Отличные показатели' :
             insight.status === 'healthy' ? 'Стабильно' :
             insight.status === 'warning' ? 'Требует внимания' : 'Критическая ситуация'}
          </span>
        </div>
        
        <p className="text-muted-foreground text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          AI-анализ: {insight.summary}
        </p>

        <div className="mt-2 text-[11px] text-muted-foreground flex flex-wrap items-center gap-3">
          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            <CalendarDays className="w-3 h-3 inline mr-1" />
            {DateUtils.formatRuDate(dateFrom)} — {DateUtils.formatRuDate(dateTo)}
          </span>

          {hasExtraCompany && (
            <button
              onClick={() => onIncludeExtraChange(!includeExtra)}
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                includeExtra
                  ? 'border-red-400 text-red-400 bg-red-500/10'
                  : 'border-border text-muted-foreground hover:bg-white/5'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${includeExtra ? 'bg-red-400' : 'bg-muted-foreground/50'}`} />
              {includeExtra ? 'Extra включён' : 'Extra исключён'}
            </button>
          )}

          <span className="text-[10px] text-muted-foreground">
            Достоверность прогноза: {insight.predictions.confidence}%
          </span>
        </div>
      </div>

      <DateFilters
        dateFrom={dateFrom}
        dateTo={dateTo}
        rangeType={rangeType}
        onRangeChange={onRangeChange}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
      />
    </div>
  )
}

function DateFilters({ dateFrom, dateTo, rangeType, onRangeChange, onDateFromChange, onDateToChange }: {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  onRangeChange: (type: RangeType) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
}) {
  const ranges: Array<{ type: RangeType; label: string }> = [
    { type: 'today', label: 'Сегодня' },
    { type: 'week', label: '7 дней' },
    { type: 'month30', label: '30 дней' },
    { type: 'currentMonth', label: 'Месяц' },
    { type: 'quarter', label: 'Квартал' },
    { type: 'year', label: 'Год' },
  ]

  return (
    <div className="flex flex-col items-stretch gap-2 w-full xl:w-auto">
      <div className="flex flex-col sm:flex-row items-center gap-2 w-full xl:w-auto">
        <div className="bg-card/50 border border-border/50 rounded-lg p-1 flex items-center gap-1 w-full sm:w-auto justify-center flex-wrap">
          {ranges.map(r => (
            <button
              key={r.type}
              onClick={() => onRangeChange(r.type)}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all whitespace-nowrap ${
                rangeType === r.type
                  ? 'bg-purple-600 text-white'
                  : 'hover:bg-white/5 text-muted-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-card/30 p-1 rounded-lg border border-border/30">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              onDateFromChange(e.target.value)
              onRangeChange('custom')
            }}
            className="bg-transparent text-xs text-foreground px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <span className="text-muted-foreground text-[10px]">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              onDateToChange(e.target.value)
              onRangeChange('custom')
            }}
            className="bg-transparent text-xs text-foreground px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
      </div>
    </div>
  )
}

interface InsightDashboardProps {
  insight: AIInsight
  current: FinancialTotals
  previous: FinancialTotals
  selectedMetric: 'income' | 'expense' | 'profit'
  onMetricChange: (metric: 'income' | 'expense' | 'profit') => void
}

function InsightDashboard({ insight, current, previous, selectedMetric, onMetricChange }: InsightDashboardProps) {
  const metrics = [
    { key: 'profit' as const, label: 'Прибыль', value: current.profit, change: current.profit - previous.profit, icon: <Target className="w-4 h-4" /> },
    { key: 'income' as const, label: 'Доход', value: current.incomeTotal, change: current.incomeTotal - previous.incomeTotal, icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'expense' as const, label: 'Расход', value: current.expenseTotal, change: current.expenseTotal - previous.expenseTotal, icon: <TrendingDown className="w-4 h-4" /> },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <Card className="lg:col-span-1 p-6 border relative overflow-hidden bg-gradient-to-br from-purple-950/20 to-transparent border-purple-500/30">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium">AI Анализ</span>
          </div>

          <div className="text-3xl font-bold mb-2">{insight.score}</div>
          <div className="text-xs text-muted-foreground mb-4">из 100</div>

          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Маржа</div>
              <div className="text-lg font-semibold">{insight.margin.toFixed(1)}%</div>
              <div className="w-full h-1 bg-white/10 rounded-full mt-1">
                <div 
                  className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, insight.margin * 2))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Эффективность</div>
              <div className="text-lg font-semibold">{insight.efficiency.toFixed(2)}x</div>
            </div>

            <div className="pt-2 border-t border-white/10">
              <p className="text-xs text-muted-foreground">Рекомендация</p>
              <p className="text-sm mt-1">{insight.recommendation}</p>
            </div>
          </div>
        </div>

        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 -mr-20 -mt-20" />
      </Card>

      <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
        {metrics.map(metric => {
          const isSelected = selectedMetric === metric.key
          const changePercent = previous[metric.key] 
            ? ((metric.change / (previous[metric.key] || 1)) * 100).toFixed(1)
            : '0'

          return (
            <Card
              key={metric.key}
              className={`p-6 cursor-pointer transition-all hover:border-purple-500/50 ${
                isSelected ? 'border-purple-500 bg-purple-500/5' : 'border-border'
              }`}
              onClick={() => onMetricChange(metric.key)}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">{metric.label}</span>
                {metric.icon}
              </div>
              <div className="text-2xl font-bold mb-1">{Formatters.money(metric.value)} ₸</div>
              <div className="flex items-center gap-2 text-xs">
                <span className={metric.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {metric.change >= 0 ? '+' : ''}{Formatters.money(metric.change)} ₸
                </span>
                <span className="text-muted-foreground">({changePercent}%)</span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

interface AdvancedChartProps {
  data: ChartPoint[]
  selectedMetric: 'income' | 'expense' | 'profit'
  showPredictions: boolean
  anomalies: AIInsight['anomalies']
  onTogglePredictions: () => void
}

function AdvancedChart({ data, selectedMetric, showPredictions, anomalies, onTogglePredictions }: AdvancedChartProps) {
  const metricColors = {
    income: '#22c55e',
    expense: '#ef4444',
    profit: '#a855f7'
  }

  const metricNames = {
    income: 'Доход',
    expense: 'Расход',
    profit: 'Прибыль'
  }

  return (
    <Card className="p-6 border-border bg-card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <LineChart className="w-4 h-4 text-purple-500" />
          Динамика {metricNames[selectedMetric].toLowerCase()}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePredictions}
          className="text-xs h-8"
        >
          {showPredictions ? 'Скрыть прогноз' : 'Показать прогноз'}
        </Button>
      </div>

      {data.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-muted-foreground">
          Нет данных за выбранный период
        </div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColors[selectedMetric]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={metricColors[selectedMetric]} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#444" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#666"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                stroke="#666"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => Formatters.moneyShort(v)}
              />
              <Tooltip
                {...Formatters.tooltip}
                formatter={(val: number) => [Formatters.money(val) + ' ₸', '']}
                labelFormatter={(label: string) => DateUtils.formatRuFull(label)}
              />
              <Legend />

              <Area
                type="monotone"
                dataKey={selectedMetric}
                name={metricNames[selectedMetric]}
                stroke={metricColors[selectedMetric]}
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorMetric)"
              />

              <Line
                type="monotone"
                dataKey="movingAvg"
                name="Среднее (7 дней)"
                stroke="#fbbf24"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 5"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function CategoryAnalysis({ title, categories, total, icon }: { 
  title: string
  categories: CategoryAnalysis[]
  total: number
  icon: React.ReactNode 
}) {
  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>

      <div className="space-y-3">
        {categories.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Нет данных</p>
        ) : (
          categories.map((cat, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground truncate max-w-[120px]">{cat.name}</span>
                <span className="font-medium">{Formatters.moneyShort(cat.amount)}</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    title.includes('Доход') ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, cat.percentage)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>{cat.percentage.toFixed(1)}%</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function PredictionCard({ prediction, currentProfit }: { 
  prediction: AIInsight['predictions']
  currentProfit: number 
}) {
  const change = prediction.nextMonthProfit - currentProfit
  const changePercent = currentProfit ? (change / Math.abs(currentProfit)) * 100 : 0

  return (
    <Card className="p-4 border-border bg-gradient-to-br from-blue-950/20 to-transparent">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold">AI Прогноз</h3>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Ожидаемая прибыль через месяц</p>
          <p className="text-2xl font-bold text-blue-400">
            {Formatters.money(prediction.nextMonthProfit)} ₸
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {change >= 0 ? '+' : ''}{Formatters.percent(changePercent)}
          </span>
          <span className="text-xs text-muted-foreground">от текущей</span>
        </div>

        <div className="pt-2 border-t border-white/10">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Достоверность</span>
            <span className={prediction.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>
              {prediction.confidence}%
            </span>
          </div>
          <div className="w-full h-1 bg-white/10 rounded-full">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${prediction.confidence}%` }}
            />
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground mt-2">
          {prediction.recommendation}
        </p>
      </div>
    </Card>
  )
}

function AnomaliesCard({ anomalies, isVisible, onToggle }: { 
  anomalies: AIInsight['anomalies']
  isVisible: boolean
  onToggle: () => void
}) {
  const severityColors = {
    high: 'bg-red-500/20 border-red-500/30 text-red-400',
    medium: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
    low: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
  }

  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-semibold">Аномалии</h3>
          {anomalies.length > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full">
              {anomalies.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} className="h-6 text-xs">
          {isVisible ? 'Скрыть' : 'Показать'}
        </Button>
      </div>

      {isVisible && (
        <div className="space-y-2">
          {anomalies.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              ✓ Аномалий не обнаружено
            </p>
          ) : (
            anomalies.map((anomaly, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border ${severityColors[anomaly.severity]}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">
                    {anomaly.type === 'spike' ? 'Всплеск' : 'Падение'}
                  </span>
                  <span className="text-[10px] opacity-75">
                    {DateUtils.formatRuDate(anomaly.date)}
                  </span>
                </div>
                <p className="text-xs">{anomaly.description}</p>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  )
}

function BenchmarksCard({ benchmarks, profit }: { 
  benchmarks: AIInsight['benchmarks']
  profit: number
}) {
  const items = [
    { label: 'К прошлой неделе', value: benchmarks.vsLastWeek, icon: <CalendarDays className="w-3 h-3" /> },
    { label: 'К прошлому месяцу', value: benchmarks.vsLastMonth, icon: <CalendarDays className="w-3 h-3" /> },
    { label: 'К среднему', value: benchmarks.vsAvg, icon: <Activity className="w-3 h-3" /> },
  ]

  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-center gap-2 mb-4">
        <Award className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold">Сравнение</h3>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const isPositive = item.value >= 0
          return (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                {item.icon}
                {item.label}
              </span>
              <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
                {isPositive ? '+' : ''}{Formatters.moneyShort(item.value)}
              </span>
            </div>
          )
        })}

        <div className="pt-2 border-t border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Средний чек</span>
            <span className="font-medium">{Formatters.moneyShort(profit / 30)}</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function FeedCard({ feedItems, companyName, dateFrom, dateTo }: {
  feedItems: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}) {
  return (
    <Card className="p-0 border-border bg-card overflow-hidden flex flex-col">
      <div className="p-4 border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Лента событий</h3>
          {feedItems.length > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full">
              {feedItems.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[300px] p-2 space-y-1">
        {feedItems.length === 0 ? (
          <p className="text-xs text-center p-4 text-muted-foreground">
            Нет операций
          </p>
        ) : (
          feedItems.map((op) => (
            <FeedItemRow
              key={op.id}
              item={op}
              companyName={companyName(op.company_id)}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t border-white/5 bg-white/[0.02]">
        <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-8 text-muted-foreground hover:text-white group"
          >
            Все операции
            <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function FeedItemRow({ item, companyName }: { item: FeedItem; companyName: string }) {
  const isIncome = item.kind === 'income'
  
  return (
    <div className={`group flex items-center justify-between p-2.5 rounded-lg transition-colors ${
      item.isAnomaly ? 'bg-yellow-500/5 hover:bg-yellow-500/10' : 'hover:bg-white/5'
    }`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative">
          <div
            className={`w-2 h-2 rounded-full ${
              isIncome
                ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
            }`}
          />
          {item.isAnomaly && (
            <AlertTriangle className="w-3 h-3 text-yellow-400 absolute -top-1 -right-1" />
          )}
        </div>
        
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium truncate">
            {item.title}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {companyName} • {DateUtils.formatRuDate(item.date)}
          </span>
        </div>
      </div>

      <span
        className={`text-xs font-bold font-mono whitespace-nowrap ml-2 ${
          isIncome ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {isIncome ? '+' : '-'}
        {Formatters.moneyShort(item.amount)}
      </span>
    </div>
  )
}
