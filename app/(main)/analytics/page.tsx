'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import Link from 'next/link'
import { cn } from '@/lib/utils'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import type { DateRange } from 'react-day-picker'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

import {
  CalendarDays,
  ArrowLeft,
  TrendingUp,
  Calculator,
  BarChart3,
  RefreshCcw,
  CalendarRange,
  Info,
  Check,
  Layers,
  Download,
} from 'lucide-react'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// --- Типы ---
type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

// --- Утилиты ---
const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)

const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const formatMoney = (v: number) => Math.round(v).toLocaleString('ru-RU')

// Пт(5), Сб(6), Вс(0) -> Выходные. Остальные -> Будни.
const getDayType = (dateStr: string): 'weekday' | 'weekend' => {
  const d = parseISODateSafe(dateStr)
  const day = d.getDay()
  return day === 0 || day === 5 || day === 6 ? 'weekend' : 'weekday'
}

// --- Welford ---
type StatBucket = { sum: number; count: number; mean: number; m2: number }
const newBucket = (): StatBucket => ({ sum: 0, count: 0, mean: 0, m2: 0 })

const pushValue = (b: StatBucket, x: number) => {
  b.sum += x
  b.count += 1
  const delta = x - b.mean
  b.mean += delta / b.count
  const delta2 = x - b.mean
  b.m2 += delta * delta2
}

const finalize = (b: StatBucket) => {
  const avg = b.count > 0 ? b.mean : 0
  const variance = b.count > 1 ? b.m2 / b.count : 0 // population variance
  const stdDev = Math.sqrt(variance)
  const stability = avg === 0 ? 0 : Math.max(0, 1 - stdDev / avg) * 100
  return { avg, stdDev, stability, sum: b.sum, count: b.count }
}

const rangeLabel = (from?: Date, to?: Date) => {
  if (!from && !to) return 'Выберите период'
  if (from && !to) return format(from, 'dd.MM.yyyy', { locale: ru })
  if (!from && to) return format(to, 'dd.MM.yyyy', { locale: ru })
  return `${format(from!, 'dd.MM.yyyy', { locale: ru })} — ${format(to!, 'dd.MM.yyyy', { locale: ru })}`
}

const dotClassByCode = (code?: string | null) => {
  if (code === 'arena') return 'bg-blue-500'
  if (code === 'ramen') return 'bg-emerald-500'
  if (code === 'extra') return 'bg-purple-500'
  return 'bg-foreground/40'
}

const colorByCode = (code?: string | null): string => {
  if (code === 'arena') return '#3b82f6'
  if (code === 'ramen') return '#10b981'
  if (code === 'extra') return '#a855f7'
  return '#94a3b8'
}

const textColorByCode = (code?: string | null): string => {
  if (code === 'arena') return 'text-blue-400'
  if (code === 'ramen') return 'text-emerald-400'
  if (code === 'extra') return 'text-purple-400'
  return 'text-slate-400'
}

const borderColorByCode = (code?: string | null): string => {
  if (code === 'arena') return 'border-l-blue-500'
  if (code === 'ramen') return 'border-l-emerald-500'
  if (code === 'extra') return 'border-l-purple-500'
  return 'border-l-slate-400'
}

const bgColorByCode = (code?: string | null): string => {
  if (code === 'arena') return 'bg-blue-500'
  if (code === 'ramen') return 'bg-emerald-500'
  if (code === 'extra') return 'bg-purple-500'
  return 'bg-slate-400'
}

