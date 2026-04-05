'use client'

import { useEffect, useMemo, useRef, useState, memo, useCallback, Suspense } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  Share2,
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
  Clock,
  Target,
  TrendingUp as TrendUp,
  Phone,
  Mail,
  FileText,
  Building2,
  Briefcase,
  Eye,
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
// TYPES
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

// Расширенный тип оператора с данными из профиля
type OperatorProfile = {
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  documents_count: number
  expiring_documents: number
}

type OperatorAnalyticsRow = {
  operatorId: string
  operatorName: string
  operatorShortName: string | null

  // Данные из профиля
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  documents_count: number
  expiring_documents: number

  // Аналитические данные
  shifts: number
  days: number
  totalTurnover: number
  avgPerShift: number
  share: number
  cashAmount: number
  kaspiAmount: number
  onlineAmount: number
  cardAmount: number
  autoDebts: number
  manualMinus: number
  manualPlus: number
  advances: number
  netEffect: number

  dailyData: { date: string; amount: number }[]
  paymentBreakdown: { name: string; value: number; color: string }[]
  
  // Дополнительные метрики для детального просмотра
  shiftEfficiency?: number
  bestDay?: { date: string; amount: number }
  worstDay?: { date: string; amount: number }
  paymentMethodDominant?: string
}

type SortKey = 'turnover' | 'avg' | 'penalties' | 'net' | 'shifts' | 'name'
type SortDirection = 'asc' | 'desc'

type DatePreset = 'custom' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'

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

