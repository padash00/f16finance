'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  RefreshCw,
  Download,
  CalendarDays,
  Banknote,
  Smartphone,
  Tag,
  Filter,
  ArrowLeft,
  BarChart3,
  PieChart as PieIcon,
  LineChart as LineIcon,
  Search,
} from 'lucide-react'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Legend,
} from 'recharts'

// ================== TYPES ==================
type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type PayFilter = 'all' | 'cash' | 'kaspi'
type DateRangePreset = 'today' | 'week' | 'month' | 'all'
type GroupBy = 'day' | 'week' | 'month'

// ================== CONFIG ==================
const PAGE_SIZE = 200
const MAX_ROWS_HARD_LIMIT = 2000
const SEARCH_MIN_LEN = 2

// ================== DATE HELPERS ==================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)
const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const d = parseISODateSafe(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const clampDateRange = (from: string, to: string) => {
  if (!from || !to) return { from, to }
  if (from <= to) return { from, to }
  return { from: to, to: from }
}

const formatIsoToRu = (iso: string | '') => {
  if (!iso) return '…'
  const d = parseISODateSafe(iso)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatDateRuShort = (iso: string) => {
  const d = parseISODateSafe(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

const rowTotal = (r: ExpenseRow) => (r.cash_amount || 0) + (r.kaspi_amount || 0)

// ISO week start (Mon)
const weekKey = (iso: string) => {
  const d = parseISODateSafe(iso)
  const day = d.getDay() || 7 // Sun=7
  d.setDate(d.getDate() - (day - 1)) // back to Monday
  return toISODateLocal(d)
}

const monthKey = (iso: string) => iso.slice(0, 7) + '-01'

// ================== CSV ==================
const escapeCSV = (value: any) => {
  const s = value === null || value === undefined ? '' : String(value)
  const needsQuotes = s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')
  const escaped = s.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

export default function ExpensesAnalysisPage() {
  // ================== DATA ==================
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ================== FILTERS ==================
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('today')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')

  const [searchTerm, setSearchTerm] = useState('')
  const searchDebounced = useDebouncedValue(searchTerm.trim(), 350)

  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('day')

  // защита от гонок запросов
  const reqIdRef = useRef(0)

  // ================== INIT: COMPANIES ==================
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, code')
        .order('name')
      if (!error && data) setCompanies(data as Company[])
    }
    fetchCompanies()
  }, [])

  // map companies
  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const companyName = useCallback(
    (companyId: string) => companyMap.get(companyId)?.name ?? '—',
    [companyMap]
  )

  // Extra company id
  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => c.code === 'extra' || c.name === 'F16 Extra')
    return extra?.id ?? null
  }, [companies])

  // categories (from loaded rows)
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  // ================== QUERY BUILDER (анализ = грузим всё в лимит) ==================
  const buildQuery = useCallback(
    (forPage: number) => {
      const { from, to } = clampDateRange(dateFrom, dateTo)

      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .range(forPage * PAGE_SIZE, forPage * PAGE_SIZE + PAGE_SIZE - 1)

      // date
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)

      // company/category
      if (companyFilter !== 'all') q = q.eq('company_id', companyFilter)
      if (categoryFilter !== 'all') q = q.eq('category', categoryFilter)

      // pay filter
      if (payFilter === 'cash') q = q.gt('cash_amount', 0)
      if (payFilter === 'kaspi') q = q.gt('kaspi_amount', 0)

      // search (server side)
      const term = searchDebounced
      if (term.length >= SEARCH_MIN_LEN) {
        q = q.or(`comment.ilike.%${term}%,category.ilike.%${term}%`)
      }

      // для анализа лучше стабильно по дате (ASC)
      q = q.order('date', { ascending: true })

      return q
    },
    [dateFrom, dateTo, companyFilter, categoryFilter, payFilter, searchDebounced]
  )

  // ================== LOAD ALL (up to limit) ==================
  const loadAll = useCallback(async () => {
    const myReqId = ++reqIdRef.current
    setLoading(true)
    setError(null)

    try {
      const all: ExpenseRow[] = []
      const maxPages = Math.ceil(MAX_ROWS_HARD_LIMIT / PAGE_SIZE)

      for (let p = 0; p < maxPages; p++) {
        const { data, error } = await buildQuery(p)
        if (myReqId !== reqIdRef.current) return
        if (error) throw error

        const chunk = (data || []) as ExpenseRow[]
        all.push(...chunk)

        if (chunk.length < PAGE_SIZE) break
      }

      setRows(all)
    } catch (e: any) {
      console.error('Error loading expenses analysis:', e)
      if (myReqId !== reqIdRef.current) return
      setError('Ошибка загрузки данных')
      setRows([])
    } finally {
      if (myReqId !== reqIdRef.current) return
      setLoading(false)
    }
  }, [buildQuery])

  // reload when filters changed
  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ================== PRESETS ==================
  const setPreset = (preset: DateRangePreset) => {
    const today = todayISO()
    setActivePreset(preset)

    if (preset === 'today') {
      setDateFrom(today)
      setDateTo(today)
    }
    if (preset === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    }
    if (preset === 'month') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    }
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  const handleDateFromChange = (value: string) => {
    setDateFrom(value)
    setActivePreset(null)
  }
  const handleDateToChange = (value: string) => {
    setDateTo(value)
    setActivePreset(null)
  }

  const periodLabel =
    dateFrom || dateTo ? `${formatIsoToRu(dateFrom)} — ${formatIsoToRu(dateTo)}` : 'Весь период'

  // ================== ANALYTICS ==================
  const analytics = useMemo(() => {
    const effectiveRows =
      companyFilter === 'all' && !includeExtraInTotals && extraCompanyId
        ? rows.filter((r) => r.company_id !== extraCompanyId)
        : rows

    let cash = 0
    let kaspi = 0

    const byCategory: Record<string, { total: number; cash: number; kaspi: number }> = {}
    const byCompany: Record<string, number> = {}
    const byTime: Record<string, { total: number; cash: number; kaspi: number }> = {}

    for (const r of effectiveRows) {
      const c = r.cash_amount || 0
      const k = r.kaspi_amount || 0
      const t = c + k

      cash += c
      kaspi += k

      const cat = r.category || 'Без категории'
      byCategory[cat] = byCategory[cat] || { total: 0, cash: 0, kaspi: 0 }
      byCategory[cat].total += t
      byCategory[cat].cash += c
      byCategory[cat].kaspi += k

      const comp = companyName(r.company_id)
      byCompany[comp] = (byCompany[comp] || 0) + t

      const key =
        groupBy === 'day'
          ? r.date
          : groupBy === 'week'
            ? weekKey(r.date)
            : monthKey(r.date)

      byTime[key] = byTime[key] || { total: 0, cash: 0, kaspi: 0 }
      byTime[key].total += t
      byTime[key].cash += c
      byTime[key].kaspi += k
    }

    const total = cash + kaspi

    const categoriesArr = Object.entries(byCategory)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)

    const companiesArr = Object.entries(byCompany)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)

    const timeArr = Object.entries(byTime)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((p) => ({
        ...p,
        label:
          groupBy === 'day'
            ? formatDateRuShort(p.key)
            : groupBy === 'week'
              ? `Нед ${formatDateRuShort(p.key)}`
              : parseISODateSafe(p.key).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }),
      }))

    const pointsCount = timeArr.length
    const avgPerPoint = pointsCount ? Math.round(total / pointsCount) : 0

    const topCategory = categoriesArr[0]?.name ?? '—'
    const topAmount = categoriesArr[0]?.total ?? 0

    return {
      cash,
      kaspi,
      total,
      topCategory,
      topAmount,
      categoriesArr,
      companiesArr,
      timeArr,
      pointsCount,
      avgPerPoint,
      effectiveRowsCount: effectiveRows.length,
    }
  }, [rows, companyFilter, includeExtraInTotals, extraCompanyId, companyName, groupBy])

  // ================== EXPORT (summary + breakdowns) ==================
  const downloadCSV = () => {
    const SEP = ';'

    const head1 = ['Параметр', 'Значение'].join(SEP)
    const summary = [
      ['Период', periodLabel],
      ['Фильтр компания', companyFilter === 'all' ? 'Все' : companyName(companyFilter)],
      ['Фильтр категория', categoryFilter === 'all' ? 'Все' : categoryFilter],
      ['Фильтр оплата', payFilter],
      ['Поиск', searchDebounced || '—'],
      ['Строк (учтено)', analytics.effectiveRowsCount],
      ['Cash', analytics.cash],
      ['Kaspi', analytics.kaspi],
      ['Итого', analytics.total],
      ['Топ категория', analytics.topCategory],
      ['Топ сумма', analytics.topAmount],
      ['Группировка', groupBy],
    ]
      .map((r) => r.map(escapeCSV).join(SEP))
      .join('\n')

    const headCats = ['Категория', 'Итого', 'Cash', 'Kaspi'].join(SEP)
    const cats = analytics.categoriesArr
      .map((c) => [c.name, c.total, c.cash, c.kaspi].map(escapeCSV).join(SEP))
      .join('\n')

    const headComps = ['Компания', 'Итого'].join(SEP)
    const comps = analytics.companiesArr
      .map((c) => [c.name, c.total].map(escapeCSV).join(SEP))
      .join('\n')

    const headTime = ['Период', 'Итого', 'Cash', 'Kaspi'].join(SEP)
    const time = analytics.timeArr
      .map((p) => [p.key, p.total, p.cash, p.kaspi].map(escapeCSV).join(SEP))
      .join('\n')

    const lines = [
      head1,
      summary,
      '',
      'Категории',
      headCats,
      cats,
      '',
      'Компании',
      headComps,
      comps,
      '',
      'Динамика',
      headTime,
      time,
    ].join('\n')

    const blob = new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `expenses_analysis_${todayISO()}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const chartStrokeTotal = 'hsl(var(--accent))'
  const chartStrokeCash = 'hsl(var(--foreground))'
  const chartStrokeKaspi = 'hsl(var(--muted-foreground))'

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link href="/expenses" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" />
                  Назад к журналу
                </Link>
              </div>
              <h1 className="text-4xl font-bold text-foreground">Анализ расходов</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Сводка, категории, компании, динамика (без “табличной боли”)
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={loadAll}
                disabled={loading}
                className="gap-2 text-xs"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={downloadCSV}
                disabled={loading || rows.length === 0}
                className="gap-2 text-xs"
              >
                <Download className="w-4 h-4" />
                Экспорт отчёта
              </Button>

              <Link href="/expenses/add">
                <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2 text-xs">
                  + Добавить расход
                </Button>
              </Link>
            </div>
          </div>

          {/* Filters */}
          <Card className="p-4 border-border bg-card neon-glow">
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
              {/* Dates */}
              <div className="flex flex-col gap-2 w-full lg:w-auto">
                <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Период
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center bg-input/50 rounded-md border border-border/50 px-2 py-1">
                    <CalendarDays className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => handleDateFromChange(e.target.value)}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                    <span className="text-muted-foreground text-xs px-1">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => handleDateToChange(e.target.value)}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                  </div>

                  <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-3 py-1 text-[10px] rounded transition-colors ${
                          activePreset === p
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-white/10 text-muted-foreground'
                        }`}
                      >
                        {p === 'today' && 'Сегодня'}
                        {p === 'week' && 'Неделя'}
                        {p === 'month' && '30 дн.'}
                        {p === 'all' && 'Всё'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dropdowns + search */}
              <div className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Компания</label>
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[150px]"
                  >
                    <option value="all">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Категория</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[160px]"
                  >
                    <option value="all">Все категории</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Оплата</label>
                  <select
                    value={payFilter}
                    onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[120px]"
                  >
                    <option value="all">Любая</option>
                    <option value="cash">Нал</option>
                    <option value="kaspi">Kaspi</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Группировка</label>
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[140px]"
                  >
                    <option value="day">По дням</option>
                    <option value="week">По неделям</option>
                    <option value="month">По месяцам</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                  <label className="text-[10px] text-muted-foreground">Поиск (сервер)</label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Зарплата, аренда..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full h-9 pl-8 pr-2 bg-input border border-border rounded text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-accent transition-colors"
                    />
                  </div>
                  {searchTerm.trim().length > 0 && searchTerm.trim().length < SEARCH_MIN_LEN && (
                    <div className="text-[10px] text-muted-foreground/70">
                      Введите минимум {SEARCH_MIN_LEN} символа
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 rounded text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          {/* KPI */}
          <Card className="p-4 border-border bg-card/70 neon-glow space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Banknote className="w-4 h-4 text-red-400" />
                  <span className="text-xs uppercase tracking-wide">Наличные</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.cash)} ₸</div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Smartphone className="w-4 h-4 text-red-400" />
                  <span className="text-xs uppercase tracking-wide">Kaspi</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.kaspi)} ₸</div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center border-l-4 border-l-red-500/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tag className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs uppercase tracking-wide">Топ категория</span>
                </div>
                <div className="text-sm font-bold text-foreground truncate" title={analytics.topCategory}>
                  {analytics.topCategory}
                </div>
                <div className="text-xs text-muted-foreground">{formatMoney(analytics.topAmount)} ₸</div>
              </Card>

              <Card className="p-4 border border-red-500/40 bg-red-500/10 flex flex-col justify-center">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Всего расход</div>
                <div className="text-2xl font-bold text-red-400">{formatMoney(analytics.total)} ₸</div>
                {companyFilter === 'all' && (
                  <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                        includeExtraInTotals
                          ? 'border-red-400 text-red-400 bg-red-500/10'
                          : 'border-border text-muted-foreground'
                      } cursor-pointer select-none`}
                      onClick={() => setIncludeExtraInTotals((v) => !v)}
                      title="Включить/исключить F16 Extra из итогов (строки всё равно грузятся, просто не считаются)"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          includeExtraInTotals ? 'bg-red-400' : 'bg-muted-foreground/40'
                        }`}
                      />
                      Extra в итогах
                    </span>
                  </div>
                )}
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                  Среднее / {groupBy === 'day' ? 'день' : groupBy === 'week' ? 'неделю' : 'месяц'}
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.avgPerPoint)} ₸</div>
                <div className="text-[11px] text-muted-foreground">
                  Точек: <span className="font-semibold text-foreground">{analytics.pointsCount}</span>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                <span className="uppercase tracking-wide">Период:</span>
                <span className="font-mono">{periodLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-3 h-3" />
                Учтено строк: <span className="font-semibold text-foreground">{analytics.effectiveRowsCount}</span>
                {rows.length >= MAX_ROWS_HARD_LIMIT && (
                  <span className="text-[10px] text-yellow-500/90">(достигнут лимит {MAX_ROWS_HARD_LIMIT})</span>
                )}
              </div>
            </div>
          </Card>

          {/* CHARTS */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Time series */}
            <Card className="p-4 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <LineIcon className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold">Динамика расходов</h3>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Cash + Kaspi
                </div>
              </div>

              <div className="h-[320px]">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground animate-pulse">
                    Загрузка...
                  </div>
                ) : analytics.timeArr.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Нет данных для графика
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analytics.timeArr} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} width={80} tickFormatter={(v) => formatMoney(v)} />
                      <Tooltip
                        formatter={(value: any) => `${formatMoney(Number(value))} ₸`}
                        labelFormatter={(label: any) => String(label)}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="total" name="Итого" stroke={chartStrokeTotal} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="cash" name="Cash" stroke={chartStrokeCash} strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="kaspi" name="Kaspi" stroke={chartStrokeKaspi} strokeWidth={1} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Categories bar */}
            <Card className="p-4 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold">Топ категорий</h3>
                </div>
                <div className="text-[11px] text-muted-foreground">по сумме</div>
              </div>

              <div className="h-[320px]">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground animate-pulse">
                    Загрузка...
                  </div>
                ) : analytics.categoriesArr.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics.categoriesArr.slice(0, 10).map((c) => ({
                        name: c.name.length > 16 ? c.name.slice(0, 16) + '…' : c.name,
                        total: c.total,
                      }))}
                      margin={{ top: 10, right: 10, left: 0, bottom: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 11 }} width={80} tickFormatter={(v) => formatMoney(v)} />
                      <Tooltip formatter={(value: any) => `${formatMoney(Number(value))} ₸`} />
                      <Bar dataKey="total" name="Итого" fill={chartStrokeTotal} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Companies pie */}
            <Card className="p-4 border-border bg-card neon-glow xl:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PieIcon className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold">Доля компаний</h3>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  (если “все компании” — полезно сразу)
                </div>
              </div>

              <div className="h-[320px]">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground animate-pulse">
                    Загрузка...
                  </div>
                ) : analytics.companiesArr.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value: any) => `${formatMoney(Number(value))} ₸`} />
                      <Legend />
                      <Pie
                        data={analytics.companiesArr.slice(0, 12)}
                        dataKey="total"
                        nameKey="name"
                        innerRadius={70}
                        outerRadius={120}
                        paddingAngle={2}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* Small hint */}
          <Card className="p-4 border-border bg-card/60">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="text-yellow-500">⚡</span>
              Анализ грузит данные “пачками” до лимита {MAX_ROWS_HARD_LIMIT}. Если надо анализ за год — делаем серверную агрегацию (RPC) и будет летать.
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
