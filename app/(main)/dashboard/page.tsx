'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DatePicker } from '@/components/ui/date-picker'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { splitIncomeKaspiByCalendarDay } from '@/lib/reports/income-calendar-kaspi'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { CardSkeleton, StatGridSkeleton } from '@/components/skeleton'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Globe,
  LineChart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
  Line,
  PieChart as RePieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(json?.error || `Ошибка запроса (${response.status})`)
  }
  return json as T
}

// ==================== TYPES ====================

type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  shift: 'day' | 'night'
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight: number | null
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
  netCash: number
  netKaspi: number
  netTotal: number
  incomeTx: number
  expenseTx: number
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
    type: 'spike' | 'drop'
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
    vsPrevPeriod: number
    vsAvgDaily: number
  }
}

type ChartPoint = {
  date: string
  income: number
  expense: number
  profit: number
  movingAvg: number
  label: string
}

type CategoryData = {
  name: string
  value: number
  percentage: number
  color: string
}

type FeedItem = {
  id: string
  date: string
  company_id: string
  kind: 'income' | 'expense'
  title: string
  amount: number
  isAnomaly?: boolean
}

type DashboardWidgetData = {
  kpis: {
    requestsPending: number
    openShifts: number
    lowStock: number
    unpaidDebts: number
    activeOperators: number
  }
  revenue14d: Array<{ date: string; value: number }>
  topPoints: Array<{ name: string; value: number }>
  birthdays: Array<{ id: string; title: string; subtitle?: string | null }>
}

// ==================== UTILS ====================

const DateUtils = {
  toISODateLocal(d: Date) {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  fromISO(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },
  todayISO() {
    return DateUtils.toISODateLocal(new Date())
  },
  monthStartISO() {
    const d = new Date()
    return DateUtils.toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1))
  },
  addDaysISO(iso: string, diff: number) {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },
  formatShort(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  },
  formatFull(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },
  getQuarterBounds() {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0)),
    }
  },
  getYearBounds() {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31)),
    }
  },
  calcPrevPeriod(dateFrom: string, dateTo: string) {
    const dFrom = DateUtils.fromISO(dateFrom)
    const dTo = DateUtils.fromISO(dateTo)
    const days = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
    return {
      prevFrom: DateUtils.addDaysISO(dateFrom, -days),
      prevTo: DateUtils.addDaysISO(dateFrom, -1),
      days,
    }
  },
  rangeDates(from: string, to: string) {
    const out: string[] = []
    let cur = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    while (cur <= end) {
      out.push(DateUtils.toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  },
}

const Formatters = {
  moneyDetailed(v: number) {
    return (Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
  },
  percentChange(current: number, previous: number) {
    if (!previous) return { text: '—', positive: true }
    const p = ((current - previous) / Math.abs(previous)) * 100
    return { text: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, positive: p >= 0 }
  },
}

const COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
}

// ==================== “AI” ANALYTICS (простая, но честная) ====================

function detectTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 3) return 'stable'
  const first = values[0]
  const last = values[values.length - 1]
  const change = ((last - first) / (Math.abs(first) || 1)) * 100
  if (change > 5) return 'up'
  if (change < -5) return 'down'
  return 'stable'
}

function detectAnomalies(points: ChartPoint[], threshold = 2.5): AIInsight['anomalies'] {
  const vals = points.map(p => p.income).filter(v => v > 0)
  if (vals.length < 6) return []
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / vals.length
  const std = Math.sqrt(variance) || 1

  const out: AIInsight['anomalies'] = []
  for (const p of points) {
    if (p.income <= 0) continue
    const z = Math.abs((p.income - mean) / std)
    if (z > threshold) {
      const type = p.income > mean ? 'spike' : 'drop'
      const severity = z > 4 ? 'high' : z > 3 ? 'medium' : 'low'
      out.push({
        type,
        date: p.date,
        severity,
        description: `${type === 'spike' ? 'Всплеск' : 'Падение'} дохода: ${Formatters.moneyDetailed(p.income)}`,
      })
    }
  }
  return out.slice(0, 3)
}

function predictNextMonthProfit(points: ChartPoint[]): { value: number; confidence: number } {
  // линейная регрессия по дневной прибыли (без магии, просто тренд)
  const y = points.map(p => p.profit)
  if (y.length < 10) return { value: 0, confidence: 0 }
  const x = Array.from({ length: y.length }, (_, i) => i)

  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXX = x.reduce((a, v) => a + v * v, 0)
  const sumXY = x.reduce((a, _, i) => a + x[i] * y[i], 0)

  const denom = n * sumXX - sumX * sumX
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0
  const intercept = (sumY - slope * sumX) / n

  const futureDays = 30
  const startIndex = n
  let futureProfit = 0
  for (let i = 0; i < futureDays; i++) {
    const yi = slope * (startIndex + i) + intercept
    futureProfit += yi
  }

  // confidence через R^2
  const yMean = sumY / n
  const ssRes = y.reduce((acc, yi, i) => acc + Math.pow(yi - (slope * x[i] + intercept), 2), 0)
  const ssTot = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0)
  const r2 = 1 - ssRes / (ssTot || 1)
  const confidence = Math.max(0, Math.min(100, r2 * 100))

  return { value: Math.round(futureProfit), confidence: Math.round(confidence * 100) / 100 }
}

function scoreStatus(score: number): AIInsight['status'] {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'warning'
  return 'critical'
}

function buildSummary(status: AIInsight['status'], profitTrend: 'up' | 'down' | 'stable') {
  const emoji = profitTrend === 'up' ? '📈' : profitTrend === 'down' ? '📉' : '📊'
  if (status === 'excellent') return `${emoji} Отлично: прибыль и динамика в зелёной зоне`
  if (status === 'good') return `${emoji} Нормально: держим курс, есть точки роста`
  if (status === 'warning') return `${emoji} Внимание: что-то начинает “плыть”`
  return `⚠️ Критично: надо резать лишнее и чинить маржу`
}


// ==================== PAGE ====================

