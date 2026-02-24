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
  Coins,
  Banknote,
  ArrowRightLeft,
  Sparkles,
  Receipt,
  BadgeDollarSign,
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
  Legend,
} from 'recharts'

// =====================
// TYPES (с фокусом на сальдо)
// =====================
type Company = { id: string; name: string; code: string | null }

type IncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null  // ✅ ОБЯЗАТЕЛЬНО учитываем
  card_amount: number | null
}

type ExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

// Основные типы для сальдо
type WeekTotals = {
  // Доходы по типам
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number      // kaspi + online + card
  incomeTotal: number

  // Расходы по типам
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  // САЛЬДО (ключевые показатели)
  netCash: number            // incomeCash - expenseCash
  netNonCash: number         // incomeNonCash - expenseKaspi
  netTotal: number           // profit = incomeTotal - expenseTotal

  // Прибыль (для совместимости)
  profit: number

  // Extra компания
  extraTotal: number

  // По компаниям
  statsByCompany: Record<string, { 
    cash: number; 
    kaspi: number;
    online: number;
    card: number;
    nonCash: number; 
    total: number;
    expenseCash: number;
    expenseKaspi: number;
    netCash: number;
    netNonCash: number;
  }>

  // Категории расходов
  expenseCategories: { name: string; value: number; percentage: number }[]

  // Предыдущий период
  prev: {
    incomeTotal: number
    expenseTotal: number
    profit: number
    netCash: number
    netNonCash: number
  }

  // Изменения
  change: {
    income: string
    expense: string
    profit: string
    netCash: string
    netNonCash: string
  }

  // Метрики (расширенные)
  metrics: {
    // Соотношения
    expenseRate: number      // расходы / выручка
    cashShare: number        // доля наличных в доходах
    nonCashShare: number     // доля безнала в доходах
    
    // Структура безнала
    kaspiShare: number
    onlineShare: number
    cardShare: number
    
    // Сальдо
    netCash: number
    netNonCash: number
    netTotal: number
    
    // Маржинальность
    profitMargin: number
    
    // Топ расходов
    topExpenseName: string | null
    topExpenseShare: number
    
    // Прогноз (простая экстраполяция)
    projectedNetCash: number
    projectedNetNonCash: number
    projectedNetTotal: number
  }

  // Данные по дням для графиков
  dailyData: DailyDataPoint[]
  
  // Данные по сальдо для графиков
  balanceHistory: BalancePoint[]
}

type DailyDataPoint = {
  day: string
  label: string
  date: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  netCash: number           // сальдо наличных за день
  netNonCash: number        // сальдо безнала за день
}

type BalancePoint = {
  date: string
  label: string
  cashBalance: number       // накопленное сальдо наличных
  nonCashBalance: number    // накопленное сальдо безнала
  totalBalance: number      // накопленное общее сальдо
}

type InsightType = 'success' | 'warning' | 'danger' | 'info' | 'opportunity'

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
const BALANCE_COLORS = {
  cash: '#10b981',      // зелёный - наличные
  nonCash: '#3b82f6',   // синий - безнал
  total: '#8b5cf6',     // фиолетовый - общее
  expense: '#ef4444',   // красный - расходы
} as const

const PAYMENT_COLORS = {
  cash: '#10b981',
  kaspi: '#3b82f6',
  online: '#8b5cf6',
  card: '#f59e0b',
} as const

const PIE_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', 
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
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay()

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

// График динамики доходов/расходов
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
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              income: 'Доход',
              expense: 'Расход',
              profit: 'Прибыль'
            }
            return [formatMoneyFull(value), labels[name] || name]
          }}
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

