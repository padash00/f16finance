'use client'

/**
 * Цели и план — переделанная страница.
 *
 * Логика:
 *  - Страница ВСЕГДА показывает фактические цифры (выручка/прибыль/маржа/чеки/средний чек)
 *    по выбранному периоду, даже если планов нет.
 *  - Если есть план — рядом с фактом маленький бейдж с целью и % выполнения,
 *    появляется прогресс-бар.
 *  - Дизайн: hero KPI карточки сверху, плитки месяцев, glass-стилистика.
 *  - Клик по месяцу → детали месяца с графиком динамики.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  Loader2,
  Lock,
  Percent,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  X,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isAbortError } from '@/lib/is-abort-error'

// ─── Типы ───────────────────────────────────────────────────────────────────

type Metric = 'revenue' | 'profit' | 'margin'
type PeriodKind = 'year' | 'h1' | 'h2' | 'month'

type Company = { id: string; name: string; code?: string | null }

type Plan = {
  id: string
  company_id: string | null
  kind: string
  period_kind: PeriodKind | null
  metric: Metric | null
  target_amount: number
  period_start: string
  period_end: string
  fact_value: number
  achievement_pct: number
  is_closed: boolean
}

type DailyAggregate = {
  date: string
  company_id: string | null
  revenue: number
  expenses: number
  checks: number
}

type PriorMonthlyRow = {
  company_id: string | null
  month: number
  revenue: number
  expenses: number
  checks: number
}

type ApiResponse = {
  ok: boolean
  data?: {
    year: number
    companies: Company[]
    plans: Plan[]
    dailyAggregates?: DailyAggregate[]
    priorYearMonthly?: PriorMonthlyRow[]
  }
  error?: string
}

// ─── Константы ──────────────────────────────────────────────────────────────

const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTH_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const METRICS: Array<{ value: Metric; label: string; unit: string; icon: any; accent: string }> = [
  { value: 'revenue', label: 'Выручка', unit: '₸', icon: TrendingUp, accent: 'emerald' },
  { value: 'profit', label: 'Прибыль', unit: '₸', icon: Coins, accent: 'amber' },
  { value: 'margin', label: 'Маржа', unit: '%', icon: Percent, accent: 'amber' },
]

const PERIOD_LABEL: Record<PeriodKind, string> = {
  year: 'Год',
  h1: 'I полугодие',
  h2: 'II полугодие',
  month: 'Месяц',
}

const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU')
const metricMeta = (m: Metric) => METRICS.find((x) => x.value === m)!
const accentClasses = (accent: string) => {
  const map: Record<string, { border: string; bg: string; text: string; fill: string }> = {
    emerald: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.06]', text: 'text-emerald-700 dark:text-emerald-300', fill: '#10b981' },
    amber: { border: 'border-amber-500/30', bg: 'bg-amber-500/[0.06]', text: 'text-amber-700 dark:text-amber-300', fill: '#f59e0b' },
    rose: { border: 'border-rose-500/30', bg: 'bg-rose-500/[0.06]', text: 'text-rose-700 dark:text-rose-300', fill: '#f43f5e' },
  }
  return map[accent] || map.emerald
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function periodBounds(period: PeriodKind, year: number, monthIdx?: number): { start: string; end: string } {
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (period === 'h1') return { start: `${year}-01-01`, end: `${year}-06-30` }
  if (period === 'h2') return { start: `${year}-07-01`, end: `${year}-12-31` }
  const m = String((monthIdx || 0) + 1).padStart(2, '0')
  const last = new Date(year, (monthIdx || 0) + 1, 0).getDate()
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${String(last).padStart(2, '0')}` }
}

function computeFacts(daily: DailyAggregate[], companyId: string | null, start: string, end: string) {
  let revenue = 0, expenses = 0, checks = 0
  for (const r of daily) {
    if (r.date < start || r.date > end) continue
    if (companyId == null) {
      if (r.company_id !== null) continue
    } else {
      if (r.company_id !== companyId) continue
    }
    revenue += r.revenue
    expenses += r.expenses
    checks += r.checks
  }
  const profit = revenue - expenses
  return {
    revenue: Math.round(revenue),
    expenses: Math.round(expenses),
    profit: Math.round(profit),
    checks,
    avg_check: checks > 0 ? Math.round(revenue / checks) : 0,
    margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
  }
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = []
  const a = new Date(`${start}T00:00:00Z`)
  const b = new Date(`${end}T00:00:00Z`)
  for (let d = new Date(a); d.getTime() <= b.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// ─── «Умные» helpers: сезонность, run-rate, аллокация ──────────────────────

/**
 * Веса месяцев по прошлогодним фактам.
 * Если данных за прошлый год по этой метрике нет → равномерно 1/12.
 * Аддитивные метрики: revenue/expenses/checks. Для profit считаем revenue - expenses.
 */
function seasonalWeights(
  priorMonthly: PriorMonthlyRow[],
  metric: 'revenue' | 'profit',
  companyId: string | null,
): number[] {
  const totals = new Array(12).fill(0) as number[]
  for (const r of priorMonthly) {
    if ((companyId == null && r.company_id !== null) || (companyId != null && r.company_id !== companyId)) continue
    const m = r.month - 1
    if (m < 0 || m > 11) continue
    if (metric === 'revenue') totals[m] += r.revenue
    else if (metric === 'profit') totals[m] += r.revenue - r.expenses
  }
  const sum = totals.reduce((s, v) => s + Math.max(0, v), 0)
  if (sum <= 0) return new Array(12).fill(1 / 12)
  return totals.map((v) => Math.max(0, v) / sum)
}

