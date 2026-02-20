'use client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Download,
  Lightbulb,
  Share2,
  Store,
  TrendingDown,
  TrendingUp,
  Wallet,
  Layers,
  CalendarDays,
  PieChart as PieIcon,
  Table2,
  Zap,
} from 'lucide-react'

import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  Area,
} from 'recharts'

// =====================
// TYPES
// =====================
type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type GroupMode = 'day' | 'week' | 'month' | 'year'
type DatePreset = 'custom' | 'today' | 'yesterday' | 'last7' | 'prevWeek' | 'last30' | 'currentMonth' | 'prevMonth'
type TabKey = 'overview' | 'companies' | 'details'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
  remainingCash: number
  remainingKaspi: number
  totalBalance: number
}

type TimeAggregation = {
  label: string
  sortISO: string
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
}

type AIInsight = {
  type: 'warning' | 'success' | 'info' | 'opportunity'
  title: string
  description: string
  metric?: string
}

type Anomaly = {
  type: 'income_spike' | 'expense_spike' | 'low_profit'
  date: string
  description: string
  severity: 'low' | 'medium' | 'high'
  value: number
}

type CompanyTotals = {
  companyId: string
  name: string
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  marginPct: number
  opsCount: number
}

type SimpleAgg = { name: string; income: number; expense: number; profit: number }

// =====================
// CONSTS
// =====================
const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'] as const

const baseTotals = (): FinancialTotals => ({
  incomeCash: 0,
  incomeKaspi: 0,
  incomeOnline: 0,
  incomeCard: 0,
  incomeNonCash: 0,
  expenseCash: 0,
  expenseKaspi: 0,
  totalIncome: 0,
  totalExpense: 0,
  profit: 0,
  remainingCash: 0,
  remainingKaspi: 0,
  totalBalance: 0,
})

// =====================
// DATE HELPERS
// =====================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = fromISO(dateFrom)
  const dTo = fromISO(dateTo)
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86400000) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