// ГРАФИК САЛЬДО (накопленное сальдо по дням)
const MemoizedBalanceChart = memo(({ data }: { data: BalancePoint[] }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
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
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              cashBalance: 'Сальдо наличных',
              nonCashBalance: 'Сальдо безнала',
              totalBalance: 'Общее сальдо'
            }
            return [formatMoneyFull(value), labels[name] || name]
          }}
        />
        <Area 
          type="monotone" 
          dataKey="cashBalance" 
          stackId="1"
          stroke="#10b981" 
          strokeWidth={2}
          fill="#10b981"
          fillOpacity={0.3}
        />
        <Area 
          type="monotone" 
          dataKey="nonCashBalance" 
          stackId="1"
          stroke="#3b82f6" 
          strokeWidth={2}
          fill="#3b82f6"
          fillOpacity={0.3}
        />
        <Line 
          type="monotone" 
          dataKey="totalBalance" 
          stroke="#8b5cf6" 
          strokeWidth={3}
          dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
})
MemoizedBalanceChart.displayName = 'MemoizedBalanceChart'

// Круговая диаграмма расходов
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

// Столбчатая диаграмма по компаниям
const MemoizedBarChart = memo(({ data }: { data: { name: string; cash: number; kaspi: number; online: number; card: number; total: number }[] }) => {
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
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              cash: 'Наличные',
              kaspi: 'Kaspi',
              online: 'Online',
              card: 'Карта'
            }
            return [formatMoneyFull(value), labels[name] || name]
          }}
        />
        <Bar dataKey="cash" stackId="a" fill={PAYMENT_COLORS.cash} radius={[4, 4, 0, 0]} />
        <Bar dataKey="kaspi" stackId="a" fill={PAYMENT_COLORS.kaspi} radius={[4, 4, 0, 0]} />
        <Bar dataKey="online" stackId="a" fill={PAYMENT_COLORS.online} radius={[4, 4, 0, 0]} />
        <Bar dataKey="card" stackId="a" fill={PAYMENT_COLORS.card} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
})
MemoizedBarChart.displayName = 'MemoizedBarChart'

