'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  RotateCcw,
  X,
  ChevronDown,
  Filter,
  Calendar,
  Building2,
  LayoutGrid,
  Sparkles,
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
// DATE HELPERS (local ISO yyyy-mm-dd)
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

const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate()

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
const formatMoneyFull = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸'

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

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

const safeNumber = (v: unknown) => Number(v || 0)

// =====================
// CSV
// =====================
const csvEscape = (v: string) => {
  const s = v.replaceAll('"', '""')
  if (/[",\n\r;]/.test(s)) return `"${s}"`
  return s
}

const toCSV = (rows: string[][], sep = ';') =>
  rows.map((r) => r.map((c) => csvEscape(c)).join(sep)).join('\n') + '\n'

const downloadTextFile = (filename: string, content: string, mime = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type: mime })
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
const parseTab = (v: string | null): 'overview' | 'analytics' | 'details' | null => {
  if (!v) return null
  if (v === 'overview' || v === 'analytics' || v === 'details') return v
  return null
}
const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// =====================
// COMPONENT
// =====================
export default function ReportsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

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

  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'details'>('overview')

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  // Новые состояния для улучшенного UX
  const [isFiltersOpen, setIsFiltersOpen] = useState(true)
  const [activeFiltersCount, setActiveFiltersCount] = useState(0)

  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)
  const didSyncUrlOnce = useRef(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  // Подсчет активных фильтров
  useEffect(() => {
    let count = 0
    if (datePreset !== 'last7') count++
    if (companyFilter !== 'all') count++
    if (groupMode !== 'day') count++
    if (includeExtraInTotals) count++
    if (dateFrom !== addDaysISO(todayISO(), -6) || dateTo !== todayISO()) count++
    setActiveFiltersCount(count)
  }, [datePreset, companyFilter, groupMode, includeExtraInTotals, dateFrom, dateTo])

  // ---- normalize dates
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  // ---- load companies
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

  // ---- companies map
  const companyById = useMemo(() => {
    const m = new Map<string, { name: string; code: string }>()
    for (const c of companies) m.set(c.id, { name: c.name, code: (c.code || '').toLowerCase() })
    return m
  }, [companies])

  const extraCompanyId = useMemo(() => {
    for (const c of companies) {
      const code = (c.code || '').toLowerCase()
      if (code === 'extra') return c.id
      if (c.name === 'F16 Extra') return c.id
    }
    return null
  }, [companies])

  const companyName = useCallback((id: string) => companyById.get(id)?.name ?? '—', [companyById])
  const companyCode = useCallback((id: string) => companyById.get(id)?.code ?? '', [companyById])

  // ---- presets
  const applyPreset = useCallback(
    (preset: DatePreset) => {
      const today = todayISO()
      const todayDate = fromISO(today)

      let from = dateFrom
      let to = dateTo

      switch (preset) {
        case 'today':
          from = today
          to = today
          break
        case 'yesterday': {
          const y = addDaysISO(today, -1)
          from = y
          to = y
          break
        }
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
    },
    [dateFrom, dateTo],
  )

  const handlePresetChange = useCallback(
    (value: DatePreset) => {
      setDatePreset(value)
      if (value !== 'custom') applyPreset(value)
    },
    [applyPreset],
  )

  // ИСПРАВЛЕННАЯ функция сброса фильтров
  const resetFilters = useCallback(() => {
    const defaultFrom = addDaysISO(todayISO(), -6)
    const defaultTo = todayISO()
    
    setDatePreset('last7')
    setDateFrom(defaultFrom)
    setDateTo(defaultTo)
    setCompanyFilter('all')
    setGroupMode('day')
    setIncludeExtraInTotals(false)
    setActiveTab('overview')
    
    // Принудительная синхронизация URL
    const params = new URLSearchParams()
    params.set('from', defaultFrom)
    params.set('to', defaultTo)
    params.set('preset', 'last7')
    params.set('company', 'all')
    params.set('group', 'day')
    params.set('extra', '0')
    params.set('tab', 'overview')
    
    const newUrl = `${pathname}?${params.toString()}`
    router.replace(newUrl, { scroll: false })
    
    showToast('Фильтры сброшены ✅')
  }, [pathname, router, showToast])

  // =====================
  // INIT FROM URL
  // =====================
  useEffect(() => {
    if (didInitFromUrl.current) return
    if (!companiesLoaded) return

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

    if (pPreset && ['custom', 'today', 'yesterday', 'last7', 'prevWeek', 'last30', 'currentMonth', 'prevMonth'].includes(pPreset)) {
      setDatePreset(pPreset)
      if (pPreset !== 'custom' && !(pFrom && pTo)) applyPreset(pPreset)
    }

    if (pCompany) {
      if (pCompany === 'all') setCompanyFilter('all')
      else if (companies.some((c) => c.id === pCompany)) setCompanyFilter(pCompany)
    }

    if (pGroup) setGroupMode(pGroup)
    setIncludeExtraInTotals(Boolean(pExtra))

    if (pTab) setActiveTab(pTab)

    didInitFromUrl.current = true
  }, [companiesLoaded, companies, searchParams, applyPreset])

  // =====================
  // SYNC TO URL
  // =====================
  const syncUrl = useCallback(() => {
    const params = new URLSearchParams()

    params.set('from', dateFrom)
    params.set('to', dateTo)
    params.set('preset', datePreset)
    params.set('company', companyFilter)
    params.set('group', groupMode)
    params.set('extra', includeExtraInTotals ? '1' : '0')
    params.set('tab', activeTab)

    const newUrl = `${pathname}?${params.toString()}`
    router.replace(newUrl, { scroll: false })
  }, [router, pathname, dateFrom, dateTo, datePreset, companyFilter, groupMode, includeExtraInTotals, activeTab])

  useEffect(() => {
    if (!didInitFromUrl.current) return
    const t = window.setTimeout(() => {
      if (!didSyncUrlOnce.current) didSyncUrlOnce.current = true
      syncUrl()
    }, 250)
    return () => window.clearTimeout(t)
  }, [syncUrl])

  // =====================
  // LOAD DATA
  // =====================
  const range = useMemo(() => {
    const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)
    return { rangeFrom: prevFrom, rangeTo: dateTo }
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!companiesLoaded) return

    if (companies.length === 0) {
      setIncomes([])
      setExpenses([])
      setLoading(false)
      return
    }

    const loadRange = async () => {
      const myReqId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      let incomeQ = supabase
        .from('incomes')
        .select('id,date,company_id,shift,zone,cash_amount,kaspi_amount,online_amount,card_amount')
        .gte('date', range.rangeFrom)
        .lte('date', range.rangeTo)

      let expenseQ = supabase
        .from('expenses')
        .select('id,date,company_id,category,cash_amount,kaspi_amount')
        .gte('date', range.rangeFrom)
        .lte('date', range.rangeTo)

      if (companyFilter !== 'all') {
        incomeQ = incomeQ.eq('company_id', companyFilter)
        expenseQ = expenseQ.eq('company_id', companyFilter)
      } else if (!includeExtraInTotals && extraCompanyId) {
        incomeQ = incomeQ.neq('company_id', extraCompanyId)
        expenseQ = expenseQ.neq('company_id', extraCompanyId)
      }

      const [{ data: inc, error: incErr }, { data: exp, error: expErr }] = await Promise.all([incomeQ, expenseQ])

      if (myReqId !== reqIdRef.current) return

      if (incErr || expErr) {
        setError('Не удалось загрузить данные')
        setLoading(false)
        return
      }

      setIncomes((inc || []) as IncomeRow[])
      setExpenses((exp || []) as ExpenseRow[])
      setLoading(false)
    }

    loadRange()
  }, [companiesLoaded, companies.length, range.rangeFrom, range.rangeTo, companyFilter, includeExtraInTotals, extraCompanyId])

  // =====================
  // PROCESSING
  // =====================
  const processed = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const totalsCur = baseTotals()
    const totalsPrev = baseTotals()

    const expenseByCategoryMap = new Map<string, number>()
    const incomeByCompanyMap = new Map<string, { companyId: string; name: string; value: number }>()
    const chartDataMap = new Map<string, TimeAggregation>()
    const anomalies: Anomaly[] = []

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

    // incomes
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

        const name = companyName(r.company_id) || 'Неизвестно'
        const cur = incomeByCompanyMap.get(r.company_id)
        if (!cur) incomeByCompanyMap.set(r.company_id, { companyId: r.company_id, name, value: total })
        else cur.value += total
      }
    }

    // expenses
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
      }
    }

    const finalize = (t: FinancialTotals) => {
      t.profit = t.totalIncome - t.totalExpense
      t.remainingCash = t.incomeCash - t.expenseCash
      t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
      t.totalBalance = t.profit
      return t
    }

    finalize(totalsCur)
    finalize(totalsPrev)

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
      agg.profit = agg.income - agg.expense
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
      incomeByCompanyMap,
      anomalies,
      prevFrom,
      prevTo,
    }
  }, [incomes, expenses, dateFrom, dateTo, groupMode, companyName])

  // derived datasets
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
        .slice(0, 8),
    [processed.expenseByCategoryMap],
  )

  const incomeByCompanyData = useMemo(
    () =>
      Array.from(processed.incomeByCompanyMap.values())
        .map((x, idx) => ({ companyId: x.companyId, name: x.name, value: x.value, fill: PIE_COLORS[idx % PIE_COLORS.length] }))
        .sort((a, b) => b.value - a.value),
    [processed.incomeByCompanyMap],
  )

  const incomesCurrent = useMemo(() => incomes.filter((r) => r.date >= dateFrom && r.date <= dateTo), [incomes, dateFrom, dateTo])
  const expensesCurrent = useMemo(() => expenses.filter((r) => r.date >= dateFrom && r.date <= dateTo), [expenses, dateFrom, dateTo])

  // =====================
  // AI INSIGHTS
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []

    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0

    if (profitMargin < 15) {
      insights.push({
        type: 'warning',
        title: 'Низкая маржинальность',
        description: `Маржа ${profitMargin.toFixed(1)}% ниже нормы. Проверьте расходы.`,
        metric: `${profitMargin.toFixed(1)}%`,
      })
    } else if (profitMargin > 35) {
      insights.push({
        type: 'success',
        title: 'Отличная маржа',
        description: `Маржа ${profitMargin.toFixed(1)}% — выше среднего.`,
        metric: `${profitMargin.toFixed(1)}%`,
      })
    }

    const cashRatio = totals.totalIncome > 0 ? totals.incomeCash / totals.totalIncome : 0
    if (cashRatio < 0.3) {
      insights.push({
        type: 'opportunity',
        title: 'Много безнала',
        description: 'Можно стимулировать наличку (скидка/бонус).',
        metric: `${((1 - cashRatio) * 100).toFixed(0)}% безнал`,
      })
    }

    const topExpense = Array.from(processed.expenseByCategoryMap.entries()).sort((a, b) => b[1] - a[1])[0]
    if (topExpense && totals.totalExpense > 0) {
      const share = (topExpense[1] / totals.totalExpense) * 100
      if (share > 40) {
        insights.push({
          type: 'warning',
          title: 'Концентрация расходов',
          description: `"${topExpense[0]}" — ${share.toFixed(0)}% расходов.`,
          metric: `${share.toFixed(0)}%`,
        })
      }
    }

    if (totalsPrev.totalIncome > 0) {
      const incomeChange = ((totals.totalIncome - totalsPrev.totalIncome) / totalsPrev.totalIncome) * 100
      if (Math.abs(incomeChange) > 20) {
        insights.push({
          type: incomeChange > 0 ? 'success' : 'warning',
          title: incomeChange > 0 ? 'Рост выручки' : 'Падение выручки',
          description: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}% к прошлому периоду`,
          metric: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}%`,
        })
      }
    }

    const high = processed.anomalies.filter((a) => a.severity === 'high').length
    if (high > 0) {
      insights.push({
        type: 'warning',
        title: 'Критические аномалии',
        description: 'Нужна проверка данных/расходов.',
        metric: `${high} шт`,
      })
    }

    return insights.slice(0, 4)
  }, [totals, totalsPrev, processed.expenseByCategoryMap, processed.anomalies])

  // =====================
  // FORECAST
  // =====================
  const forecast = useMemo(() => {
    if (datePreset !== 'currentMonth') return null

    const dTo = fromISO(dateTo)
    const y = dTo.getFullYear()
    const m = dTo.getMonth()
    const dim = daysInMonth(y, m)

    const dayOfMonth = dTo.getDate()
    const remainingDays = Math.max(0, dim - dayOfMonth)

    const daysRange = Math.floor((fromISO(dateTo).getTime() - fromISO(dateFrom).getTime()) / 86400000) + 1
    if (daysRange <= 0) return null

    const avgIncome = totals.totalIncome / daysRange
    const avgProfit = totals.profit / daysRange

    return {
      remainingDays,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remainingDays),
      forecastProfit: Math.round(totals.profit + avgProfit * remainingDays),
      confidence: clamp(60 + (daysRange / dim) * 30, 45, 90),
    }
  }, [datePreset, dateFrom, dateTo, totals.totalIncome, totals.profit])

  // =====================
  // BUTTONS HANDLERS
  // =====================
  
  // ИСПРАВЛЕННАЯ функция поделиться
  const handleShare = useCallback(async () => {
    try {
      const url = window.location.href
      
      // Проверяем поддержку Web Share API
      if (navigator.share) {
        await navigator.share({
          title: 'AI Аналитика - Финансовый отчет',
          text: `Отчет за ${dateFrom} — ${dateTo}`,
          url: url,
        })
        showToast('Отправлено! ✅')
      } else if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url)
        showToast('Ссылка скопирована ✅')
      } else {
        // Fallback для небезопасных контекстов
        const textArea = document.createElement('textarea')
        textArea.value = url
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        
        try {
          document.execCommand('copy')
          showToast('Ссылка скопирована ✅')
        } catch (err) {
          showToast('Не удалось скопировать 😤')
        } finally {
          textArea.remove()
        }
      }
    } catch (err) {
      // Пользователь отменил share
      if ((err as Error).name !== 'AbortError') {
        showToast('Не удалось поделиться 😤')
      }
    }
  }, [showToast, dateFrom, dateTo])

  // ИСПРАВЛЕННАЯ функция скачивания с выбором формата
  const handleDownload = useCallback(() => {
    // Показываем диалог выбора формата через toast или просто скачиваем CSV
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

    rows.push(['Доходы (incomes)'])
    rows.push(['date', 'company', 'shift', 'zone', 'cash', 'kaspi', 'online', 'card', 'total'])
    for (const r of incomesCurrent.sort((a, b) => a.date.localeCompare(b.date))) {
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
    for (const r of expensesCurrent.sort((a, b) => a.date.localeCompare(b.date))) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi
      rows.push([r.date, companyName(r.company_id), r.category || 'Без категории', String(Math.round(cash)), String(Math.round(kaspi)), String(Math.round(total))])
    }

    const csv = toCSV(rows, ';')
    const fname = `report_${dateFrom}_${dateTo}.csv`
    downloadTextFile(fname, csv)
    showToast('CSV скачан ✅')
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
  ])

  // Новая функция: печать отчета
  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  // =====================
  // LOADING / ERROR
  // =====================
  if (loading) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <p className="text-gray-400">AI анализирует данные...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-rose-400">{error}</main>
      </div>
    )
  }

  // =====================
  // UI BLOCKS
  // =====================
  const OverviewBlock = (
    <>
      {/* AI INSIGHTS */}
      {aiInsights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {aiInsights.map((insight, idx) => (
            <div
              key={idx}
              className={`group relative overflow-hidden rounded-2xl border p-5 cursor-pointer transition-all hover:scale-[1.02] ${
                insight.type === 'warning'
                  ? 'bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20'
                  : insight.type === 'success'
                    ? 'bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20'
                    : insight.type === 'opportunity'
                      ? 'bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border-violet-500/20'
                      : 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20'
              }`}
            >
              <div className="flex items-start justify-between">
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
                  {insight.type === 'opportunity' && <TrendingUp className="w-5 h-5" />}
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

      {/* MAIN METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Income */}
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 p-6 hover:border-emerald-500/40 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-emerald-500/20 rounded-xl">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-emerald-400">Выручка</span>
            </div>
            <div className="text-3xl font-bold text-white mb-2">{formatMoneyFull(totals.totalIncome)}</div>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-gray-500">Нал:</span>
                <span className="ml-2 text-gray-300">{formatMoneyFull(totals.incomeCash)}</span>
              </div>
              <div>
                <span className="text-gray-500">Безнал:</span>
                <span className="ml-2 text-gray-300">{formatMoneyFull(totals.incomeNonCash)}</span>
              </div>
            </div>
            {totalsPrev.totalIncome > 0 && (
              <div className={`mt-3 text-sm flex items-center gap-1 ${totals.totalIncome >= totalsPrev.totalIncome ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totals.totalIncome >= totalsPrev.totalIncome ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {getPercentageChange(totals.totalIncome, totalsPrev.totalIncome)}
              </div>
            )}
          </div>
        </div>

        {/* Expenses */}
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500/10 to-pink-500/10 border border-rose-500/20 p-6 hover:border-rose-500/40 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-rose-500/20 rounded-xl">
                <TrendingDown className="w-5 h-5 text-rose-400" />
              </div>
              <span className="text-sm font-medium text-rose-400">Расходы</span>
            </div>
            <div className="text-3xl font-bold text-white mb-2">{formatMoneyFull(totals.totalExpense)}</div>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-gray-500">Нал:</span>
                <span className="ml-2 text-gray-300">{formatMoneyFull(totals.expenseCash)}</span>
              </div>
              <div>
                <span className="text-gray-500">Kaspi:</span>
                <span className="ml-2 text-gray-300">{formatMoneyFull(totals.expenseKaspi)}</span>
              </div>
            </div>
            {totalsPrev.totalExpense > 0 && (
              <div className={`mt-3 text-sm flex items-center gap-1 ${totals.totalExpense <= totalsPrev.totalExpense ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totals.totalExpense <= totalsPrev.totalExpense ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                {getPercentageChange(totals.totalExpense, totalsPrev.totalExpense)}
              </div>
            )}
          </div>
        </div>

        {/* Profit */}
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border border-amber-500/20 p-6 hover:border-amber-500/40 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-500/20 rounded-xl">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <span className="text-sm font-medium text-amber-400">Прибыль</span>
            </div>
            <div className={`text-3xl font-bold mb-2 ${totals.profit >= 0 ? 'text-white' : 'text-rose-400'}`}>{formatMoneyFull(totals.profit)}</div>
            <div className="text-sm text-gray-400">
              Маржа:{' '}
              <span className={totals.totalIncome > 0 && totals.profit / totals.totalIncome > 0.2 ? 'text-emerald-400' : 'text-amber-400'}>
                {totals.totalIncome > 0 ? ((totals.profit / totals.totalIncome) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>
        </div>

        {/* Balance */}
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/20 p-6 hover:border-blue-500/40 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-xl">
                <Wallet className="w-5 h-5 text-blue-400" />
              </div>
              <span className="text-sm font-medium text-blue-400">Остатки</span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Наличные:</span>
                <span className={totals.remainingCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatMoneyFull(totals.remainingCash)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Безнал:</span>
                <span className={totals.remainingKaspi >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatMoneyFull(totals.remainingKaspi)}</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-white/10">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Итого:</span>
                <span className="font-semibold text-white">{formatMoneyFull(totals.remainingCash + totals.remainingKaspi)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <div className="flex items-center justify-between mb-6">
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
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
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

        {/* Expense Structure */}
        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            Структура расходов
          </h3>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={expenseByCategoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="amount">
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
            {expenseByCategoryData.slice(0, 5).map((item, idx) => (
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

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Revenue */}
        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <Store className="w-5 h-5 text-blue-400" />
            Выручка по компаниям
          </h3>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incomeByCompanyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }}
                  formatter={(v: number) => formatMoneyFull(v)}
                />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                  {incomeByCompanyData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Anomalies */}
        <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Аномалии и рекомендации
          </h3>

          {processed.anomalies.length > 0 ? (
            <div className="space-y-3">
              {processed.anomalies.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-gray-800/50 border border-white/5">
                  <div
                    className={`p-2 rounded-lg ${
                      a.severity === 'high'
                        ? 'bg-rose-500/20 text-rose-400'
                        : a.severity === 'medium'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {a.severity === 'high' ? <AlertTriangle className="w-5 h-5" /> : <Lightbulb className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-white">{a.description}</p>
                    <p className="text-xs text-gray-500 mt-1">{a.date}</p>
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
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
              <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500/50" />
              <p>Аномалий не обнаружено</p>
            </div>
          )}
        </div>
      </div>
    </>
  )

  const AnalyticsBlock = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-400" />
          Структура доходов
        </h3>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Наличные</span>
            <span className="text-white font-medium">{formatMoneyFull(totals.incomeCash)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Kaspi</span>
            <span className="text-white font-medium">{formatMoneyFull(totals.incomeKaspi)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Online</span>
            <span className="text-white font-medium">{formatMoneyFull(totals.incomeOnline)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Card</span>
            <span className="text-white font-medium">{formatMoneyFull(totals.incomeCard)}</span>
          </div>

          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-gray-400">Безнал (итого)</span>
            <span className="text-white font-semibold">{formatMoneyFull(totals.incomeNonCash)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          Быстрые выводы
        </h3>

        <div className="space-y-3 text-sm text-gray-300">
          <div className="p-4 rounded-xl bg-gray-800/50 border border-white/5">
            <div className="text-gray-400">Маржа</div>
            <div className="text-white font-semibold">
              {totals.totalIncome > 0 ? ((totals.profit / totals.totalIncome) * 100).toFixed(1) : '0.0'}%
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-800/50 border border-white/5">
            <div className="text-gray-400">Кэш-флоу (нал)</div>
            <div className={totals.remainingCash >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
              {formatMoneyFull(totals.remainingCash)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-800/50 border border-white/5">
            <div className="text-gray-400">Кэш-флоу (безнал)</div>
            <div className={totals.remainingKaspi >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
              {formatMoneyFull(totals.remainingKaspi)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const DetailsBlock = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold mb-4">Доходы (текущий период)</h3>
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="text-gray-400">
                <th className="text-left py-2 pr-2">Дата</th>
                <th className="text-left py-2 pr-2">Компания</th>
                <th className="text-left py-2 pr-2">Смена</th>
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
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
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

  // =====================
  // RENDER
  // =====================
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
          {/* TOAST */}
          {toast && (
            <div className="fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl bg-gray-900/80 border border-white/10 backdrop-blur-xl shadow-xl animate-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-sm text-white">{toast}</span>
              </div>
            </div>
          )}

          {/* HEADER */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <BarChart3 className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">AI Аналитика</h1>
                  <p className="text-gray-400 mt-1">Умный анализ финансов в реальном времени</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Tabs */}
                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-2xl p-1 border border-white/10">
                  {(['overview', 'analytics', 'details'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        activeTab === tab 
                          ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {tab === 'overview' && 'Обзор'}
                      {tab === 'analytics' && 'Аналитика'}
                      {tab === 'details' && 'Детали'}
                    </button>
                  ))}
                </div>

                {/* Filter Toggle */}
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 relative ${
                    isFiltersOpen ? 'bg-white/10' : ''
                  }`}
                  onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                  title="Показать/скрыть фильтры"
                >
                  <Filter className="w-4 h-4" />
                  {activeFiltersCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-500 rounded-full text-[10px] flex items-center justify-center">
                      {activeFiltersCount}
                    </span>
                  )}
                </Button>

                {/* Reset Filters - ИСПРАВЛЕНО: иконка RotateCcw */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={resetFilters}
                  title="Сбросить фильтры"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>

                {/* Download - ИСПРАВЛЕНО: добавлен dropdown или прямое скачивание */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleDownload}
                  title="Скачать CSV"
                >
                  <Download className="w-4 h-4" />
                </Button>

                {/* Share - ИСПРАВЛЕНО: улучшенная логика */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleShare}
                  title="Поделиться отчетом"
                >
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* COLLAPSIBLE FILTERS */}
          <div className={`rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 overflow-hidden transition-all duration-300 ${
            isFiltersOpen ? 'opacity-100 max-h-[1000px]' : 'opacity-0 max-h-0'
          }`}>
            <div className="p-6">
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Period */}
                <div className="flex-1 space-y-3">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    Период
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(['today', 'yesterday', 'last7', 'currentMonth', 'prevMonth'] as DatePreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePresetChange(p)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                          datePreset === p
                            ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25'
                            : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
                        }`}
                      >
                        {p === 'today' && 'Сегодня'}
                        {p === 'yesterday' && 'Вчера'}
                        {p === 'last7' && '7 дней'}
                        {p === 'currentMonth' && 'Этот месяц'}
                        {p === 'prevMonth' && 'Прошлый месяц'}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo}
                      onChange={(e) => {
                        setDateFrom(e.target.value)
                        setDatePreset('custom')
                      }}
                      className="bg-gray-800/50 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                    <span className="text-gray-500">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom}
                      onChange={(e) => {
                        setDateTo(e.target.value)
                        setDatePreset('custom')
                      }}
                      className="bg-gray-800/50 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                  </div>
                </div>

                {/* Company */}
                <div className="space-y-3 min-w-[260px]">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <Building2 className="w-3 h-3" />
                    Компания
                  </label>
                  <div className="relative">
                    <select
                      value={companyFilter}
                      onChange={(e) => setCompanyFilter(e.target.value)}
                      className="w-full bg-gray-800/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500/50 appearance-none cursor-pointer"
                    >
                      <option value="all">Все компании</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  </div>

                  {companyFilter === 'all' && (
                    <button
                      onClick={() => setIncludeExtraInTotals((v) => !v)}
                      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors w-full ${
                        includeExtraInTotals ? 'text-fuchsia-400 bg-fuchsia-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-fuchsia-400' : 'bg-gray-600'}`} />
                      Учитывать F16 Extra
                    </button>
                  )}
                  
                  {companyFilter !== 'all' && (
                    <button
                      onClick={() => setCompanyFilter('all')}
                      className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 px-3 py-2"
                    >
                      <X className="w-3 h-3" />
                      Сбросить выбор
                    </button>
                  )}
                </div>

                {/* Grouping */}
                <div className="space-y-3 min-w-[240px]">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <LayoutGrid className="w-3 h-3" />
                    Группировка
                  </label>
                  <div className="flex gap-2">
                    {(['day', 'week', 'month'] as GroupMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setGroupMode(mode)}
                        className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                          groupMode === mode 
                            ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg' 
                            : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
                        }`}
                      >
                        {mode === 'day' && 'Дни'}
                        {mode === 'week' && 'Недели'}
                        {mode === 'month' && 'Месяцы'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Forecast */}
                {forecast && (
                  <div className="space-y-3 min-w-[270px]">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Прогноз на месяц</label>
                    <div className="p-4 rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-gray-400">Точность {forecast.confidence.toFixed(0)}%</span>
                        <span className="text-xs text-violet-400">{forecast.remainingDays} дн. осталось</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-500">Выручка</div>
                          <div className="text-lg font-bold text-violet-400">{formatMoneyFull(forecast.forecastIncome)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Прибыль</div>
                          <div className="text-lg font-bold text-emerald-400">{formatMoneyFull(forecast.forecastProfit)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TAB CONTENT */}
          <div className="transition-all duration-300">
            {activeTab === 'overview' && OverviewBlock}
            {activeTab === 'analytics' && AnalyticsBlock}
            {activeTab === 'details' && DetailsBlock}
          </div>
        </div>
      </main>
    </div>
  )
}