const getISOWeekKey = (isoDate: string) => {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const isoYear = d.getFullYear()
  const week1 = new Date(isoYear, 0, 4)
  week1.setHours(0, 0, 0, 0)
  const week1Thursday = new Date(week1)
  week1Thursday.setDate(week1.getDate() + 3 - ((week1.getDay() + 6) % 7))
  const diffDays = Math.round((d.getTime() - week1Thursday.getTime()) / 86400000)
  const weekNo = 1 + Math.floor(diffDays / 7)
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`
}

const getISOWeekStartISO = (isoDate: string) => {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diffToMonday = (day + 6) % 7
  d.setDate(d.getDate() - diffToMonday)
  return toISODateLocal(d)
}

const getMonthKey = (isoDate: string) => isoDate.slice(0, 7)
const getYearKey = (isoDate: string) => isoDate.slice(0, 4)

// =====================
// FORMATTERS
// =====================
const formatMoneyFull = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const formatCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(Math.round(n))
}

const getPercentageChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? '+100%' : '—'
  if (current === 0) return '-100%'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

const safeNumber = (v: unknown) => {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

// =====================
// CSV
// =====================
const csvEscape = (v: string) => {
  const s = String(v).replaceAll('"', '""')
  if (/[",\n\r;]/.test(s)) return `"${s}"`
  return s
}

const toCSV = (rows: string[][], sep = ';') => rows.map((r) => r.map((c) => csvEscape(c)).join(sep)).join('\n') + '\n'

const downloadTextFile = (filename: string, content: string, mime = 'text/csv;charset=utf-8') => {
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
// URL PARAMS
// =====================
const parseBool = (v: string | null) => v === '1' || v === 'true'
const parseGroup = (v: string | null): GroupMode | null => {
  if (!v) return null
  if (v === 'day' || v === 'week' || v === 'month' || v === 'year') return v
  return null
}
const parseTab = (v: string | null): TabKey | null => {
  if (!v) return null
  if (v === 'overview' || v === 'companies' || v === 'details') return v
  return null
}
const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// =====================
// UI HELPERS
// =====================
function Pill({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25'
          : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function StatCard({
  title,
  icon,
  value,
  subLeft,
  subRight,
  trendText,
  trendUp,
  accent = 'violet',
}: {
  title: string
  icon: React.ReactNode
  value: string
  subLeft?: string
  subRight?: string
  trendText?: string
  trendUp?: boolean
  accent?: 'emerald' | 'rose' | 'amber' | 'blue' | 'violet'
}) {
  const bg =
    accent === 'emerald'
      ? 'from-emerald-500/10 to-teal-500/10 border-emerald-500/20 hover:border-emerald-500/40'
      : accent === 'rose'
        ? 'from-rose-500/10 to-pink-500/10 border-rose-500/20 hover:border-rose-500/40'
        : accent === 'amber'
          ? 'from-amber-500/10 to-yellow-500/10 border-amber-500/20 hover:border-amber-500/40'
          : accent === 'blue'
            ? 'from-blue-500/10 to-indigo-500/10 border-blue-500/20 hover:border-blue-500/40'
            : 'from-violet-500/10 to-fuchsia-500/10 border-violet-500/20 hover:border-violet-500/40'

  return (
    <div className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${bg} border p-6 transition-all`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/3 translate-x-1/3 group-hover:bg-white/10 transition-all" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-white/10 rounded-xl">{icon}</div>
          <span className="text-sm font-medium text-gray-300">{title}</span>
        </div>

        <div className="text-3xl font-bold text-white mb-2">{value}</div>

        {(subLeft || subRight) && (
          <div className="flex gap-4 text-sm">
            {subLeft && (
              <div className="text-gray-400">
                {subLeft}
              </div>
            )}
            {subRight && (
              <div className="text-gray-400">
                {subRight}
              </div>
            )}
          </div>
        )}

        {trendText && (
          <div className={`mt-3 text-sm flex items-center gap-1 ${trendUp ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trendUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {trendText}
          </div>
        )}
      </div>
    </div>
  )
}

// =====================
// MAIN CONTENT
// =====================
function ReportsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [mounted, setMounted] = useState(false)

  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoaded, setCompaniesLoaded] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(() => todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)

  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)

  useEffect(() => setMounted(true), [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  // date normalize
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  // load companies
  useEffect(() => {
    let alive = true
    const loadCompanies = async () => {
      setError(null)
      const { data, error } = await supabase.from('companies').select('id,name,code').order('name')
      if (!alive) return
      if (error) {
        setError('Не удалось загрузить список компаний')
        setCompaniesLoaded(true)
        setLoading(false)
        return
      }
      setCompanies((data || []) as Company[])
      setCompaniesLoaded(true)
    }
    loadCompanies()
    return () => {
      alive = false
    }
  }, [])

  const companyById = useMemo(() => {
    const m = new Map<string, { name: string; code: string }>()
    for (const c of companies) m.set(c.id, { name: c.name, code: (c.code || '').toLowerCase() })
    return m
  }, [companies])

  const extraCompanyId = useMemo(() => {
    for (const c of companies) {
      const code = (c.code || '').toLowerCase()
      if (code === 'extra') return c.id
      if (c.name.toLowerCase().includes('f16 extra')) return c.id
    }
    return null
  }, [companies])

  const companyName = useCallback((id: string) => companyById.get(id)?.name ?? '—', [companyById])

  const applyPreset = useCallback((preset: DatePreset) => {
    const today = todayISO()
    const todayDate = fromISO(today)
    let from = today
    let to = today

    switch (preset) {
      case 'today':
        from = today
        to = today
        break
      case 'yesterday':
        from = addDaysISO(today, -1)
        to = from
        break
      case 'last7':
        from = addDaysISO(today, -6)
        to = today
        break
      case 'last30':
        from = addDaysISO(today, -29)
        to = today
        break
      case 'prevWeek': {
        const d = new Date(todayDate)
        const diffToMonday = (d.getDay() + 6) % 7
        const currentMonday = new Date(d)
        currentMonday.setDate(d.getDate() - diffToMonday)
        const prevMonday = new Date(currentMonday)
        prevMonday.setDate(currentMonday.getDate() - 7)
        const prevSunday = new Date(prevMonday)
        prevSunday.setDate(prevMonday.getDate() + 6)
        from = toISODateLocal(prevMonday)
        to = toISODateLocal(prevSunday)
        break
      }
      case 'currentMonth': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth()
        from = toISODateLocal(new Date(y, m, 1))
        to = toISODateLocal(new Date(y, m + 1, 0))
        break
      }
      case 'prevMonth': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth() - 1
        from = toISODateLocal(new Date(y, m, 1))
        to = toISODateLocal(new Date(y, m + 1, 0))
        break
      }
      case 'custom':
        return
    }

    setDateFrom(from)
    setDateTo(to)
  }, [])

  const handlePresetChange = useCallback(
    (value: DatePreset) => {
      setDatePreset(value)
      if (value !== 'custom') applyPreset(value)
    },
    [applyPreset],
  )

  const resetFilters = useCallback(() => {
    setDatePreset('last7')
    applyPreset('last7')
    setCompanyFilter('all')
    setGroupMode('day')
    setIncludeExtraInTotals(false)
    setActiveTab('overview')
    showToast('Фильтры сброшены')
  }, [applyPreset, showToast])

  // init from URL
  useEffect(() => {
    if (didInitFromUrl.current || !companiesLoaded) return

    const sp = searchParams
    const pFrom = sp.get('from')
    const pTo = sp.get('to')
    const pPreset = sp.get('preset') as DatePreset | null
    const pCompany = sp.get('company')
    const pGroup = parseGroup(sp.get('group'))
    const pExtra = parseBool(sp.get('extra'))
    const pTab = parseTab(sp.get('tab'))

    if (pFrom && isISODate(pFrom)) setDateFrom(pFrom)
    if (pTo && isISODate(pTo)) setDateTo(pTo)

    const allowedPresets: DatePreset[] = ['custom', 'today', 'yesterday', 'last7', 'prevWeek', 'last30', 'currentMonth', 'prevMonth']
    if (pPreset && allowedPresets.includes(pPreset)) {
      setDatePreset(pPreset)
      if (pPreset !== 'custom' && !pFrom && !pTo) applyPreset(pPreset)
    }

    if (pCompany) {
      if (pCompany === 'all') setCompanyFilter('all')
      else if (companies.some((c) => c.id === pCompany)) setCompanyFilter(pCompany)
    }

    if (pGroup) setGroupMode(pGroup)
    if (pExtra) setIncludeExtraInTotals(true)
    if (pTab) setActiveTab(pTab)

    didInitFromUrl.current = true
  }, [companiesLoaded, companies, searchParams, applyPreset])

  // sync to URL
  useEffect(() => {
    if (!didInitFromUrl.current) return

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('from', dateFrom)
      params.set('to', dateTo)
      params.set('preset', datePreset)
      params.set('company', companyFilter)
      params.set('group', groupMode)
      params.set('extra', includeExtraInTotals ? '1' : '0')
      params.set('tab', activeTab)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [dateFrom, dateTo, datePreset, companyFilter, groupMode, includeExtraInTotals, activeTab, pathname, router])

  // load data (current + previous range)
  useEffect(() => {
    if (!companiesLoaded) return

    const loadData = async () => {
      const myReqId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      try {
        if (companies.length === 0) {
          setIncomes([])
          setExpenses([])
          setLoading(false)
          return
        }

        const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)

        let incomeQuery = supabase
          .from('incomes')
          .select('id,date,company_id,shift,zone,cash_amount,kaspi_amount,online_amount,card_amount')
          .gte('date', prevFrom)
          .lte('date', dateTo)

        let expenseQuery = supabase
          .from('expenses')
          .select('id,date,company_id,category,cash_amount,kaspi_amount')
          .gte('date', prevFrom)
          .lte('date', dateTo)

        if (companyFilter !== 'all') {
          incomeQuery = incomeQuery.eq('company_id', companyFilter)
          expenseQuery = expenseQuery.eq('company_id', companyFilter)
        } else if (!includeExtraInTotals && extraCompanyId) {
          incomeQuery = incomeQuery.neq('company_id', extraCompanyId)
          expenseQuery = expenseQuery.neq('company_id', extraCompanyId)
        }

        const [incomeResult, expenseResult] = await Promise.all([incomeQuery, expenseQuery])

        if (myReqId !== reqIdRef.current) return
        if (incomeResult.error) throw incomeResult.error
        if (expenseResult.error) throw expenseResult.error

        setIncomes((incomeResult.data || []) as IncomeRow[])
        setExpenses((expenseResult.data || []) as ExpenseRow[])
      } catch (err) {
        if (myReqId === reqIdRef.current) {
          console.error(err)
          setError('Ошибка загрузки данных')
        }
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false)
      }
    }

    loadData()
  }, [companiesLoaded, companies.length, dateFrom, dateTo, companyFilter, includeExtraInTotals, extraCompanyId])

  // compute
  const processed = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const totalsCur = baseTotals()
    const totalsPrev = baseTotals()

    const expenseByCategoryMap = new Map<string, number>()
    const chartDataMap = new Map<string, TimeAggregation>()
    const anomalies: Anomaly[] = []

    const companyTotalsMap = new Map<string, CompanyTotals>()
    const shiftAggMap = new Map<string, SimpleAgg>()
    const zoneAggMap = new Map<string, SimpleAgg>()

    const dailyIncome = new Map<string, number>()
    const dailyExpense = new Map<string, number>()

    const getRangeBucket = (iso: string) => {
      if (iso >= dateFrom && iso <= dateTo) return 'current'
      if (iso >= prevFrom && iso <= prevTo) return 'previous'
      return null
    }

    const getKey = (iso: string) => {
      if (groupMode === 'day') return { key: iso, label: iso, sortISO: iso }
      if (groupMode === 'week') {
        const wk = getISOWeekKey(iso)
        return { key: wk, label: wk, sortISO: getISOWeekStartISO(iso) }
      }
      if (groupMode === 'month') {
        const mk = getMonthKey(iso)
        return { key: mk, label: mk, sortISO: `${mk}-01` }
      }
      const y = getYearKey(iso)
      return { key: y, label: y, sortISO: `${y}-01-01` }
    }

    const ensureBucket = (key: string, label: string, sortISO: string) => {
      const b =
        chartDataMap.get(key) ||
        ({
          label,
          sortISO,
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
        } as TimeAggregation)
      chartDataMap.set(key, b)
      return b
    }

    const ensureCompanyTotals = (companyId: string) => {
      const name = companyName(companyId) || '—'
      const cur =
        companyTotalsMap.get(companyId) ||
        ({
          companyId,
          name,
          incomeCash: 0,
          incomeKaspi: 0,
          incomeOnline: 0,
          incomeCard: 0,
          incomeTotal: 0,
          expenseCash: 0,
          expenseKaspi: 0,
          expenseTotal: 0,
          profit: 0,
          marginPct: 0,
          opsCount: 0,
        } as CompanyTotals)
      companyTotalsMap.set(companyId, cur)
      return cur
    }

    const ensureAgg = (map: Map<string, SimpleAgg>, key: string, label?: string) => {
      const cur =
        map.get(key) ||
        ({
          name: label || key,
          income: 0,
          expense: 0,
          profit: 0,
        } as SimpleAgg)
      map.set(key, cur)
      return cur
    }

    // Incomes
    for (const r of incomes) {
      const range = getRangeBucket(r.date)
      if (!range) continue

      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const online = safeNumber(r.online_amount)
      const card = safeNumber(r.card_amount)

      const nonCash = kaspi + online + card
      const total = cash + nonCash
      if (total <= 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.incomeCash += cash
      tgt.incomeKaspi += kaspi
      tgt.incomeOnline += online
      tgt.incomeCard += card
      tgt.incomeNonCash += nonCash
      tgt.totalIncome += total

      if (range === 'current') {
        dailyIncome.set(r.date, (dailyIncome.get(r.date) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)
        bucket.income += total
        bucket.incomeCash += cash
        bucket.incomeKaspi += kaspi
        bucket.incomeOnline += online
        bucket.incomeCard += card
        bucket.incomeNonCash += nonCash

        const cTot = ensureCompanyTotals(r.company_id)
        cTot.incomeCash += cash
        cTot.incomeKaspi += kaspi
        cTot.incomeOnline += online
        cTot.incomeCard += card
        cTot.incomeTotal += total
        cTot.opsCount += 1

        const sLabel = r.shift === 'day' ? 'День' : 'Ночь'
        ensureAgg(shiftAggMap, r.shift, sLabel).income += total

        const z = r.zone || 'Без зоны'
        ensureAgg(zoneAggMap, z).income += total
      }
    }

    // Expenses
    for (const r of expenses) {
      const range = getRangeBucket(r.date)
      if (!range) continue

      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi
      if (total <= 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.expenseCash += cash
      tgt.expenseKaspi += kaspi
      tgt.totalExpense += total

      if (range === 'current') {
        dailyExpense.set(r.date, (dailyExpense.get(r.date) || 0) + total)

        const category = r.category || 'Без категории'
        expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)
        bucket.expense += total
        bucket.expenseCash += cash
        bucket.expenseKaspi += kaspi

        const cTot = ensureCompanyTotals(r.company_id)
        cTot.expenseCash += cash
        cTot.expenseKaspi += kaspi
        cTot.expenseTotal += total
      }
    }

    // finalize totals
    const finalize = (t: FinancialTotals) => {
      t.profit = t.totalIncome - t.totalExpense
      t.remainingCash = t.incomeCash - t.expenseCash
      t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
      t.totalBalance = t.profit
      return t
    }

    finalize(totalsCur)
    finalize(totalsPrev)

    // company finalize
    for (const c of companyTotalsMap.values()) {
      c.profit = c.incomeTotal - c.expenseTotal
      c.marginPct = c.incomeTotal > 0 ? (c.profit / c.incomeTotal) * 100 : 0
    }

    // profit for chart buckets
    for (const agg of chartDataMap.values()) {
      agg.profit = agg.income - agg.expense
    }

    for (const s of shiftAggMap.values()) s.profit = s.income - s.expense
    for (const z of zoneAggMap.values()) z.profit = z.income - z.expense

    // anomalies
    const avgIncome = totalsCur.totalIncome / (dailyIncome.size || 1)
    const avgExpense = totalsCur.totalExpense / (dailyExpense.size || 1)

    for (const [date, amount] of dailyIncome) {
      if (amount > avgIncome * 2) {
        anomalies.push({
          type: 'income_spike',
          date,
          description: `Всплеск выручки: ${formatMoneyFull(amount)}`,
          severity: 'medium',
          value: amount,
        })
      }
    }

    for (const [date, amount] of dailyExpense) {
      if (amount > avgExpense * 2.5) {
        anomalies.push({
          type: 'expense_spike',
          date,
          description: `Аномальный расход: ${formatMoneyFull(amount)}`,
          severity: 'high',
          value: amount,
        })
      }
    }

    for (const agg of chartDataMap.values()) {
      if (agg.income > 0) {
        const margin = agg.profit / agg.income
        if (margin < 0.1) {
          anomalies.push({
            type: 'low_profit',
            date: agg.label,
            description: `Низкая маржа: ${(margin * 100).toFixed(1)}%`,
            severity: 'medium',
            value: agg.profit,
          })
        }
      }
    }

    return {
      totalsCur,
      totalsPrev,
      chartDataMap,
      expenseByCategoryMap,
      anomalies,
      prevFrom,
      prevTo,
      companyTotalsMap,
      shiftAggMap,
      zoneAggMap,
    }
  }, [incomes, expenses, dateFrom, dateTo, groupMode, companyName])

  const totals = processed.totalsCur
  const totalsPrev = processed.totalsPrev

  const chartData = useMemo(
    () => Array.from(processed.chartDataMap.values()).sort((a, b) => a.sortISO.localeCompare(b.sortISO)),
    [processed.chartDataMap],
  )

  const expenseByCategoryData = useMemo(
    () =>
      Array.from(processed.expenseByCategoryMap.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [processed.expenseByCategoryMap],
  )

  const companyTotals = useMemo(
    () => Array.from(processed.companyTotalsMap.values()).sort((a, b) => b.incomeTotal - a.incomeTotal),
    [processed.companyTotalsMap],
  )

  const shiftAgg = useMemo(
    () => Array.from(processed.shiftAggMap.values()),
    [processed.shiftAggMap],
  )

  const zoneAgg = useMemo(
    () => Array.from(processed.zoneAggMap.values()).sort((a, b) => b.income - a.income).slice(0, 12),
    [processed.zoneAggMap],
  )

  const incomesCurrent = useMemo(() => incomes.filter((r) => r.date >= dateFrom && r.date <= dateTo), [incomes, dateFrom, dateTo])
  const expensesCurrent = useMemo(() => expenses.filter((r) => r.date >= dateFrom && r.date <= dateTo), [expenses, dateFrom, dateTo])

  // AI insights
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []

    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0
    if (profitMargin < 15) {
      insights.push({
        type: 'warning',
        title: 'Низкая маржинальность',
        description: `Маржа ${profitMargin.toFixed(1)}% — проверь расходы/ошибки ввода.`,
        metric: `${profitMargin.toFixed(1)}%`,
      })
    } else if (profitMargin > 35) {
      insights.push({
        type: 'success',
        title: 'Отличная маржа',
        description: `Маржа ${profitMargin.toFixed(1)}% — красиво идёшь.`,
        metric: `${profitMargin.toFixed(1)}%`,
      })
    }

    const cashRatio = totals.totalIncome > 0 ? totals.incomeCash / totals.totalIncome : 0
    if (cashRatio < 0.3) {
      insights.push({
        type: 'opportunity',
        title: 'Доля безнала высокая',
        description: 'Можно стимулировать наличку бонусом/скидкой.',
        metric: `${((1 - cashRatio) * 100).toFixed(0)}%`,
      })
    }

    const topExpense = expenseByCategoryData[0]
    if (topExpense && totals.totalExpense > 0) {
      const share = (topExpense.amount / totals.totalExpense) * 100
      if (share > 40) {
        insights.push({
          type: 'warning',
          title: 'Расходы слишком в одной категории',
          description: `"${topExpense.name}" = ${share.toFixed(0)}% расходов.`,
          metric: `${share.toFixed(0)}%`,
        })
      }
    }

    const high = processed.anomalies.filter((a) => a.severity === 'high').length
    if (high > 0) {
      insights.push({
        type: 'warning',
        title: 'Критические аномалии',
        description: 'Есть дни с подозрительными расходами/скачками.',
        metric: `${high} шт`,
      })
    }

    if (totalsPrev.totalIncome > 0) {
      const ch = ((totals.totalIncome - totalsPrev.totalIncome) / totalsPrev.totalIncome) * 100
      if (Math.abs(ch) >= 15) {
        insights.push({
          type: ch >= 0 ? 'success' : 'warning',
          title: ch >= 0 ? 'Рост выручки' : 'Падение выручки',
          description: `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% к прошлому периоду`,
          metric: `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`,
        })
      }
    }

    return insights.slice(0, 6)
  }, [totals, totalsPrev, expenseByCategoryData, processed.anomalies])

  // Forecast (only currentMonth)
  const forecast = useMemo(() => {
    if (datePreset !== 'currentMonth') return null
    const startDate = fromISO(dateFrom)
    const endDate = fromISO(dateTo)
    const now = new Date()

    const daysPassed = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    if (daysPassed <= 0) return null

    const avgIncome = totals.totalIncome / daysPassed
    const avgProfit = totals.profit / daysPassed

    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const remainingDays = Math.max(0, lastDayOfMonth.getDate() - now.getDate())

    return {
      remainingDays,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remainingDays),
      forecastProfit: Math.round(totals.profit + avgProfit * remainingDays),
      confidence: Math.min(90, Math.max(45, 55 + (daysPassed / 30) * 35)),
    }
  }, [datePreset, dateFrom, dateTo, totals.totalIncome, totals.profit])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      showToast('Ссылка скопирована')
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = url
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
        showToast('Ссылка скопирована')
      } catch {
        showToast('Не удалось скопировать')
      }
    }
  }, [showToast])

  const handleDownload = useCallback(() => {
    try {
      const rows: string[][] = []

      const companyLabel =
        companyFilter === 'all'
          ? includeExtraInTotals
            ? 'Все компании (включая F16 Extra)'
            : 'Все компании (без F16 Extra)'
          : companyName(companyFilter)

      rows.push(['Отчет'])
      rows.push(['Период', `${dateFrom} — ${dateTo}`])
      rows.push(['Компания', companyLabel])
      rows.push(['Группировка', groupMode])
      rows.push([''])

      rows.push(['Итоги'])
      rows.push(['Показатель', 'Сумма'])
      rows.push(['Выручка (итого)', String(Math.round(totals.totalIncome))])
      rows.push(['Наличные (доход)', String(Math.round(totals.incomeCash))])
      rows.push(['Kaspi (доход)', String(Math.round(totals.incomeKaspi))])
      rows.push(['Online (доход)', String(Math.round(totals.incomeOnline))])
      rows.push(['Card (доход)', String(Math.round(totals.incomeCard))])
      rows.push(['Безнал (итого)', String(Math.round(totals.incomeNonCash))])
      rows.push(['Расход (итого)', String(Math.round(totals.totalExpense))])
      rows.push(['Наличные (расход)', String(Math.round(totals.expenseCash))])
      rows.push(['Kaspi (расход)', String(Math.round(totals.expenseKaspi))])
      rows.push(['Прибыль', String(Math.round(totals.profit))])
      rows.push(['Остаток нал', String(Math.round(totals.remainingCash))])
      rows.push(['Остаток безнал', String(Math.round(totals.remainingKaspi))])
      rows.push([''])

      rows.push(['Компании'])
      rows.push(['company', 'income_total', 'income_cash', 'income_kaspi', 'income_online', 'income_card', 'expense_total', 'profit', 'margin_pct'])
      for (const c of companyTotals) {
        rows.push([
          c.name,
          String(Math.round(c.incomeTotal)),
          String(Math.round(c.incomeCash)),
          String(Math.round(c.incomeKaspi)),
          String(Math.round(c.incomeOnline)),
          String(Math.round(c.incomeCard)),
          String(Math.round(c.expenseTotal)),
          String(Math.round(c.profit)),
          c.marginPct.toFixed(1),
        ])
      }

      rows.push([''])
      rows.push(['Доходы (incomes)'])
      rows.push(['date', 'company', 'shift', 'zone', 'cash', 'kaspi', 'online', 'card', 'total'])
      for (const r of incomesCurrent.slice().sort((a, b) => a.date.localeCompare(b.date))) {
        const cash = safeNumber(r.cash_amount)
        const kaspi = safeNumber(r.kaspi_amount)
        const online = safeNumber(r.online_amount)
        const card = safeNumber(r.card_amount)
        const total = cash + kaspi + online + card
        rows.push([
          r.date,
          companyName(r.company_id),
          r.shift,
          r.zone || '',
          String(Math.round(cash)),
          String(Math.round(kaspi)),
          String(Math.round(online)),
          String(Math.round(card)),
          String(Math.round(total)),
        ])
      }

      rows.push([''])
      rows.push(['Расходы (expenses)'])
      rows.push(['date', 'company', 'category', 'cash', 'kaspi', 'total'])
      for (const r of expensesCurrent.slice().sort((a, b) => a.date.localeCompare(b.date))) {
        const cash = safeNumber(r.cash_amount)
        const kaspi = safeNumber(r.kaspi_amount)
        const total = cash + kaspi
        rows.push([r.date, companyName(r.company_id), r.category || 'Без категории', String(Math.round(cash)), String(Math.round(kaspi)), String(Math.round(total))])
      }

      const csv = toCSV(rows, ';')
      const fname = `report_${dateFrom}_${dateTo}.csv`
      downloadTextFile(fname, csv)
      showToast('CSV скачан')
    } catch (e) {
      console.error(e)
      showToast('Ошибка при скачивании')
    }
  }, [
    companyFilter,
    includeExtraInTotals,
    companyName,
    dateFrom,
    dateTo,
    groupMode,
    totals,
    incomesCurrent,
    expensesCurrent,
    showToast,
    companyTotals,
  ])

  // loading / error
  if (!mounted || (loading && companies.length === 0)) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <p className="text-gray-400">Загрузка аналитики...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-rose-400 bg-rose-500/10 px-6 py-4 rounded-2xl border border-rose-500/20">{error}</div>
        </main>
      </div>
    )
  }

  const trendUp = totalsPrev.totalIncome > 0 ? totals.totalIncome >= totalsPrev.totalIncome : true
  const expenseTrendUp = totalsPrev.totalExpense > 0 ? totals.totalExpense >= totalsPrev.totalExpense : false

  const OverviewBlock = (
    <div className="space-y-6">
      {aiInsights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {aiInsights.map((insight, idx) => (
            <div
              key={idx}
              className={`group relative overflow-hidden rounded-2xl border p-5 transition-all hover:scale-[1.01] ${
                insight.type === 'warning'
                  ? 'bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20'
                  : insight.type === 'success'
                    ? 'bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20'
                    : insight.type === 'opportunity'
                      ? 'bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border-violet-500/20'
                      : 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`p-2 rounded-xl ${
                    insight.type === 'warning'
                      ? 'bg-amber-500/20 text-amber-400'
                      : insight.type === 'success'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : insight.type === 'opportunity'
                          ? 'bg-violet-500/20 text-violet-400'
                          : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {insight.type === 'warning' && <AlertTriangle className="w-5 h-5" />}
                  {insight.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
                  {insight.type === 'opportunity' && <Zap className="w-5 h-5" />}
                  {insight.type === 'info' && <Lightbulb className="w-5 h-5" />}
                </div>
                {insight.metric && <span className="text-2xl font-bold text-white">{insight.metric}</span>}
              </div>
              <h3 className="font-semibold text-white mt-3">{insight.title}</h3>
              <p className="text-sm text-gray-400 mt-1">{insight.description}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Выручка"
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
          value={formatMoneyFull(totals.totalIncome)}
          subLeft={`Нал: ${formatMoneyFull(totals.incomeCash)}`}
          subRight={`Безнал: ${formatMoneyFull(totals.incomeNonCash)}`}
          trendText={totalsPrev.totalIncome > 0 ? getPercentageChange(totals.totalIncome, totalsPrev.totalIncome) : undefined}
          trendUp={trendUp}
          accent="emerald"
        />
        <StatCard
          title="Расходы"
          icon={<TrendingDown className="w-5 h-5 text-rose-400" />}
          value={formatMoneyFull(totals.totalExpense)}
          subLeft={`Нал: ${formatMoneyFull(totals.expenseCash)}`}
          subRight={`Kaspi: ${formatMoneyFull(totals.expenseKaspi)}`}
          trendText={totalsPrev.totalExpense > 0 ? getPercentageChange(totals.totalExpense, totalsPrev.totalExpense) : undefined}
          trendUp={!expenseTrendUp}
          accent="rose"
        />
        <StatCard
          title="Прибыль"
          icon={<DollarSign className="w-5 h-5 text-amber-400" />}
          value={formatMoneyFull(totals.profit)}
          subLeft={`Маржа: ${(totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0).toFixed(1)}%`}
          accent="amber"
        />
        <StatCard
          title="Остатки"
          icon={<Wallet className="w-5 h-5 text-blue-400" />}
          value={formatMoneyFull(totals.remainingCash + totals.remainingKaspi)}
          subLeft={`Нал: ${formatMoneyFull(totals.remainingCash)}`}
          subRight={`Безнал: ${formatMoneyFull(totals.remainingKaspi)}`}
          accent="blue"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-violet-400" />
              Динамика доходов и расходов
            </h3>
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px', padding: '12px' }} />
                <Area type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} fill="url(#incomeGradient)" />
                <Area type="monotone" dataKey="expense" stroke="#f43f5e" strokeWidth={2} fill="url(#expenseGradient)" />
                <Line type="monotone" dataKey="profit" stroke="#fbbf24" strokeWidth={3} dot={{ r: 3, fill: '#fbbf24', strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <PieIcon className="w-5 h-5 text-rose-400" />
            Структура расходов
          </h3>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={expenseByCategoryData} cx="50%" cy="50%" innerRadius={58} outerRadius={92} paddingAngle={4} dataKey="amount">
                  {expenseByCategoryData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }}
                  formatter={(v: number) => formatMoneyFull(v)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 space-y-2">
            {expenseByCategoryData.slice(0, 6).map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                  <span className="text-gray-400">{item.name}</span>
                </div>
                <span className="text-white font-medium">{formatMoneyFull(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-blue-400" />
            Компании — выручка / расход / прибыль
          </h3>

          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="sticky top-0 bg-gray-900/90">
                <tr className="text-gray-400">
                  <th className="text-left py-2 pr-3">Компания</th>
                  <th className="text-right py-2 pr-3">Выручка</th>
                  <th className="text-right py-2 pr-3">Нал</th>
                  <th className="text-right py-2 pr-3">Kaspi</th>
                  <th className="text-right py-2 pr-3">Online</th>
                  <th className="text-right py-2 pr-3">Card</th>
                  <th className="text-right py-2 pr-3">Расход</th>
                  <th className="text-right py-2 pr-3">Прибыль</th>
                  <th className="text-right py-2">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {companyTotals.map((c) => (
                  <tr key={c.companyId} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-gray-200">{c.name}</td>
                    <td className="py-2 pr-3 text-right text-white font-semibold">{formatMoneyFull(c.incomeTotal)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeCash)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeKaspi)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeOnline)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeCard)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.expenseTotal)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${c.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatMoneyFull(c.profit)}
                    </td>
                    <td className="py-2 text-right text-gray-300">{c.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Layers className="w-5 h-5 text-fuchsia-400" />
              Смены
            </h3>
            <div className="space-y-3">
              {shiftAgg
                .slice()
                .sort((a, b) => b.income - a.income)
                .map((s) => (
                  <div key={s.name} className="p-4 rounded-xl bg-gray-800/40 border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="text-gray-300 font-medium">{s.name}</div>
                      <div className="text-white font-semibold">{formatMoneyFull(s.income)}</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">Прибыль: <span className={s.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatMoneyFull(s.profit)}</span></div>
                  </div>
                ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-400" />
              ТОП зон (по выручке)
            </h3>
            <div className="space-y-2">
              {zoneAgg.map((z, idx) => (
                <div key={z.name} className="flex items-center justify-between text-sm p-3 rounded-xl bg-gray-800/40 border border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-6 text-right">{idx + 1}.</span>
                    <span className="text-gray-300">{z.name}</span>
                  </div>
                  <span className="text-white font-semibold">{formatMoneyFull(z.income)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              Аномалии
            </h3>
            {processed.anomalies.length > 0 ? (
              <div className="space-y-2">
                {processed.anomalies.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-800/40 border border-white/5">
                    <div
                      className={`mt-0.5 p-2 rounded-lg ${
                        a.severity === 'high'
                          ? 'bg-rose-500/20 text-rose-400'
                          : a.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {a.severity === 'high' ? <AlertTriangle className="w-4 h-4" /> : <Lightbulb className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-gray-200">{a.description}</div>
                      <div className="text-xs text-gray-500 mt-1">{a.date}</div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-lg ${
                        a.severity === 'high'
                          ? 'bg-rose-500/20 text-rose-400'
                          : a.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {a.severity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-800/30 border border-white/5 text-gray-400">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Аномалий не найдено
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const CompaniesBlock = (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Table2 className="w-5 h-5 text-violet-400" />
          Детальная таблица компаний
        </h3>

        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[1180px]">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="text-gray-400">
                <th className="text-left py-2 pr-3">Компания</th>
                <th className="text-right py-2 pr-3">Выручка</th>
                <th className="text-right py-2 pr-3">Нал</th>
                <th className="text-right py-2 pr-3">Kaspi</th>
                <th className="text-right py-2 pr-3">Online</th>
                <th className="text-right py-2 pr-3">Card</th>
                <th className="text-right py-2 pr-3">Безнал</th>
                <th className="text-right py-2 pr-3">Расход</th>
                <th className="text-right py-2 pr-3">Расход нал</th>
                <th className="text-right py-2 pr-3">Расход Kaspi</th>
                <th className="text-right py-2 pr-3">Прибыль</th>
                <th className="text-right py-2 pr-3">Маржа</th>
                <th className="text-right py-2">Операций</th>
              </tr>
            </thead>
            <tbody>
              {companyTotals.map((c) => {
                const nonCash = c.incomeKaspi + c.incomeOnline + c.incomeCard
                return (
                  <tr key={c.companyId} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-gray-200">{c.name}</td>
                    <td className="py-2 pr-3 text-right text-white font-semibold">{formatMoneyFull(c.incomeTotal)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeCash)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeKaspi)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeOnline)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.incomeCard)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(nonCash)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.expenseTotal)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.expenseCash)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{formatCompact(c.expenseKaspi)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${c.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatMoneyFull(c.profit)}
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-300">{c.marginPct.toFixed(1)}%</td>
                    <td className="py-2 text-right text-gray-400">{c.opsCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-blue-400" />
            Выручка по компаниям (бар)
          </h3>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={companyTotals.slice(0, 12).map((c, idx) => ({
                  name: c.name,
                  value: c.incomeTotal,
                  fill: PIE_COLORS[idx % PIE_COLORS.length],
                }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={160} stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }} formatter={(v: number) => formatMoneyFull(v)} />
                <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                  {companyTotals.slice(0, 12).map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-emerald-400" />
            Быстрые итоги периода
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gray-800/40 border border-white/5">
              <div className="text-xs text-gray-500">Период</div>
              <div className="text-white font-semibold mt-1">
                {dateFrom} → {dateTo}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-gray-800/40 border border-white/5">
              <div className="text-xs text-gray-500">Компаний в отчёте</div>
              <div className="text-white font-semibold mt-1">{companyTotals.length}</div>
            </div>

            <div className="p-4 rounded-xl bg-gray-800/40 border border-white/5">
              <div className="text-xs text-gray-500">Выручка / день (средняя)</div>
              <div className="text-white font-semibold mt-1">
                {formatMoneyFull(Math.round(totals.totalIncome / Math.max(1, calculatePrevPeriod(dateFrom, dateTo).durationDays)))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-gray-800/40 border border-white/5">
              <div className="text-xs text-gray-500">Расход / день (средний)</div>
              <div className="text-white font-semibold mt-1">
                {formatMoneyFull(Math.round(totals.totalExpense / Math.max(1, calculatePrevPeriod(dateFrom, dateTo).durationDays)))}
              </div>
            </div>
          </div>

          {forecast && (
            <div className="mt-5 p-4 rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-300 font-medium">Прогноз на месяц</div>
                <div className="text-xs text-gray-500">Точность ~{forecast.confidence.toFixed(0)}%</div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="text-xs text-gray-500">Выручка</div>
                  <div className="text-lg font-bold text-violet-400">{formatMoneyFull(forecast.forecastIncome)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Прибыль</div>
                  <div className="text-lg font-bold text-emerald-400">{formatMoneyFull(forecast.forecastProfit)}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">Осталось дней: {forecast.remainingDays}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const DetailsBlock = (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4">Доходы (текущий период)</h3>
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="text-gray-400">
                <th className="text-left py-2 pr-2">Дата</th>
                <th className="text-left py-2 pr-2">Компания</th>
                <th className="text-left py-2 pr-2">Смена</th>
                <th className="text-left py-2 pr-2">Зона</th>
                <th className="text-right py-2 pr-2">Нал</th>
                <th className="text-right py-2 pr-2">Kaspi</th>
                <th className="text-right py-2 pr-2">Online</th>
                <th className="text-right py-2 pr-2">Card</th>
                <th className="text-right py-2">Итого</th>
              </tr>
            </thead>
            <tbody>
              {incomesCurrent
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => {
                  const cash = safeNumber(r.cash_amount)
                  const kaspi = safeNumber(r.kaspi_amount)
                  const online = safeNumber(r.online_amount)
                  const card = safeNumber(r.card_amount)
                  const total = cash + kaspi + online + card
                  return (
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="py-2 pr-2 text-gray-300">{r.date}</td>
                      <td className="py-2 pr-2 text-gray-300">{companyName(r.company_id)}</td>
                      <td className="py-2 pr-2 text-gray-400">{r.shift}</td>
                      <td className="py-2 pr-2 text-gray-400">{r.zone || '—'}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(cash)}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(kaspi)}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(online)}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(card)}</td>
                      <td className="py-2 text-right font-semibold text-white">{formatCompact(total)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4">Расходы (текущий период)</h3>
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="text-gray-400">
                <th className="text-left py-2 pr-2">Дата</th>
                <th className="text-left py-2 pr-2">Компания</th>
                <th className="text-left py-2 pr-2">Категория</th>
                <th className="text-right py-2 pr-2">Нал</th>
                <th className="text-right py-2 pr-2">Kaspi</th>
                <th className="text-right py-2">Итого</th>
              </tr>
            </thead>
            <tbody>
              {expensesCurrent
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => {
                  const cash = safeNumber(r.cash_amount)
                  const kaspi = safeNumber(r.kaspi_amount)
                  const total = cash + kaspi
                  return (
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="py-2 pr-2 text-gray-300">{r.date}</td>
                      <td className="py-2 pr-2 text-gray-300">{companyName(r.company_id)}</td>
                      <td className="py-2 pr-2 text-gray-400">{r.category || 'Без категории'}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(cash)}</td>
                      <td className="py-2 pr-2 text-right">{formatCompact(kaspi)}</td>
                      <td className="py-2 text-right font-semibold text-white">{formatCompact(total)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        {/* Toast */}
        {toast && (
          <div className="fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl bg-gray-900/80 border border-white/10 backdrop-blur-xl shadow-xl animate-in slide-in-from-top-2">
            <div className="text-sm text-white">{toast}</div>
          </div>
        )}

        <div className="p-6 lg:p-8 max-w-[1700px] mx-auto space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <BarChart3 className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">AI Аналитика</h1>
                  <p className="text-gray-400 mt-1">Все цифры: компании, оплаты, зоны, смены, категории</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-2xl p-1 border border-white/10">
                  {(['overview', 'companies', 'details'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        activeTab === tab ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {tab === 'overview' && 'Обзор'}
                      {tab === 'companies' && 'Компании'}
                      {tab === 'details' && 'Детали'}
                    </button>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={resetFilters}
                  title="Сбросить фильтры"
                >
                  <Lightbulb className="w-4 h-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleDownload}
                  title="Скачать CSV"
                >
                  <Download className="w-4 h-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleShare}
                  title="Скопировать ссылку"
                >
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              <div className="xl:col-span-6 space-y-3">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <CalendarDays className="w-4 h-4" /> Период
                </label>

                <div className="flex flex-wrap gap-2">
                  <Pill active={datePreset === 'today'} onClick={() => handlePresetChange('today')}>Сегодня</Pill>
                  <Pill active={datePreset === 'yesterday'} onClick={() => handlePresetChange('yesterday')}>Вчера</Pill>
                  <Pill active={datePreset === 'last7'} onClick={() => handlePresetChange('last7')}>7 дней</Pill>
                  <Pill active={datePreset === 'last30'} onClick={() => handlePresetChange('last30')}>30 дней</Pill>
                  <Pill active={datePreset === 'prevWeek'} onClick={() => handlePresetChange('prevWeek')}>Прошлая неделя</Pill>
                  <Pill active={datePreset === 'currentMonth'} onClick={() => handlePresetChange('currentMonth')}>Этот месяц</Pill>
                  <Pill active={datePreset === 'prevMonth'} onClick={() => handlePresetChange('prevMonth')}>Прошлый месяц</Pill>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="bg-gray-800/50 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                  />
                  <span className="text-gray-500">→</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="bg-gray-800/50 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>

              <div className="xl:col-span-3 space-y-3">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Store className="w-4 h-4" /> Компания
                </label>

                <select
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                  className="w-full bg-gray-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500/50"
                >
                  <option value="all">Все компании</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {companyFilter === 'all' && (
                  <button
                    onClick={() => setIncludeExtraInTotals((v) => !v)}
                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors ${
                      includeExtraInTotals ? 'text-fuchsia-300 bg-fuchsia-500/10' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-fuchsia-400' : 'bg-gray-600'}`} />
                    Учитывать F16 Extra
                  </button>
                )}
              </div>

              <div className="xl:col-span-3 space-y-3">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> Группировка
                </label>

                <div className="flex flex-wrap gap-2">
                  <Pill active={groupMode === 'day'} onClick={() => setGroupMode('day')}>Дни</Pill>
                  <Pill active={groupMode === 'week'} onClick={() => setGroupMode('week')}>Недели</Pill>
                  <Pill active={groupMode === 'month'} onClick={() => setGroupMode('month')}>Месяцы</Pill>
                  <Pill active={groupMode === 'year'} onClick={() => setGroupMode('year')}>Годы</Pill>
                </div>

                <div className="text-xs text-gray-500">
                  Подсказка: “Годы” удобно для инвестора. “Недели” — чтобы видеть провалы по сменам.
                </div>
              </div>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && OverviewBlock}
          {activeTab === 'companies' && CompaniesBlock}
          {activeTab === 'details' && DetailsBlock}

          {/* Footer micro */}
          <div className="text-xs text-gray-600 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Если цифры “скачут” — это не мистика, это либо дубль записи, либо криво введённая дата/смена 😄
          </div>
        </div>
      </main>
    </div>
  )
}

// =====================
// EXPORT with Suspense
// =====================
export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
                <BarChart3 className="w-8 h-8 text-white" />
              </div>
              <p className="text-gray-400">Загрузка аналитики...</p>
            </div>
          </main>
        </div>
      }
    >
      <ReportsContent />
    </Suspense>
  )
}
