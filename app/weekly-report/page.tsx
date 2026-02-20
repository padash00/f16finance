'use client'

import { 
  Suspense, 
  useCallback, 
  useEffect, 
  useMemo, 
  useRef, 
  useState,
  memo
} from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  PieChart,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Store,
  AlertTriangle,
  CheckCircle2,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  Table,
  Share2,
  RefreshCw,
  Filter,
  X,
  Lightbulb,
  Activity,
  Zap,
  BarChart3,
  Calendar,
  ChevronDown,
  Building2,
  Landmark,
  Percent,
  Scale,
} from 'lucide-react'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart as RechartsPieChart,
  Pie,
  Line,
  ComposedChart,
  Area,
  CartesianGrid,
} from 'recharts'

// =====================
// TYPES
// =====================
type Company = { id: string; name: string; code: string | null }

type IncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type WeekTotals = {
  // Income
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  incomeTotal: number

  // Expenses
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  // Profit
  profit: number

  // Extra
  extraTotal: number

  // By company
  statsByCompany: Record<string, { cash: number; online: number; total: number }>

  // Categories
  expenseCategories: { name: string; value: number; percentage: number }[]

  // Previous period
  prev: {
    incomeTotal: number
    expenseTotal: number
    profit: number
  }

  // Changes
  change: {
    income: string
    expense: string
    profit: string
  }

  // Metrics
  metrics: {
    expenseRate: number
    cashShare: number
    onlineShare: number
    netCash: number
    netOnline: number
    topExpenseName: string | null
    topExpenseShare: number
    profitMargin: number
  }

  // Daily data for charts
  dailyData: DailyDataPoint[]
}

type DailyDataPoint = {
  day: string
  label: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  expenseCash: number
  expenseKaspi: number
}

type InsightType = 'success' | 'warning' | 'danger' | 'info' | 'opportunity'
type Severity = 'low' | 'medium' | 'high' | 'critical'

interface AIInsight {
  type: InsightType
  title: string
  description: string
  metric?: string
  trend?: 'up' | 'down' | 'neutral'
}

// =====================
// CONSTANTS
// =====================
const PIE_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', 
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
] as const

const INSIGHT_STYLES: Record<InsightType, { bg: string; border: string; text: string; icon: React.ElementType }> = {
  success: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: TrendingUp },
  warning: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-400', icon: AlertTriangle },
  danger: { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-400', icon: AlertTriangle },
  opportunity: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', icon: Lightbulb },
  info: { bg: 'bg-gray-800/30', border: 'border-white/5', text: 'text-gray-400', icon: Activity },
}

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// =====================
// UTILITY FUNCTIONS
// =====================
const toISODateLocal = (d: Date): string => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const getTodayISO = (): string => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number): string => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const getWeekBounds = (dateISO: string) => {
  const d = fromISO(dateISO)
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay() // 1..7

  const monday = new Date(d)
  monday.setDate(d.getDate() - (dayOfWeek - 1))

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return { start: toISODateLocal(monday), end: toISODateLocal(sunday) }
}

const formatRangeTitle = (start: string, end: string): string => {
  const d1 = fromISO(start)
  const d2 = fromISO(end)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  return `${d1.toLocaleDateString('ru-RU', opts)} — ${d2.toLocaleDateString('ru-RU', opts)}`
}

const formatDateRange = (from: string, to: string): string => {
  const d1 = fromISO(from)
  const d2 = fromISO(to)
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
  
  if (sameMonth) {
    return `${d1.getDate()}–${d2.getDate()} ${d1.toLocaleDateString('ru-RU', { month: 'long' })} ${d1.getFullYear()}`
  }
  return `${d1.toLocaleDateString('ru-RU')} – ${d2.toLocaleDateString('ru-RU')}`
}

const pctChange = (current: number, previous: number): string => {
  if (previous === 0) return current > 0 ? '+100%' : '—'
  if (current === 0) return '-100%'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

const formatMoneyFull = (n: number): string => {
  if (!Number.isFinite(n)) return '0 ₸'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

const formatMoneyCompact = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' млрд'
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + ' тыс'
  return String(Math.round(n))
}

const formatCompact = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(Math.round(n))
}

const safeNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

