'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Filter,
  Download,
  Search,
  Banknote,
  Smartphone,
  Tag,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  BarChart3,
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  Building2,
  ArrowRight,
  MinusIcon,
  Clock,
  Activity,
  Target,
  Zap,
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

// ================== TYPES ==================
type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type PayFilter = 'all' | 'cash' | 'kaspi'
type DateRangePreset = 'today' | 'week' | 'month' | 'all'
type SortMode = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

type ChartPoint = {
  date: string
  cash: number
  kaspi: number
  total: number
  formattedDate?: string
}

type CategoryData = {
  name: string
  value: number
  color: string
  percentage: number
}

// ================== CONFIG ==================
const PAGE_SIZE = 200
const MAX_ROWS_HARD_LIMIT = 2000
const SEARCH_MIN_LEN = 2

const COLORS = {
  cash: '#ef4444',
  kaspi: '#f97316',
  chart: ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#3b82f6', '#10b981'],
}

// ================== DATE HELPERS ==================
const DateUtils = {
  toISODateLocal: (d: Date) => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  
  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },

  todayISO: () => DateUtils.toISODateLocal(new Date()),

  addDaysISO: (iso: string, diff: number) => {
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

// ================== FORMATTERS ==================
const Formatters = {
  money: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + ' тыс ₸'
    return v.toLocaleString('ru-RU') + ' ₸'
  },

  moneyDetailed: (v: number): string => 
    v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸',

  tooltip: {
    contentStyle: {
      backgroundColor: '#1e1e2f',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: 12,
      padding: '12px 16px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#a0a0c0', fontSize: 12 },
  } as const
}

// ================== AI ANALYTICS ==================
class ExpenseAnalytics {
  static detectTrend(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 3) return 'stable'
    const first = data[0]
    const last = data[data.length - 1]
    const change = ((last - first) / (first || 1)) * 100
    
    if (change > 5) return 'up'
    if (change < -5) return 'down'
    return 'stable'
  }

  static findAnomalies(data: ChartPoint[]): Array<{ date: string; amount: number; type: 'spike' | 'drop' }> {
    const totals = data.map(d => d.total).filter(v => v > 0)
    if (totals.length < 5) return []
    
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const stdDev = Math.sqrt(totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length)
    
    return data
      .filter(d => d.total > avg + stdDev * 2 || d.total < avg - stdDev * 2)
      .map(d => ({
        date: d.date,
        amount: d.total,
        type: d.total > avg ? 'spike' : 'drop'
      }))
      .slice(0, 3)
  }

  static predictNextMonth(data: ChartPoint[]): { value: number; confidence: number } {
    if (data.length < 7) return { value: 0, confidence: 0 }
    
    const totals = data.map(d => d.total).filter(v => v > 0)
    if (totals.length < 3) return { value: 0, confidence: 0 }
    
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const variance = totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length
    const stdDev = Math.sqrt(variance)
    
    const confidence = Math.max(0, Math.min(100, 100 - (stdDev / avg) * 100))
    
    return {
      value: Math.round(avg * 30),
      confidence: Math.round(confidence * 100) / 100
    }
  }
}

// ================== UTIL ==================
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

const rowTotal = (r: ExpenseRow) => (r.cash_amount || 0) + (r.kaspi_amount || 0)

