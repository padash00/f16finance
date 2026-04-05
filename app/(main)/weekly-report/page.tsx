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
import ExcelJS from 'exceljs'
import { buildDashboardSheet, buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCompanies } from '@/hooks/use-companies'
import { useIncome, type IncomeRow } from '@/hooks/use-income'
import { useExpenses, type ExpenseRow } from '@/hooks/use-expenses'

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

// Основные типы для сальдо
type WeekTotals = {
  // Доходы по типам
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeKaspiOnline: number  // kaspi + online (без карты)
  incomeNonCash: number      // kaspi + online (без карты, псевдоним)
  incomeTotal: number

  // Расходы по типам
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  // САЛЬДО (ключевые показатели)
  netCash: number            // incomeCash - expenseCash
  netNonCash: number         // (kaspi+online) - expenseKaspi
  netCard: number            // incomeCard (нет расходов по карте)
  netTotal: number           // netCash + netNonCash + netCard

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
    expenseTotal: number;
    expenseByCategory: Record<string, { cash: number; kaspi: number }>;
    netCash: number;
    netNonCash: number;
    profit: number;
  }>

  // Категории расходов (value = cash + kaspi)
  expenseCategories: { name: string; value: number; cash: number; kaspi: number; percentage: number }[]

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
    netCard: number
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
const MemoizedPieChart = memo(
  ({ data }: { data: { name: string; value: number; cash?: number; kaspi?: number; percentage: number }[] }) => {
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
            borderRadius: '12px',
          }}
          formatter={(v: number, _n: string, p: { payload?: { percentage?: number; cash?: number; kaspi?: number } }) => {
            const pl = p?.payload
            const parts = [`${formatMoneyFull(v)} (${pl?.percentage?.toFixed(1)}%)`]
            if (pl && (pl.cash != null || pl.kaspi != null)) {
              parts.push(`Нал: ${formatMoneyFull(pl.cash ?? 0)} · Kaspi: ${formatMoneyFull(pl.kaspi ?? 0)}`)
            }
            return [parts.join(' · '), 'Сумма']
          }}
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

  const [refreshing, setRefreshing] = useState(false)

  // AI Report state
  const [aiReport, setAiReport] = useState<string | null>(null)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  const [aiReportError, setAiReportError] = useState<string | null>(null)

  // Date states
  const todayISO = useMemo(() => getTodayISO(), [])
  const currentWeek = useMemo(() => getWeekBounds(todayISO), [todayISO])

  const [startDate, setStartDate] = useState(currentWeek.start)
  const [endDate, setEndDate] = useState(currentWeek.end)

  // Data hooks — load current week + previous week in one range for comparison
  const prevStart = useMemo(() => addDaysISO(startDate, -7), [startDate])

  const { companies, loading: companiesLoading, error: companiesError } = useCompanies()
  const { rows: incomeRows, loading: incomeLoading, error: incomeError, reload: reloadIncome } = useIncome({
    from: prevStart,
    to: endDate,
  })
  const { rows: expenseRows, loading: expenseLoading, error: expenseError, reload: reloadExpenses } = useExpenses({
    from: prevStart,
    to: endDate,
    pageSize: 500,
  })

  const loading = companiesLoading || incomeLoading || expenseLoading
  const error = companiesError || incomeError || expenseError || null

  // Filter states
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [comparisonMode, setComparisonMode] = useState(true)

  // UI states
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)

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
  // URL SYNC
  // =====================
  useEffect(() => {
    if (didInitFromUrl.current || companies.length === 0) return

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
  }, [companies.length, searchParams])

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
      cash: number; kaspi: number; online: number; card: number; nonCash: number; total: number;
      expenseCash: number; expenseKaspi: number; expenseTotal: number;
      expenseByCategory: Record<string, { cash: number; kaspi: number }>;
      netCash: number; netNonCash: number; profit: number;
    }> = {}
    
    for (const c of companies) {
      statsByCompany[c.id] = {
        cash: 0, kaspi: 0, online: 0, card: 0, nonCash: 0, total: 0,
        expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
        expenseByCategory: {},
        netCash: 0, netNonCash: 0, profit: 0,
      }
    }

    const catMap = new Map<string, { cash: number; kaspi: number }>()
    
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
      const online = safeNumber(r.online_amount)
      const card = safeNumber(r.card_amount)

      // nonCash = kaspi + online ONLY (card tracked separately)
      const nonCash = kaspi + online
      const total = cash + nonCash + card

      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      // Edge case: ночная смена предыдущего дня (до начала недели) —
      // её после-полуночная часть каспи принадлежит первому дню текущей недели
      if (
        r.date === addDaysISO(startDate, -1) &&
        r.shift === 'night' &&
        r.kaspi_before_midnight != null &&
        (!extra || includeExtraInTotals)
      ) {
        const kaspiAfterMidnight = Math.max(kaspi - safeNumber(r.kaspi_before_midnight), 0)
        if (kaspiAfterMidnight > 0) {
          iKaspi += kaspiAfterMidnight
          iNonCash += kaspiAfterMidnight
          const firstDay = dailyMap.get(startDate)
          if (firstDay) {
            firstDay.income += kaspiAfterMidnight
            firstDay.incomeKaspi += kaspiAfterMidnight
            firstDay.incomeNonCash += kaspiAfterMidnight
          }
          const firstBal = balanceMap.get(startDate)
          if (firstBal) firstBal.nonCash += kaspiAfterMidnight
          const s = statsByCompany[r.company_id]
          if (s) { s.kaspi += kaspiAfterMidnight; s.nonCash += kaspiAfterMidnight; s.total += kaspiAfterMidnight }
        }
      }

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
        // Всегда фиксируем в statsByCompany для детализации
        const se = statsByCompany[r.company_id]
        if (se) { se.cash += cash; se.kaspi += kaspi; se.online += online; se.card += card; se.nonCash += nonCash; se.total += total }
        if (!includeExtraInTotals) continue
      }

      // Добавляем к общим счётчикам
      iCash += cash
      iKaspi += kaspi
      iOnline += online
      iCard += card
      iNonCash += nonCash

      // Статистика по компаниям (для не-Extra, Extra уже выше)
      if (!extra) {
        const s = statsByCompany[r.company_id]
        if (s) {
          s.cash += cash
          s.kaspi += kaspi
          s.online += online
          s.card += card
          s.nonCash += nonCash
          s.total += total
        }
      }

      // Добавляем к дневным данным с корректной разбивкой каспи для ночных смен
      const day = dailyMap.get(r.date)
      if (day) {
        if (r.shift === 'night' && r.kaspi_before_midnight != null) {
          const kaspiBeforeMidnight = safeNumber(r.kaspi_before_midnight)
          const kaspiAfterMidnight = Math.max(kaspi - kaspiBeforeMidnight, 0)

          // До полуночи — остаётся на текущей дате
          day.income += total - kaspiAfterMidnight
          day.incomeCash += cash
          day.incomeKaspi += kaspiBeforeMidnight
          day.incomeOnline += online
          day.incomeCard += card
          day.incomeNonCash += kaspiBeforeMidnight + online

          // После полуночи — переходит на следующий день
          const nextDate = addDaysISO(r.date, 1)
          const nextDay = dailyMap.get(nextDate)
          if (nextDay) {
            nextDay.income += kaspiAfterMidnight
            nextDay.incomeKaspi += kaspiAfterMidnight
            nextDay.incomeNonCash += kaspiAfterMidnight
          }

          // Сальдо
          const bal = balanceMap.get(r.date)
          if (bal) { bal.cash += cash; bal.nonCash += kaspiBeforeMidnight + online + card }
          const nextBal = balanceMap.get(nextDate)
          if (nextBal) nextBal.nonCash += kaspiAfterMidnight
        } else {
          day.income += total
          day.incomeCash += cash
          day.incomeKaspi += kaspi
          day.incomeOnline += online
          day.incomeCard += card
          day.incomeNonCash += nonCash

          const bal = balanceMap.get(r.date)
          if (bal) { bal.cash += cash; bal.nonCash += nonCash + card }
        }
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

      const catName = (r.category || '').trim() || 'Без категории'

      // Всегда фиксируем в statsByCompany для детализации (включая Extra)
      const sc = statsByCompany[r.company_id]
      if (sc) {
        sc.expenseCash += cash
        sc.expenseKaspi += kaspi
        sc.expenseTotal += total
        const prevCat = sc.expenseByCategory[catName] || { cash: 0, kaspi: 0 }
        sc.expenseByCategory[catName] = { cash: prevCat.cash + cash, kaspi: prevCat.kaspi + kaspi }
      }

      if (extra && !includeExtraInTotals) continue

      eCash += cash
      eKaspi += kaspi

      {
        const prevG = catMap.get(catName) || { cash: 0, kaspi: 0 }
        catMap.set(catName, { cash: prevG.cash + cash, kaspi: prevG.kaspi + kaspi })
      }

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
        bal.nonCash -= kaspi
      }
    }

    // Финализируем netCash / netNonCash / profit по всем компаниям (включая Extra)
    for (const c of companies) {
      const sc = statsByCompany[c.id]
      if (!sc) continue
      sc.netCash = sc.cash - sc.expenseCash
      sc.netNonCash = sc.nonCash - sc.expenseKaspi
      sc.profit = sc.total - sc.expenseTotal
    }

    // Итоговые показатели
    // iNonCash = kaspi + online; iCard tracked separately
    const incomeTotal = iCash + iNonCash + iCard
    const expenseTotal = eCash + eKaspi
    const profit = incomeTotal - expenseTotal

    const netCash = iCash - eCash
    const netNonCash = iNonCash - eKaspi   // (kaspi+online) - kaspi_expenses
    const netCard = iCard                   // card income, no card expenses bucket
    const netTotal = netCash + netNonCash + netCard

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
      .map(([name, splits]) => {
        const value = splits.cash + splits.kaspi
        return {
          name,
          value,
          cash: splits.cash,
          kaspi: splits.kaspi,
          percentage: expenseTotal > 0 ? (value / expenseTotal) * 100 : 0,
        }
      })
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
      incomeKaspiOnline: iNonCash,  // kaspi + online (без карты)
      incomeNonCash: iNonCash,       // то же самое, для обратной совместимости
      incomeTotal,

      // Расходы
      expenseCash: eCash,
      expenseKaspi: eKaspi,
      expenseTotal,

      // Сальдо
      netCash,
      netNonCash,
      netCard,
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
        netCard,
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([reloadIncome(), reloadExpenses()])
      showToast('Данные обновлены', 'success')
    } catch {
      showToast('Ошибка обновления', 'error')
    } finally {
      setRefreshing(false)
    }
  }, [reloadIncome, reloadExpenses, showToast])

  const handleDownloadExcel = useCallback(async () => {
    if (!totals) return

    const period = `${startDate} — ${endDate}`
    const generated = new Date().toLocaleString('ru-RU')
    const wb = createWorkbook()
    const companyStats = [...activeCompanies, ...companies.filter(c => c.id === extraCompanyId)]
      .map((company) => ({
        name: company.name,
        stats: totals.statsByCompany[company.id],
      }))
      .filter((item): item is { name: string; stats: NonNullable<typeof item.stats> } => Boolean(item.stats))
      .sort((left, right) => right.stats.profit - left.stats.profit)
    const bestCompany = companyStats[0]
    const topExpense = totals.expenseCategories[0]

    await buildDashboardSheet(wb, {
      sheetName: 'Дашборд',
      title: 'Недельный финансовый дашборд',
      subtitle: `Период: ${period} | Сгенерирован: ${generated}`,
      metrics: [
        { label: 'Выручка', value: formatMoneyFull(totals.incomeTotal), hint: `Нал ${formatMoneyCompact(totals.incomeCash)} / Безнал ${formatMoneyCompact(totals.incomeKaspiOnline)}`, tone: 'good' },
        { label: 'Расходы', value: formatMoneyFull(totals.expenseTotal), hint: `Cash ${formatMoneyCompact(totals.expenseCash)} / Kaspi ${formatMoneyCompact(totals.expenseKaspi)}`, tone: 'warn' },
        { label: 'Прибыль', value: formatMoneyFull(totals.profit), hint: `Маржа ${totals.metrics.profitMargin.toFixed(1)}%`, tone: totals.profit >= 0 ? 'good' : 'danger' },
        { label: 'Общее сальдо', value: formatMoneyFull(totals.netTotal), hint: `Нал ${totals.change.netCash} / Безнал ${totals.change.netNonCash}`, tone: totals.netTotal >= 0 ? 'neutral' : 'danger' },
      ],
      charts: [
        {
          title: 'Дневная прибыль',
          subtitle: 'Как менялся итог по дням недели',
          type: 'line',
          tone: totals.profit >= 0 ? 'good' : 'danger',
          valueFormat: 'money',
          points: totals.dailyData.map((day) => ({
            label: day.label,
            value: day.profit,
          })),
        },
        {
          title: 'Структура доходов',
          subtitle: 'Распределение по способам оплаты',
          type: 'bar',
          tone: 'neutral',
          valueFormat: 'money',
          points: [
            { label: 'Наличные', value: totals.incomeCash },
            { label: 'Kaspi', value: totals.incomeKaspi },
            { label: 'Online', value: totals.incomeOnline },
            { label: 'Карта', value: totals.incomeCard },
          ],
        },
      ],
      highlights: [
        `Маржинальность за неделю: ${totals.metrics.profitMargin.toFixed(1)}%, расходы к выручке: ${totals.metrics.expenseRate.toFixed(1)}%.`,
        bestCompany ? `Лучшая точка по прибыли: ${bestCompany.name} (${formatMoneyCompact(bestCompany.stats.profit)}).` : 'Лучшей точки по прибыли пока нет: недостаточно данных.',
        topExpense ? `Крупнейшая статья расходов: ${topExpense.name} (${formatMoneyCompact(topExpense.value)}).` : 'Крупные расходы за период не зафиксированы.',
      ],
    })

    // ─── Лист 1: Сводка ───────────────────────────────────────────────────────
    buildStyledSheet(wb, 'Сводка', 'Недельный финансовый отчёт', `Период: ${period} | Сгенерирован: ${generated}`, [
      { header: 'Показатель', key: 'label', width: 34, type: 'text' },
      { header: 'Эта неделя', key: 'current', width: 20, type: 'money' },
      { header: 'Прошлая неделя', key: 'prev', width: 20, type: 'money' },
      { header: 'Изменение', key: 'change', width: 16, type: 'text', align: 'right' },
    ], [
      { _isSection: true, _sectionLabel: 'ОСНОВНЫЕ ПОКАЗАТЕЛИ' },
      { label: 'Выручка', current: totals.incomeTotal, prev: totals.prev.incomeTotal, change: totals.change.income },
      { label: 'Расходы', current: totals.expenseTotal, prev: totals.prev.expenseTotal, change: totals.change.expense },
      { label: 'Прибыль', current: totals.profit, prev: totals.prev.profit, change: totals.change.profit },
      { _isTotals: true, label: 'ИТОГО ПРИБЫЛЬ', current: totals.profit, prev: totals.prev.profit, change: totals.change.profit },
      { _isSection: true, _sectionLabel: 'САЛЬДО' },
      { label: 'Сальдо наличных', current: totals.netCash, prev: totals.prev.netCash, change: totals.change.netCash },
      { label: 'Сальдо безнала', current: totals.netNonCash, prev: totals.prev.netNonCash, change: totals.change.netNonCash },
      { _isTotals: true, label: 'Общее сальдо', current: totals.netTotal, prev: null as any, change: '' },
      { _isSection: true, _sectionLabel: 'СТРУКТУРА ДОХОДОВ' },
      { label: 'Наличные', current: totals.incomeCash, prev: null as any, change: `${totals.metrics.cashShare.toFixed(1)}%` },
      { label: 'Kaspi', current: totals.incomeKaspi, prev: null as any, change: `${totals.metrics.kaspiShare.toFixed(1)}%` },
      { label: 'Online', current: totals.incomeOnline, prev: null as any, change: `${totals.metrics.onlineShare.toFixed(1)}%` },
      { label: 'Карта', current: totals.incomeCard, prev: null as any, change: `${totals.metrics.cardShare.toFixed(1)}%` },
      { _isTotals: true, label: 'ИТОГО ДОХОД', current: totals.incomeTotal, prev: null as any, change: '100%' },
      { _isSection: true, _sectionLabel: 'КЛЮЧЕВЫЕ МЕТРИКИ' },
      { label: 'Расходы / Выручка', current: null as any, prev: null as any, change: `${totals.metrics.expenseRate.toFixed(1)}% (норма < 70%)` },
      { label: 'Маржинальность', current: null as any, prev: null as any, change: `${totals.metrics.profitMargin.toFixed(1)}% (норма > 25%)` },
      { label: 'Доля нала в доходах', current: null as any, prev: null as any, change: `${totals.metrics.cashShare.toFixed(1)}%` },
      { label: 'Доля безнала в доходах', current: null as any, prev: null as any, change: `${totals.metrics.nonCashShare.toFixed(1)}%` },
    ])

    // ─── Лист 2: По дням ──────────────────────────────────────────────────────
    let totD = 0, totK = 0, totO = 0, totC = 0, totInc = 0, totEC = 0, totEK = 0, totExp = 0, totPr = 0, totNC = 0, totNN = 0
    const dailyRows = totals.dailyData.map((d, i) => {
      totD += d.incomeCash; totK += d.incomeKaspi; totO += d.incomeOnline; totC += d.incomeCard
      totInc += d.income; totEC += d.expenseCash; totEK += d.expenseKaspi; totExp += d.expense
      totPr += d.profit; totNC += d.netCash; totNN += d.netNonCash
      return { day: d.label, date: d.date, incomeCash: d.incomeCash, incomeKaspi: d.incomeKaspi, incomeOnline: d.incomeOnline, incomeCard: d.incomeCard, income: d.income, expenseCash: d.expenseCash, expenseKaspi: d.expenseKaspi, expense: d.expense, profit: d.profit, netCash: d.netCash, netNonCash: d.netNonCash }
    })
    dailyRows.push({ _isTotals: true, day: 'ИТОГО', date: '', incomeCash: totD, incomeKaspi: totK, incomeOnline: totO, incomeCard: totC, income: totInc, expenseCash: totEC, expenseKaspi: totEK, expense: totExp, profit: totPr, netCash: totNC, netNonCash: totNN } as any)
    buildStyledSheet(wb, 'По дням', 'Динамика по дням', `Период: ${period}`, [
      { header: 'День', key: 'day', width: 8, type: 'text' },
      { header: 'Дата', key: 'date', width: 13, type: 'text' },
      { header: 'Доход нал', key: 'incomeCash', width: 15, type: 'money' },
      { header: 'Доход Kaspi', key: 'incomeKaspi', width: 15, type: 'money' },
      { header: 'Доход Online', key: 'incomeOnline', width: 15, type: 'money' },
      { header: 'Доход Карта', key: 'incomeCard', width: 15, type: 'money' },
      { header: 'Итого доход', key: 'income', width: 16, type: 'money' },
      { header: 'Расход нал', key: 'expenseCash', width: 15, type: 'money' },
      { header: 'Расход Kaspi', key: 'expenseKaspi', width: 15, type: 'money' },
      { header: 'Итого расход', key: 'expense', width: 16, type: 'money' },
      { header: 'Прибыль', key: 'profit', width: 15, type: 'money' },
      { header: 'Сальдо нал', key: 'netCash', width: 15, type: 'money' },
      { header: 'Сальдо безнал', key: 'netNonCash', width: 15, type: 'money' },
    ], dailyRows)

    // ─── Лист 3: По точкам ────────────────────────────────────────────────────
    const allCos = [...activeCompanies, ...companies.filter(c => c.id === extraCompanyId)]
    const companyRows: any[] = []
    for (const c of allCos) {
      const sc = totals.statsByCompany[c.id]
      if (!sc) continue
      companyRows.push({ name: c.name, cash: sc.cash, kaspi: sc.kaspi, online: sc.online, card: sc.card, total: sc.total, expenseCash: sc.expenseCash, expenseKaspi: sc.expenseKaspi, expenseTotal: sc.expenseTotal, netCash: sc.netCash, netNonCash: sc.netNonCash, profit: sc.profit })
    }
    const totByComp = companyRows.reduce((acc, r) => ({ cash: acc.cash + r.cash, kaspi: acc.kaspi + r.kaspi, online: acc.online + r.online, card: acc.card + r.card, total: acc.total + r.total, expenseCash: acc.expenseCash + r.expenseCash, expenseKaspi: acc.expenseKaspi + r.expenseKaspi, expenseTotal: acc.expenseTotal + r.expenseTotal, netCash: acc.netCash + r.netCash, netNonCash: acc.netNonCash + r.netNonCash, profit: acc.profit + r.profit }), { cash: 0, kaspi: 0, online: 0, card: 0, total: 0, expenseCash: 0, expenseKaspi: 0, expenseTotal: 0, netCash: 0, netNonCash: 0, profit: 0 })
    companyRows.push({ _isTotals: true, name: 'ИТОГО', ...totByComp })
    buildStyledSheet(wb, 'По точкам', 'Детализация по точкам', `Период: ${period}`, [
      { header: 'Точка', key: 'name', width: 22, type: 'text' },
      { header: 'Доход нал', key: 'cash', width: 15, type: 'money' },
      { header: 'Доход Kaspi', key: 'kaspi', width: 15, type: 'money' },
      { header: 'Доход Online', key: 'online', width: 15, type: 'money' },
      { header: 'Доход Карта', key: 'card', width: 15, type: 'money' },
      { header: 'Итого доход', key: 'total', width: 16, type: 'money' },
      { header: 'Расход нал', key: 'expenseCash', width: 15, type: 'money' },
      { header: 'Расход Kaspi', key: 'expenseKaspi', width: 15, type: 'money' },
      { header: 'Итого расход', key: 'expenseTotal', width: 16, type: 'money' },
      { header: 'Сальдо нал', key: 'netCash', width: 15, type: 'money' },
      { header: 'Сальдо безнал', key: 'netNonCash', width: 15, type: 'money' },
      { header: 'Прибыль', key: 'profit', width: 15, type: 'money' },
    ], companyRows)

    // ─── Лист 4: Расходы по категориям ───────────────────────────────────────
    const expRows: any[] = totals.expenseCategories.map((cat) => ({
      name: cat.name,
      cash: cat.cash,
      kaspi: cat.kaspi,
      value: cat.value,
      pctExpense: cat.percentage,
      pctIncome: totals.incomeTotal > 0 ? (cat.value / totals.incomeTotal) * 100 : 0,
    }))
    expRows.push({
      _isTotals: true,
      name: 'ИТОГО',
      cash: totals.expenseCash,
      kaspi: totals.expenseKaspi,
      value: totals.expenseTotal,
      pctExpense: 100,
      pctIncome: totals.metrics.expenseRate,
    })
    buildStyledSheet(wb, 'Расходы', 'Расходы по категориям', `Период: ${period}`, [
      { header: 'Категория', key: 'name', width: 32, type: 'text' },
      { header: 'Нал', key: 'cash', width: 14, type: 'money' },
      { header: 'Kaspi', key: 'kaspi', width: 14, type: 'money' },
      { header: 'Всего', key: 'value', width: 16, type: 'money' },
      { header: '% от расходов', key: 'pctExpense', width: 16, type: 'percent' },
      { header: '% от выручки', key: 'pctIncome', width: 16, type: 'percent' },
    ], expRows)

    // ─── Лист 5: Расходы по точкам ───────────────────────────────────────────
    const catByCompRows: any[] = []
    for (const c of allCos) {
      const sc = totals.statsByCompany[c.id]
      if (!sc || Object.keys(sc.expenseByCategory).length === 0) continue
      catByCompRows.push({ _isSection: true, _sectionLabel: c.name })
      const cats = Object.entries(sc.expenseByCategory)
        .map(([cat, sp]) => ({ cat, cash: sp.cash, kaspi: sp.kaspi, total: sp.cash + sp.kaspi }))
        .sort((a, b) => b.total - a.total)
      for (const row of cats) {
        const pct = sc.expenseTotal > 0 ? row.total / sc.expenseTotal * 100 : 0
        catByCompRows.push({
          company: c.name,
          category: row.cat,
          amountCash: row.cash,
          amountKaspi: row.kaspi,
          amount: row.total,
          pct,
        })
      }
      catByCompRows.push({
        _isTotals: true,
        company: c.name,
        category: 'ИТОГО',
        amountCash: sc.expenseCash,
        amountKaspi: sc.expenseKaspi,
        amount: sc.expenseTotal,
        pct: 100,
      })
    }
    buildStyledSheet(wb, 'Расходы по точкам', 'Расходы по категориям по точкам', `Период: ${period}`, [
      { header: 'Точка', key: 'company', width: 22, type: 'text' },
      { header: 'Категория', key: 'category', width: 30, type: 'text' },
      { header: 'Нал', key: 'amountCash', width: 14, type: 'money' },
      { header: 'Kaspi', key: 'amountKaspi', width: 14, type: 'money' },
      { header: 'Всего', key: 'amount', width: 16, type: 'money' },
      { header: '% в точке', key: 'pct', width: 14, type: 'percent' },
    ], catByCompRows)

    await downloadWorkbook(wb, `Orda_Недельный_отчёт_${startDate}_${endDate}.xlsx`)
    showToast('Excel отчёт скачан', 'success')
  }, [totals, startDate, endDate, activeCompanies, companies, extraCompanyId, showToast])

  const handleGenerateAiReport = useCallback(async () => {
    setAiReportLoading(true)
    setAiReportError(null)
    setAiReport(null)
    try {
      const res = await fetch('/api/ai/weekly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: startDate, dateTo: endDate }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.error || 'Ошибка генерации отчёта')
      setAiReport(json.text || null)
    } catch (err: any) {
      setAiReportError(err?.message || 'Не удалось сгенерировать отчёт')
    } finally {
      setAiReportLoading(false)
    }
  }, [startDate, endDate])

  // =====================
  // LOADING & ERROR
  // =====================
  if (loading && companies.length === 0) {
    return (
      <>
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <p className="text-gray-400">Загрузка недельной аналитики...</p>
          </div>
      </>
    )
  }

  if (error) {
    return (
      <>
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
      </>
    )
  }

  // =====================
  // MAIN RENDER
  // =====================
  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
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

          <AdminPageHeader
            title="Недельный баланс"
            description="Доходы, расходы и сальдо за выбранную неделю"
            accent="violet"
            icon={<CalendarDays className="h-5 w-5" aria-hidden />}
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-white/5 hover:bg-white/10 ${comparisonMode ? 'border-violet-500/50 bg-violet-500/20 text-violet-300' : ''}`}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  title="Сравнение с прошлой неделей"
                  aria-label="Сравнение с прошлой неделей"
                >
                  <ArrowUpDown className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-white/5 hover:bg-white/10 ${refreshing ? '[&_svg]:animate-spin' : ''}`}
                  onClick={handleRefresh}
                  title="Обновить"
                  aria-label="Обновить"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>

                <div className="relative group">
                  <Button variant="outline" className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10">
                    <Download className="mr-2 h-4 w-4" />
                    Экспорт
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                  <div className="invisible absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-white/10 bg-gray-900 py-2 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={handleDownloadExcel}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-white/5"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                      Скачать Excel
                    </button>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10"
                  onClick={handleShare}
                  title="Поделиться"
                  aria-label="Поделиться"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </>
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                <span>{formatDateRange(startDate, endDate)}</span>
                {comparisonMode ? <span className="text-violet-300">· сравнение с прошлой неделей</span> : null}
              </div>
            }
          />

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
                  title="САЛЬДО НАЛ"
                  value={formatMoneyFull(totals.netCash)}
                  subValue={`Доход: ${formatMoneyCompact(totals.incomeCash)} | Расход: ${formatMoneyCompact(totals.expenseCash)}`}
                  icon={Coins}
                  trend={comparisonMode && totals.prev.netCash !== 0 ? Number(totals.change.netCash.replace('%', '')) : undefined}
                  color="green"
                  highlight={totals.netCash > 0}
                />

                <StatCard
                  title="САЛЬДО KASPI+ONLINE"
                  value={formatMoneyFull(totals.netNonCash)}
                  subValue={`Доход: ${formatMoneyCompact(totals.incomeKaspiOnline)} | Расход: ${formatMoneyCompact(totals.expenseKaspi)}`}
                  icon={CreditCard}
                  trend={comparisonMode && totals.prev.netNonCash !== 0 ? Number(totals.change.netNonCash.replace('%', '')) : undefined}
                  color="blue"
                  highlight={totals.netNonCash > 0}
                />

                <StatCard
                  title="САЛЬДО КАРТА"
                  value={formatMoneyFull(totals.netCard)}
                  subValue={`Доход: ${formatMoneyCompact(totals.incomeCard)} | Расход: —`}
                  icon={CreditCard}
                  color="amber"
                  highlight={totals.netCard > 0}
                />

                <StatCard
                  title="ОБЩЕЕ САЛЬДО"
                  value={formatMoneyFull(totals.netTotal)}
                  subValue={`Нал + Kaspi/Online + Карта`}
                  icon={Scale}
                  trend={comparisonMode ? Number(totals.change.profit.replace('%', '')) : undefined}
                  color="violet"
                  highlight={totals.netTotal > 0}
                />
              </div>

              {/* ===== ТАБЛИЦА РАЗБИВКИ ПО ТИПАМ ОПЛАТЫ ===== */}
              <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-white">
                  <Scale className="w-4 h-4 text-violet-400" />
                  Разбивка по типам оплаты
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left py-2 pr-4 text-xs text-gray-500 font-medium">Тип</th>
                        <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Доходы</th>
                        <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">Расходы</th>
                        <th className="text-right py-2 pl-3 text-xs text-gray-500 font-medium">Сальдо</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      <tr>
                        <td className="py-2.5 pr-4 text-xs font-medium text-emerald-400 flex items-center gap-2">
                          <Coins className="w-3.5 h-3.5" /> Нал
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-white">{formatMoneyCompact(totals.incomeCash)}</td>
                        <td className="py-2.5 px-3 text-right text-xs text-rose-400">{formatMoneyCompact(totals.expenseCash)}</td>
                        <td className={`py-2.5 pl-3 text-right text-xs font-semibold ${totals.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMoneyCompact(totals.netCash)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-xs font-medium text-blue-400 flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5" /> Kaspi + Online
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-white">
                          <span className="text-white">{formatMoneyCompact(totals.incomeKaspiOnline)}</span>
                          <span className="text-gray-500 ml-1.5">({formatMoneyCompact(totals.incomeKaspi)}+{formatMoneyCompact(totals.incomeOnline)})</span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-rose-400">{formatMoneyCompact(totals.expenseKaspi)}</td>
                        <td className={`py-2.5 pl-3 text-right text-xs font-semibold ${totals.netNonCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMoneyCompact(totals.netNonCash)}</td>
                      </tr>
                      {totals.incomeCard > 0 && (
                        <tr>
                          <td className="py-2.5 pr-4 text-xs font-medium text-amber-400 flex items-center gap-2">
                            <CreditCard className="w-3.5 h-3.5" /> Карта
                          </td>
                          <td className="py-2.5 px-3 text-right text-xs text-white">{formatMoneyCompact(totals.incomeCard)}</td>
                          <td className="py-2.5 px-3 text-right text-xs text-gray-500">—</td>
                          <td className="py-2.5 pl-3 text-right text-xs font-semibold text-emerald-400">{formatMoneyCompact(totals.netCard)}</td>
                        </tr>
                      )}
                      <tr className="border-t border-white/10">
                        <td className="py-2.5 pr-4 text-xs font-bold text-white">Итого</td>
                        <td className="py-2.5 px-3 text-right text-xs font-bold text-white">{formatMoneyCompact(totals.incomeTotal)}</td>
                        <td className="py-2.5 px-3 text-right text-xs font-bold text-rose-400">{formatMoneyCompact(totals.expenseTotal)}</td>
                        <td className={`py-2.5 pl-3 text-right text-xs font-bold ${totals.netTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMoneyCompact(totals.netTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
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
                      <div key={cat.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-sm items-start">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                          />
                          <span className="text-gray-300 truncate">{cat.name}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <div>
                            <span className="text-white font-medium">{formatMoneyCompact(cat.value)}</span>
                            <span className="text-gray-500 text-xs ml-2">{cat.percentage.toFixed(1)}%</span>
                          </div>
                          <div className="text-[11px] text-gray-500 whitespace-nowrap">
                            <span className="text-emerald-400/90">нал {formatMoneyCompact(cat.cash)}</span>
                            <span className="text-gray-600 mx-1">·</span>
                            <span className="text-blue-400/90">kaspi {formatMoneyCompact(cat.kaspi)}</span>
                          </div>
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
            {/* ===== ДЕТАЛИЗАЦИЯ ПО ТОЧКАМ ===== */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-400" />
                Детализация по точкам
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {activeCompanies.map((c) => {
                  const s = totals.statsByCompany[c.id] || {
                    cash: 0, kaspi: 0, online: 0, card: 0, nonCash: 0, total: 0,
                    expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
                    expenseByCategory: {} as Record<string, { cash: number; kaspi: number }>,
                    netCash: 0, netNonCash: 0, profit: 0,
                  }
                  const sortedCats = Object.entries(s.expenseByCategory)
                    .map(([cat, sp]) => ({ cat, cash: sp.cash, kaspi: sp.kaspi, total: sp.cash + sp.kaspi }))
                    .sort((a, b) => b.total - a.total)
                  return (
                    <div key={c.id} className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-5">
                      {/* Заголовок точки */}
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-white flex items-center gap-2">
                          <Store className="w-4 h-4 text-blue-400" />
                          {c.name}
                        </h4>
                        <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${s.profit >= 0 ? 'bg-violet-500/15 text-violet-400' : 'bg-rose-500/15 text-rose-400'}`}>
                          {s.profit >= 0 ? '+' : ''}{formatMoneyCompact(s.profit)}
                        </span>
                      </div>

                      {/* ДОХОДЫ */}
                      <div className="mb-3">
                        <p className="text-xs text-emerald-400 font-medium mb-2 uppercase tracking-wide">Доходы</p>
                        <div className="space-y-1">
                          {s.cash > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400">Наличные</span>
                              <span className="text-gray-200 font-medium">{formatMoneyCompact(s.cash)}</span>
                            </div>
                          )}
                          {s.kaspi > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400">Kaspi</span>
                              <span className="text-gray-200 font-medium">{formatMoneyCompact(s.kaspi)}</span>
                            </div>
                          )}
                          {s.online > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400">Online</span>
                              <span className="text-gray-200 font-medium">{formatMoneyCompact(s.online)}</span>
                            </div>
                          )}
                          {s.card > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400">Карта</span>
                              <span className="text-gray-200 font-medium">{formatMoneyCompact(s.card)}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-xs border-t border-white/5 pt-1 mt-1">
                            <span className="text-gray-300 font-medium">Итого доход</span>
                            <span className="text-emerald-400 font-bold">{formatMoneyCompact(s.total)}</span>
                          </div>
                        </div>
                      </div>

                      {/* РАСХОДЫ ПО КАТЕГОРИЯМ */}
                      <div className="mb-3">
                        <p className="text-xs text-rose-400 font-medium mb-2 uppercase tracking-wide">Расходы по категориям</p>
                        {sortedCats.length === 0 ? (
                          <p className="text-xs text-gray-600">Нет расходов</p>
                        ) : (
                          <div className="space-y-1">
                            {sortedCats.map((row) => (
                              <div key={row.cat} className="flex justify-between items-start gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500/60 shrink-0 mt-1" />
                                  <span className="text-gray-400 truncate">{row.cat}</span>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-rose-300 font-medium">{formatMoneyCompact(row.total)}</div>
                                  <div className="text-[10px] text-gray-500 whitespace-nowrap">
                                    <span className="text-emerald-400/80">нал {formatMoneyCompact(row.cash)}</span>
                                    <span className="text-gray-600 mx-0.5">·</span>
                                    <span className="text-blue-400/80">kaspi {formatMoneyCompact(row.kaspi)}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="flex justify-between items-start gap-2 text-xs border-t border-white/5 pt-1 mt-1">
                              <span className="text-gray-300 font-medium">Итого расход</span>
                              <div className="text-right shrink-0">
                                <div className="text-rose-400 font-bold">{formatMoneyCompact(s.expenseTotal)}</div>
                                <div className="text-[10px] text-gray-500 whitespace-nowrap">
                                  <span className="text-emerald-400/80">нал {formatMoneyCompact(s.expenseCash)}</span>
                                  <span className="text-gray-600 mx-0.5">·</span>
                                  <span className="text-blue-400/80">kaspi {formatMoneyCompact(s.expenseKaspi)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* САЛЬДО */}
                      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/5">
                        <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                          <p className="text-xs text-gray-500 mb-0.5">Сальдо нал</p>
                          <p className={`text-sm font-bold ${s.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {s.netCash >= 0 ? '+' : ''}{formatMoneyCompact(s.netCash)}
                          </p>
                        </div>
                        <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                          <p className="text-xs text-gray-500 mb-0.5">Сальдо безнал</p>
                          <p className={`text-sm font-bold ${s.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                            {s.netNonCash >= 0 ? '+' : ''}{formatMoneyCompact(s.netNonCash)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* F16 Extra — отдельная карточка */}
                {extraCompanyId && (() => {
                  const extraCompany = companies.find(c => c.id === extraCompanyId)
                  const s = totals.statsByCompany[extraCompanyId]
                  if (!extraCompany || !s) return null
                  const sortedCats = Object.entries(s.expenseByCategory)
                    .map(([cat, sp]) => ({ cat, cash: sp.cash, kaspi: sp.kaspi, total: sp.cash + sp.kaspi }))
                    .sort((a, b) => b.total - a.total)
                  return (
                    <div className="rounded-2xl bg-purple-950/30 backdrop-blur-xl border border-purple-500/20 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-white flex items-center gap-2">
                          <Store className="w-4 h-4 text-purple-400" />
                          {extraCompany.name}
                          <span className="text-xs text-purple-400/70 font-normal">(Extra)</span>
                        </h4>
                        <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${s.profit >= 0 ? 'bg-violet-500/15 text-violet-400' : 'bg-rose-500/15 text-rose-400'}`}>
                          {s.profit >= 0 ? '+' : ''}{formatMoneyCompact(s.profit)}
                        </span>
                      </div>
                      <div className="mb-3">
                        <p className="text-xs text-emerald-400 font-medium mb-2 uppercase tracking-wide">Доходы</p>
                        <div className="space-y-1">
                          {s.cash > 0 && <div className="flex justify-between text-xs"><span className="text-gray-400">Наличные</span><span className="text-gray-200 font-medium">{formatMoneyCompact(s.cash)}</span></div>}
                          {s.kaspi > 0 && <div className="flex justify-between text-xs"><span className="text-gray-400">Kaspi</span><span className="text-gray-200 font-medium">{formatMoneyCompact(s.kaspi)}</span></div>}
                          {s.online > 0 && <div className="flex justify-between text-xs"><span className="text-gray-400">Online</span><span className="text-gray-200 font-medium">{formatMoneyCompact(s.online)}</span></div>}
                          {s.card > 0 && <div className="flex justify-between text-xs"><span className="text-gray-400">Карта</span><span className="text-gray-200 font-medium">{formatMoneyCompact(s.card)}</span></div>}
                          <div className="flex justify-between text-xs border-t border-white/5 pt-1 mt-1">
                            <span className="text-gray-300 font-medium">Итого доход</span>
                            <span className="text-emerald-400 font-bold">{formatMoneyCompact(s.total)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="mb-3">
                        <p className="text-xs text-rose-400 font-medium mb-2 uppercase tracking-wide">Расходы по категориям</p>
                        {sortedCats.length === 0 ? <p className="text-xs text-gray-600">Нет расходов</p> : (
                          <div className="space-y-1">
                            {sortedCats.map((row) => (
                              <div key={row.cat} className="flex justify-between items-start gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500/60 shrink-0 mt-1" />
                                  <span className="text-gray-400 truncate">{row.cat}</span>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-rose-300 font-medium">{formatMoneyCompact(row.total)}</div>
                                  <div className="text-[10px] text-gray-500 whitespace-nowrap">
                                    <span className="text-emerald-400/80">нал {formatMoneyCompact(row.cash)}</span>
                                    <span className="text-gray-600 mx-0.5">·</span>
                                    <span className="text-blue-400/80">kaspi {formatMoneyCompact(row.kaspi)}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="flex justify-between items-start gap-2 text-xs border-t border-white/5 pt-1 mt-1">
                              <span className="text-gray-300 font-medium">Итого расход</span>
                              <div className="text-right shrink-0">
                                <div className="text-rose-400 font-bold">{formatMoneyCompact(s.expenseTotal)}</div>
                                <div className="text-[10px] text-gray-500 whitespace-nowrap">
                                  <span className="text-emerald-400/80">нал {formatMoneyCompact(s.expenseCash)}</span>
                                  <span className="text-gray-600 mx-0.5">·</span>
                                  <span className="text-blue-400/80">kaspi {formatMoneyCompact(s.expenseKaspi)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/5">
                        <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                          <p className="text-xs text-gray-500 mb-0.5">Сальдо нал</p>
                          <p className={`text-sm font-bold ${s.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{s.netCash >= 0 ? '+' : ''}{formatMoneyCompact(s.netCash)}</p>
                        </div>
                        <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                          <p className="text-xs text-gray-500 mb-0.5">Сальдо безнал</p>
                          <p className={`text-sm font-bold ${s.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>{s.netNonCash >= 0 ? '+' : ''}{formatMoneyCompact(s.netNonCash)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Итоговая строка по всем точкам */}
              {activeCompanies.length > 1 && (() => {
                const tot = activeCompanies.reduce(
                  (acc, c) => {
                    const s = totals.statsByCompany[c.id]
                    if (!s) return acc
                    acc.income += s.total; acc.expense += s.expenseTotal; acc.profit += s.profit
                    acc.netCash += s.netCash; acc.netNonCash += s.netNonCash
                    return acc
                  },
                  { income: 0, expense: 0, profit: 0, netCash: 0, netNonCash: 0 }
                )
                return (
                  <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 flex flex-wrap gap-4 items-center justify-between">
                    <span className="text-sm font-semibold text-gray-300">Все точки</span>
                    <div className="flex flex-wrap gap-6 text-sm">
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Доход</p>
                        <p className="font-bold text-emerald-400">{formatMoneyCompact(tot.income)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Расход</p>
                        <p className="font-bold text-rose-400">{formatMoneyCompact(tot.expense)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Сальдо нал</p>
                        <p className={`font-bold ${tot.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{tot.netCash >= 0 ? '+' : ''}{formatMoneyCompact(tot.netCash)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Сальдо безнал</p>
                        <p className={`font-bold ${tot.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>{tot.netNonCash >= 0 ? '+' : ''}{formatMoneyCompact(tot.netNonCash)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Прибыль</p>
                        <p className={`font-bold ${tot.profit >= 0 ? 'text-violet-400' : 'text-rose-400'}`}>{tot.profit >= 0 ? '+' : ''}{formatMoneyCompact(tot.profit)}</p>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
            </>
          )}

          {/* AI Weekly Report */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-900/20 via-gray-900/60 to-fuchsia-900/20 border border-violet-500/20 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-500/20 rounded-xl">
                  <Sparkles className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">AI Еженедельный отчёт</h2>
                  <p className="text-xs text-gray-400">GPT анализирует данные недели и пишет полный финансовый отчёт</p>
                </div>
              </div>
              <button
                onClick={handleGenerateAiReport}
                disabled={aiReportLoading || loading}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
              >
                {aiReportLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Генерирую...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Сгенерировать отчёт
                  </>
                )}
              </button>
            </div>

            {aiReportLoading && (
              <div className="space-y-3">
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-full" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-5/6" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-4/5" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-full" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-3/4" />
              </div>
            )}

            {aiReportError && !aiReportLoading && (
              <p className="text-sm text-red-400">{aiReportError}</p>
            )}

            {aiReport && !aiReportLoading && (
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans bg-transparent p-0 border-0">{aiReport}</pre>
              </div>
            )}

            {!aiReport && !aiReportLoading && !aiReportError && (
              <p className="text-sm text-gray-500">
                Нажмите кнопку — GPT проанализирует данные недели ({formatDateRange(startDate, endDate)}) и составит подробный финансовый отчёт.
              </p>
            )}
          </div>

        </div>
    </>
  )
}

// =====================
// EXPORT with Suspense
// =====================
export default function WeeklyReportPage() {
  return (
    <Suspense
      fallback={
        <>
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
                <CalendarDays className="w-8 h-8 text-white" />
              </div>
              <p className="text-gray-400">Загрузка недельного баланса...</p>
            </div>
        </>
      }
    >
      <WeeklyReportContent />
    </Suspense>
  )
}