const formatPhone = (phone: string | null): string => {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})$/)
  if (match) {
    return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}-${match[5]}`
  }
  return phone
}

const calculateTenure = (hireDate: string | null): string => {
  if (!hireDate) return ''
  const start = new Date(hireDate)
  const now = new Date()
  const years = now.getFullYear() - start.getFullYear()
  const months = now.getMonth() - start.getMonth()
  
  let totalMonths = years * 12 + months
  if (totalMonths < 0) return '0 месяцев'
  
  const yearsText = Math.floor(totalMonths / 12)
  const monthsText = totalMonths % 12
  
  if (yearsText > 0 && monthsText > 0) {
    return `${yearsText} ${getYearWord(yearsText)} ${monthsText} ${getMonthWord(monthsText)}`
  } else if (yearsText > 0) {
    return `${yearsText} ${getYearWord(yearsText)}`
  } else {
    return `${monthsText} ${getMonthWord(monthsText)}`
  }
}

const getYearWord = (years: number): string => {
  if (years % 10 === 1 && years % 100 !== 11) return 'год'
  if ([2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100)) return 'года'
  return 'лет'
}

const getMonthWord = (months: number): string => {
  if (months % 10 === 1 && months % 100 !== 11) return 'месяц'
  if ([2, 3, 4].includes(months % 10) && ![12, 13, 14].includes(months % 100)) return 'месяца'
  return 'месяцев'
}

const safeNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

// =====================
// MEMOIZED CHART COMPONENTS
// =====================
const OperatorDailyChart = memo(({ data }: { data: { date: string; amount: number }[] }) => {
  const chartData = data.map(d => ({
    ...d,
    label: d.date.slice(5),
  }))

  const maxAmount = Math.max(...data.map(d => d.amount))
  const minAmount = Math.min(...data.filter(d => d.amount > 0).map(d => d.amount))

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Макс: <span className="text-emerald-400 font-medium">{formatMoneyCompact(maxAmount)}</span></span>
        <span>Мин: <span className="text-rose-400 font-medium">{formatMoneyCompact(minAmount)}</span></span>
        <span>Сред: <span className="text-blue-400 font-medium">{formatMoneyCompact(data.reduce((sum, d) => sum + d.amount, 0) / data.length)}</span></span>
      </div>
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
            formatter={(value: number) => [formatMoneyFull(value), 'Выручка']}
          />
          <Line 
            type="monotone" 
            dataKey="amount" 
            stroke="#3b82f6" 
            strokeWidth={2}
            dot={{ fill: '#3b82f6', r: 2 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
      className={`relative overflow-hidden rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-5 hover:bg-gray-800/50 transition-all ${onClick ? 'cursor-pointer' : ''}`}
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
        <p className="text-xl font-bold text-white mb-1">{value}</p>
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
// MODAL COMPONENT
// =====================
const OperatorDetailsModal = memo(({ 
  operator, 
  onClose,
  formatMoneyFull,
  formatMoneyCompact 
}: { 
  operator: OperatorAnalyticsRow | null
  onClose: () => void
  formatMoneyFull: (n: number) => string
  formatMoneyCompact: (n: number) => string
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'payments' | 'adjustments'>('overview')
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'auto'
    }
  }, [onClose])

  if (!operator) return null

  const totalDeductions = operator.autoDebts + operator.manualMinus
  const finalBalance = operator.totalTurnover + operator.manualPlus - operator.advances - totalDeductions
  const avgPerDay = operator.days > 0 ? operator.totalTurnover / operator.days : 0
  const shiftsPerDay = operator.days > 0 ? (operator.shifts / operator.days).toFixed(1) : '0'
  const tenure = calculateTenure(operator.hire_date)
  
  const bestDay = operator.dailyData.length > 0 
    ? operator.dailyData.reduce((max, d) => d.amount > max.amount ? d : max, operator.dailyData[0])
    : null
  const worstDay = operator.dailyData.length > 0
    ? operator.dailyData.filter(d => d.amount > 0).reduce((min, d) => d.amount < min.amount ? d : min, operator.dailyData[0])
    : null

  const dominantPayment = operator.paymentBreakdown.length > 0
    ? operator.paymentBreakdown.reduce((max, p) => p.value > max.value ? p : max, operator.paymentBreakdown[0])
    : null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div 
        ref={modalRef}
        className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-4xl my-8 animate-in fade-in zoom-in duration-200"
      >
        <div className="sticky top-0 bg-gray-900 border-b border-white/5 rounded-t-2xl z-10">
          <div className="p-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-violet-500 to-fuchsia-500">
                {operator.photo_url ? (
                  <Image
                    src={operator.photo_url}
                    alt={operator.operatorName}
                    width={48}
                    height={48}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-lg font-bold">
                    {operator.operatorName.charAt(0)}
                  </div>
                )}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {operator.operatorName}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  {operator.position && (
                    <>
                      <p className="text-sm text-gray-400">{operator.position}</p>
                      <span className="w-1 h-1 rounded-full bg-gray-600" />
                    </>
                  )}
                  <p className="text-sm text-gray-400 font-mono">ID: {operator.operatorId.slice(0, 8)}</p>
                  {tenure && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-gray-600" />
                      <p className="text-sm text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {tenure}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="flex gap-1 px-6 pb-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'overview'
                  ? 'bg-violet-500/20 text-violet-400 border-b-2 border-violet-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Обзор
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'payments'
                  ? 'bg-violet-500/20 text-violet-400 border-b-2 border-violet-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Платежи
            </button>
            <button
              onClick={() => setActiveTab('adjustments')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'adjustments'
                  ? 'bg-violet-500/20 text-violet-400 border-b-2 border-violet-500'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Корректировки
            </button>
          </div>
        </div>

        <div className="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-xl border border-emerald-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-gray-500">Выручка</span>
                  </div>
                  <p className="text-xl font-bold text-emerald-400">{formatMoneyCompact(operator.totalTurnover)}</p>
                  <p className="text-xs text-gray-500 mt-1">{operator.days} дн • {operator.shifts} см</p>
                </div>

                <div className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-500/5 rounded-xl border border-blue-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <TrendUp className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-gray-500">Среднее</span>
                  </div>
                  <p className="text-xl font-bold text-blue-400">{formatMoneyCompact(operator.avgPerShift)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatMoneyCompact(avgPerDay)}/день</p>
                </div>

                <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 rounded-xl border border-amber-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span className="text-xs text-gray-500">Премии</span>
                  </div>
                  <p className="text-xl font-bold text-amber-400">{formatMoneyCompact(operator.manualPlus)}</p>
                  <p className="text-xs text-gray-500 mt-1">Авансы: {formatMoneyCompact(operator.advances)}</p>
                </div>

                <div className="p-4 bg-gradient-to-br from-rose-500/10 to-rose-500/5 rounded-xl border border-rose-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span className="text-xs text-gray-500">Удержания</span>
                  </div>
                  <p className="text-xl font-bold text-rose-400">{formatMoneyCompact(totalDeductions)}</p>
                  <p className="text-xs text-gray-500 mt-1">Долги: {formatMoneyCompact(operator.autoDebts)}</p>
                </div>
              </div>

              {operator.dailyData.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Динамика выручки по дням</h3>
                  <div className="h-48 bg-gray-800/30 rounded-xl p-4 border border-white/5">
                    <OperatorDailyChart data={operator.dailyData} />
                  </div>
                  <div className="flex justify-between text-xs">
                    {bestDay && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">Лучший:</span>
                        <span className="text-emerald-400">
                          {bestDay.date.slice(5)} • {formatMoneyCompact(bestDay.amount)}
                        </span>
                      </div>
                    )}
                    {worstDay && bestDay !== worstDay && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">Худший:</span>
                        <span className="text-rose-400">
                          {worstDay.date.slice(5)} • {formatMoneyCompact(worstDay.amount)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Всего смен</p>
                  <p className="text-lg font-semibold text-white">{operator.shifts}</p>
                </div>
                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Рабочих дней</p>
                  <p className="text-lg font-semibold text-white">{operator.days}</p>
                </div>
                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Смен в день</p>
                  <p className="text-lg font-semibold text-white">{shiftsPerDay}</p>
                </div>
                <div className="p-3 bg-gray-800/30 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Доля в выручке</p>
                  <p className="text-lg font-semibold text-white">{(operator.share * 100).toFixed(1)}%</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-gray-800/30 rounded-xl border border-emerald-500/20">
                  <p className="text-xs text-gray-500 mb-2">Наличные</p>
                  <p className="text-xl font-bold text-emerald-400">{formatMoneyCompact(operator.cashAmount)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {operator.totalTurnover > 0 ? ((operator.cashAmount / operator.totalTurnover) * 100).toFixed(1) : 0}% от выручки
                  </p>
                </div>
                <div className="p-4 bg-gray-800/30 rounded-xl border border-blue-500/20">
                  <p className="text-xs text-gray-500 mb-2">Kaspi</p>
                  <p className="text-xl font-bold text-blue-400">{formatMoneyCompact(operator.kaspiAmount)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {operator.totalTurnover > 0 ? ((operator.kaspiAmount / operator.totalTurnover) * 100).toFixed(1) : 0}% от выручки
                  </p>
                </div>
                <div className="p-4 bg-gray-800/30 rounded-xl border border-violet-500/20">
                  <p className="text-xs text-gray-500 mb-2">Online</p>
                  <p className="text-xl font-bold text-violet-400">{formatMoneyCompact(operator.onlineAmount)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {operator.totalTurnover > 0 ? ((operator.onlineAmount / operator.totalTurnover) * 100).toFixed(1) : 0}% от выручки
                  </p>
                </div>
                <div className="p-4 bg-gray-800/30 rounded-xl border border-amber-500/20">
                  <p className="text-xs text-gray-500 mb-2">Карта</p>
                  <p className="text-xl font-bold text-amber-400">{formatMoneyCompact(operator.cardAmount)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {operator.totalTurnover > 0 ? ((operator.cardAmount / operator.totalTurnover) * 100).toFixed(1) : 0}% от выручки
                  </p>
                </div>
              </div>

              {dominantPayment && (
                <div className="p-4 bg-gray-800/30 rounded-xl border border-white/5">
                  <p className="text-sm text-gray-400">Доминирующий метод оплаты</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: dominantPayment.color }}>
                    {dominantPayment.name}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    {((dominantPayment.value / operator.totalTurnover) * 100).toFixed(1)}% от общей выручки
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'adjustments' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-5 h-5 text-emerald-400" />
                    <span className="font-medium text-emerald-400">Премии</span>
                  </div>
                  <p className="text-2xl font-bold text-emerald-400 mb-2">{formatMoneyFull(operator.manualPlus)}</p>
                  <p className="text-xs text-gray-500">Начислено за высокие показатели</p>
                </div>

                <div className="p-4 bg-amber-500/5 rounded-xl border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="w-5 h-5 text-amber-400" />
                    <span className="font-medium text-amber-400">Авансы</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-400 mb-2">{formatMoneyFull(operator.advances)}</p>
                  <p className="text-xs text-gray-500">Выдано авансов за период</p>
                </div>

                <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-rose-400" />
                    <span className="font-medium text-rose-400">Автоматические долги</span>
                  </div>
                  <p className="text-2xl font-bold text-rose-400 mb-2">{formatMoneyFull(operator.autoDebts)}</p>
                  <p className="text-xs text-gray-500">Долги по зарплате/выручке</p>
                </div>

                <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <span className="font-medium text-rose-400">Ручные штрафы</span>
                  </div>
                  <p className="text-2xl font-bold text-rose-400 mb-2">{formatMoneyFull(operator.manualMinus)}</p>
                  <p className="text-xs text-gray-500">Штрафы за нарушения</p>
                </div>
              </div>

              <div className="mt-6 p-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl border border-white/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-400 mb-2">Итоговый баланс за период</p>
                    <p className="text-3xl font-bold text-white">{formatMoneyFull(finalBalance)}</p>
                    <div className="flex flex-wrap gap-4 mt-3 text-xs">
                      <span className="text-gray-500">Выручка: {formatMoneyCompact(operator.totalTurnover)}</span>
                      <span className="text-gray-500">Премии: +{formatMoneyCompact(operator.manualPlus)}</span>
                      <span className="text-gray-500">Удержания: -{formatMoneyCompact(totalDeductions)}</span>
                    </div>
                  </div>
                  <div className={`px-4 py-3 rounded-xl ${
                    operator.netEffect >= 0 
                      ? 'bg-emerald-500/20 border border-emerald-500/30' 
                      : 'bg-rose-500/20 border border-rose-500/30'
                  }`}>
                    <p className="text-sm text-gray-400 mb-1">Чистый эффект</p>
                    <p className={`text-xl font-bold ${operator.netEffect >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {operator.netEffect >= 0 ? '+' : ''}{formatMoneyFull(operator.netEffect)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-900 border-t border-white/5 rounded-b-2xl p-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
})
OperatorDetailsModal.displayName = 'OperatorDetailsModal'

