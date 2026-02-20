'use client'

export const dynamic = 'force-dynamic'

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
const parseGroup = (v: string | null): GroupMode | null => (v === 'day' || v === 'week' || v === 'month' || v === 'year' ? v : null)
const parseTab = (v: string | null): 'overview' | 'analytics' | 'details' | null =>
  v === 'overview' || v === 'analytics' || v === 'details' ? v : null
const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// =====================
// MAIN COMPONENT
// =====================
function ReportsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ✅ FIX: графики только после mount → убирает width(-1)/height(-1) на пререндере
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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

  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  // Нормализация дат
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  // Загрузка компаний
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
      if (c.name === 'F16 Extra') return c.id
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
        break
      case 'yesterday':
        from = addDaysISO(today, -1)
        to = from
        break
      case 'last7':
        from = addDaysISO(today, -6)
        break
      case 'last30':
        from = addDaysISO(today, -29)
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

  // Инициализация из URL
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

    if (
      pPreset &&
      ['custom', 'today', 'yesterday', 'last7', 'prevWeek', 'last30', 'currentMonth', 'prevMonth'].includes(pPreset)
    ) {
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

  // Синхронизация с URL
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

  // Загрузка данных
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

        setIncomes(incomeResult.data || [])
        setExpenses(expenseResult.data || [])
      } catch (err) {
        if (myReqId === reqIdRef.current) {
          setError('Ошибка загрузки данных')
          console.error(err)
        }
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false)
      }
    }

    loadData()
  }, [companiesLoaded, companies.length, dateFrom, dateTo, companyFilter, includeExtraInTotals, extraCompanyId])

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
        chartDataMap.get(key) || {
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
        }
      chartDataMap.set(key, b)
      return b
    }

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

    const avgIncome = totalsCur.totalIncome / (dailyIncome.size || 1)
    const avgExpense = totalsCur.totalExpense / (dailyExpense.size || 1)

    for (const [date, amount] of dailyIncome) {
      if (amount > avgIncome * 2) {
        anomalies.push({ type: 'income_spike', date, description: `Всплеск выручки: ${formatMoneyFull(amount)}`, severity: 'medium', value: amount })
      }
    }
    for (const [date, amount] of dailyExpense) {
      if (amount > avgExpense * 2.5) {
        anomalies.push({ type: 'expense_spike', date, description: `Аномальный расход: ${formatMoneyFull(amount)}`, severity: 'high', value: amount })
      }
    }
    for (const agg of chartDataMap.values()) {
      agg.profit = agg.income - agg.expense
      if (agg.income > 0) {
        const margin = agg.profit / agg.income
        if (margin < 0.1) {
          anomalies.push({ type: 'low_profit', date: agg.label, description: `Низкая маржа: ${(margin * 100).toFixed(1)}%`, severity: 'medium', value: agg.profit })
        }
      }
    }

    return { totalsCur, totalsPrev, chartDataMap, expenseByCategoryMap, incomeByCompanyMap, anomalies, prevFrom, prevTo }
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

  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0

    if (profitMargin < 15) {
      insights.push({ type: 'warning', title: 'Низкая маржинальность', description: `Маржа ${profitMargin.toFixed(1)}% ниже нормы. Проверьте расходы.`, metric: `${profitMargin.toFixed(1)}%` })
    } else if (profitMargin > 35) {
      insights.push({ type: 'success', title: 'Отличная маржа', description: `Маржа ${profitMargin.toFixed(1)}% — выше среднего.`, metric: `${profitMargin.toFixed(1)}%` })
    }

    const cashRatio = totals.totalIncome > 0 ? totals.incomeCash / totals.totalIncome : 0
    if (cashRatio < 0.3) {
      insights.push({ type: 'opportunity', title: 'Много безнала', description: 'Можно стимулировать наличку (скидка/бонус).', metric: `${((1 - cashRatio) * 100).toFixed(0)}% безнал` })
    }

    const topExpense = Array.from(processed.expenseByCategoryMap.entries()).sort((a, b) => b[1] - a[1])[0]
    if (topExpense && totals.totalExpense > 0) {
      const share = (topExpense[1] / totals.totalExpense) * 100
      if (share > 40) insights.push({ type: 'warning', title: 'Концентрация расходов', description: `"${topExpense[0]}" — ${share.toFixed(0)}% расходов.`, metric: `${share.toFixed(0)}%` })
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
    if (high > 0) insights.push({ type: 'warning', title: 'Критические аномалии', description: 'Нужна проверка данных/расходов.', metric: `${high} шт` })

    return insights.slice(0, 4)
  }, [totals, totalsPrev, processed.expenseByCategoryMap, processed.anomalies])

  const forecast = useMemo(() => {
    if (datePreset !== 'currentMonth') return null
    const startDate = fromISO(dateFrom)
    const endDate = fromISO(dateTo)
    const today = new Date()

    const daysPassed = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    if (daysPassed <= 0) return null

    const avgIncome = totals.totalIncome / daysPassed
    const avgProfit = totals.profit / daysPassed

    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const remainingDays = Math.max(0, lastDayOfMonth.getDate() - today.getDate())

    return {
      remainingDays,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remainingDays),
      forecastProfit: Math.round(totals.profit + avgProfit * remainingDays),
      confidence: Math.min(90, Math.max(45, 60 + (daysPassed / 30) * 30)),
    }
  }, [datePreset, dateFrom, dateTo, totals.totalIncome, totals.profit])

  const handleShare = useCallback(async () => {
    try {
      const url = window.location.href
      await navigator.clipboard.writeText(url)
      showToast('Ссылка скопирована')
    } catch {
      showToast('Не удалось скопировать ссылку')
    }
  }, [showToast])

  const handleDownload = useCallback(() => {
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
    for (const r of incomesCurrent.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const online = safeNumber(r.online_amount)
      const card = safeNumber(r.card_amount)
      const total = cash + kaspi + online + card
      rows.push([r.date, companyName(r.company_id), r.shift, r.zone || '', String(Math.round(cash)), String(Math.round(kaspi)), String(Math.round(online)), String(Math.round(card)), String(Math.round(total))])
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

    downloadTextFile(`report_${dateFrom}_${dateTo}.csv`, toCSV(rows, ';'))
    showToast('CSV скачан')
  }, [companyFilter, includeExtraInTotals, companyName, dateFrom, dateTo, groupMode, totals, incomesCurrent, expensesCurrent, showToast])

  if (loading && companies.length === 0) {
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

  // ✅ FIX: контейнеры графиков с min-h + min-w-0
  const ChartShell = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={['min-w-0 h-80 min-h-[320px]', className || ''].join(' ')}>
      {mounted ? children : <div className="h-full w-full rounded-xl bg-gray-800/40 border border-white/5 animate-pulse" />}
    </div>
  )

  // ----- UI ниже ты можешь оставить как был -----
  // Я меняю только места с ResponsiveContainer → оборачиваю ChartShell

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
          {toast && (
            <div className="fixed top-5 right-5 z-50 px-4 py-3 rounded-2xl bg-gray-900/80 border border-white/10 backdrop-blur-xl shadow-xl animate-in slide-in-from-top-2">
              <div className="text-sm text-white">{toast}</div>
            </div>
          )}

          {/* Header */}
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
                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-2xl p-1 border border-white/10">
                  {(['overview', 'analytics', 'details'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        activeTab === tab ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {tab === 'overview' && 'Обзор'}
                      {tab === 'analytics' && 'Аналитика'}
                      {tab === 'details' && 'Детали'}
                    </button>
                  ))}
                </div>

                <Button variant="outline" size="icon" className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10" onClick={resetFilters} title="Сбросить фильтры">
                  <Lightbulb className="w-4 h-4" />
                </Button>

                <Button variant="outline" size="icon" className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10" onClick={handleDownload} title="Скачать CSV">
                  <Download className="w-4 h-4" />
                </Button>

                <Button variant="outline" size="icon" className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10" onClick={handleShare} title="Скопировать ссылку">
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Таб-контент: я покажу только часть с графиками — остальное можешь оставить как было */}

          {activeTab === 'overview' && (
            <>
              {/* ... твои карточки выше оставляй как есть ... */}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Activity className="w-5 h-5 text-violet-400" />
                      Динамика доходов и расходов
                    </h3>
                  </div>

                  <ChartShell>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="label" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                        <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px', padding: '12px' }} />
                        <Area type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} fillOpacity={0.15} />
                        <Area type="monotone" dataKey="expense" stroke="#f43f5e" strokeWidth={2} fillOpacity={0.12} />
                        <Line type="monotone" dataKey="profit" stroke="#fbbf24" strokeWidth={3} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartShell>
                </div>

                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    Структура расходов
                  </h3>

                  <ChartShell className="h-64 min-h-[256px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseByCategoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="amount">
                          {expenseByCategoryData.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }} formatter={(v: number) => formatMoneyFull(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartShell>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Store className="w-5 h-5 text-blue-400" />
                    Выручка по компаниям
                  </h3>

                  <ChartShell className="h-64 min-h-[256px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={incomeByCompanyData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={120} stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }} formatter={(v: number) => formatMoneyFull(v)} />
                        <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                          {incomeByCompanyData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartShell>
                </div>

                {/* ... вторую колонку (аномалии) оставляй как есть ... */}
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
          )}

          {/* analytics/details оставь как у тебя */}
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
