'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useVirtualizer } from '@tanstack/react-virtual'
import { computeMonthEndForecast, type ForecastHints } from '@/lib/reports/forecast-hybrid'
import { emptyProcessedReport, processedFromBundleAggregate, type ReportBundleAggregate } from '@/lib/reports/from-api-aggregate'
import { isExtraCompany } from '@/lib/reports/extra-company'
import type { ExpenseArticle } from '@/lib/reports/expense-groups'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect } from '@/components/ui/native-select'
import { toast } from '@/components/ui/use-toast'
import { ReportsMethodologyBanner } from '@/components/reports/reports-methodology-banner'
import { ReportsPageSkeleton } from '@/components/reports/reports-page-skeleton'
import { AIInsightCard } from '@/components/reports/ai-insight-card'
import { FloatingAssistant } from '@/components/ai/floating-assistant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PageSnapshot } from '@/lib/ai/types'
import { supabase } from '@/lib/supabaseClient'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { usePersistentState } from '@/lib/client/use-persistent-state'
import { invalidateApiCache, readApiCache, writeApiCache } from '@/lib/client/use-api-cache'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { Activity, AlertTriangle, ArrowUpDown, BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, DollarSign, Download, Filter, Lightbulb, RefreshCw, Search, Share2, Store, TrendingDown, TrendingUp, Wallet, X, Zap } from 'lucide-react'
import { PIE_COLORS, SHIFT_LABELS, PRESET_LABELS, toISODateLocal, fromISO, todayISO, addDaysISO, calculatePrevPeriod, formatDateRange, formatMoneyFull, formatMoneyCompact, toCSV, downloadTextFile, parseBool, parseGroup, parseTab, isISODate, buildDetailedRows } from './report-shared'
import type { Shift, IncomeRow, ExpenseRow, Company, GroupMode, DatePreset, SortDirection, SortField, TimeAggregation, AIInsight, Severity, DetailedRow } from './report-shared'
import { MemoizedComposedChart, MemoizedBarChart } from './report-charts'
import { ChartShell, StatCard, InsightCard, AnomalyCard, ProfitHeatmap, ExpenseArticlesCard } from './report-cards'
import { DrillDownModal } from './drill-down-modal'
import type { DrillDownState } from './drill-down-modal'

// =====================
// MAIN CONTENT COMPONENT
// =====================

