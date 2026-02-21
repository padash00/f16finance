'use client'

import { useEffect, useMemo, useRef, useState, memo, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  CalendarDays,
  ArrowLeft,
  Users2,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Award,
  AlertTriangle,
  Filter,
  ChevronDown,
  BarChart3,
  PieChart,
  Activity,
  User,
  Calendar,
  Download,
  RefreshCw,
  Smartphone,
  CreditCard,
  Landmark,
  Percent,
  Scale,
  Zap,
  AlertCircle,
  Info,
  ArrowUpDown,
  Coins,
  Banknote,
  BadgeDollarSign,
  Receipt,
  ArrowRightLeft,
  Sparkles,
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
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts'

// =====================
// TYPES (расширены для сальдо)
// =====================
type Company = {
  id: string
  name: string
  code: string | null
}

type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  operator_id: string | null
  is_virtual: boolean | null
}

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type AdjustmentRow = {
  id: number
  operator_id: string
  date: string
  amount: number
  kind: AdjustmentKind
  comment: string | null
}

type DebtRow = {
  id: string
  operator_id: string | null
  amount: number | null
  week_start: string | null
  status: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

// Расширенный тип с детальной информацией о сальдо
type OperatorAnalyticsRow = {
  operatorId: string
  operatorName: string
  operatorShortName: string | null

  // Основные показатели
  shifts: number
  days: number

  // Доходы по типам
  totalTurnover: number
  cashIncome: number
  kaspiIncome: number
  onlineIncome: number
  cardIncome: number
  nonCashIncome: number // kaspi + online + card

  // Расходы (долги/штрафы)
  autoDebts: number
  manualMinus: number
  totalDebts: number // autoDebts + manualMinus

  // Премии и авансы
  manualPlus: number
  advances: number

  // САЛЬДО (ключевые показатели)
  netCash: number // cashIncome - autoDebts (если долги из нала) - уточнить логику
  netNonCash: number // nonCashIncome - advances (если авансы из безнала)
  netEffect: number // общий эффект

  // Для аналитики
  avgPerShift: number
  share: number

  // Для графиков
  dailyData: { date: string; cash: number; nonCash: number; total: number }[]
  paymentBreakdown: { name: string; value: number; color: string }[]
  balanceHistory: { date: string; cashBalance: number; nonCashBalance: number }[]
}

// Глобальная статистика
type GlobalBalances = {
  totalCashIncome: number
  totalNonCashIncome: number
  totalDebts: number
  totalAdvances: number
  totalBonuses: number
  
  // Итоговые сальдо
  netCashBalance: number
  netNonCashBalance: number
  netTotalBalance: number
  
  // Прогнозы
  projectedCashBalance: number
  projectedNonCashBalance: number
  projectedTotalBalance: number
}

type SortKey = 'netCash' | 'netNonCash' | 'netTotal' | 'turnover' | 'avg' | 'shifts' | 'name'
type SortDirection = 'asc' | 'desc'

type DatePreset = 'custom' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter'

type InsightType = 'success' | 'warning' | 'danger' | 'info' | 'opportunity'

interface AIInsight {
  type: InsightType
  title: string
  description: string
  metric?: string
  trend?: 'up' | 'down' | 'neutral'
  operatorId?: string
}

// =====================
// CONSTANTS
// =====================
const PAYMENT_COLORS = {
  cash: '#10b981',
  kaspi: '#3b82f6',
  online: '#8b5cf6',
  card: '#f59e0b',
} as const

const BALANCE_COLORS = {
  cash: '#10b981',
  nonCash: '#3b82f6',
  total: '#8b5cf6',
} as const

const PIE_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', 
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
] as const

const INSIGHT_STYLES: Record<InsightType, { bg: string; border: string; text: string; icon: React.ElementType }> = {
  success: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: TrendingUp },
  warning: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-400', icon: AlertTriangle },
  danger: { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-400', icon: AlertCircle },
  opportunity: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', icon: Zap },
  info: { bg: 'bg-gray-800/30', border: 'border-white/5', text: 'text-gray-400', icon: Info },
}

const DATE_PRESETS: Record<DatePreset, { label: string; getRange: () => { from: string; to: string } }> = {
  custom: { label: 'Произвольный', getRange: () => ({ from: '', to: '' }) },
  thisWeek: {
    label: 'Текущая неделя',
    getRange: () => {
      const now = new Date()
      const mon = getMonday(now)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      return { from: toISODateLocal(mon), to: toISODateLocal(sun) }
    },
  },
  lastWeek: {
    label: 'Прошлая неделя',
    getRange: () => {
      const now = new Date()
      const mon = getMonday(now)
      mon.setDate(mon.getDate() - 7)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      return { from: toISODateLocal(mon), to: toISODateLocal(sun) }
    },
  },
  thisMonth: {
    label: 'Текущий месяц',
    getRange: () => {
      const now = new Date()
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: toISODateLocal(first), to: toISODateLocal(last) }
    },
  },
  lastMonth: {
    label: 'Прошлый месяц',
    getRange: () => {
      const now = new Date()
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISODateLocal(first), to: toISODateLocal(last) }
    },
  },
  thisQuarter: {
    label: 'Текущий квартал',
    getRange: () => {
      const now = new Date()
      const quarter = Math.floor(now.getMonth() / 3)
      const first = new Date(now.getFullYear(), quarter * 3, 1)
      const last = new Date(now.getFullYear(), quarter * 3 + 3, 0)
      return { from: toISODateLocal(first), to: toISODateLocal(last) }
    },
  },
  lastQuarter: {
    label: 'Прошлый квартал',
    getRange: () => {
      const now = new Date()
      const quarter = Math.floor(now.getMonth() / 3) - 1
      const year = now.getFullYear() + (quarter < 0 ? -1 : 0)
      const adjustedQuarter = quarter < 0 ? 3 + quarter : quarter
      const first = new Date(year, adjustedQuarter * 3, 1)
      const last = new Date(year, adjustedQuarter * 3 + 3, 0)
      return { from: toISODateLocal(first), to: toISODateLocal(last) }
    },
  },
}

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

const getMonday = (d: Date): Date => {
  const date = new Date(d)
  const day = date.getDay() || 7
  if (day !== 1) date.setDate(date.getDate() - (day - 1))
  date.setHours(0, 0, 0, 0)
  return date
}

