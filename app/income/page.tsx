'use client'

import { useEffect, useMemo, useState, useCallback, useDeferredValue, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import {
  Plus,
  Download,
  Sun,
  Moon,
  Banknote,
  CreditCard,
  Smartphone,
  Search,
  X,
  UserCircle2,
  Trophy,
  MapPin,
  TrendingUp,
  TrendingDown,
  Check,
  Pencil,
  Wallet,
  Globe,
  Sparkles,
  Calendar,
  ChevronDown,
  Brain,
  Activity,
  AlertTriangle,
  Target,
  Zap,
  Clock,
  LineChart,
  BarChart2,
  ArrowRight,
  MinusIcon,
} from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
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

// --- Типы ---
type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type ShiftFilter = 'all' | Shift
type PayFilter = 'all' | 'cash' | 'kaspi' | 'online' | 'card'
type DateRangePreset = 'today' | 'week' | 'month' | 'all'
type OperatorFilter = 'all' | 'none' | string

type ChartPoint = {
  date: string
  cash: number
  kaspi: number
  online: number
  card: number
  total: number
  formattedDate?: string
}

type PaymentData = {
  name: string
  value: number
  color: string
  percentage: number
}

// --- Утилиты дат ---
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

// --- Форматтеры ---
const Formatters = {
  money: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + ' тыс ₸'
    return v.toLocaleString('ru-RU') + ' ₸'
  },

  moneyDetailed: (v: number): string => 
    v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸',

  percentChange: (current: number, previous: number): { value: string; isPositive: boolean } => {
    if (previous === 0) return { value: '—', isPositive: true }
    const change = ((current - previous) / Math.abs(previous)) * 100
    return {
      value: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      isPositive: change >= 0
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
  cash: '#f59e0b',
  kaspi: '#2563eb',
  card: '#7c3aed',
  online: '#ec4899',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
}

// --- AI Аналитика ---
class IncomeAnalytics {
  static detectTrend(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 3) return 'stable'
    const first = data[0]
    const last = data[data.length - 1]
    const change = ((last - first) / (first || 1)) * 100
    
    if (change > 5) return 'up'
    if (change < -5) return 'down'
    return 'stable'
  }

  static predictNextPeriod(data: ChartPoint[]): { value: number; confidence: number } {
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
}

// --- Вспомогательные функции ---
const isExtraCompany = (c?: Company | null) => {
  const code = String(c?.code ?? '').toLowerCase().trim()
  const name = String(c?.name ?? '').toLowerCase().trim()
  return code === 'extra' || name.includes('extra')
}

const stripExtraSuffix = (s: string) => s.replace(/\s*•\s*(PS5|VR)\s*$/i, '').trim()

const parseMoneyInput = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

// --- Главный компонент ---
export default function IncomePage() {
  const LIMIT = 2000

  // Данные
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm)
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [hideExtraRows, setHideExtraRows] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'feed'>('overview')

  // Inline edit
  const [editingOnlineId, setEditingOnlineId] = useState<string | null>(null)
  const [onlineDraft, setOnlineDraft] = useState<string>('')
  const [savingOnlineId, setSavingOnlineId] = useState<string | null>(null)
  const skipBlurSaveRef = useRef(false)

  // Загрузка справочников
  useEffect(() => {
    const fetchRefs = async () => {
      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name'),
        supabase.from('operators').select('id, name, short_name, is_active').eq('is_active', true).order('name'),
      ])
      if (!compRes.error && compRes.data) setCompanies(compRes.data)
      if (!opRes.error && opRes.data) setOperators(opRes.data)
    }
    fetchRefs()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    companies.forEach(c => map.set(c.id, c))
    return map
  }, [companies])

  const operatorMap = useMemo(() => {
    const map = new Map<string, Operator>()
    operators.forEach(o => map.set(o.id, o))
    return map
  }, [operators])

  const companyName = useCallback((id: string) => companyMap.get(id)?.name ?? '—', [companyMap])
  
  const operatorName = useCallback((id: string | null) => {
    if (!id) return 'Без оператора'
    const op = operatorMap.get(id)
    return op?.short_name || op?.name || 'Без оператора'
  }, [operatorMap])

  const extraCompanyId = useMemo(() => {
    const extra = companies.find(c => isExtraCompany(c))
    return extra?.id ?? null
  }, [companies])

  const isExtraRow = useCallback((r: IncomeRow) => !!extraCompanyId && r.company_id === extraCompanyId, [extraCompanyId])

  // Загрузка данных
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      let query = supabase
        .from('incomes')
        .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment')
        .order('date', { ascending: false })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)
      if (companyFilter !== 'all') query = query.eq('company_id', companyFilter)
      if (shiftFilter !== 'all') query = query.eq('shift', shiftFilter)
      if (operatorFilter === 'none') query = query.is('operator_id', null)
      else if (operatorFilter !== 'all') query = query.eq('operator_id', operatorFilter)
      if (payFilter === 'cash') query = query.gt('cash_amount', 0)
      if (payFilter === 'kaspi') query = query.gt('kaspi_amount', 0)
      if (payFilter === 'online') query = query.gt('online_amount', 0)
      if (payFilter === 'card') query = query.gt('card_amount', 0)

      query = query.limit(LIMIT)

      const { data, error } = await query

      if (error) {
        setError('Ошибка при загрузке данных')
        setRows([])
      } else {
        setRows(data || [])
      }
      setLoading(false)
    }
    loadData()
  }, [dateFrom, dateTo, companyFilter, shiftFilter, payFilter, operatorFilter])

  // Фильтрация и агрегация
  const filteredRows = useMemo(() => {
    let base = rows
    if (hideExtraRows && extraCompanyId) {
      base = base.filter(r => r.company_id !== extraCompanyId)
    }

    const q = deferredSearch.trim().toLowerCase()
    if (!q) return base

    return base.filter(r => {
      const comment = r.comment?.toLowerCase() ?? ''
      const zone = r.zone?.toLowerCase() ?? ''
      const op = operatorName(r.operator_id).toLowerCase()
      const comp = companyName(r.company_id).toLowerCase()
      return comment.includes(q) || zone.includes(q) || op.includes(q) || comp.includes(q)
    })
  }, [rows, deferredSearch, operatorName, companyName, hideExtraRows, extraCompanyId])

  // Группировка Extra
  const displayRows = useMemo(() => {
    if (!extraCompanyId) return filteredRows

    const out: IncomeRow[] = []
    const aggs = new Map<string, { row: IncomeRow; comments: Set<string> }>()

    for (const r of filteredRows) {
      if (r.company_id !== extraCompanyId) {
        out.push(r)
        continue
      }

      const key = `${r.date}|${r.shift}|${r.operator_id ?? 'none'}|${r.company_id}`
      const cleanComment = stripExtraSuffix(r.comment ?? '')
      const cmt = cleanComment.length ? cleanComment : ''

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)

      const existing = aggs.get(key)
      if (!existing) {
        const newRow: IncomeRow = {
          id: `extra-${key}`,
          date: r.date,
          company_id: r.company_id,
          operator_id: r.operator_id,
          shift: r.shift,
          zone: 'Extra',
          cash_amount: cash,
          kaspi_amount: kaspi,
          online_amount: online,
          card_amount: card,
          comment: cmt || null,
        }
        const comments = new Set<string>()
        if (cmt) comments.add(cmt)
        aggs.set(key, { row: newRow, comments })
        out.push(newRow)
      } else {
        existing.row.cash_amount = Number(existing.row.cash_amount || 0) + cash
        existing.row.kaspi_amount = Number(existing.row.kaspi_amount || 0) + kaspi
        existing.row.online_amount = Number(existing.row.online_amount || 0) + online
        existing.row.card_amount = Number(existing.row.card_amount || 0) + card
        if (cmt) existing.comments.add(cmt)
        const merged = Array.from(existing.comments).filter(Boolean)
        existing.row.comment = merged.length ? merged.join(' | ') : null
      }
    }
    return out
  }, [filteredRows, extraCompanyId])

  // Аналитика и графики
  const analytics = useMemo(() => {
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)
    const chartMap = new Map<string, ChartPoint>()
    
    dates.forEach(date => {
      chartMap.set(date, {
        date,
        cash: 0,
        kaspi: 0,
        online: 0,
        card: 0,
        total: 0,
        formattedDate: DateUtils.formatDate(date)
      })
    })

    let totalCash = 0, totalKaspi = 0, totalOnline = 0, totalCard = 0
    let dayTotal = 0, nightTotal = 0
    const byOperator: Record<string, number> = {}
    const byZone: Record<string, number> = {}

    displayRows.forEach(r => {
      if (!includeExtraInTotals && isExtraRow(r)) return

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)
      const rowTotal = cash + kaspi + online + card

      totalCash += cash
      totalKaspi += kaspi
      totalOnline += online
      totalCard += card

      if (r.shift === 'day') dayTotal += rowTotal
      else nightTotal += rowTotal

      const opKey = operatorName(r.operator_id)
      byOperator[opKey] = (byOperator[opKey] || 0) + rowTotal

      const z = (r.zone || '—').trim() || '—'
      byZone[z] = (byZone[z] || 0) + rowTotal

      const point = chartMap.get(r.date)
      if (point) {
        point.cash += cash
        point.kaspi += kaspi
        point.online += online
        point.card += card
        point.total += rowTotal
      }
    })

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    
    // Скользящее среднее
    chartData.forEach((point, i) => {
      const start = Math.max(0, i - 6)
      const window = chartData.slice(start, i + 1)
      const avg = window.reduce((sum, p) => sum + p.total, 0) / window.length
      point.movingAvg = avg
    })

    const total = totalCash + totalKaspi + totalOnline + totalCard
    const prediction = IncomeAnalytics.predictNextPeriod(chartData)
    const anomalies = IncomeAnalytics.findAnomalies(chartData)
    const trend = IncomeAnalytics.detectTrend(chartData.map(d => d.total).filter(v => v > 0))

    const topOperator = Object.entries(byOperator).sort((a, b) => b[1] - a[1])[0] || ['—', 0]
    const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    const paymentData: PaymentData[] = [
      { name: 'Наличные', value: totalCash, color: COLORS.cash, percentage: total ? (totalCash / total) * 100 : 0 },
      { name: 'Kaspi POS', value: totalKaspi, color: COLORS.kaspi, percentage: total ? (totalKaspi / total) * 100 : 0 },
      { name: 'Карта', value: totalCard, color: COLORS.card, percentage: total ? (totalCard / total) * 100 : 0 },
      { name: 'Online', value: totalOnline, color: COLORS.online, percentage: total ? (totalOnline / total) * 100 : 0 },
    ].filter(p => p.value > 0)

    return {
      total,
      cash: totalCash,
      kaspi: totalKaspi,
      online: totalOnline,
      card: totalCard,
      dayTotal,
      nightTotal,
      chartData,
      prediction,
      anomalies,
      trend,
      topOperator,
      topZone,
      paymentData,
      avgCheck: displayRows.length ? total / displayRows.length : 0,
    }
  }, [displayRows, dateFrom, dateTo, includeExtraInTotals, isExtraRow, operatorName])

  // Сохранение Online
  const saveOnlineAmount = useCallback(async (row: IncomeRow, nextValue: number | null) => {
    if (String(row.id).startsWith('extra-')) return
    setSavingOnlineId(row.id)
    const current = rows.find(x => x.id === row.id)
    const prev = current?.online_amount ?? null

    if (prev === (nextValue ?? null)) {
      setSavingOnlineId(null)
      return
    }

    setRows(curr => curr.map(x => x.id === row.id ? { ...x, online_amount: nextValue } : x))
    const { error } = await supabase.from('incomes').update({ online_amount: nextValue }).eq('id', row.id)

    if (error) {
      setRows(curr => curr.map(x => x.id === row.id ? { ...x, online_amount: prev } : x))
      setError('Не удалось сохранить Online')
    }
    setSavingOnlineId(null)
  }, [rows])

  // Пресеты дат
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
    setOperatorFilter('all')
    setShiftFilter('all')
    setPayFilter('all')
    setSearchTerm('')
    setIncludeExtraInTotals(false)
    setHideExtraRows(false)
  }

  const periodLabel = dateFrom && dateTo 
    ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}`
    : 'Весь период'

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-6" />
              <Wallet className="w-8 h-8 text-purple-400 absolute top-4 left-1/2 transform -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаем финансовые данные...</p>
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
          {/* Шапка */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-purple-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Журнал доходов
                    </h1>
                    <p className="text-sm text-gray-400">Умная аналитика и прогнозирование</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-purple-500/50 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-purple-400" />
                    <span className="text-gray-300">{periodLabel}</span>
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
                      Extra {includeExtraInTotals ? 'включён' : 'исключён'}
                    </button>
                  )}

                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-xl border border-gray-700">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-gray-400">Прогноз:</span>
                    <span className="text-sm font-medium text-purple-400">{analytics.prediction.confidence}%</span>
                  </div>

                  <Button variant="outline" size="sm" onClick={resetFilters} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                    <X className="w-4 h-4 mr-1" /> Сброс
                  </Button>

                  <Link href="/income/add">
                    <Button size="sm" className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25">
                      <Plus className="w-4 h-4 mr-1" /> Добавить
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Календарь */}
              {isCalendarOpen && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['today', 'week', 'month'] as DateRangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                          activePreset === p
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : 'Месяц'}
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
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">По</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Табы */}
          <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
            <TabButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<LineChart className="w-4 h-4" />} label="Аналитика" />
            <TabButton active={activeTab === 'feed'} onClick={() => setActiveTab('feed')} icon={<Clock className="w-4 h-4" />} label="Операции" />
          </div>

          {/* Контент */}
          {activeTab === 'overview' && (
            <OverviewTab 
              analytics={analytics} 
              displayRows={displayRows}
              companyName={companyName}
              operatorName={operatorName}
              isExtraRow={isExtraRow}
              companyMap={companyMap}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsTab 
              analytics={analytics}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

          {activeTab === 'feed' && (
            <FeedTab 
              displayRows={displayRows}
              companyName={companyName}
              operatorName={operatorName}
              isExtraRow={isExtraRow}
              companyMap={companyMap}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// --- Компоненты табов ---

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
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

function OverviewTab({ 
  analytics, 
  displayRows,
  companyName,
  operatorName,
  isExtraRow,
  companyMap,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  const trendIcon = analytics.trend === 'up' ? <TrendingUp className="w-4 h-4 text-green-400" /> : 
                   analytics.trend === 'down' ? <TrendingDown className="w-4 h-4 text-red-400" /> : 
                   <MinusIcon className="w-4 h-4 text-gray-400" />

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Общий доход"
          value={analytics.total}
          icon={<Wallet className="w-5 h-5" />}
          color="from-purple-500 to-indigo-500"
          trend={analytics.trend}
        />
        <MetricCard
          label="Наличные"
          value={analytics.cash}
          icon={<Banknote className="w-5 h-5" />}
          color="from-amber-500 to-orange-500"
          percentage={analytics.total ? (analytics.cash / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Kaspi + Карта"
          value={analytics.kaspi + analytics.card}
          icon={<CreditCard className="w-5 h-5" />}
          color="from-blue-500 to-cyan-500"
          percentage={analytics.total ? ((analytics.kaspi + analytics.card) / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Online"
          value={analytics.online}
          icon={<Globe className="w-5 h-5" />}
          color="from-pink-500 to-rose-500"
          percentage={analytics.total ? (analytics.online / analytics.total) * 100 : 0}
        />
      </div>

      {/* График и структура */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-xl">
                <LineChart className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Динамика доходов</h3>
                <p className="text-xs text-gray-500">По дням с скользящим средним</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className={`text-xs ${analytics.trend === 'up' ? 'text-green-400' : analytics.trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
                {analytics.trend === 'up' ? 'Рост' : analytics.trend === 'down' ? 'Снижение' : 'Стабильно'}
              </span>
            </div>
          </div>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.chartData}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" vertical={false} />
                <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip {...Formatters.tooltip} formatter={(val: number) => [Formatters.moneyDetailed(val), '']} />
                <Area type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
                <Line type="monotone" dataKey="movingAvg" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Среднее (7 дней)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <BarChart2 className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Структура оплат</h3>
          </div>
          
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={analytics.paymentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {analytics.paymentData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [Formatters.moneyDetailed(val), '']} contentStyle={Formatters.tooltip.contentStyle} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            {analytics.paymentData.map((p: any) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-gray-400">{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(p.value)}</span>
                  <span className="text-gray-500">({p.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AI Прогноз и Топы */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-0 bg-gradient-to-br from-blue-900/30 via-gray-900 to-purple-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">AI Прогноз</h3>
          </div>
          
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1">Ожидается в следующем месяце</p>
            <p className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
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
                <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 rounded-full transition-all" style={{ width: `${analytics.prediction.confidence}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ оператор</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1">{analytics.topOperator[0]}</div>
          <div className="text-2xl font-bold text-amber-400">{Formatters.moneyDetailed(analytics.topOperator[1])}</div>
          <p className="text-xs text-gray-500 mt-2">Лучший результат за период</p>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <MapPin className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ зона</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1">{analytics.topZone[0]}</div>
          <div className="text-2xl font-bold text-blue-400">{Formatters.moneyDetailed(analytics.topZone[1])}</div>
          <p className="text-xs text-gray-500 mt-2">Самая прибыльная локация</p>
        </Card>
      </div>

      {/* Последние операции (компактно) */}
      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <Clock className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Последние операции</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={() => {}} className="text-xs text-gray-400 hover:text-white">
            Все операции <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
        
        <div className="space-y-2">
          {displayRows.slice(0, 5).map((row: IncomeRow) => (
            <IncomeRowCompact 
              key={row.id} 
              row={row} 
              companyName={companyName(row.company_id)}
              operatorName={operatorName(row.operator_id)}
              isExtra={isExtraRow(row)}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function MetricCard({ label, value, icon, color, trend, percentage }: any) {
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
        <div className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
          {trend === 'up' ? '↗ Рост' : trend === 'down' ? '↘ Снижение' : '→ Стабильно'}
        </div>
      )}
    </Card>
  )
}

function IncomeRowCompact({ 
  row, 
  companyName, 
  operatorName, 
  isExtra,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
  
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl transition-all ${
      isExtra ? 'bg-yellow-500/5 border border-yellow-500/20' : 'hover:bg-gray-700/30'
    }`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-2 h-2 rounded-full ${row.shift === 'day' ? 'bg-amber-400' : 'bg-blue-400'}`} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white truncate flex items-center gap-2">
            {companyName}
            {isExtra && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">EXTRA</span>}
          </span>
          <span className="text-xs text-gray-500 truncate">{operatorName} • {row.zone || '—'}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        {row.cash_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</span>}
        {row.kaspi_amount > 0 && <span className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</span>}
        {row.card_amount > 0 && <span className="text-purple-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</span>}
        
        {/* Online с inline редактированием */}
        {String(row.id).startsWith('extra-') ? (
          <span className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</span>
        ) : editingOnlineId === row.id ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              inputMode="numeric"
              value={onlineDraft}
              onChange={(e) => setOnlineDraft(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Escape') {
                  skipBlurSaveRef.current = true
                  setEditingOnlineId(null)
                  setOnlineDraft('')
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const val = parseMoneyInput(onlineDraft)
                  setEditingOnlineId(null)
                  setOnlineDraft('')
                  saveOnlineAmount(row, val)
                }
              }}
              onBlur={() => {
                if (skipBlurSaveRef.current) {
                  skipBlurSaveRef.current = false
                  return
                }
                const val = parseMoneyInput(onlineDraft)
                setEditingOnlineId(null)
                setOnlineDraft('')
                saveOnlineAmount(row, val)
              }}
              className="w-20 h-6 text-right px-1 rounded border border-pink-500 bg-gray-900 text-white text-xs outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingOnlineId(row.id)
              setOnlineDraft(String(row.online_amount ?? ''))
            }}
            className={`font-mono hover:bg-pink-500/10 rounded px-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-gray-600'}`}
          >
            {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+'}
          </button>
        )}

        <span className="text-sm font-bold text-white font-mono min-w-[80px] text-right">{Formatters.moneyDetailed(total)}</span>
      </div>
    </div>
  )
}

function AnalyticsTab({ analytics, dateFrom, dateTo }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">По способам оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.paymentData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip formatter={(v: number) => Formatters.moneyDetailed(v)} contentStyle={Formatters.tooltip.contentStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {analytics.paymentData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Распределение по сменам</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400 flex items-center gap-2"><Sun className="w-4 h-4 text-amber-400" /> День</span>
                <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.dayTotal)}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${analytics.total ? (analytics.dayTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400 flex items-center gap-2"><Moon className="w-4 h-4 text-blue-400" /> Ночь</span>
                <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.nightTotal)}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${analytics.total ? (analytics.nightTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t border-gray-700">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Средний чек</span>
              <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.avgCheck)}</span>
            </div>
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
                <div className={`text-sm font-medium ${a.type === 'spike' ? 'text-green-400' : 'text-red-400'}`}>
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

function FeedTab({ 
  displayRows,
  companyName,
  operatorName,
  isExtraRow,
  companyMap,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  return (
    <Card className="p-0 border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Все операции</h3>
      </div>
      <div className="divide-y divide-gray-800">
        {displayRows.map((row: IncomeRow) => (
          <IncomeRowFull 
            key={row.id} 
            row={row}
            companyName={companyName(row.company_id)}
            operatorName={operatorName(row.operator_id)}
            isExtra={isExtraRow(row)}
            editingOnlineId={editingOnlineId}
            setEditingOnlineId={setEditingOnlineId}
            onlineDraft={onlineDraft}
            setOnlineDraft={setOnlineDraft}
            savingOnlineId={savingOnlineId}
            saveOnlineAmount={saveOnlineAmount}
            skipBlurSaveRef={skipBlurSaveRef}
          />
        ))}
      </div>
    </Card>
  )
}

function IncomeRowFull({ 
  row, 
  companyName, 
  operatorName, 
  isExtra,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
  
  return (
    <div className={`p-4 hover:bg-gray-700/30 transition-colors ${isExtra ? 'bg-yellow-500/5' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${row.shift === 'day' ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}>
            {row.shift === 'day' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{companyName}</span>
              {isExtra && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">EXTRA</span>}
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
              <UserCircle2 className="w-3 h-3" />
              {operatorName}
              <span className="text-gray-600">•</span>
              {row.zone || '—'}
              <span className="text-gray-600">•</span>
              {DateUtils.formatDate(row.date, 'full')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-sm">
            {row.cash_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Нал</div>
                <div className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</div>
              </div>
            )}
            {row.kaspi_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Kaspi</div>
                <div className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</div>
              </div>
            )}
            {row.card_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Карта</div>
                <div className="text-purple-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</div>
              </div>
            )}
            
            {/* Online с inline редактированием */}
            <div className="text-right">
              <div className="text-[10px] text-gray-500">Online</div>
              {String(row.id).startsWith('extra-') ? (
                <div className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</div>
              ) : editingOnlineId === row.id ? (
                <input
                  autoFocus
                  inputMode="numeric"
                  value={onlineDraft}
                  onChange={(e) => setOnlineDraft(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Escape') {
                      skipBlurSaveRef.current = true
                      setEditingOnlineId(null)
                      setOnlineDraft('')
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const val = parseMoneyInput(onlineDraft)
                      setEditingOnlineId(null)
                      setOnlineDraft('')
                      saveOnlineAmount(row, val)
                    }
                  }}
                  onBlur={() => {
                    if (skipBlurSaveRef.current) {
                      skipBlurSaveRef.current = false
                      return
                    }
                    const val = parseMoneyInput(onlineDraft)
                    setEditingOnlineId(null)
                    setOnlineDraft('')
                    saveOnlineAmount(row, val)
                  }}
                  className="w-24 h-7 text-right px-2 rounded border border-pink-500 bg-gray-900 text-white text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingOnlineId(row.id)
                    setOnlineDraft(String(row.online_amount ?? ''))
                  }}
                  className={`font-mono hover:bg-pink-500/10 rounded px-2 py-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-gray-600'}`}
                >
                  {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+ добавить'}
                </button>
              )}
            </div>
          </div>

          <div className="text-right min-w-[100px]">
            <div className="text-[10px] text-gray-500">Итого</div>
            <div className="text-lg font-bold text-white font-mono">{Formatters.moneyDetailed(total)}</div>
          </div>
        </div>
      </div>
      {row.comment && (
        <div className="mt-2 text-xs text-gray-500 pl-12">{row.comment}</div>
      )}
    </div>
  )
}