function ReportsContent() {
  const cashLabels = useCashlessLabels()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCapabilities()

  // Mount state for charts
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Inject print styles
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'print-styles'
    style.innerHTML = `
      @media print {
        body { background: white !important; color: black !important; }
        .no-print { display: none !important; }
        .print-card { background: white !important; border: 1px solid #ddd !important; color: black !important; }
        .print-summary { display: block !important; }
      }
      .print-summary { display: none; }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('print-styles')?.remove() }
  }, [])

  // Data states
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  // Строки операций грузятся лениво — для «Деталей», модалки и PDF. rowsKey
  // помнит, к какому срезу фильтров относятся загруженные строки.
  const [rowsKey, setRowsKey] = useState<string | null>(null)
  const [rowsLoading, setRowsLoading] = useState(false)
  const rowsReqRef = useRef(0)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoaded, setCompaniesLoaded] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [impreciseNightKaspiCount, setImpreciseNightKaspiCount] = useState(0)
  const [bundleAggregate, setBundleAggregate] = useState<ReportBundleAggregate | null>(null)
  const [forecastHints, setForecastHints] = useState<ForecastHints | null>(null)
  const [bundleAsOf, setBundleAsOf] = useState('')
  const [expenseArticles, setExpenseArticles] = useState<ExpenseArticle[]>([])

  // Filter states
  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(() => todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  // Точка и группировка помнятся между визитами (URL-параметры имеют приоритет, даты не персистим)
  const [companyFilter, setCompanyFilter] = usePersistentState<'all' | string>('reports.company', 'all')
  const [shiftFilter, setShiftFilter] = useState<'all' | Shift>('all')
  const [groupMode, setGroupMode] = usePersistentState<GroupMode>('reports.group', 'day')
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
  const [showFilters, setShowFilters] = useState(false)
  const [comparisonMode, setComparisonMode] = useState(false)
  // База сравнения: предыдущий период той же длины или тот же период годом раньше (сезонность)
  const [compareWith, setCompareWith] = useState<'prev' | 'year'>('prev')
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null)
  const [exporting, setExporting] = useState(false)
  
  const reqIdRef = useRef(0)
  const didInitFromUrl = useRef(false)
  const realtimeChannel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const realtimeReloadTimerRef = useRef<number | null>(null)

  // Virtual list ref for table
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Общий Toaster портала (смонтирован в app/layout.tsx) вместо своего всплывающего блока.
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    toast({ description: msg, variant: type === 'error' ? 'destructive' : 'default' })
  }, [])

  // =====================
  // COMPUTED VALUES
  // =====================
  const companyById = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const companyName = useCallback((id: string) => companyById.get(id)?.name ?? 'Неизвестно', [companyById])

  // Та же точка, которую сервер по умолчанию не складывает в итоги. Нет её — нет и переключателя.
  const extraCompany = useMemo(() => companies.find(isExtraCompany) ?? null, [companies])

  // Сохранённая точка могла быть удалена/недоступна — тихо откатываемся на «все»
  useEffect(() => {
    if (!companiesLoaded || companyFilter === 'all') return
    if (!companyById.has(companyFilter)) setCompanyFilter('all')
  }, [companiesLoaded, companyFilter, companyById, setCompanyFilter])

  // =====================
  // PRESET HANDLERS
  // =====================
  const applyPreset = useCallback((preset: DatePreset) => {
    const today = todayISO()
    const todayDate = fromISO(today)
    let from = today
    let to = today

    switch (preset) {
      case 'today': break
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
      case 'custom': return
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
    setComparisonMode(false)
    setCompareWith('prev')
    setSelectedRows(new Set())
    showToast('Фильтры сброшены', 'success')
  }, [applyPreset, showToast, setCompanyFilter, setGroupMode])

  // =====================
  // DATA LOADING
  // =====================
  useEffect(() => {
  let alive = true

  const loadCompanies = async () => {
    setError(null)

    const resp = await fetch('/api/admin/companies').catch(() => null)
    const json = await resp?.json().catch(() => null)

    if (!alive) return

    if (!resp?.ok || json?.error) {
      console.error('loadCompanies error:', json?.error)
      setError('Не удалось загрузить список компаний')
      setCompaniesLoaded(true)
      setLoading(false)
      return
    }

    setCompanies((json?.data || []) as Company[])
    setCompaniesLoaded(true)
  }

  loadCompanies()
  return () => { alive = false }
}, [])

  // Срез фильтров без as_of: по нему ключ кэша и принадлежность загруженных строк.
  const bundleQuery = useMemo(() => {
    const params = new URLSearchParams({
      from: dateFrom,
      to: dateTo,
      group: groupMode,
      include_extra: includeExtraInTotals ? '1' : '0',
    })
    if (companyFilter !== 'all') params.set('company_id', companyFilter)
    if (shiftFilter !== 'all') params.set('shift', shiftFilter)
    if (compareWith === 'year') params.set('compare', 'year')
    return params.toString()
  }, [dateFrom, dateTo, groupMode, includeExtraInTotals, companyFilter, shiftFilter, compareWith])

  const applyBundle = useCallback((data: any) => {
    setBundleAggregate(data.aggregate as ReportBundleAggregate)
    setForecastHints((data.forecastHints as ForecastHints | null) ?? null)
    setBundleAsOf(String(data.asOf || todayISO()))
    setImpreciseNightKaspiCount(Number(data.impreciseNightKaspiCount || 0))
    setExpenseArticles(Array.isArray(data.expenseByGroup) ? (data.expenseByGroup as ExpenseArticle[]) : [])
  }, [])

  const loadData = useCallback(async (isRefresh = false) => {
    if (!companiesLoaded) return

    const myReqId = ++reqIdRef.current
    // Только итоги и графики — сырые строки (до 200 000) больше не едут на каждый заход.
    const url = `/api/admin/reports/bundle?${bundleQuery}&as_of=${todayISO()}&rows=0`

    if (isRefresh) invalidateApiCache(`/api/admin/reports/bundle?${bundleQuery}`)

    // Повторный заход на тот же срез: прошлые цифры сразу, свежие догружаются фоном.
    const cached = isRefresh ? null : readApiCache<any>(url)
    if (cached?.aggregate) {
      applyBundle(cached)
      setLoading(false)
    } else if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setError(null)

    try {
      const bundleResp = await fetch(url, { cache: 'no-store' })
      if (myReqId !== reqIdRef.current) return

      const bundleJson = await bundleResp.json()
      if (!bundleResp.ok || bundleJson.error) throw new Error(bundleJson.error || 'Ошибка загрузки отчёта')
      const data = bundleJson.data
      if (!data?.aggregate) throw new Error('Пустой ответ')
      if (myReqId !== reqIdRef.current) return

      writeApiCache(url, data)
      applyBundle(data)
      if (isRefresh) {
        // Данные поменялись — загруженные строки перечитаются при следующем обращении.
        setRowsKey(null)
        showToast('Данные обновлены', 'success')
      }
    } catch (err) {
      // Если на экране цифры из кэша — не затираем их ошибкой фоновой догрузки.
      if (myReqId === reqIdRef.current && !cached) {
        setBundleAggregate(null)
        setForecastHints(null)
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
  }, [companiesLoaded, bundleQuery, applyBundle, showToast])

  // Строки выбранного периода — отдельным запросом, только когда они реально нужны.
  const ensureRows = useCallback(async (): Promise<{ incomes: IncomeRow[]; expenses: ExpenseRow[] } | null> => {
    const url = `/api/admin/reports/bundle?${bundleQuery}&as_of=${todayISO()}&rows=current`
    const myReqId = ++rowsReqRef.current
    setRowsLoading(true)
    try {
      let data = readApiCache<any>(url)
      if (!data) {
        const resp = await fetch(url, { cache: 'no-store' })
        const json = await resp.json()
        if (!resp.ok || json.error) throw new Error(json.error || 'Ошибка загрузки операций')
        data = json.data
        writeApiCache(url, data)
      }
      if (myReqId !== rowsReqRef.current) return null
      const next = {
        incomes: (data.incomes || []) as IncomeRow[],
        expenses: (data.expenses || []) as ExpenseRow[],
      }
      setIncomes(next.incomes)
      setExpenses(next.expenses)
      setRowsKey(bundleQuery)
      return next
    } catch (err) {
      console.error(err)
      if (myReqId === rowsReqRef.current) showToast('Не удалось загрузить операции', 'error')
      return null
    } finally {
      if (myReqId === rowsReqRef.current) setRowsLoading(false)
    }
  }, [bundleQuery, showToast])

  const rowsReady = rowsKey === bundleQuery
  const rowsNeeded = activeTab === 'details' || drillDown !== null
  useEffect(() => {
    if (!companiesLoaded || !rowsNeeded || rowsReady) return
    void ensureRows()
  }, [companiesLoaded, rowsNeeded, rowsReady, ensureRows])

  const scheduleReportsRealtimeReload = useCallback(() => {
    if (realtimeReloadTimerRef.current !== null) {
      window.clearTimeout(realtimeReloadTimerRef.current)
    }
    realtimeReloadTimerRef.current = window.setTimeout(() => {
      realtimeReloadTimerRef.current = null
      void loadData(true)
    }, 2000)
  }, [loadData])

  useEffect(() => {
    if (!companiesLoaded) return
    loadData(false)
  }, [companiesLoaded, loadData])

  const basisFrom = bundleAggregate?.prevFrom ?? ''
  const basisTo = bundleAggregate?.prevTo ?? ''

  // =====================
  // REALTIME SUBSCRIPTION
  // =====================
  useEffect(() => {
    if (!companiesLoaded) return

    // База сравнения — та, что вернул сервер (при сравнении с прошлым годом она не соседняя).
    const fallbackPrev = calculatePrevPeriod(dateFrom, dateTo)
    const prevFrom = basisFrom || fallbackPrev.prevFrom
    const prevTo = basisTo || fallbackPrev.prevTo
    const incomeEarliest = addDaysISO(prevFrom, -1)

    const incomeTouchesRange = (iso: string | undefined) =>
      !!iso && iso >= incomeEarliest && iso <= dateTo

    const expenseTouchesRange = (iso: string | undefined) =>
      !!iso &&
      ((iso >= dateFrom && iso <= dateTo) || (iso >= prevFrom && iso <= prevTo))

    const channel = supabase
      .channel('financial-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incomes' }, (payload: any) => {
        const next = payload.new as IncomeRow | undefined
        const prev = payload.old as IncomeRow | undefined
        const dates = [next?.date, prev?.date].filter(Boolean) as string[]
        if (dates.some((d) => incomeTouchesRange(d))) scheduleReportsRealtimeReload()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (payload: any) => {
        const next = payload.new as ExpenseRow | undefined
        const prev = payload.old as ExpenseRow | undefined
        const dates = [next?.date, prev?.date].filter(Boolean) as string[]
        if (dates.some((d) => expenseTouchesRange(d))) scheduleReportsRealtimeReload()
      })
      .subscribe()

    realtimeChannel.current = channel

    return () => {
      if (realtimeReloadTimerRef.current !== null) {
        window.clearTimeout(realtimeReloadTimerRef.current)
        realtimeReloadTimerRef.current = null
      }
      if (realtimeChannel.current) {
        supabase.removeChannel(realtimeChannel.current)
      }
    }
  }, [companiesLoaded, dateFrom, dateTo, basisFrom, basisTo, scheduleReportsRealtimeReload])

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
    const pCompare = parseBool(sp.get('compare'))

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
    if (pCompare) setComparisonMode(true)
    if (sp.get('vs') === 'year') setCompareWith('year')

    didInitFromUrl.current = true
  }, [companiesLoaded, companies, searchParams, applyPreset, setCompanyFilter, setGroupMode])

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
      params.set('compare', comparisonMode ? '1' : '0')
      params.set('vs', compareWith)

      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [
    dateFrom,
    dateTo,
    datePreset,
    companyFilter,
    shiftFilter,
    groupMode,
    includeExtraInTotals,
    activeTab,
    comparisonMode,
    compareWith,
    pathname,
    router,
  ])

  // =====================
  // DATA PROCESSING (сервер /api/admin/reports/bundle)
  // =====================
  const processed = useMemo(() => {
    if (bundleAggregate) return processedFromBundleAggregate(bundleAggregate)
    return emptyProcessedReport()
  }, [bundleAggregate])

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
      .map((item) => ({
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
  // DETAILED ROWS
  // =====================

  // Выручка в среднем за день. Для периода, который ещё идёт (текущий месяц),
  // делим на прошедшие дни, а не на весь период — иначе середина месяца «проседает».
  const perDay = useMemo(() => {
    const today = todayISO()
    const elapsedTo = dateTo < today ? dateTo : today
    if (elapsedTo < dateFrom) return null
    const days = calculatePrevPeriod(dateFrom, elapsedTo).durationDays
    const prevDays = calculatePrevPeriod(dateFrom, dateTo).durationDays
    return {
      days,
      income: totals.totalIncome / days,
      prevIncome: totalsPrev.totalIncome / prevDays,
    }
  }, [dateFrom, dateTo, totals.totalIncome, totalsPrev.totalIncome])

  // Доходы и расходы за отрезок дат — по клику на график или клетку тепловой карты
  const openRange = useCallback((from: string, to: string) => {
    const label = from === to
      ? fromISO(from).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : formatDateRange(from, to)
    setDrillDown({ type: 'profit', from, to, title: `Доходы и расходы — ${label}` })
  }, [])

  // Клик по точке графика: операции этого дня / недели / месяца / года (в пределах периода)
  const openBucket = useCallback((row: TimeAggregation) => {
    const start = row.sortISO
    let end = start
    if (groupMode === 'week') end = addDaysISO(start, 6)
    else if (groupMode === 'month') {
      const d = fromISO(start)
      end = toISODateLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0))
    } else if (groupMode === 'year') end = `${start.slice(0, 4)}-12-31`

    openRange(start < dateFrom ? dateFrom : start, end > dateTo ? dateTo : end)
  }, [groupMode, dateFrom, dateTo, openRange])
  const detailedRows = useMemo((): DetailedRow[] => {
    // Строки от другого среза фильтров не показываем, пока не догрузились свежие.
    if (!rowsReady) return []
    return buildDetailedRows(incomes, expenses, {
      dateFrom,
      dateTo,
      min: minAmountFilter ? parseFloat(minAmountFilter) : 0,
      max: maxAmountFilter ? parseFloat(maxAmountFilter) : Infinity,
      companyName,
    })
  }, [rowsReady, incomes, expenses, dateFrom, dateTo, companyName, minAmountFilter, maxAmountFilter])

  const filteredRows = useMemo(() => {
    let result = [...detailedRows]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(r => 
        r.companyName.toLowerCase().includes(q) ||
        r.date.includes(q) ||
        (r.category && r.category.toLowerCase().includes(q)) ||
        (r.zone && r.zone.toLowerCase().includes(q)) ||
        (r.comment && r.comment.toLowerCase().includes(q)) ||
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
          aVal = a.zone || a.comment || ''
          bVal = b.zone || b.comment || ''
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

  // Virtualization for large tables
  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 60,
    overscan: 5,
  })

  const virtualRows = virtualizer.getVirtualItems()

  // Pagination for non-virtualized view (fallback)
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredRows.slice(start, start + itemsPerPage)
  }, [filteredRows, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredRows.length / itemsPerPage)
  const useVirtualization = filteredRows.length > 100

  // =====================
  // AI INSIGHTS
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0

    // Без выручки маржа не определена — пустой период не должен «гореть красным».
    const hasIncome = totals.totalIncome > 0
    if (hasIncome && profitMargin < 10) {
      insights.push({
        type: 'danger',
        title: 'Критически низкая маржинальность', 
        description: `Маржа ${profitMargin.toFixed(1)}% требует немедленного внимания. Проверьте операционные расходы.`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: 'down'
      })
    } else if (hasIncome && profitMargin < 20) {
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

    return insights.slice(0, 5)
  }, [totals, totalsPrev, expenseByCategoryData, processed.anomalies])

  // =====================
  // FORECAST (гибрид: МТД + прошлый календарный месяц, иначе линейно)
  // =====================
  const forecast = useMemo(() => {
    // Прогноз — для любого периода, который идёт прямо сейчас (а не только для
    // пресетов «текущий месяц/квартал/год»): начался и ещё не закончился.
    const asOfDay = bundleAsOf || todayISO()
    if (!(dateFrom <= asOfDay && asOfDay < dateTo)) return null

    const hybrid =
      bundleAggregate && forecastHints
        ? computeMonthEndForecast({
            dateFrom: bundleAggregate.dateFrom,
            dateTo: bundleAggregate.dateTo,
            asOf: bundleAsOf || todayISO(),
            mtdIncome: bundleAggregate.totalsCur.totalIncome,
            mtdExpense: bundleAggregate.totalsCur.totalExpense,
            hints: forecastHints,
          })
        : null
    if (hybrid) return hybrid

    const startDate = fromISO(dateFrom)
    const lastDay = fromISO(dateTo)
    const asOfD = fromISO(bundleAsOf || todayISO())
    const daysPassed = Math.max(1, Math.floor((asOfD.getTime() - startDate.getTime()) / 86400000) + 1)
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
      runRateIncome: 0,
      seasonalIncome: 0,
      note: 'Линейная экстраполяция по накопленному факту',
    }
  }, [dateFrom, dateTo, totals, bundleAggregate, forecastHints, bundleAsOf])

  const assistantSnapshot = useMemo<PageSnapshot>(() => {
    const profitMargin = totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0

    return {
      page: 'reports',
      title: 'Срез данных по отчётам',
      generatedAt: new Date().toISOString(),
      route: '/reports',
      period: {
        from: dateFrom,
        to: dateTo,
        label: `${dateFrom} -> ${dateTo}`,
      },
      summary: [
        `Выручка ${formatMoneyFull(totals.totalIncome)}`,
        `Расходы ${formatMoneyFull(totals.totalExpense)}`,
        `Прибыль ${formatMoneyFull(totals.profit)}`,
        `Маржа ${profitMargin.toFixed(1)}%`,
      ],
      sections: [
        {
          title: 'Сводка периода',
          metrics: [
            { label: 'Выручка', value: formatMoneyFull(totals.totalIncome) },
            { label: 'Расходы', value: formatMoneyFull(totals.totalExpense) },
            { label: 'Прибыль', value: formatMoneyFull(totals.profit) },
            { label: 'Маржа', value: `${profitMargin.toFixed(1)}%` },
            { label: 'Выручка на запись дохода', value: formatMoneyFull(totals.avgTransaction) },
          ],
        },
        {
          title: 'Сравнение и прогноз',
          metrics: [
            { label: 'Выручка прошлого периода', value: formatMoneyFull(totalsPrev.totalIncome) },
            { label: 'Прибыль прошлого периода', value: formatMoneyFull(totalsPrev.profit) },
            { label: 'Прогноз дохода', value: forecast ? formatMoneyFull(forecast.forecastIncome) : 'Нет активного прогноза' },
            { label: 'Прогноз прибыли', value: forecast ? formatMoneyFull(forecast.forecastProfit) : 'Нет активного прогноза' },
            { label: 'Доверие прогноза', value: forecast ? `${forecast.confidence.toFixed(0)}%` : '—' },
          ],
        },
        {
          title: 'Концентрация и сигналы',
          metrics: [
            {
              label: 'Топ-расходы',
              value: expenseByCategoryData.slice(0, 3).map((item) => `${item.name} ${formatMoneyFull(item.amount)}`).join(' | ') || 'Нет данных',
            },
            {
              label: 'Топ-компании',
              value: incomeByCompanyData.slice(0, 3).map((item) => `${item.name} ${formatMoneyFull(item.value)}`).join(' | ') || 'Нет данных',
            },
            {
              label: 'Аномалии',
              value:
                processed.anomalies
                  .slice(0, 3)
                  .map((item) => item.description)
                  .join(' | ') || 'Сильных аномалий не найдено',
            },
          ],
        },
      ],
    }
  }, [dateFrom, dateTo, expenseByCategoryData, forecast, incomeByCompanyData, processed.anomalies, totals, totalsPrev])

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

  const handleDownloadPdf = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
    const companyLabel = companyFilter !== 'all'
      ? companyName(companyFilter)
      : !extraCompany
        ? 'Все компании'
        : `Все компании (${includeExtraInTotals ? 'включая' : 'без'} ${extraCompany.name})`
    const period = `${dateFrom} — ${dateTo}`
    // Операции грузятся лениво: если «Детали» ещё не открывали, дочитываем их сейчас.
    let pdfRows = filteredRows
    if (!rowsReady) {
      const loaded = await ensureRows()
      if (!loaded) throw new Error('Не удалось загрузить операции')
      pdfRows = buildDetailedRows(loaded.incomes, loaded.expenses, { dateFrom, dateTo, min: 0, max: Infinity, companyName })
        .sort((a, b) => b.date.localeCompare(a.date))
    }
    const finData = {
      meta: { title: 'Финансовый отчёт', period, company: companyLabel, generated: new Date().toLocaleString('ru-RU') },
      kpi: {
        revenue: totals.totalIncome,
        revenuePrev: totalsPrev.totalIncome,
        expense: totals.totalExpense,
        expensePrev: totalsPrev.totalExpense,
        profit: totals.profit,
        profitPrev: totalsPrev.profit,
        avgCheck: totals.avgTransaction,
        txns: totals.transactionCount,
      },
      summary: [
        { section: 'ОСНОВНЫЕ ПОКАЗАТЕЛИ' },
        { label: 'Выручка', cur: totals.totalIncome, prev: totalsPrev.totalIncome },
        { label: 'Расходы', cur: totals.totalExpense, prev: totalsPrev.totalExpense },
        { label: 'Прибыль', cur: totals.profit, prev: totalsPrev.profit, strong: true },
        { section: 'СТРУКТУРА ДОХОДОВ' },
        { label: 'Наличные', cur: totals.incomeCash, prev: totalsPrev.incomeCash },
        { label: 'Безналичный доход', cur: totals.incomeNonCash, prev: totalsPrev.incomeNonCash },
        { label: 'Онлайн', cur: totals.incomeOnline, prev: totalsPrev.incomeOnline },
        { label: 'Карта', cur: totals.incomeCard, prev: totalsPrev.incomeCard },
      ],
      byCompany: incomeByCompanyData.map((c) => ({
        name: c.name,
        revenue: c.value,
        cash: c.cash,
        cashless: (c.kaspi || 0) + (c.online || 0) + (c.card || 0),
        online: c.online,
        card: c.card,
        txns: c.count,
      })),
      expenses: expenseByCategoryData.map((e) => ({ name: e.name, amount: e.amount })),
      operations: pdfRows.map((r) => ({
        date: r.date,
        type: r.type === 'income' ? 'Доход' : 'Расход',
        company: r.companyName,
        cat: r.category || r.shift || '',
        amount: Math.round(r.amount),
        cash: Math.round(r.cashAmount),
        cashless: Math.round((r.kaspiAmount || 0) + (r.type === 'income' ? (r.onlineAmount || 0) + (r.cardAmount || 0) : 0)),
        online: r.type === 'income' ? Math.round(r.onlineAmount || 0) : 0,
        card: r.type === 'income' ? Math.round(r.cardAmount || 0) : 0,
        note: r.zone || r.comment || '',
      })),
    }
    await downloadReportPdf('finreport', finData, `Finansovyy_otchet_${dateFrom}_${dateTo}`)
    showToast('PDF отчёт скачан', 'success')
    } catch (err) {
      console.error(err)
      showToast('Не удалось сформировать PDF', 'error')
    } finally {
      setExporting(false)
    }
  }, [exporting, companyFilter, includeExtraInTotals, extraCompany, companyName, dateFrom, dateTo, totals, totalsPrev, incomeByCompanyData, expenseByCategoryData, filteredRows, rowsReady, ensureRows, showToast])

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
    const targetRows = useVirtualization ? filteredRows : paginatedRows
    if (selectedRows.size === targetRows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(targetRows.map(r => r.id)))
    }
  }, [filteredRows, paginatedRows, selectedRows.size, useVirtualization])

  // =====================
  // LOADING & ERROR STATES
  // =====================
  if (!companiesLoaded) {
    return <ReportsPageSkeleton />
  }

  if (loading && !bundleAggregate) {
    return <ReportsPageSkeleton />
  }

  if (error) {
    return (
      <>
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Ошибка загрузки</h2>
            <p className="text-muted-foreground max-w-md">{error}</p>
            <Button onClick={() => loadData(true)} variant="outline" className="border-border">
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
        <div
          className={`app-page-wide space-y-6 relative transition-opacity duration-200 ${
            refreshing ? 'opacity-80 ring-1 ring-amber-500/20 rounded-3xl' : ''
          }`}
        >
          {/* Header */}
          <AdminPageHeader
            title="Финансы и отчёты"
            description={`${formatDateRange(dateFrom, dateTo)}${comparisonMode ? (compareWith === 'year' ? ' · сравнение с прошлым годом' : ' · сравнение с прошлым периодом') : ''}`}
            icon={<BarChart3 className="h-5 w-5" />}
            accent="amber"
            backHref="/"
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl ${comparisonMode ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400' : ''}`}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  title="Режим сравнения"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl ${refreshing ? 'animate-spin' : ''}`}
                  onClick={() => loadData(true)}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                {/* Одна кнопка вместо меню по наведению: на телефоне и планшете hover нет */}
                {can('reports.export') && (
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleDownloadPdf}
                    disabled={exporting}
                  >
                    <Download className={`w-4 h-4 mr-2 ${exporting ? 'animate-pulse' : ''}`} />
                    {exporting ? 'Готовлю…' : 'PDF'}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl"
                  onClick={handleShare}
                  title="Поделиться"
                >
                  <Share2 className="w-4 h-4" />
                </Button>

              </>
            }
            toolbar={
              <div className="inline-flex w-fit max-w-full overflow-x-auto items-center rounded-xl p-0.5 border border-border bg-slate-100 dark:bg-white/[0.03]">
                {(['overview', 'analytics', 'details', 'companies'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 lg:px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeTab === tab ? 'bg-amber-500 text-white shadow-sm' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab === 'overview' && 'Обзор'}
                    {tab === 'analytics' && 'Аналитика'}
                    {tab === 'details' && 'Детали'}
                    {tab === 'companies' && 'Компании'}
                  </button>
                ))}
              </div>
            }
          />

          {/* Print-only summary */}
          <div className="print-summary rounded-2xl border border-slate-200 bg-white p-6 print-card">
            <h2 className="text-lg font-bold text-black mb-4">Финансовая сводка: {formatDateRange(dateFrom, dateTo)}</h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-300">
                  <th className="text-left py-2 pr-4 text-black font-semibold">Показатель</th>
                  <th className="text-right py-2 text-black font-semibold">Значение</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">Выручка</td>
                  <td className="py-1.5 text-right text-green-700 font-medium">{formatMoneyFull(totals.totalIncome)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">Расходы</td>
                  <td className="py-1.5 text-right text-red-700 font-medium">{formatMoneyFull(totals.totalExpense)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-700 font-semibold">Прибыль</td>
                  <td className={`py-1.5 text-right font-bold ${totals.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatMoneyFull(totals.profit)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <ReportsMethodologyBanner
            dateFrom={dateFrom}
            dateTo={dateTo}
            comparisonMode={comparisonMode}
            compareWith={compareWith}
            impreciseNightKaspiCount={impreciseNightKaspiCount}
            companyId={companyFilter}
          />

          {/* Одна карточка вместо трёх блоков подряд: сигналы по правилам + разбор ИИ по кнопке */}
          <Card className="gap-0 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-foreground">На что обратить внимание</h3>
            </div>
            {aiInsights.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {aiInsights.map((insight, idx) => (
                  <InsightCard key={idx} insight={insight} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Резких отклонений за период нет.</p>
            )}
            <div className="mt-4 border-t border-border pt-4">
              <AIInsightCard
                embedded
                dateFrom={dateFrom}
                dateTo={dateTo}
                totals={{
                  incomeTotal: totals.totalIncome,
                  expenseTotal: totals.totalExpense,
                  profit: totals.profit,
                  incomeCash: totals.incomeCash,
                  incomeKaspi: totals.incomeKaspi,
                  incomeOnline: totals.incomeOnline,
                  incomeCard: totals.incomeCard,
                }}
                totalsPrev={{
                  incomeTotal: totalsPrev.totalIncome,
                  expenseTotal: totalsPrev.totalExpense,
                  profit: totalsPrev.profit,
                }}
                topIncome={incomeByCompanyData.slice(0, 3).map((c) => ({ name: c.name, value: c.value }))}
                topExpense={expenseByCategoryData.slice(0, 3).map((e) => ({ name: e.name, value: e.amount }))}
                cashlessLabel={cashLabels.providerName}
              />
            </div>
          </Card>

          <FloatingAssistant
            page="reports"
            title="Отчёты и аналитика"
            snapshot={assistantSnapshot}
            suggestedPrompts={[
              'Сводка для руководителя',
              'Где самый слабый участок?',
              'С чем сравнить этот период?',
            ]}
          />

          {/* Filters Bar (sticky) */}
          <Card className="sticky top-2 z-30 gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 mr-1">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Фильтры</span>
              </div>

              <NativeSelect
                value={datePreset}
                onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
                className="w-auto cursor-pointer"
              >
                {Object.entries(PRESET_LABELS).map(([key, label]) => (
                  <option key={key} value={key} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">{label}</option>
                ))}
              </NativeSelect>

              <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white dark:bg-white/[0.04] px-2 py-1">
                <DatePicker
                  value={dateFrom}
                  onChange={(v) => {
                    setDateFrom(v)
                    setDatePreset('custom')
                  }}
                />
                <span className="text-faint">—</span>
                <DatePicker
                  value={dateTo}
                  onChange={(v) => {
                    setDateTo(v)
                    setDatePreset('custom')
                  }}
                />
              </div>

              <NativeSelect
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="w-auto cursor-pointer"
              >
                <option value="all" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Все компании</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">{c.name}</option>
                ))}
              </NativeSelect>

              <NativeSelect
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
                className="w-auto cursor-pointer"
              >
                <option value="day" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">По дням</option>
                <option value="week" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">По неделям</option>
                <option value="month" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">По месяцам</option>
                <option value="year" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">По годам</option>
              </NativeSelect>

              <NativeSelect
                value={compareWith}
                onChange={(e) => setCompareWith(e.target.value === 'year' ? 'year' : 'prev')}
                className="w-auto cursor-pointer"
                aria-label="С чем сравнивать"
              >
                <option value="prev" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Сравнить с прошлым периодом</option>
                <option value="year" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Сравнить с прошлым годом</option>
              </NativeSelect>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={`rounded-xl ${showFilters ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400' : ''}`}
              >
                <Filter className="w-4 h-4" />
                Расширенные
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={resetFilters}
                className="ml-auto rounded-xl text-muted-foreground"
                title="Сбросить фильтры"
                aria-label="Сбросить фильтры"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {showFilters && (
              <div className="pt-4 border-t border-border grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Смена</label>
                  <NativeSelect
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as 'all' | Shift)}
                    className="cursor-pointer"
                  >
                    <option value="all" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Все смены</option>
                    <option value="day" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">День</option>
                    <option value="night" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Ночь</option>
                  </NativeSelect>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Сумма от</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={minAmountFilter}
                    onChange={(e) => setMinAmountFilter(e.target.value)}
                    className="bg-white dark:bg-white/[0.04] border-border"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Сумма до</label>
                  <Input
                    type="number"
                    placeholder="∞"
                    value={maxAmountFilter}
                    onChange={(e) => setMaxAmountFilter(e.target.value)}
                    className="bg-white dark:bg-white/[0.04] border-border"
                  />
                </div>

                {extraCompany && (
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={includeExtraInTotals}
                      onCheckedChange={(v) => setIncludeExtraInTotals(v === true)}
                    />
                    <span className="text-sm text-body">Включить {extraCompany.name} в итоги</span>
                  </label>
                </div>
                )}
              </div>
            )}
          </Card>

          {/* Forecast Banner */}
          {forecast && (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/[0.07] border border-amber-200 dark:border-amber-500/20 p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="grid place-items-center h-12 w-12 shrink-0 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Прогноз на конец периода · точность {forecast.confidence.toFixed(0)}%</p>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-1.5">
                    <span className="text-lg font-semibold text-foreground">
                      Выручка: <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoneyFull(forecast.forecastIncome)}</span>
                    </span>
                    <span className="text-lg font-semibold text-foreground">
                      Прибыль: <span className={`tabular-nums ${forecast.forecastProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatMoneyFull(forecast.forecastProfit)}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">Осталось {forecast.remainingDays} дн.</span>
                  </div>
                  {'note' in forecast && forecast.note ? (
                    <p className="text-xs text-muted-foreground mt-2 max-w-3xl leading-relaxed">{forecast.note}</p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* TAB: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stats Grid */}
              {(() => {
                // Процент к прошлому периоду + словами, куда сдвинулось, и разница в тенге.
                // Цвет решает смысл, а не знак: рост расходов — плохо (красный).
                const pct = (cur: number, prev: number) => (prev !== 0 ? Number(((cur - prev) / Math.abs(prev) * 100).toFixed(1)) : undefined)
                const diff = (cur: number, prev: number) => {
                  const d = cur - prev
                  return d === 0 ? 'без изменений' : `${d > 0 ? '+' : '−'}${formatMoneyFull(Math.abs(d))}`
                }
                const hint = (cur: number, prev: number, up: string, down: string) => (prev === 0 || cur === prev ? undefined : cur > prev ? up : down)
                const was = (cur: number, prev: number) => `было ${formatMoneyFull(prev)} · ${diff(cur, prev)}`
                return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Общая выручка"
                  value={formatMoneyFull(totals.totalIncome)}
                  subValue={comparisonMode ? was(totals.totalIncome, totalsPrev.totalIncome) : `${formatMoneyCompact(totals.incomeCash)} нал / ${formatMoneyCompact(totals.incomeNonCash)} безнал`}
                  icon={DollarSign}
                  trend={totalsPrev.totalIncome > 0 ? pct(totals.totalIncome, totalsPrev.totalIncome) : undefined}
                  trendHint={hint(totals.totalIncome, totalsPrev.totalIncome, 'выручка выросла', 'выручка упала')}
                  color="green"
                  onClick={() => setDrillDown({ type: 'income' })}
                />
                <StatCard
                  title="Расходы"
                  value={formatMoneyFull(totals.totalExpense)}
                  subValue={comparisonMode ? was(totals.totalExpense, totalsPrev.totalExpense) : `${formatMoneyCompact(totals.expenseCash)} нал / ${formatMoneyCompact(totals.expenseKaspi)} безнал`}
                  icon={TrendingDown}
                  trend={totalsPrev.totalExpense > 0 ? pct(totals.totalExpense, totalsPrev.totalExpense) : undefined}
                  trendGood="down"
                  trendHint={hint(totals.totalExpense, totalsPrev.totalExpense, 'расходы выросли', 'расходы снизились')}
                  color="red"
                  onClick={() => setDrillDown({ type: 'expense' })}
                />
                {(() => {
                  // Прибыль как в ОПиУ (без покупки оборудования и выплат партнёрам) —
                  // главная цифра; остаток после них — второй строкой. Раньше здесь был
                  // только остаток, и «прибыль» расходилась с /profitability.
                  const pnl = totals.pnlProfit ?? totals.profit
                  const pnlPrev = totalsPrev.pnlProfit ?? totalsPrev.profit
                  const off = totals.expenseOffPnl || 0
                  const margin = totals.totalIncome > 0 ? (pnl / totals.totalIncome * 100).toFixed(1) : '0'
                  const base = comparisonMode ? was(pnl, pnlPrev) : `Маржа ${margin}%`
                  const rest = off > 0 ? ` · остаток после вложений и выплат партнёрам ${formatMoneyFull(totals.profit)}` : ''
                  return (
                    <StatCard
                      title="Прибыль (как в ОПиУ)"
                      value={formatMoneyFull(pnl)}
                      subValue={base + rest}
                      icon={Wallet}
                      trend={pct(pnl, pnlPrev)}
                      trendHint={hint(pnl, pnlPrev, 'прибыль выросла', 'прибыль упала')}
                      color={pnl >= 0 ? 'blue' : 'red'}
                      onClick={() => setDrillDown({ type: 'profit' })}
                    />
                  )
                })()}
                <StatCard
                  title="Выручка в день"
                  value={perDay ? formatMoneyFull(perDay.income) : '—'}
                  subValue={perDay
                    ? `за ${perDay.days} дн. · сальдо нал ${formatMoneyCompact(totals.remainingCash)} / безнал ${formatMoneyCompact(totals.remainingKaspi)}`
                    : 'период ещё не начался'}
                  trend={perDay && perDay.prevIncome > 0 ? pct(perDay.income, perDay.prevIncome) : undefined}
                  trendHint={perDay ? hint(perDay.income, perDay.prevIncome, 'в день больше', 'в день меньше') : undefined}
                  icon={Activity}
                  color="amber"
                />
              </div>
                )
              })()}

              {/* Payment Types Breakdown */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Наличные', value: totals.incomeCash, color: 'text-emerald-600 dark:text-emerald-400' },
                  { label: cashLabels.providerName, value: totals.incomeKaspi, color: 'text-blue-600 dark:text-blue-400' },
                  { label: 'Онлайн', value: totals.incomeOnline, color: 'text-amber-600 dark:text-amber-400' },
                  { label: 'Карта', value: totals.incomeCard, color: 'text-amber-600 dark:text-amber-400' },
                ].map((item) => (
                  <Card key={item.label} className="gap-0 p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-1">{item.label}</p>
                    <p className={`text-xl font-bold tabular-nums ${item.color}`}>{formatMoneyFull(item.value)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{totals.totalIncome > 0 ? ((item.value / totals.totalIncome) * 100).toFixed(1) : 0}%</p>
                  </Card>
                ))}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 gap-0 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                      <Activity className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                      Динамика финансовых показателей
                      <span className="hidden sm:inline text-xs font-normal text-muted-foreground">· нажмите на точку — операции</span>
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
                    {mounted && <MemoizedComposedChart data={chartData} onBucketClick={openBucket} />}
                  </ChartShell>
                </Card>

                <div className="space-y-6">
                  <ExpenseArticlesCard
                    articles={expenseArticles}
                    totalIncome={totals.totalIncome}
                    onOpen={(article) => setDrillDown({
                      type: 'expense',
                      categories: article.categories.map((c) => c.name),
                      title: `${article.label} — операции`,
                    })}
                  />
                </div>
              </div>

              {/* Bottom Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="gap-0 p-6">
                  <h3 className="text-base font-semibold text-foreground mb-6 flex items-center gap-2">
                    <Store className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                    Выручка по компаниям
                  </h3>
                  
                  <ChartShell height="h-80">
                    {mounted && (
                      <MemoizedBarChart
                        data={incomeByCompanyData}
                        onBarClick={(companyId) => setDrillDown({ type: 'income', companyId, title: `Доходы — ${companyName(companyId)}` })}
                      />
                    )}
                  </ChartShell>
                </Card>

                <Card className="gap-0 p-6">
                  <h3 className="text-base font-semibold text-foreground mb-6 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                    Аномалии и рекомендации
                  </h3>

                  {processed.anomalies.length > 0 ? (
                    <div className="space-y-3 max-h-80 overflow-auto">
                      {processed.anomalies
                        .sort((a, b) => {
                          const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
                          return severityOrder[a.severity] - severityOrder[b.severity]
                        })
                        .map((a, i) => (
                          <AnomalyCard key={i} anomaly={a} />
                        ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                      <CheckCircle2 className="w-16 h-16 mb-4 text-emerald-500/30" />
                      <p>Аномалий не обнаружено</p>
                      <p className="text-sm text-slate-600 mt-1">Все показатели в норме</p>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB: ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="gap-0 p-6">
                  <div className="mb-6">
                    <h3 className="text-base font-semibold text-foreground">
                      {compareWith === 'year' ? 'Сравнение с прошлым годом' : 'Сравнение с прошлым периодом'}
                    </h3>
                    {processed.prevFrom && (
                      <p className="mt-0.5 text-xs text-muted-foreground">было — {formatDateRange(processed.prevFrom, processed.prevTo)}</p>
                    )}
                  </div>
                  <div className="space-y-6">
                    {[
                      { label: 'Выручка', current: totals.totalIncome, previous: totalsPrev.totalIncome, color: 'bg-emerald-500' },
                      { label: 'Расходы', current: totals.totalExpense, previous: totalsPrev.totalExpense, color: 'bg-rose-500' },
                      { label: 'Прибыль', current: totals.profit, previous: totalsPrev.profit, color: 'bg-amber-500' },
                    ].map((item) => {
                      // Прибыль бывает отрицательной: база изменения — модуль, ширина полос — тоже.
                      const change = item.previous !== 0 ? ((item.current - item.previous) / Math.abs(item.previous)) * 100 : null
                      // Рост расходов — плохо, рост выручки и прибыли — хорошо.
                      const good = change === null || change === 0 ? null : (change > 0) === (item.label !== 'Расходы')
                      const max = Math.max(Math.abs(item.current), Math.abs(item.previous), 1)
                      
                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{item.label}</span>
                            <div className="flex gap-4">
                              <span className="text-slate-500">Было: {formatMoneyFull(item.previous)}</span>
                              <span className="text-foreground font-medium">Сейчас: {formatMoneyFull(item.current)}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div 
                              className={`${item.previous < 0 ? 'bg-rose-500' : item.color} opacity-40 h-3.5 rounded-md transition-all duration-500`}
                              style={{ width: `${(Math.abs(item.previous) / max) * 100}%` }}
                            >
                                                          </div>
                            <div 
                              className={`${item.current < 0 ? 'bg-rose-500' : item.color} h-3.5 rounded-md transition-all duration-500`}
                              style={{ width: `${(Math.abs(item.current) / max) * 100}%` }}
                            >
                                                          </div>
                          </div>
                          <div className="flex justify-end">
                            <span className={`text-sm font-semibold tabular-nums ${good === true ? 'text-emerald-600 dark:text-emerald-400' : good === false ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                              {change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                <Card className="gap-0 p-6">
                  <h3 className="text-base font-semibold text-foreground mb-6">Распределение по типам платежей</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Наличные', value: totals.incomeCash, color: 'bg-emerald-500' },
                      { label: cashLabels.providerName, value: totals.incomeKaspi, color: 'bg-blue-500' },
                      { label: 'Онлайн', value: totals.incomeOnline, color: 'bg-amber-500' },
                      { label: 'Карта', value: totals.incomeCard, color: 'bg-amber-500' },
                    ].map((item) => {
                      const pct = totals.totalIncome > 0 ? (item.value / totals.totalIncome) * 100 : 0
                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-body">{item.label}</span>
                            <span className="text-foreground font-medium">{formatMoneyFull(item.value)} ({pct.toFixed(1)}%)</span>
                          </div>
                          <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-full overflow-hidden">
                            <div 
                              className={`${item.color} h-full rounded-full transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              </div>

              <Card className="gap-0 p-6">
                <h3 className="text-base font-semibold text-foreground mb-6">Тепловая карта прибыли</h3>
                <ProfitHeatmap dateFrom={dateFrom} dateTo={dateTo} dailyIncome={dailyIncome} dailyExpense={dailyExpense} onCellClick={openRange} />
              </Card>
            </div>
          )}

          {/* TAB: DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input 
                    placeholder="Поиск по компании, дате, сумме..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="pl-10 bg-white dark:bg-slate-900/40 border-border"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">Показать:</span>
                  <NativeSelect 
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                    className="w-auto cursor-pointer"
                  >
                    <option value={10} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">10</option>
                    <option value={25} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">25</option>
                    <option value={50} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">50</option>
                    <option value={100} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">100</option>
                  </NativeSelect>
                  <span className="text-sm text-slate-500">записей</span>
                  {useVirtualization && (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Виртуализация активна
                    </span>
                  )}
                </div>
              </div>

              <Card className="gap-0 py-0 overflow-hidden">
                <div className="overflow-x-auto" ref={tableContainerRef}>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-800/30">
                        <th className="px-4 py-3 text-left">
                          <Checkbox
                            aria-label="Выбрать все строки"
                            checked={selectedRows.size === (useVirtualization ? filteredRows.length : paginatedRows.length) && (useVirtualization ? filteredRows.length : paginatedRows.length) > 0}
                            onCheckedChange={selectAllRows}
                          />
                        </th>
                        {[
                          { key: 'date', label: 'Дата' },
                          { key: 'type', label: 'Тип' },
                          { key: 'company', label: 'Компания' },
                          { key: 'category', label: 'Категория/Смена' },
                          { key: 'amount', label: 'Сумма', align: 'right' },
                          { key: 'zone', label: 'Зона/Комментарий' },
                        ].map((col) => (
                          <th 
                            key={col.key}
                            className={`px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
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
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {useVirtualization ? (
                        // Virtualized rendering for large datasets
                        <tr style={{ height: `${virtualizer.getTotalSize()}px` }}>
                          <td colSpan={7} className="p-0 relative">
                            {virtualRows.map((virtualRow) => {
                              const row = filteredRows[virtualRow.index]
                              return (
                                <div
                                  key={row.id}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                  className="flex items-center px-4 hover:bg-surface-muted transition-colors"
                                >
                                  <div className="w-8">
                                    <Checkbox
                                      aria-label="Выбрать строку"
                                      checked={selectedRows.has(row.id)}
                                      onCheckedChange={() => toggleRowSelection(row.id)}
                                    />
                                  </div>
                                  <div className="flex-1 px-4 text-sm text-body whitespace-nowrap">{row.date}</div>
                                  <div className="flex-1 px-4">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      row.type === 'income' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    }`}>
                                      {row.type === 'income' ? 'Доход' : 'Расход'}
                                    </span>
                                  </div>
                                  <div className="flex-1 px-4 text-sm text-foreground">{row.companyName}</div>
                                  <div className="flex-1 px-4 text-sm text-body">{row.category || (row.shift ? SHIFT_LABELS[row.shift] : '—')}</div>
                                  <div className="flex-1 px-4 text-sm text-right">
                                    <div className={`font-semibold tabular-nums ${row.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                      {row.type === 'income' ? '+' : '-'}{formatMoneyFull(row.amount)}
                                    </div>
                                  </div>
                                  <div className="flex-1 px-4 text-sm text-muted-foreground truncate">{row.zone || row.comment || '—'}</div>
                                </div>
                              )
                            })}
                          </td>
                        </tr>
                      ) : (
                        // Regular pagination for smaller datasets
                        paginatedRows.map((row) => (
                          <tr 
                            key={row.id} 
                            className={`hover:bg-surface-muted transition-colors ${selectedRows.has(row.id) ? 'bg-amber-500/10' : ''}`}
                          >
                            <td className="px-4 py-3">
                              <Checkbox
                                aria-label="Выбрать строку"
                                checked={selectedRows.has(row.id)}
                                onCheckedChange={() => toggleRowSelection(row.id)}
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-body whitespace-nowrap">{row.date}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                row.type === 'income' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              }`}>
                                {row.type === 'income' ? 'Доход' : 'Расход'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground">{row.companyName}</td>
                            <td className="px-4 py-3 text-sm text-body">
                              {row.category || (row.shift ? SHIFT_LABELS[row.shift] : '—')}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                              <div className={`font-semibold tabular-nums ${row.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {row.type === 'income' ? '+' : '-'}{formatMoneyFull(row.amount)}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                Нал: {formatMoneyCompact(row.cashAmount)} | Безналичный: {formatMoneyCompact(row.kaspiAmount)}
                                {row.onlineAmount ? ` | Online: ${formatMoneyCompact(row.onlineAmount)}` : ''}
                                {row.cardAmount ? ` | Card: ${formatMoneyCompact(row.cardAmount)}` : ''}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                              {row.zone || row.comment || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {filteredRows.length === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    {!rowsReady || rowsLoading ? (
                      <p>Загружаю операции…</p>
                    ) : (
                      <>
                        <p>Записи не найдены</p>
                        <p className="text-sm mt-1">Попробуйте изменить фильтры</p>
                      </>
                    )}
                  </div>
                )}

                {/* Pagination - only show if not using virtualization */}
                {!useVirtualization && totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-white/5">
                    <div className="text-sm text-slate-500">
                      Показано {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredRows.length)} из {filteredRows.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        aria-label="Предыдущая страница"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Страница {currentPage} из {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        aria-label="Следующая страница"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {selectedRows.size > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <span className="text-sm text-amber-700 dark:text-amber-200">Выбрано: {selectedRows.size} записей</span>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                      onClick={() => {
                        const selectedData = detailedRows.filter(r => selectedRows.has(r.id))
                        const rows = selectedData.map(r => [
                          r.date,
                          r.type === 'income' ? 'Доход' : 'Расход',
                          r.companyName,
                          r.category || r.shift || '',
                          String(r.amount),
                          r.zone || r.comment || ''
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
                      className="border-border"
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
                  <Card
                    key={company.id}
                    className="gap-0 p-6 cursor-pointer group"
                    onClick={() => {
                      setCompanyFilter(company.id)
                      setActiveTab('overview')
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold text-foreground group-hover:text-amber-400 transition-colors">{company.name}</h4>
                        <p className="text-sm text-slate-500">{company.transactions} операций</p>
                      </div>
                      <div className={`grid place-items-center h-9 w-9 rounded-lg ${
                        company.profit >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      }`}>
                        {company.profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Выручка</span>
                        <span className="text-foreground font-medium">{formatMoneyFull(company.income)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Расходы</span>
                        <span className="tabular-nums text-rose-600 dark:text-rose-400">{formatMoneyFull(company.expense)}</span>
                      </div>
                      <div className="h-px bg-slate-200 dark:bg-white/5 my-3" />
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Прибыль</span>
                        <span className={`text-lg font-bold tabular-nums ${company.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatMoneyFull(company.profit)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Маржа</span>
                        <span className={`font-semibold tabular-nums ${
                          company.margin >= 30 ? 'text-emerald-600 dark:text-emerald-400' :
                          company.margin >= 15 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                        }`}>
                          {company.margin.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5 grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block">Наличные</span>
                        <span className="text-foreground">+{formatMoneyCompact(company.cashIncome)} / -{formatMoneyCompact(company.cashExpense)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Безналичные</span>
                        <span className="text-foreground">+{formatMoneyCompact(company.kaspiIncome + company.onlineIncome + company.cardIncome)} / -{formatMoneyCompact(company.kaspiExpense)}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <Card className="gap-0 p-6">
                <h3 className="text-base font-semibold text-foreground mb-6">Сравнительная таблица</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/5 text-left text-xs text-slate-500 uppercase">
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
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {companyComparisonData.map((c) => (
                        <tr key={c.id} className="hover:bg-surface-muted">
                          <td className="py-4 pl-4 font-medium text-foreground">{c.name}</td>
                          <td className="py-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoneyFull(c.income)}</td>
                          <td className="py-4 text-right tabular-nums text-rose-600 dark:text-rose-400">{formatMoneyFull(c.expense)}</td>
                          <td className={`py-4 text-right font-bold tabular-nums ${c.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatMoneyFull(c.profit)}
                          </td>
                          <td className="py-4 text-right">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              c.margin >= 30 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                              c.margin >= 15 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                              'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            }`}>
                              {c.margin.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-4 text-right text-body">
                            {formatMoneyCompact(c.cashIncome - c.cashExpense)}
                          </td>
                          <td className="py-4 text-right text-body">
                            {formatMoneyCompact((c.kaspiIncome + c.onlineIncome + c.cardIncome) - c.kaspiExpense)}
                          </td>
                          <td className="py-4 text-center text-muted-foreground">{c.transactions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>

      {/* Drill-down modal */}
      {drillDown && (
        <DrillDownModal
          type={drillDown.type}
          categories={drillDown.categories}
          initialCompanyId={drillDown.companyId}
          title={drillDown.title}
          incomes={rowsReady ? incomes : []}
          expenses={rowsReady ? expenses : []}
          loading={!rowsReady}
          companies={companies}
          companyName={companyName}
          dateFrom={drillDown.from ?? dateFrom}
          dateTo={drillDown.to ?? dateTo}
          onClose={() => setDrillDown(null)}
        />
      )}
    </>
  )
}

// =====================
// EXPORT with Suspense
// =====================
export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsPageSkeleton />}>
      <ReportsContent />
    </Suspense>
  )
}