/**
 * Доля каждой точки в общем (для аллокации общего плана по точкам).
 * Берётся YTD выручка. Если её нет — fallback на прошлогоднюю выручку.
 */
function companyShares(
  daily: DailyAggregate[],
  priorMonthly: PriorMonthlyRow[],
  companies: Company[],
): Map<string, number> {
  const shares = new Map<string, number>()
  const ytd = new Map<string, number>()
  let ytdTotal = 0
  for (const r of daily) {
    if (!r.company_id) continue
    ytd.set(r.company_id, (ytd.get(r.company_id) || 0) + r.revenue)
    ytdTotal += r.revenue
  }
  if (ytdTotal > 0) {
    for (const c of companies) shares.set(c.id, (ytd.get(c.id) || 0) / ytdTotal)
    return shares
  }
  // fallback на прошлый год
  const prior = new Map<string, number>()
  let priorTotal = 0
  for (const r of priorMonthly) {
    if (!r.company_id) continue
    prior.set(r.company_id, (prior.get(r.company_id) || 0) + r.revenue)
    priorTotal += r.revenue
  }
  if (priorTotal > 0) {
    for (const c of companies) shares.set(c.id, (prior.get(c.id) || 0) / priorTotal)
    return shares
  }
  // совсем нет данных — равные доли
  for (const c of companies) shares.set(c.id, 1 / Math.max(1, companies.length))
  return shares
}

/**
 * Run-rate прогноз для текущего месяца.
 * Берёт средний дневной факт по уже прошедшим дням и экстраполирует на всё число дней в месяце.
 */
function runRateForecast(params: {
  daily: DailyAggregate[]
  companyId: string | null
  year: number
  monthIdx: number
  metric: 'revenue' | 'profit'
}): { forecast: number; daysPassed: number; daysTotal: number; dailyAvg: number } | null {
  const today = new Date()
  const isCurrentMonth = today.getFullYear() === params.year && today.getMonth() === params.monthIdx
  if (!isCurrentMonth) return null
  const lastDay = new Date(params.year, params.monthIdx + 1, 0).getDate()
  const daysPassed = Math.max(1, today.getDate())
  let value = 0
  const mm = String(params.monthIdx + 1).padStart(2, '0')
  for (const r of params.daily) {
    if (!r.date.startsWith(`${params.year}-${mm}-`)) continue
    if (params.companyId == null) {
      if (r.company_id !== null) continue
    } else {
      if (r.company_id !== params.companyId) continue
    }
    if (params.metric === 'revenue') value += r.revenue
    else if (params.metric === 'profit') value += r.revenue - r.expenses
  }
  const dailyAvg = value / daysPassed
  return { forecast: dailyAvg * lastDay, daysPassed, daysTotal: lastDay, dailyAvg }
}

function buildSeries(params: {
  daily: DailyAggregate[]
  companyId: string | null
  start: string
  end: string
  metric: Metric
  target: number
}) {
  const dates = enumerateDates(params.start, params.end)
  if (dates.length === 0) return []
  const todayKey = new Date().toISOString().slice(0, 10)
  const factByDate = new Map<string, { revenue: number; expenses: number; checks: number }>()
  for (const r of params.daily) {
    if (r.date < params.start || r.date > params.end) continue
    if (params.companyId == null) {
      if (r.company_id !== null) continue
    } else {
      if (r.company_id !== params.companyId) continue
    }
    const cur = factByDate.get(r.date) || { revenue: 0, expenses: 0, checks: 0 }
    cur.revenue += r.revenue
    cur.expenses += r.expenses
    cur.checks += r.checks
    factByDate.set(r.date, cur)
  }
  let cumR = 0, cumE = 0, cumC = 0
  const totalDays = dates.length
  return dates.map((day, i) => {
    const t = factByDate.get(day)
    if (t) {
      cumR += t.revenue
      cumE += t.expenses
      cumC += t.checks
    }
    let factValue: number | null = null
    if (day <= todayKey) {
      switch (params.metric) {
        case 'revenue': factValue = Math.round(cumR); break
        case 'profit': factValue = Math.round(cumR - cumE); break
        case 'margin': factValue = cumR > 0 ? Math.round(((cumR - cumE) / cumR) * 1000) / 10 : 0; break
      }
    }
    const targetValue = params.target > 0
      ? params.metric === 'margin'
        ? params.target
        : Math.round((params.target * (i + 1)) / totalDays)
      : 0
    return {
      day: `${day.slice(8, 10)}.${day.slice(5, 7)}`,
      Факт: factValue,
      Цель: params.target > 0 ? targetValue : null,
    }
  })
}

