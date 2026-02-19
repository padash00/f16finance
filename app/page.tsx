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
  Smartphone,
  Globe,
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
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css"

// ==================== ТИПЫ ====================

type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
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
  incomeOnline: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  transactionsCount: number
  avgCheck: number
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
    amount: number
  }>
  predictions: {
    nextMonthProfit: number
    confidence: number
    recommendation: string
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
  paymentType?: string
  isAnomaly?: boolean
}

// ==================== УТИЛИТЫ ====================

const DateUtils = {
  toISODateLocal: (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
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

  formatDate: (iso: string, format: 'short' | 'full' | 'numeric' = 'short'): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    
    if (format === 'numeric') {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric', year: 'numeric' })
    }
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
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(v)
  },

  moneyFull: (v: number): string => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(v).replace('KZT', '₸').trim()
  },

  moneyShort: (v: number): string => {
    if (v >= 1_000_000) {
      return (v / 1_000_000).toFixed(1) + 'M'
    }
    if (v >= 1_000) {
      return (v / 1_000).toFixed(1) + 'K'
    }
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

  number: (v: number): string => {
    return new Intl.NumberFormat('ru-RU').format(v)
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
      backgroundColor: '#1f2937',
      border: '1px solid #374151',
      borderRadius: 8,
      padding: '8px 12px',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#9ca3af', fontSize: 12 },
  } as const
}

const COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
  kaspi: '#2563eb',
  card: '#7c3aed',
  cash: '#f59e0b',
  online: '#06b6d4',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#06b6d4'],
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
  ): Array<{ type: 'spike' | 'drop' | 'unusual'; date: string; description: string; severity: 'low' | 'medium' | 'high'; amount: number }> {
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
          description: `${type === 'spike' ? 'Всплеск' : 'Падение'} доходов`,
          severity,
          amount: point.income
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
  const [startDate, setStartDate] = useState<Date>(DateUtils.fromISO(DateUtils.addDaysISO(DateUtils.todayISO(), -29)))
  const [endDate, setEndDate] = useState<Date>(DateUtils.fromISO(DateUtils.todayISO()))
  const [rangeType, setRangeType] = useState<RangeType>('month')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'forecast'>('overview')

  // Данные
  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dateFrom = DateUtils.toISODateLocal(startDate)
  const dateTo = DateUtils.toISODateLocal(endDate)

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
    const today = new Date()

    switch (type) {
      case 'today':
        setStartDate(today)
        setEndDate(today)
        break
      case 'week':
        setStartDate(new Date(today.setDate(today.getDate() - 6)))
        setEndDate(new Date())
        break
      case 'month':
        setStartDate(new Date(today.setDate(today.getDate() - 29)))
        setEndDate(new Date())
        break
      case 'quarter': {
        const { start, end } = DateUtils.getQuarterBounds()
        setStartDate(DateUtils.fromISO(start))
        setEndDate(DateUtils.fromISO(end))
        break
      }
      case 'year': {
        const { start, end } = DateUtils.getYearBounds()
        setStartDate(DateUtils.fromISO(start))
        setEndDate(DateUtils.fromISO(end))
        break
      }
      default:
        setStartDate(today)
        setEndDate(today)
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
      incomeCash: 0, 
      incomeKaspi: 0, 
      incomeCard: 0, 
      incomeOnline: 0,
      incomeTotal: 0,
      expenseCash: 0, 
      expenseKaspi: 0, 
      expenseTotal: 0,
      profit: 0, 
      transactionsCount: 0,
      avgCheck: 0
    }

    const previous: FinancialTotals = {
      incomeCash: 0, 
      incomeKaspi: 0, 
      incomeCard: 0, 
      incomeOnline: 0,
      incomeTotal: 0,
      expenseCash: 0, 
      expenseKaspi: 0, 
      expenseTotal: 0,
      profit: 0, 
      transactionsCount: 0,
      avgCheck: 0
    }

    // Карта для графика
    const chartMap = new Map<string, ChartPoint>()
    allDates.forEach(date => {
      chartMap.set(date, { 
        date, 
        income: 0, 
        expense: 0, 
        profit: 0,
        formattedDate: DateUtils.formatDate(date, 'short')
      })
    })

    // Категории для доходов по типам оплаты
    const paymentTypes = {
      cash: 0,
      kaspi: 0,
      card: 0,
      online: 0
    }

    // Категории для расходов
    const expenseCategories: Record<string, number> = {}

    // Обработка доходов
    incomes.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return

      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const card = Number(row.card_amount || 0)
      const online = Number(row.online_amount || 0)
      const total = cash + kaspi + card + online
      
      if (total <= 0) return

      if (inCurrent(row.date)) {
        current.incomeCash += cash
        current.incomeKaspi += kaspi
        current.incomeCard += card
        current.incomeOnline += online
        current.incomeTotal += total
        current.transactionsCount++

        paymentTypes.cash += cash
        paymentTypes.kaspi += kaspi
        paymentTypes.card += card
        paymentTypes.online += online

        const point = chartMap.get(row.date)
        if (point) point.income += total
      } else if (inPrev(row.date)) {
        previous.incomeCash += cash
        previous.incomeKaspi += kaspi
        previous.incomeCard += card
        previous.incomeOnline += online
        previous.incomeTotal += total
        previous.transactionsCount++
      }
    })

    // Обработка расходов
    expenses.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return

      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const total = cash + kaspi
      
      if (total <= 0) return

      const category = row.category || 'Прочее'
      expenseCategories[category] = (expenseCategories[category] || 0) + total

      if (inCurrent(row.date)) {
        current.expenseCash += cash
        current.expenseKaspi += kaspi
        current.expenseTotal += total
        current.transactionsCount++

        const point = chartMap.get(row.date)
        if (point) point.expense += total
      } else if (inPrev(row.date)) {
        previous.expenseCash += cash
        previous.expenseKaspi += kaspi
        previous.expenseTotal += total
      }
    })

    // Финальные расчеты
    current.profit = current.incomeTotal - current.expenseTotal
    previous.profit = previous.incomeTotal - previous.expenseTotal
    current.avgCheck = current.transactionsCount ? current.incomeTotal / current.transactionsCount : 0
    previous.avgCheck = previous.transactionsCount ? previous.incomeTotal / previous.transactionsCount : 0

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

    const insight: AIInsight = {
      score,
      status,
      summary: getStatusSummary(status, trends),
      recommendation,
      margin,
      efficiency,
      trends,
      anomalies: anomalies.slice(0, 5),
      predictions: {
        nextMonthProfit: prediction.value,
        confidence: prediction.confidence,
        recommendation: prediction.confidence > 70 ? 'Прогноз достаточно надежен' : 'Низкая достоверность прогноза'
      }
    }

    // Форматирование категорий для графиков
    const incomeCategories: CategoryData[] = [
      { name: 'Наличные', value: paymentTypes.cash, color: COLORS.cash, percentage: (paymentTypes.cash / current.incomeTotal) * 100 || 0 },
      { name: 'Kaspi', value: paymentTypes.kaspi, color: COLORS.kaspi, percentage: (paymentTypes.kaspi / current.incomeTotal) * 100 || 0 },
      { name: 'Карта', value: paymentTypes.card, color: COLORS.card, percentage: (paymentTypes.card / current.incomeTotal) * 100 || 0 },
      { name: 'Online', value: paymentTypes.online, color: COLORS.online, percentage: (paymentTypes.online / current.incomeTotal) * 100 || 0 },
    ].filter(c => c.value > 0)

    const expenseCategoriesList: CategoryData[] = Object.entries(expenseCategories)
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
      incomeCategories,
      expenseCategories: expenseCategoriesList
    }
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  // Лента событий
  const feedItems = useMemo(() => {
    const items: FeedItem[] = []

    incomes.forEach(row => {
      if (!includeExtra && isExtraCompany(row.company_id)) return
      if (row.date < dateFrom || row.date > dateTo) return

      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const card = Number(row.card_amount || 0)
      const online = Number(row.online_amount || 0)
      const total = cash + kaspi + card + online
      
      if (total <= 0) return

      let paymentType = 'Наличные'
      if (kaspi > 0) paymentType = 'Kaspi'
      else if (card > 0) paymentType = 'Карта'
      else if (online > 0) paymentType = 'Online'

      items.push({
        id: `inc-${row.id}`,
        date: row.date,
        company_id: row.company_id,
        kind: 'income',
        title: row.comment || 'Продажа',
        amount: total,
        paymentType
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
        amount
      })
    })

    const anomalyDates = new Set(analytics.insight.anomalies.map(a => a.date))
    items.forEach(item => {
      if (anomalyDates.has(item.date)) {
        item.isAnomaly = true
      }
    })

    return items
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
      .slice(0, 10)
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany, analytics.insight.anomalies])

  const { current, previous, chartData, insight, incomeCategories, expenseCategories } = analytics
  const hasExtraCompany = companies.some(c => (c.code || '').toLowerCase() === 'extra')

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-500 border-t-transparent mx-auto mb-4" />
            <p className="text-gray-400">Загрузка данных...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gray-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="p-8 max-w-md text-center bg-gray-800 border-gray-700">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Ошибка загрузки</h2>
            <p className="text-gray-400 mb-6">{error}</p>
            <Button onClick={() => window.location.reload()}>
              Попробовать снова
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Хедер */}
          <Header
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            rangeType={rangeType}
            onRangeChange={setQuickRange}
            includeExtra={includeExtra}
            onIncludeExtraChange={setIncludeExtra}
            hasExtraCompany={hasExtraCompany}
            insight={insight}
          />

          {/* Табы */}
          <div className="flex gap-2 p-1 bg-gray-800 rounded-lg w-fit">
            <TabButton 
              active={activeTab === 'overview'} 
              onClick={() => setActiveTab('overview')}
              label="Обзор"
            />
            <TabButton 
              active={activeTab === 'details'} 
              onClick={() => setActiveTab('details')}
              label="Детали"
            />
            <TabButton 
              active={activeTab === 'forecast'} 
              onClick={() => setActiveTab('forecast')}
              label="Прогноз"
            />
          </div>

          {/* Контент */}
          {activeTab === 'overview' && (
            <OverviewContent
              current={current}
              previous={previous}
              insight={insight}
              chartData={chartData}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
              anomalies={insight.anomalies}
              showAnomalies={showAnomalies}
              onToggleAnomalies={() => setShowAnomalies(!showAnomalies)}
              feedItems={feedItems}
              companyName={companyName}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

          {activeTab === 'details' && (
            <DetailsView
              current={current}
              previous={previous}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
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
  switch (status) {
    case 'excellent':
      return `📈 Отличная динамика! Прибыль растет`
    case 'good':
      return `📊 Хорошие показатели, есть потенциал`
    case 'warning':
      return `⚠️ Требуется внимание: расходы растут`
    case 'critical':
      return `🔴 Критическая ситуация: требуется оптимизация`
    default:
      return 'Анализ финансовых показателей'
  }
}

// ==================== КОМПОНЕНТЫ ====================

interface TabButtonProps {
  active: boolean
  onClick: () => void
  label: string
}

function TabButton({ active, onClick, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  )
}

interface HeaderProps {
  startDate: Date
  endDate: Date
  onStartDateChange: (date: Date) => void
  onEndDateChange: (date: Date) => void
  rangeType: RangeType
  onRangeChange: (type: RangeType) => void
  includeExtra: boolean
  onIncludeExtraChange: (value: boolean) => void
  hasExtraCompany: boolean
  insight: AIInsight
}

function Header({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  rangeType,
  onRangeChange,
  includeExtra,
  onIncludeExtraChange,
  hasExtraCompany,
  insight,
}: HeaderProps) {
  const statusColors = {
    excellent: 'text-green-400',
    good: 'text-purple-400',
    warning: 'text-yellow-400',
    critical: 'text-red-400',
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-purple-400" />
          <h1 className="text-xl font-semibold text-white">AI Финансовый Дашборд</h1>
        </div>
        <span className={`text-sm font-medium ${statusColors[insight.status]}`}>
          {insight.status === 'excellent' ? '🚀 Отлично' :
           insight.status === 'good' ? '✅ Хорошо' :
           insight.status === 'warning' ? '⚠️ Внимание' : '🔴 Критично'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {/* Кнопки периодов */}
        <div className="flex gap-1 p-1 bg-gray-900 rounded-lg">
          <PeriodButton 
            active={rangeType === 'today'} 
            onClick={() => onRangeChange('today')}
            label="День"
          />
          <PeriodButton 
            active={rangeType === 'week'} 
            onClick={() => onRangeChange('week')}
            label="Неделя"
          />
          <PeriodButton 
            active={rangeType === 'month'} 
            onClick={() => onRangeChange('month')}
            label="Месяц"
          />
          <PeriodButton 
            active={rangeType === 'quarter'} 
            onClick={() => onRangeChange('quarter')}
            label="Квартал"
          />
          <PeriodButton 
            active={rangeType === 'year'} 
            onClick={() => onRangeChange('year')}
            label="Год"
          />
        </div>

        {/* Календарь */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <DatePicker
              selected={startDate}
              onChange={(date) => {
                onStartDateChange(date || new Date())
                onRangeChange('custom')
              }}
              selectsStart
              startDate={startDate}
              endDate={endDate}
              dateFormat="dd.MM.yyyy"
              className="bg-gray-900 text-white text-sm rounded-lg px-3 py-2 w-32 border border-gray-700 focus:outline-none focus:border-purple-500"
            />
          </div>
          <span className="text-gray-500">—</span>
          <div className="relative">
            <DatePicker
              selected={endDate}
              onChange={(date) => {
                onEndDateChange(date || new Date())
                onRangeChange('custom')
              }}
              selectsEnd
              startDate={startDate}
              endDate={endDate}
              minDate={startDate}
              dateFormat="dd.MM.yyyy"
              className="bg-gray-900 text-white text-sm rounded-lg px-3 py-2 w-32 border border-gray-700 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        {/* Extra кнопка */}
        {hasExtraCompany && (
          <button
            onClick={() => onIncludeExtraChange(!includeExtra)}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              includeExtra
                ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800'
            }`}
          >
            Extra {includeExtra ? '✓' : ''}
          </button>
        )}

        {/* Достоверность прогноза */}
        <div className="ml-auto flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-lg">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-sm text-gray-300">Прогноз:</span>
          <span className="text-sm font-medium text-purple-400">{insight.predictions.confidence}%</span>
        </div>
      </div>
    </div>
  )
}

function PeriodButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  )
}

// ==================== КОМПОНЕНТЫ ДЛЯ OVERVIEW ====================

interface OverviewContentProps {
  current: FinancialTotals
  previous: FinancialTotals
  insight: AIInsight
  chartData: ChartPoint[]
  incomeCategories: CategoryData[]
  expenseCategories: CategoryData[]
  anomalies: AIInsight['anomalies']
  showAnomalies: boolean
  onToggleAnomalies: () => void
  feedItems: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}

function OverviewContent({
  current,
  previous,
  insight,
  chartData,
  incomeCategories,
  expenseCategories,
  anomalies,
  showAnomalies,
  onToggleAnomalies,
  feedItems,
  companyName,
  dateFrom,
  dateTo,
}: OverviewContentProps) {
  // Верхний ряд: 4 карточки метрик
  const metrics = [
    { 
      label: 'Доход', 
      value: current.incomeTotal, 
      previousValue: previous.incomeTotal,
      icon: <TrendingUp className="w-5 h-5" />,
      color: 'from-green-500 to-emerald-500',
      textColor: 'text-green-400'
    },
    { 
      label: 'Расход', 
      value: current.expenseTotal, 
      previousValue: previous.expenseTotal,
      icon: <TrendingDown className="w-5 h-5" />,
      color: 'from-red-500 to-rose-500',
      textColor: 'text-red-400'
    },
    { 
      label: 'Прибыль', 
      value: current.profit, 
      previousValue: previous.profit,
      icon: <Target className="w-5 h-5" />,
      color: 'from-purple-500 to-indigo-500',
      textColor: 'text-purple-400'
    },
    { 
      label: 'Средний чек', 
      value: current.avgCheck, 
      previousValue: previous.avgCheck,
      icon: <DollarSign className="w-5 h-5" />,
      color: 'from-blue-500 to-cyan-500',
      textColor: 'text-blue-400'
    },
  ]

  return (
    <div className="space-y-6">
      {/* Верхний ряд: 4 метрики */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <MetricCard key={index} {...metric} />
        ))}
      </div>

      {/* График на всю ширину */}
      <ChartCard 
        data={chartData} 
        anomalies={anomalies}
      />

      {/* Средний ряд: 4 карточки */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Структура доходов */}
        <CategoryCard
          title="Структура доходов"
          categories={incomeCategories}
          total={current.incomeTotal}
          icon={<TrendingUp className="w-4 h-4" />}
          color="#10b981"
        />

        {/* Структура расходов */}
        <CategoryCard
          title="Структура расходов"
          categories={expenseCategories}
          total={current.expenseTotal}
          icon={<TrendingDown className="w-4 h-4" />}
          color="#ef4444"
        />

        {/* Аномалии */}
        <AnomaliesCard
          anomalies={anomalies}
          isVisible={showAnomalies}
          onToggle={onToggleAnomalies}
        />

        {/* Лента событий */}
        <FeedCard
          feedItems={feedItems}
          companyName={companyName}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </div>

      {/* Нижний ряд: AI Прогноз на всю ширину */}
      <PredictionFullCard
        prediction={insight.predictions}
        currentProfit={current.profit}
        margin={insight.margin}
        efficiency={insight.efficiency}
        trends={insight.trends}
      />
    </div>
  )
}

function MetricCard({ label, value, previousValue, icon, color, textColor }: {
  label: string
  value: number
  previousValue: number
  icon: React.ReactNode
  color: string
  textColor: string
}) {
  const change = Formatters.percentChange(value, previousValue)

  return (
    <Card className="p-5 bg-gray-800 border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">{label}</span>
        <div className={`p-2 rounded-lg bg-gradient-to-br ${color} bg-opacity-10`}>
          {icon}
        </div>
      </div>
      
      <div className={`text-2xl font-bold ${textColor} mb-1`}>
        {Formatters.moneyFull(value)}
      </div>
      
      <div className="flex items-center gap-2 text-xs">
        <span className={change.isPositive ? 'text-green-400' : 'text-red-400'}>
          {change.value}
        </span>
        <span className="text-gray-500">к прошлому периоду</span>
      </div>
    </Card>
  )
}

function ChartCard({ data, anomalies }: { data: ChartPoint[]; anomalies: AIInsight['anomalies'] }) {
  return (
    <Card className="p-5 bg-gray-800 border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <LineChart className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-medium text-white">Динамика доходов и расходов</h3>
      </div>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-500">
          Нет данных за выбранный период
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
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
                formatter={(val: number) => [Formatters.moneyFull(val)]}
                labelFormatter={(label: string) => label}
                contentStyle={Formatters.tooltip.contentStyle}
              />
              <Legend />

              <Bar dataKey="income" name="Доход" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Расход" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="profit" name="Прибыль" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function CategoryCard({ title, categories, total, icon, color }: {
  title: string
  categories: CategoryData[]
  total: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card className="p-5 bg-gray-800 border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}20` }}>
          {icon}
        </div>
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>

      {categories.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-gray-500">
          Нет данных
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map((cat, index) => (
            <div key={index}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">{cat.name}</span>
                <span className="text-white font-medium">{Formatters.moneyFull(cat.value)}</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ 
                    width: `${cat.percentage}%`,
                    backgroundColor: cat.color 
                  }}
                />
              </div>
              <div className="text-right text-[10px] text-gray-500 mt-0.5">
                {cat.percentage.toFixed(1)}%
              </div>
            </div>
          ))}
          
          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Всего</span>
              <span className="text-white font-medium">{Formatters.moneyFull(total)}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomaliesCard({ anomalies, isVisible, onToggle }: { 
  anomalies: AIInsight['anomalies']
  isVisible: boolean
  onToggle: () => void
}) {
  const severityColors = {
    high: 'bg-red-500/10 border-red-500/30 text-red-400',
    medium: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    low: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
  }

  return (
    <Card className="p-5 bg-gray-800 border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-medium text-white">Аномалии</h3>
          {anomalies.length > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
              {anomalies.length}
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="text-xs text-gray-400 hover:text-white"
        >
          {isVisible ? 'Скрыть' : 'Показать'}
        </button>
      </div>

      {isVisible && (
        <div className="space-y-2 max-h-48 overflow-auto">
          {anomalies.length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-8 h-8 text-green-500/50 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Аномалий не обнаружено</p>
            </div>
          ) : (
            anomalies.map((anomaly, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border ${severityColors[anomaly.severity]}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">
                    {anomaly.type === 'spike' ? '📈 Всплеск' : '📉 Падение'}
                  </span>
                  <span className="text-[10px] opacity-75">
                    {DateUtils.getRelativeDay(anomaly.date)}
                  </span>
                </div>
                <p className="text-xs mb-1">{anomaly.description}</p>
                <p className="text-xs font-medium">
                  {Formatters.moneyFull(anomaly.amount)}
                </p>
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
    <Card className="p-0 bg-gray-800 border-gray-700 overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-white">Лента событий</h3>
          {feedItems.length > 0 && (
            <span className="ml-auto px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
              {feedItems.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-48 p-2 space-y-1">
        {feedItems.length === 0 ? (
          <div className="text-center py-6">
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

      <div className="p-3 border-t border-gray-700">
        <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-8 text-gray-400 hover:text-white hover:bg-gray-700"
          >
            Все операции
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function FeedItemRow({ item, companyName }: { item: FeedItem; companyName: string }) {
  const isIncome = item.kind === 'income'
  
  return (
    <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
      item.isAnomaly ? 'bg-yellow-500/10' : 'hover:bg-gray-700/50'
    }`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="relative">
          <div
            className={`w-2 h-2 rounded-full ${
              isIncome ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
        </div>
        
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-white truncate">
            {item.title}
          </span>
          <span className="text-[10px] text-gray-500 truncate">
            {companyName} • {DateUtils.getRelativeDay(item.date)}
            {item.paymentType && ` • ${item.paymentType}`}
          </span>
        </div>
      </div>

      <span
        className={`text-xs font-medium whitespace-nowrap ml-2 ${
          isIncome ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {isIncome ? '+' : '-'}{Formatters.moneyShort(item.amount)}
      </span>
    </div>
  )
}

function PredictionFullCard({ prediction, currentProfit, margin, efficiency, trends }: {
  prediction: AIInsight['predictions']
  currentProfit: number
  margin: number
  efficiency: number
  trends: AIInsight['trends']
}) {
  const change = prediction.nextMonthProfit - currentProfit
  const changePercent = currentProfit ? (change / Math.abs(currentProfit)) * 100 : 0

  return (
    <Card className="p-6 bg-gradient-to-r from-blue-900/20 via-gray-800 to-purple-900/20 border-gray-700">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-6 h-6 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">AI Прогноз на следующий месяц</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div>
          <p className="text-sm text-gray-400 mb-1">Ожидаемая прибыль</p>
          <p className="text-3xl font-bold text-blue-400">
            {Formatters.moneyFull(prediction.nextMonthProfit)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {change >= 0 ? '↗' : '↘'} {Math.abs(changePercent).toFixed(1)}%
            </span>
            <span className="text-xs text-gray-500">от текущей</span>
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-1">Достоверность</p>
          <p className="text-2xl font-bold text-purple-400">{prediction.confidence}%</p>
          <div className="w-full h-1.5 bg-gray-700 rounded-full mt-2">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${prediction.confidence}%` }}
            />
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-1">Тренд прибыли</p>
          <p className="text-xl font-medium text-white capitalize">
            {trends.profit === 'up' ? 'Растущий' : trends.profit === 'down' ? 'Падающий' : 'Стабильный'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-400">Маржа:</span>
            <span className="text-sm font-medium text-green-400">{margin.toFixed(1)}%</span>
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-1">Рекомендация</p>
          <p className="text-sm text-white">{prediction.recommendation}</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <p className="text-sm text-gray-300">
          {prediction.confidence > 70 
            ? "✅ Прогноз достаточно надежен, можно использовать для планирования"
            : "⚠️ Низкая достоверность прогноза, рекомендуется собрать больше данных"}
        </p>
      </div>
    </Card>
  )
}

// ==================== КОМПОНЕНТЫ ДЛЯ DETAILS ====================

function DetailsView({ current, previous, incomeCategories, expenseCategories }: {
  current: FinancialTotals
  previous: FinancialTotals
  incomeCategories: CategoryData[]
  expenseCategories: CategoryData[]
}) {
  const paymentStats = [
    { name: 'Наличные', value: current.incomeCash, color: COLORS.cash },
    { name: 'Kaspi', value: current.incomeKaspi, color: COLORS.kaspi },
    { name: 'Карта', value: current.incomeCard, color: COLORS.card },
    { name: 'Online', value: current.incomeOnline, color: COLORS.online },
  ].filter(s => s.value > 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <DetailCard
          label="Всего транзакций"
          value={current.transactionsCount}
          previousValue={previous.transactionsCount}
        />
        <DetailCard
          label="Средний чек"
          value={current.avgCheck}
          previousValue={previous.avgCheck}
          isMoney
        />
        <DetailCard
          label="Наличные"
          value={current.incomeCash}
          previousValue={previous.incomeCash}
          isMoney
        />
        <DetailCard
          label="Kaspi"
          value={current.incomeKaspi}
          previousValue={previous.incomeKaspi}
          isMoney
        />
        <DetailCard
          label="Карта"
          value={current.incomeCard}
          previousValue={previous.incomeCard}
          isMoney
        />
        <DetailCard
          label="Online"
          value={current.incomeOnline}
          previousValue={previous.incomeOnline}
          isMoney
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 bg-gray-800 border-gray-700">
          <h3 className="text-sm font-medium text-white mb-4">Способы оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.moneyShort(v)} />
                <Tooltip formatter={(v: number) => Formatters.moneyFull(v)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {paymentStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 bg-gray-800 border-gray-700">
          <h3 className="text-sm font-medium text-white mb-4">Ключевые показатели</h3>
          <div className="space-y-4">
            <KeyMetric
              label="Рентабельность"
              value={current.incomeTotal ? (current.profit / current.incomeTotal) * 100 : 0}
              unit="%"
              target={20}
            />
            <KeyMetric
              label="Доля безнала"
              value={current.incomeTotal ? ((current.incomeKaspi + current.incomeCard + current.incomeOnline) / current.incomeTotal) * 100 : 0}
              unit="%"
              target={60}
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

function DetailCard({ label, value, previousValue, isMoney = false }: {
  label: string
  value: number
  previousValue: number
  isMoney?: boolean
}) {
  const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0

  return (
    <Card className="p-4 bg-gray-800 border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-semibold text-white">
        {isMoney ? Formatters.moneyFull(value) : Formatters.number(value)}
      </p>
      <p className={`text-xs mt-1 ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        {change >= 0 ? '+' : ''}{change.toFixed(1)}% к прошлому
      </p>
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
          className={`h-full rounded-full transition-all ${
            isGood ? 'bg-green-500' : 'bg-yellow-500'
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ForecastSmallCard
          title="Тренд прибыли"
          value={trends.profit === 'up' ? 'Растущий' : trends.profit === 'down' ? 'Падающий' : 'Стабильный'}
          color={trends.profit === 'up' ? 'text-green-400' : trends.profit === 'down' ? 'text-red-400' : 'text-gray-400'}
        />
        <ForecastSmallCard
          title="Недельный рост"
          value={`${weeklyGrowth > 0 ? '+' : ''}${weeklyGrowth.toFixed(1)}%`}
          color={weeklyGrowth > 0 ? 'text-green-400' : 'text-red-400'}
        />
        <ForecastSmallCard
          title="Маржа"
          value={`${margin.toFixed(1)}%`}
          color={margin > 20 ? 'text-green-400' : margin > 10 ? 'text-yellow-400' : 'text-red-400'}
        />
        <ForecastSmallCard
          title="Эффективность"
          value={`${efficiency.toFixed(2)}x`}
          color={efficiency > 1.5 ? 'text-green-400' : efficiency > 1 ? 'text-yellow-400' : 'text-red-400'}
        />
      </div>

      <Card className="p-6 bg-gray-800 border-gray-700">
        <h3 className="text-sm font-medium text-white mb-4">Рекомендации по улучшению</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecommendationCard
            title="Увеличьте маржинальность"
            description={`Текущая маржа ${margin.toFixed(1)}%. Целевой показатель 25%`}
            impact="+15% к прибыли"
          />
          <RecommendationCard
            title="Повысьте эффективность"
            description={`Коэффициент ${efficiency.toFixed(2)}x. Можно улучшить до 2x`}
            impact="+20% к ROI"
          />
          <RecommendationCard
            title="Оптимизируйте расходы"
            description={trends.expense === 'up' ? 'Расходы растут быстрее доходов' : 'Контролируйте основные статьи'}
            impact="-10% расходов"
          />
          <RecommendationCard
            title="Работа с клиентами"
            description="Увеличьте частоту повторных продаж"
            impact="+25% LTV"
          />
        </div>
      </Card>
    </div>
  )
}

function ForecastSmallCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <Card className="p-4 bg-gray-800 border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{title}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </Card>
  )
}

function RecommendationCard({ title, description, impact }: { title: string; description: string; impact: string }) {
  return (
    <div className="p-4 bg-gray-700/30 rounded-lg border border-gray-700">
      <h4 className="text-sm font-medium text-white mb-2">{title}</h4>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <p className="text-xs font-medium text-green-400">{impact}</p>
    </div>
  )
}