export default function AnalyticsPage() {
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)

  // View mode: 'analysis' | 'compare'
  const [viewType, setViewType] = useState<'analysis' | 'compare'>('analysis')

  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const [dateFrom, setDateFrom] = useState(toISODateLocal(startOfYear))
  const [dateTo, setDateTo] = useState(toISODateLocal(new Date()))

  const [companyId, setCompanyId] = useState<'all' | string>('all')

  const lastReqId = useRef(0)
  const [rangeOpen, setRangeOpen] = useState(false)

  // refs: companies
  useEffect(() => {
    const fetchCompanies = async () => {
      const response = await fetch('/api/admin/companies', { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.data) setCompanies(body.data as Company[])
    }
    fetchCompanies()
  }, [])

  const companyMap = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const selectedCompany = useMemo(() => {
    if (companyId === 'all') return null
    return companyMap.get(companyId) ?? null
  }, [companyId, companyMap])

  // When switching to compare mode, reset company filter to 'all'
  useEffect(() => {
    if (viewType === 'compare' && companyId !== 'all') {
      setCompanyId('all')
    }
  }, [viewType, companyId])

  // from > to — меняем местами
  useEffect(() => {
    if (!dateFrom || !dateTo) return
    if (dateFrom > dateTo) {
      setDateFrom(dateTo)
      setDateTo(dateFrom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  const selectedRange: DateRange | undefined = useMemo(() => {
    const from = dateFrom ? parseISODateSafe(dateFrom) : undefined
    const to = dateTo ? parseISODateSafe(dateTo) : undefined
    if (!from && !to) return undefined
    return { from, to }
  }, [dateFrom, dateTo])

  const setPreset = (days: number | 'ytd') => {
    const today = new Date()
    let from: Date
    const to: Date = today

    if (days === 'ytd') from = new Date(today.getFullYear(), 0, 1)
    else {
      from = new Date(today)
      from.setDate(from.getDate() - (days - 1))
    }

    setDateFrom(toISODateLocal(from))
    setDateTo(toISODateLocal(to))
    setRangeOpen(false)
  }

  const loadData = useCallback(async () => {
    const reqId = ++lastReqId.current
    setLoading(true)
    setErrorText(null)

    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    if (viewType !== 'compare' && companyId !== 'all') {
      params.set('company_id', companyId)
    }

    const response = await fetch(`/api/admin/incomes?${params}`, { cache: 'no-store' })
    if (reqId !== lastReqId.current) return

    if (!response.ok) {
      setRows([])
      const body = await response.json().catch(() => null)
      setErrorText(body?.error ?? 'Ошибка загрузки данных')
      setLoading(false)
      return
    }

    const body = await response.json().catch(() => ({ data: [] }))
    setRows((body.data ?? []) as IncomeRow[])
    setLoading(false)
  }, [dateFrom, dateTo, companyId, viewType])

  useEffect(() => {
    loadData()
  }, [loadData])

  // --- Analysis stats ---
  const stats = useMemo(() => {
    const monthsMap = new Map<
      string,
      {
        monthKey: string
        monthName: string
        weekday: StatBucket
        weekend: StatBucket
      }
    >()

    const globalWd = newBucket()
    const globalWe = newBucket()

    for (const r of rows) {
      const total = (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.card_amount ?? 0)
      if (total <= 0) continue

      const monthKey = r.date.slice(0, 7)
      const type = getDayType(r.date)

      if (!monthsMap.has(monthKey)) {
        const d = parseISODateSafe(r.date)
        const mName = d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
        monthsMap.set(monthKey, {
          monthKey,
          monthName: mName.charAt(0).toUpperCase() + mName.slice(1),
          weekday: newBucket(),
          weekend: newBucket(),
        })
      }

      const m = monthsMap.get(monthKey)!
      pushValue(m[type], total)
      if (type === 'weekday') pushValue(globalWd, total)
      else pushValue(globalWe, total)
    }

    const finalGlobalWd = finalize(globalWd)
    const finalGlobalWe = finalize(globalWe)
    const multiplier = finalGlobalWd.avg > 0 ? (finalGlobalWe.avg / finalGlobalWd.avg).toFixed(2) : '—'

    const sortedMonths = Array.from(monthsMap.values())
      .map((m) => ({ ...m, wdStats: finalize(m.weekday), weStats: finalize(m.weekend) }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))

    return {
      global: { weekday: finalGlobalWd, weekend: finalGlobalWe, multiplier },
      months: sortedMonths,
    }
  }, [rows])

  // --- Compare: companyStats ---
  const companyStats = useMemo(() => {
    if (!rows.length || !companies.length) return []
    const totalAll = rows.reduce((s, r) => s + (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.card_amount ?? 0), 0)

    return companies.map(company => {
      const compRows = rows.filter(r => r.company_id === company.id)
      const total = compRows.reduce((s, r) => s + (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.card_amount ?? 0), 0)
      const days = new Set(compRows.map(r => r.date)).size
      const avgPerDay = days > 0 ? total / days : 0
      const share = totalAll > 0 ? (total / totalAll) * 100 : 0
      const txCount = compRows.length

      // best month
      const byMonth = new Map<string, number>()
      for (const r of compRows) {
        const mk = r.date.slice(0, 7)
        byMonth.set(mk, (byMonth.get(mk) ?? 0) + (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.card_amount ?? 0))
      }
      const bestEntry = Array.from(byMonth.entries()).sort((a, b) => b[1] - a[1])[0]
      const bestMonth = bestEntry ? bestEntry[0] : null

      return { company, total, avgPerDay, share, txCount, bestMonth, days }
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total)
  }, [rows, companies])

  // --- Compare: monthlyByCompany ---
  const monthlyByCompany = useMemo(() => {
    const monthsSet = new Set(rows.map(r => r.date.slice(0, 7)))
    const sorted = Array.from(monthsSet).sort()
    return sorted.map(mk => {
      const entry: Record<string, unknown> = {
        month: mk,
        monthName: new Date(mk + '-15').toLocaleString('ru-RU', { month: 'short', year: '2-digit' }),
      }
      for (const company of companies) {
        const total = rows
          .filter(r => r.company_id === company.id && r.date.slice(0, 7) === mk)
          .reduce((s, r) => s + (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.card_amount ?? 0), 0)
        entry[company.id] = total
        entry[company.id + '_name'] = company.name
      }
      return entry
    })
  }, [rows, companies])

  const downloadCSV = async () => {
    const wb = createWorkbook()
    const period = `${dateFrom} — ${dateTo}`
    const analRows = rows.map(row => {
      const company = companyMap.get(row.company_id)
      return {
        date: row.date,
        company: company?.name || row.company_id,
        cash: Math.round(row.cash_amount || 0),
        kaspi: Math.round(row.kaspi_amount || 0),
        card: Math.round(row.card_amount || 0),
        total: Math.round((row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.card_amount || 0)),
      }
    })
    buildStyledSheet(wb, 'Аналитика', 'Аналитика доходов', `Период: ${period} | Строк: ${analRows.length}`, [
      { header: 'Дата', key: 'date', width: 13, type: 'text' },
      { header: 'Компания', key: 'company', width: 22, type: 'text' },
      { header: 'Наличные', key: 'cash', width: 16, type: 'money' },
      { header: 'Kaspi', key: 'kaspi', width: 16, type: 'money' },
      { header: 'Карта', key: 'card', width: 16, type: 'money' },
      { header: 'Итого', key: 'total', width: 16, type: 'money' },
    ], analRows)
    await downloadWorkbook(wb, `analytics_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link href="/income" className="text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
                <h1 className="text-3xl font-bold text-foreground">Аналитика</h1>
              </div>
              <p className="text-muted-foreground text-sm ml-7">
                {viewType === 'compare'
                  ? 'Сравнение точек по выручке за выбранный период'
                  : 'Глубокий анализ: Будни (Пн-Чт) vs Выходные (Пт-Вс)'}
              </p>
              {errorText && <p className="text-sm text-red-400 ml-7 mt-2">{errorText}</p>}
            </div>

            {/* Filters bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/50 backdrop-blur px-2 py-2">

              {/* View mode toggle */}
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/30 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewType('analysis')}
                  className={cn(
                    'h-7 px-3 gap-1.5 text-xs rounded-md transition-colors',
                    viewType === 'analysis'
                      ? 'bg-accent/20 text-accent border border-accent/40'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Анализ
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewType('compare')}
                  className={cn(
                    'h-7 px-3 gap-1.5 text-xs rounded-md transition-colors',
                    viewType === 'compare'
                      ? 'bg-accent/20 text-accent border border-accent/40'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Сравнение точек
                </Button>
              </div>

              <div className="h-8 w-px bg-border/50 hidden md:block" />

              {/* Company (hidden in compare mode) */}
              {viewType !== 'compare' && (
                <div className="flex items-center gap-2 px-2">
                  <span className="text-xs text-muted-foreground">Компания</span>
                  <Select value={companyId} onValueChange={(v) => setCompanyId(v as string)}>
                    <SelectTrigger className="h-9 w-[190px] bg-background/30 border-border/60">
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent className="min-w-[220px]">
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-foreground/40" />
                          Все
                        </span>
                      </SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full', dotClassByCode(c.code))} />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {viewType !== 'compare' && <div className="h-8 w-px bg-border/50 hidden md:block" />}

              {/* Date range */}
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-muted-foreground">Период</span>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset(1)}>Сегодня</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset(7)}>7 дней</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset(30)}>30 дней</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset('ytd')}>YTD</Button>
                <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      className="h-9 justify-between gap-2 bg-background/30 border border-border/60 hover:bg-background/40"
                    >
                      <CalendarRange className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{rangeLabel(selectedRange?.from, selectedRange?.to)}</span>
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent className="w-auto p-3" align="end">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs text-muted-foreground">
                        Выбрано: <b className="text-foreground">{rangeLabel(selectedRange?.from, selectedRange?.to)}</b>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset(7)}>
                          7д
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset(30)}>
                          30д
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPreset('ytd')}>
                          YTD
                        </Button>
                      </div>
                    </div>

                    <Calendar
                      mode="range"
                      selected={selectedRange}
                      onSelect={(r) => {
                        if (!r) return
                        if (r.from) setDateFrom(toISODateLocal(r.from))
                        if (r.to) setDateTo(toISODateLocal(r.to))
                        if (r.from && r.to) setRangeOpen(false)
                      }}
                      numberOfMonths={2}
                      locale={ru}
                      initialFocus
                      className="rounded-md border border-border/40"
                    />

                    <div className="mt-2 flex items-center justify-between">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => {
                          setDateFrom(toISODateLocal(startOfYear))
                          setDateTo(toISODateLocal(new Date()))
                          setRangeOpen(false)
                        }}
                      >
                        Сброс
                      </Button>

                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" />
                        {companyId === 'all' ? 'Все' : (selectedCompany?.name ?? '—')}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Refresh */}
              <Button
                variant="ghost"
                size="icon"
                onClick={loadData}
                className="h-9 w-9 rounded-lg border border-border/40 bg-background/20 hover:bg-background/30"
                title="Обновить"
              >
                <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>

              <Button variant="outline" size="sm" onClick={downloadCSV} disabled={rows.length === 0} className="gap-2 ml-auto">
                <Download className="h-4 w-4" />
                Excel
              </Button>
            </div>
          </div>

          {/* ============================================================ */}
          {/* ANALYSIS VIEW */}
          {/* ============================================================ */}
          {viewType === 'analysis' && (
            <>
              {/* --- KPI BLOCK --- */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="relative overflow-hidden p-6 border-l-4 border-l-blue-500 bg-card/50">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Будни (Пн-Чт)</h3>
                      <p className="text-xs text-muted-foreground mt-1">Средняя выручка за смену</p>
                    </div>
                    <div className="p-2 bg-blue-500/10 rounded-full">
                      <Calculator className="w-5 h-5 text-blue-500" />
                    </div>
                  </div>
                  <div className="text-3xl font-bold font-mono">
                    {formatMoney(stats.global.weekday.avg)} <span className="text-lg text-muted-foreground">₸</span>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border/50 flex justify-between text-xs text-muted-foreground">
                    <span>Смен в базе: <b className="text-foreground">{stats.global.weekday.count}</b></span>
                    <span title={`σ=${formatMoney(stats.global.weekday.stdDev)} ₸`}>
                      Стабильность:{' '}
                      <b className={stats.global.weekday.stability > 70 ? 'text-green-500' : 'text-yellow-500'}>
                        {Math.round(stats.global.weekday.stability)}%
                      </b>
                    </span>
                  </div>
                </Card>

                <Card className="relative overflow-hidden p-6 border-l-4 border-l-purple-500 bg-card/50">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-purple-400 uppercase tracking-widest">Выходные (Пт-Вс)</h3>
                      <p className="text-xs text-muted-foreground mt-1">Средняя выручка за смену</p>
                    </div>
                    <div className="p-2 bg-purple-500/10 rounded-full">
                      <TrendingUp className="w-5 h-5 text-purple-500" />
                    </div>
                  </div>
                  <div className="text-3xl font-bold font-mono text-foreground">
                    {formatMoney(stats.global.weekend.avg)} <span className="text-lg text-muted-foreground">₸</span>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border/50 flex justify-between text-xs text-muted-foreground">
                    <span>Смен в базе: <b className="text-foreground">{stats.global.weekend.count}</b></span>
                    <span title={`σ=${formatMoney(stats.global.weekend.stdDev)} ₸`}>
                      Стабильность:{' '}
                      <b className={stats.global.weekend.stability > 70 ? 'text-green-500' : 'text-yellow-500'}>
                        {Math.round(stats.global.weekend.stability)}%
                      </b>
                    </span>
                  </div>
                </Card>

                <Card className="relative overflow-hidden p-6 border border-accent/30 bg-accent/5 flex flex-col justify-center">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <BarChart3 className="w-24 h-24 text-accent" />
                  </div>

                  <h3 className="text-sm font-bold text-accent uppercase tracking-widest mb-2">Эффективность</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-foreground">x{stats.global.multiplier}</span>
                    <span className="text-sm text-muted-foreground">множитель</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 max-w-[220px]">
                    В выходные заведение зарабатывает в <b>{stats.global.multiplier} раза</b> больше, чем в будни.
                  </p>

                  <div className="mt-4 flex gap-2">
                    <div className="h-1.5 flex-1 bg-blue-500/30 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: '100%' }} />
                    </div>
                    <div className="h-1.5 flex-1 bg-purple-500/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{ width: `${Math.min(100, (stats.global.weekend.avg / (stats.global.weekday.avg || 1)) * 30)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Будни</span>
                    <span>Выходные</span>
                  </div>
                </Card>
              </div>

              {/* --- Monthly Breakdown Table --- */}
              <Card className="border-border bg-card overflow-hidden">
                <div className="p-4 border-b border-border bg-secondary/20 flex items-center justify-between">
                  <h2 className="font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    Динамика по месяцам
                  </h2>
                  <div className="text-[10px] text-muted-foreground flex gap-4">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" />Будни</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500" />Выходные</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/50 bg-secondary/10">
                        <th className="px-6 py-3 text-left font-medium">Месяц</th>
                        <th className="px-6 py-3 text-right font-medium text-blue-400">Ср. Чек (Будни)</th>
                        <th className="px-6 py-3 text-right font-medium text-purple-400">Ср. Чек (Выходные)</th>
                        <th className="px-6 py-3 text-right font-medium">Множитель</th>
                        <th className="px-6 py-3 text-right font-medium">Итого выручка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Загрузка данных...</td></tr>
                      ) : stats.months.map((m) => (
                        <tr key={m.monthKey} className="border-b border-border/30 hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-4 font-medium text-foreground">
                            {m.monthName}
                            <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
                              {m.wdStats.count + m.weStats.count} смен
                            </div>
                          </td>

                          <td className="px-6 py-4 text-right">
                            <div className="font-mono text-blue-200">{formatMoney(m.wdStats.avg)}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">Стаб: {Math.round(m.wdStats.stability)}%</div>
                          </td>

                          <td className="px-6 py-4 text-right relative">
                            <div className="absolute inset-y-2 right-2 w-1 bg-purple-500/10 rounded-full">
                              <div
                                className="absolute bottom-0 w-full bg-purple-500 rounded-full transition-all"
                                style={{ height: `${Math.min(100, (m.weStats.avg / (stats.global.weekend.avg || 1)) * 60)}%` }}
                              />
                            </div>
                            <div className="font-mono font-bold text-purple-300 pr-3">{formatMoney(m.weStats.avg)}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 pr-3">Стаб: {Math.round(m.weStats.stability)}%</div>
                          </td>

                          <td className="px-6 py-4 text-right font-mono">
                            {m.wdStats.avg > 0 ? (
                              <span className={`px-2 py-1 rounded text-xs ${
                                (m.weStats.avg / m.wdStats.avg) > 2.5
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                  : 'bg-secondary text-muted-foreground'
                              }`}>
                                x{(m.weStats.avg / m.wdStats.avg).toFixed(1)}
                              </span>
                            ) : '—'}
                          </td>

                          <td className="px-6 py-4 text-right font-bold text-accent font-mono">
                            {formatMoney(m.wdStats.sum + m.weStats.sum)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!loading && stats.months.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                    <Info className="w-8 h-8 mb-2 opacity-20" />
                    Данных за выбранный период нет
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ============================================================ */}
          {/* COMPARE VIEW */}
          {/* ============================================================ */}
          {viewType === 'compare' && (
            <>
              {loading ? (
                <div className="py-16 text-center text-muted-foreground">Загрузка данных...</div>
              ) : companyStats.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <Info className="w-8 h-8 mb-2 opacity-20" />
                  Данных за выбранный период нет
                </div>
              ) : (
                <>
                  {/* A. KPI cards per company */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {companyStats.map(({ company, total, avgPerDay, share, days, bestMonth }) => (
                      <Card
                        key={company.id}
                        className={cn(
                          'relative overflow-hidden p-6 border-l-4 bg-card/50',
                          borderColorByCode(company.code)
                        )}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <span className={cn('h-3 w-3 rounded-full', dotClassByCode(company.code))} />
                          <h3 className={cn('text-sm font-bold uppercase tracking-widest', textColorByCode(company.code))}>
                            {company.name}
                          </h3>
                        </div>

                        <div className="text-3xl font-bold font-mono text-foreground mb-1">
                          {formatMoney(total)}
                          <span className="text-lg text-muted-foreground ml-1">₸</span>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div className="flex flex-col items-center bg-background/20 rounded-lg p-2">
                            <span className="font-mono font-bold text-foreground text-sm">{formatMoney(avgPerDay)}</span>
                            <span className="mt-0.5 text-[10px]">в среднем/день</span>
                          </div>
                          <div className="flex flex-col items-center bg-background/20 rounded-lg p-2">
                            <span className="font-mono font-bold text-foreground text-sm">{share.toFixed(1)}%</span>
                            <span className="mt-0.5 text-[10px]">доля</span>
                          </div>
                          <div className="flex flex-col items-center bg-background/20 rounded-lg p-2">
                            <span className="font-mono font-bold text-foreground text-sm">{days}</span>
                            <span className="mt-0.5 text-[10px]">дней</span>
                          </div>
                        </div>

                        {bestMonth && (
                          <div className="mt-2 text-[10px] text-muted-foreground">
                            Лучший месяц:{' '}
                            <span className="text-foreground font-medium">
                              {new Date(bestMonth + '-15').toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
                            </span>
                          </div>
                        )}

                        {/* Progress bar */}
                        <div className="mt-3">
                          <div className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all', bgColorByCode(company.code))}
                              style={{ width: `${Math.min(100, share)}%` }}
                            />
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>

                  {/* B. Leader badge */}
                  {companyStats[0] && (
                    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm">
                      <span className="text-lg">🏆</span>
                      <span className="text-muted-foreground">Лидер по выручке:</span>
                      <span className={cn('font-bold', textColorByCode(companyStats[0].company.code))}>
                        {companyStats[0].company.name}
                      </span>
                      <span className="text-muted-foreground">—</span>
                      <span className="font-mono font-bold text-foreground">{formatMoney(companyStats[0].total)} ₸</span>
                      <span className="text-muted-foreground">({companyStats[0].share.toFixed(1)}%)</span>
                    </div>
                  )}

                  {/* C. Monthly grouped bar chart */}
                  {monthlyByCompany.length > 0 && (
                    <Card className="border-border bg-card overflow-hidden">
                      <div className="p-4 border-b border-border bg-secondary/20 flex items-center justify-between">
                        <h2 className="font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-muted-foreground" />
                          Динамика по месяцам
                        </h2>
                        <div className="flex gap-3">
                          {companyStats.map(({ company }) => (
                            <span key={company.id} className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ background: colorByCode(company.code) }}
                              />
                              {company.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="p-4">
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={monthlyByCompany} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="monthName"
                              tick={{ fill: '#94a3b8', fontSize: 11 }}
                              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fill: '#94a3b8', fontSize: 11 }}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                            />
                            <Tooltip
                              contentStyle={{
                                background: '#0f172a',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                              labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}
                              formatter={(value: number, name: string) => {
                                const comp = companies.find(c => c.id === name)
                                return [`${formatMoney(value)} ₸`, comp?.name ?? name]
                              }}
                            />
                            <Legend
                              formatter={(value: string) => {
                                const comp = companies.find(c => c.id === value)
                                return comp?.name ?? value
                              }}
                              wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                            />
                            {companyStats.map(({ company }) => (
                              <Bar
                                key={company.id}
                                dataKey={company.id}
                                fill={colorByCode(company.code)}
                                radius={[3, 3, 0, 0]}
                                maxBarSize={32}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  )}

                  {/* D. Comparison table */}
                  {monthlyByCompany.length > 0 && (
                    <Card className="border-border bg-card overflow-hidden">
                      <div className="p-4 border-b border-border bg-secondary/20">
                        <h2 className="font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
                          <CalendarDays className="w-4 h-4 text-muted-foreground" />
                          Сравнение по месяцам
                        </h2>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/50 bg-secondary/10">
                              <th className="px-4 py-3 text-left font-medium">Месяц</th>
                              {companyStats.map(({ company }) => (
                                <th
                                  key={company.id}
                                  className={cn('px-4 py-3 text-right font-medium', textColorByCode(company.code))}
                                >
                                  {company.name}
                                </th>
                              ))}
                              <th className="px-4 py-3 text-right font-medium">Итого</th>
                              <th className="px-4 py-3 text-right font-medium">Лидер</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyByCompany.map((row) => {
                              const month = row.month as string
                              const monthName = row.monthName as string

                              // row totals per company
                              const compValues = companyStats.map(({ company }) => ({
                                company,
                                value: (row[company.id] as number) ?? 0,
                              }))

                              const rowTotal = compValues.reduce((s, cv) => s + cv.value, 0)
                              const leaderEntry = compValues.reduce((best, cv) =>
                                cv.value > best.value ? cv : best,
                                compValues[0]
                              )

                              return (
                                <tr key={month} className="border-b border-border/30 hover:bg-white/5 transition-colors">
                                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{monthName}</td>

                                  {compValues.map(({ company, value }) => (
                                    <td key={company.id} className="px-4 py-3 text-right">
                                      <span className={cn('font-mono', value > 0 ? textColorByCode(company.code) : 'text-muted-foreground/40')}>
                                        {value > 0 ? formatMoney(value) : '—'}
                                      </span>
                                    </td>
                                  ))}

                                  <td className="px-4 py-3 text-right font-bold font-mono text-foreground">
                                    {formatMoney(rowTotal)}
                                  </td>

                                  <td className="px-4 py-3 text-right">
                                    {leaderEntry && leaderEntry.value > 0 ? (
                                      <span
                                        className={cn(
                                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                                          textColorByCode(leaderEntry.company.code)
                                        )}
                                        style={{
                                          background: colorByCode(leaderEntry.company.code) + '22',
                                          border: `1px solid ${colorByCode(leaderEntry.company.code)}44`,
                                        }}
                                      >
                                        <span
                                          className="w-1.5 h-1.5 rounded-full"
                                          style={{ background: colorByCode(leaderEntry.company.code) }}
                                        />
                                        {leaderEntry.company.name}
                                      </span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>

                          {/* Total row */}
                          <tfoot>
                            <tr className="border-t-2 border-border bg-secondary/20 font-bold">
                              <td className="px-4 py-3 text-foreground uppercase text-xs tracking-wide">Итого за период</td>
                              {companyStats.map(({ company, total }) => (
                                <td key={company.id} className={cn('px-4 py-3 text-right font-mono', textColorByCode(company.code))}>
                                  {formatMoney(total)}
                                </td>
                              ))}
                              <td className="px-4 py-3 text-right font-mono text-foreground">
                                {formatMoney(companyStats.reduce((s, cs) => s + cs.total, 0))}
                              </td>
                              <td className="px-4 py-3" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
    </>
  )
}