// ─── Компонент ──────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [tab, setTab] = useState<PeriodKind>('year')
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeMetric, setActiveMetric] = useState<Metric>('revenue')
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    period_kind: 'month' as PeriodKind,
    month_idx: new Date().getMonth(),
    company_id: 'all' as string,
    revenue: '',
    expense: '',
    distributeSeasonal: true, // для года: разлить по месяцам с учётом сезонности
  })
  const [saving, setSaving] = useState(false)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kpi-plans?year=${year}`, { cache: 'no-store', signal })
      const j = (await res.json().catch(() => null)) as ApiResponse | null
      if (signal?.aborted) return
      if (!res.ok || !j?.ok || !j.data) throw new Error(j?.error || 'Не удалось загрузить')
      setData(j.data)
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      if (!soft) setData(null)
      setError(err?.message || 'Не удалось загрузить')
    } finally {
      if (!signal?.aborted) {
        if (soft) setRefreshing(false)
        else setLoading(false)
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  const companies = data?.companies || []
  const plans = data?.plans || []
  const daily = data?.dailyAggregates || []
  const priorMonthly = data?.priorYearMonthly || []

  // Факты для каждого периода и месяца — org-wide.
  const periodFacts = useMemo(() => {
    const get = (period: PeriodKind, monthIdx?: number) => {
      const { start, end } = periodBounds(period, year, monthIdx)
      return computeFacts(daily, null, start, end)
    }
    return {
      year: get('year'),
      h1: get('h1'),
      h2: get('h2'),
      months: Array.from({ length: 12 }, (_, i) => get('month', i)),
    }
  }, [daily, year])

  // Планы по периоду + месяцу + метрике + компании.
  const planFor = (period: PeriodKind, monthIdx: number | null, metric: Metric, companyId: string | null) => {
    return plans.find((p) =>
      p.period_kind === period &&
      p.metric === metric &&
      ((!p.company_id && !companyId) || p.company_id === companyId) &&
      (period !== 'month' || (monthIdx != null && p.period_start.slice(5, 7) === String(monthIdx + 1).padStart(2, '0'))),
    )
  }

  // KPI hero для текущей вкладки (org-wide)
  const tabFacts = useMemo(() => {
    if (tab === 'month') return null
    return periodFacts[tab]
  }, [tab, periodFacts])

  const parseMoneyInput = (raw: string) =>
    Number(String(raw).replace(/\s/g, '').replace(',', '.'))

  const handleAddPlan = async () => {
    const revenue = parseMoneyInput(form.revenue)
    const expense = parseMoneyInput(form.expense)
    if (!Number.isFinite(revenue) || revenue <= 0) {
      setError('Введите выручку больше 0')
      return
    }
    if (!Number.isFinite(expense) || expense < 0) {
      setError('Расходы не могут быть отрицательными')
      return
    }
    const profit = revenue - expense
    const companyId = form.company_id === 'all' ? null : form.company_id

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      // Сохраняем сразу 2 плана: выручка и прибыль (расходы выводятся как
      // revenue - profit, маржа считается из (profit/revenue)*100).
      const payloads: Array<{ metric: Metric; target_amount: number }> = [
        { metric: 'revenue', target_amount: revenue },
        { metric: 'profit', target_amount: profit },
      ]

      // Сценарий 1: годовая цель + опция «распределить по сезонности» →
      // создаём 12 месячных планов с весами из прошлогоднего факта.
      const distribute = form.period_kind === 'year' && form.distributeSeasonal
      if (distribute) {
        const reqs: Array<Promise<Response>> = []
        for (const p of payloads) {
          const weights = seasonalWeights(priorMonthly, p.metric as 'revenue' | 'profit', companyId)
          for (let m = 0; m < 12; m++) {
            const share = Math.round(p.target_amount * weights[m])
            if (share <= 0) continue
            reqs.push(
              fetch('/api/admin/kpi-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  year,
                  period_kind: 'month',
                  month_idx: m,
                  metric: p.metric,
                  company_id: companyId,
                  target_amount: share,
                }),
              }),
            )
          }
        }
        const results = await Promise.all(reqs)
        for (const r of results) {
          const j = await r.json().catch(() => null)
          if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось сохранить (распределение)')
        }
      } else {
        // Сценарий 2: обычное сохранение в одном периоде.
        for (const p of payloads) {
          const res = await fetch('/api/admin/kpi-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              year,
              period_kind: form.period_kind,
              month_idx: form.period_kind === 'month' ? form.month_idx : undefined,
              metric: p.metric,
              company_id: companyId,
              target_amount: p.target_amount,
            }),
          })
          const j = await res.json().catch(() => null)
          if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось сохранить')
        }
      }

      setSuccess(distribute ? 'Цель сохранена и разлита по месяцам' : 'Цель сохранена')
      setTimeout(() => setSuccess(null), 2400)
      setDialogOpen(false)
      setForm((f) => ({ ...f, revenue: '', expense: '' }))
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (planId: string) => {
    if (!window.confirm('Удалить план?')) return
    try {
      const res = await fetch(`/api/admin/kpi-plans?id=${encodeURIComponent(planId)}`, { method: 'DELETE' })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось удалить')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить')
    }
  }

  const openMonthDetail = (idx: number) => {
    setSelectedMonth(idx)
  }

  return (
    <div className="app-page-wide relative">
      {/* Декоративные акценты */}
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative space-y-6">
        {/* Header */}
        <AdminPageHeader
          title="Цели и план"
          description="Реальные цифры по периодам · план накладывается поверх"
          icon={<Target className="h-5 w-5" />}
          accent="emerald"
          backHref="/"
          actions={
            <>
              <div className="flex items-center gap-0.5 rounded-xl border border-border bg-white dark:bg-white/[0.04] p-0.5">
                <button onClick={() => setYear((y) => y - 1)} disabled={loading} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-4 text-sm font-semibold tabular-nums">{year}</span>
                <button onClick={() => setYear((y) => Math.min(currentYear + 1, y + 1))} disabled={loading || year >= currentYear + 1} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <button onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-white dark:bg-white/[0.04] text-muted-foreground transition hover:bg-slate-100 dark:hover:bg-white/[0.08] hover:text-foreground disabled:opacity-50" title="Обновить">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setDialogOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:from-amber-700 hover:to-amber-700">
                <Plus className="h-4 w-4" />
                Новая цель
              </button>
            </>
          }
          toolbar={
            <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-1">
              {(['year', 'h1', 'h2', 'month'] as PeriodKind[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setTab(p); setSelectedMonth(null) }}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    tab === p
                      ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow shadow-amber-500/20'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          }
        />

        {error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">{success}</div>
        ) : null}

        {loading && !data ? (
          <div className="grid place-items-center rounded-2xl border border-border bg-white dark:bg-white/[0.02] p-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="mt-2">Грузим данные за {year}…</span>
          </div>
        ) : (
          <>
            {tab === 'month' ? (
              <MonthGrid
                year={year}
                periodFacts={periodFacts.months}
                plans={plans}
                daily={daily}
                onOpenMonth={openMonthDetail}
              />
            ) : (
              <PeriodView
                tab={tab}
                facts={tabFacts!}
                plans={plans}
                companies={companies}
                daily={daily}
                priorMonthly={priorMonthly}
                year={year}
                activeMetric={activeMetric}
                setActiveMetric={setActiveMetric}
                onDelete={handleDelete}
              />
            )}
          </>
        )}

        {/* Модалка месяца */}
        {selectedMonth != null ? (
          <MonthDetailDialog
            year={year}
            monthIdx={selectedMonth}
            facts={periodFacts.months[selectedMonth]}
            plans={plans.filter((p) => p.period_kind === 'month' && p.period_start.slice(5, 7) === String(selectedMonth + 1).padStart(2, '0'))}
            companies={companies}
            daily={daily}
            priorMonthly={priorMonthly}
            onClose={() => setSelectedMonth(null)}
            onDelete={handleDelete}
          />
        ) : null}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Новая цель</DialogTitle>
              <DialogDescription>
                Заполни выручку и расходы — прибыль и маржа посчитаются автоматически.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Период</Label>
                  <Select value={form.period_kind} onValueChange={(v) => setForm((f) => ({ ...f, period_kind: v as PeriodKind }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="month">Месяц</SelectItem>
                      <SelectItem value="h1">I полугодие</SelectItem>
                      <SelectItem value="h2">II полугодие</SelectItem>
                      <SelectItem value="year">Год</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.period_kind === 'month' ? (
                  <div className="space-y-1.5">
                    <Label>Месяц</Label>
                    <Select value={String(form.month_idx)} onValueChange={(v) => setForm((f) => ({ ...f, month_idx: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTH_FULL.map((m, idx) => (
                          <SelectItem key={idx} value={String(idx)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Год</Label>
                    <div className="grid h-10 place-items-center rounded-lg border border-border bg-white dark:bg-white/[0.03] text-sm tabular-nums">
                      {year}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Точка</Label>
                <Select value={form.company_id} onValueChange={(v) => setForm((f) => ({ ...f, company_id: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Общий по организации</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-emerald-700 dark:text-emerald-300">Выручка, ₸</Label>
                  <Input
                    value={form.revenue}
                    onChange={(e) => setForm((f) => ({ ...f, revenue: e.target.value }))}
                    placeholder="0"
                    inputMode="numeric"
                    className="h-11 text-base tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-rose-700 dark:text-rose-300">Расходы, ₸</Label>
                  <Input
                    value={form.expense}
                    onChange={(e) => setForm((f) => ({ ...f, expense: e.target.value }))}
                    placeholder="0"
                    inputMode="numeric"
                    className="h-11 text-base tabular-nums"
                  />
                </div>
              </div>

              {/* Авто-рассчёт прибыли и маржи */}
              {(() => {
                const rev = parseMoneyInput(form.revenue) || 0
                const exp = parseMoneyInput(form.expense) || 0
                const prof = rev - exp
                const margin = rev > 0 ? (prof / rev) * 100 : 0
                return (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Прибыль</p>
                        <p className={`mt-1 text-xl font-bold tabular-nums ${prof >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {fmt(prof)} ₸
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Маржа</p>
                        <p className={`mt-1 text-xl font-bold tabular-nums ${margin >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {margin.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Считается автоматически по введённым выручке и расходам.
                    </p>
                  </div>
                )
              })()}

              {/* Сезонность: только для года */}
              {form.period_kind === 'year' ? (() => {
                const rev = parseMoneyInput(form.revenue) || 0
                const exp = parseMoneyInput(form.expense) || 0
                const prof = rev - exp
                const companyId = form.company_id === 'all' ? null : form.company_id
                const wRev = seasonalWeights(priorMonthly, 'revenue', companyId)
                const wProf = seasonalWeights(priorMonthly, 'profit', companyId)
                const hasPriorData = priorMonthly.some((r) => (companyId == null ? !r.company_id : r.company_id === companyId) && (r.revenue !== 0 || r.expenses !== 0))
                return (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.distributeSeasonal}
                        onChange={(e) => setForm((f) => ({ ...f, distributeSeasonal: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 accent-amber-500"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">Разлить по месяцам с учётом сезонности</p>
                        <p className="text-[11px] text-muted-foreground">
                          {hasPriorData
                            ? `Веса берутся из факта ${year - 1} года. Создастся 12 месячных целей.`
                            : `За ${year - 1} нет данных — разольётся равномерно (по 1/12).`}
                        </p>
                      </div>
                    </label>
                    {form.distributeSeasonal && rev > 0 ? (
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                        {MONTH_SHORT.map((mLabel, idx) => {
                          const shareRev = Math.round(rev * wRev[idx])
                          const shareProf = Math.round(prof * wProf[idx])
                          return (
                            <div key={idx} className="rounded-lg border border-border bg-white dark:bg-white/[0.02] px-2 py-1.5 text-center">
                              <p className="text-[9px] uppercase text-muted-foreground">{mLabel}</p>
                              <p className="text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(shareRev / 1000)}k</p>
                              <p className="text-[10px] tabular-nums text-amber-700 dark:text-amber-300">{fmt(shareProf / 1000)}k</p>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })() : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button onClick={handleAddPlan} disabled={saving} className="bg-gradient-to-r from-amber-600 to-amber-600 hover:from-amber-700 hover:to-amber-700">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

// ─── KpiCard ───────────────────────────────────────────────────────────────

function KpiCard({
  metric,
  fact,
  plan,
  planLabel,
  large = false,
  compact = false,
}: {
  metric: Metric
  fact: number
  plan?: number | null
  planLabel?: string
  large?: boolean
  compact?: boolean
}) {
  const meta = metricMeta(metric)
  const a = accentClasses(meta.accent)
  const Icon = meta.icon
  const pct = plan && plan > 0 ? Math.round((fact / plan) * 1000) / 10 : null

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${a.border} ${a.bg} ${large ? 'p-5' : compact ? 'p-3' : 'p-4'}`}>
      <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: a.fill }} />
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className={`grid h-7 w-7 place-items-center rounded-lg border ${a.border} ${a.bg} ${a.text}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{meta.label}</span>
          {planLabel ? (
            <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-700 dark:text-amber-300">{planLabel}</span>
          ) : null}
        </div>
        <p className={`mt-2 font-bold tabular-nums ${large ? 'text-3xl' : compact ? 'text-lg' : 'text-2xl'} ${a.text}`}>
          {fmt(fact)} <span className="text-xs opacity-70">{meta.unit}</span>
        </p>
        {plan && plan > 0 ? (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">План {fmt(plan)} {meta.unit}</span>
              <span className={pct! >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div
                className={`h-full transition-all ${pct! >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, pct || 0)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ─── Month grid (tile UI) ──────────────────────────────────────────────────

function MonthGrid({
  year,
  periodFacts,
  plans,
  daily,
  onOpenMonth,
}: {
  year: number
  periodFacts: ReturnType<typeof computeFacts>[]
  plans: Plan[]
  daily: DailyAggregate[]
  onOpenMonth: (idx: number) => void
}) {
  const todayMonth = new Date().getFullYear() === year ? new Date().getMonth() : -1
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MONTH_FULL.map((mLabel, idx) => {
        const facts = periodFacts[idx]
        const isClosed = year < new Date().getFullYear() || idx < todayMonth
        const isCurrent = idx === todayMonth
        const monthPlans = plans.filter((p) => p.period_kind === 'month' && p.period_start.slice(5, 7) === String(idx + 1).padStart(2, '0'))
        const revenuePlan = monthPlans.find((p) => p.metric === 'revenue' && !p.company_id)
        const profitPlan = monthPlans.find((p) => p.metric === 'profit' && !p.company_id)
        const pct = revenuePlan && revenuePlan.target_amount > 0 ? Math.round((facts.revenue / revenuePlan.target_amount) * 1000) / 10 : null
        const hasActivity = facts.revenue > 0 || facts.expenses > 0
        // Run-rate только для текущего месяца
        const runRate = isCurrent ? runRateForecast({ daily, companyId: null, year, monthIdx: idx, metric: 'revenue' }) : null
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onOpenMonth(idx)}
            className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition hover:scale-[1.02] hover:shadow-xl ${
              isCurrent
                ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.04] hover:border-amber-500/60'
                : isClosed
                  ? 'border-border bg-white dark:bg-white/[0.02] hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                  : 'border-dashed border-border bg-white dark:bg-white/[0.01] hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{mLabel}</p>
              {isCurrent ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  <Sparkles className="h-3 w-3" /> Сейчас
                </span>
              ) : isClosed ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Закрыт
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Unlock className="h-3 w-3" /> Впереди
                </span>
              )}
            </div>

            {hasActivity ? (
              <>
                <div className="mt-3 space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Выручка</span>
                    <span className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmt(facts.revenue)} <span className="text-xs opacity-70">₸</span>
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Прибыль</span>
                    <span className={`font-semibold tabular-nums ${facts.profit >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {fmt(facts.profit)} ₸
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Маржа</span>
                    <span className={`font-semibold ${facts.margin >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {facts.margin}%
                    </span>
                  </div>
                </div>
                {revenuePlan ? (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">План: {fmt(revenuePlan.target_amount)} ₸</span>
                      <span className={pct! >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-bold' : 'text-amber-700 dark:text-amber-300 font-bold'}>{pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                      <div
                        className={`h-full ${pct! >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, pct || 0)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-[10px] text-muted-foreground">План не задан</div>
                )}

                {/* Run-rate прогноз для текущего месяца */}
                {runRate ? (() => {
                  const target = Number(revenuePlan?.target_amount || 0)
                  const diff = target > 0 ? runRate.forecast - target : 0
                  const onTrack = target > 0 ? runRate.forecast >= target : true
                  return (
                    <div className={`mt-2 rounded-lg border px-2 py-1.5 text-[10px] ${onTrack ? 'border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300' : 'border-amber-500/30 bg-amber-500/[0.05] text-amber-700 dark:text-amber-300'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Прогноз: ~{fmt(runRate.forecast)} ₸</span>
                        {target > 0 ? (
                          <span className="font-bold">{onTrack ? `+${fmt(diff)}` : `−${fmt(-diff)}`}</span>
                        ) : null}
                      </div>
                    </div>
                  )
                })() : null}
              </>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">Активности пока нет</div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Period View (year/h1/h2) ──────────────────────────────────────────────

function PeriodView({
  tab,
  facts,
  plans,
  companies,
  daily,
  priorMonthly,
  year,
  activeMetric,
  setActiveMetric,
  onDelete,
}: {
  tab: PeriodKind
  facts: ReturnType<typeof computeFacts>
  plans: Plan[]
  companies: Company[]
  daily: DailyAggregate[]
  priorMonthly: PriorMonthlyRow[]
  year: number
  activeMetric: Metric
  setActiveMetric: (m: Metric) => void
  onDelete: (id: string) => void
}) {
  const periodPlans = plans.filter((p) => p.period_kind === tab)
  const monthPlans = plans.filter((p) => p.period_kind === 'month')
  const { start, end } = periodBounds(tab, year)

  // Месячные диапазоны для авто-агрегации
  const monthRange: number[] =
    tab === 'h1' ? [1, 2, 3, 4, 5, 6]
    : tab === 'h2' ? [7, 8, 9, 10, 11, 12]
    : tab === 'year' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : []

  // Только аддитивные метрики можно суммировать из месячных
  const ADDITIVE_METRICS: Metric[] = ['revenue', 'profit']

  const syntheticTargetFromMonths = (metric: Metric, companyId: string | null): number => {
    if (!ADDITIVE_METRICS.includes(metric) || monthRange.length === 0) return 0
    return monthPlans
      .filter((p) => p.metric === metric)
      .filter((p) => (companyId == null ? !p.company_id : p.company_id === companyId))
      .filter((p) => monthRange.includes(Number(p.period_start.slice(5, 7))))
      .reduce((s, p) => s + Number(p.target_amount || 0), 0)
  }

  // Эффективная цель: явная > сумма месячных
  const effectiveTarget = (metric: Metric, companyId: string | null): { value: number; isSynthetic: boolean } => {
    const explicit = (companyId == null
      ? periodPlans.find((p) => p.metric === metric && !p.company_id)
      : periodPlans.find((p) => p.metric === metric && p.company_id === companyId))
    if (explicit) return { value: Number(explicit.target_amount || 0), isSynthetic: false }
    return { value: syntheticTargetFromMonths(metric, companyId), isSynthetic: true }
  }

  const orgPlan = (metric: Metric) => periodPlans.find((p) => p.metric === metric && !p.company_id)
  const activePlan = orgPlan(activeMetric)
  const activeTarget = effectiveTarget(activeMetric, null)
  const targetValue = activeTarget.value
  const series = useMemo(
    () => buildSeries({ daily, companyId: null, start, end, metric: activeMetric, target: targetValue }),
    [daily, start, end, activeMetric, targetValue],
  )

  // Доли точек (YTD → fallback на прошлый год)
  const shares = useMemo(() => companyShares(daily, priorMonthly, companies), [daily, priorMonthly, companies])

  // YoY для активной метрики (только аддитивные)
  const yoyValue = (() => {
    if (!ADDITIVE_METRICS.includes(activeMetric) || monthRange.length === 0) return null
    const prior = priorMonthly
      .filter((r) => !r.company_id && monthRange.includes(r.month))
      .reduce((acc, r) => {
        if (activeMetric === 'revenue') acc += r.revenue
        else if (activeMetric === 'profit') acc += r.revenue - r.expenses
        return acc
      }, 0)
    return prior > 0 ? prior : null
  })()

  return (
    <div className="space-y-5">
      {/* KPI hero row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {METRICS.map((m) => {
          const factValue = facts[m.value as keyof typeof facts] as number
          const tg = effectiveTarget(m.value, null)
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setActiveMetric(m.value)}
              className={`text-left transition ${activeMetric === m.value ? 'scale-[1.02]' : 'opacity-80 hover:opacity-100'}`}
            >
              <KpiCard metric={m.value} fact={factValue} plan={tg.value > 0 ? tg.value : undefined} planLabel={tg.isSynthetic ? 'Σ месяцы' : undefined} large={activeMetric === m.value} />
            </button>
          )
        })}
      </div>

      {/* Динамика выбранной метрики */}
      <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.02] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Динамика: {metricMeta(activeMetric).label}</h2>
          {activePlan ? (
            <button onClick={() => onDelete(activePlan.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2 py-1 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-500/10">
              <Trash2 className="h-3.5 w-3.5" /> Удалить план
            </button>
          ) : null}
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
              <XAxis dataKey="day" stroke="rgba(255,255,255,0.45)" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => activeMetric === 'margin' ? `${v}%` : `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip
                formatter={(v: any) => v == null ? '—' : activeMetric === 'margin' ? `${v}%` : `${fmt(Number(v))} ${metricMeta(activeMetric).unit}`}
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {targetValue > 0 ? (
                <Line type="monotone" dataKey="Цель" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              ) : null}
              <Line type="monotone" dataKey="Факт" stroke={accentClasses(metricMeta(activeMetric).accent).fill} strokeWidth={2.5} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* YoY insight (если есть прошлогодний факт) */}
      {yoyValue ? (() => {
        const factValue = facts[activeMetric as keyof typeof facts] as number
        const yoyDelta = ((factValue - yoyValue) / yoyValue) * 100
        const positive = yoyDelta >= 0
        return (
          <div className={`rounded-2xl border p-4 ${positive ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-rose-500/30 bg-rose-500/[0.05]'}`}>
            <div className="flex items-center gap-2">
              {positive ? <TrendingUp className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /> : <TrendingDown className="h-4 w-4 text-rose-700 dark:text-rose-300" />}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Год к году: {fmt(yoyValue)} → {fmt(factValue)} {metricMeta(activeMetric).unit}
              </p>
              <span className={`ml-auto text-lg font-bold tabular-nums ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                {positive ? '+' : ''}{yoyDelta.toFixed(1)}%
              </span>
            </div>
          </div>
        )
      })() : null}

      {/* По точкам */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">По точкам</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => {
            const f = computeFacts(daily, c.id, start, end)
            const ct = effectiveTarget(activeMetric, c.id)
            const share = shares.get(c.id) || 0
            const allocated = ct.value <= 0 && activeTarget.value > 0 ? Math.round(activeTarget.value * share) : 0
            return (
              <div key={c.id} className="rounded-2xl border border-border bg-white dark:bg-white/[0.02] p-4">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {fmt(f[activeMetric])}{' '}
                  <span className="text-xs text-muted-foreground">{metricMeta(activeMetric).unit}</span>
                </p>
                {ct.value > 0 ? (
                  (() => {
                    const pct = ct.value > 0 ? Math.round((Number(f[activeMetric]) / ct.value) * 1000) / 10 : 0
                    return (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            План {fmt(ct.value)} {metricMeta(activeMetric).unit}
                            {ct.isSynthetic ? <span className="ml-1 text-amber-700 dark:text-amber-300">(Σ мес)</span> : null}
                          </span>
                          <span className={pct >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                          <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    )
                  })()
                ) : allocated > 0 ? (
                  (() => {
                    const pct = Math.round((Number(f[activeMetric]) / allocated) * 1000) / 10
                    return (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            Доля {fmt(allocated)} {metricMeta(activeMetric).unit}
                            <span className="ml-1 text-amber-700 dark:text-amber-300">({Math.round(share * 100)}%)</span>
                          </span>
                          <span className={pct >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                          <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <p className="mt-2 text-[10px] text-muted-foreground">План не задан</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Month Detail Dialog ───────────────────────────────────────────────────

function MonthDetailDialog({
  year,
  monthIdx,
  facts,
  plans,
  companies,
  daily,
  priorMonthly,
  onClose,
  onDelete,
}: {
  year: number
  monthIdx: number
  facts: ReturnType<typeof computeFacts>
  plans: Plan[]
  companies: Company[]
  daily: DailyAggregate[]
  priorMonthly: PriorMonthlyRow[]
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [activeMetric, setActiveMetric] = useState<Metric>('revenue')
  const { start, end } = periodBounds('month', year, monthIdx)
  const orgPlan = plans.find((p) => p.metric === activeMetric && !p.company_id)
  const targetValue = Number(orgPlan?.target_amount || 0)
  const series = buildSeries({ daily, companyId: null, start, end, metric: activeMetric, target: targetValue })
  const isCurrent = new Date().getFullYear() === year && new Date().getMonth() === monthIdx
  const isClosed = year < new Date().getFullYear() || (year === new Date().getFullYear() && monthIdx < new Date().getMonth())

  // Run-rate прогноз (только для текущего месяца, аддитивных метрик)
  const ADDITIVE: Metric[] = ['revenue', 'profit']
  const runRate = ADDITIVE.includes(activeMetric)
    ? runRateForecast({ daily, companyId: null, year, monthIdx, metric: activeMetric as 'revenue' | 'profit' })
    : null

  // Аллокация общего плана по точкам по долям выручки (YTD / прошлый год)
  const shares = useMemo(() => companyShares(daily, priorMonthly, companies), [daily, priorMonthly, companies])

  // YoY: тот же месяц год назад (для аддитивных метрик)
  const yoyValue = (() => {
    if (!ADDITIVE.includes(activeMetric)) return null
    const prior = priorMonthly
      .filter((r) => r.month === monthIdx + 1 && !r.company_id)
      .reduce((acc, r) => {
        if (activeMetric === 'revenue') acc += r.revenue
        else if (activeMetric === 'profit') acc += r.revenue - r.expenses
        return acc
      }, 0)
    return prior > 0 ? prior : null
  })()

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="!w-[96vw] !max-w-[1200px] flex h-[90vh] flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{MONTH_FULL[monthIdx]} {year} — детали месяца</DialogTitle>
        <DialogDescription className="sr-only">
          Факт и план по выбранному месяцу с разбивкой по точкам и динамикой по дням.
        </DialogDescription>
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-amber-500/[0.08] to-amber-500/[0.04] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/30">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold">{MONTH_FULL[monthIdx]} {year}</p>
              <p className="text-xs text-muted-foreground">
                {isCurrent ? 'Текущий месяц — данные обновляются ежедневно' : isClosed ? 'Закрытый период' : 'Будущий период'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {METRICS.map((m) => {
              const factValue = facts[m.value as keyof typeof facts] as number
              const planP = plans.find((p) => p.metric === m.value && !p.company_id)
              return (
                <button key={m.value} type="button" onClick={() => setActiveMetric(m.value)} className={`text-left transition ${activeMetric === m.value ? 'scale-[1.02]' : 'opacity-80 hover:opacity-100'}`}>
                  <KpiCard metric={m.value} fact={factValue} plan={planP?.target_amount} large={activeMetric === m.value} />
                </button>
              )
            })}
          </div>

          {/* Smart insights row (run-rate + YoY) */}
          {(runRate || yoyValue) ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {runRate ? (() => {
                const factValue = facts[activeMetric as keyof typeof facts] as number
                const diff = targetValue > 0 ? runRate.forecast - targetValue : 0
                const onTrack = targetValue > 0 ? runRate.forecast >= targetValue : true
                return (
                  <div className={`rounded-2xl border p-4 ${onTrack ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]'}`}>
                    <div className="flex items-center gap-2">
                      <TrendingUp className={`h-4 w-4 ${onTrack ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} />
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Run-rate прогноз</p>
                    </div>
                    <p className={`mt-2 text-2xl font-bold tabular-nums ${onTrack ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      ~ {fmt(runRate.forecast)} <span className="text-xs opacity-70">{metricMeta(activeMetric).unit}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      При текущем темпе ({fmt(runRate.dailyAvg)} /день за {runRate.daysPassed} дн) к {String(runRate.daysTotal).padStart(2,'0')}.{String(monthIdx + 1).padStart(2,'0')}
                    </p>
                    {targetValue > 0 ? (
                      <p className={`mt-1 text-[11px] font-semibold ${onTrack ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        {onTrack ? `Перевыполнение +${fmt(diff)}` : `Недобор ${fmt(-diff)}`} {metricMeta(activeMetric).unit}
                      </p>
                    ) : null}
                  </div>
                )
              })() : null}
              {yoyValue ? (() => {
                const factValue = facts[activeMetric as keyof typeof facts] as number
                const yoyDelta = ((factValue - yoyValue) / yoyValue) * 100
                const positive = yoyDelta >= 0
                return (
                  <div className={`rounded-2xl border p-4 ${positive ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-rose-500/30 bg-rose-500/[0.05]'}`}>
                    <div className="flex items-center gap-2">
                      {positive ? <TrendingUp className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /> : <TrendingDown className="h-4 w-4 text-rose-700 dark:text-rose-300" />}
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">YoY ({MONTH_FULL[monthIdx]} {year - 1})</p>
                    </div>
                    <p className={`mt-2 text-2xl font-bold tabular-nums ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {positive ? '+' : ''}{yoyDelta.toFixed(1)}%
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Было {fmt(yoyValue)} {metricMeta(activeMetric).unit} → стало {fmt(factValue)} {metricMeta(activeMetric).unit}
                    </p>
                  </div>
                )
              })() : null}
            </div>
          ) : null}

          {/* Chart */}
          <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.02] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Динамика по дням: {metricMeta(activeMetric).label}</h2>
              {orgPlan ? (
                <button onClick={() => onDelete(orgPlan.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2 py-1 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-500/10">
                  <Trash2 className="h-3.5 w-3.5" /> Удалить план
                </button>
              ) : null}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
                  <XAxis dataKey="day" stroke="rgba(255,255,255,0.45)" fontSize={10} interval="preserveStartEnd" />
                  <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => activeMetric === 'margin' ? `${v}%` : `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip formatter={(v: any) => v == null ? '—' : activeMetric === 'margin' ? `${v}%` : `${fmt(Number(v))} ${metricMeta(activeMetric).unit}`} contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {targetValue > 0 ? <Line type="monotone" dataKey="Цель" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} /> : null}
                  <Line type="monotone" dataKey="Факт" stroke={accentClasses(metricMeta(activeMetric).accent).fill} strokeWidth={2.5} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* By company */}
          {companies.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">По точкам</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {companies.map((c) => {
                  const f = computeFacts(daily, c.id, start, end)
                  const companyPlan = plans.find((p) => p.metric === activeMetric && p.company_id === c.id)
                  const orgTarget = Number(orgPlan?.target_amount || 0)
                  const share = shares.get(c.id) || 0
                  const allocated = orgTarget > 0 ? Math.round(orgTarget * share) : 0
                  return (
                    <div key={c.id} className="rounded-2xl border border-border bg-white dark:bg-white/[0.02] p-4">
                      <p className="text-sm font-semibold">{c.name}</p>
                      <p className="mt-2 text-xl font-bold tabular-nums">
                        {fmt(f[activeMetric])} <span className="text-xs text-muted-foreground">{metricMeta(activeMetric).unit}</span>
                      </p>
                      {companyPlan ? (
                        (() => {
                          const pct = companyPlan.target_amount > 0 ? Math.round((f[activeMetric] / companyPlan.target_amount) * 1000) / 10 : 0
                          return (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-muted-foreground">План {fmt(companyPlan.target_amount)} {metricMeta(activeMetric).unit}</span>
                                <span className={pct >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>{pct}%</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                                <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                            </div>
                          )
                        })()
                      ) : allocated > 0 ? (
                        (() => {
                          const pct = Math.round((Number(f[activeMetric]) / allocated) * 1000) / 10
                          return (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-muted-foreground">
                                  Доля {fmt(allocated)} {metricMeta(activeMetric).unit}
                                  <span className="ml-1 text-amber-700 dark:text-amber-300">({Math.round(share * 100)}%)</span>
                                </span>
                                <span className={pct >= 100 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>{pct}%</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                                <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                            </div>
                          )
                        })()
                      ) : (
                        <p className="mt-2 text-[10px] text-muted-foreground">План не задан</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