export default function SmartDashboardPage() {
  const cashLabels = useCashlessLabels()
  const [authResolved, setAuthResolved] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => DateUtils.monthStartISO())
  const [dateTo, setDateTo] = useState(() => DateUtils.todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('month')

  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'forecast'>('overview')
  const [selectedMetric, setSelectedMetric] = useState<'income' | 'expense' | 'profit'>('profit')

  const [includeExtra, setIncludeExtra] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [showMovingAvg, setShowMovingAvg] = useState(true)

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [todayStats, setTodayStats] = useState<{ income: number; expense: number; txCount: number } | null>(null)
  const [overdueCount, setOverdueCount] = useState<number | null>(null)
  const [overdueDismissed, setOverdueDismissed] = useState(false)
  const [realtimeKey, setRealtimeKey] = useState(0)
  const [widgetData, setWidgetData] = useState<DashboardWidgetData | null>(null)
  const [monthPlans, setMonthPlans] = useState<{ revenue?: { target: number; fact: number; pct: number }; profit?: { target: number; fact: number; pct: number } } | null>(null)

  // План текущего месяца (из /goals) — для блока «план vs факт».
  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      try {
        const year = new Date().getFullYear()
        const res = await fetch(`/api/admin/kpi-plans?year=${year}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json()
        const plans: Array<any> = body?.data?.plans || body?.plans || []
        const today = DateUtils.todayISO()
        const pick = (metric: string) =>
          plans.find((p) => p.period_kind === 'month' && p.metric === metric && p.period_start <= today && p.period_end >= today)
        const rev = pick('revenue')
        const prof = pick('profit')
        if (!mounted) return
        setMonthPlans({
          revenue: rev ? { target: rev.target_amount, fact: rev.fact_value, pct: rev.achievement_pct } : undefined,
          profit: prof ? { target: prof.target_amount, fact: prof.fact_value, pct: prof.achievement_pct } : undefined,
        })
      } catch {
        if (mounted) setMonthPlans(null)
      }
    })()
    return () => { mounted = false }
  }, [isAuthenticated])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!mounted) return
      setIsAuthenticated(!!user)
      setAuthResolved(true)
    })()

    return () => {
      mounted = false
    }
  }, [])

  // ---------- data load ----------
  useEffect(() => {
    if (!authResolved) return
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { prevFrom } = DateUtils.calcPrevPeriod(dateFrom, dateTo)

        const [companiesBody, incomesBody, expensesBody] = await Promise.all([
          fetchJson<{ data: Company[] }>('/api/admin/companies'),
          fetchJson<{ data: IncomeRow[] }>(`/api/admin/incomes?from=${prevFrom}&to=${dateTo}&page_size=5000`),
          // API по умолчанию отдаёт 200 строк; окно prevFrom…dateTo — два периода, иначе расходы за выбранный период обрезаются
          fetchJson<{ data: ExpenseRow[] }>(
            `/api/admin/expenses?from=${prevFrom}&to=${dateTo}&page_size=2000&page=0`,
          ),
        ])

        if (!mounted) return

        setCompanies(companiesBody.data || [])
        // Как в отчётах: разбиваем kaspi ночных смен по календарным суткам (часть
        // после полуночи → следующий день). Иначе доход на границе периода
        // расходился с отчётами на сумму ночного безнала.
        setIncomes(splitIncomeKaspiByCalendarDay(incomesBody.data || []) as IncomeRow[])
        setExpenses(expensesBody.data || [])
      } catch (e: any) {
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [authResolved, isAuthenticated, dateFrom, dateTo, realtimeKey])

  // Realtime subscription — refresh on new income/expense records
  useEffect(() => {
    if (!isAuthenticated) return
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incomes' }, () => setRealtimeKey(k => k + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => setRealtimeKey(k => k + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAuthenticated])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      try {
        const [dashboardBody, notificationsBody, shiftsBody] = await Promise.all([
          fetchJson<{ data?: { week_by_day?: Record<string, number> } }>('/api/admin/dashboard'),
          fetchJson<{ data?: { groups?: Array<{ id: string; count: number; items?: Array<{ id: string; title: string; subtitle?: string | null }> }> } }>(
            '/api/admin/notifications',
          ),
          fetchJson<{ schedule?: { shifts?: Array<{ date: string; operator_name: string }>; operators?: Array<{ id: string }> } }>(
            `/api/admin/shifts?weekStart=${DateUtils.addDaysISO(DateUtils.todayISO(), -((new Date().getDay() + 6) % 7))}&includeSchedule=1`,
          ),
        ])

        if (!mounted) return
        const groups = notificationsBody.data?.groups || []
        const requestsPending = groups.find((g) => g.id === 'requests')?.count || 0
        const lowStock = groups.find((g) => g.id === 'low-stock')?.count || 0
        const unpaidDebts = groups.find((g) => g.id === 'debts')?.count || 0
        const birthdays = groups.find((g) => g.id === 'birthdays')?.items || []

        const today = DateUtils.todayISO()
        const openShifts = (shiftsBody.schedule?.shifts || []).filter((shift) => shift.date >= today && !!shift.operator_name).length
        const activeOperators = (shiftsBody.schedule?.operators || []).length

        const weekByDay = dashboardBody.data?.week_by_day || {}
        const revenue14d = Object.entries(weekByDay)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-14)
          .map(([date, value]) => ({ date, value: Number(value || 0) }))

          const pointMap: Record<string, number> = {}
        for (const row of incomes) {
          if (row.date < DateUtils.addDaysISO(DateUtils.todayISO(), -13) || row.date > DateUtils.todayISO()) continue
            const key = companyById[row.company_id]?.name || '—'
          const amount =
            Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0) + Number(row.online_amount || 0)
          pointMap[key] = (pointMap[key] || 0) + amount
        }
        const topPoints = Object.entries(pointMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, value]) => ({ name, value }))

        setWidgetData({
          kpis: { requestsPending, openShifts, lowStock, unpaidDebts, activeOperators },
          revenue14d,
          topPoints,
          birthdays,
        })
      } catch {
        if (mounted) setWidgetData(null)
      }
    })()
    return () => {
      mounted = false
    }
  }, [isAuthenticated, incomes, companyById])

  // Today stats fetch
  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      const today = DateUtils.todayISO()
      const [incomesBody, expensesBody] = await Promise.all([
        fetchJson<{ data: Array<{ cash_amount: number | null; kaspi_amount: number | null; kaspi_before_midnight: number | null; card_amount: number | null; online_amount: number | null }> }>(
          `/api/admin/incomes?from=${today}&to=${today}`,
        ),
        fetchJson<{ data: Array<{ cash_amount: number | null; kaspi_amount: number | null }> }>(
          `/api/admin/expenses?from=${today}&to=${today}&page_size=2000&page=0`,
        ),
      ])
      if (!mounted) return
      const income = (incomesBody.data || []).reduce(
        (s: number, r: { cash_amount: number | null; kaspi_amount: number | null; kaspi_before_midnight: number | null; card_amount: number | null; online_amount: number | null }) =>
          s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0),
        0,
      )
      const expense = (expensesBody.data || []).reduce(
        (s: number, r: { cash_amount: number | null; kaspi_amount: number | null }) =>
          s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0),
        0,
      )
      const txCount = (incomesBody.data?.length || 0) + (expensesBody.data?.length || 0)
      setTodayStats({ income, expense, txCount })
    })().catch(() => {
      if (mounted) setTodayStats({ income: 0, expense: 0, txCount: 0 })
    })
    return () => { mounted = false }
  }, [isAuthenticated])

  // Overdue tasks count
  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      const today = DateUtils.todayISO()
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .lt('due_date', today)
        .not('status', 'in', '("done","archived")')
      if (mounted && count != null && count > 0) setOverdueCount(count)
    })()
    return () => { mounted = false }
  }, [isAuthenticated])

  const hasExtraCompany = useMemo(
    () => companies.some(c => (c.code || '').toLowerCase() === 'extra'),
    [companies]
  )

  const isExtraCompany = useCallback(
    (companyId: string) => (companyById[companyId]?.code || '').toLowerCase() === 'extra',
    [companyById]
  )

  const companyName = useCallback(
    (companyId: string) => companyById[companyId]?.name ?? '—',
    [companyById]
  )

  // ---------- quick ranges ----------
  const setQuickRange = useCallback((type: RangeType) => {
    const today = DateUtils.todayISO()
    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'week') {
      setDateFrom(DateUtils.addDaysISO(today, -6))
      setDateTo(today)
    } else if (type === 'month') {
      setDateFrom(DateUtils.monthStartISO())
      setDateTo(today)
    } else if (type === 'quarter') {
      const { start, end } = DateUtils.getQuarterBounds()
      setDateFrom(start)
      setDateTo(end)
    } else if (type === 'year') {
      const { start, end } = DateUtils.getYearBounds()
      setDateFrom(start)
      setDateTo(end)
    }
    setRangeType(type)
  }, [])

  const onDateFromChange = useCallback((v: string) => {
    setDateFrom(v)
    setRangeType('custom')
  }, [])
  const onDateToChange = useCallback((v: string) => {
    setDateTo(v)
    setRangeType('custom')
  }, [])

  // ---------- analytics ----------
  const analytics = useMemo(() => {
    const { prevFrom, prevTo, days } = DateUtils.calcPrevPeriod(dateFrom, dateTo)
    const dates = DateUtils.rangeDates(dateFrom, dateTo)

    const chartMap = new Map<string, ChartPoint>()
    for (const d of dates) {
      chartMap.set(d, { date: d, income: 0, expense: 0, profit: 0, movingAvg: 0, label: DateUtils.formatShort(d) })
    }

    const current: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeOnline: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0,
      incomeTx: 0, expenseTx: 0, avgCheck: 0,
    }

    const previous: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeOnline: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0,
      incomeTx: 0, expenseTx: 0, avgCheck: 0,
    }

    const incomeCats: Record<string, number> = {}
    const expenseCats: Record<string, number> = {}

    const inCurrent = (d: string) => d >= dateFrom && d <= dateTo
    const inPrev = (d: string) => d >= prevFrom && d <= prevTo

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const online = Number(r.online_amount || 0)
      const total = cash + kaspi + card + online
      if (total <= 0) continue

      const cat = (r.comment || 'Продажи').trim()
      incomeCats[cat] = (incomeCats[cat] || 0) + total

      if (inCurrent(r.date)) {
        current.incomeTotal += total
        current.incomeCash += cash
        current.incomeKaspi += kaspi
        current.incomeCard += card
        current.incomeOnline += online
        current.incomeTx += 1

        const p = chartMap.get(r.date)
        if (p) p.income += total
      } else if (inPrev(r.date)) {
        previous.incomeTotal += total
        previous.incomeCash += cash
        previous.incomeKaspi += kaspi
        previous.incomeCard += card
        previous.incomeOnline += online
        previous.incomeTx += 1
      }
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const cat = (r.category || r.comment || 'Прочее').trim()
      expenseCats[cat] = (expenseCats[cat] || 0) + total

      if (inCurrent(r.date)) {
        current.expenseTotal += total
        current.expenseCash += cash
        current.expenseKaspi += kaspi
        current.expenseTx += 1

        const p = chartMap.get(r.date)
        if (p) p.expense += total
      } else if (inPrev(r.date)) {
        previous.expenseTotal += total
        previous.expenseCash += cash
        previous.expenseKaspi += kaspi
        previous.expenseTx += 1
      }
    }

    const finalize = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      t.netKaspi = (t.incomeKaspi + t.incomeCard + t.incomeOnline) - t.expenseKaspi
      t.netTotal = t.profit
      t.avgCheck = t.incomeTx ? t.incomeTotal / t.incomeTx : 0
    }
    finalize(current)
    finalize(previous)

    chartMap.forEach(p => {
      p.profit = p.income - p.expense
    })

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    // moving avg (7)
    const w = 7
    for (let i = 0; i < chartData.length; i++) {
      const start = Math.max(0, i - w + 1)
      const window = chartData.slice(start, i + 1)
      chartData[i].movingAvg = window.reduce((s, x) => s + x.profit, 0) / window.length
    }

    const margin = current.incomeTotal ? (current.profit / current.incomeTotal) * 100 : 0
    const efficiency = current.expenseTotal ? current.incomeTotal / current.expenseTotal : (current.incomeTotal ? 10 : 0)

    const trends = {
      income: detectTrend(chartData.map(x => x.income)),
      expense: detectTrend(chartData.map(x => x.expense)),
      profit: detectTrend(chartData.map(x => x.profit)),
    }

    const anomalies = detectAnomalies(chartData)
    const pred = predictNextMonthProfit(chartData)

    // score (простая шкала)
    let score = 50
    if (margin > 30) score += 20
    else if (margin > 20) score += 15
    else if (margin > 10) score += 10
    else if (margin > 5) score += 5
    else if (margin < 0) score -= 20

    const growthProfit = previous.profit ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100 : 0
    if (growthProfit > 20) score += 20
    else if (growthProfit > 10) score += 15
    else if (growthProfit > 0) score += 10
    else if (growthProfit < -10) score -= 15

    if (efficiency > 2) score += 15
    else if (efficiency > 1.5) score += 10
    else if (efficiency > 1.2) score += 5
    else if (efficiency < 0.8) score -= 10

    score = Math.max(0, Math.min(100, score))
    const status = scoreStatus(score)

    const recommendation =
      status === 'excellent'
        ? 'Можно смело реинвестировать: маркетинг/оборудование/новые направления.'
        : status === 'good'
        ? 'Подкрути средний чек и контролируй топ-расходы — будет ещё лучше.'
        : status === 'warning'
        ? 'Расходы/маржа требуют внимания: проверь категории и цены.'
        : 'Режим “пожарный”: режь лишнее, ищи утечки и пересматривай прайс.'

    const avgDaily = chartData.length ? chartData.reduce((s, x) => s + x.profit, 0) / chartData.length : 0

    const insight: AIInsight = {
      score,
      status,
      summary: buildSummary(status, trends.profit),
      recommendation,
      margin,
      efficiency,
      trends,
      anomalies,
      predictions: {
        nextMonthProfit: Math.max(0, pred.value),
        confidence: pred.confidence,
        recommendation: pred.confidence >= 70 ? 'Прогноз ок по качеству' : 'Прогноз слабый: мало данных/шум',
      },
      benchmarks: {
        vsPrevPeriod: current.profit - previous.profit,
        vsAvgDaily: current.profit - avgDaily * days,
      },
    }

    const topIncomeCategories: CategoryData[] = Object.entries(incomeCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], idx) => ({
        name,
        value,
        percentage: current.incomeTotal ? (value / current.incomeTotal) * 100 : 0,
        color: COLORS.chart[idx % COLORS.chart.length],
      }))

    const topExpenseCategories: CategoryData[] = Object.entries(expenseCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], idx) => ({
        name,
        value,
        percentage: current.expenseTotal ? (value / current.expenseTotal) * 100 : 0,
        color: COLORS.chart[idx % COLORS.chart.length],
      }))

    return { current, previous, chartData, insight, topIncomeCategories, topExpenseCategories }
  }, [companies, companyById, incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  const feedItems = useMemo(() => {
    const items: FeedItem[] = []
    const anomalyDates = new Set(analytics.insight.anomalies.map(a => a.date))

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0) +
        Number(r.online_amount || 0)
      if (total <= 0) continue
      items.push({
        id: `inc-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'income',
        title: (r.comment || 'Доход').trim(),
        amount: total,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (total <= 0) continue
      items.push({
        id: `exp-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'expense',
        title: (r.category || r.comment || 'Расход').trim(),
        amount: total,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    return items
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
      .slice(0, 12)
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany, analytics.insight.anomalies])

  // ---------- UI states ----------
  if (!authResolved) {
    return (
      <div className="space-y-4">
        <StatGridSkeleton count={4} />
        <CardSkeleton rows={4} />
        <div className="grid grid-cols-2 gap-4">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
        <CardSkeleton rows={5} />
      </div>
    )
  }

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') {
      window.location.replace('/login')
    }
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/55">
        <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-300" />
        <span className="text-sm text-slate-700 dark:text-slate-300">Перенаправление на вход...</span>
      </div>
    )
  }

  // Полноэкранный лоадер только при первой загрузке (когда ещё нет данных).
  // При смене периода/фильтра старый контент остаётся — обновление идёт silent.
  if (loading && companies.length === 0) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-amber-500/30 border-t-amber-500 mx-auto mb-6" />
            <Brain className="w-8 h-8 text-amber-400 absolute top-4 left-1/2 -translate-x-1/2" />
          </div>
          <p className="text-muted-foreground">Грузы считаю. Не мешай калькулятору думать 😄</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <>
          <Card className="p-8 max-w-md text-center border-red-500/30 bg-red-950/10 backdrop-blur-sm">
            <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Ошибка загрузки</h2>
            <p className="text-slate-400 mb-6">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-300 border border-red-500/30"
            >
              Перезагрузить
            </Button>
          </Card>
      </>
    )
  }

  const { current, previous, chartData, insight, topIncomeCategories, topExpenseCategories } = analytics

  // Разбивка по точкам за выбранный период (из уже загруженных incomes/expenses)
  const companyBreakdown = (() => {
    const map = new Map<string, { id: string; name: string; revenue: number; expense: number }>()
    const ensure = (id: string) => {
      let e = map.get(id)
      if (!e) { e = { id, name: companyName(id), revenue: 0, expense: 0 }; map.set(id, e) }
      return e
    }
    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      ensure(r.company_id).revenue += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      ensure(r.company_id).expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }
    return [...map.values()]
      .map((e) => ({ ...e, profit: e.revenue - e.expense, margin: e.revenue > 0 ? (e.revenue - e.expense) / e.revenue * 100 : 0 }))
      .filter((e) => e.revenue > 0 || e.expense > 0)
      .sort((a, b) => b.revenue - a.revenue)
  })()

  return (
    <>
        <div className="app-page-wide space-y-6">
          <HeaderBlock
            dateFrom={dateFrom}
            dateTo={dateTo}
            rangeType={rangeType}
            includeExtra={includeExtra}
            hasExtraCompany={hasExtraCompany}
            insight={insight}
            calendarOpen={calendarOpen}
            onToggleCalendar={() => setCalendarOpen(v => !v)}
            onQuickRange={setQuickRange}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
            onToggleExtra={() => setIncludeExtra(v => !v)}
          />

          {/* Overdue tasks banner */}
          {overdueCount !== null && !overdueDismissed && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-200 flex-1">
                <span className="font-semibold">{overdueCount} просроченных задач</span> — дедлайн прошёл, но статус не закрыт.
              </p>
              <Link href="/tasks" className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 underline underline-offset-2 shrink-0">
                Открыть задачи →
              </Link>
              <button
                onClick={() => setOverdueDismissed(true)}
                className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0 ml-1"
                aria-label="Скрыть"
              >
                ✕
              </button>
            </div>
          )}

          {/* Пульс бизнеса сегодня */}
          {todayStats !== null && (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 dark:border-white/10 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-5">
              <div className="absolute top-0 right-0 w-48 h-48 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-5 h-5 text-amber-400" />
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Пульс бизнеса сегодня</h2>
                  {todayStats.txCount === 0 ? (
                    <span className="ml-auto text-xs text-slate-500">📊 Данных за сегодня нет</span>
                  ) : (todayStats.income - todayStats.expense) > 0 ? (
                    <span className="ml-auto text-xs text-emerald-400">✅ Прибыльный день</span>
                  ) : (
                    <span className="ml-auto text-xs text-red-400">⚠️ Убыточный день</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                    <p className="text-[11px] text-emerald-400 uppercase tracking-wider">Выручка</p>
                    <p className="text-lg font-bold text-foreground mt-1">{Formatters.moneyDetailed(todayStats.income)}</p>
                  </div>
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
                    <p className="text-[11px] text-red-400 uppercase tracking-wider">Расходы</p>
                    <p className="text-lg font-bold text-foreground mt-1">{Formatters.moneyDetailed(todayStats.expense)}</p>
                  </div>
                  <div className={`rounded-xl p-3 border ${(todayStats.income - todayStats.expense) >= 0 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                    <p className="text-[11px] text-amber-400 uppercase tracking-wider">Прибыль</p>
                    <p className={`text-lg font-bold mt-1 ${(todayStats.income - todayStats.expense) >= 0 ? 'text-foreground' : 'text-red-500 dark:text-red-400'}`}>
                      {Formatters.moneyDetailed(todayStats.income - todayStats.expense)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
                    <p className="text-[11px] text-amber-400 uppercase tracking-wider">Транзакций</p>
                    <p className="text-lg font-bold text-foreground mt-1">{todayStats.txCount}</p>
                  </div>
                </div>
                {analytics.insight.anomalies.length > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400">
                      ⚡ Аномалия: {analytics.insight.anomalies[0].description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Операционные KPI — данные уже грузились, теперь показываем */}
          {widgetData && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Заявки ждут', value: widgetData.kpis.requestsPending, href: '/store/requests', attn: widgetData.kpis.requestsPending > 0, tone: 'amber' },
                { label: 'Открытые смены', value: widgetData.kpis.openShifts, href: '/shifts', attn: false, tone: 'slate' },
                { label: 'Низкий остаток', value: widgetData.kpis.lowStock, href: '/store/warehouse', attn: widgetData.kpis.lowStock > 0, tone: 'rose' },
                { label: 'Неоплач. долги', value: widgetData.kpis.unpaidDebts, href: '/point-debts', attn: widgetData.kpis.unpaidDebts > 0, tone: 'amber' },
                { label: 'Операторы', value: widgetData.kpis.activeOperators, href: '/operators', attn: false, tone: 'slate' },
              ].map((k) => (
                <Link key={k.label} href={k.href} className="rounded-xl border border-border bg-white dark:bg-gray-900/40 p-3 transition hover:border-amber-400/40 hover:bg-slate-50 dark:hover:bg-gray-900/60">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">{k.label}</div>
                  <div className={`mt-1 text-2xl font-bold tabular-nums ${k.attn && k.tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : k.attn && k.tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>{k.value}</div>
                </Link>
              ))}
            </div>
          )}

          {/* План месяца vs факт */}
          {monthPlans && (monthPlans.revenue || monthPlans.profit) && (
            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                План месяца
                <Link href="/goals" className="ml-auto text-xs font-normal text-amber-600 dark:text-amber-400 hover:underline">все цели →</Link>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {([['Выручка', monthPlans.revenue], ['Прибыль', monthPlans.profit]] as const).map(([label, p]) => p ? (
                  <div key={label}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-semibold tabular-nums text-foreground">{Math.round(p.pct)}%</span>
                    </div>
                    <div className="mt-1 text-sm font-bold text-foreground tabular-nums">
                      {Formatters.moneyDetailed(p.fact)} <span className="text-xs font-normal text-slate-400">/ {Formatters.moneyDetailed(p.target)}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${p.pct >= 100 ? 'bg-emerald-500' : p.pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, Math.max(0, p.pct))}%` }} />
                    </div>
                  </div>
                ) : null)}
              </div>
            </Card>
          )}

          {/* Сравнение точек */}
          {companyBreakdown.length > 1 && (
            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                Сравнение точек
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-slate-200 dark:border-white/8">
                      <th className="px-2 py-2 text-left font-medium">Точка</th>
                      <th className="px-2 py-2 text-right font-medium">Выручка</th>
                      <th className="px-2 py-2 text-right font-medium">Прибыль</th>
                      <th className="px-2 py-2 text-right font-medium">Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyBreakdown.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                        <td className="px-2 py-2 font-medium text-foreground truncate max-w-[160px]">{c.name}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{Formatters.moneyDetailed(c.revenue)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold ${c.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{Formatters.moneyDetailed(c.profit)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${c.margin >= 20 ? 'text-emerald-600 dark:text-emerald-400' : c.margin >= 0 ? 'text-slate-600 dark:text-slate-300' : 'text-rose-600 dark:text-rose-400'}`}>{c.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Дни рождения */}
          {widgetData?.birthdays && widgetData.birthdays.length > 0 && (
            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                🎂 Дни рождения
              </h3>
              <div className="flex flex-wrap gap-2">
                {widgetData.birthdays.map((b) => (
                  <div key={b.id} className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02] px-3 py-1.5">
                    <span className="text-sm font-medium text-foreground">{b.title}</span>
                    {b.subtitle && <span className="ml-2 text-xs text-muted-foreground">{b.subtitle}</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Tabs
            active={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'overview' && (
            <Overview
              insight={insight}
              current={current}
              previous={previous}
              selectedMetric={selectedMetric}
              onMetricChange={setSelectedMetric}
              chartData={chartData}
              showMovingAvg={showMovingAvg}
              onToggleMovingAvg={() => setShowMovingAvg(v => !v)}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
              feed={feedItems}
              companyName={companyName}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

          {activeTab === 'details' && (
            <Details
              current={current}
              previous={previous}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
              cashlessLabel={cashLabels.providerName}
            />
          )}

          {activeTab === 'forecast' && (
            <Forecast
              insight={insight}
            />
          )}
        </div>
    </>
  )
}

// ==================== UI COMPONENTS ====================

function Tabs({ active, onChange }: { active: 'overview' | 'details' | 'forecast'; onChange: (v: any) => void }) {
  return (
    <div className="flex w-full gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 p-1 sm:w-fit">
      <TabButton active={active === 'overview'} onClick={() => onChange('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
      <TabButton active={active === 'details'} onClick={() => onChange('details')} icon={<BarChart2 className="w-4 h-4" />} label="Детали" />
      <TabButton active={active === 'forecast'} onClick={() => onChange('forecast')} icon={<Sparkles className="w-4 h-4" />} label="Прогноз" />
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function HeaderBlock(props: {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  includeExtra: boolean
  hasExtraCompany: boolean
  insight: AIInsight
  calendarOpen: boolean
  onToggleCalendar: () => void
  onQuickRange: (t: RangeType) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onToggleExtra: () => void
}) {
  const statusStyle: Record<AIInsight['status'], string> = {
    excellent: 'bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-300',
    good: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
    warning: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-700 dark:text-yellow-300',
    critical: 'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300',
  }

  return (
    <div className="relative">
      <AdminPageHeader
        title="Финансовый дашборд"
        description="Без “мертвых” кнопок. Только рабочая логика."
        icon={<Brain className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          <>
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusStyle[props.insight.status]}`}>
              {props.insight.status === 'excellent' ? '🚀 Отлично' :
               props.insight.status === 'good' ? '✅ Хорошо' :
               props.insight.status === 'warning' ? '⚠️ Внимание' : '🔴 Критично'}
            </span>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white border-slate-200 dark:bg-slate-800/50 rounded-lg border dark:border-slate-700">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span className="text-slate-600 dark:text-slate-300 text-sm">Прогноз:</span>
              <span className="font-medium text-amber-600 dark:text-amber-300 text-sm">{props.insight.predictions.confidence}%</span>
            </div>
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <QuickRangeBtn active={props.rangeType === 'today'} onClick={() => props.onQuickRange('today')} label="Сегодня" />
            <QuickRangeBtn active={props.rangeType === 'week'} onClick={() => props.onQuickRange('week')} label="Неделя" />
            <QuickRangeBtn active={props.rangeType === 'month'} onClick={() => props.onQuickRange('month')} label="Месяц" />
            <QuickRangeBtn active={props.rangeType === 'quarter'} onClick={() => props.onQuickRange('quarter')} label="Квартал" />
            <QuickRangeBtn active={props.rangeType === 'year'} onClick={() => props.onQuickRange('year')} label="Год" />

            <button
              onClick={props.onToggleCalendar}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border-slate-200 dark:bg-slate-800/50 rounded-lg border dark:border-slate-700 hover:border-amber-500/50 transition-colors"
            >
              <Calendar className="w-4 h-4 text-amber-500 dark:text-amber-300" />
              <span className="text-slate-700 dark:text-slate-200">
                {DateUtils.formatFull(props.dateFrom)} — {DateUtils.formatFull(props.dateTo)}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${props.calendarOpen ? 'rotate-180' : ''}`} />
            </button>

            {props.hasExtraCompany && (
              <button
                onClick={props.onToggleExtra}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                  props.includeExtra
                    ? 'bg-red-500/10 border-red-500/30 text-red-500 dark:text-red-300'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${props.includeExtra ? 'bg-red-400' : 'bg-slate-500'}`} />
                {props.includeExtra ? 'Extra включён' : 'Extra исключён'}
              </button>
            )}
          </div>
        }
      />

      {props.calendarOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100]">
          <Card className="p-4 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-amber-500/20 rounded-2xl shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-slate-500 uppercase tracking-wider">Начало</label>
                <DatePicker value={props.dateFrom} onChange={props.onDateFromChange} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-slate-500 uppercase tracking-wider">Конец</label>
                <DatePicker value={props.dateTo} onChange={props.onDateToChange} min={props.dateFrom} align="end" />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={props.onToggleCalendar} className="bg-amber-500 hover:bg-amber-600 text-white">
                Применить
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function QuickRangeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
        active ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:border-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

// ==================== OVERVIEW ====================

function Overview(props: {
  insight: AIInsight
  current: FinancialTotals
  previous: FinancialTotals
  selectedMetric: 'income' | 'expense' | 'profit'
  onMetricChange: (m: any) => void
  chartData: ChartPoint[]
  showMovingAvg: boolean
  onToggleMovingAvg: () => void
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
  feed: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <AICard insight={props.insight} />

        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            label="Доход"
            value={props.current.incomeTotal}
            previousValue={props.previous.incomeTotal}
            icon={<TrendingUp className="w-5 h-5" />}
            color="from-green-500 to-emerald-500"
            selected={props.selectedMetric === 'income'}
            onClick={() => props.onMetricChange('income')}
          />
          <MetricCard
            label="Расход"
            value={props.current.expenseTotal}
            previousValue={props.previous.expenseTotal}
            icon={<TrendingDown className="w-5 h-5" />}
            color="from-red-500 to-rose-500"
            selected={props.selectedMetric === 'expense'}
            onClick={() => props.onMetricChange('expense')}
          />
          <MetricCard
            label="Прибыль"
            value={props.current.profit}
            previousValue={props.previous.profit}
            icon={<Target className="w-5 h-5" />}
            color="from-amber-500 to-amber-500"
            selected={props.selectedMetric === 'profit'}
            onClick={() => props.onMetricChange('profit')}
          />
        </div>
      </div>

      <ChartCard
        data={props.chartData}
        metric={props.selectedMetric}
        showMovingAvg={props.showMovingAvg}
        onToggleMovingAvg={props.onToggleMovingAvg}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CategoryPie title="Структура доходов" data={props.topIncomeCategories} total={props.current.incomeTotal} icon={<TrendingUp className="w-4 h-4" />} />
        <CategoryPie title="Структура расходов" data={props.topExpenseCategories} total={props.current.expenseTotal} icon={<TrendingDown className="w-4 h-4" />} />
        <AnomaliesCard anomalies={props.insight.anomalies} />
        <FeedCard feed={props.feed} companyName={props.companyName} dateFrom={props.dateFrom} dateTo={props.dateTo} />
      </div>

      <PredictionWide insight={props.insight} currentProfit={props.current.profit} />
    </div>
  )
}

function AICard({ insight }: { insight: AIInsight }) {
  return (
    <Card className="p-6 border border-slate-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 dark:border-0 dark:from-amber-900/30 dark:via-slate-900 dark:to-amber-900/30 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-amber-500/20 rounded-xl">
          <Brain className="w-5 h-5 text-amber-500 dark:text-amber-300" />
        </div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">AI анализ</span>
      </div>

      <div className="mb-3">
        <div className="text-4xl font-bold text-foreground">{insight.score}</div>
        <div className="text-xs text-slate-500">из 100</div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Маржа</span>
            <span className="text-amber-600 dark:text-amber-300 font-medium">{insight.margin.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, insight.margin * 2)}%` }} />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Эффективность</span>
            <span className="text-green-600 dark:text-green-300 font-medium">{insight.efficiency.toFixed(2)}x</span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full" style={{ width: `${Math.min(100, insight.efficiency * 30)}%` }} />
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <p className="text-xs text-muted-foreground mb-2">{insight.summary}</p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{insight.recommendation}</p>
        </div>
      </div>
    </Card>
  )
}

function MetricCard(props: {
  label: string
  value: number
  previousValue: number
  icon: ReactNode
  color: string
  selected: boolean
  onClick: () => void
}) {
  const ch = Formatters.percentChange(props.value, props.previousValue)
  return (
    <Card
      onClick={props.onClick}
      className={`p-6 cursor-pointer transition-all border border-slate-200 bg-white hover:bg-slate-50 dark:border-0 dark:bg-slate-800/50 dark:hover:bg-slate-800/80 ${props.selected ? 'ring-2 ring-amber-500' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-slate-400">{props.label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${props.color} bg-opacity-20`}>{props.icon}</div>
      </div>
      <div className="text-2xl font-bold text-foreground mb-2 break-all">{Formatters.moneyDetailed(props.value)}</div>
      <div className="flex items-center gap-2 text-xs">
        <span className={ch.positive ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}>{ch.text}</span>
        <span className="text-slate-500">к прошлому периоду</span>
      </div>
      {props.selected && (
        <div className="mt-4 text-xs text-amber-600 dark:text-amber-300 flex items-center gap-1">
          <Activity className="w-3 h-3" /> на графике
        </div>
      )}
    </Card>
  )
}

function ChartCard(props: {
  data: ChartPoint[]
  metric: 'income' | 'expense' | 'profit'
  showMovingAvg: boolean
  onToggleMovingAvg: () => void
}) {
  const metricName = props.metric === 'income' ? 'Доход' : props.metric === 'expense' ? 'Расход' : 'Прибыль'
  const metricColor = props.metric === 'income' ? COLORS.income : props.metric === 'expense' ? COLORS.expense : COLORS.profit

  return (
    <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/20 rounded-xl">
            <LineChart className="w-5 h-5 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Динамика: {metricName}</h3>
            <p className="text-xs text-slate-500">
              {props.data.length ? `с ${DateUtils.formatShort(props.data[0].date)} по ${DateUtils.formatShort(props.data[props.data.length - 1].date)}` : 'Нет данных'}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={props.onToggleMovingAvg}
          className="text-xs h-8 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:hover:bg-slate-700 dark:text-slate-200"
        >
          {props.showMovingAvg ? 'Скрыть среднее' : 'Показать среднее'}
        </Button>
      </div>

      {!props.data.length ? (
        <div className="h-80 flex items-center justify-center text-slate-500">Нет данных</div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={props.data}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" vertical={false} />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => Formatters.moneyDetailed(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                formatter={(val: any) => [Formatters.moneyDetailed(Number(val)), '']}
              />
              <Legend />

              <Area
                type="monotone"
                dataKey={props.metric}
                name={metricName}
                stroke={metricColor}
                strokeWidth={2}
                fill="url(#metricFill)"
              />

              {props.showMovingAvg && (
                <Line
                  type="monotone"
                  dataKey="movingAvg"
                  name="Среднее (7д)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 5"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function CategoryPie(props: { title: string; data: CategoryData[]; total: number; icon: ReactNode }) {
  return (
    <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-slate-100 dark:bg-slate-700/40 rounded-xl">{props.icon}</div>
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      </div>

      {!props.data.length ? (
        <div className="h-48 flex items-center justify-center text-slate-500">Нет данных</div>
      ) : (
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={props.data} dataKey="value" cx="50%" cy="50%" innerRadius="58%" outerRadius="88%" paddingAngle={2}>
                  {props.data.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                  formatter={(v: any) => [Formatters.moneyDetailed(Number(v)), '']}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-32 overflow-auto">
            {props.data.map((x, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: x.color }} />
                  <span className="text-slate-600 dark:text-slate-300 truncate max-w-[120px]">{x.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{Formatters.moneyDetailed(x.value)}</span>
                  <span className="text-slate-500">({x.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Всего</span>
              <span className="text-foreground font-medium">{Formatters.moneyDetailed(props.total)}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomaliesCard({ anomalies }: { anomalies: AIInsight['anomalies'] }) {
  const severityStyle: Record<'low' | 'medium' | 'high', string> = {
    low: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-700 dark:text-yellow-200',
    medium: 'bg-orange-500/10 border-orange-500/25 text-orange-700 dark:text-orange-200',
    high: 'bg-red-500/10 border-red-500/25 text-red-700 dark:text-red-200',
  }

  return (
    <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-yellow-500/20 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-300" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Аномалии</h3>
        {!!anomalies.length && <span className="px-2 py-0.5 bg-red-500/20 text-red-700 dark:text-red-200 text-xs rounded-full">{anomalies.length}</span>}
      </div>

      {!anomalies.length ? (
        <div className="text-center py-8">
          <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Аномалий не обнаружено</p>
          <p className="text-xs text-slate-500">Пока всё ровно</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-auto">
          {anomalies.map((a, i) => (
            <div key={i} className={`p-3 rounded-xl border ${severityStyle[a.severity]}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">
                  {a.type === 'spike' ? '📈 Всплеск' : '📉 Падение'} • {a.severity}
                </span>
                <span className="text-[10px] opacity-80">{DateUtils.formatShort(a.date)}</span>
              </div>
              <p className="text-xs">{a.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function FeedCard(props: {
  feed: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}) {
  return (
    <Card className="p-0 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/20 rounded-xl">
            <Activity className="w-5 h-5 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Лента</h3>
            <p className="text-xs text-slate-500">Последние операции</p>
          </div>
          {!!props.feed.length && (
            <span className="ml-auto px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-200 text-xs rounded-full">
              {props.feed.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[300px] p-2 space-y-1">
        {!props.feed.length ? (
          <div className="text-center py-8 text-slate-500">Нет операций</div>
        ) : (
          props.feed.map(it => (
            <div
              key={it.id}
              className={`flex items-center justify-between p-3 rounded-xl transition-all ${
                it.isAnomaly ? 'bg-yellow-500/10 border border-yellow-500/20' : 'hover:bg-slate-100 dark:hover:bg-slate-700/50'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{it.title}</div>
                <div className="text-[10px] text-slate-500 truncate">
                  {props.companyName(it.company_id)} • {DateUtils.formatShort(it.date)}
                </div>
              </div>
              <div className={`text-xs font-bold font-mono whitespace-nowrap ml-2 ${it.kind === 'income' ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                {it.kind === 'income' ? '+' : '-'}
                {Formatters.moneyDetailed(it.amount)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
        <Link href={`/income?from=${props.dateFrom}&to=${props.dateTo}`}>
          <Button variant="ghost" size="sm" className="w-full text-xs h-8 text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-700">
            Все операции
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function PredictionWide({ insight, currentProfit }: { insight: AIInsight; currentProfit: number }) {
  const diff = insight.predictions.nextMonthProfit - currentProfit
  const pct = currentProfit ? (diff / Math.abs(currentProfit)) * 100 : 0

  return (
    <Card className="p-6 border border-slate-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 dark:border-0 dark:from-amber-900/30 dark:via-slate-900 dark:to-amber-900/30 backdrop-blur-sm">
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-amber-500 dark:text-amber-300" />
            <h3 className="text-sm font-semibold text-foreground">Прогноз на 30 дней (прибыль)</h3>
          </div>
          <div className="text-3xl font-bold text-foreground">{Formatters.moneyDetailed(insight.predictions.nextMonthProfit)}</div>
          <div className="text-xs text-slate-400 mt-1">
            Достоверность: <span className="text-amber-600 dark:text-amber-300 font-medium">{insight.predictions.confidence}%</span> • {insight.predictions.recommendation}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-lg text-sm font-medium ${diff >= 0 ? 'bg-green-500/20 text-green-700 dark:text-green-200' : 'bg-red-500/20 text-red-700 dark:text-red-200'}`}>
            {diff >= 0 ? '↗' : '↘'} {Math.abs(pct).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400">
            {diff >= 0 ? 'лучше' : 'хуже'} текущего периода
          </div>
        </div>
      </div>
    </Card>
  )
}

// ==================== DETAILS ====================

function Details(props: {
  current: FinancialTotals
  previous: FinancialTotals
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
  cashlessLabel: string
}) {
  const paymentStats = [
    { name: 'Наличные', value: props.current.incomeCash, color: '#f59e0b' },
    { name: props.cashlessLabel, value: props.current.incomeKaspi, color: '#2563eb' },
    { name: 'Карта', value: props.current.incomeCard, color: '#7c3aed' },
    { name: 'Онлайн', value: props.current.incomeOnline, color: '#ec4899' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat label="Транзакции (доход)" value={props.current.incomeTx} prev={props.previous.incomeTx} icon={<Activity className="w-4 h-4" />} />
        <MiniStat label="Транзакции (расход)" value={props.current.expenseTx} prev={props.previous.expenseTx} icon={<Activity className="w-4 h-4" />} />
        <MiniStat label="Средний чек" value={props.current.avgCheck} prev={props.previous.avgCheck} icon={<DollarSign className="w-4 h-4" />} money />
        <MiniStat label="Онлайн" value={props.current.incomeOnline} prev={props.previous.incomeOnline} icon={<Globe className="w-4 h-4" />} money />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Способы оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentStats}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.moneyDetailed(v)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                  formatter={(v: any) => Formatters.moneyDetailed(Number(v))}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {paymentStats.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Баланс</h3>
          <div className="space-y-4">
            <BalanceRow icon={<Wallet className="w-4 h-4" />} label="Net Cash" value={props.current.netCash} />
            <BalanceRow icon={<Globe className="w-4 h-4" />} label="Net Безнал" value={props.current.netKaspi} />
            <BalanceRow icon={<Target className="w-4 h-4" />} label="Net Total" value={props.current.netTotal} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryPie title="Топ доходов" data={props.topIncomeCategories} total={props.current.incomeTotal} icon={<TrendingUp className="w-4 h-4" />} />
        <CategoryPie title="Топ расходов" data={props.topExpenseCategories} total={props.current.expenseTotal} icon={<TrendingDown className="w-4 h-4" />} />
      </div>
    </div>
  )
}

function MiniStat(props: { label: string; value: number; prev: number; icon: ReactNode; money?: boolean }) {
  const ch = Formatters.percentChange(props.value, props.prev)
  return (
    <Card className="p-4 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700/40">{props.icon}</div>
        <span className="text-xs text-muted-foreground">{props.label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">
        {props.money ? Formatters.moneyDetailed(props.value) : props.value.toLocaleString('ru-RU')}
      </div>
      <div className="flex items-center gap-2 text-xs mt-1">
        <span className={ch.positive ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}>{ch.text}</span>
        <span className="text-slate-500">к прошлому</span>
      </div>
    </Card>
  )
}

function BalanceRow({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/20 rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold text-foreground">{Formatters.moneyDetailed(value)}</div>
    </div>
  )
}

// ==================== FORECAST ====================

function Forecast({ insight }: { insight: AIInsight }) {
  return (
    <div className="space-y-6">
      <Card className="p-6 border border-slate-200 bg-white dark:border-0 dark:bg-slate-800/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-300" />
          <h3 className="text-sm font-semibold text-foreground">Что делать дальше</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Advice
            title="Маржинальность"
            text={insight.margin < 20 ? `Маржа ${insight.margin.toFixed(1)}% — подними цены/режь себестоимость.` : `Маржа ${insight.margin.toFixed(1)}% — держи, не сливай.`}
            icon={<Target className="w-4 h-4" />}
          />
          <Advice
            title="Эффективность"
            text={insight.efficiency < 1.5 ? `Эффективность ${insight.efficiency.toFixed(2)}x — расходы кушают доход.` : `Эффективность ${insight.efficiency.toFixed(2)}x — хорошо.`}
            icon={<Activity className="w-4 h-4" />}
          />
          <Advice
            title="Тренд прибыли"
            text={
              insight.trends.profit === 'up'
                ? 'Прибыль растёт — закрепи: повтори удачные дни/акции.'
                : insight.trends.profit === 'down'
                ? 'Прибыль падает — проверь топ-расходы и просадки дохода.'
                : 'Прибыль стабильна — делай A/B по акциям и среднему чеку.'
            }
            icon={<LineChart className="w-4 h-4" />}
          />
          <Advice
            title="Прогноз"
            text={`Ожидаемая прибыль: ${Formatters.moneyDetailed(insight.predictions.nextMonthProfit)}. Достоверность: ${insight.predictions.confidence}%.`}
            icon={<Sparkles className="w-4 h-4" />}
          />
        </div>
      </Card>
    </div>
  )
}

function Advice({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-700/20 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-500/30 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-amber-500/15 rounded-lg">{icon}</div>
        <div className="text-sm font-medium text-foreground">{title}</div>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300">{text}</div>
    </div>
  )
}
