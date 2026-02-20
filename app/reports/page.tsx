'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabaseClient'

import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ArrowUpDown,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Download,
  FileSpreadsheet,
  Filter,
  Lightbulb,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Share2,
  Store,
  Table,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
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
  online_amount: number | null  // ← ДОБАВЛЕНО
  card_amount: number | null
  created_at?: string
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  description?: string | null
  created_at?: string
}

type Company = {
  id: string
  name: string
  code?: string | null
  address?: string | null
}

type GroupMode = 'day' | 'week' | 'month' | 'year'
type DatePreset = 'custom' | 'today' | 'yesterday' | 'last7' | 'prevWeek' | 'last30' | 'currentMonth' | 'prevMonth' | 'last90' | 'currentQuarter' | 'prevQuarter' | 'currentYear' | 'prevYear'

type SortDirection = 'asc' | 'desc'
type SortField = 'date' | 'company' | 'amount' | 'category' | 'shift' | 'zone'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number      // ← ДОБАВЛЕНО
  incomeCard: number        // ← ДОБАВЛЕНО
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
  remainingCash: number
  remainingKaspi: number
  totalBalance: number
  transactionCount: number
  avgTransaction: number
}

type TimeAggregation = {
  label: string
  sortISO: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number      // ← ДОБАВЛЕНО
  incomeCard: number        // ← ДОБАВЛЕНО
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  count: number
}

type AIInsight = {
  type: 'warning' | 'success' | 'info' | 'opportunity' | 'danger'
  title: string
  description: string
  metric?: string
  trend?: 'up' | 'down' | 'neutral'
}

type Anomaly = {
  type: 'income_spike' | 'expense_spike' | 'low_profit' | 'no_data' | 'high_cash_ratio'
  date: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  value: number
  companyId?: string
}

type DetailedRow = {
  id: string
  date: string
  type: 'income' | 'expense'
  companyId: string
  companyName: string
  amount: number
  cashAmount: number
  kaspiAmount: number
  onlineAmount?: number     // ← ДОБАВЛЕНО
  cardAmount?: number       // ← ДОБАВЛЕНО
  category?: string
  shift?: Shift
  zone?: string | null
  description?: string
}

// =====================
// CONSTS
// =====================
const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'] as const

const SHIFT_LABELS: Record<Shift, string> = {
  day: 'День',
  night: 'Ночь',
}

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  last7: 'Последние 7 дней',
  prevWeek: 'Прошлая неделя',
  last30: 'Последние 30 дней',
  currentMonth: 'Текущий месяц',
  prevMonth: 'Прошлый месяц',
  last90: 'Последние 90 дней',
  currentQuarter: 'Текущий квартал',
  prevQuarter: 'Прошлый квартал',
  currentYear: 'Текущий год',
  prevYear: 'Прошлый год',
  custom: 'Произвольный период',
}