const mondayISOOf = (iso: string): string => toISODateLocal(getMonday(fromISO(iso)))

const formatMoney = (v: number, fmt: Intl.NumberFormat): string => `${fmt.format(Math.round(v || 0))} ₸`

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

const formatDateRange = (from: string, to: string): string => {
  const d1 = fromISO(from)
  const d2 = fromISO(to)
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
  
  if (sameMonth) {
    return `${d1.getDate()}–${d2.getDate()} ${d1.toLocaleDateString('ru-RU', { month: 'long' })} ${d1.getFullYear()}`
  }
  return `${d1.toLocaleDateString('ru-RU')} – ${d2.toLocaleDateString('ru-RU')}`
}

const safeNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

const getPercentageChange = (current: number, previous: number): string => {
  if (previous === 0) return current > 0 ? '+100%' : '—'
  if (current === 0) return '-100%'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

// =====================
// MEMOIZED CHART COMPONENTS
// =====================
const OperatorDailyChart = memo(({ data }: { data: { date: string; cash: number; nonCash: number; total: number }[] }) => {
  const chartData = data.map(d => ({
    ...d,
    label: d.date.slice(5),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
        <XAxis 
          dataKey="label" 
          stroke="#6b7280" 
          fontSize={10} 
          tickLine={false} 
          axisLine={false}
        />
        <YAxis 
          stroke="#6b7280" 
          fontSize={10} 
          tickLine={false} 
          axisLine={false}
          tickFormatter={formatCompact}
          width={35}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '8px',
            fontSize: '12px'
          }}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              cash: 'Наличные',
              nonCash: 'Безналичные',
              total: 'Всего'
            }
            return [formatMoneyFull(value), labels[name] || name]
          }}
        />
        <Line 
          type="monotone" 
          dataKey="total" 
          stroke="#8b5cf6" 
          strokeWidth={2}
          dot={{ fill: '#8b5cf6', r: 2 }}
          activeDot={{ r: 4 }}
        />
        <Line 
          type="monotone" 
          dataKey="cash" 
          stroke="#10b981" 
          strokeWidth={1.5}
          dot={{ fill: '#10b981', r: 1.5 }}
          activeDot={{ r: 3 }}
        />
        <Line 
          type="monotone" 
          dataKey="nonCash" 
          stroke="#3b82f6" 
          strokeWidth={1.5}
          dot={{ fill: '#3b82f6', r: 1.5 }}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
OperatorDailyChart.displayName = 'OperatorDailyChart'

const PaymentPieChart = memo(({ data }: { data: { name: string; value: number; color: string }[] }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const dataWithPercent = data.map(item => ({
    ...item,
    percentage: total > 0 ? (item.value / total) * 100 : 0,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsPieChart>
        <Pie 
          data={dataWithPercent} 
          cx="50%" 
          cy="50%" 
          innerRadius={30} 
          outerRadius={45}
          paddingAngle={2}
          dataKey="value"
        >
          {dataWithPercent.map((entry, idx) => (
            <Cell key={`cell-${idx}`} fill={entry.color} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '8px' 
          }}
          formatter={(value: number, _n: string, p: { payload?: { percentage?: number } }) => [
            `${formatMoneyFull(value)} (${p?.payload?.percentage?.toFixed(1)}%)`,
            'Сумма'
          ]}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  )
})
PaymentPieChart.displayName = 'PaymentPieChart'

// График баланса
const BalanceChart = memo(({ data }: { data: { date: string; cashBalance: number; nonCashBalance: number }[] }) => {
  const chartData = data.map(d => ({
    ...d,
    label: d.date.slice(5),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
        <XAxis 
          dataKey="label" 
          stroke="#6b7280" 
          fontSize={10} 
          tickLine={false} 
          axisLine={false}
        />
        <YAxis 
          stroke="#6b7280" 
          fontSize={10} 
          tickLine={false} 
          axisLine={false}
          tickFormatter={formatCompact}
          width={35}
        />
        <Tooltip 
          contentStyle={{ 
            background: 'rgba(17, 24, 39, 0.95)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '8px',
            fontSize: '12px'
          }}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              cashBalance: 'Сальдо нал',
              nonCashBalance: 'Сальдо безнал',
            }
            return [formatMoneyFull(value), labels[name] || name]
          }}
        />
        <Line 
          type="monotone" 
          dataKey="cashBalance" 
          stroke="#10b981" 
          strokeWidth={2}
          dot={{ fill: '#10b981', r: 2 }}
          activeDot={{ r: 4 }}
        />
        <Line 
          type="monotone" 
          dataKey="nonCashBalance" 
          stroke="#3b82f6" 
          strokeWidth={2}
          dot={{ fill: '#3b82f6', r: 2 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
BalanceChart.displayName = 'BalanceChart'

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
      className={`relative overflow-hidden rounded-2xl backdrop-blur-xl border p-5 transition-all ${
        highlight 
          ? 'bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border-violet-500/30 shadow-lg shadow-violet-500/10' 
          : 'bg-gray-900/40 border-white/5 hover:bg-gray-800/50'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${colors[color]} opacity-10 rounded-full blur-3xl translate-x-8 -translate-y-8`} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className={`p-2 rounded-xl bg-gradient-to-br ${colors[color]} bg-opacity-20`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          {trend !== undefined && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              trend > 0 ? 'bg-emerald-500/20 text-emerald-400' : 
              trend < 0 ? 'bg-rose-500/20 text-rose-400' : 
              'bg-gray-500/20 text-gray-400'
            }`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <p className="text-gray-400 text-xs mb-1">{title}</p>
        <p className={`text-xl font-bold mb-1 ${highlight ? 'text-white' : 'text-white'}`}>{value}</p>
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
// LOADING COMPONENT
// =====================
function OperatorAnalyticsLoading() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Users2 className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка аналитики операторов...</p>
        </div>
      </main>
    </div>
  )
}

// =====================
// MAIN CONTENT COMPONENT
// =====================
function OperatorAnalyticsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const moneyFmt = useMemo(() => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }), [])
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Date states
  const [datePreset, setDatePreset] = useState<DatePreset>('thisWeek')
  const [dateFrom, setDateFrom] = useState(() => DATE_PRESETS.thisWeek.getRange().from)
  const [dateTo, setDateTo] = useState(() => DATE_PRESETS.thisWeek.getRange().to)

  // Static data
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [staticLoading, setStaticLoading] = useState(true)

  // Range data
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [includeArena, setIncludeArena] = useState(true)
  const [includeRamen, setIncludeRamen] = useState(true)
  const [includeExtra, setIncludeExtra] = useState(true)
  const [showInactive, setShowInactive] = useState(false)

  // UI states
  const [sortKey, setSortKey] = useState<SortKey>('netTotal')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [search, setSearch] = useState('')
  const [selectedOperator, setSelectedOperator] = useState<OperatorAnalyticsRow | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showCharts, setShowCharts] = useState(true)
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)

  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message: msg, type })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])

  // Apply date preset
  const applyPreset = useCallback((preset: DatePreset) => {
    if (preset === 'custom') return
    const { from, to } = DATE_PRESETS[preset].getRange()
    setDateFrom(from)
    setDateTo(to)
  }, [])

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    applyPreset(preset)
  }

  // Protect against dateFrom > dateTo
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  // URL sync
  useEffect(() => {
    if (didInitFromUrl.current) return

    const sp = searchParams
    const pFrom = sp.get('from')
    const pTo = sp.get('to')
    const pArena = sp.get('arena')
    const pRamen = sp.get('ramen')
    const pExtra = sp.get('extra')
    const pSearch = sp.get('q')
    const pSort = sp.get('sort') as SortKey | null
    const pDir = sp.get('dir') as SortDirection | null

    if (pFrom && pTo) {
      setDateFrom(pFrom)
      setDateTo(pTo)
      setDatePreset('custom')
    }

    if (pArena !== null) setIncludeArena(pArena === '1')
    if (pRamen !== null) setIncludeRamen(pRamen === '1')
    if (pExtra !== null) setIncludeExtra(pExtra === '1')
    if (pSearch) setSearch(pSearch)
    if (pSort) setSortKey(pSort)
    if (pDir) setSortDirection(pDir)

    didInitFromUrl.current = true
  }, [searchParams])

  useEffect(() => {
    if (!didInitFromUrl.current) return

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('from', dateFrom)
      params.set('to', dateTo)
      params.set('arena', includeArena ? '1' : '0')
      params.set('ramen', includeRamen ? '1' : '0')
      params.set('extra', includeExtra ? '1' : '0')
      if (search) params.set('q', search)
      params.set('sort', sortKey)
      params.set('dir', sortDirection)

      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [dateFrom, dateTo, includeArena, includeRamen, includeExtra, search, sortKey, sortDirection, pathname, router])

  // Load static data
  useEffect(() => {
    const loadStatic = async () => {
      setStaticLoading(true)
      setError(null)

      const [compRes, opsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase.from('operators').select('id,name,short_name,is_active').order('name'),
      ])

      if (compRes.error || opsRes.error) {
        console.error('Static load error', { compErr: compRes.error, opsErr: opsRes.error })
        setError('Ошибка загрузки справочников')
        setCompanies((compRes.data || []) as Company[])
        setOperators((opsRes.data || []) as Operator[])
        setStaticLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setOperators((opsRes.data || []) as Operator[])
      setStaticLoading(false)
    }

    loadStatic()
  }, [])

  // Memoized values
  const allowedCodes = useMemo(() => {
    const set = new Set<string>()
    if (includeArena) set.add('arena')
    if (includeRamen) set.add('ramen')
    if (includeExtra) set.add('extra')
    return set
  }, [includeArena, includeRamen, includeExtra])

  const companyById = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const operatorById = useMemo(() => {
    const m = new Map<string, Operator>()
    for (const o of operators) m.set(o.id, o)
    return m
  }, [operators])

  const activeOperatorIds = useMemo(() => {
    return operators
      .filter(o => showInactive || o.is_active)
      .map(o => o.id)
  }, [operators, showInactive])

  const selectedCompanyIds = useMemo(() => {
    if (!companies.length) return []
    return companies
      .filter((c) => allowedCodes.has((c.code || '').toLowerCase()))
      .map((c) => c.id)
  }, [companies, allowedCodes])

  const noCompaniesSelected = useMemo(() => selectedCompanyIds.length === 0, [selectedCompanyIds])

  // Load range data
  useEffect(() => {
    const loadRange = async () => {
      if (staticLoading) return

      const myId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      const wsFrom = mondayISOOf(dateFrom)
      const wsTo = mondayISOOf(dateTo)

      const shouldFetchIncomes = selectedCompanyIds.length > 0 && activeOperatorIds.length > 0

      const incomesQ = shouldFetchIncomes
        ? supabase
            .from('incomes')
            .select('id,date,company_id,shift,cash_amount,kaspi_amount,online_amount,card_amount,operator_id,is_virtual')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .in('company_id', selectedCompanyIds)
            .in('operator_id', activeOperatorIds)
        : null

      const adjQ = activeOperatorIds.length > 0
        ? supabase
            .from('operator_salary_adjustments')
            .select('id,operator_id,date,amount,kind,comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .in('operator_id', activeOperatorIds)
        : supabase
            .from('operator_salary_adjustments')
            .select('id,operator_id,date,amount,kind,comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)

      const debtsQ = activeOperatorIds.length > 0
        ? supabase
            .from('debts')
            .select('id,operator_id,amount,week_start,status')
            .gte('week_start', wsFrom)
            .lte('week_start', wsTo)
            .eq('status', 'active')
            .in('operator_id', activeOperatorIds)
        : supabase
            .from('debts')
            .select('id,operator_id,amount,week_start,status')
            .gte('week_start', wsFrom)
            .lte('week_start', wsTo)
            .eq('status', 'active')

      const [incRes, adjRes, debtsRes] = await Promise.all([
        incomesQ ? incomesQ : Promise.resolve({ data: [], error: null }),
        adjQ,
        debtsQ,
      ])

      if (myId !== reqIdRef.current) return

      if (incRes.error || adjRes.error || debtsRes.error) {
        console.error('Range load error', {
          incErr: incRes.error,
          adjErr: adjRes.error,
          debtsErr: debtsRes.error,
        })
        setError('Ошибка загрузки данных периода')
      }

      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setLoading(false)
      setRefreshing(false)
    }

    loadRange()
  }, [dateFrom, dateTo, selectedCompanyIds.join('|'), activeOperatorIds.join('|'), staticLoading])

  // Process analytics with focus on balances
  const analytics = useMemo(() => {
    const byOperator = new Map<string, OperatorAnalyticsRow>()
    const daysByOperator = new Map<string, Set<string>>()
    const shiftsByOperator = new Map<string, Set<string>>()
    const dailyByOperator = new Map<string, Map<string, { cash: number; nonCash: number; total: number }>>()
    const balanceHistoryByOperator = new Map<string, Map<string, { cashBalance: number; nonCashBalance: number }>>()

    // Глобальные счётчики
    let totalCashIncome = 0
    let totalNonCashIncome = 0
    let totalDebts = 0
    let totalAdvances = 0
    let totalBonuses = 0

    const ensureOp = (id: string | null): OperatorAnalyticsRow | null => {
      if (!id) return null
      const meta = operatorById.get(id)
      if (!meta) return null
      if (!showInactive && !meta.is_active) return null

      let op = byOperator.get(id)
      if (!op) {
        const name = meta.short_name || meta.name || 'Без имени'
        op = {
          operatorId: id,
          operatorName: meta.name,
          operatorShortName: meta.short_name,
          shifts: 0,
          days: 0,
          totalTurnover: 0,
          cashIncome: 0,
          kaspiIncome: 0,
          onlineIncome: 0,
          cardIncome: 0,
          nonCashIncome: 0,
          autoDebts: 0,
          manualMinus: 0,
          totalDebts: 0,
          manualPlus: 0,
          advances: 0,
          netCash: 0,
          netNonCash: 0,
          netEffect: 0,
          avgPerShift: 0,
          share: 0,
          dailyData: [],
          paymentBreakdown: [],
          balanceHistory: [],
        }
        byOperator.set(id, op)
        daysByOperator.set(id, new Set())
        shiftsByOperator.set(id, new Set())
        dailyByOperator.set(id, new Map())
        balanceHistoryByOperator.set(id, new Map())
      }
      return op
    }

    // Process incomes
    for (const row of incomes) {
      if (!row.operator_id) continue

      const company = companyById.get(row.company_id)
      const code = (company?.code || '').toLowerCase()
      if (!code || !allowedCodes.has(code)) continue

      const op = ensureOp(row.operator_id)
      if (!op) continue

      const cash = safeNumber(row.cash_amount)
      const kaspi = safeNumber(row.kaspi_amount)
      const online = safeNumber(row.online_amount)
      const card = safeNumber(row.card_amount)
      const nonCash = kaspi + online + card
      const total = cash + nonCash

      if (!Number.isFinite(total) || total <= 0) continue

      // Доходы
      op.totalTurnover += total
      op.cashIncome += cash
      op.kaspiIncome += kaspi
      op.onlineIncome += online
      op.cardIncome += card
      op.nonCashIncome += nonCash

      // Глобальные счётчики
      totalCashIncome += cash
      totalNonCashIncome += nonCash

      daysByOperator.get(row.operator_id)!.add(row.date)

      const shiftKey = `${row.date}|${row.shift || 'na'}|${row.company_id}|${row.operator_id}`
      shiftsByOperator.get(row.operator_id)!.add(shiftKey)

      // Daily data
      const dailyMap = dailyByOperator.get(row.operator_id)!
      const existing = dailyMap.get(row.date) || { cash: 0, nonCash: 0, total: 0 }
      dailyMap.set(row.date, {
        cash: existing.cash + cash,
        nonCash: existing.nonCash + nonCash,
        total: existing.total + total,
      })
    }

    // Process debts
    for (const d of debts) {
      const op = ensureOp(d.operator_id)
      if (!op) continue
      const amount = safeNumber(d.amount)
      if (amount <= 0) continue
      op.autoDebts += amount
      op.totalDebts += amount
      totalDebts += amount
    }

    // Process adjustments
    for (const adj of adjustments) {
      const op = ensureOp(adj.operator_id)
      if (!op) continue

      const amount = safeNumber(adj.amount)
      if (amount <= 0) continue

      if (adj.kind === 'bonus') {
        op.manualPlus += amount
        totalBonuses += amount
      } else if (adj.kind === 'advance') {
        op.advances += amount
        totalAdvances += amount
      } else {
        op.manualMinus += amount
        op.totalDebts += amount
        totalDebts += amount
      }
    }

    // Finalize operators
    for (const op of byOperator.values()) {
      op.days = daysByOperator.get(op.operatorId)?.size || 0
      op.shifts = shiftsByOperator.get(op.operatorId)?.size || 0
      op.avgPerShift = op.shifts > 0 ? op.totalTurnover / op.shifts : 0
      op.share = totalCashIncome + totalNonCashIncome > 0 
        ? op.totalTurnover / (totalCashIncome + totalNonCashIncome) 
        : 0

      // Расчёт сальдо (здесь нужно уточнить логику - какие расходы из каких источников)
      // По умолчанию считаем, что все долги/штрафы из наличных, а авансы из безнала
      op.netCash = op.cashIncome - op.totalDebts
      op.netNonCash = op.nonCashIncome - op.advances
      op.netEffect = op.netCash + op.netNonCash + op.manualPlus

      // Daily data for charts
      const dailyMap = dailyByOperator.get(op.operatorId) || new Map()
      op.dailyData = Array.from(dailyMap.entries())
        .map(([date, values]) => ({ 
          date, 
          cash: values.cash, 
          nonCash: values.nonCash, 
          total: values.total 
        }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Payment breakdown
      op.paymentBreakdown = [
        { name: 'Наличные', value: op.cashIncome, color: PAYMENT_COLORS.cash },
        { name: 'Kaspi', value: op.kaspiIncome, color: PAYMENT_COLORS.kaspi },
        { name: 'Online', value: op.onlineIncome, color: PAYMENT_COLORS.online },
        { name: 'Карта', value: op.cardIncome, color: PAYMENT_COLORS.card },
      ].filter(item => item.value > 0)

      // Balance history (cumulative)
      let runningCashBalance = 0
      let runningNonCashBalance = 0
      const balanceMap = new Map<string, { cashBalance: number; nonCashBalance: number }>()
      
      // Сортируем все дни с доходами
      const allDays = new Set<string>()
      for (const inc of incomes.filter(i => i.operator_id === op.operatorId)) {
        allDays.add(inc.date)
      }
      
      const sortedDays = Array.from(allDays).sort()
      
      for (const day of sortedDays) {
        const dayIncome = op.dailyData.find(d => d.date === day)
        if (dayIncome) {
          runningCashBalance += dayIncome.cash
          runningNonCashBalance += dayIncome.nonCash
        }
        // Здесь нужно вычитать долги/авансы по дням, если есть датированные данные
        balanceMap.set(day, {
          cashBalance: runningCashBalance,
          nonCashBalance: runningNonCashBalance,
        })
      }
      
      op.balanceHistory = Array.from(balanceMap.entries())
        .map(([date, values]) => ({ date, ...values }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    // Глобальные сальдо
    const globalBalances: GlobalBalances = {
      totalCashIncome,
      totalNonCashIncome,
      totalDebts,
      totalAdvances,
      totalBonuses,
      netCashBalance: totalCashIncome - totalDebts,
      netNonCashBalance: totalNonCashIncome - totalAdvances,
      netTotalBalance: (totalCashIncome + totalNonCashIncome) - (totalDebts + totalAdvances) + totalBonuses,
      // Прогноз на конец периода (простая экстраполяция)
      projectedCashBalance: (totalCashIncome - totalDebts) * 1.1,
      projectedNonCashBalance: (totalNonCashIncome - totalAdvances) * 1.1,
      projectedTotalBalance: ((totalCashIncome + totalNonCashIncome) - (totalDebts + totalAdvances) + totalBonuses) * 1.1,
    }

    // Search
    const term = search.trim().toLowerCase()
    const searched = term
      ? Array.from(byOperator.values()).filter(r => 
          r.operatorName.toLowerCase().includes(term) ||
          (r.operatorShortName?.toLowerCase() || '').includes(term)
        )
      : Array.from(byOperator.values())

    // Sort
    const sorted = [...searched].sort((a, b) => {
      let aVal: number | string = 0
      let bVal: number | string = 0

      switch (sortKey) {
        case 'name':
          aVal = a.operatorName
          bVal = b.operatorName
          break
        case 'netCash':
          aVal = a.netCash
          bVal = b.netCash
          break
        case 'netNonCash':
          aVal = a.netNonCash
          bVal = b.netNonCash
          break
        case 'netTotal':
          aVal = a.netEffect
          bVal = b.netEffect
          break
        case 'turnover':
          aVal = a.totalTurnover
          bVal = b.totalTurnover
          break
        case 'avg':
          aVal = a.avgPerShift
          bVal = b.avgPerShift
          break
        case 'shifts':
          aVal = a.shifts
          bVal = b.shifts
          break
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(String(bVal))
          : String(bVal).localeCompare(aVal)
      }
      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

    // Totals for filtered rows
    const totalsFiltered = sorted.reduce(
      (acc, r) => {
        acc.turnover += r.totalTurnover
        acc.cashIncome += r.cashIncome
        acc.nonCashIncome += r.nonCashIncome
        acc.debts += r.totalDebts
        acc.advances += r.advances
        acc.bonuses += r.manualPlus
        acc.netCash += r.netCash
        acc.netNonCash += r.netNonCash
        acc.netTotal += r.netEffect
        acc.shifts += r.shifts
        acc.days += r.days
        return acc
      },
      {
        turnover: 0,
        cashIncome: 0,
        nonCashIncome: 0,
        debts: 0,
        advances: 0,
        bonuses: 0,
        netCash: 0,
        netNonCash: 0,
        netTotal: 0,
        shifts: 0,
        days: 0,
      },
    )

    return {
      rows: sorted,
      globalBalances,
      totalsFiltered,
    }
  }, [
    companyById,
    operatorById,
    incomes,
    debts,
    adjustments,
    allowedCodes,
    search,
    sortKey,
    sortDirection,
    showInactive,
  ])

  // AI Insights focused on balances
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    
    if (analytics.rows.length === 0) return insights

    const { globalBalances, rows } = analytics

    // Общее сальдо
    if (globalBalances.netTotalBalance < 0) {
      insights.push({
        type: 'danger',
        title: 'Отрицательное общее сальдо',
        description: `Общий баланс отрицательный: ${formatMoneyCompact(globalBalances.netTotalBalance)}. Требуется анализ расходов.`,
        metric: formatMoneyCompact(globalBalances.netTotalBalance),
        trend: 'down'
      })
    } else if (globalBalances.netTotalBalance > 0) {
      insights.push({
        type: 'success',
        title: 'Положительное сальдо',
        description: `Общий баланс положительный: ${formatMoneyCompact(globalBalances.netTotalBalance)}. Хороший результат.`,
        metric: formatMoneyCompact(globalBalances.netTotalBalance),
        trend: 'up'
      })
    }

    // Баланс наличных
    if (globalBalances.netCashBalance < 0) {
      insights.push({
        type: 'warning',
        title: 'Отрицательное сальдо наличных',
        description: `Долги превышают наличные поступления на ${formatMoneyCompact(Math.abs(globalBalances.netCashBalance))}`,
        metric: formatMoneyCompact(globalBalances.netCashBalance),
      })
    }

    // Баланс безнала
    if (globalBalances.netNonCashBalance < 0) {
      insights.push({
        type: 'warning',
        title: 'Отрицательное сальдо безнала',
        description: `Авансы превышают безналичные поступления на ${formatMoneyCompact(Math.abs(globalBalances.netNonCashBalance))}`,
        metric: formatMoneyCompact(globalBalances.netNonCashBalance),
      })
    }

    // Лучший по сальдо
    const bestByNet = [...rows].sort((a, b) => b.netEffect - a.netEffect)[0]
    if (bestByNet && bestByNet.netEffect > 0) {
      insights.push({
        type: 'success',
        title: 'Лучший по сальдо',
        description: `${bestByNet.operatorName} — чистый остаток ${formatMoneyCompact(bestByNet.netEffect)}`,
        metric: formatMoneyCompact(bestByNet.netEffect),
        operatorId: bestByNet.operatorId,
      })
    }

    // Худший по сальдо
    const worstByNet = [...rows].sort((a, b) => a.netEffect - b.netEffect)[0]
    if (worstByNet && worstByNet.netEffect < 0) {
      insights.push({
        type: 'danger',
        title: 'Критическое сальдо',
        description: `${worstByNet.operatorName} должен ${formatMoneyCompact(Math.abs(worstByNet.netEffect))}`,
        metric: formatMoneyCompact(worstByNet.netEffect),
        operatorId: worstByNet.operatorId,
      })
    }

    // Прогноз
    if (globalBalances.projectedTotalBalance > globalBalances.netTotalBalance * 1.5) {
      insights.push({
        type: 'opportunity',
        title: 'Оптимистичный прогноз',
        description: `При сохранении темпов сальдо вырастет до ${formatMoneyCompact(globalBalances.projectedTotalBalance)}`,
        metric: formatMoneyCompact(globalBalances.projectedTotalBalance),
        trend: 'up'
      })
    }

    return insights.slice(0, 5)
  }, [analytics])

  // Handlers
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const myId = ++reqIdRef.current

    const wsFrom = mondayISOOf(dateFrom)
    const wsTo = mondayISOOf(dateTo)

    const shouldFetchIncomes = selectedCompanyIds.length > 0 && activeOperatorIds.length > 0

    const incomesQ = shouldFetchIncomes
      ? supabase
          .from('incomes')
          .select('id,date,company_id,shift,cash_amount,kaspi_amount,online_amount,card_amount,operator_id,is_virtual')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .in('company_id', selectedCompanyIds)
          .in('operator_id', activeOperatorIds)
      : null

    const adjQ = activeOperatorIds.length > 0
      ? supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .in('operator_id', activeOperatorIds)
      : supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo)

    const debtsQ = activeOperatorIds.length > 0
      ? supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', wsFrom)
          .lte('week_start', wsTo)
          .eq('status', 'active')
          .in('operator_id', activeOperatorIds)
      : supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', wsFrom)
          .lte('week_start', wsTo)
          .eq('status', 'active')

    const [incRes, adjRes, debtsRes] = await Promise.all([
      incomesQ ? incomesQ : Promise.resolve({ data: [], error: null }),
      adjQ,
      debtsQ,
    ])

    if (myId === reqIdRef.current) {
      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setRefreshing(false)
      showToast('Данные обновлены', 'success')
    }
  }, [dateFrom, dateTo, selectedCompanyIds, activeOperatorIds, showToast])

  const handleDownloadCSV = useCallback(() => {
    const rows: string[][] = []

    rows.push(['АНАЛИТИКА ОПЕРАТОРОВ - САЛЬДО'])
    rows.push(['Сгенерирован', new Date().toLocaleString('ru-RU')])
    rows.push(['Период', `${dateFrom} — ${dateTo}`])
    rows.push([''])

    rows.push(['ГЛОБАЛЬНОЕ САЛЬДО'])
    rows.push(['Показатель', 'Значение'])
    rows.push(['Наличные доход', String(Math.round(analytics.globalBalances.totalCashIncome))])
    rows.push(['Безналичные доход', String(Math.round(analytics.globalBalances.totalNonCashIncome))])
    rows.push(['Всего доход', String(Math.round(analytics.globalBalances.totalCashIncome + analytics.globalBalances.totalNonCashIncome))])
    rows.push(['Долги и штрафы', String(Math.round(analytics.globalBalances.totalDebts))])
    rows.push(['Авансы', String(Math.round(analytics.globalBalances.totalAdvances))])
    rows.push(['Премии', String(Math.round(analytics.globalBalances.totalBonuses))])
    rows.push(['САЛЬДО НАЛИЧНЫХ', String(Math.round(analytics.globalBalances.netCashBalance))])
    rows.push(['САЛЬДО БЕЗНАЛА', String(Math.round(analytics.globalBalances.netNonCashBalance))])
    rows.push(['ОБЩЕЕ САЛЬДО', String(Math.round(analytics.globalBalances.netTotalBalance))])
    rows.push([''])

    rows.push(['ДЕТАЛЬНАЯ ТАБЛИЦА'])
    rows.push([
      'Оператор', 'Смен', 'Дней', 'Выручка',
      'Нал доход', 'Безнал доход',
      'Долги', 'Авансы', 'Премии',
      'САЛЬДО НАЛ', 'САЛЬДО БЕЗНАЛ', 'САЛЬДО ОБЩЕЕ'
    ])

    for (const op of analytics.rows) {
      rows.push([
        op.operatorName,
        String(op.shifts),
        String(op.days),
        String(Math.round(op.totalTurnover)),
        String(Math.round(op.cashIncome)),
        String(Math.round(op.nonCashIncome)),
        String(Math.round(op.totalDebts)),
        String(Math.round(op.advances)),
        String(Math.round(op.manualPlus)),
        String(Math.round(op.netCash)),
        String(Math.round(op.netNonCash)),
        String(Math.round(op.netEffect)),
      ])
    }

    const blob = new Blob(['\uFEFF' + rows.map(r => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operators_balance_${dateFrom}_${dateTo}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    showToast('CSV отчёт скачан', 'success')
  }, [analytics, dateFrom, dateTo, showToast])

  // Loading states
  if (staticLoading && companies.length === 0) {
    return <OperatorAnalyticsLoading />
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

  // Main render
  const { globalBalances, rows, totalsFiltered } = analytics

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
                <Link href="/dashboard">
                  <div className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-400" />
                  </div>
                </Link>
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <Users2 className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Сальдо операторов
                  </h1>
                  <p className="text-gray-400 mt-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatDateRange(dateFrom, dateTo)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-xl p-1 border border-white/10">
                  {(['thisWeek', 'lastWeek', 'thisMonth'] as DatePreset[]).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handlePresetChange(preset)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        datePreset === preset ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {DATE_PRESETS[preset].label}
                    </button>
                  ))}
                </div>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
                  onClick={handleRefresh}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleDownloadCSV}
                  title="Скачать CSV"
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* AI Insights */}
          {aiInsights.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
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
                onClick={() => setIncludeArena(!includeArena)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  includeArena
                    ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
                    : 'border-white/10 text-gray-400 hover:bg-white/5'
                }`}
              >
                Arena
              </button>

              <button
                onClick={() => setIncludeRamen(!includeRamen)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  includeRamen
                    ? 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                    : 'border-white/10 text-gray-400 hover:bg-white/5'
                }`}
              >
                Ramen
              </button>

              <button
                onClick={() => setIncludeExtra(!includeExtra)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  includeExtra
                    ? 'border-violet-500/50 text-violet-300 bg-violet-500/10'
                    : 'border-white/10 text-gray-400 hover:bg-white/5'
                }`}
              >
                Extra
              </button>

              <div className="h-4 w-px bg-white/10 mx-2" />

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                />
                <span className="text-xs text-gray-400">Показывать неактивных</span>
              </label>

              <button
                onClick={() => setShowCharts(!showCharts)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800/50 border border-white/10 text-xs hover:bg-gray-700/50 transition-colors"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {showCharts ? 'Скрыть графики' : 'Показать графики'}
              </button>

              <div className="flex-1" />

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск оператора..."
                  className="h-8 w-48 pl-8 pr-7 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* BALANCE CARDS - ГЛАВНЫЙ ФОКУС */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              title="САЛЬДО НАЛИЧНЫХ"
              value={formatMoney(globalBalances.netCashBalance, moneyFmt)}
              subValue={`Доход: ${formatMoneyCompact(globalBalances.totalCashIncome)} | Долги: ${formatMoneyCompact(globalBalances.totalDebts)}`}
              icon={Coins}
              color="green"
              highlight={globalBalances.netCashBalance > 0}
            />

            <StatCard
              title="САЛЬДО БЕЗНАЛА"
              value={formatMoney(globalBalances.netNonCashBalance, moneyFmt)}
              subValue={`Доход: ${formatMoneyCompact(globalBalances.totalNonCashIncome)} | Авансы: ${formatMoneyCompact(globalBalances.totalAdvances)}`}
              icon={CreditCard}
              color="blue"
              highlight={globalBalances.netNonCashBalance > 0}
            />

            <StatCard
              title="ОБЩЕЕ САЛЬДО"
              value={formatMoney(globalBalances.netTotalBalance, moneyFmt)}
              subValue={`Премии: ${formatMoneyCompact(globalBalances.totalBonuses)}`}
              icon={Scale}
              color="violet"
              highlight={globalBalances.netTotalBalance > 0}
            />

            <StatCard
              title="ПРОГНОЗ НА КОНЕЦ ПЕРИОДА"
              value={formatMoney(globalBalances.projectedTotalBalance, moneyFmt)}
              subValue={`+10% при сохранении темпов`}
              icon={Sparkles}
              color="amber"
            />
          </div>

          {/* Income/Expense Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-medium">Доходы</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Наличные</span>
                  <span className="text-sm font-medium text-emerald-400">{formatMoneyCompact(globalBalances.totalCashIncome)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Kaspi</span>
                  <span className="text-sm font-medium text-blue-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.kaspiIncome, 0))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Online</span>
                  <span className="text-sm font-medium text-violet-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.onlineIncome, 0))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Карта</span>
                  <span className="text-sm font-medium text-amber-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.cardIncome, 0))}</span>
                </div>
                <div className="border-t border-white/5 pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400">Всего доход</span>
                    <span className="text-sm font-bold text-white">{formatMoneyCompact(globalBalances.totalCashIncome + globalBalances.totalNonCashIncome)}</span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-medium">Расходы</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Долги (авто)</span>
                  <span className="text-sm font-medium text-rose-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.autoDebts, 0))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Штрафы (ручные)</span>
                  <span className="text-sm font-medium text-rose-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.manualMinus, 0))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Авансы</span>
                  <span className="text-sm font-medium text-amber-400">{formatMoneyCompact(analytics.rows.reduce((s, r) => s + r.advances, 0))}</span>
                </div>
                <div className="border-t border-white/5 pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400">Всего расходов</span>
                    <span className="text-sm font-bold text-rose-400">{formatMoneyCompact(globalBalances.totalDebts + globalBalances.totalAdvances)}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Operator Details Modal */}
          {selectedOperator && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
                <div className="p-6 border-b border-white/5 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{selectedOperator.operatorName}</h2>
                      <p className="text-xs text-gray-500">{selectedOperator.operatorShortName || 'Нет короткого имени'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedOperator(null)}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Balance Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <p className="text-xs text-gray-400 mb-1">Сальдо нал</p>
                      <p className={`text-lg font-bold ${selectedOperator.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(selectedOperator.netCash)}
                      </p>
                    </div>
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                      <p className="text-xs text-gray-400 mb-1">Сальдо безнал</p>
                      <p className={`text-lg font-bold ${selectedOperator.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(selectedOperator.netNonCash)}
                      </p>
                    </div>
                    <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                      <p className="text-xs text-gray-400 mb-1">Общее сальдо</p>
                      <p className={`text-lg font-bold ${selectedOperator.netEffect >= 0 ? 'text-violet-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(selectedOperator.netEffect)}
                      </p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-white/5 rounded-xl">
                      <p className="text-xs text-gray-500">Смен</p>
                      <p className="text-xl font-bold">{selectedOperator.shifts}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl">
                      <p className="text-xs text-gray-500">Дней</p>
                      <p className="text-xl font-bold">{selectedOperator.days}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl">
                      <p className="text-xs text-gray-500">Выручка</p>
                      <p className="text-xl font-bold text-emerald-400">{formatMoneyCompact(selectedOperator.totalTurnover)}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl">
                      <p className="text-xs text-gray-500">Ср. смена</p>
                      <p className="text-xl font-bold text-blue-400">{formatMoneyCompact(selectedOperator.avgPerShift)}</p>
                    </div>
                  </div>

                  {/* Daily Chart */}
                  {selectedOperator.dailyData.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-3">Динамика доходов</h3>
                      <div className="h-40">
                        <OperatorDailyChart data={selectedOperator.dailyData} />
                      </div>
                    </div>
                  )}

                  {/* Balance History */}
                  {selectedOperator.balanceHistory.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-3">Динамика сальдо</h3>
                      <div className="h-40">
                        <BalanceChart data={selectedOperator.balanceHistory} />
                      </div>
                    </div>
                  )}

                  {/* Payment Breakdown */}
                  {selectedOperator.paymentBreakdown.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h3 className="text-sm font-medium mb-3">Типы платежей</h3>
                        <div className="h-40">
                          <PaymentPieChart data={selectedOperator.paymentBreakdown} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        {selectedOperator.paymentBreakdown.map((item) => (
                          <div key={item.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-sm text-gray-400">{item.name}</span>
                            </div>
                            <span className="text-sm font-medium">{formatMoneyCompact(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Financial Summary */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Премии</p>
                      <p className="text-lg font-bold text-emerald-400">{formatMoneyCompact(selectedOperator.manualPlus)}</p>
                    </div>
                    <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Авансы</p>
                      <p className="text-lg font-bold text-amber-400">{formatMoneyCompact(selectedOperator.advances)}</p>
                    </div>
                    <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Долги</p>
                      <p className="text-lg font-bold text-red-400">{formatMoneyCompact(selectedOperator.autoDebts)}</p>
                    </div>
                    <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Штрафы</p>
                      <p className="text-lg font-bold text-red-400">{formatMoneyCompact(selectedOperator.manualMinus)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Table - с фокусом на сальдо */}
          <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="py-3 px-2 text-left">
                      <button
                        onClick={() => handleSort('name')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                      >
                        Оператор
                        {sortKey === 'name' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-center">
                      <button
                        onClick={() => handleSort('shifts')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                      >
                        Смен
                        {sortKey === 'shifts' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-center">Дней</th>
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('turnover')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Выручка
                        {sortKey === 'turnover' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-right text-emerald-400">Нал доход</th>
                    <th className="py-3 px-2 text-right text-blue-400">Безнал доход</th>
                    <th className="py-3 px-2 text-right text-red-400">Долги</th>
                    <th className="py-3 px-2 text-right text-amber-400">Авансы</th>
                    <th className="py-3 px-2 text-right text-emerald-400">Премии</th>
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('netCash')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Сальдо нал
                        {sortKey === 'netCash' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('netNonCash')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Сальдо безнал
                        {sortKey === 'netNonCash' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('netTotal')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Общее сальдо
                        {sortKey === 'netTotal' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {(loading || refreshing) && (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-gray-500">
                        Загрузка данных...
                      </td>
                    </tr>
                  )}

                  {!loading && !refreshing && rows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-gray-500">
                        Нет данных за выбранный период
                      </td>
                    </tr>
                  )}

                  {!loading && !refreshing && rows.map((op) => (
                    <tr
                      key={op.operatorId}
                      onClick={() => setSelectedOperator(op)}
                      className="border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-2 font-medium">{op.operatorName}</td>
                      <td className="py-2 px-2 text-center">{op.shifts}</td>
                      <td className="py-2 px-2 text-center">{op.days}</td>
                      <td className="py-2 px-2 text-right font-medium text-emerald-400">
                        {formatMoneyCompact(op.totalTurnover)}
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-400">{formatMoneyCompact(op.cashIncome)}</td>
                      <td className="py-2 px-2 text-right text-blue-400">{formatMoneyCompact(op.nonCashIncome)}</td>
                      <td className="py-2 px-2 text-right text-red-400">{formatMoneyCompact(op.totalDebts)}</td>
                      <td className="py-2 px-2 text-right text-amber-400">{formatMoneyCompact(op.advances)}</td>
                      <td className="py-2 px-2 text-right text-emerald-400">{formatMoneyCompact(op.manualPlus)}</td>
                      <td className={`py-2 px-2 text-right font-medium ${op.netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(op.netCash)}
                      </td>
                      <td className={`py-2 px-2 text-right font-medium ${op.netNonCash >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(op.netNonCash)}
                      </td>
                      <td className={`py-2 px-2 text-right font-bold ${op.netEffect >= 0 ? 'text-violet-400' : 'text-rose-400'}`}>
                        {formatMoneyCompact(op.netEffect)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {rows.length > 0 && (
                  <tfoot className="border-t border-white/5 bg-white/5">
                    <tr>
                      <td className="py-3 px-2 font-semibold">Итого</td>
                      <td className="py-3 px-2 text-center font-semibold">{totalsFiltered.shifts}</td>
                      <td className="py-3 px-2 text-center font-semibold">{totalsFiltered.days}</td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(totalsFiltered.turnover)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(totalsFiltered.cashIncome)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-blue-400">
                        {formatMoneyCompact(totalsFiltered.nonCashIncome)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-red-400">
                        {formatMoneyCompact(totalsFiltered.debts)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-amber-400">
                        {formatMoneyCompact(totalsFiltered.advances)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(totalsFiltered.bonuses)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(totalsFiltered.netCash)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-blue-400">
                        {formatMoneyCompact(totalsFiltered.netNonCash)}
                      </td>
                      <td className="py-3 px-2 text-right font-bold text-white">
                        {formatMoneyCompact(totalsFiltered.netTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Charts Section */}
          {showCharts && rows.length > 0 && mounted && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Operators by Balance */}
              <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Scale className="w-4 h-4 text-violet-400" />
                  Топ-5 операторов по общему сальдо
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={rows.slice(0, 5).map(op => ({
                        name: op.operatorShortName || op.operatorName.split(' ')[0],
                        value: op.netEffect,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
                      <XAxis type="number" tickFormatter={formatCompact} stroke="#6b7280" fontSize={10} />
                      <YAxis type="category" dataKey="name" stroke="#6b7280" fontSize={10} width={80} />
                      <Tooltip
                        formatter={(value: number) => formatMoneyFull(value)}
                        contentStyle={{ background: '#1f2937', border: 'none', borderRadius: '8px' }}
                      />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]}>
                        {rows.slice(0, 5).map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.netEffect >= 0 ? '#10b981' : '#ef4444'} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Balance Composition */}
              <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-amber-400" />
                  Состав общего сальдо
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={[
                          { name: 'Наличные (сальдо)', value: Math.max(0, globalBalances.netCashBalance), color: '#10b981' },
                          { name: 'Безнал (сальдо)', value: Math.max(0, globalBalances.netNonCashBalance), color: '#3b82f6' },
                          { name: 'Отрицательное сальдо', value: Math.max(0, -globalBalances.netTotalBalance), color: '#ef4444' },
                        ].filter(item => item.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {PIE_COLORS.slice(0, 3).map((color, idx) => (
                          <Cell key={`cell-${idx}`} fill={color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatMoneyFull(value)}
                        contentStyle={{ background: '#1f2937', border: 'none', borderRadius: '8px' }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

// =====================
// MAIN EXPORT with Suspense
// =====================
export default function OperatorAnalyticsPage() {
  return (
    <Suspense fallback={<OperatorAnalyticsLoading />}>
      <OperatorAnalyticsContent />
    </Suspense>
  )
}