// =====================
// CSV & EXPORT UTILITIES
// =====================
const csvEscape = (v: string): string => {
  const s = String(v).replaceAll('"', '""')
  if (/[",\n\r;]/.test(s)) return `"${s}"`
  return s
}

const toCSV = (rows: string[][], sep = ';'): string => 
  rows.map((r) => r.map((c) => csvEscape(c)).join(sep)).join('\n') + '\n'

const downloadTextFile = (filename: string, content: string, mime = 'text/csv'): void => {
  const blob = new Blob(['\uFEFF' + content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// =====================
// MEMOIZED CHART COMPONENTS
// =====================
const MemoizedDailyChart = memo(({ data }: { data: DailyDataPoint[] }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
        <defs>
          <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
        <XAxis 
          dataKey="label" 
          stroke="#6b7280" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false}
          tickMargin={10}
        />
        <YAxis 
          stroke="#6b7280" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false} 
          tickFormatter={formatCompact}
          width={60}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px',
            backdropFilter: 'blur(10px)'
          }}
          formatter={(value: number, name: string) => [formatMoneyFull(value), name === 'income' ? 'Доход' : name === 'expense' ? 'Расход' : 'Прибыль']}
        />
        <Area 
          type="monotone" 
          dataKey="income" 
          stroke="#10b981" 
          strokeWidth={2}
          fill="url(#colorIncome)" 
        />
        <Area 
          type="monotone" 
          dataKey="expense" 
          stroke="#f43f5e" 
          strokeWidth={2}
          fill="url(#colorExpense)" 
        />
        <Line 
          type="monotone" 
          dataKey="profit" 
          stroke="#fbbf24" 
          strokeWidth={3}
          dot={{ fill: '#fbbf24', strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
})
MemoizedDailyChart.displayName = 'MemoizedDailyChart'

const MemoizedPieChart = memo(({ data }: { data: { name: string; value: number; percentage: number }[] }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsPieChart>
        <Pie 
          data={data} 
          cx="50%" 
          cy="50%" 
          innerRadius={60} 
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((_, idx) => (
            <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px' 
          }}
          formatter={(v: number, _n: string, p: { payload?: { percentage?: number } }) => [
            `${formatMoneyFull(v)} (${p?.payload?.percentage?.toFixed(1)}%)`,
            'Сумма'
          ]}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  )
})
MemoizedPieChart.displayName = 'MemoizedPieChart'

const MemoizedBarChart = memo(({ data }: { data: { name: string; cash: number; online: number; total: number }[] }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
        <XAxis 
          dataKey="name" 
          stroke="#6b7280" 
          fontSize={11} 
          tickLine={false} 
          axisLine={false}
          angle={-15}
          textAnchor="end"
          height={60}
        />
        <YAxis 
          stroke="#6b7280" 
          fontSize={11} 
          tickLine={false} 
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '12px' 
          }}
          formatter={(value: number) => formatMoneyFull(value)}
        />
        <Bar dataKey="cash" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} name="Наличные" />
        <Bar dataKey="online" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Онлайн" />
      </BarChart>
    </ResponsiveContainer>
  )
})
MemoizedBarChart.displayName = 'MemoizedBarChart'

// =====================
// UI COMPONENTS
// =====================
const StatCard = memo(({ title, value, subValue, icon: Icon, trend, color = 'blue', onClick }: {
  title: string
  value: string
  subValue?: string
  icon: React.ElementType
  trend?: number
  color?: 'blue' | 'green' | 'red' | 'amber' | 'violet'
  onClick?: () => void
}) => {
  const colors: Record<string, string> = {
    blue: 'from-blue-500 to-cyan-500',
    green: 'from-emerald-500 to-teal-500',
    red: 'from-rose-500 to-pink-500',
    amber: 'from-amber-500 to-orange-500',
    violet: 'from-violet-500 to-purple-500',
  }
  
  return (
    <div 
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6 hover:bg-gray-800/50 transition-all ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${colors[color]} opacity-10 rounded-full blur-3xl translate-x-8 -translate-y-8`} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-2.5 rounded-xl bg-gradient-to-br ${colors[color]} bg-opacity-20`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          {trend !== undefined && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              trend > 0 ? 'bg-emerald-500/20 text-emerald-400' : 
              trend < 0 ? 'bg-rose-500/20 text-rose-400' : 
              'bg-gray-500/20 text-gray-400'
            }`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <p className="text-gray-400 text-sm mb-1">{title}</p>
        <p className="text-2xl font-bold text-white mb-1">{value}</p>
        {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
      </div>
    </div>
  )
})
StatCard.displayName = 'StatCard'

const InsightCard = memo(({ insight, index }: { insight: AIInsight; index: number }) => {
  const styles = INSIGHT_STYLES[insight.type]
  const Icon = styles.icon
  
  return (
    <div 
      className={`relative overflow-hidden rounded-2xl border p-4 ${styles.bg} ${styles.border}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${styles.bg.replace('/5', '/20')} ${styles.text}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white mb-1">{insight.title}</p>
          <p className="text-xs text-gray-400 line-clamp-2">{insight.description}</p>
          {insight.metric && (
            <p className={`text-lg font-bold mt-2 ${styles.text}`}>{insight.metric}</p>
          )}
        </div>
      </div>
    </div>
  )
})
InsightCard.displayName = 'InsightCard'