const baseTotals = (): FinancialTotals => ({
  incomeCash: 0,
  incomeKaspi: 0,
  incomeOnline: 0,      // ← ДОБАВЛЕНО
  incomeCard: 0,        // ← ДОБАВЛЕНО
  incomeNonCash: 0,
  expenseCash: 0,
  expenseKaspi: 0,
  totalIncome: 0,
  totalExpense: 0,
  profit: 0,
  remainingCash: 0,
  remainingKaspi: 0,
  totalBalance: 0,
  transactionCount: 0,
  avgTransaction: 0,
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

const formatDateRange = (from: string, to: string) => {
  const d1 = fromISO(from)
  const d2 = fromISO(to)
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
  
  if (sameMonth) {
    return `${d1.getDate()}–${d2.getDate()} ${d1.toLocaleDateString('ru-RU', { month: 'long' })} ${d1.getFullYear()}`
  }
  return `${d1.toLocaleDateString('ru-RU')} – ${d2.toLocaleDateString('ru-RU')}`
}

// =====================
// FORMATTERS
// =====================
const formatMoneyFull = (n: number) => {
  if (!Number.isFinite(n)) return '0 ₸'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

const formatMoneyCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' млрд'
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + ' тыс'
  return String(Math.round(n))
}

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
// CSV & EXPORT
// =====================
const csvEscape = (v: string) => {
  const s = String(v).replaceAll('"', '""')
  if (/[",\n\r;]/.test(s)) return `"${s}"`
  return s
}

const toCSV = (rows: string[][], sep = ';') => 
  rows.map((r) => r.map((c) => csvEscape(c)).join(sep)).join('\n') + '\n'

const downloadTextFile = (filename: string, content: string, mime = 'text/csv') => {
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

const generateExcelXML = (title: string, headers: string[], rows: (string | number)[][]) => {
  const escapeXml = (str: string) => str.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] || c))
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${escapeXml(title)}">
    <Table>`
  
  xml += `
      <Row>
        ${headers.map(h => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}
      </Row>`
  
  for (const row of rows) {
    xml += `
      <Row>
        ${row.map(cell => {
          const type = typeof cell === 'number' ? 'Number' : 'String'
          return `<Cell><Data ss:Type="${type}">${escapeXml(String(cell))}</Data></Cell>`
        }).join('')}
      </Row>`
  }
  
  xml += `
    </Table>
  </Worksheet>
</Workbook>`
  
  return xml
}

// =====================
// URL PARAMS
// =====================
const parseBool = (v: string | null) => v === '1' || v === 'true'
const parseGroup = (v: string | null): GroupMode | null => 
  (v === 'day' || v === 'week' || v === 'month' || v === 'year') ? v : null
const parseTab = (v: string | null) => 
  (v === 'overview' || v === 'analytics' || v === 'details' || v === 'companies') ? v : null
const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

// =====================
// MAIN COMPONENT
// =====================
function ReportsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Mount fix for charts
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Data states
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoaded, setCompaniesLoaded] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter states
  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(() => todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [shiftFilter, setShiftFilter] = useState<'all' | Shift>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [minAmountFilter, setMinAmountFilter] = useState<string>('')
  const [maxAmountFilter, setMaxAmountFilter] = useState<string>('')

  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'details' | 'companies'>('overview')

  // Table states
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(25)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // UI states
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [comparisonMode, setComparisonMode] = useState(false)
  
  const toastTimer = useRef<number | null>(null)
  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message: msg, type })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])

  // =====================
  // COMPUTED
  // =====================
  const companyById = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const extraCompanyId = useMemo(() => {
    for (const c of companies) {
      const code = (c.code || '').toLowerCase()
      if (code === 'extra' || c.name?.toLowerCase().includes('extra')) return c.id
    }
    return null
  }, [companies])

  const companyName = useCallback((id: string) => companyById.get(id)?.name ?? 'Неизвестно', [companyById])

  // =====================
  // PRESETS
  // =====================
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
      case 'last90':
        from = addDaysISO(today, -89)
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
      case 'currentQuarter': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth()
        const qStart = Math.floor(m / 3) * 3
        from = toISODateLocal(new Date(y, qStart, 1))
        to = toISODateLocal(new Date(y, qStart + 3, 0))
        break
      }
      case 'prevQuarter': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth()
        const qStart = Math.floor(m / 3) * 3 - 3
        from = toISODateLocal(new Date(y, qStart, 1))
        to = toISODateLocal(new Date(y, qStart + 3, 0))
        break
      }
      case 'currentYear': {
        const y = todayDate.getFullYear()
        from = `${y}-01-01`
        to = `${y}-12-31`
        break
      }
      case 'prevYear': {
        const y = todayDate.getFullYear() - 1
        from = `${y}-01-01`
        to = `${y}-12-31`
        break
      }
      case 'custom':
        return
    }

    setDateFrom(from)
    setDateTo(to)
  }, [])

  const handlePresetChange = useCallback((value: DatePreset) => {
    setDatePreset(value)
    if (value !== 'custom') applyPreset(value)
  }, [applyPreset])

  const resetFilters = useCallback(() => {
    setDatePreset('last7')
    applyPreset('last7')
    setCompanyFilter('all')
    setShiftFilter('all')
    setGroupMode('day')
    setIncludeExtraInTotals(false)
    setMinAmountFilter('')
    setMaxAmountFilter('')
    setSearchQuery('')
    setSortField('date')
    setSortDirection('desc')
    setCurrentPage(1)
    setActiveTab('overview')
    showToast('Фильтры сброшены', 'success')
  }, [applyPreset, showToast])

  // =====================
  // DATA LOADING ← ИСПРАВЛЕНО: добавлен online_amount в select
  // =====================
// =====================
// DATA LOADING
// =====================
useEffect(() => {
  let alive = true
  const loadCompanies = async () => {
    setError(null)
    const { data, error } = await supabase
      .from('companies')
      .select('id,name,code,address')
      .order('name')
    
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
  return () => { alive = false }
}, [])

// Загрузка incomes/expenses - ТОЛЬКО после загрузки компаний
useEffect(() => {
  if (!companiesLoaded || companies.length === 0) return
  
  const myReqId = ++reqIdRef.current
  
  const loadData = async () => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)

      let incomeQuery = supabase
        .from('incomes')
        .select('id,date,company_id,shift,zone,cash_amount,kaspi_amount,online_amount,card_amount,created_at')
        .gte('date', prevFrom)
        .lte('date', dateTo)

      let expenseQuery = supabase
        .from('expenses')
        .select('id,date,company_id,category,cash_amount,kaspi_amount,description,created_at')
        .gte('date', prevFrom)
        .lte('date', dateTo)

      if (companyFilter !== 'all') {
        incomeQuery = incomeQuery.eq('company_id', companyFilter)
        expenseQuery = expenseQuery.eq('company_id', companyFilter)
      } else if (!includeExtraInTotals && extraCompanyId) {
        incomeQuery = incomeQuery.neq('company_id', extraCompanyId)
        expenseQuery = expenseQuery.neq('company_id', extraCompanyId)
      }

      if (shiftFilter !== 'all') {
        incomeQuery = incomeQuery.eq('shift', shiftFilter)
      }

      const [incomeResult, expenseResult] = await Promise.all([
        incomeQuery.order('date', { ascending: false }),
        expenseQuery.order('date', { ascending: false })
      ])

      if (myReqId !== reqIdRef.current) return
      if (incomeResult.error) throw incomeResult.error
      if (expenseResult.error) throw expenseResult.error

      setIncomes(incomeResult.data || [])
      setExpenses(expenseResult.data || [])
      
      if (isRefresh) showToast('Данные обновлены', 'success')
    } catch (err) {
      if (myReqId === reqIdRef.current) {
        setError('Ошибка загрузки данных')
        showToast('Ошибка загрузки данных', 'error')
        console.error(err)
      }
    } finally {
      if (myReqId === reqIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }
  
  loadData()
  
}, [companiesLoaded, companies.length, dateFrom, dateTo, companyFilter, shiftFilter, includeExtraInTotals, extraCompanyId])
  useEffect(() => {
    loadData()
  }, [loadData])

  // =====================
  // URL SYNC
  // =====================
  useEffect(() => {
    if (didInitFromUrl.current || !companiesLoaded) return

    const sp = searchParams
    const pFrom = sp.get('from')
    const pTo = sp.get('to')
    const pPreset = sp.get('preset') as DatePreset | null
    const pCompany = sp.get('company')
    const pShift = sp.get('shift') as Shift | 'all' | null
    const pGroup = parseGroup(sp.get('group'))
    const pExtra = parseBool(sp.get('extra'))
    const pTab = parseTab(sp.get('tab'))

    if (pFrom && isISODate(pFrom)) setDateFrom(pFrom)
    if (pTo && isISODate(pTo)) setDateTo(pTo)

    if (pPreset && PRESET_LABELS[pPreset]) {
      setDatePreset(pPreset)
      if (pPreset !== 'custom' && !pFrom && !pTo) applyPreset(pPreset)
    }

    if (pCompany) {
      if (pCompany === 'all') setCompanyFilter('all')
      else if (companies.some((c) => c.id === pCompany)) setCompanyFilter(pCompany)
    }

    if (pShift && (pShift === 'all' || pShift === 'day' || pShift === 'night')) {
      setShiftFilter(pShift)
    }

    if (pGroup) setGroupMode(pGroup)
    if (pExtra) setIncludeExtraInTotals(true)
    if (pTab) setActiveTab(pTab)

    didInitFromUrl.current = true
  }, [companiesLoaded, companies, searchParams, applyPreset])

  useEffect(() => {
    if (!didInitFromUrl.current) return

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('from', dateFrom)
      params.set('to', dateTo)
      params.set('preset', datePreset)
      params.set('company', companyFilter)
      params.set('shift', shiftFilter)
      params.set('group', groupMode)
      params.set('extra', includeExtraInTotals ? '1' : '0')
      params.set('tab', activeTab)

      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [dateFrom, dateTo, datePreset, companyFilter, shiftFilter, groupMode, includeExtraInTotals, activeTab, pathname, router])

  // =====================
  // DATA PROCESSING ← ИСПРАВЛЕНО: учитываем online_amount
  // =====================
  const processed = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const totalsCur = baseTotals()
    const totalsPrev = baseTotals()

    const expenseByCategoryMap = new Map<string, number>()
    const incomeByCompanyMap = new Map<string, { 
      companyId: string; 
      name: string; 
      value: number; 
      cash: number; 
      kaspi: number; 
      online: number;      // ← ДОБАВЛЕНО
      card: number;        // ← ДОБАВЛЕНО
      count: number 
    }>()
    const chartDataMap = new Map<string, TimeAggregation>()
    const anomalies: Anomaly[] = []
    const companyStats = new Map<string, { 
      income: number, expense: number, profit: number, 
      cashIncome: number, kaspiIncome: number, onlineIncome: number, cardIncome: number,  // ← ДОБАВЛЕНО
      cashExpense: number, kaspiExpense: number,
      transactions: number 
    }>()

    const dailyIncome = new Map<string, number>()
    const dailyExpense = new Map<string, number>()

    const getRangeBucket = (iso: string) => {
      if (iso >= dateFrom && iso <= dateTo) return 'current'
      if (iso >= prevFrom && iso <= prevTo) return 'previous'
      return null
    }

    const getKey = (iso: string) => {
      if (groupMode === 'day') return { key: iso, label: iso.slice(5), sortISO: iso }
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
      const b = chartDataMap.get(key) || {
        label, sortISO, income: 0, expense: 0, profit: 0,
        incomeCash: 0, incomeKaspi: 0, incomeOnline: 0, incomeCard: 0, incomeNonCash: 0,  // ← ДОБАВЛЕНО
        expenseCash: 0, expenseKaspi: 0, count: 0
      }
      chartDataMap.set(key, b)
      return b
    }

    // Process incomes ← ИСПРАВЛЕНО: добавлен online_amount
    for (const r of incomes) {
      const range = getRangeBucket(r.date)
      if (!range) continue

      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const online = safeNumber(r.online_amount)      // ← ДОБАВЛЕНО
      const card = safeNumber(r.card_amount)
      const nonCash = kaspi + online + card           // ← ИСПРАВЛЕНО: включаем online
      const total = cash + nonCash
      
      if (total <= 0 && cash === 0 && kaspi === 0 && online === 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.incomeCash += cash
      tgt.incomeKaspi += kaspi
      tgt.incomeOnline += online                      // ← ДОБАВЛЕНО
      tgt.incomeCard += card                          // ← ДОБАВЛЕНО
      tgt.incomeNonCash += nonCash
      tgt.totalIncome += total
      tgt.transactionCount += 1

      if (range === 'current') {
        dailyIncome.set(r.date, (dailyIncome.get(r.date) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)
        bucket.income += total
        bucket.incomeCash += cash
        bucket.incomeKaspi += kaspi
        bucket.incomeOnline += online                 // ← ДОБАВЛЕНО
        bucket.incomeCard += card                     // ← ДОБАВЛЕНО
        bucket.incomeNonCash += nonCash
        bucket.count += 1

        // Company stats
        const existing = incomeByCompanyMap.get(r.company_id)
        if (!existing) {
          incomeByCompanyMap.set(r.company_id, {
            companyId: r.company_id,
            name: companyName(r.company_id),
            value: total, cash, kaspi, online, card, count: 1  // ← ДОБАВЛЕНО
          })
        } else {
          existing.value += total
          existing.cash += cash
          existing.kaspi += kaspi
          existing.online += online                     // ← ДОБАВЛЕНО
          existing.card += card                         // ← ДОБАВЛЕНО
          existing.count += 1
        }

        // Detailed company stats
        const cs = companyStats.get(r.company_id) || { 
          income: 0, expense: 0, profit: 0,
          cashIncome: 0, kaspiIncome: 0, onlineIncome: 0, cardIncome: 0,  // ← ДОБАВЛЕНО
          cashExpense: 0, kaspiExpense: 0,
          transactions: 0
        }
        cs.income += total
        cs.cashIncome += cash
        cs.kaspiIncome += kaspi
        cs.onlineIncome += online                     // ← ДОБАВЛЕНО
        cs.cardIncome += card                         // ← ДОБАВЛЕНО
        cs.transactions += 1
        companyStats.set(r.company_id, cs)
      }
    }

    // Process expenses
    for (const r of expenses) {
      const range = getRangeBucket(r.date)
      if (!range) continue

      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi
      
      if (total <= 0 && cash === 0 && kaspi === 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.expenseCash += cash
      tgt.expenseKaspi += kaspi
      tgt.totalExpense += total
      tgt.transactionCount += 1

      if (range === 'current') {
        dailyExpense.set(r.date, (dailyExpense.get(r.date) || 0) + total)

        const category = r.category || 'Без категории'
        expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)
        bucket.expense += total
        bucket.expenseCash += cash
        bucket.expenseKaspi += kaspi

        // Company stats
        const cs = companyStats.get(r.company_id) || { 
          income: 0, expense: 0, profit: 0,
          cashIncome: 0, kaspiIncome: 0, onlineIncome: 0, cardIncome: 0,  // ← ДОБАВЛЕНО
          cashExpense: 0, kaspiExpense: 0,
          transactions: 0
        }
        cs.expense += total
        cs.cashExpense += cash
        cs.kaspiExpense += kaspi
        companyStats.set(r.company_id, cs)
      }
    }

    // Finalize totals
    const finalize = (t: FinancialTotals) => {
      t.profit = t.totalIncome - t.totalExpense
      t.remainingCash = t.incomeCash - t.expenseCash
      t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
      t.totalBalance = t.profit
      t.avgTransaction = t.transactionCount > 0 ? t.totalIncome / t.transactionCount : 0
      return t
    }

    finalize(totalsCur)
    finalize(totalsPrev)

    // Calculate company profits
    for (const [id, stats] of companyStats) {
      stats.profit = stats.income - stats.expense
    }

    // Anomaly detection
    const avgIncome = totalsCur.totalIncome / (dailyIncome.size || 1)
    const avgExpense = totalsCur.totalExpense / (dailyExpense.size || 1)

    for (const [date, amount] of dailyIncome) {
      if (amount > avgIncome * 2.5) {
        anomalies.push({ 
          type: 'income_spike', date, 
          description: `Всплеск выручки: ${formatMoneyFull(amount)}`, 
          severity: 'medium', value: amount 
        })
      }
    }
    
    for (const [date, amount] of dailyExpense) {
      if (amount > avgExpense * 2.5) {
        anomalies.push({ 
          type: 'expense_spike', date, 
          description: `Аномальный расход: ${formatMoneyFull(amount)}`, 
          severity: 'high', value: amount 
        })
      }
    }

    for (const agg of chartDataMap.values()) {
      agg.profit = agg.income - agg.expense
      if (agg.income > 0) {
        const margin = agg.profit / agg.income
        if (margin < 0.05) {
          anomalies.push({ 
            type: 'low_profit', date: agg.label, 
            description: `Критически низкая маржа: ${(margin * 100).toFixed(1)}%`, 
            severity: 'critical', value: agg.profit 
          })
        } else if (margin < 0.15) {
          anomalies.push({ 
            type: 'low_profit', date: agg.label, 
            description: `Низкая маржа: ${(margin * 100).toFixed(1)}%`, 
            severity: 'medium', value: agg.profit 
          })
        }
      }
    }

    // Cash ratio check
    if (totalsCur.totalIncome > 0) {
      const cashRatio = totalsCur.incomeCash / totalsCur.totalIncome
      if (cashRatio > 0.8) {
        anomalies.push({
          type: 'high_cash_ratio',
          date: dateTo,
          description: `Высокая доля наличных: ${(cashRatio * 100).toFixed(0)}%`,
          severity: 'low',
          value: cashRatio
        })
      }
    }

    return { 
      totalsCur, totalsPrev, chartDataMap, expenseByCategoryMap, 
      incomeByCompanyMap, anomalies, companyStats, prevFrom, prevTo,
      dailyIncome, dailyExpense
    }
  }, [incomes, expenses, dateFrom, dateTo, groupMode, companyName])

  const totals = processed.totalsCur
  const totalsPrev = processed.totalsPrev
  const dailyIncome = processed.dailyIncome
  const dailyExpense = processed.dailyExpense

  const chartData = useMemo(() => 
    Array.from(processed.chartDataMap.values())
      .sort((a, b) => a.sortISO.localeCompare(b.sortISO)),
    [processed.chartDataMap]
  )

  const expenseByCategoryData = useMemo(() =>
    Array.from(processed.expenseByCategoryMap.entries())
      .map(([name, amount]) => ({ name, amount, percentage: 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((item, _, arr) => ({
        ...item,
        percentage: totals.totalExpense > 0 ? (item.amount / totals.totalExpense) * 100 : 0
      })),
    [processed.expenseByCategoryMap, totals.totalExpense]
  )

  const incomeByCompanyData = useMemo(() =>
    Array.from(processed.incomeByCompanyMap.values())
      .map((x, idx) => ({ 
        ...x, 
        fill: PIE_COLORS[idx % PIE_COLORS.length],
        percentage: totals.totalIncome > 0 ? (x.value / totals.totalIncome) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value),
    [processed.incomeByCompanyMap, totals.totalIncome]
  )

  const companyComparisonData = useMemo(() => 
    Array.from(processed.companyStats.entries())
      .map(([id, stats]) => ({
        id,
        name: companyName(id),
        ...stats,
        margin: stats.income > 0 ? (stats.profit / stats.income) * 100 : 0
      }))
      .sort((a, b) => b.income - a.income),
    [processed.companyStats, companyName]
  )

  // =====================
  // DETAILED ROWS ← ИСПРАВЛЕНО: добавлен online_amount
  // =====================
  const detailedRows = useMemo((): DetailedRow[] => {
    const rows: DetailedRow[] = []
    
    for (const r of incomes) {
      if (r.date < dateFrom || r.date > dateTo) continue
      
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const online = safeNumber(r.online_amount)    // ← ДОБАВЛЕНО
      const card = safeNumber(r.card_amount)
      const total = cash + kaspi + online + card    // ← ИСПРАВЛЕНО
      
      if (total === 0) continue

      // Apply amount filters
      const min = minAmountFilter ? parseFloat(minAmountFilter) : 0
      const max = maxAmountFilter ? parseFloat(maxAmountFilter) : Infinity
      if (total < min || total > max) continue

      rows.push({
        id: r.id,
        date: r.date,
        type: 'income',
        companyId: r.company_id,
        companyName: companyName(r.company_id),
        amount: total,
        cashAmount: cash,
        kaspiAmount: kaspi,
        onlineAmount: online,                         // ← ДОБАВЛЕНО
        cardAmount: card,                             // ← ДОБАВЛЕНО
        shift: r.shift,
        zone: r.zone,
      })
    }

    for (const r of expenses) {
      if (r.date < dateFrom || r.date > dateTo) continue
      
      const cash = safeNumber(r.cash_amount)
      const kaspi = safeNumber(r.kaspi_amount)
      const total = cash + kaspi
      
      if (total === 0) continue

      const min = minAmountFilter ? parseFloat(minAmountFilter) : 0
      const max = maxAmountFilter ? parseFloat(maxAmountFilter) : Infinity
      if (total < min || total > max) continue

      rows.push({
        id: r.id,
        date: r.date,
        type: 'expense',
        companyId: r.company_id,
        companyName: companyName(r.company_id),
        amount: total,
        cashAmount: cash,
        kaspiAmount: kaspi,
        category: r.category || 'Без категории',
        description: r.description,
      })
    }

    return rows
  }, [incomes, expenses, dateFrom, dateTo, companyName, minAmountFilter, maxAmountFilter])

  const filteredRows = useMemo(() => {
    let result = [...detailedRows]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(r => 
        r.companyName.toLowerCase().includes(q) ||
        r.date.includes(q) ||
        (r.category && r.category.toLowerCase().includes(q)) ||
        (r.zone && r.zone.toLowerCase().includes(q)) ||
        String(r.amount).includes(q)
      )
    }

    result.sort((a, b) => {
      let aVal: string | number = ''
      let bVal: string | number = ''

      switch (sortField) {
        case 'date':
          aVal = a.date + (a.type === 'income' ? '1' : '2')
          bVal = b.date + (b.type === 'income' ? '1' : '2')
          break
        case 'company':
          aVal = a.companyName
          bVal = b.companyName
          break
        case 'amount':
          aVal = a.amount
          bVal = b.amount
          break
        case 'category':
          aVal = a.category || a.shift || ''
          bVal = b.category || b.shift || ''
          break
        case 'shift':
          aVal = a.shift || ''
          bVal = b.shift || ''
          break
        case 'zone':
          aVal = a.zone || ''
          bVal = b.zone || ''
          break
      }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(String(bVal))
        return sortDirection === 'asc' ? cmp : -cmp
      }
      
      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
    })

    return result
  }, [detailedRows, searchQuery, sortField, sortDirection])

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredRows.slice(start, start + itemsPerPage)
  }, [filteredRows, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredRows.length / itemsPerPage)

  // =====================
  // AI INSIGHTS
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0

    if (profitMargin < 10) {
      insights.push({ 
        type: 'danger', 
        title: 'Критически низкая маржинальность', 
        description: `Маржа ${profitMargin.toFixed(1)}% требует немедленного внимания. Проверьте операционные расходы.`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (profitMargin < 20) {
      insights.push({ 
        type: 'warning', 
        title: 'Низкая маржинальность', 
        description: `Маржа ${profitMargin.toFixed(1)}% ниже рекомендуемой нормы (25-35%).`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (profitMargin > 40) {
      insights.push({ 
        type: 'success', 
        title: 'Отличная маржа', 
        description: `Маржа ${profitMargin.toFixed(1)}% — значительно выше среднерыночной.`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: 'up'
      })
    }

    const cashRatio = totals.totalIncome > 0 ? totals.incomeCash / totals.totalIncome : 0
    if (cashRatio < 0.2) {
      insights.push({ 
        type: 'opportunity', 
        title: 'Высокая доля безнала', 
        description: 'Рассмотрите стимулирование наличных платежей (скидки/бонусы).',
        metric: `${((1 - cashRatio) * 100).toFixed(0)}% безнал`,
        trend: 'neutral'
      })
    }

    const topExpense = expenseByCategoryData[0]
    if (topExpense && totals.totalExpense > 0) {
      const share = (topExpense.amount / totals.totalExpense) * 100
      if (share > 50) {
        insights.push({ 
          type: 'warning', 
          title: 'Критическая концентрация расходов', 
          description: `"${topExpense.name}" составляет ${share.toFixed(0)}% всех расходов.`,
          metric: `${share.toFixed(0)}%`,
          trend: 'down'
        })
      } else if (share > 30) {
        insights.push({ 
          type: 'info', 
          title: 'Высокая концентрация расходов', 
          description: `"${topExpense.name}" — ${share.toFixed(0)}% расходов.`,
          metric: `${share.toFixed(0)}%`
        })
      }
    }

    if (totalsPrev.totalIncome > 0) {
      const incomeChange = ((totals.totalIncome - totalsPrev.totalIncome) / totalsPrev.totalIncome) * 100
      if (Math.abs(incomeChange) > 15) {
        insights.push({
          type: incomeChange > 0 ? 'success' : 'warning',
          title: incomeChange > 0 ? 'Значительный рост выручки' : 'Падение выручки',
          description: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}% к прошлому периоду`,
          metric: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}%`,
          trend: incomeChange > 0 ? 'up' : 'down'
        })
      }
    }

    const critical = processed.anomalies.filter((a) => a.severity === 'critical').length
    const high = processed.anomalies.filter((a) => a.severity === 'high').length
    
    if (critical > 0) {
      insights.push({ 
        type: 'danger', 
        title: 'Критические аномалии', 
        description: 'Требуется немедленная проверка данных и операций.',
        metric: `${critical} крит.`,
        trend: 'down'
      })
    } else if (high > 0) {
      insights.push({ 
        type: 'warning', 
        title: 'Выявлены риски', 
        description: 'Обнаружены аномалии, требующие внимания.',
        metric: `${high} высок.`
      })
    }

    if (totals.transactionCount > 0 && totals.avgTransaction < 5000) {
      insights.push({
        type: 'info',
        title: 'Низкий средний чек',
        description: `Средняя транзакция ${formatMoneyFull(totals.avgTransaction)}. Возможен апселл.`,
        metric: formatMoneyFull(totals.avgTransaction)
      })
    }

    return insights.slice(0, 5)
  }, [totals, totalsPrev, expenseByCategoryData, processed.anomalies])

  // =====================
  // FORECAST
  // =====================
  const forecast = useMemo(() => {
    if (!['currentMonth', 'currentQuarter', 'currentYear'].includes(datePreset)) return null
    
    const startDate = fromISO(dateFrom)
    const today = new Date()
    const lastDay = fromISO(dateTo)
    
    const daysPassed = Math.max(1, Math.floor((today.getTime() - startDate.getTime()) / 86400000) + 1)
    const totalDays = Math.floor((lastDay.getTime() - startDate.getTime()) / 86400000) + 1
    const remainingDays = Math.max(0, totalDays - daysPassed)
    
    if (remainingDays <= 0) return null

    const avgIncome = totals.totalIncome / daysPassed
    const avgExpense = totals.totalExpense / daysPassed
    const avgProfit = totals.profit / daysPassed

    return {
      remainingDays,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remainingDays),
      forecastExpense: Math.round(totals.totalExpense + avgExpense * remainingDays),
      forecastProfit: Math.round(totals.profit + avgProfit * remainingDays),
      confidence: Math.min(95, Math.max(50, 60 + (daysPassed / totalDays) * 40)),
    }
  }, [datePreset, dateFrom, dateTo, totals])

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

  const handleDownloadCSV = useCallback(() => {
    const rows: string[][] = []
    const companyLabel = companyFilter === 'all'
      ? (includeExtraInTotals ? 'Все компании (включая Extra)' : 'Все компании (без Extra)')
      : companyName(companyFilter)

    rows.push(['ФИНАНСОВЫЙ ОТЧЕТ'])
    rows.push(['Сгенерирован', new Date().toLocaleString('ru-RU')])
    rows.push(['Период', `${dateFrom} — ${dateTo}`])
    rows.push(['Компания', companyLabel])
    rows.push(['Группировка', groupMode])
    rows.push([''])

    rows.push(['СВОДНЫЕ ПОКАЗАТЕЛИ'])
    rows.push(['Показатель', 'Текущий период', 'Прошлый период', 'Изменение'])
    rows.push(['Выручка', String(Math.round(totals.totalIncome)), String(Math.round(totalsPrev.totalIncome)), getPercentageChange(totals.totalIncome, totalsPrev.totalIncome)])
    rows.push(['Расходы', String(Math.round(totals.totalExpense)), String(Math.round(totalsPrev.totalExpense)), getPercentageChange(totals.totalExpense, totalsPrev.totalExpense)])
    rows.push(['Прибыль', String(Math.round(totals.profit)), String(Math.round(totalsPrev.profit)), getPercentageChange(totals.profit, totalsPrev.profit)])
    rows.push(['Наличные (доход)', String(Math.round(totals.incomeCash)), String(Math.round(totalsPrev.incomeCash)), getPercentageChange(totals.incomeCash, totalsPrev.incomeCash)])
    rows.push(['Kaspi (доход)', String(Math.round(totals.incomeKaspi)), String(Math.round(totalsPrev.incomeKaspi)), getPercentageChange(totals.incomeKaspi, totalsPrev.incomeKaspi)])
    rows.push(['Online (доход)', String(Math.round(totals.incomeOnline)), String(Math.round(totalsPrev.incomeOnline)), getPercentageChange(totals.incomeOnline, totalsPrev.incomeOnline)])  // ← ДОБАВЛЕНО
    rows.push(['Card (доход)', String(Math.round(totals.incomeCard)), String(Math.round(totalsPrev.incomeCard)), getPercentageChange(totals.incomeCard, totalsPrev.incomeCard)])          // ← ДОБАВЛЕНО
    rows.push(['Безнал (доход)', String(Math.round(totals.incomeNonCash)), String(Math.round(totalsPrev.incomeNonCash)), getPercentageChange(totals.incomeNonCash, totalsPrev.incomeNonCash)])
    rows.push([''])

    rows.push(['ДОХОДЫ ПО КОМПАНИЯМ'])
    rows.push(['Компания', 'Выручка', 'Наличные', 'Kaspi', 'Online', 'Card', 'Транзакций'])  // ← ИСПРАВЛЕНО
    for (const c of incomeByCompanyData) {
      rows.push([c.name, String(Math.round(c.value)), String(Math.round(c.cash)), String(Math.round(c.kaspi)), String(Math.round(c.online)), String(Math.round(c.card)), String(c.count)])  // ← ИСПРАВЛЕНО
    }
    rows.push([''])

    rows.push(['РАСХОДЫ ПО КАТЕГОРИЯМ'])
    rows.push(['Категория', 'Сумма', '% от общих'])
    for (const c of expenseByCategoryData) {
      rows.push([c.name, String(Math.round(c.amount)), c.percentage.toFixed(1)])
    }
    rows.push([''])

    rows.push(['ДЕТАЛЬНЫЕ ОПЕРАЦИИ'])
    rows.push(['Дата', 'Тип', 'Компания', 'Категория/Смена', 'Сумма', 'Наличные', 'Kaspi', 'Online', 'Card', 'Зона/Описание'])  // ← ИСПРАВЛЕНО
    for (const r of filteredRows) {
      const typeLabel = r.type === 'income' ? 'Доход' : 'Расход'
      const category = r.category || r.shift || ''
      const online = r.type === 'income' ? (r.onlineAmount || 0) : 0    // ← ДОБАВЛЕНО
      const card = r.type === 'income' ? (r.cardAmount || 0) : 0        // ← ДОБАВЛЕНО
      const zoneDesc = r.zone || r.description || ''
      rows.push([r.date, typeLabel, r.companyName, category, String(Math.round(r.amount)), String(Math.round(r.cashAmount)), String(Math.round(r.kaspiAmount)), String(Math.round(online)), String(Math.round(card)), zoneDesc])  // ← ИСПРАВЛЕНО
    }

    downloadTextFile(`financial_report_${dateFrom}_${dateTo}.csv`, toCSV(rows, ';'))
    showToast('CSV отчет скачан', 'success')
  }, [companyFilter, includeExtraInTotals, companyName, dateFrom, dateTo, groupMode, totals, totalsPrev, incomeByCompanyData, expenseByCategoryData, filteredRows, showToast])

  const handleDownloadExcel = useCallback(() => {
    const companyLabel = companyFilter === 'all'
      ? (includeExtraInTotals ? 'Все компании' : 'Все компании (без Extra)')
      : companyName(companyFilter)

    // Summary sheet
    const summaryHeaders = ['Показатель', 'Текущий период', 'Прошлый период', 'Изменение %']
    const summaryRows = [
      ['Выручка', totals.totalIncome, totalsPrev.totalIncome, parseFloat(getPercentageChange(totals.totalIncome, totalsPrev.totalIncome)) || 0],
      ['Расходы', totals.totalExpense, totalsPrev.totalExpense, parseFloat(getPercentageChange(totals.totalExpense, totalsPrev.totalExpense)) || 0],
      ['Прибыль', totals.profit, totalsPrev.profit, parseFloat(getPercentageChange(totals.profit, totalsPrev.profit)) || 0],
      ['Маржа %', totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0, 0, 0],
      ['Наличные (доход)', totals.incomeCash, totalsPrev.incomeCash, 0],
      ['Kaspi (доход)', totals.incomeKaspi, totalsPrev.incomeKaspi, 0],
      ['Online (доход)', totals.incomeOnline, totalsPrev.incomeOnline, 0],        // ← ДОБАВЛЕНО
      ['Card (доход)', totals.incomeCard, totalsPrev.incomeCard, 0],              // ← ДОБАВЛЕНО
      ['Безналичные (доход)', totals.incomeNonCash, totalsPrev.incomeNonCash, 0],
      ['Наличные (расход)', totals.expenseCash, totalsPrev.expenseCash, 0],
      ['Kaspi (расход)', totals.expenseKaspi, totalsPrev.expenseKaspi, 0],
    ]

    const xml = generateExcelXML('Сводка', summaryHeaders, summaryRows)
    downloadTextFile(`report_${dateFrom}_${dateTo}.xls`, xml, 'application/vnd.ms-excel')
    showToast('Excel файл скачан', 'success')
  }, [companyFilter, includeExtraInTotals, companyName, dateFrom, dateTo, totals, totalsPrev, showToast])

  const handleSort = useCallback((field: SortField) => {
    setSortDirection(current => sortField === field ? (current === 'asc' ? 'desc' : 'asc') : 'desc')
    setSortField(field)
    setCurrentPage(1)
  }, [sortField])

  const toggleRowSelection = useCallback((id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAllRows = useCallback(() => {
    if (selectedRows.size === paginatedRows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(paginatedRows.map(r => r.id)))
    }
  }, [paginatedRows, selectedRows.size])

  // =====================
  // RENDER HELPERS
  // =====================
  const ChartShell = ({ children, className = '', height = 'h-80' }: { children: React.ReactNode; className?: string; height?: string }) => (
    <div className={`min-w-0 ${height} min-h-[320px] ${className}`}>
      {mounted ? children : <div className="h-full w-full rounded-xl bg-gray-800/40 border border-white/5 animate-pulse" />}
    </div>
  )

  const StatCard = ({ title, value, subValue, icon: Icon, trend, color = 'blue', onClick }: any) => {
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
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${trend > 0 ? 'bg-emerald-500/20 text-emerald-400' : trend < 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-gray-500/20 text-gray-400'}`}>
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
  }

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
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Ошибка загрузки</h2>
            <p className="text-gray-400 max-w-md">{error}</p>
            <Button onClick={() => loadData(true)} variant="outline" className="border-white/10">
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
        <div className="p-4 lg:p-8 max-w-[1800px] mx-auto space-y-6">
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
                  <BarChart3 className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    AI Финансовая Аналитика
                  </h1>
                  <p className="text-gray-400 mt-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatDateRange(dateFrom, dateTo)}
                    {comparisonMode && <span className="text-violet-400">(сравнение с прошлым периодом)</span>}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-2xl p-1 border border-white/10">
                  {(['overview', 'analytics', 'details', 'companies'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 lg:px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        activeTab === tab ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {tab === 'overview' && 'Обзор'}
                      {tab === 'analytics' && 'Аналитика'}
                      {tab === 'details' && 'Детали'}
                      {tab === 'companies' && 'Компании'}
                    </button>
                  ))}
                </div>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${comparisonMode ? 'bg-violet-500/20 text-violet-400 border-violet-500/50' : ''}`}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  title="Режим сравнения"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>

                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
                  onClick={() => loadData(true)}
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
                    <button onClick={handleDownloadExcel} className="w-full px-4 py-2 text-left text-sm hover:bg-white/5 flex items-center gap-2">
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

          {/* AI Insights */}
          {aiInsights.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {aiInsights.map((insight, idx) => (
                <div 
                  key={idx} 
                  className={`relative overflow-hidden rounded-2xl border p-4 ${
                    insight.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20' :
                    insight.type === 'warning' ? 'bg-amber-500/5 border-amber-500/20' :
                    insight.type === 'danger' ? 'bg-rose-500/5 border-rose-500/20' :
                    insight.type === 'opportunity' ? 'bg-blue-500/5 border-blue-500/20' :
                    'bg-gray-800/30 border-white/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      insight.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                      insight.type === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                      insight.type === 'danger' ? 'bg-rose-500/20 text-rose-400' :
                      insight.type === 'opportunity' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-700/50 text-gray-400'
                    }`}>
                      {insight.type === 'success' ? <TrendingUp className="w-4 h-4" /> :
                       insight.type === 'danger' ? <AlertTriangle className="w-4 h-4" /> :
                       insight.type === 'warning' ? <AlertTriangle className="w-4 h-4" /> :
                       insight.type === 'opportunity' ? <Lightbulb className="w-4 h-4" /> :
                       <Activity className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1">{insight.title}</p>
                      <p className="text-xs text-gray-400 line-clamp-2">{insight.description}</p>
                      {insight.metric && (
                        <p className={`text-lg font-bold mt-2 ${
                          insight.type === 'success' ? 'text-emerald-400' :
                          insight.type === 'danger' ? 'text-rose-400' :
                          insight.type === 'warning' ? 'text-amber-400' :
                          insight.type === 'opportunity' ? 'text-blue-400' :
                          'text-white'
                        }`}>{insight.metric}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filters Bar */}
          <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Быстрые фильтры:</span>
              </div>
              
              <select 
                value={datePreset}
                onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
                className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                {Object.entries(PRESET_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>

              <input 
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setDatePreset('custom')
                }}
                className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
              />
              <span className="text-gray-500">—</span>
              <input 
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setDatePreset('custom')
                }}
                className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
              />

              <select 
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все компании</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select 
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
                className="bg-gray-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="day">По дням</option>
                <option value="week">По неделям</option>
                <option value="month">По месяцам</option>
                <option value="year">По годам</option>
              </select>

              <button 
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/50 border border-white/10 text-sm hover:bg-gray-700/50 transition-colors"
              >
                <Filter className="w-4 h-4" />
                Расширенные
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>

              <button 
                onClick={resetFilters}
                className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                title="Сбросить фильтры"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {showFilters && (
              <div className="pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Смена</label>
                  <select 
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as any)}
                    className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="all">Все смены</option>
                    <option value="day">День</option>
                    <option value="night">Ночь</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Сумма от</label>
                  <Input 
                    type="number"
                    placeholder="0"
                    value={minAmountFilter}
                    onChange={(e) => setMinAmountFilter(e.target.value)}
                    className="bg-gray-800/50 border-white/10"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Сумма до</label>
                  <Input 
                    type="number"
                    placeholder="∞"
                    value={maxAmountFilter}
                    onChange={(e) => setMaxAmountFilter(e.target.value)}
                    className="bg-gray-800/50 border-white/10"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={includeExtraInTotals}
                      onChange={(e) => setIncludeExtraInTotals(e.target.checked)}
                      className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                    />
                    <span className="text-sm text-gray-300">Включить F16 Extra</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Forecast Banner */}
          {forecast && (
            <div className="rounded-2xl bg-gradient-to-r from-blue-600/20 to-violet-600/20 border border-blue-500/20 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-blue-200">Прогноз на конец периода (точность {forecast.confidence.toFixed(0)}%)</p>
                  <div className="flex items-center gap-6 mt-1">
                    <span className="text-lg font-semibold text-white">
                      Выручка: <span className="text-emerald-400">{formatMoneyFull(forecast.forecastIncome)}</span>
                    </span>
                    <span className="text-lg font-semibold text-white">
                      Прибыль: <span className={forecast.forecastProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {formatMoneyFull(forecast.forecastProfit)}
                      </span>
                    </span>
                    <span className="text-sm text-gray-400">Осталось {forecast.remainingDays} дн.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard 
                  title="Общая выручка"
                  value={formatMoneyFull(totals.totalIncome)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totalsPrev.totalIncome)}` : `${formatMoneyCompact(totals.incomeCash)} нал / ${formatMoneyCompact(totals.incomeNonCash)} безнал`}
                  icon={DollarSign}
                  trend={totalsPrev.totalIncome > 0 ? Number(((totals.totalIncome - totalsPrev.totalIncome) / totalsPrev.totalIncome * 100).toFixed(1)) : undefined}
                  color="green"
                />
                <StatCard 
                  title="Расходы"
                  value={formatMoneyFull(totals.totalExpense)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totalsPrev.totalExpense)}` : `${formatMoneyCompact(totals.expenseCash)} нал / ${formatMoneyCompact(totals.expenseKaspi)} Kaspi`}
                  icon={TrendingDown}
                  trend={totalsPrev.totalExpense > 0 ? Number(((totals.totalExpense - totalsPrev.totalExpense) / totalsPrev.totalExpense * 100).toFixed(1)) : undefined}
                  color="red"
                />
                <StatCard 
                  title="Чистая прибыль"
                  value={formatMoneyFull(totals.profit)}
                  subValue={comparisonMode ? `было ${formatMoneyFull(totalsPrev.profit)}` : `Маржа ${totals.totalIncome > 0 ? (totals.profit / totals.totalIncome * 100).toFixed(1) : 0}%`}
                  icon={Wallet}
                  trend={totalsPrev.profit !== 0 ? Number(((totals.profit - totalsPrev.profit) / Math.abs(totalsPrev.profit) * 100).toFixed(1)) : undefined}
                  color={totals.profit >= 0 ? 'blue' : 'red'}
                />
                <StatCard 
                  title="Остаток средств"
                  value={formatMoneyFull(totals.totalBalance)}
                  subValue={`Нал: ${formatMoneyCompact(totals.remainingCash)} | Безнал: ${formatMoneyCompact(totals.remainingKaspi)}`}
                  icon={Building2}
                  color="violet"
                />
              </div>

              {/* Payment Types Breakdown */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
                  <p className="text-xs text-gray-500 mb-1">Наличные</p>
                  <p className="text-xl font-bold text-emerald-400">{formatMoneyFull(totals.incomeCash)}</p>
                  <p className="text-xs text-gray-500 mt-1">{totals.totalIncome > 0 ? ((totals.incomeCash / totals.totalIncome) * 100).toFixed(1) : 0}%</p>
                </div>
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
                  <p className="text-xs text-gray-500 mb-1">Kaspi</p>
                  <p className="text-xl font-bold text-blue-400">{formatMoneyFull(totals.incomeKaspi)}</p>
                  <p className="text-xs text-gray-500 mt-1">{totals.totalIncome > 0 ? ((totals.incomeKaspi / totals.totalIncome) * 100).toFixed(1) : 0}%</p>
                </div>
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
                  <p className="text-xs text-gray-500 mb-1">Online</p>
                  <p className="text-xl font-bold text-violet-400">{formatMoneyFull(totals.incomeOnline)}</p>
                  <p className="text-xs text-gray-500 mt-1">{totals.totalIncome > 0 ? ((totals.incomeOnline / totals.totalIncome) * 100).toFixed(1) : 0}%</p>
                </div>
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-4">
                  <p className="text-xs text-gray-500 mb-1">Card</p>
                  <p className="text-xl font-bold text-amber-400">{formatMoneyFull(totals.incomeCard)}</p>
                  <p className="text-xs text-gray-500 mt-1">{totals.totalIncome > 0 ? ((totals.incomeCard / totals.totalIncome) * 100).toFixed(1) : 0}%</p>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Activity className="w-5 h-5 text-violet-400" />
                      Динамика финансовых показателей
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-emerald-500" />
                        Доходы
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-rose-500" />
                        Расходы
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-amber-400" />
                        Прибыль
                      </span>
                    </div>
                  </div>

                  <ChartShell height="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
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
                          formatter={(value: number, name: string) => [formatMoneyFull(value), name]}
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
                  </ChartShell>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                      <PieChartIcon className="w-5 h-5 text-rose-400" />
                      Структура расходов
                    </h3>
                    
                    <ChartShell height="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie 
                            data={expenseByCategoryData} 
                            cx="50%" 
                            cy="50%" 
                            innerRadius={60} 
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="amount"
                          >
                            {expenseByCategoryData.map((_, idx) => (
                              <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="transparent" />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              background: 'rgba(17, 24, 39, 0.95)', 
                              border: '1px solid rgba(255,255,255,0.1)', 
                              borderRadius: '12px' 
                            }}
                            formatter={(v: number, _n: string, p: any) => [
                              `${formatMoneyFull(v)} (${p?.payload?.percentage?.toFixed(1)}%)`,
                              p?.payload?.name
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartShell>

                    <div className="mt-4 space-y-2 max-h-48 overflow-auto">
                      {expenseByCategoryData.map((cat, idx) => (
                        <div key={cat.name} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                            />
                            <span className="text-gray-300 truncate max-w-[120px]">{cat.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-white font-medium">{formatMoneyCompact(cat.amount)}</span>
                            <span className="text-gray-500 text-xs ml-2">{cat.percentage.toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Store className="w-5 h-5 text-blue-400" />
                    Выручка по компаниям
                  </h3>
                  
                  <ChartShell height="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={incomeByCompanyData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
                        <XAxis type="number" hide />
                        <YAxis 
                          type="category" 
                          dataKey="name" 
                          width={100}
                          stroke="#6b7280" 
                          fontSize={11} 
                          tickLine={false} 
                          axisLine={false}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            background: 'rgba(17, 24, 39, 0.95)', 
                            border: '1px solid rgba(255,255,255,0.1)', 
                            borderRadius: '12px' 
                          }}
                          formatter={(v: number, _n: string, p: any) => [
                            formatMoneyFull(v),
                            `${p?.payload?.percentage?.toFixed(1)}% от общей`
                          ]}
                        />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                          {incomeByCompanyData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartShell>
                </div>

                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    Аномалии и рекомендации
                  </h3>

                  {processed.anomalies.length > 0 ? (
                    <div className="space-y-3 max-h-80 overflow-auto">
                      {processed.anomalies
                        .sort((a, b) => {
                          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
                          return severityOrder[a.severity] - severityOrder[b.severity]
                        })
                        .map((a, i) => (
                        <div 
                          key={i} 
                          className={`flex items-center gap-4 p-4 rounded-xl border ${
                            a.severity === 'critical' ? 'bg-rose-500/10 border-rose-500/30' :
                            a.severity === 'high' ? 'bg-rose-500/5 border-rose-500/20' :
                            a.severity === 'medium' ? 'bg-amber-500/5 border-amber-500/20' :
                            'bg-blue-500/5 border-blue-500/20'
                          }`}
                        >
                          <div className={`p-2 rounded-lg ${
                            a.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                            a.severity === 'high' ? 'bg-rose-500/20 text-rose-400' :
                            a.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {a.severity === 'critical' || a.severity === 'high' ? 
                              <AlertTriangle className="w-5 h-5" /> : 
                              <Lightbulb className="w-5 h-5" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-medium">{a.description}</p>
                            <p className="text-xs text-gray-500 mt-1">{a.date}</p>
                          </div>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            a.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                            a.severity === 'high' ? 'bg-rose-500/20 text-rose-400' :
                            a.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {a.severity === 'critical' ? 'Критично' : 
                             a.severity === 'high' ? 'Высокий' : 
                             a.severity === 'medium' ? 'Средний' : 'Низкий'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <CheckCircle2 className="w-16 h-16 mb-4 text-emerald-500/30" />
                      <p>Аномалий не обнаружено</p>
                      <p className="text-sm text-gray-600 mt-1">Все показатели в норме</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6">Сравнение периодов</h3>
                  <div className="space-y-6">
                    {[
                      { label: 'Выручка', current: totals.totalIncome, previous: totalsPrev.totalIncome, color: 'bg-emerald-500' },
                      { label: 'Расходы', current: totals.totalExpense, previous: totalsPrev.totalExpense, color: 'bg-rose-500' },
                      { label: 'Прибыль', current: totals.profit, previous: totalsPrev.profit, color: 'bg-blue-500' },
                    ].map((item) => {
                      const change = item.previous > 0 ? ((item.current - item.previous) / item.previous) * 100 : 0
                      const max = Math.max(item.current, item.previous, 1)
                      
                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{item.label}</span>
                            <div className="flex gap-4">
                              <span className="text-gray-500">Было: {formatMoneyFull(item.previous)}</span>
                              <span className="text-white font-medium">Сейчас: {formatMoneyFull(item.current)}</span>
                            </div>
                          </div>
                          <div className="h-8 bg-gray-800/50 rounded-lg overflow-hidden flex">
                            <div 
                              className={`${item.color} opacity-60 flex items-center justify-end px-2 text-xs text-white font-medium transition-all duration-500`}
                              style={{ width: `${(item.previous / max) * 100}%` }}
                            >
                              {item.previous > max * 0.15 && formatMoneyCompact(item.previous)}
                            </div>
                            <div 
                              className={`${item.color} flex items-center justify-end px-2 text-xs text-white font-medium transition-all duration-500`}
                              style={{ width: `${(item.current / max) * 100}%` }}
                            >
                              {formatMoneyCompact(item.current)}
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <span className={`text-sm font-medium ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                              {change > 0 ? '+' : ''}{change.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                  <h3 className="text-lg font-semibold mb-6">Распределение по типам платежей</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Наличные', value: totals.incomeCash, total: totals.totalIncome, color: 'bg-emerald-500' },
                      { label: 'Kaspi', value: totals.incomeKaspi, total: totals.totalIncome, color: 'bg-blue-500' },
                      { label: 'Online', value: totals.incomeOnline, total: totals.totalIncome, color: 'bg-violet-500' },
                      { label: 'Карта', value: totals.incomeCard, total: totals.totalIncome, color: 'bg-amber-500' },
                    ].map((item) => {
                      const pct = totals.totalIncome > 0 ? (item.value / totals.totalIncome) * 100 : 0
                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300">{item.label}</span>
                            <span className="text-white font-medium">{formatMoneyFull(item.value)} ({pct.toFixed(1)}%)</span>
                          </div>
                          <div className="h-3 bg-gray-800/50 rounded-full overflow-hidden">
                            <div 
                              className={`${item.color} h-full rounded-full transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                <h3 className="text-lg font-semibold mb-6">Тепловая карта активности</h3>
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 35 }, (_, i) => {
                    const date = addDaysISO(dateFrom, i)
                    if (date > dateTo) return <div key={i} className="aspect-square rounded-lg bg-gray-800/30" />
                    
                    const income = dailyIncome.get(date) || 0
                    const expense = dailyExpense.get(date) || 0
                    const profit = income - expense
                    
                    let intensity = 0
                    if (profit > 0) intensity = Math.min(1, profit / (totals.profit / 7 + 1))
                    else if (profit < 0) intensity = -Math.min(1, Math.abs(profit) / (totals.totalExpense / 7 + 1))
                    
                    return (
                      <div 
                        key={i}
                        className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs cursor-pointer hover:scale-110 transition-transform ${
                          intensity > 0 ? `bg-emerald-500/${Math.round(intensity * 40)}` :
                          intensity < 0 ? `bg-rose-500/${Math.round(Math.abs(intensity) * 40)}` :
                          'bg-gray-800/50'
                        }`}
                        title={`${date}: Доход ${formatMoneyFull(income)}, Расход ${formatMoneyFull(expense)}`}
                      >
                        <span className="text-gray-500 text-[10px]">{date.slice(8)}</span>
                        {profit !== 0 && (
                          <span className={profit > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {formatMoneyCompact(profit)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500/40" /> Убыток</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-800" /> Нейтрально</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/40" /> Прибыль</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB: DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input 
                    placeholder="Поиск по компании, дате, сумме..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="pl-10 bg-gray-900/40 border-white/10"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Показать:</span>
                  <select 
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                    className="bg-gray-900/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span className="text-sm text-gray-500">записей</span>
                </div>
              </div>

              <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5 bg-gray-800/30">
                        <th className="px-4 py-3 text-left">
                          <input 
                            type="checkbox"
                            checked={selectedRows.size === paginatedRows.length && paginatedRows.length > 0}
                            onChange={selectAllRows}
                            className="rounded border-white/10 bg-gray-800 text-violet-500"
                          />
                        </th>
                        {[
                          { key: 'date', label: 'Дата' },
                          { key: 'type', label: 'Тип' },
                          { key: 'company', label: 'Компания' },
                          { key: 'category', label: 'Категория/Смена' },
                          { key: 'amount', label: 'Сумма', align: 'right' },
                          { key: 'zone', label: 'Зона/Описание' },
                        ].map((col) => (
                          <th 
                            key={col.key}
                            className={`px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                            onClick={() => handleSort(col.key as SortField)}
                          >
                            <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                              {col.label}
                              {sortField === col.key && (
                                sortDirection === 'asc' ? <ArrowUpDown className="w-3 h-3 rotate-180" /> : <ArrowUpDown className="w-3 h-3" />
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {paginatedRows.map((row) => (
                        <tr 
                          key={row.id} 
                          className={`hover:bg-white/5 transition-colors ${selectedRows.has(row.id) ? 'bg-violet-500/10' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <input 
                              type="checkbox"
                              checked={selectedRows.has(row.id)}
                              onChange={() => toggleRowSelection(row.id)}
                              className="rounded border-white/10 bg-gray-800 text-violet-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{row.date}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              row.type === 'income' 
                                ? 'bg-emerald-500/10 text-emerald-400' 
                                : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {row.type === 'income' ? 'Доход' : 'Расход'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-white">{row.companyName}</td>
                          <td className="px-4 py-3 text-sm text-gray-300">
                            {row.category || (row.shift ? SHIFT_LABELS[row.shift] : '—')}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <div className={`font-medium ${row.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {row.type === 'income' ? '+' : '-'}{formatMoneyFull(row.amount)}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Нал: {formatMoneyCompact(row.cashAmount)} | Kaspi: {formatMoneyCompact(row.kaspiAmount)}
                              {row.onlineAmount ? ` | Online: ${formatMoneyCompact(row.onlineAmount)}` : ''}
                              {row.cardAmount ? ` | Card: ${formatMoneyCompact(row.cardAmount)}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                            {row.zone || row.description || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filteredRows.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Записи не найдены</p>
                    <p className="text-sm mt-1">Попробуйте изменить фильтры</p>
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
                    <div className="text-sm text-gray-500">
                      Показано {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredRows.length)} из {filteredRows.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm text-gray-400">
                        Страница {currentPage} из {totalPages}
                      </span>
                      <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selectedRows.size > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <span className="text-sm text-violet-200">Выбрано: {selectedRows.size} записей</span>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="border-violet-500/30 text-violet-300 hover:bg-violet-500/20"
                      onClick={() => {
                        const selectedData = detailedRows.filter(r => selectedRows.has(r.id))
                        const rows = selectedData.map(r => [
                          r.date,
                          r.type === 'income' ? 'Доход' : 'Расход',
                          r.companyName,
                          r.category || r.shift || '',
                          String(r.amount),
                          r.zone || r.description || ''
                        ])
                        downloadTextFile('selected_rows.csv', toCSV([['Дата', 'Тип', 'Компания', 'Категория', 'Сумма', 'Примечание'], ...rows]))
                        showToast('Выбранные строки экспортированы', 'success')
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Экспорт выбранных
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="border-white/10"
                      onClick={() => setSelectedRows(new Set())}
                    >
                      Снять выделение
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: COMPANIES */}
          {activeTab === 'companies' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {companyComparisonData.map((company) => (
                  <div 
                    key={company.id} 
                    className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6 hover:border-white/10 transition-all cursor-pointer group"
                    onClick={() => {
                      setCompanyFilter(company.id)
                      setActiveTab('overview')
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold text-white group-hover:text-violet-400 transition-colors">{company.name}</h4>
                        <p className="text-sm text-gray-500">{company.transactions} операций</p>
                      </div>
                      <div className={`p-2 rounded-lg ${
                        company.profit >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {company.profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Выручка</span>
                        <span className="text-white font-medium">{formatMoneyFull(company.income)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Расходы</span>
                        <span className="text-rose-400">{formatMoneyFull(company.expense)}</span>
                      </div>
                      <div className="h-px bg-white/5 my-3" />
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Прибыль</span>
                        <span className={`text-lg font-bold ${company.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatMoneyFull(company.profit)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Маржа</span>
                        <span className={`font-medium ${
                          company.margin >= 30 ? 'text-emerald-400' : 
                          company.margin >= 15 ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          {company.margin.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-gray-500 block">Наличные</span>
                        <span className="text-white">+{formatMoneyCompact(company.cashIncome)} / -{formatMoneyCompact(company.cashExpense)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Безналичные</span>
                        <span className="text-white">+{formatMoneyCompact(company.kaspiIncome + company.onlineIncome + company.cardIncome)} / -{formatMoneyCompact(company.kaspiExpense)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl bg-gray-900/40 backdrop-blur-xl border border-white/5 p-6">
                <h3 className="text-lg font-semibold mb-6">Сравнительная таблица</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5 text-left text-xs text-gray-500 uppercase">
                        <th className="pb-3 pl-4">Компания</th>
                        <th className="pb-3 text-right">Выручка</th>
                        <th className="pb-3 text-right">Расходы</th>
                        <th className="pb-3 text-right">Прибыль</th>
                        <th className="pb-3 text-right">Маржа</th>
                        <th className="pb-3 text-right">Наличные</th>
                        <th className="pb-3 text-right">Безнал</th>
                        <th className="pb-3 text-center">Операций</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {companyComparisonData.map((c) => (
                        <tr key={c.id} className="hover:bg-white/5">
                          <td className="py-4 pl-4 font-medium text-white">{c.name}</td>
                          <td className="py-4 text-right text-emerald-400">{formatMoneyFull(c.income)}</td>
                          <td className="py-4 text-right text-rose-400">{formatMoneyFull(c.expense)}</td>
                          <td className={`py-4 text-right font-bold ${c.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatMoneyFull(c.profit)}
                          </td>
                          <td className="py-4 text-right">
                            <span className={`px-2 py-1 rounded text-xs ${
                              c.margin >= 30 ? 'bg-emerald-500/20 text-emerald-400' :
                              c.margin >= 15 ? 'bg-amber-500/20 text-amber-400' :
                              'bg-rose-500/20 text-rose-400'
                            }`}>
                              {c.margin.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-4 text-right text-gray-300">
                            {formatMoneyCompact(c.cashIncome - c.cashExpense)}
                          </td>
                          <td className="py-4 text-right text-gray-300">
                            {formatMoneyCompact((c.kaspiIncome + c.onlineIncome + c.cardIncome) - c.kaspiExpense)}
                          </td>
                          <td className="py-4 text-center text-gray-400">{c.transactions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
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