// =====================
// LOADING COMPONENT
// =====================
function OperatorAnalyticsLoading() {
  return (
    <>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Users2 className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка аналитики операторов...</p>
        </div>
    </>
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
  const [operatorProfiles, setOperatorProfiles] = useState<Map<string, OperatorProfile>>(new Map())
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
  const [sortKey, setSortKey] = useState<SortKey>('turnover')
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

  // Load static data + profiles
  useEffect(() => {
    const loadStatic = async () => {
      setStaticLoading(true)
      setError(null)

      const resp = await fetch('/api/admin/operator-analytics')
      const json = await resp.json()
      if (!resp.ok || json.error) {
        setError('Ошибка загрузки справочников')
        setStaticLoading(false)
        return
      }

      const { companies: companiesData, operators: operatorsData, profiles: profilesData, documents: documentsData } = json.data
      setCompanies((companiesData || []) as Company[])
      setOperators((operatorsData || []) as Operator[])

      // Создаем карту профилей
      const profilesMap = new Map<string, OperatorProfile>()
      for (const p of profilesData || []) {
        profilesMap.set(p.operator_id, {
          photo_url: p.photo_url,
          position: p.position,
          phone: p.phone,
          email: p.email,
          hire_date: p.hire_date,
          documents_count: 0,
          expiring_documents: 0,
        })
      }

      // Считаем документы и просроченные
      const now = new Date()
      const thirtyDaysFromNow = new Date()
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

      const docsCount = new Map<string, number>()
      const expiringCount = new Map<string, number>()

      for (const d of documentsData || []) {
        const opId = d.operator_id
        docsCount.set(opId, (docsCount.get(opId) || 0) + 1)
        
        if (d.expiry_date) {
          const expiryDate = new Date(d.expiry_date)
          if (expiryDate <= thirtyDaysFromNow && expiryDate >= now) {
            expiringCount.set(opId, (expiringCount.get(opId) || 0) + 1)
          }
        }
      }

      // Обновляем карту профилей с количеством документов
      for (const [opId, profile] of profilesMap) {
        profile.documents_count = docsCount.get(opId) || 0
        profile.expiring_documents = expiringCount.get(opId) || 0
      }

      setOperatorProfiles(profilesMap)
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

  // Process analytics
  const analytics = useMemo(() => {
    const byOperator = new Map<string, OperatorAnalyticsRow>()
    const daysByOperator = new Map<string, Set<string>>()
    const shiftsByOperator = new Map<string, Set<string>>()
    const dailyByOperator = new Map<string, Map<string, number>>()

    let totalTurnover = 0
    let totalAutoDebts = 0
    let totalMinus = 0
    let totalPlus = 0
    let totalAdvances = 0

    const ensureOp = (id: string | null): OperatorAnalyticsRow | null => {
      if (!id) return null
      const meta = operatorById.get(id)
      if (!meta) return null
      if (!showInactive && !meta.is_active) return null

      let op = byOperator.get(id)
      if (!op) {
        const name = meta.short_name || meta.name || 'Без имени'
        const profile = operatorProfiles.get(id) || {
          photo_url: null,
          position: null,
          phone: null,
          email: null,
          hire_date: null,
          documents_count: 0,
          expiring_documents: 0,
        }

        op = {
          operatorId: id,
          operatorName: meta.name,
          operatorShortName: meta.short_name,
          // Данные из профиля
          photo_url: profile.photo_url,
          position: profile.position,
          phone: profile.phone,
          email: profile.email,
          hire_date: profile.hire_date,
          documents_count: profile.documents_count,
          expiring_documents: profile.expiring_documents,
          // Аналитические данные
          shifts: 0,
          days: 0,
          totalTurnover: 0,
          avgPerShift: 0,
          share: 0,
          cashAmount: 0,
          kaspiAmount: 0,
          onlineAmount: 0,
          cardAmount: 0,
          autoDebts: 0,
          manualMinus: 0,
          manualPlus: 0,
          advances: 0,
          netEffect: 0,
          dailyData: [],
          paymentBreakdown: [],
        }
        byOperator.set(id, op)
        daysByOperator.set(id, new Set())
        shiftsByOperator.set(id, new Set())
        dailyByOperator.set(id, new Map())
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
      const total = cash + kaspi + online + card

      if (!Number.isFinite(total) || total <= 0) continue

      op.totalTurnover += total
      op.cashAmount += cash
      op.kaspiAmount += kaspi
      op.onlineAmount += online
      op.cardAmount += card
      totalTurnover += total

      daysByOperator.get(row.operator_id)!.add(row.date)

      const shiftKey = `${row.date}|${row.shift || 'na'}|${row.company_id}|${row.operator_id}`
      shiftsByOperator.get(row.operator_id)!.add(shiftKey)

      // Daily data
      const dailyMap = dailyByOperator.get(row.operator_id)!
      dailyMap.set(row.date, (dailyMap.get(row.date) || 0) + total)
    }

    // Process debts
    for (const d of debts) {
      const op = ensureOp(d.operator_id)
      if (!op) continue
      const amount = safeNumber(d.amount)
      if (amount <= 0) continue
      op.autoDebts += amount
      totalAutoDebts += amount
    }

    // Process adjustments
    for (const adj of adjustments) {
      const op = ensureOp(adj.operator_id)
      if (!op) continue

      const amount = safeNumber(adj.amount)
      if (amount <= 0) continue

      if (adj.kind === 'bonus') {
        op.manualPlus += amount
        totalPlus += amount
      } else if (adj.kind === 'advance') {
        op.advances += amount
        totalAdvances += amount
      } else {
        op.manualMinus += amount
        totalMinus += amount
      }
    }

    // Finalize
    const arr: OperatorAnalyticsRow[] = []
    for (const op of byOperator.values()) {
      op.days = daysByOperator.get(op.operatorId)?.size || 0
      op.shifts = shiftsByOperator.get(op.operatorId)?.size || 0
      op.avgPerShift = op.shifts > 0 ? op.totalTurnover / op.shifts : 0
      op.share = totalTurnover > 0 ? op.totalTurnover / totalTurnover : 0
      op.netEffect = op.manualPlus - op.manualMinus - op.autoDebts

      const dailyMap = dailyByOperator.get(op.operatorId) || new Map()
      op.dailyData = Array.from(dailyMap.entries())
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date))

      op.paymentBreakdown = [
        { name: 'Наличные', value: op.cashAmount, color: PAYMENT_COLORS.cash },
        { name: 'Kaspi', value: op.kaspiAmount, color: PAYMENT_COLORS.kaspi },
        { name: 'Online', value: op.onlineAmount, color: PAYMENT_COLORS.online },
        { name: 'Карта', value: op.cardAmount, color: PAYMENT_COLORS.card },
      ].filter(item => item.value > 0)

      arr.push(op)
    }

    // Search
    const term = search.trim().toLowerCase()
    const searched = term
      ? arr.filter(r => 
          r.operatorName.toLowerCase().includes(term) ||
          (r.operatorShortName?.toLowerCase() || '').includes(term)
        )
      : arr

    // Sort
    const sorted = [...searched].sort((a, b) => {
      let aVal: number | string = 0
      let bVal: number | string = 0

      switch (sortKey) {
        case 'name':
          aVal = a.operatorName
          bVal = b.operatorName
          break
        case 'turnover':
          aVal = a.totalTurnover
          bVal = b.totalTurnover
          break
        case 'avg':
          aVal = a.avgPerShift
          bVal = b.avgPerShift
          break
        case 'penalties':
          aVal = a.autoDebts + a.manualMinus
          bVal = b.autoDebts + b.manualMinus
          break
        case 'net':
          aVal = a.netEffect
          bVal = b.netEffect
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
        acc.shifts += r.shifts
        acc.days += r.days
        acc.autoDebts += r.autoDebts
        acc.manualMinus += r.manualMinus
        acc.manualPlus += r.manualPlus
        acc.advances += r.advances
        acc.netEffect += r.netEffect
        return acc
      },
      {
        turnover: 0,
        shifts: 0,
        days: 0,
        autoDebts: 0,
        manualMinus: 0,
        manualPlus: 0,
        advances: 0,
        netEffect: 0,
      },
    )

    return {
      rows: sorted,
      totalTurnover,
      totalAutoDebts,
      totalMinus,
      totalPlus,
      totalAdvances,
      totalsFiltered,
    }
  }, [
    companyById,
    operatorById,
    operatorProfiles,
    incomes,
    debts,
    adjustments,
    allowedCodes,
    search,
    sortKey,
    sortDirection,
    showInactive,
  ])

  // AI Insights
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    
    if (analytics.rows.length === 0) return insights

    // Top performer
    const topByTurnover = analytics.rows[0]
    if (topByTurnover && topByTurnover.totalTurnover > 0) {
      insights.push({
        type: 'success',
        title: 'Лучший оператор',
        description: `${topByTurnover.operatorName} — лидер по выручке`,
        metric: formatMoneyCompact(topByTurnover.totalTurnover),
        operatorId: topByTurnover.operatorId,
      })
    }

    // High penalties
    const highPenalties = analytics.rows
      .filter(r => (r.autoDebts + r.manualMinus) > analytics.totalsFiltered.turnover * 0.1)
    if (highPenalties.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Высокие штрафы',
        description: `${highPenalties.length} операторов имеют штрафы >10% от выручки`,
        metric: `${highPenalties.length} чел.`,
      })
    }

    // Low efficiency
    const avgPerShiftAll = analytics.totalsFiltered.shifts > 0
      ? analytics.totalsFiltered.turnover / analytics.totalsFiltered.shifts
      : 0
    const lowEfficiency = analytics.rows
      .filter(r => r.shifts > 3 && r.avgPerShift < avgPerShiftAll * 0.5)
    if (lowEfficiency.length > 0) {
      insights.push({
        type: 'opportunity',
        title: 'Низкая эффективность',
        description: `${lowEfficiency.length} операторов с выручкой ниже среднего в 2 раза`,
        metric: `${lowEfficiency.length} чел.`,
      })
    }

    // Net effect negative
    const negativeNet = analytics.rows.filter(r => r.netEffect < 0)
    if (negativeNet.length > 0) {
      insights.push({
        type: 'danger',
        title: 'Отрицательный баланс',
        description: `${negativeNet.length} операторов должны больше, чем заработали`,
        metric: `${negativeNet.length} чел.`,
      })
    }

    // No shifts
    const noShifts = analytics.rows.filter(r => r.shifts === 0)
    if (noShifts.length > 0) {
      insights.push({
        type: 'info',
        title: 'Нет смен',
        description: `${noShifts.length} операторов не работали в этот период`,
        metric: `${noShifts.length} чел.`,
      })
    }

    return insights.slice(0, 4)
  }, [analytics])

  const totalPenalties = analytics.totalAutoDebts + analytics.totalMinus
  const avgPerShiftOverall = analytics.totalsFiltered.shifts > 0
    ? analytics.totalsFiltered.turnover / analytics.totalsFiltered.shifts
    : 0

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

  const handleDownloadCSV = useCallback(async () => {
    const wb = createWorkbook()
    const period = `${dateFrom} — ${dateTo}`

    // Sheet 1: Summary
    buildStyledSheet(wb, 'Сводка', 'Аналитика операторов — Сводка', `Период: ${period}`, [
      { header: 'Показатель', key: 'label', width: 28, type: 'text' },
      { header: 'Значение', key: 'value', width: 20, type: 'money' },
    ], [
      { label: 'Общая выручка', value: Math.round(analytics.totalsFiltered.turnover) },
      { label: 'Всего смен', value: analytics.totalsFiltered.shifts },
      { label: 'Средняя смена', value: Math.round(avgPerShiftOverall) },
      { label: 'Премии', value: Math.round(analytics.totalPlus) },
      { label: 'Штрафы и долги', value: Math.round(totalPenalties) },
      { label: 'Авансы', value: Math.round(analytics.totalAdvances) },
      { _isTotals: true, label: 'Чистый эффект', value: Math.round(analytics.totalsFiltered.netEffect) },
    ])

    // Sheet 2: Detailed operators
    const opRows = analytics.rows.map(op => ({
      name: op.operatorName,
      shifts: op.shifts,
      days: op.days,
      turnover: Math.round(op.totalTurnover),
      avgShift: Math.round(op.avgPerShift),
      share: op.share * 100,
      cash: Math.round(op.cashAmount),
      kaspi: Math.round(op.kaspiAmount),
      online: Math.round(op.onlineAmount),
      card: Math.round(op.cardAmount),
      debts: Math.round(op.autoDebts),
      fines: Math.round(op.manualMinus),
      bonuses: Math.round(op.manualPlus),
      advances: Math.round(op.advances),
      net: Math.round(op.netEffect),
    }))
    const tot = opRows.reduce((a, r) => ({ turnover: a.turnover + r.turnover, cash: a.cash + r.cash, kaspi: a.kaspi + r.kaspi, online: a.online + r.online, card: a.card + r.card, debts: a.debts + r.debts, fines: a.fines + r.fines, bonuses: a.bonuses + r.bonuses, advances: a.advances + r.advances, net: a.net + r.net }), { turnover: 0, cash: 0, kaspi: 0, online: 0, card: 0, debts: 0, fines: 0, bonuses: 0, advances: 0, net: 0 })
    opRows.push({ _isTotals: true, name: 'ИТОГО', shifts: analytics.totalsFiltered.shifts, days: 0, avgShift: 0, share: 100, ...tot } as any)
    buildStyledSheet(wb, 'Операторы', 'Аналитика операторов', `Период: ${period}`, [
      { header: 'Оператор', key: 'name', width: 24, type: 'text' },
      { header: 'Смен', key: 'shifts', width: 8, type: 'number', align: 'right' },
      { header: 'Дней', key: 'days', width: 8, type: 'number', align: 'right' },
      { header: 'Выручка', key: 'turnover', width: 16, type: 'money' },
      { header: 'Ср. смена', key: 'avgShift', width: 14, type: 'money' },
      { header: 'Доля %', key: 'share', width: 10, type: 'percent' },
      { header: 'Нал', key: 'cash', width: 14, type: 'money' },
      { header: 'Kaspi', key: 'kaspi', width: 14, type: 'money' },
      { header: 'Online', key: 'online', width: 14, type: 'money' },
      { header: 'Карта', key: 'card', width: 14, type: 'money' },
      { header: 'Долги', key: 'debts', width: 13, type: 'money' },
      { header: 'Штрафы', key: 'fines', width: 13, type: 'money' },
      { header: 'Премии', key: 'bonuses', width: 13, type: 'money' },
      { header: 'Авансы', key: 'advances', width: 13, type: 'money' },
      { header: 'Чистый эффект', key: 'net', width: 16, type: 'money' },
    ], opRows)

    await downloadWorkbook(wb, `operators_${dateFrom}_${dateTo}.xlsx`)
    showToast('Excel отчёт скачан', 'success')
  }, [analytics, dateFrom, dateTo, avgPerShiftOverall, totalPenalties, showToast])

  // Loading states
  if (staticLoading && companies.length === 0) {
    return <OperatorAnalyticsLoading />
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

  // Main render
  return (
    <>
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
                    Аналитика операторов
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              title="Общая выручка"
              value={formatMoney(analytics.totalsFiltered.turnover, moneyFmt)}
              subValue={`${analytics.totalsFiltered.shifts} смен • ${analytics.totalsFiltered.days} дней`}
              icon={DollarSign}
              color="green"
            />

            <StatCard
              title="Средняя смена"
              value={formatMoney(avgPerShiftOverall, moneyFmt)}
              subValue={analytics.totalsFiltered.shifts > 0 ? `${Math.round(analytics.totalsFiltered.turnover / analytics.totalsFiltered.days)} ₸/день` : 'нет данных'}
              icon={TrendingUp}
              color="blue"
            />

            <StatCard
              title="Премии"
              value={formatMoney(analytics.totalPlus, moneyFmt)}
              subValue={`${analytics.rows.filter(r => r.manualPlus > 0).length} операторов`}
              icon={Award}
              color="amber"
            />

            <StatCard
              title="Штрафы и долги"
              value={formatMoney(totalPenalties, moneyFmt)}
              subValue={`Авто: ${formatMoneyCompact(analytics.totalAutoDebts)} | Ручные: ${formatMoneyCompact(analytics.totalMinus)}`}
              icon={AlertTriangle}
              color="red"
            />

            <StatCard
              title="Чистый эффект"
              value={formatMoney(analytics.totalsFiltered.netEffect, moneyFmt)}
              subValue={`Авансы: ${formatMoneyCompact(analytics.totalAdvances)}`}
              icon={Scale}
              color={analytics.totalsFiltered.netEffect >= 0 ? 'violet' : 'red'}
            />
          </div>

          {/* Operator Details Modal */}
          {selectedOperator && (
            <OperatorDetailsModal
              operator={selectedOperator}
              onClose={() => setSelectedOperator(null)}
              formatMoneyFull={formatMoneyFull}
              formatMoneyCompact={formatMoneyCompact}
            />
          )}

          {/* Main Table */}
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
                    <th className="py-3 px-2 text-left">Контакты</th>
                    <th className="py-3 px-2 text-center">Документы</th>
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
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('avg')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Ср. смена
                        {sortKey === 'avg' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 text-right">Доля</th>
                    <th className="py-3 px-2 text-right text-emerald-400">Нал</th>
                    <th className="py-3 px-2 text-right text-blue-400">Kaspi</th>
                    <th className="py-3 px-2 text-right text-violet-400">Online</th>
                    <th className="py-3 px-2 text-right text-amber-400">Карта</th>
                    <th className="py-3 px-2 text-right text-red-400">Долги</th>
                    <th className="py-3 px-2 text-right text-red-400">Штрафы</th>
                    <th className="py-3 px-2 text-right text-emerald-400">Премии</th>
                    <th className="py-3 px-2 text-right text-amber-400">Авансы</th>
                    <th className="py-3 px-2 text-right">
                      <button
                        onClick={() => handleSort('net')}
                        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors ml-auto"
                      >
                        Чистый
                        {sortKey === 'net' && (
                          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {(loading || refreshing) && (
                    <tr>
                      <td colSpan={18} className="py-8 text-center text-gray-500">
                        Загрузка данных...
                      </td>
                    </tr>
                  )}

                  {!loading && !refreshing && analytics.rows.length === 0 && (
                    <tr>
                      <td colSpan={18} className="py-8 text-center text-gray-500">
                        Нет данных за выбранный период
                      </td>
                    </tr>
                  )}

                  {!loading && !refreshing && analytics.rows.map((op) => {
                    const tenure = calculateTenure(op.hire_date)
                    
                    return (
                      <tr
                        key={op.operatorId}
                        onClick={() => setSelectedOperator(op)}
                        className="border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-2">
                          <Link 
                            href={`/operators/${op.operatorId}/profile`} 
                            className="flex items-center gap-2 group"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-violet-500 to-fuchsia-500 flex-shrink-0">
                              {op.photo_url ? (
                                <Image
                                  src={op.photo_url}
                                  alt={op.operatorName}
                                  width={32}
                                  height={32}
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                                  {op.operatorName.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium group-hover:text-violet-400 transition-colors block truncate">
                                {op.operatorName}
                              </span>
                              {op.position && (
                                <span className="text-xs text-gray-500 truncate block" title={op.position}>
                                  {op.position}
                                </span>
                              )}
                            </div>
                          </Link>
                        </td>

                        <td className="py-2 px-2">
                          <div className="space-y-0.5">
                            {op.phone && (
                              <div className="flex items-center gap-1 text-gray-400 text-xs" title={formatPhone(op.phone)}>
                                <Phone className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate max-w-[100px]">{op.phone}</span>
                              </div>
                            )}
                            {op.email && (
                              <div className="flex items-center gap-1 text-gray-400 text-xs" title={op.email}>
                                <Mail className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate max-w-[120px]">{op.email}</span>
                              </div>
                            )}
                            {tenure && (
                              <div className="flex items-center gap-1 text-gray-500 text-xs">
                                <Clock className="w-3 h-3" />
                                <span>{tenure}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-2 px-2 text-center">
                          <Link 
                            href={`/operators/${op.operatorId}/profile?tab=docs`}
                            className="inline-flex items-center gap-1 text-gray-400 hover:text-violet-400 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                            title={`${op.documents_count} документов${op.expiring_documents > 0 ? `, ${op.expiring_documents} скоро истекают` : ''}`}
                          >
                            <FileText className="w-4 h-4" />
                            <span>{op.documents_count}</span>
                            {op.expiring_documents > 0 && (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            )}
                          </Link>
                        </td>

                        <td className="py-2 px-2 text-center">{op.shifts}</td>
                        <td className="py-2 px-2 text-center">{op.days}</td>
                        <td className="py-2 px-2 text-right font-medium text-emerald-400">
                          {formatMoneyCompact(op.totalTurnover)}
                        </td>
                        <td className="py-2 px-2 text-right">{formatMoneyCompact(op.avgPerShift)}</td>
                        <td className="py-2 px-2 text-right text-gray-500">{(op.share * 100).toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right text-emerald-400">{formatMoneyCompact(op.cashAmount)}</td>
                        <td className="py-2 px-2 text-right text-blue-400">{formatMoneyCompact(op.kaspiAmount)}</td>
                        <td className="py-2 px-2 text-right text-violet-400">{formatMoneyCompact(op.onlineAmount)}</td>
                        <td className="py-2 px-2 text-right text-amber-400">{formatMoneyCompact(op.cardAmount)}</td>
                        <td className="py-2 px-2 text-right text-red-400">{formatMoneyCompact(op.autoDebts)}</td>
                        <td className="py-2 px-2 text-right text-red-400">{formatMoneyCompact(op.manualMinus)}</td>
                        <td className="py-2 px-2 text-right text-emerald-400">{formatMoneyCompact(op.manualPlus)}</td>
                        <td className="py-2 px-2 text-right text-amber-400">{formatMoneyCompact(op.advances)}</td>
                        <td className={`py-2 px-2 text-right font-medium ${op.netEffect >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatMoneyCompact(op.netEffect)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

                {analytics.rows.length > 0 && (
                  <tfoot className="border-t border-white/5 bg-white/5">
                    <tr>
                      <td className="py-3 px-2 font-semibold" colSpan={3}>Итого</td>
                      <td className="py-3 px-2 text-center font-semibold">{analytics.totalsFiltered.shifts}</td>
                      <td className="py-3 px-2 text-center font-semibold">{analytics.totalsFiltered.days}</td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(analytics.totalsFiltered.turnover)}
                      </td>
                      <td className="py-3 px-2 text-right text-gray-500">—</td>
                      <td className="py-3 px-2 text-right text-gray-500">—</td>
                      <td className="py-3 px-2 text-right text-emerald-400">
                        {formatMoneyCompact(analytics.rows.reduce((sum, r) => sum + r.cashAmount, 0))}
                      </td>
                      <td className="py-3 px-2 text-right text-blue-400">
                        {formatMoneyCompact(analytics.rows.reduce((sum, r) => sum + r.kaspiAmount, 0))}
                      </td>
                      <td className="py-3 px-2 text-right text-violet-400">
                        {formatMoneyCompact(analytics.rows.reduce((sum, r) => sum + r.onlineAmount, 0))}
                      </td>
                      <td className="py-3 px-2 text-right text-amber-400">
                        {formatMoneyCompact(analytics.rows.reduce((sum, r) => sum + r.cardAmount, 0))}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-red-400">
                        {formatMoneyCompact(analytics.totalsFiltered.autoDebts)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-red-400">
                        {formatMoneyCompact(analytics.totalsFiltered.manualMinus)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-400">
                        {formatMoneyCompact(analytics.totalsFiltered.manualPlus)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-amber-400">
                        {formatMoneyCompact(analytics.totalsFiltered.advances)}
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-white">
                        {formatMoneyCompact(analytics.totalsFiltered.netEffect)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Charts Section */}
          {showCharts && analytics.rows.length > 0 && mounted && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Operators Chart */}
              <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                  Топ-5 операторов по выручке
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics.rows.slice(0, 5).map(op => ({
                        name: op.operatorShortName || op.operatorName.split(' ')[0],
                        value: op.totalTurnover,
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
                      <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Payment Distribution */}
              <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-amber-400" />
                  Распределение по типам платежей
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={[
                          { name: 'Наличные', value: analytics.rows.reduce((s, r) => s + r.cashAmount, 0), color: PAYMENT_COLORS.cash },
                          { name: 'Kaspi', value: analytics.rows.reduce((s, r) => s + r.kaspiAmount, 0), color: PAYMENT_COLORS.kaspi },
                          { name: 'Online', value: analytics.rows.reduce((s, r) => s + r.onlineAmount, 0), color: PAYMENT_COLORS.online },
                          { name: 'Карта', value: analytics.rows.reduce((s, r) => s + r.cardAmount, 0), color: PAYMENT_COLORS.card },
                        ].filter(item => item.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {analytics.rows.map((_, idx) => (
                          <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="transparent" />
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
    </>
  )
}

// =====================
// MAIN EXPORT
// =====================
export default function OperatorAnalyticsPage() {
  return (
    <Suspense fallback={<OperatorAnalyticsLoading />}>
      <OperatorAnalyticsContent />
    </Suspense>
  )
}