// =====================
// UI COMPONENTS
// =====================
const StatCard = memo(({ title, value, subValue, icon: Icon, trend, color = 'blue', onClick, highlight = false }: {
  title: string
  value: string
  subValue?: string
  icon: React.ElementType
  trend?: number
  color?: 'blue' | 'green' | 'red' | 'amber' | 'violet'
  onClick?: () => void
  highlight?: boolean
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
      className={`relative overflow-hidden rounded-2xl backdrop-blur-xl border p-6 transition-all ${
        highlight 
          ? 'bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border-violet-500/30 shadow-lg shadow-violet-500/10' 
          : 'bg-gray-900/40 border-white/5 hover:bg-gray-800/50'
      } ${onClick ? 'cursor-pointer' : ''}`}
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
        <p className={`text-2xl font-bold mb-1 ${highlight ? 'text-white' : 'text-white'}`}>{value}</p>
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
      className={`relative overflow-hidden rounded-xl border p-3 ${styles.bg} ${styles.border}`}
    >
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-lg ${styles.bg.replace('/5', '/20')} ${styles.text}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white mb-0.5">{insight.title}</p>
          <p className="text-[11px] text-gray-400 line-clamp-2">{insight.description}</p>
          {insight.metric && (
            <p className={`text-sm font-bold mt-1 ${styles.text}`}>{insight.metric}</p>
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
  // LOAD DATA (с online_amount)
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
        // ✅ ВАЖНО: включаем online_amount в запрос
        const incomeQ = supabase
          .from('incomes')
          .select('date,company_id,cash_amount,kaspi_amount,online_amount,card_amount')
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
  // PROCESS DATA (с фокусом на сальдо)
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

    // Доходы
    let iCash = 0
    let iKaspi = 0
    let iOnline = 0
    let iCard = 0
    let iNonCash = 0

    // Расходы
    let eCash = 0
    let eKaspi = 0

    // Extra
    let extraTotal = 0

    // Предыдущий период
    let pIncome = 0
    let pExpense = 0
    let pNetCash = 0
    let pNetNonCash = 0

    // Статистика по компаниям (расширенная)
    const statsByCompany: Record<string, { 
      cash: number; 
      kaspi: number;
      online: number;
      card: number;
      nonCash: number; 
      total: number;
      expenseCash: number;
      expenseKaspi: number;
      netCash: number;
      netNonCash: number;
    }> = {}
    
    for (const c of activeCompanies) {
      statsByCompany[c.id] = { 
        cash: 0, 
        kaspi: 0, 
        online: 0, 
        card: 0, 
        nonCash: 0,
        total: 0,
        expenseCash: 0,
        expenseKaspi: 0,
        netCash: 0,
        netNonCash: 0,
      }
    }

    const catMap = new Map<string, number>()
    
    // Данные по дням
    const dailyMap = new Map<string, DailyDataPoint>()
    const balanceMap = new Map<string, { cash: number; nonCash: number }>()

    // Инициализация всех дней недели
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(startDate, i)
      const dayIndex = fromISO(date).getDay()
      const label = DAY_LABELS[dayIndex === 0 ? 6 : dayIndex - 1]
      
      dailyMap.set(date, {
        day: date,
        label,
        date,
        income: 0,
        expense: 0,
        profit: 0,
        incomeCash: 0,
        incomeKaspi: 0,
        incomeOnline: 0,
        incomeCard: 0,
        incomeNonCash: 0,
        expenseCash: 0,
        expenseKaspi: 0,
        netCash: 0,
        netNonCash: 0,
      })
      
      balanceMap.set(date, { cash: 0, nonCash: 0 })
    }

    const isExtra = (companyId: string) => !!extraCompanyId && companyId === extraCompanyId
    const inCurrentWeek = (iso: string) => iso >= startDate && iso <= endDate
    const inPrevWeek = (iso: string) => iso >= prevStart && iso <= prevEnd

    // ===== ОБРАБОТКА ДОХОДОВ =====
    for (const r of incomeRows) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const online = safeNumber(r.online_amount)  // ✅ учитываем online_amount
      const card = safeNumber(r.card_amount)
      
      const nonCash = kaspi + online + card
      const total = cash + nonCash

      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      // Предыдущая неделя
      if (inPrevWeek(r.date)) {
        if (!extra || includeExtraInTotals) {
          pIncome += total
          pNetCash += cash
          pNetNonCash += nonCash
        }
        continue
      }

      // Текущая неделя
      if (!inCurrentWeek(r.date)) continue

      if (extra) {
        extraTotal += total
        if (!includeExtraInTotals) continue
      }

      // Добавляем к общим счётчикам
      iCash += cash
      iKaspi += kaspi
      iOnline += online
      iCard += card
      iNonCash += nonCash

      // Статистика по компаниям
      const s = statsByCompany[r.company_id]
      if (s) {
        s.cash += cash
        s.kaspi += kaspi
        s.online += online
        s.card += card
        s.nonCash += nonCash
        s.total += total
      }

      // Добавляем к дневным данным
      const day = dailyMap.get(r.date)
      if (day) {
        day.income += total
        day.incomeCash += cash
        day.incomeKaspi += kaspi
        day.incomeOnline += online
        day.incomeCard += card
        day.incomeNonCash += nonCash
      }

      // Для сальдо (накопленное)
      const bal = balanceMap.get(r.date)
      if (bal) {
        bal.cash += cash
        bal.nonCash += nonCash
      }
    }

    // ===== ОБРАБОТКА РАСХОДОВ =====
    for (const r of expenseRows) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi

      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      // Предыдущая неделя
      if (inPrevWeek(r.date)) {
        if (!extra || includeExtraInTotals) {
          pExpense += total
          // Для предыдущей недели считаем сальдо по-другому (опционально)
        }
        continue
      }

      // Текущая неделя
      if (!inCurrentWeek(r.date)) continue

      if (extra && !includeExtraInTotals) continue

      eCash += cash
      eKaspi += kaspi

      const catName = (r.category || '').trim() || 'Без категории'
      catMap.set(catName, (catMap.get(catName) || 0) + total)

      // Добавляем к дневным данным
      const day = dailyMap.get(r.date)
      if (day) {
        day.expense += total
        day.expenseCash += cash
        day.expenseKaspi += kaspi
      }

      // Для сальдо (расходы вычитаются)
      const bal = balanceMap.get(r.date)
      if (bal) {
        bal.cash -= cash
        bal.nonCash -= kaspi  // предполагаем, что kaspi расходы из безнала
      }
    }

    // Итоговые показатели
    const incomeTotal = iCash + iNonCash
    const expenseTotal = eCash + eKaspi
    const profit = incomeTotal - expenseTotal
    
    const netCash = iCash - eCash
    const netNonCash = iNonCash - eKaspi
    const netTotal = netCash + netNonCash

    // Данные по дням с расчётом сальдо
    const dailyData: DailyDataPoint[] = []
    const balanceHistory: BalancePoint[] = []
    
    let runningCashBalance = 0
    let runningNonCashBalance = 0
    
    // Сортируем дни по возрастанию
    const sortedDays = Array.from(dailyMap.keys()).sort()
    
    for (const date of sortedDays) {
      const day = dailyMap.get(date)!
      
      // Дневное сальдо
      day.netCash = day.incomeCash - day.expenseCash
      day.netNonCash = day.incomeNonCash - day.expenseKaspi
      day.profit = day.income - day.expense
      
      dailyData.push(day)
      
      // Накопленное сальдо
      const dayBalance = balanceMap.get(date) || { cash: 0, nonCash: 0 }
      runningCashBalance += dayBalance.cash
      runningNonCashBalance += dayBalance.nonCash
      
      balanceHistory.push({
        date,
        label: day.label,
        cashBalance: runningCashBalance,
        nonCashBalance: runningNonCashBalance,
        totalBalance: runningCashBalance + runningNonCashBalance,
      })
    }

    // Категории расходов
    const expenseCategories = Array.from(catMap.entries())
      .map(([name, value]) => ({ 
        name, 
        value,
        percentage: expenseTotal > 0 ? (value / expenseTotal) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    const topExpense = expenseCategories[0] || null

    // Метрики
    const expenseRate = incomeTotal > 0 ? (expenseTotal / incomeTotal) * 100 : 0
    const cashShare = incomeTotal > 0 ? (iCash / incomeTotal) * 100 : 0
    const nonCashShare = incomeTotal > 0 ? (iNonCash / incomeTotal) * 100 : 0
    const kaspiShare = incomeTotal > 0 ? (iKaspi / incomeTotal) * 100 : 0
    const onlineShare = incomeTotal > 0 ? (iOnline / incomeTotal) * 100 : 0
    const cardShare = incomeTotal > 0 ? (iCard / incomeTotal) * 100 : 0
    const profitMargin = incomeTotal > 0 ? (profit / incomeTotal) * 100 : 0

    const topExpenseShare = expenseTotal > 0 && topExpense ? (topExpense.value / expenseTotal) * 100 : 0

    // Простой прогноз (если бы неделя продолжалась с теми же темпами)
    const projectedNetCash = netCash * 1.1
    const projectedNetNonCash = netNonCash * 1.1
    const projectedNetTotal = netTotal * 1.1

    // Обновляем статистику по компаниям с сальдо
    for (const c of activeCompanies) {
      const s = statsByCompany[c.id]
      if (s) {
        s.netCash = s.cash - s.expenseCash
        s.netNonCash = s.nonCash - s.expenseKaspi
      }
    }

    return {
      // Доходы
      incomeCash: iCash,
      incomeKaspi: iKaspi,
      incomeOnline: iOnline,
      incomeCard: iCard,
      incomeNonCash: iNonCash,
      incomeTotal,

      // Расходы
      expenseCash: eCash,
      expenseKaspi: eKaspi,
      expenseTotal,

      // Сальдо
      netCash,
      netNonCash,
      netTotal,
      profit,

      // Extra
      extraTotal,

      // По компаниям
      statsByCompany,
      expenseCategories,

      // Предыдущий период
      prev: {
        incomeTotal: pIncome,
        expenseTotal: pExpense,
        profit: pIncome - pExpense,
        netCash: pNetCash,
        netNonCash: pNetNonCash,
      },

      // Изменения
      change: {
        income: pctChange(incomeTotal, pIncome),
        expense: pctChange(expenseTotal, pExpense),
        profit: pctChange(profit, pIncome - pExpense),
        netCash: pctChange(netCash, pNetCash),
        netNonCash: pctChange(netNonCash, pNetNonCash),
      },

      // Метрики
      metrics: {
        expenseRate,
        cashShare,
        nonCashShare,
        kaspiShare,
        onlineShare,
        cardShare,
        netCash,
        netNonCash,
        netTotal,
        profitMargin,
        topExpenseName: topExpense?.name ?? null,
        topExpenseShare,
        projectedNetCash,
        projectedNetNonCash,
        projectedNetTotal,
      },

      dailyData,
      balanceHistory,
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
  // AI INSIGHTS (с фокусом на сальдо)
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    if (!totals) return []

    const insights: AIInsight[] = []
    const { metrics, change } = totals

    // Общее сальдо
    if (metrics.netTotal < 0) {
      insights.push({ 
        type: 'danger', 
        title: 'Отрицательное общее сальдо', 
        description: `Общий баланс отрицательный: ${formatMoneyCompact(metrics.netTotal)}. Расходы превышают доходы.`,
        metric: formatMoneyCompact(metrics.netTotal),
        trend: 'down'
      })
    } else if (metrics.netTotal > 0) {
      insights.push({ 
        type: 'success', 
        title: 'Положительное сальдо', 
        description: `Общий баланс положительный: ${formatMoneyCompact(metrics.netTotal)}. Хороший результат.`,
        metric: formatMoneyCompact(metrics.netTotal),
        trend: 'up'
      })
    }

    // Сальдо наличных
    if (metrics.netCash < 0) {
      insights.push({ 
        type: 'warning', 
        title: 'Отрицательное сальдо наличных', 
        description: `Наличные расходы превышают доходы на ${formatMoneyCompact(Math.abs(metrics.netCash))}`,
        metric: formatMoneyCompact(metrics.netCash),
      })
    }

    // Сальдо безнала
    if (metrics.netNonCash < 0) {
      insights.push({ 
        type: 'warning', 
        title: 'Отрицательное сальдо безнала', 
        description: `Безналичные расходы превышают доходы на ${formatMoneyCompact(Math.abs(metrics.netNonCash))}`,
        metric: formatMoneyCompact(metrics.netNonCash),
      })
    }

    // Маржинальность
    if (metrics.profitMargin < 10) {
      insights.push({ 
        type: 'danger', 
        title: 'Критически низкая маржинальность', 
        description: `Маржа ${metrics.profitMargin.toFixed(1)}% требует немедленного внимания.`,
        metric: `${metrics.profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (metrics.profitMargin > 30) {
      insights.push({ 
        type: 'success', 
        title: 'Отличная маржинальность', 
        description: `Маржа ${metrics.profitMargin.toFixed(1)}% — выше среднего.`,
        metric: `${metrics.profitMargin.toFixed(1)}%`,
        trend: 'up'
      })
    }

    // Доля расходов
    if (metrics.expenseRate > 80) {
      insights.push({
        type: 'warning',
        title: 'Высокая доля расходов',
        description: `Расходы составляют ${metrics.expenseRate.toFixed(1)}% от выручки. Оптимизируйте затраты.`,
        metric: `${metrics.expenseRate.toFixed(1)}%`,
        trend: 'down'
      })
    }

    // Структура платежей
    if (metrics.cashShare > 70) {
      insights.push({
        type: 'opportunity',
        title: 'Преобладание наличных',
        description: 'Высокая доля наличных платежей. Стимулируйте безналичные расчёты.',
        metric: `${metrics.cashShare.toFixed(1)}% нал`,
        trend: 'neutral'
      })
    } else if (metrics.nonCashShare > 70) {
      insights.push({
        type: 'info',
        title: 'Преобладание безнала',
        description: 'Большинство платежей безналичные. Хорошо для учёта.',
        metric: `${metrics.nonCashShare.toFixed(1)}% безнал`,
        trend: 'neutral'
      })
    }

    // Сравнение с прошлой неделей
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

    // Топ расходов
    const topExpense = totals.expenseCategories[0]
    if (topExpense && topExpense.percentage > 40) {
      insights.push({ 
        type: 'warning', 
        title: 'Концентрация расходов', 
        description: `"${topExpense.name}" — ${topExpense.percentage.toFixed(0)}% всех расходов`,
        metric: `${topExpense.percentage.toFixed(0)}%`,
      })
    }

    // Прогноз
    if (metrics.projectedNetTotal > metrics.netTotal * 1.2) {
      insights.push({
        type: 'opportunity',
        title: 'Оптимистичный прогноз',
        description: `При сохранении темпов сальдо вырастет до ${formatMoneyCompact(metrics.projectedNetTotal)}`,
        metric: formatMoneyCompact(metrics.projectedNetTotal),
        trend: 'up'
      })
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
    const load = async () => {
      if (!companiesLoaded) return

      const myId = ++reqIdRef.current

      const prevStart = addDaysISO(startDate, -7)
      const rangeFrom = prevStart
      const rangeTo = endDate

      try {
        const incomeQ = supabase
          .from('incomes')
          .select('date,company_id,cash_amount,kaspi_amount,online_amount,card_amount')
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

    rows.push(['НЕДЕЛЬНЫЙ ФИНАНСОВЫЙ ОТЧЁТ - САЛЬДО'])
    rows.push(['Сгенерирован', new Date().toLocaleString('ru-RU')])
    rows.push(['Период', `${startDate} — ${endDate}`])
    rows.push([''])

    rows.push(['СВОДНЫЕ ПОКАЗАТЕЛИ'])
    rows.push(['Показатель', 'Значение', 'Прошлая неделя', 'Изменение'])
    rows.push(['Выручка', String(Math.round(totals.incomeTotal)), String(Math.round(totals.prev.incomeTotal)), totals.change.income])
    rows.push(['Расходы', String(Math.round(totals.expenseTotal)), String(Math.round(totals.prev.expenseTotal)), totals.change.expense])
    rows.push(['Прибыль', String(Math.round(totals.profit)), String(Math.round(totals.prev.profit)), totals.change.profit])
    rows.push([''])
    rows.push(['САЛЬДО НАЛИЧНЫХ', String(Math.round(totals.netCash)), String(Math.round(totals.prev.netCash)), totals.change.netCash])
    rows.push(['САЛЬДО БЕЗНАЛА', String(Math.round(totals.netNonCash)), String(Math.round(totals.prev.netNonCash)), totals.change.netNonCash])
    rows.push(['ОБЩЕЕ САЛЬДО', String(Math.round(totals.netTotal)), '', ''])
    rows.push([''])

    rows.push(['ДОХОДЫ ПО ТИПАМ'])
    rows.push(['Наличные', String(Math.round(totals.incomeCash)), totals.metrics.cashShare.toFixed(1) + '%'])
    rows.push(['Kaspi', String(Math.round(totals.incomeKaspi)), totals.metrics.kaspiShare.toFixed(1) + '%'])
    rows.push(['Online', String(Math.round(totals.incomeOnline)), totals.metrics.onlineShare.toFixed(1) + '%'])
    rows.push(['Карта', String(Math.round(totals.incomeCard)), totals.metrics.cardShare.toFixed(1) + '%'])
    rows.push(['Всего безнал', String(Math.round(totals.incomeNonCash)), totals.metrics.nonCashShare.toFixed(1) + '%'])
    rows.push([''])

    rows.push(['РАСХОДЫ ПО КАТЕГОРИЯМ'])
    rows.push(['Категория', 'Сумма', '% от общих'])
    for (const cat of totals.expenseCategories) {
      rows.push([cat.name, String(Math.round(cat.value)), cat.percentage.toFixed(1)])
    }
    rows.push([''])

    rows.push(['ДОХОДЫ ПО ТОЧКАМ'])
    rows.push(['Точка', 'Наличные', 'Kaspi', 'Online', 'Карта', 'Всего', 'Сальдо нал', 'Сальдо безнал'])
    for (const c of activeCompanies) {
      const s = totals.statsByCompany[c.id] || { 
        cash: 0, kaspi: 0, online: 0, card: 0, total: 0,
        expenseCash: 0, expenseKaspi: 0, netCash: 0, netNonCash: 0
      }
      rows.push([
        c.name, 
        String(Math.round(s.cash)), 
        String(Math.round(s.kaspi)), 
        String(Math.round(s.online)), 
        String(Math.round(s.card)), 
        String(Math.round(s.total)),
        String(Math.round(s.netCash)),
        String(Math.round(s.netNonCash)),
      ])
    }

    downloadTextFile(`weekly_balance_${startDate}_${endDate}.csv`, toCSV(rows, ';'))
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
                    Недельный баланс
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
              {/* ===== КАРТОЧКИ САЛЬДО (ГЛАВНЫЙ ФОКУС) ===== */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="САЛЬДО НАЛИЧНЫХ"
                  value={formatMoneyFull(totals.netCash)}
                  subValue={`Доход: ${formatMoneyCompact(totals.incomeCash)} | Расход: ${formatMoneyCompact(totals.expenseCash)}`}
                  icon={Coins}
                  trend={comparisonMode && totals.prev.netCash !== 0 ? Number(totals.change.netCash.replace('%', '')) : undefined}
                  color="green"
                  highlight={totals.netCash > 0}
                />

                <StatCard
                  title="САЛЬДО БЕЗНАЛА"
                  value={formatMoneyFull(totals.netNonCash)}
                  subValue={`Доход: ${formatMoneyCompact(totals.incomeNonCash)} | Расход: ${formatMoneyCompact(totals.expenseKaspi)}`}
                  icon={CreditCard}
                  trend={comparisonMode && totals.prev.netNonCash !== 0 ? Number(totals.change.netNonCash.replace('%', '')) : undefined}
                  color="blue"
                  highlight={totals.netNonCash > 0}
                />

                <StatCard
                  title="ОБЩЕЕ САЛЬДО"
                  value={formatMoneyFull(totals.netTotal)}
                  subValue={`Прибыль: ${formatMoneyCompact(totals.profit)}`}
                  icon={Scale}
                  trend={comparisonMode ? Number(totals.change.profit.replace('%', '')) : undefined}
                  color="violet"
                  highlight={totals.netTotal > 0}
                />

                <StatCard
                  title="ПРОГНОЗ НА КОНЕЦ ПЕРИОДА"
                  value={formatMoneyFull(totals.metrics.projectedNetTotal)}
                  subValue={`+10% при сохранении темпов`}
                  icon={Sparkles}
                  color="amber"
                />
              </div>

              {/* Доходы и расходы по типам */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Доходы по типам
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Наличные</span>
                      <span className="text-sm font-medium text-emerald-400">{formatMoneyCompact(totals.incomeCash)}</span>
                      <span className="text-xs text-gray-500">{totals.metrics.cashShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Kaspi</span>
                      <span className="text-sm font-medium text-blue-400">{formatMoneyCompact(totals.incomeKaspi)}</span>
                      <span className="text-xs text-gray-500">{totals.metrics.kaspiShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Online</span>
                      <span className="text-sm font-medium text-violet-400">{formatMoneyCompact(totals.incomeOnline)}</span>
                      <span className="text-xs text-gray-500">{totals.metrics.onlineShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Карта</span>
                      <span className="text-sm font-medium text-amber-400">{formatMoneyCompact(totals.incomeCard)}</span>
                      <span className="text-xs text-gray-500">{totals.metrics.cardShare.toFixed(1)}%</span>
                    </div>
                    <div className="border-t border-white/5 pt-2 mt-2">
                      <div className="flex justify-between items-center font-semibold">
                        <span className="text-xs text-gray-400">Всего доход</span>
                        <span className="text-sm text-white">{formatMoneyCompact(totals.incomeTotal)}</span>
                        <span className="text-xs text-gray-500">100%</span>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-rose-400" />
                    Расходы по типам
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Наличные расходы</span>
                      <span className="text-sm font-medium text-rose-400">{formatMoneyCompact(totals.expenseCash)}</span>
                      <span className="text-xs text-gray-500">{totals.expenseTotal > 0 ? ((totals.expenseCash / totals.expenseTotal) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Kaspi расходы</span>
                      <span className="text-sm font-medium text-rose-400">{formatMoneyCompact(totals.expenseKaspi)}</span>
                      <span className="text-xs text-gray-500">{totals.expenseTotal > 0 ? ((totals.expenseKaspi / totals.expenseTotal) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="border-t border-white/5 pt-2 mt-2">
                      <div className="flex justify-between items-center font-semibold">
                        <span className="text-xs text-gray-400">Всего расходов</span>
                        <span className="text-sm text-white">{formatMoneyCompact(totals.expenseTotal)}</span>
                        <span className="text-xs text-gray-500">100%</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* ===== ГРАФИК САЛЬДО ===== */}
              <Card className="p-6 bg-gray-900/40 backdrop-blur-xl border-white/5">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-violet-400" />
                  Динамика сальдо (накопленное)
                </h3>
                <div className="h-80">
                  {mounted && <MemoizedBalanceChart data={totals.balanceHistory} />}
                </div>
                <div className="flex items-center justify-center gap-6 mt-4 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    Сальдо наличных
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500" />
                    Сальдо безнала
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-violet-500" />
                    Общее сальдо
                  </span>
                </div>
              </Card>

              {/* Основной график доходов/расходов */}
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

              {/* Bottom Section - По компаниям и метрики */}
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
                          const s = totals.statsByCompany[c.id] || { 
                            cash: 0, kaspi: 0, online: 0, card: 0, total: 0 
                          }
                          return {
                            name: c.name.length > 15 ? c.name.substring(0, 12) + '...' : c.name,
                            cash: s.cash,
                            kaspi: s.kaspi,
                            online: s.online,
                            card: s.card,
                            total: s.total
                          }
                        })} 
                      />
                    )}
                  </div>

                  {extraCompanyId && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-400">F16 Extra</span>
                        <span className="text-sm font-bold text-purple-400">
                          {formatMoneyFull(totals.extraTotal)}
                        </span>
                        <span className="text-xs text-gray-500">
                          {includeExtraInTotals ? '(включено)' : '(отдельно)'}
                        </span>
                      </div>
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
                        <p className={`text-xl font-bold ${totals.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatMoneyCompact(totals.netCash)}
                        </p>
                      </div>
                      <div className="p-4 bg-white/5 rounded-xl">
                        <p className="text-xs text-gray-500 mb-1">Сальдо безнал</p>
                        <p className={`text-xl font-bold ${totals.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                          {formatMoneyCompact(totals.netNonCash)}
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
                          <span className="text-gray-400">Kaspi</span>
                          <span className="text-white font-medium">{totals.metrics.kaspiShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${totals.metrics.kaspiShare}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Online</span>
                          <span className="text-white font-medium">{totals.metrics.onlineShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${totals.metrics.onlineShare}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Карта</span>
                          <span className="text-white font-medium">{totals.metrics.cardShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${totals.metrics.cardShare}%` }}
                          />
                        </div>
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
              <p className="text-gray-400">Загрузка недельного баланса...</p>
            </div>
          </main>
        </div>
      }
    >
      <WeeklyReportContent />
    </Suspense>
  )
}
