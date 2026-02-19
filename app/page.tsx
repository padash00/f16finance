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
  Sparkles,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
  ArrowRight,
  LineChart,
  Wallet,
  CreditCard,
  MinusIcon,
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
  Bar,
  BarChart,
  Cell,
  PieChart as RePieChart,
  Pie,
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

type RangeType = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

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
  formattedDate?: string
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

  formatDate: (iso: string, format: 'short' | 'full' = 'short'): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    
    if (format === 'short') {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },

  getRelativeDay: (iso: string): string => {
    const today = DateUtils.fromISO(DateUtils.todayISO())
    const date = DateUtils.fromISO(iso)
    const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Сегодня'
    if (diffDays === 1) return 'Вчера'
    if (diffDays < 7) return `${diffDays} дня назад`
    return DateUtils.formatDate(iso)
  },

  getPeriodLabel: (type: RangeType): string => {
    const labels = {
      today: 'Сегодня',
      week: 'Последние 7 дней',
      month: 'Последние 30 дней',
      quarter: 'Текущий квартал',
      year: 'Текущий год',
      custom: 'Произвольный период'
    }
    return labels[type] || 'Период'
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
  money: (v: number): string => {
    if (v >= 1_000_000) {
      return (v / 1_000_000).toFixed(1) + ' млн ₸'
    }
    if (v >= 1_000) {
      return (v / 1_000).toFixed(1) + ' тыс ₸'
    }
    return v.toLocaleString('ru-RU') + ' ₸'
  },

  moneyShort: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
    return v.toString()
  },

  percent: (val: number): string => {
    const sign = val > 0 ? '+' : ''
    return `${sign}${val.toFixed(1)}%`
  },

  percentChange: (current: number, previous: number): { value: string; isPositive: boolean } => {
    if (previous === 0) {
      return { value: '—', isPositive: true }
    }
    const change = ((current - previous) / Math.abs(previous)) * 100
    return {
      value: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      isPositive: change >= 0
    }
  },

  trendIcon: (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up': return <TrendUpIcon className="w-3 h-3 text-green-400" />
      case 'down': return <TrendDownIcon className="w-3 h-3 text-red-400" />
      default: return <MinusIcon className="w-3 h-3 text-gray-400" />
    }
  },

  tooltip: {
    contentStyle: {
      backgroundColor: '#1e1e2f',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: 12,
      padding: '12px 16px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#a0a0c0', fontSize: 12 },
  } as const
}

const COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
  kaspi: '#2563eb',
  card: '#7c3aed',
  cash: '#f59e0b',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6'],
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
          description: `${type === 'spike' ? 'Всплеск' : 'Падение'}: ${Formatters.moneyShort(point.income)}`,
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

  static calculateScore(current: FinancialTotals, previous: FinancialTotals): number {
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
  const [rangeType, setRangeType] = useState<RangeType>('month')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<'income' | 'expense' | 'profit'>('profit')
  const [showPredictions, setShowPredictions] = useState(true)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'forecast'>('overview')

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
      case 'month':
        setDateFrom(DateUtils.addDaysISO(today, -29))
        setDateTo(today)
        break
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
      chartMap.set(date, { 
        date, 
        income: 0, 
        expense: 0, 
        profit: 0,
        formattedDate: DateUtils.formatDate(date)
      })
    })

    // Категории
    const incomeCategories: Record<string, number> = {}
    const expenseCategories: Record<string, number> = {}

    // Обработка доходов
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

    // Обработка расходов
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
    const score = AIAnalytics.calculateScore(current, previous)

    let status: AIInsight['status'] = 'good'
    if (score >= 80) status = 'excellent'
    else if (score >= 60) status = 'good'
    else if (score >= 40) status = 'warning'
    else status = 'critical'

    let recommendation = ''
    if (score >= 80) {
      recommendation = "Отличные результаты! Рекомендуем реинвестировать прибыль в развитие и масштабирование."
    } else if (score >= 60) {
      recommendation = "Хорошая работа! Оптимизируйте расходы и работайте над увеличением среднего чека."
    } else if (score >= 40) {
      recommendation = "Требуется оптимизация. Проверьте рентабельность и проанализируйте основные статьи расходов."
    } else {
      recommendation = "Критическая ситуация! Срочно проанализируйте каждую статью расходов и пересмотрите ценообразование."
    }

    const benchmarks = {
      vsLastWeek: current.profit - previous.profit,
      vsLastMonth: current.profit - previous.profit * 4,
      vsAvg: current.profit - (chartData.reduce((sum, d) => sum + d.profit, 0) / chartData.length)
    }

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
        nextMonthProfit: prediction.value,
        confidence: prediction.confidence,
        recommendation: prediction.confidence > 70 ? 'Прогноз достаточно надежен' : 'Низкая достоверность прогноза'
      },
      benchmarks
    }

    // Форматирование категорий для графиков
    const topIncomeCategories: CategoryData[] = Object.entries(incomeCategories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], index) => ({
        name,
        value,
        percentage: (value / current.incomeTotal) * 100,
        color: COLORS.chart[index % COLORS.chart.length]
      }))

    const topExpenseCategories: CategoryData[] = Object.entries(expenseCategories)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], index) => ({
        name,
        value,
        percentage: (value / current.expenseTotal) * 100,
        color: COLORS.chart[index % COLORS.chart.length]
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
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-6" />
              <Brain className="w-8 h-8 text-purple-400 absolute top-4 left-1/2 transform -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаем вашу финансовую аналитику...</p>
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
            <p className="text-gray-400 mb-6">{error}</p>
            <Button 
              onClick={() => window.location.reload()}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
            >
              Попробовать снова
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Хедер */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20" />
            
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
          </div>

          {/* Табы навигации */}
          <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
            <TabButton 
              active={activeTab === 'overview'} 
              onClick={() => setActiveTab('overview')}
              icon={<Activity className="w-4 h-4" />}
              label="Обзор"
            />
            <TabButton 
              active={activeTab === 'details'} 
              onClick={() => setActiveTab('details')}
              icon={<BarChart2 className="w-4 h-4" />}
              label="Детали"
            />
            <TabButton 
              active={activeTab === 'forecast'} 
              onClick={() => setActiveTab('forecast')}
              icon={<Sparkles className="w-4 h-4" />}
              label="Прогноз"
            />
          </div>

          {/* Контент в зависимости от таба */}
          {activeTab === 'overview' && (
            <OverviewContent
              insight={insight}
              current={current}
              previous={previous}
              selectedMetric={selectedMetric}
              onMetricChange={setSelectedMetric}
              chartData={chartData}
              showPredictions={showPredictions}
              onTogglePredictions={() => setShowPredictions(!showPredictions)}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
              anomalies={insight.anomalies}
              showAnomalies={showAnomalies}
              onToggleAnomalies={() => setShowAnomalies(!showAnomalies)}
              feedItems={feedItems}
              companyName={companyName}
              dateFrom={dateFrom}
              dateTo={dateTo}
              prediction={insight.predictions}
            />
          )}

          {activeTab === 'details' && (
            <DetailsView
              current={current}
              previous={previous}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
              chartData={chartData}
            />
          )}

          {activeTab === 'forecast' && (
            <ForecastView
              prediction={insight.predictions}
              chartData={chartData}
              trends={insight.trends}
              margin={insight.margin}
              efficiency={insight.efficiency}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function getStatusSummary(status: AIInsight['status'], trends: AIInsight['trends']): string {
  const trendEmoji = trends.profit === 'up' ? '📈' : trends.profit === 'down' ? '📉' : '📊'
  
  switch (status) {
    case 'excellent':
      return `${trendEmoji} Отличная динамика! Прибыль растет, все показатели в зеленой зоне`
    case 'good':
      return `${trendEmoji} Хорошие показатели, но есть потенциал для улучшения`
    case 'warning':
      return `${trendEmoji} Требуется внимание: расходы растут быстрее доходов`
    case 'critical':
      return `⚠️ Критическая ситуация: срочно требуется оптимизация`
    default:
      return 'Анализ финансовых показателей'
  }
}

// ==================== КОМПОНЕНТЫ ====================

interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

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
    excellent: 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400',
    good: 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border-purple-500/30 text-purple-400',
    warning: 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30 text-yellow-400',
    critical: 'bg-gradient-to-r from-red-500/20 to-rose-500/20 border-red-500/30 text-red-400',
  }

  return (
    <div className="relative z-10 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <Brain className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              AI Финансовый Дашборд
            </h1>
            <p className="text-xs text-gray-400">Умная аналитика вашего бизнеса</p>
          </div>
          <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border ${statusColors[insight.status]}`}>
            {insight.status === 'excellent' ? '🚀 Отлично' :
             insight.status === 'good' ? '✅ Хорошо' :
             insight.status === 'warning' ? '⚠️ Внимание' : '🔴 Критично'}
          </span>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
            <CalendarDays className="w-4 h-4 text-purple-400" />
            <span className="text-gray-300">{DateUtils.formatDate(dateFrom)} — {DateUtils.formatDate(dateTo)}</span>
            <span className="text-xs px-1.5 py-0.5 bg-gray-700 rounded-full text-gray-400">
              {DateUtils.getPeriodLabel(rangeType)}
            </span>
          </div>

          {hasExtraCompany && (
            <button
              onClick={() => onIncludeExtraChange(!includeExtra)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                includeExtra
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700/50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${includeExtra ? 'bg-red-400' : 'bg-gray-500'}`} />
              {includeExtra ? 'Extra включён' : 'Extra исключён'}
            </button>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-300">Достоверность прогноза:</span>
            <span className="font-medium text-purple-400">{insight.predictions.confidence}%</span>
          </div>
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
    { type: 'today', label: 'День' },
    { type: 'week', label: 'Неделя' },
    { type: 'month', label: 'Месяц' },
    { type: 'quarter', label: 'Квартал' },
    { type: 'year', label: 'Год' },
  ]

  return (
    <div className="flex flex-col items-stretch gap-2 w-full xl:w-auto">
      <div className="flex flex-col sm:flex-row items-center gap-2">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-1 flex items-center gap-1">
          {ranges.map(r => (
            <button
              key={r.type}
              onClick={() => onRangeChange(r.type)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                rangeType === r.type
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-gray-800/50 p-1 rounded-xl border border-gray-700">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              onDateFromChange(e.target.value)
              onRangeChange('custom')
            }}
            className="bg-transparent text-xs text-gray-300 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <span className="text-gray-500">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              onDateToChange(e.target.value)
              onRangeChange('custom')
            }}
            className="bg-transparent text-xs text-gray-300 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
      </div>
    </div>
  )
}

// ==================== КОМПОНЕНТЫ ДЛЯ OVERVIEW ====================

interface OverviewContentProps {
  insight: AIInsight
  current: FinancialTotals
  previous: FinancialTotals
  selectedMetric: 'income' | 'expense' | 'profit'
  onMetricChange: (metric: 'income' | 'expense' | 'profit') => void
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
}

function OverviewContent({
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
}: OverviewContentProps) {
  return (
    <div className="space-y-6">
      {/* Верхний ряд: AI карточка + 3 метрики */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* AI карточка */}
        <AICard insight={insight} />
        
        {/* Три метрики */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            label="Доход"
            value={current.incomeTotal}
            previousValue={previous.incomeTotal}
            icon={<TrendingUp className="w-5 h-5" />}
            color="from-green-500 to-emerald-500"
            isSelected={selectedMetric === 'income'}
            onClick={() => onMetricChange('income')}
          />
          <MetricCard
            label="Расход"
            value={current.expenseTotal}
            previousValue={previous.expenseTotal}
            icon={<TrendingDown className="w-5 h-5" />}
            color="from-red-500 to-rose-500"
            isSelected={selectedMetric === 'expense'}
            onClick={() => onMetricChange('expense')}
          />
          <MetricCard
            label="Прибыль"
            value={current.profit}
            previousValue={previous.profit}
            icon={<Target className="w-5 h-5" />}
            color="from-purple-500 to-indigo-500"
            isSelected={selectedMetric === 'profit'}
            onClick={() => onMetricChange('profit')}
          />
        </div>
      </div>

      {/* Средний ряд: график + категории */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* График */}
        <div className="lg:col-span-2">
          <AdvancedChart
            data={chartData}
            selectedMetric={selectedMetric}
            showPredictions={showPredictions}
            anomalies={anomalies}
            onTogglePredictions={onTogglePredictions}
          />
        </div>

        {/* Категории */}
        <div className="space-y-6">
          <CategoryPieChart
            title="Структура доходов"
            data={topIncomeCategories}
            total={current.incomeTotal}
            icon={<TrendingUp className="w-4 h-4" />}
            color="#10b981"
          />
          <CategoryPieChart
            title="Структура расходов"
            data={topExpenseCategories}
            total={current.expenseTotal}
            icon={<TrendingDown className="w-4 h-4" />}
            color="#ef4444"
          />
        </div>
      </div>

      {/* Нижний ряд: три карточки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AnomaliesCard
          anomalies={anomalies}
          isVisible={showAnomalies}
          onToggle={onToggleAnomalies}
        />
        <FeedCard
          feedItems={feedItems}
          companyName={companyName}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
        <PredictionCard
          prediction={prediction}
          currentProfit={current.profit}
        />
      </div>
    </div>
  )
}

function AICard({ insight }: { insight: AIInsight }) {
  return (
    <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/30 via-gray-900 to-indigo-900/30 backdrop-blur-sm relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500 rounded-full blur-3xl opacity-20" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <span className="text-sm font-medium text-gray-300">AI Анализ</span>
        </div>

        <div className="mb-4">
          <div className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
            {insight.score}
          </div>
          <div className="text-xs text-gray-500">из 100</div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Маржа</span>
              <span className="text-purple-400 font-medium">{insight.margin.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-400 to-indigo-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, insight.margin * 2)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Эффективность</span>
              <span className="text-green-400 font-medium">{insight.efficiency.toFixed(2)}x</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-green-400 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, insight.efficiency * 30)}%` }}
              />
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

function MetricCard({ 
  label, 
  value, 
  previousValue, 
  icon, 
  color, 
  isSelected, 
  onClick 
}: { 
  label: string
  value: number
  previousValue: number
  icon: React.ReactNode
  color: string
  isSelected: boolean
  onClick: () => void
}) {
  const change = Formatters.percentChange(value, previousValue)

  return (
    <Card
      className={`p-6 cursor-pointer transition-all border-0 bg-gray-800/50 backdrop-blur-sm hover:bg-gray-800/80 ${
        isSelected ? 'ring-2 ring-purple-500' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">{label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color} bg-opacity-20`}>
          {icon}
        </div>
      </div>
      
      <div className="text-2xl font-bold text-white mb-2">
        {Formatters.money(value)}
      </div>
      
      <div className="flex items-center gap-2 text-xs">
        <span className={change.isPositive ? 'text-green-400' : 'text-red-400'}>
          {change.value}
        </span>
        <span className="text-gray-500">к прошлому периоду</span>
      </div>

      {isSelected && (
        <div className="mt-4 text-xs text-purple-400 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          Отображается на графике
        </div>
      )}
    </Card>
  )
}

function AdvancedChart({ data, selectedMetric, showPredictions, anomalies, onTogglePredictions }: {
  data: ChartPoint[]
  selectedMetric: 'income' | 'expense' | 'profit'
  showPredictions: boolean
  anomalies: AIInsight['anomalies']
  onTogglePredictions: () => void
}) {
  const metricColors = {
    income: '#10b981',
    expense: '#ef4444',
    profit: '#8b5cf6'
  }

  const metricNames = {
    income: 'Доход',
    expense: 'Расход',
    profit: 'Прибыль'
  }

  const chartData = data.map(point => ({
    ...point,
    formattedDate: DateUtils.formatDate(point.date)
  }))

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <LineChart className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              Динамика {metricNames[selectedMetric].toLowerCase()}
            </h3>
            <p className="text-xs text-gray-500">
              {data.length > 0 ? `с ${DateUtils.formatDate(data[0]?.date)} по ${DateUtils.formatDate(data[data.length - 1]?.date)}` : 'Нет данных'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePredictions}
          className="text-xs h-8 bg-gray-700/50 hover:bg-gray-700 text-gray-300"
        >
          {showPredictions ? 'Скрыть прогноз' : 'Показать прогноз'}
        </Button>
      </div>

      {data.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-gray-500">
          Нет данных за выбранный период
        </div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id={`gradient-${selectedMetric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColors[selectedMetric]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={metricColors[selectedMetric]} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" vertical={false} />
              <XAxis
                dataKey="formattedDate"
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => Formatters.moneyShort(v)}
              />
              <Tooltip
                {...Formatters.tooltip}
                formatter={(val: number) => [Formatters.money(val), '']}
                labelFormatter={(label: string) => label}
              />
              <Legend />

              <Area
                type="monotone"
                dataKey={selectedMetric}
                name={metricNames[selectedMetric]}
                stroke={metricColors[selectedMetric]}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#gradient-${selectedMetric})`}
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

function CategoryPieChart({ title, data, total, icon, color }: {
  title: string
  data: CategoryData[]
  total: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl" style={{ backgroundColor: `${color}20` }}>
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-500">
          Нет данных
        </div>
      ) : (
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [Formatters.money(value), '']}
                  contentStyle={Formatters.tooltip.contentStyle}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            {data.map((item, index) => (
              <div key={index} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-gray-400 truncate max-w-[100px]">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyShort(item.value)}</span>
                  <span className="text-gray-500">({item.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Всего</span>
              <span className="text-white font-medium">{Formatters.money(total)}</span>
            </div>
          </div>
        </div>
      )}
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
    <Card className="p-6 border-0 bg-gradient-to-br from-blue-900/30 via-gray-900 to-purple-900/30 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-blue-500/20 rounded-xl">
          <Sparkles className="w-5 h-5 text-blue-400" />
        </div>
        <h3 className="text-sm font-semibold text-white">AI Прогноз на месяц</h3>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-xs text-gray-400 mb-1">Ожидаемая прибыль</p>
          <p className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            {Formatters.money(prediction.nextMonthProfit)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 rounded-lg text-xs font-medium ${
            change >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {change >= 0 ? '↗' : '↘'} {Math.abs(changePercent).toFixed(1)}%
          </div>
          <span className="text-xs text-gray-500">от текущей</span>
        </div>

        <div className="pt-4 border-t border-gray-700">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-gray-400">Достоверность прогноза</span>
            <span className={prediction.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>
              {prediction.confidence}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-purple-400 rounded-full transition-all duration-500"
              style={{ width: `${prediction.confidence}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-2">
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
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Аномалии</h3>
          {anomalies.length > 0 && (
            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
              {anomalies.length}
            </span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onToggle}
          className="text-xs h-7 bg-gray-700/50 hover:bg-gray-700 text-gray-300"
        >
          {isVisible ? 'Скрыть' : 'Показать'}
        </Button>
      </div>

      {isVisible && (
        <div className="space-y-2">
          {anomalies.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Аномалий не обнаружено</p>
              <p className="text-xs text-gray-500">Все показатели в норме</p>
            </div>
          ) : (
            anomalies.map((anomaly, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border ${severityColors[anomaly.severity]}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium flex items-center gap-1">
                    {anomaly.type === 'spike' ? '📈 Всплеск' : '📉 Падение'}
                    <span className="text-[10px] opacity-75 ml-1">
                      ({anomaly.severity === 'high' ? 'высокий' : anomaly.severity === 'medium' ? 'средний' : 'низкий'} риск)
                    </span>
                  </span>
                  <span className="text-[10px] opacity-75">
                    {DateUtils.getRelativeDay(anomaly.date)}
                  </span>
                </div>
                <p className="text-sm">{anomaly.description}</p>
              </div>
            ))
          )}
        </div>
      )}
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
    <Card className="p-0 border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-xl">
            <Clock className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Лента событий</h3>
            <p className="text-xs text-gray-500">Последние операции</p>
          </div>
          {feedItems.length > 0 && (
            <span className="ml-auto px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
              {feedItems.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[300px] p-2 space-y-1">
        {feedItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">Нет операций</p>
          </div>
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

      <div className="p-3 border-t border-gray-700 bg-gray-900/50">
        <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-8 text-gray-400 hover:text-white hover:bg-gray-700 group"
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
    <div className={`group flex items-center justify-between p-3 rounded-xl transition-all ${
      item.isAnomaly 
        ? 'bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/20' 
        : 'hover:bg-gray-700/50'
    }`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isIncome
                ? 'bg-green-500 shadow-lg shadow-green-500/25'
                : 'bg-red-500 shadow-lg shadow-red-500/25'
            }`}
          />
          {item.isAnomaly && (
            <AlertTriangle className="w-3 h-3 text-yellow-400 absolute -top-1 -right-2" />
          )}
        </div>
        
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-white truncate">
            {item.title}
          </span>
          <span className="text-[10px] text-gray-500 truncate">
            {companyName} • {DateUtils.getRelativeDay(item.date)}
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

// ==================== КОМПОНЕНТЫ ДЛЯ DETAILS ====================

function DetailsView({ current, previous, topIncomeCategories, topExpenseCategories, chartData }: {
  current: FinancialTotals
  previous: FinancialTotals
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
  chartData: ChartPoint[]
}) {
  const paymentStats = [
    { name: 'Наличные', value: current.incomeCash, color: '#f59e0b' },
    { name: 'Kaspi', value: current.incomeKaspi, color: '#2563eb' },
    { name: 'Карта', value: current.incomeCard, color: '#7c3aed' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Всего транзакций"
          value={current.transactionsCount || 0}
          previousValue={previous.transactionsCount || 0}
          icon={<Activity className="w-4 h-4" />}
          color="from-purple-500 to-indigo-500"
        />
        <StatCard
          label="Средний чек"
          value={current.avgCheck || 0}
          previousValue={previous.avgCheck || 0}
          icon={<DollarSign className="w-4 h-4" />}
          color="from-green-500 to-emerald-500"
          isMoney
        />
        <StatCard
          label="Нал vs Безнал"
          value={current.incomeCash}
          secondaryValue={current.incomeKaspi + current.incomeCard}
          icon={<Wallet className="w-4 h-4" />}
          color="from-blue-500 to-cyan-500"
          isComparison
        />
        <StatCard
          label="Kaspi переводы"
          value={current.incomeKaspi}
          previousValue={previous.incomeKaspi}
          icon={<CreditCard className="w-4 h-4" />}
          color="from-orange-500 to-red-500"
          isMoney
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Способы оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentStats}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.moneyShort(v)} />
                <Tooltip formatter={(v: number) => Formatters.money(v)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {paymentStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Ключевые показатели</h3>
          <div className="space-y-4">
            <KeyMetric
              label="Рентабельность"
              value={current.incomeTotal ? (current.profit / current.incomeTotal) * 100 : 0}
              unit="%"
              target={20}
            />
            <KeyMetric
              label="Доля безнала"
              value={current.incomeTotal ? ((current.incomeKaspi + current.incomeCard) / current.incomeTotal) * 100 : 0}
              unit="%"
              target={50}
            />
            <KeyMetric
              label="Соотношение доход/расход"
              value={current.expenseTotal ? current.incomeTotal / current.expenseTotal : 0}
              unit="x"
              target={1.5}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ label, value, previousValue, secondaryValue, icon, color, isMoney = false, isComparison = false }: {
  label: string
  value: number
  previousValue?: number
  secondaryValue?: number
  icon: React.ReactNode
  color: string
  isMoney?: boolean
  isComparison?: boolean
}) {
  const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0

  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${color} bg-opacity-20`}>
          {icon}
        </div>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      
      {isComparison ? (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Нал:</span>
            <span className="text-white font-medium">{Formatters.moneyShort(value)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Безнал:</span>
            <span className="text-white font-medium">{Formatters.moneyShort(secondaryValue || 0)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="text-xl font-bold text-white">
            {isMoney ? Formatters.money(value) : value.toLocaleString()}
          </div>
          {previousValue !== undefined && (
            <div className="flex items-center gap-1 mt-1 text-xs">
              <span className={change >= 0 ? 'text-green-400' : 'text-red-400'}>
                {change >= 0 ? '+' : ''}{change.toFixed(1)}%
              </span>
              <span className="text-gray-500">к прошлому</span>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function KeyMetric({ label, value, unit, target }: { label: string; value: number; unit: string; target: number }) {
  const percentage = Math.min(100, (value / target) * 100)
  const isGood = value >= target

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={isGood ? 'text-green-400' : 'text-yellow-400'}>
          {value.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isGood ? 'bg-gradient-to-r from-green-400 to-emerald-400' : 'bg-gradient-to-r from-yellow-400 to-orange-400'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-500 mt-1">Цель: {target}{unit}</div>
    </div>
  )
}

// ==================== КОМПОНЕНТЫ ДЛЯ FORECAST ====================

function ForecastView({ prediction, chartData, trends, margin, efficiency }: {
  prediction: AIInsight['predictions']
  chartData: ChartPoint[]
  trends: AIInsight['trends']
  margin: number
  efficiency: number
}) {
  const lastWeekProfit = chartData.slice(-7).reduce((sum, d) => sum + d.profit, 0)
  const prevWeekProfit = chartData.slice(-14, -7).reduce((sum, d) => sum + d.profit, 0)
  const weeklyGrowth = prevWeekProfit ? ((lastWeekProfit - prevWeekProfit) / prevWeekProfit) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ForecastCard
          title="Тренд прибыли"
          value={trends.profit === 'up' ? 'Растущий' : trends.profit === 'down' ? 'Падающий' : 'Стабильный'}
          icon={Formatters.trendIcon(trends.profit)}
          color={trends.profit === 'up' ? 'text-green-400' : trends.profit === 'down' ? 'text-red-400' : 'text-gray-400'}
        />
        <ForecastCard
          title="Недельный рост"
          value={`${weeklyGrowth > 0 ? '+' : ''}${weeklyGrowth.toFixed(1)}%`}
          icon={weeklyGrowth > 0 ? <TrendUpIcon className="w-5 h-5" /> : <TrendDownIcon className="w-5 h-5" />}
          color={weeklyGrowth > 0 ? 'text-green-400' : 'text-red-400'}
        />
        <ForecastCard
          title="Прогноз на месяц"
          value={Formatters.money(prediction.nextMonthProfit)}
          icon={<Sparkles className="w-5 h-5" />}
          color="text-purple-400"
        />
      </div>

      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <h3 className="text-sm font-semibold text-white mb-4">Рекомендации по улучшению</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecommendationCard
            title="Увеличьте маржинальность"
            description={`Текущая маржа ${margin.toFixed(1)}%. Целевой показатель 25%`}
            impact="+15% к прибыли"
            icon={<Target className="w-4 h-4" />}
          />
          <RecommendationCard
            title="Повысьте эффективность"
            description={`Коэффициент ${efficiency.toFixed(2)}x. Можно улучшить до 2x`}
            impact="+20% к ROI"
            icon={<Zap className="w-4 h-4" />}
          />
          <RecommendationCard
            title="Оптимизируйте расходы"
            description={trends.expense === 'up' ? 'Расходы растут быстрее доходов' : 'Контролируйте основные статьи'}
            impact="-10% расходов"
            icon={<TrendingDown className="w-4 h-4" />}
          />
          <RecommendationCard
            title="Работа с клиентами"
            description="Увеличьте частоту повторных продаж"
            impact="+25% LTV"
            icon={<Rocket className="w-4 h-4" />}
          />
        </div>
      </Card>
    </div>
  )
}

function ForecastCard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-gray-700/50 rounded-lg">
          {icon}
        </div>
        <span className="text-xs text-gray-400">{title}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </Card>
  )
}

function RecommendationCard({ title, description, impact, icon }: { title: string; description: string; impact: string; icon: React.ReactNode }) {
  return (
    <div className="p-4 bg-gray-700/30 rounded-xl border border-gray-700 hover:border-purple-500/30 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-purple-500/20 rounded-lg">
          {icon}
        </div>
        <h4 className="text-sm font-medium text-white">{title}</h4>
      </div>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <div className="text-xs font-medium text-green-400">{impact}</div>
    </div>
  )
}