// =====================
// MAIN COMPONENT
// =====================
function WeeklyReportContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Data states
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoaded, setCompaniesLoaded] = useState(false)
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([])
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Date states
  const todayISO = useMemo(() => getTodayISO(), [])
  const currentWeek = useMemo(() => getWeekBounds(todayISO), [todayISO])

  const [startDate, setStartDate] = useState(currentWeek.start)
  const [endDate, setEndDate] = useState(currentWeek.end)

  // Filter states
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [comparisonMode, setComparisonMode] = useState(true)

  // UI states
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)

  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message: msg, type })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])

  const isCurrentWeek = useMemo(
    () => startDate === currentWeek.start && endDate === currentWeek.end,
    [startDate, endDate, currentWeek.start, currentWeek.end],
  )

  const canGoNext = useMemo(() => {
    const nextStart = addDaysISO(startDate, 7)
    return nextStart <= currentWeek.start
  }, [startDate, currentWeek.start])

  // =====================
  // NAVIGATION
  // =====================
  const handleCurrentWeek = () => {
    setStartDate(currentWeek.start)
    setEndDate(currentWeek.end)
  }

  const shiftWeek = (direction: -1 | 1) => {
    if (direction === 1 && !canGoNext) return
    const nextStart = addDaysISO(startDate, direction * 7)
    const { start, end } = getWeekBounds(nextStart)
    setStartDate(start)
    setEndDate(end)
  }

  // =====================
  // LOAD COMPANIES
  // =====================
  useEffect(() => {
    let alive = true

    const loadCompanies = async () => {
      setError(null)

      const { data, error } = await supabase
        .from('companies')
        .select('id,name,code')
        .order('name', { ascending: true })

      if (!alive) return

      if (error) {
        console.error('loadCompanies error:', error)
        setError('Не удалось загрузить список компаний')
        setCompaniesLoaded(true)
        setLoading(false)
        return
      }

      setCompanies((data || []) as Company[])
      setCompaniesLoaded(true)
    }

    loadCompanies()
    return () => { alive = false }
  }, [])

  // =====================
  // URL SYNC
  // =====================
  useEffect(() => {
    if (didInitFromUrl.current || !companiesLoaded) return

    const sp = searchParams
    const pStart = sp.get('start')
    const pEnd = sp.get('end')
    const pExtra = sp.get('extra') === '1'

    if (pStart && pEnd) {
      setStartDate(pStart)
      setEndDate(pEnd)
    }

    setIncludeExtraInTotals(pExtra)
    didInitFromUrl.current = true
  }, [companiesLoaded, searchParams])

  useEffect(() => {
    if (!didInitFromUrl.current) return

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('start', startDate)
      params.set('end', endDate)
      params.set('extra', includeExtraInTotals ? '1' : '0')

      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [startDate, endDate, includeExtraInTotals, pathname, router])

  // =====================
  // LOAD DATA
  // =====================
  useEffect(() => {
    const load = async () => {
      if (!companiesLoaded) return

      const myId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      const prevStart = addDaysISO(startDate, -7)
      const rangeFrom = prevStart
      const rangeTo = endDate

      try {
        const incomeQ = supabase
          .from('incomes')
          .select('date,company_id,cash_amount,kaspi_amount,card_amount')
          .gte('date', rangeFrom)
          .lte('date', rangeTo)

        const expenseQ = supabase
          .from('expenses')
          .select('date,company_id,category,cash_amount,kaspi_amount')
          .gte('date', rangeFrom)
          .lte('date', rangeTo)

        const [{ data: inc, error: incErr }, { data: exp, error: expErr }] = await Promise.all([
          incomeQ,
          expenseQ,
        ])

        if (myId !== reqIdRef.current) return

        if (incErr || expErr) {
          console.error({ incErr, expErr })
          setError('Не удалось загрузить данные')
          setLoading(false)
          return
        }

        setIncomeRows((inc || []) as IncomeRow[])
        setExpenseRows((exp || []) as ExpenseRow[])
      } catch (err) {
        if (myId === reqIdRef.current) {
          setError('Ошибка загрузки данных')
          console.error(err)
        }
      } finally {
        if (myId === reqIdRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    load()
  }, [companiesLoaded, startDate, endDate])

  // =====================
  // PROCESS DATA
  // =====================
  const extraCompanyId = useMemo(() => {
    const c = companies.find(
      (x) => (x.code || '').toLowerCase() === 'extra' || x.name === 'F16 Extra',
    )
    return c?.id ?? null
  }, [companies])

  const activeCompanies = useMemo(
    () => companies.filter((c) => (c.code || '').toLowerCase() !== 'extra'),
    [companies],
  )

  const totals = useMemo<WeekTotals | null>(() => {
    if (!companies.length) return null

    const prevStart = addDaysISO(startDate, -7)
    const prevEnd = addDaysISO(endDate, -7)

    let iCash = 0
    let iKaspi = 0
    let iCard = 0
    let iOnline = 0

    let eCash = 0
    let eKaspi = 0

    let extraTotal = 0

    let pIncome = 0
    let pExpense = 0

    const statsByCompany: Record<string, { cash: number; online: number; total: number }> = {}
    for (const c of activeCompanies) {
      statsByCompany[c.id] = { cash: 0, online: 0, total: 0 }
    }

    const catMap = new Map<string, number>()
    const dailyMap = new Map<string, DailyDataPoint>()

    // Initialize daily data for all days of the week
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(startDate, i)
      const dayIndex = fromISO(date).getDay()
      const label = DAY_LABELS[dayIndex === 0 ? 6 : dayIndex - 1] // Convert to 0-6 where 0 is Monday
      
      dailyMap.set(date, {
        day: date,
        label,
        income: 0,
        expense: 0,
        profit: 0,
        incomeCash: 0,
        incomeKaspi: 0,
        incomeCard: 0,
        expenseCash: 0,
        expenseKaspi: 0,
      })
    }

    const isExtra = (companyId: string) => !!extraCompanyId && companyId === extraCompanyId
    const inCurrentWeek = (iso: string) => iso >= startDate && iso <= endDate
    const inPrevWeek = (iso: string) => iso >= prevStart && iso <= prevEnd

    // Process incomes
    for (const r of incomeRows) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const card = safeNumber(r.card_amount)
      const online = kaspi + card
      const total = cash + online

      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      if (inPrevWeek(r.date)) {
        if (!extra || includeExtraInTotals) pIncome += total
        continue
      }

      if (!inCurrentWeek(r.date)) continue

      if (extra) {
        extraTotal += total
        if (!includeExtraInTotals) continue
      }

      iCash += cash
      iKaspi += kaspi
      iCard += card
      iOnline += online

      const s = statsByCompany[r.company_id]
      if (s) {
        s.cash += cash
        s.online += online
        s.total += total
      }

      // Add to daily data
      const day = dailyMap.get(r.date)
      if (day) {
        day.income += total
        day.incomeCash += cash
        day.incomeKaspi += kaspi
        day.incomeCard += card
      }
    }

    // Process expenses
    for (const r of expenseRows) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi

      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      if (inPrevWeek(r.date)) {
        if (!extra || includeExtraInTotals) pExpense += total
        continue
      }

      if (!inCurrentWeek(r.date)) continue

      if (extra && !includeExtraInTotals) continue

      eCash += cash
      eKaspi += kaspi

      const catName = (r.category || '').trim() || 'Без категории'
      catMap.set(catName, (catMap.get(catName) || 0) + total)

      // Add to daily data
      const day = dailyMap.get(r.date)
      if (day) {
        day.expense += total
        day.expenseCash += cash
        day.expenseKaspi += kaspi
      }
    }

    const incomeOnline = iKaspi + iCard
    const incomeTotal = iCash + incomeOnline
    const expenseTotal = eCash + eKaspi
    const profit = incomeTotal - expenseTotal

    const pProfit = pIncome - pExpense

    // Calculate daily profit
    for (const day of dailyMap.values()) {
      day.profit = day.income - day.expense
    }

    const dailyData = Array.from(dailyMap.values()).sort((a, b) => a.day.localeCompare(b.day))

    const expenseCategories = Array.from(catMap.entries())
      .map(([name, value]) => ({ 
        name, 
        value,
        percentage: expenseTotal > 0 ? (value / expenseTotal) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    const topExpense = expenseCategories[0] || null

    const expenseRate = incomeTotal > 0 ? (expenseTotal / incomeTotal) * 100 : 0
    const cashShare = incomeTotal > 0 ? (iCash / incomeTotal) * 100 : 0
    const onlineShare = incomeTotal > 0 ? (incomeOnline / incomeTotal) * 100 : 0
    const profitMargin = incomeTotal > 0 ? (profit / incomeTotal) * 100 : 0

    const netCash = iCash - eCash
    const netOnline = incomeOnline - eKaspi

    const topExpenseShare = expenseTotal > 0 && topExpense ? (topExpense.value / expenseTotal) * 100 : 0

    return {
      incomeCash: iCash,
      incomeKaspi: iKaspi,
      incomeCard: iCard,
      incomeOnline,
      incomeTotal,

      expenseCash: eCash,
      expenseKaspi: eKaspi,
      expenseTotal,

      profit,

      extraTotal,
      statsByCompany,
      expenseCategories,

      prev: {
        incomeTotal: pIncome,
        expenseTotal: pExpense,
        profit: pProfit,
      },

      change: {
        income: pctChange(incomeTotal, pIncome),
        expense: pctChange(expenseTotal, pExpense),
        profit: pctChange(profit, pProfit),
      },

      metrics: {
        expenseRate,
        cashShare,
        onlineShare,
        netCash,
        netOnline,
        topExpenseName: topExpense?.name ?? null,
        topExpenseShare,
        profitMargin,
      },

      dailyData,
    }
  }, [
    companies.length,
    activeCompanies,
    extraCompanyId,
    includeExtraInTotals,
    startDate,
    endDate,
    incomeRows,
    expenseRows,
  ])

  // =====================
  // AI INSIGHTS
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    if (!totals) return []

    const insights: AIInsight[] = []

    if (totals.metrics.profitMargin < 10) {
      insights.push({ 
        type: 'danger', 
        title: 'Критически низкая маржинальность', 
        description: `Маржа ${totals.metrics.profitMargin.toFixed(1)}% требует немедленного внимания. Проверьте операционные расходы.`,
        metric: `${totals.metrics.profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (totals.metrics.profitMargin < 20) {
      insights.push({ 
        type: 'warning', 
        title: 'Низкая маржинальность', 
        description: `Маржа ${totals.metrics.profitMargin.toFixed(1)}% ниже рекомендуемой нормы (25-35%).`,
        metric: `${totals.metrics.profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (totals.metrics.profitMargin > 40) {
      insights.push({ 
        type: 'success', 
        title: 'Отличная маржа', 
        description: `Маржа ${totals.metrics.profitMargin.toFixed(1)}% — значительно выше среднерыночной.`,
        metric: `${totals.metrics.profitMargin.toFixed(1)}%`,
        trend: 'up'
      })
    }

    if (totals.metrics.expenseRate > 80) {
      insights.push({
        type: 'warning',
        title: 'Высокая доля расходов',
        description: `Расходы составляют ${totals.metrics.expenseRate.toFixed(1)}% от выручки. Оптимизируйте затраты.`,
        metric: `${totals.metrics.expenseRate.toFixed(1)}%`,
        trend: 'down'
      })
    }

    if (totals.metrics.cashShare > 70) {
      insights.push({
        type: 'opportunity',
        title: 'Преобладание наличных',
        description: 'Высокая доля наличных платежей. Рассмотрите стимулирование безналичных расчётов.',
        metric: `${totals.metrics.cashShare.toFixed(1)}% нал`,
        trend: 'neutral'
      })
    }

    const topExpense = totals.expenseCategories[0]
    if (topExpense && totals.expenseTotal > 0) {
      const share = (topExpense.value / totals.expenseTotal) * 100
      if (share > 40) {
        insights.push({ 
          type: 'warning', 
          title: 'Критическая концентрация расходов', 
          description: `"${topExpense.name}" составляет ${share.toFixed(0)}% всех расходов.`,
          metric: `${share.toFixed(0)}%`,
          trend: 'down'
        })
      }
    }

    if (comparisonMode && totals.prev.incomeTotal > 0) {
      const incomeChange = ((totals.incomeTotal - totals.prev.incomeTotal) / totals.prev.incomeTotal) * 100
      if (Math.abs(incomeChange) > 20) {
        insights.push({
          type: incomeChange > 0 ? 'success' : 'warning',
          title: incomeChange > 0 ? 'Рост выручки' : 'Падение выручки',
          description: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}% к прошлой неделе`,
          metric: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}%`,
          trend: incomeChange > 0 ? 'up' : 'down'
        })
      }
    }

    return insights.slice(0, 5)
  }, [totals, comparisonMode])

  // =====================
  // HANDLERS
  // =====================
  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      showToast('Ссылка скопирована в буфер обмена', 'success')
    } catch {
      showToast('Не удалось скопировать ссылку', 'error')
    }
  }, [showToast])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    // Re-fetch data
    const load = async () => {
      if (!companiesLoaded) return

      const myId = ++reqIdRef.current

      const prevStart = addDaysISO(startDate, -7)
      const rangeFrom = prevStart
      const rangeTo = endDate

      try {
        const incomeQ = supabase
          .from('incomes')
          .select('date,company_id,cash_amount,kaspi_amount,card_amount')
          .gte('date', rangeFrom)
          .lte('date', rangeTo)

        const expenseQ = supabase
          .from('expenses')
          .select('date,company_id,category,cash_amount,kaspi_amount')
          .gte('date', rangeFrom)
          .lte('date', rangeTo)

        const [{ data: inc }, { data: exp }] = await Promise.all([
          incomeQ,
          expenseQ,
        ])

        if (myId === reqIdRef.current) {
          setIncomeRows((inc || []) as IncomeRow[])
          setExpenseRows((exp || []) as ExpenseRow[])
          setRefreshing(false)
          showToast('Данные обновлены', 'success')
        }
      } catch (err) {
        if (myId === reqIdRef.current) {
          setRefreshing(false)
          showToast('Ошибка обновления', 'error')
        }
      }
    }

    load()
  }, [companiesLoaded, startDate, endDate, showToast])

  const handleDownloadCSV = useCallback(() => {
    if (!totals) return

    const rows: string[][] = []

    rows.push(['НЕДЕЛЬНЫЙ ФИНАНСОВЫЙ ОТЧЁТ'])
    rows.push(['Сгенерирован', new Date().toLocaleString('ru-RU')])
    rows.push(['Период', `${startDate} — ${endDate}`])
    rows.push([''])

    rows.push(['СВОДНЫЕ ПОКАЗАТЕЛИ'])
    rows.push(['Показатель', 'Текущая неделя', 'Прошлая неделя', 'Изменение'])
    rows.push(['Выручка', String(Math.round(totals.incomeTotal)), String(Math.round(totals.prev.incomeTotal)), totals.change.income])
    rows.push(['Расходы', String(Math.round(totals.expenseTotal)), String(Math.round(totals.prev.expenseTotal)), totals.change.expense])
    rows.push(['Прибыль', String(Math.round(totals.profit)), String(Math.round(totals.prev.profit)), totals.change.profit])
    rows.push(['Наличные (доход)', String(Math.round(totals.incomeCash)), '', ''])
    rows.push(['Kaspi (доход)', String(Math.round(totals.incomeKaspi)), '', ''])
    rows.push(['Карта (доход)', String(Math.round(totals.incomeCard)), '', ''])
    rows.push(['Онлайн (доход)', String(Math.round(totals.incomeOnline)), '', ''])
    rows.push([''])

    rows.push(['РАСХОДЫ ПО КАТЕГОРИЯМ'])
    rows.push(['Категория', 'Сумма', '% от общих'])
    for (const cat of totals.expenseCategories) {
      rows.push([cat.name, String(Math.round(cat.value)), cat.percentage.toFixed(1)])
    }
    rows.push([''])

    rows.push(['ДОХОДЫ ПО ТОЧКАМ'])
    rows.push(['Точка', 'Наличные', 'Онлайн', 'Всего', 'Доля'])
    for (const c of activeCompanies) {
      const s = totals.statsByCompany[c.id] || { cash: 0, online: 0, total: 0 }
      const share = totals.incomeTotal > 0 ? (s.total / totals.incomeTotal) * 100 : 0
      rows.push([c.name, String(Math.round(s.cash)), String(Math.round(s.online)), String(Math.round(s.total)), share.toFixed(1)])
    }

    downloadTextFile(`weekly_report_${startDate}_${endDate}.csv`, toCSV(rows, ';'))
    showToast('CSV отчёт скачан', 'success')
  }, [totals, startDate, endDate, activeCompanies, showToast])

  // =====================
  // LOADING & ERROR
  // =====================
  if (loading && companies.length === 0) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <p className="text-gray-400">Загрузка недельной аналитики...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Ошибка загрузки</h2>
            <p className="text-gray-400 max-w-md">{error}</p>
            <Button onClick={handleRefresh} variant="outline" className="border-white/10">
              <RefreshCw className="w-4 h-4 mr-2" />
              Повторить
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // =====================
  // MAIN RENDER
  // =====================
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
          {/* Toast */}
          {toast && (
            <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl border backdrop-blur-xl shadow-xl animate-in slide-in-from-top-2 ${
              toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
              toast.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
              'bg-gray-900/80 border-white/10 text-white'
            }`}>
              <div className="text-sm font-medium">{toast.message}</div>
            </div>
          )}

          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <CalendarDays className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Недельный отчёт
                  </h1>
                  <p className="text-gray-400 mt-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatDateRange(startDate, endDate)}
                    {comparisonMode && <span className="text-violet-400">(сравнение с прошлой неделей)</span>}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${comparisonMode ? 'bg-violet-500/20 text-violet-400 border-violet-500/50' : ''}`}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  title="Сравнение с прошлой неделей"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
                  onClick={handleRefresh}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <div className="relative group">
                  <Button 
                    variant="outline" 
                    className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Экспорт
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                  <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-gray-900 border border-white/10 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    <button onClick={handleDownloadCSV} className="w-full px-4 py-2 text-left text-sm hover:bg-white/5 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4" />
                      Скачать CSV
                    </button>
                    <button className="w-full px-4 py-2 text-left text-sm hover:bg-white/5 flex items-center gap-2">
                      <Table className="w-4 h-4" />
                      Скачать Excel
                    </button>
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleShare}
                  title="Поделиться"
                >
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Week Navigation */}
          <Card className="p-4 border-white/5 bg-gray-900/40 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(-1)}
                className="hover:bg-white/10 w-10 h-10 rounded-xl"
                title="Предыдущая неделя"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>

              <div className="text-center">
                <span className="text-lg font-bold text-white block">
                  {formatRangeTitle(startDate, endDate)}
                </span>
                <span className="text-xs text-gray-500 mt-1 block">
                  {isCurrentWeek ? 'Текущая неделя' : 'Архив'}
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(1)}
                disabled={!canGoNext}
                className="hover:bg-white/10 w-10 h-10 rounded-xl disabled:opacity-40"
                title={!canGoNext ? 'Будущие недели недоступны' : 'Следующая неделя'}
              >
                <ChevronRight className="w-5 h-5" />
              </Button>

              {!isCurrentWeek && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-4 bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border-0"
                  onClick={handleCurrentWeek}
                >
                  Текущая неделя
                </Button>
              )}
            </div>
          </Card>

          {/* AI Insights */}
          {aiInsights.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {aiInsights.map((insight, idx) => (
                <InsightCard key={idx} insight={insight} index={idx} />
              ))}
            </div>
          )}

          {/* Filters Bar */}
          <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Фильтры:</span>
              </div>

              <button 
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/50 border border-white/10 text-sm hover:bg-gray-700/50 transition-colors"
              >
                <Filter className="w-4 h-4" />
                Расширенные
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {showFilters && (
              <div className="pt-4 border-t border-white/5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox"
                    checked={includeExtraInTotals}
                    onChange={(e) => setIncludeExtraInTotals(e.target.checked)}
                    className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                  />
                  <span className="text-sm text-gray-300">Включить F16 Extra в итоги</span>
                </label>
              </div>
            )}
          </div>

          {!loading && totals && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard 
                  title="Выручка"
                  value={formatMoneyFull(totals.incomeTotal)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totals.prev.incomeTotal)}` : `${formatMoneyCompact(totals.incomeCash)} нал / ${formatMoneyCompact(totals.incomeOnline)} онлайн`}
                  icon={DollarSign}
                  trend={totals.prev.incomeTotal > 0 ? Number(((totals.incomeTotal - totals.prev.incomeTotal) / totals.prev.incomeTotal * 100).toFixed(1)) : undefined}
                  color="green"
                />
                <StatCard 
                  title="Расходы"
                  value={formatMoneyFull(totals.expenseTotal)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totals.prev.expenseTotal)}` : `${formatMoneyCompact(totals.expenseCash)} нал / ${formatMoneyCompact(totals.expenseKaspi)} Kaspi`}
                  icon={TrendingDown}
                  trend={totals.prev.expenseTotal > 0 ? Number(((totals.expenseTotal - totals.prev.expenseTotal) / totals.prev.expenseTotal * 100).toFixed(1)) : undefined}
                  color="red"
                />
                <StatCard 
                  title="Прибыль"
                  value={formatMoneyFull(totals.profit)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totals.prev.profit)}` : `Маржа ${totals.metrics.profitMargin.toFixed(1)}%`}
                  icon={Wallet}
                  trend={totals.prev.profit !== 0 ? Number(((totals.profit - totals.prev.profit) / Math.abs(totals.prev.profit) * 100).toFixed(1)) : undefined}
                  color={totals.profit >= 0 ? 'blue' : 'red'}
                />
                <StatCard 
                  title="Остаток"
                  value={formatMoneyFull(totals.metrics.netCash + totals.metrics.netOnline)}
                  subValue={`Нал: ${formatMoneyCompact(totals.metrics.netCash)} | Онлайн: ${formatMoneyCompact(totals.metrics.netOnline)}`}
                  icon={Scale}
                  color="violet"
                />
              </div>

              {/* Payment Types Breakdown */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Наличные', value: totals.incomeCash, color: 'text-emerald-400' },
                  { label: 'Kaspi', value: totals.incomeKaspi, color: 'text-blue-400' },
                  { label: 'Карта', value: totals.incomeCard, color: 'text-amber-400' },
                  { label: 'Онлайн всего', value: totals.incomeOnline, color: 'text-violet-400' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className={`text-xl font-bold ${item.color}`}>{formatMoneyFull(item.value)}</p>
                    <p className="text-xs text-gray-500 mt-1">{totals.incomeTotal > 0 ? ((item.value / totals.incomeTotal) * 100).toFixed(1) : 0}%</p>
                  </div>
                ))}
              </div>

              {/* Main Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-violet-400" />
                    Динамика за неделю
                  </h3>
                  <div className="h-80">
                    {mounted && <MemoizedDailyChart data={totals.dailyData} />}
                  </div>
                </div>

                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-rose-400" />
                    Структура расходов
                  </h3>
                  
                  <div className="h-64">
                    {mounted && <MemoizedPieChart data={totals.expenseCategories} />}
                  </div>

                  <div className="mt-4 space-y-2 max-h-48 overflow-auto">
                    {totals.expenseCategories.map((cat, idx) => (
                      <div key={cat.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                          />
                          <span className="text-gray-300 truncate max-w-[120px]">{cat.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-white font-medium">{formatMoneyCompact(cat.value)}</span>
                          <span className="text-gray-500 text-xs ml-2">{cat.percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* By Company */}
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Store className="w-5 h-5 text-blue-400" />
                    Выручка по точкам
                  </h3>

                  <div className="h-80">
                    {mounted && (
                      <MemoizedBarChart 
                        data={activeCompanies.map(c => {
                          const s = totals.statsByCompany[c.id] || { cash: 0, online: 0, total: 0 }
                          return {
                            name: c.name,
                            cash: s.cash,
                            online: s.online,
                            total: s.total
                          }
                        })} 
                      />
                    )}
                  </div>

                  {extraCompanyId && (
                    <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                      <span className="text-sm text-gray-400">F16 Extra</span>
                      <span className="text-sm font-bold text-purple-400">
                        {formatMoneyFull(totals.extraTotal)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {includeExtraInTotals ? '(включено)' : '(отдельно)'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Metrics Cards */}
                <div className="space-y-4">
                  <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                      <Landmark className="w-5 h-5 text-amber-400" />
                      Ключевые метрики
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-white/5 rounded-xl">
                        <p className="text-xs text-gray-500 mb-1">Расходы / Выручка</p>
                        <p className="text-2xl font-bold text-white">{totals.metrics.expenseRate.toFixed(1)}%</p>
                        <p className="text-xs text-gray-500 mt-1">норма &lt; 70%</p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-xl">
                        <p className="text-xs text-gray-500 mb-1">Маржинальность</p>
                        <p className={`text-2xl font-bold ${totals.metrics.profitMargin >= 20 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {totals.metrics.profitMargin.toFixed(1)}%
                        </p>
                        <p className="text-xs text-gray-500 mt-1">цель &gt; 25%</p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-xl">
                        <p className="text-xs text-gray-500 mb-1">Сальдо наличные</p>
                        <p className={`text-xl font-bold ${totals.metrics.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatMoneyCompact(totals.metrics.netCash)}
                        </p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-xl">
                        <p className="text-xs text-gray-500 mb-1">Сальдо онлайн</p>
                        <p className={`text-xl font-bold ${totals.metrics.netOnline >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatMoneyCompact(totals.metrics.netOnline)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Percent className="w-5 h-5 text-emerald-400" />
                      Структура выручки
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Наличные</span>
                          <span className="text-white font-medium">{totals.metrics.cashShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${totals.metrics.cashShare}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Онлайн</span>
                          <span className="text-white font-medium">{totals.metrics.onlineShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${totals.metrics.onlineShare}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Kaspi</span>
                        <span className="text-white">{((totals.incomeKaspi / totals.incomeTotal) * 100 || 0).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span className="text-gray-400">Карта</span>
                        <span className="text-white">{((totals.incomeCard / totals.incomeTotal) * 100 || 0).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// =====================
// EXPORT with Suspense
// =====================
export default function WeeklyReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
                <CalendarDays className="w-8 h-8 text-white" />
              </div>
              <p className="text-gray-400">Загрузка недельного отчёта...</p>
            </div>
          </main>
        </div>
      }
    >
      <WeeklyReportContent />
    </Suspense>
  )
}