const escapeCSV = (value: any) => {
  const s = value === null || value === undefined ? '' : String(value)
  const needsQuotes = s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')
  const escaped = s.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

// ================== MAIN COMPONENT ==================
export default function ExpensesPage() {
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const searchDebounced = useDebouncedValue(searchTerm.trim(), 350)
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('date_desc')
  const [showFilters, setShowFilters] = useState(false)

  const [page, setPage] = useState(0)
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'list'>('overview')
  
  const reqIdRef = useRef(0)

  // Load companies
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data, error } = await supabase.from('companies').select('id, name, code').order('name')
      if (!error && data) setCompanies(data as Company[])
    }
    fetchCompanies()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const companyName = useCallback(
    (companyId: string) => companyMap.get(companyId)?.name ?? '—',
    [companyMap]
  )

  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => c.code === 'extra' || c.name === 'F16 Extra')
    return extra?.id ?? null
  }, [companies])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  // Query builder
  const buildQuery = useCallback(
    (forPage: number) => {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .range(forPage * PAGE_SIZE, forPage * PAGE_SIZE + PAGE_SIZE - 1)

      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo) q = q.lte('date', dateTo)
      if (companyFilter !== 'all') q = q.eq('company_id', companyFilter)
      if (categoryFilter !== 'all') q = q.eq('category', categoryFilter)
      if (payFilter === 'cash') q = q.gt('cash_amount', 0)
      if (payFilter === 'kaspi') q = q.gt('kaspi_amount', 0)

      const term = searchDebounced
      if (term.length >= SEARCH_MIN_LEN) {
        q = q.or(`comment.ilike.%${term}%,category.ilike.%${term}%`)
      }

      if (sortMode === 'date_desc') q = q.order('date', { ascending: false })
      if (sortMode === 'date_asc') q = q.order('date', { ascending: true })
      if (sortMode === 'amount_desc')
        q = q.order('cash_amount', { ascending: false }).order('kaspi_amount', { ascending: false })
      if (sortMode === 'amount_asc')
        q = q.order('cash_amount', { ascending: true }).order('kaspi_amount', { ascending: true })

      return q
    },
    [dateFrom, dateTo, companyFilter, categoryFilter, payFilter, searchDebounced, sortMode]
  )

  // Load data
  const loadPage = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      const myReqId = ++reqIdRef.current
      if (mode === 'replace') {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }

      try {
        if (targetPage * PAGE_SIZE >= MAX_ROWS_HARD_LIMIT) {
          setHasMore(false)
          return
        }

        const { data, error } = await buildQuery(targetPage)

        if (myReqId !== reqIdRef.current) return
        if (error) throw error

        const pageRows = (data || []) as ExpenseRow[]
        setHasMore(
          pageRows.length === PAGE_SIZE && (targetPage + 1) * PAGE_SIZE < MAX_ROWS_HARD_LIMIT
        )

        if (mode === 'replace') {
          setRows(pageRows)
          setPage(targetPage)
        } else {
          setRows((prev) => [...prev, ...pageRows])
          setPage(targetPage)
        }
      } catch (e: any) {
        if (myReqId !== reqIdRef.current) return
        setError('Ошибка загрузки данных')
        setHasMore(false)
      } finally {
        if (myReqId !== reqIdRef.current) return
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [buildQuery]
  )

  useEffect(() => {
    loadPage(0, 'replace')
  }, [loadPage])

  const loadMore = () => {
    if (loadingMore || loading || !hasMore) return
    loadPage(page + 1, 'append')
  }

  // Presets
  const setPreset = (preset: DateRangePreset) => {
    const today = DateUtils.todayISO()
    setActivePreset(preset)

    switch (preset) {
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
      case 'all':
        setDateFrom('')
        setDateTo('')
        break
    }
    setIsCalendarOpen(false)
  }

  const resetFilters = () => {
    setDateFrom(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
    setDateTo(DateUtils.todayISO())
    setActivePreset('month')
    setCompanyFilter('all')
    setCategoryFilter('all')
    setPayFilter('all')
    setSearchTerm('')
    setIncludeExtraInTotals(false)
  }

  const periodLabel = dateFrom && dateTo 
    ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}`
    : 'Весь период'

  // Analytics
  const analytics = useMemo(() => {
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)
    const chartMap = new Map<string, ChartPoint>()
    
    dates.forEach(date => {
      chartMap.set(date, {
        date,
        cash: 0,
        kaspi: 0,
        total: 0,
        formattedDate: DateUtils.formatDate(date)
      })
    })

    let cash = 0
    let kaspi = 0
    const catMap: Record<string, number> = {}

    for (const r of rows) {
      if (companyFilter === 'all' && !includeExtraInTotals && extraCompanyId && r.company_id === extraCompanyId) {
        continue
      }

      const total = rowTotal(r)
      cash += r.cash_amount || 0
      kaspi += r.kaspi_amount || 0

      const cat = r.category || 'Без категории'
      catMap[cat] = (catMap[cat] || 0) + total

      const point = chartMap.get(r.date)
      if (point) {
        point.cash += r.cash_amount || 0
        point.kaspi += r.kaspi_amount || 0
        point.total += total
      }
    }

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    
    // Moving average
    chartData.forEach((point, i) => {
      const start = Math.max(0, i - 6)
      const window = chartData.slice(start, i + 1)
      point.movingAvg = window.reduce((sum, p) => sum + p.total, 0) / window.length
    })

    const total = cash + kaspi
    const trend = ExpenseAnalytics.detectTrend(chartData.map(d => d.total).filter(v => v > 0))
    const anomalies = ExpenseAnalytics.findAnomalies(chartData)
    const prediction = ExpenseAnalytics.predictNextMonth(chartData)

    const topCategory = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    const categoryData: CategoryData[] = Object.entries(catMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], index) => ({
        name,
        value,
        percentage: total ? (value / total) * 100 : 0,
        color: COLORS.chart[index % COLORS.chart.length]
      }))

    return {
      cash,
      kaspi,
      total,
      chartData,
      trend,
      anomalies,
      prediction,
      topCategory,
      topAmount: topCategory[1],
      categoryData,
      avgExpense: rows.length ? total / rows.length : 0,
    }
  }, [rows, dateFrom, dateTo, companyFilter, includeExtraInTotals, extraCompanyId])

  const activeFiltersCount = [
    companyFilter !== 'all',
    categoryFilter !== 'all',
    payFilter !== 'all',
    searchTerm !== ''
  ].filter(Boolean).length

  const trendIcon = analytics.trend === 'up' ? <TrendingUp className="w-4 h-4 text-red-400" /> : 
                   analytics.trend === 'down' ? <TrendingDown className="w-4 h-4 text-green-400" /> : 
                   <MinusIcon className="w-4 h-4 text-gray-400" />

  // Export
  const downloadCSV = () => {
    const SEP = ';'
    const headers = ['Дата', 'Компания', 'Категория', 'Cash', 'Kaspi', 'Итого', 'Комментарий']

    const lines = [
      headers.join(SEP),
      ...rows.map((r) => {
        const total = rowTotal(r)
        return [
          escapeCSV(r.date),
          escapeCSV(companyName(r.company_id)),
          escapeCSV(r.category ?? ''),
          escapeCSV(r.cash_amount ?? 0),
          escapeCSV(r.kaspi_amount ?? 0),
          escapeCSV(total),
          escapeCSV(r.comment ?? ''),
        ].join(SEP)
      }),
    ].join('\n')

    const blob = new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `expenses_${DateUtils.todayISO()}.csv`
    link.click()
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-red-500/30 border-t-red-500 mx-auto mb-6" />
              <Wallet className="w-8 h-8 text-red-400 absolute top-4 left-1/2 transform -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаем данные о расходах...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 p-6 border border-red-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-red-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-orange-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-red-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-red-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Журнал расходов
                    </h1>
                    <p className="text-sm text-gray-400">Умный контроль затрат и аналитика</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
                      activeFiltersCount > 0
                        ? 'bg-red-500/20 border-red-500/30 text-red-400'
                        : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-red-500/50'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Фильтры
                    {activeFiltersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                        {activeFiltersCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-red-500/50 transition-colors"
                  >
                    <CalendarDays className="w-4 h-4 text-red-400" />
                    <span className="text-gray-300 text-sm">{periodLabel}</span>
                    <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {extraCompanyId && (
                    <button
                      onClick={() => setIncludeExtraInTotals(!includeExtraInTotals)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                        includeExtraInTotals
                          ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                          : 'bg-gray-800/50 border-gray-700 text-gray-400'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-yellow-400' : 'bg-gray-500'}`} />
                      Extra
                    </button>
                  )}

                  <Button variant="outline" size="sm" onClick={downloadCSV} disabled={rows.length === 0} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                    <Download className="w-4 h-4 mr-1" /> Экспорт
                  </Button>

                  <Link href="/expenses/analysis">
                    <Button variant="outline" size="sm" className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                      <BarChart3 className="w-4 h-4 mr-1" /> Анализ
                    </Button>
                  </Link>

                  <Link href="/expenses/add">
                    <Button size="sm" className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white shadow-lg shadow-red-500/25">
                      <Plus className="w-4 h-4 mr-1" /> Добавить
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Calendar */}
              {isCalendarOpen && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-red-500/20 rounded-2xl">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                          activePreset === p
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Все время'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">С</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-red-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">По</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-red-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Filters Panel */}
              {showFilters && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-red-500/20 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <Filter className="w-4 h-4 text-red-400" />
                      Фильтры данных
                    </h3>
                    <div className="flex items-center gap-2">
                      {activeFiltersCount > 0 && (
                        <button
                          onClick={resetFilters}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Сбросить все
                        </button>
                      )}
                      <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-white">
                        <ChevronDown className="w-5 h-5 rotate-180" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Компания
                      </label>
                      <select
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Все компании</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        Категория
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Все категории</option>
                        {categories.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Smartphone className="w-3 h-3" />
                        Способ оплаты
                      </label>
                      <select
                        value={payFilter}
                        onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Любая</option>
                        <option value="cash">Наличные 💵</option>
                        <option value="kaspi">Kaspi 📱</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        Сортировка
                      </label>
                      <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="date_desc">Дата ↓</option>
                        <option value="date_asc">Дата ↑</option>
                        <option value="amount_desc">Сумма ↓</option>
                        <option value="amount_asc">Сумма ↑</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                      <Search className="w-3 h-3" />
                      Поиск по комментарию или категории
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Введите текст для поиска..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-800 text-white pl-10 pr-4 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      />
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                      {searchTerm && (
                        <button
                          onClick={() => setSearchTerm('')}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          <ChevronDown className="w-4 h-4 rotate-180" />
                        </button>
                      )}
                    </div>
                    {searchTerm.trim().length > 0 && searchTerm.trim().length < SEARCH_MIN_LEN && (
                      <p className="text-xs text-gray-500">Введите минимум {SEARCH_MIN_LEN} символа</p>
                    )}
                  </div>

                  {activeFiltersCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-800">
                      <span className="text-xs text-gray-500">Активные фильтры:</span>
                      {companyFilter !== 'all' && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-lg flex items-center gap-1">
                          Компания: {companyName(companyFilter)}
                          <button onClick={() => setCompanyFilter('all')} className="hover:text-white"><ChevronDown className="w-3 h-3 rotate-180" /></button>
                        </span>
                      )}
                      {categoryFilter !== 'all' && (
                        <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-lg flex items-center gap-1">
                          Категория: {categoryFilter}
                          <button onClick={() => setCategoryFilter('all')} className="hover:text-white"><ChevronDown className="w-3 h-3 rotate-180" /></button>
                        </span>
                      )}
                      {payFilter !== 'all' && (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-lg flex items-center gap-1">
                          Оплата: {payFilter === 'cash' ? 'Наличные' : 'Kaspi'}
                          <button onClick={() => setPayFilter('all')} className="hover:text-white"><ChevronDown className="w-3 h-3 rotate-180" /></button>
                        </span>
                      )}
                      {searchTerm && (
                        <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded-lg flex items-center gap-1">
                          Поиск: "{searchTerm}"
                          <button onClick={() => setSearchTerm('')} className="hover:text-white"><ChevronDown className="w-3 h-3 rotate-180" /></button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
            <TabButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<BarChart3 className="w-4 h-4" />} label="Аналитика" />
            <TabButton active={activeTab === 'list'} onClick={() => setActiveTab('list')} icon={<Clock className="w-4 h-4" />} label="Список" />
          </div>

          {/* Content */}
          {activeTab === 'overview' && (
            <OverviewTab analytics={analytics} trendIcon={trendIcon} rows={rows} companyName={companyName} extraCompanyId={extraCompanyId} />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsTab analytics={analytics} />
          )}

          {activeTab === 'list' && (
            <ListTab 
              rows={rows} 
              loading={loading} 
              loadingMore={loadingMore} 
              hasMore={hasMore} 
              loadMore={loadMore}
              companyName={companyName}
              companyMap={companyMap}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ================== SUB-COMPONENTS ==================

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function OverviewTab({ analytics, trendIcon, rows, companyName, extraCompanyId }: any) {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Всего расходов"
          value={analytics.total}
          icon={<Wallet className="w-5 h-5" />}
          color="from-red-500 to-orange-500"
          trend={analytics.trend}
          trendIcon={trendIcon}
        />
        <MetricCard
          label="Наличные"
          value={analytics.cash}
          icon={<Banknote className="w-5 h-5" />}
          color="from-amber-500 to-yellow-500"
          percentage={analytics.total ? (analytics.cash / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Kaspi"
          value={analytics.kaspi}
          icon={<Smartphone className="w-5 h-5" />}
          color="from-orange-500 to-red-500"
          percentage={analytics.total ? (analytics.kaspi / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Средний чек"
          value={analytics.avgExpense}
          icon={<Target className="w-5 h-5" />}
          color="from-purple-500 to-pink-500"
        />
      </div>

      {/* Chart & Structure */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-xl">
                <BarChart3 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Динамика расходов</h3>
                <p className="text-xs text-gray-500">По дням с трендом</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className={`text-xs ${analytics.trend === 'up' ? 'text-red-400' : analytics.trend === 'down' ? 'text-green-400' : 'text-gray-400'}`}>
                {analytics.trend === 'up' ? 'Рост' : analytics.trend === 'down' ? 'Снижение' : 'Стабильно'}
              </span>
            </div>
          </div>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.chartData}>
                <defs>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" vertical={false} />
                <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip {...Formatters.tooltip} formatter={(val: number) => [Formatters.moneyDetailed(val), '']} />
                <Area type="monotone" dataKey="total" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
                <Line type="monotone" dataKey="movingAvg" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Среднее (7 дней)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-orange-500/20 rounded-xl">
              <Tag className="w-5 h-5 text-orange-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Структура по категориям</h3>
          </div>
          
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={analytics.categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {analytics.categoryData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [Formatters.moneyDetailed(val), '']} contentStyle={Formatters.tooltip.contentStyle} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-40 overflow-auto">
            {analytics.categoryData.map((cat: any) => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-gray-400 truncate max-w-[100px]">{cat.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(cat.value)}</span>
                  <span className="text-gray-500">({cat.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AI Prediction & Top Category */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-0 bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">AI Прогноз</h3>
          </div>
          
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1">Ожидается в следующем месяце</p>
            <p className="text-2xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
              {Formatters.moneyDetailed(analytics.prediction.value)}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Достоверность</span>
                <span className={analytics.prediction.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>
                  {analytics.prediction.confidence}%
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-red-400 to-orange-400 rounded-full transition-all" style={{ width: `${analytics.prediction.confidence}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-500/20 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ категория</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1 truncate" title={analytics.topCategory[0]}>
            {analytics.topCategory[0]}
          </div>
          <div className="text-2xl font-bold text-yellow-400">{Formatters.moneyDetailed(analytics.topAmount)}</div>
          <p className="text-xs text-gray-500 mt-2">Больше всего расходов</p>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <Zap className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Рекомендация AI</h3>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            {analytics.trend === 'up' 
              ? 'Расходы растут. Рекомендуется пересмотреть бюджет и оптимизировать затраты в категории ' + analytics.topCategory[0]
              : analytics.trend === 'down'
              ? 'Отличная динамика! Расходы снижаются. Продолжайте контролировать бюджет.'
              : 'Стабильная ситуация. Внимательно следите за крупными категориями расходов.'}
          </p>
        </Card>
      </div>

      {/* Recent Expenses */}
      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-xl">
              <Clock className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Последние расходы</h3>
          </div>
        </div>
        
        <div className="space-y-2">
          {rows.slice(0, 5).map((row: ExpenseRow) => (
            <ExpenseRowCompact 
              key={row.id} 
              row={row}
              companyName={companyName(row.company_id)}
              isExtra={extraCompanyId === row.company_id}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function AnalyticsTab({ analytics }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Распределение по способам оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'Наличные', value: analytics.cash, color: '#f59e0b' },
                { name: 'Kaspi', value: analytics.kaspi, color: '#ef4444' }
              ]}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip formatter={(v: number) => Formatters.moneyDetailed(v)} contentStyle={Formatters.tooltip.contentStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  <Cell fill="#f59e0b" />
                  <Cell fill="#ef4444" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Топ категории расходов</h3>
          <div className="space-y-4">
            {analytics.categoryData.map((cat: any, idx: number) => (
              <div key={cat.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">{cat.name}</span>
                  <span className="text-white font-medium">{Formatters.moneyDetailed(cat.value)}</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {analytics.anomalies.length > 0 && (
        <Card className="p-6 border-0 bg-yellow-500/10 border-yellow-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Обнаружены аномалии</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.anomalies.map((a: any, i: number) => (
              <div key={i} className="p-3 bg-gray-800/50 rounded-xl">
                <div className="text-xs text-gray-400 mb-1">{DateUtils.formatDate(a.date)}</div>
                <div className={`text-sm font-medium ${a.type === 'spike' ? 'text-red-400' : 'text-green-400'}`}>
                  {a.type === 'spike' ? '↗ Всплеск' : '↘ Падение'}: {Formatters.moneyDetailed(a.amount)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function ListTab({ rows, loading, loadingMore, hasMore, loadMore, companyName, companyMap }: any) {
  return (
    <Card className="border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900/50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">Дата</th>
              <th className="px-4 py-3 text-left">Компания</th>
              <th className="px-4 py-3 text-left">Категория</th>
              <th className="px-4 py-3 text-right text-red-400">Нал</th>
              <th className="px-4 py-3 text-right text-red-400">Kaspi</th>
              <th className="px-4 py-3 text-right text-white">Итого</th>
              <th className="px-4 py-3 text-left">Комментарий</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.map((row: ExpenseRow, idx: number) => {
              const total = rowTotal(row)
              const company = companyMap.get(row.company_id)
              const isExtra = company?.code === 'extra' || company?.name === 'F16 Extra'

              return (
                <tr
                  key={row.id}
                  className={`border-b border-gray-800/50 hover:bg-white/5 transition-colors ${
                    idx % 2 === 0 ? 'bg-transparent' : 'bg-gray-900/20'
                  } ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/30' : ''}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400 font-mono text-xs">
                    {DateUtils.formatDate(row.date)}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-300">
                    {company?.name ?? '—'}
                    {isExtra && (
                      <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">
                        EXTRA
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700">
                      {row.category || 'Общее'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-amber-400' : 'text-gray-700'}`}>
                    {row.cash_amount ? Formatters.moneyDetailed(row.cash_amount) : '—'}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-red-400' : 'text-gray-700'}`}>
                    {row.kaspi_amount ? Formatters.moneyDetailed(row.kaspi_amount) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-500 font-mono bg-red-500/5">
                    {Formatters.moneyDetailed(total)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                    {row.comment || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 && (
        <div className="p-12 text-center text-gray-500">
          <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Расходов не найдено. Попробуйте изменить фильтры.</p>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center p-4 border-t border-gray-800">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Загружаю...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ChevronDown className="w-4 h-4" /> Загрузить ещё
              </span>
            )}
          </Button>
        </div>
      )}
    </Card>
  )
}

// ================== HELPER COMPONENTS ==================

function MetricCard({ label, value, icon, color, trend, trendIcon, percentage }: any) {
  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm hover:bg-gray-800/80 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color} bg-opacity-20`}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold text-white mb-1">{Formatters.moneyDetailed(value)}</div>
      {percentage !== undefined && (
        <div className="text-xs text-gray-500">{percentage.toFixed(1)}% от общего</div>
      )}
      {trend && (
        <div className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-gray-400'}`}>
          {trendIcon}
          {trend === 'up' ? 'Рост расходов' : trend === 'down' ? 'Снижение' : 'Стабильно'}
        </div>
      )}
    </Card>
  )
}

function ExpenseRowCompact({ row, companyName, isExtra }: any) {
  const total = rowTotal(row)
  
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl transition-all ${
      isExtra ? 'bg-yellow-500/5 border border-yellow-500/20' : 'hover:bg-gray-700/30'
    }`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white truncate flex items-center gap-2">
            {companyName}
            {isExtra && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">EXTRA</span>}
          </span>
          <span className="text-xs text-gray-500 truncate">{row.category || 'Общее'} • {DateUtils.getRelativeDay(row.date)}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        {row.cash_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</span>}
        {row.kaspi_amount > 0 && <span className="text-red-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</span>}
        <span className="text-sm font-bold text-red-500 font-mono min-w-[80px] text-right">{Formatters.moneyDetailed(total)}</span>
      </div>
    </div>
  )
}
