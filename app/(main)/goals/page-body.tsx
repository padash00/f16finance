'use client'

/**
 * Цели и план.
 *
 *  - Всегда видны реальные цифры по периоду (как в /reports: без F16 Extra в
 *    итогах сети, по вчерашний день); план накладывается поверх.
 *  - Общая цель организации; если её нет — сумма целей точек («Σ точки»).
 *  - Темп: сколько должно быть к сегодняшнему дню по ритму недели (выходные
 *    тяжелее будней) и сколько нужно в день, чтобы успеть.
 *  - Успеем ли — по прогнозу из /analysis (/api/admin/kpi-plans/outlook).
 *  - Год к году — тот же отрезок дат прошлого года, а не весь прошлый год.
 *  - Итог года: сколько месяцев выполнено.
 *  - Подсказка цели: осторожно / реально / амбициозно.
 *
 * Расчёты темпа — lib/analysis/goal-pace.ts.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Gauge,
  Loader2,
  Lock,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Unlock,
  X,
} from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import {
  cumulativeTargetCurve,
  datesBetween,
  goalPace,
  goalVerdict,
  shiftDate,
  suggestTargets,
  weekdayWeights,
  yearPlanSummary,
  type GoalPace,
  type GoalVerdict,
} from '@/lib/analysis/goal-pace'
import type { GoalsOutlookResponse, GoalsOutlookScope } from '@/app/api/admin/kpi-plans/outlook/route'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { isAbortError } from '@/lib/is-abort-error'

// ─── Типы ───────────────────────────────────────────────────────────────────

type Metric = 'revenue' | 'profit' | 'margin'
type PeriodKind = 'year' | 'h1' | 'h2' | 'month'

type Company = { id: string; name: string; code?: string | null }

type Plan = {
  id: string
  company_id: string | null
  organization_id: string | null
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

type DailyAggregate = { date: string; company_id: string | null; revenue: number; expenses: number; checks: number }
type PriorDaily = { date: string; company_id: string | null; revenue: number; expenses: number }
type PriorMonthlyRow = { company_id: string | null; month: number; revenue: number; expenses: number; checks: number }

type GoalsData = {
  year: number
  companies: Company[]
  plans: Plan[]
  dailyAggregates: DailyAggregate[]
  priorYearMonthly: PriorMonthlyRow[]
  priorYearDaily: PriorDaily[]
  factEnd: string
  orgPlansAvailable: boolean
  orgPlansHint: string | null
  excludedCompanies: string[]
}

type Target = { value: number; source: 'plan' | 'months' | 'companies' | 'none' }

// ─── Константы и форматирование ─────────────────────────────────────────────

const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTH_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const METRICS: Array<{ value: Metric; label: string; unit: string; icon: any; accent: 'emerald' | 'amber' }> = [
  { value: 'revenue', label: 'Выручка', unit: '₸', icon: TrendingUp, accent: 'emerald' },
  { value: 'profit', label: 'Прибыль', unit: '₸', icon: Coins, accent: 'amber' },
  { value: 'margin', label: 'Маржа', unit: '%', icon: Percent, accent: 'amber' },
]
const ADDITIVE: Metric[] = ['revenue', 'profit']

// Постоянные пустые массивы: `|| []` создавал бы новый на каждой отрисовке
// и сбрасывал useMemo
const NO_COMPANIES: Company[] = []
const NO_PLANS: Plan[] = []
const NO_DAILY: DailyAggregate[] = []
const NO_PRIOR_MONTHLY: PriorMonthlyRow[] = []
const NO_PRIOR_DAILY: PriorDaily[] = []

const PERIOD_LABEL: Record<PeriodKind, string> = { year: 'Год', h1: 'I полугодие', h2: 'II полугодие', month: 'Месяц' }

const fmt = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
const money = (v: number) => `${fmt(v)} ₸`
const metricMeta = (m: Metric) => METRICS.find((x) => x.value === m)!
const mm = (monthIdx: number) => String(monthIdx + 1).padStart(2, '0')

const ACCENT = {
  emerald: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.06]', text: 'text-emerald-700 dark:text-emerald-300', fill: '#10b981' },
  amber: { border: 'border-amber-500/30', bg: 'bg-amber-500/[0.06]', text: 'text-amber-700 dark:text-amber-300', fill: '#f59e0b' },
}

const SOURCE_LABEL: Record<Target['source'], string | undefined> = { plan: undefined, months: 'Σ месяцы', companies: 'Σ точки', none: undefined }

const VERDICT_TONE: Record<GoalVerdict['status'], string> = {
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  safe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  likely: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  at_risk: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  unlikely: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

const CHART_TOOLTIP = {
  background: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
}

// ─── Даты и суммы ───────────────────────────────────────────────────────────

function periodBounds(period: PeriodKind, year: number, monthIdx?: number): { start: string; end: string } {
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (period === 'h1') return { start: `${year}-01-01`, end: `${year}-06-30` }
  if (period === 'h2') return { start: `${year}-07-01`, end: `${year}-12-31` }
  const last = new Date(year, (monthIdx || 0) + 1, 0).getDate()
  return { start: `${year}-${mm(monthIdx || 0)}-01`, end: `${year}-${mm(monthIdx || 0)}-${String(last).padStart(2, '0')}` }
}

const PERIOD_MONTHS: Record<Exclude<PeriodKind, 'month'>, number[]> = {
  year: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  h1: [0, 1, 2, 3, 4, 5],
  h2: [6, 7, 8, 9, 10, 11],
}

const matchCompany = (rowCompany: string | null, companyId: string | null) => (companyId == null ? rowCompany === null : rowCompany === companyId)

function computeFacts(daily: DailyAggregate[], companyId: string | null, start: string, end: string) {
  let revenue = 0
  let expenses = 0
  let checks = 0
  for (const r of daily) {
    if (r.date < start || r.date > end || !matchCompany(r.company_id, companyId)) continue
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
    margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
  }
}
type Facts = ReturnType<typeof computeFacts>

/** Дата годом раньше; 29 февраля → 28-е */
const yearBack = (date: string) => {
  const y = Number(date.slice(0, 4)) - 1
  const md = date.slice(5) === '02-29' ? '02-28' : date.slice(5)
  return `${y}-${md}`
}

/** Год к году: тот же отрезок дат прошлого года, что уже прошёл в этом */
function yoyBase(prior: PriorDaily[], companyId: string | null, start: string, end: string, factEnd: string, metric: Metric) {
  if (!ADDITIVE.includes(metric) || factEnd < start) return null
  const to = end < factEnd ? end : factEnd
  const from = yearBack(start)
  const until = yearBack(to)
  let revenue = 0
  let expenses = 0
  for (const r of prior) {
    if (r.date < from || r.date > until || !matchCompany(r.company_id, companyId)) continue
    revenue += r.revenue
    expenses += r.expenses
  }
  const value = metric === 'revenue' ? revenue : revenue - expenses
  return value > 0 ? { value, from, until } : null
}

/** Ритм недели точки (или сети) за последние 8 недель до последнего дня с фактом */
function rhythm(daily: DailyAggregate[], prior: PriorDaily[], companyId: string | null, factEnd: string) {
  const from = shiftDate(factEnd, -55)
  const byDate = new Map<string, number>()
  for (const r of [...prior, ...daily]) {
    if (r.date < from || r.date > factEnd || !matchCompany(r.company_id, companyId)) continue
    byDate.set(r.date, (byDate.get(r.date) || 0) + r.revenue)
  }
  return weekdayWeights(Array.from(byDate.entries()).map(([date, value]) => ({ date, value })))
}

/** Сезонные веса месяцев по прошлому году; нет данных — поровну */
function seasonalWeights(priorMonthly: PriorMonthlyRow[], metric: 'revenue' | 'profit', companyId: string | null): number[] {
  const totals = new Array(12).fill(0) as number[]
  for (const r of priorMonthly) {
    if (!matchCompany(r.company_id, companyId)) continue
    const m = r.month - 1
    if (m < 0 || m > 11) continue
    totals[m] += metric === 'revenue' ? r.revenue : r.revenue - r.expenses
  }
  const sum = totals.reduce((s, v) => s + Math.max(0, v), 0)
  if (sum <= 0) return new Array(12).fill(1 / 12)
  return totals.map((v) => Math.max(0, v) / sum)
}

/** Доля точек в выручке — для «доли» общего плана */
function companyShares(daily: DailyAggregate[], priorMonthly: PriorMonthlyRow[], companies: Company[]): Map<string, number> {
  const shares = new Map<string, number>()
  const sumBy = (rows: Array<{ company_id: string | null; revenue: number }>) => {
    const by = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      if (!r.company_id) continue
      by.set(r.company_id, (by.get(r.company_id) || 0) + r.revenue)
      total += r.revenue
    }
    return { by, total }
  }
  for (const source of [sumBy(daily), sumBy(priorMonthly)]) {
    if (source.total > 0) {
      for (const c of companies) shares.set(c.id, (source.by.get(c.id) || 0) / source.total)
      return shares
    }
  }
  for (const c of companies) shares.set(c.id, 1 / Math.max(1, companies.length))
  return shares
}

// ─── Планы ──────────────────────────────────────────────────────────────────

function findPlan(plans: Plan[], period: PeriodKind, monthIdx: number | null, metric: Metric, companyId: string | null) {
  return plans.find(
    (p) =>
      p.period_kind === period &&
      p.metric === metric &&
      (companyId == null ? !p.company_id : p.company_id === companyId) &&
      (period !== 'month' || (monthIdx != null && p.period_start.slice(5, 7) === mm(monthIdx))),
  )
}

/** Цель месяца: своя; для сети без общей цели — сумма целей точек */
function monthTarget(plans: Plan[], monthIdx: number, metric: Metric, companyId: string | null): Target {
  const own = findPlan(plans, 'month', monthIdx, metric, companyId)
  if (own) return { value: Number(own.target_amount || 0), source: 'plan' }
  if (companyId == null && ADDITIVE.includes(metric)) {
    const sum = plans
      .filter((p) => p.period_kind === 'month' && p.metric === metric && p.company_id && p.period_start.slice(5, 7) === mm(monthIdx))
      .reduce((s, p) => s + Number(p.target_amount || 0), 0)
    if (sum > 0) return { value: sum, source: 'companies' }
  }
  return { value: 0, source: 'none' }
}

/** Цель года/полугодия: явная → сумма месяцев → сумма точек */
function periodTarget(plans: Plan[], tab: Exclude<PeriodKind, 'month'>, metric: Metric, companyId: string | null): Target {
  const own = findPlan(plans, tab, null, metric, companyId)
  if (own) return { value: Number(own.target_amount || 0), source: 'plan' }
  if (!ADDITIVE.includes(metric)) return { value: 0, source: 'none' }
  const months = PERIOD_MONTHS[tab].reduce((s, m) => s + monthTarget(plans, m, metric, companyId).value, 0)
  if (months > 0) return { value: months, source: 'months' }
  if (companyId == null) {
    const companies = plans.filter((p) => p.period_kind === tab && p.metric === metric && p.company_id).reduce((s, p) => s + Number(p.target_amount || 0), 0)
    if (companies > 0) return { value: companies, source: 'companies' }
  }
  return { value: 0, source: 'none' }
}

// ─── График ─────────────────────────────────────────────────────────────────

/**
 * Накопленный факт и цель по дням. Цель внутри месяца идёт по ритму недели;
 * цель года/полугодия раскладывается по месяцам (их цели или сезонность).
 */
function buildSeries(params: {
  daily: DailyAggregate[]
  companyId: string | null
  start: string
  end: string
  factEnd: string
  metric: Metric
  monthTargets: number[]
  marginTarget: number
  weights: number[]
}) {
  const dates = datesBetween(params.start, params.end)
  const fact = new Map<string, { revenue: number; expenses: number }>()
  for (const r of params.daily) {
    if (r.date < params.start || r.date > params.end || !matchCompany(r.company_id, params.companyId)) continue
    const cur = fact.get(r.date) || { revenue: 0, expenses: 0 }
    cur.revenue += r.revenue
    cur.expenses += r.expenses
    fact.set(r.date, cur)
  }

  const targetByDate = new Map<string, number>()
  const hasTarget = params.metric === 'margin' ? params.marginTarget > 0 : params.monthTargets.some((v) => v > 0)
  if (hasTarget && params.metric !== 'margin') {
    let offset = 0
    const monthKeys = Array.from(new Set(dates.map((d) => d.slice(0, 7))))
    for (const key of monthKeys) {
      const monthDates = dates.filter((d) => d.startsWith(key))
      const target = params.monthTargets[Number(key.slice(5, 7)) - 1] || 0
      const curve = cumulativeTargetCurve(monthDates, target, params.weights)
      monthDates.forEach((d, i) => targetByDate.set(d, offset + curve[i]))
      offset += target
    }
  }

  let cumR = 0
  let cumE = 0
  return dates.map((day) => {
    const t = fact.get(day)
    if (t) {
      cumR += t.revenue
      cumE += t.expenses
    }
    let factValue: number | null = null
    if (day <= params.factEnd) {
      factValue =
        params.metric === 'revenue' ? Math.round(cumR) : params.metric === 'profit' ? Math.round(cumR - cumE) : cumR > 0 ? Math.round(((cumR - cumE) / cumR) * 1000) / 10 : 0
    }
    return {
      day: `${day.slice(8, 10)}.${day.slice(5, 7)}`,
      Факт: factValue,
      Цель: hasTarget ? (params.metric === 'margin' ? params.marginTarget : targetByDate.get(day) ?? null) : null,
    }
  })
}

function GoalChart({ series, metric, height = 'h-64' }: { series: ReturnType<typeof buildSeries>; metric: Metric; height?: string }) {
  const unit = metricMeta(metric).unit
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} />
          <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} interval="preserveStartEnd" />
          <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => (metric === 'margin' ? `${v}%` : `${Math.round(Number(v) / 1000)}k`)} />
          <Tooltip formatter={(v: any) => (v == null ? '—' : metric === 'margin' ? `${v}%` : `${fmt(Number(v))} ${unit}`)} contentStyle={CHART_TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.some((p) => p.Цель != null) ? <Line type="monotone" dataKey="Цель" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} /> : null}
          <Line type="monotone" dataKey="Факт" stroke={ACCENT[metricMeta(metric).accent].fill} strokeWidth={2.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Компонент ──────────────────────────────────────────────────────────────

type FormState = {
  period_kind: PeriodKind
  month_idx: number
  company_id: string
  revenue: string
  expense: string
  distributeSeasonal: boolean
}

export default function GoalsPage() {
  const { can } = useCapabilities()
  const nowYear = new Date().getFullYear()
  const [year, setYear] = useState(nowYear)
  const [tab, setTab] = useState<PeriodKind>('month')
  const [data, setData] = useState<GoalsData | null>(null)
  const [outlook, setOutlook] = useState<GoalsOutlookResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeMetric, setActiveMetric] = useState<Metric>('revenue')
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>({
    period_kind: 'month',
    month_idx: new Date().getMonth(),
    company_id: 'all',
    revenue: '',
    expense: '',
    distributeSeasonal: true,
  })
  const [saving, setSaving] = useState(false)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/kpi-plans?year=${year}`, { cache: 'no-store', signal })
      const j = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !j?.ok || !j.data) throw new Error(j?.error || 'Не удалось загрузить')
      setData(j.data as GoalsData)
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

  // Прогноз нужен только для идущего и следующего месяца
  useEffect(() => {
    if (outlook) return
    let active = true
    fetch('/api/admin/kpi-plans/outlook', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && j?.month && setOutlook(j as GoalsOutlookResponse))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [outlook])

  const plans = data?.plans ?? NO_PLANS
  const daily = data?.dailyAggregates ?? NO_DAILY
  const priorMonthly = data?.priorYearMonthly ?? NO_PRIOR_MONTHLY
  const priorDaily = data?.priorYearDaily ?? NO_PRIOR_DAILY
  const factEnd = data?.factEnd || shiftDate(new Date().toISOString().slice(0, 10), -1)

  const periodFacts = useMemo(() => {
    const get = (period: PeriodKind, monthIdx?: number) => {
      const { start, end } = periodBounds(period, year, monthIdx)
      return computeFacts(daily, null, start, end)
    }
    return { year: get('year'), h1: get('h1'), h2: get('h2'), months: Array.from({ length: 12 }, (_, i) => get('month', i)) }
  }, [daily, year])

  const orgWeights = useMemo(() => rhythm(daily, priorDaily, null, factEnd), [daily, priorDaily, factEnd])

  const parseMoney = (raw: string) => Number(String(raw).replace(/\s/g, '').replace(',', '.'))

  const openDialog = (preset?: Partial<FormState>) => {
    setForm((f) => ({ ...f, revenue: '', expense: '', ...preset }))
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const revenue = parseMoney(form.revenue)
    const expense = parseMoney(form.expense)
    if (!Number.isFinite(revenue) || revenue <= 0) {
      toast({ title: 'Введите выручку больше 0', variant: 'destructive' })
      return
    }
    if (!Number.isFinite(expense) || expense < 0) {
      toast({ title: 'Расходы не могут быть отрицательными', variant: 'destructive' })
      return
    }
    const companyId = form.company_id === 'all' ? null : form.company_id
    const payloads: Array<{ metric: Metric; target_amount: number }> = [
      { metric: 'revenue', target_amount: revenue },
      { metric: 'profit', target_amount: revenue - expense },
    ]
    const post = async (body: Record<string, unknown>) => {
      const res = await fetch('/api/admin/kpi-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось сохранить')
    }

    setSaving(true)
    try {
      const distribute = form.period_kind === 'year' && form.distributeSeasonal
      if (distribute) {
        const requests: Array<Promise<void>> = []
        for (const p of payloads) {
          const weights = seasonalWeights(priorMonthly, p.metric as 'revenue' | 'profit', companyId)
          for (let m = 0; m < 12; m++) {
            const share = Math.round(p.target_amount * weights[m])
            if (share <= 0) continue
            requests.push(post({ year, period_kind: 'month', month_idx: m, metric: p.metric, company_id: companyId, target_amount: share }))
          }
        }
        await Promise.all(requests)
      } else {
        for (const p of payloads) {
          await post({
            year,
            period_kind: form.period_kind,
            month_idx: form.period_kind === 'month' ? form.month_idx : undefined,
            metric: p.metric,
            company_id: companyId,
            target_amount: p.target_amount,
          })
        }
      }
      toast({ title: distribute ? 'Цель сохранена и разложена по месяцам' : 'Цель сохранена' })
      setDialogOpen(false)
      await load(undefined, { soft: true })
    } catch (err: any) {
      toast({ title: 'Не удалось сохранить', description: err?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (ids: string[], title: string) => {
    if (!ids.length) return
    const ok = await confirmDialog({ title, description: 'Факт не пострадает — удаляются только цели.', confirmLabel: 'Удалить', destructive: true })
    if (!ok) return
    try {
      const res = await fetch(`/api/admin/kpi-plans?ids=${encodeURIComponent(ids.join(','))}`, { method: 'DELETE' })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось удалить')
      toast({ title: 'Цели удалены' })
      await load(undefined, { soft: true })
    } catch (err: any) {
      toast({ title: 'Не удалось удалить', description: err?.message, variant: 'destructive' })
    }
  }

  return (
    <div className="app-page-wide relative">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative space-y-6">
        <AdminPageHeader
          title="Цели и план"
          description="Реальные цифры по периодам · план поверх · темп и прогноз"
          icon={<Target className="h-5 w-5" />}
          accent="emerald"
          backHref="/"
          actions={
            <>
              <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-0.5">
                <Button variant="ghost" size="icon-sm" onClick={() => setYear((y) => y - 1)} disabled={loading} aria-label="Предыдущий год">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-3 text-sm font-semibold tabular-nums">{year}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setYear((y) => y + 1)} disabled={loading || year >= nowYear + 1} aria-label="Следующий год">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="outline" size="icon" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} aria-label="Обновить">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              {can('goals.create') ? (
                <Button onClick={() => openDialog({ period_kind: tab === 'month' ? 'month' : tab, month_idx: selectedMonth ?? new Date().getMonth() })}>
                  <Plus className="h-4 w-4" /> Новая цель
                </Button>
              ) : null}
            </>
          }
          toolbar={
            <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-border bg-card p-1">
              {(['month', 'year', 'h1', 'h2'] as PeriodKind[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={tab === p ? 'default' : 'ghost'}
                  onClick={() => {
                    setTab(p)
                    setSelectedMonth(null)
                  }}
                >
                  {PERIOD_LABEL[p]}
                </Button>
              ))}
            </div>
          }
        />

        {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div> : null}
        {data?.orgPlansHint ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">{data.orgPlansHint}</div>
        ) : null}

        {loading && !data ? (
          <div className="grid place-items-center rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="mt-2">Грузим данные за {year}…</span>
          </div>
        ) : data ? (
          <>
            {tab === 'month' ? (
              <MonthGrid
                year={year}
                facts={periodFacts.months}
                plans={plans}
                factEnd={factEnd}
                weights={orgWeights}
                outlook={outlook}
                onOpenMonth={setSelectedMonth}
              />
            ) : (
              <PeriodView
                tab={tab}
                year={year}
                facts={periodFacts[tab]}
                monthFacts={periodFacts.months}
                data={data}
                weights={orgWeights}
                activeMetric={activeMetric}
                setActiveMetric={setActiveMetric}
                onDelete={handleDelete}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Факт — по {factEnd.slice(8, 10)}.{factEnd.slice(5, 7)} включительно, как в отчётах: безнал ночной смены на следующий день
              {data.excludedCompanies.length ? `, ${data.excludedCompanies.join(', ')} не входит в итоги сети (в своей карточке — входит)` : ''}.
            </p>
          </>
        ) : null}

        {selectedMonth != null && data ? (
          <MonthDetailDialog
            year={year}
            monthIdx={selectedMonth}
            facts={periodFacts.months[selectedMonth]}
            data={data}
            weights={orgWeights}
            outlook={outlook}
            onClose={() => setSelectedMonth(null)}
            onDelete={handleDelete}
            onEdit={(preset) => openDialog(preset)}
          />
        ) : null}

        <GoalDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          form={form}
          setForm={setForm}
          year={year}
          data={data}
          outlook={outlook}
          saving={saving}
          canSave={can('goals.create')}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}

// ─── KpiCard ────────────────────────────────────────────────────────────────

function KpiCard({ metric, fact, plan, planLabel, large = false }: { metric: Metric; fact: number; plan?: number | null; planLabel?: string; large?: boolean }) {
  const meta = metricMeta(metric)
  const a = ACCENT[meta.accent]
  const Icon = meta.icon
  const pct = plan && plan > 0 ? Math.round((fact / plan) * 1000) / 10 : null
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${a.border} ${a.bg} ${large ? 'p-5' : 'p-4'}`}>
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: a.fill }} />
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
        <p className={`mt-2 font-bold tabular-nums ${large ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} ${a.text}`}>
          {fmt(fact)} <span className="text-xs opacity-70">{meta.unit}</span>
        </p>
        {plan && plan > 0 ? (
          <ProgressLine label={`План ${fmt(plan)} ${meta.unit}`} pct={pct!} />
        ) : null}
      </div>
    </div>
  )
}

function ProgressLine({ label, pct, hint }: { label: string; pct: number; hint?: string }) {
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">
          {label}
          {hint ? <span className="ml-1 text-amber-700 dark:text-amber-300">{hint}</span> : null}
        </span>
        <span className={`font-semibold ${pct >= 100 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className={`h-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  )
}

function VerdictBadge({ verdict }: { verdict: GoalVerdict | null }) {
  if (!verdict) return null
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${VERDICT_TONE[verdict.status]}`}>{verdict.label}</span>
}

const outlookFor = (outlook: GoalsOutlookResponse | null, year: number, monthIdx: number, companyId: string | null): GoalsOutlookScope | null => {
  if (!outlook || outlook.month !== `${year}-${mm(monthIdx)}`) return null
  return companyId ? outlook.companies[companyId] || null : outlook.org
}

function verdictFor(target: number, fact: number, scope: GoalsOutlookScope | null, metric: 'revenue' | 'profit') {
  const o = scope?.outlook?.outlook
  const key = metric === 'revenue' ? 'income' : 'profit'
  return goalVerdict(target, fact, o ? { pessimistic: o.pessimistic[key], realistic: o.realistic[key], optimistic: o.optimistic[key] } : null)
}

// ─── Плитки месяцев ─────────────────────────────────────────────────────────

function MonthGrid({
  year,
  facts,
  plans,
  factEnd,
  weights,
  outlook,
  onOpenMonth,
}: {
  year: number
  facts: Facts[]
  plans: Plan[]
  factEnd: string
  weights: number[]
  outlook: GoalsOutlookResponse | null
  onOpenMonth: (idx: number) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MONTH_FULL.map((label, idx) => {
        const f = facts[idx]
        const { start, end } = periodBounds('month', year, idx)
        const isClosed = end <= factEnd
        const isCurrent = !isClosed && start <= shiftDate(factEnd, 1)
        const revenueTarget = monthTarget(plans, idx, 'revenue', null)
        const pct = revenueTarget.value > 0 ? Math.round((f.revenue / revenueTarget.value) * 1000) / 10 : null
        const hasActivity = f.revenue > 0 || f.expenses > 0
        const pace = isCurrent && revenueTarget.value > 0 ? goalPace({ target: revenueTarget.value, fact: f.revenue, start, end, lastFactDate: factEnd, weights }) : null
        const scope = isCurrent ? outlookFor(outlook, year, idx, null) : null
        const verdict = revenueTarget.value > 0 && isCurrent ? verdictFor(revenueTarget.value, f.revenue, scope, 'revenue') : null
        const forecast = scope?.outlook?.outlook.realistic.income

        return (
          <button
            key={idx}
            type="button"
            onClick={() => onOpenMonth(idx)}
            className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition hover:shadow-lg ${
              isCurrent
                ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.04] hover:border-amber-500/60'
                : isClosed
                  ? 'border-border bg-card hover:border-slate-300 dark:hover:border-white/20'
                  : 'border-dashed border-border bg-card/60 hover:border-slate-300 dark:hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{label}</p>
              {isCurrent ? (
                verdict ? (
                  <VerdictBadge verdict={verdict} />
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <Sparkles className="h-3 w-3" /> Сейчас
                  </span>
                )
              ) : isClosed ? (
                pct != null ? (
                  pct >= 100 ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Выполнен
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                      <TrendingDown className="h-3 w-3" /> Недобор
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> Закрыт
                  </span>
                )
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
                      {fmt(f.revenue)} <span className="text-xs opacity-70">₸</span>
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Прибыль</span>
                    <span className={`font-semibold tabular-nums ${f.profit >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{money(f.profit)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Маржа</span>
                    <span className={`font-semibold ${f.margin >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{f.margin}%</span>
                  </div>
                </div>
                {revenueTarget.value > 0 ? (
                  <ProgressLine label={`План ${money(revenueTarget.value)}`} hint={SOURCE_LABEL[revenueTarget.source]} pct={pct!} />
                ) : (
                  <div className="mt-3 text-[10px] text-muted-foreground">План не задан</div>
                )}
                {pace && pace.daysLeft > 0 ? (
                  <div className={`mt-2 rounded-lg border px-2 py-1.5 text-[11px] ${pace.gap >= 0 ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]'}`}>
                    <p className="font-semibold">Нужно {money(pace.requiredPerDay)} в день</p>
                    <p className="text-muted-foreground">
                      {pace.gap >= 0 ? `опережаем ритм на ${money(pace.gap)}` : `отстаём от ритма на ${money(-pace.gap)}`}
                    </p>
                  </div>
                ) : null}
                {isCurrent && forecast ? <p className="mt-1.5 text-[10px] text-muted-foreground">Прогноз к концу месяца: ~{money(forecast)}</p> : null}
              </>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">
                {revenueTarget.value > 0 ? `План ${money(revenueTarget.value)} · факта пока нет` : 'Активности пока нет'}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Темп и прогноз (карточки) ──────────────────────────────────────────────

function PaceCard({ pace, unit }: { pace: GoalPace; unit: string }) {
  const ahead = pace.gap >= 0
  return (
    <div className={`rounded-2xl border p-4 ${ahead ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]'}`}>
      <div className="flex items-center gap-2">
        <Gauge className={`h-4 w-4 ${ahead ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Темп</p>
      </div>
      {pace.daysLeft > 0 ? (
        <>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {fmt(pace.requiredPerDay)} <span className="text-xs text-muted-foreground">{unit} в день</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            нужно в среднем за оставшиеся {pace.daysLeft} дн. · сейчас {fmt(pace.currentPerDay)} {unit}/день
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm">Период закончился.</p>
      )}
      <p className={`mt-1 text-[11px] font-semibold ${ahead ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
        К этому дню по ритму недели должно быть {fmt(pace.expectedByNow)} {unit} — {ahead ? `опережаем на ${fmt(pace.gap)}` : `отстаём на ${fmt(-pace.gap)}`}
      </p>
    </div>
  )
}

function ForecastCard({ verdict, scope, metric }: { verdict: GoalVerdict | null; scope: GoalsOutlookScope | null; metric: 'revenue' | 'profit' }) {
  const o = scope?.outlook?.outlook
  if (!o) return null
  const key = metric === 'revenue' ? 'income' : 'profit'
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Прогноз к концу месяца</p>
        </div>
        <VerdictBadge verdict={verdict} />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">~ {money(o.realistic[key])}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        от {money(o.pessimistic[key])} до {money(o.optimistic[key])} · модель из «Прогноз и точность»
      </p>
      {verdict && verdict.status !== 'done' ? (
        <p className={`mt-1 text-[11px] font-semibold ${verdict.shortfall > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {verdict.shortfall > 0 ? `Не хватит около ${money(verdict.shortfall)}` : `Запас около ${money(-verdict.shortfall)}`}
        </p>
      ) : null}
    </div>
  )
}

function YoyCard({ base, fact, metric, label }: { base: { value: number }; fact: number; metric: Metric; label: string }) {
  const delta = ((fact - base.value) / base.value) * 100
  const positive = delta >= 0
  const unit = metricMeta(metric).unit
  return (
    <div className={`rounded-2xl border p-4 ${positive ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-rose-500/30 bg-rose-500/[0.05]'}`}>
      <div className="flex items-center gap-2">
        {positive ? <TrendingUp className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /> : <TrendingDown className="h-4 w-4 text-rose-700 dark:text-rose-300" />}
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Год к году</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
        {positive ? '+' : ''}
        {delta.toFixed(1)}%
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {label}: было {fmt(base.value)} {unit} → стало {fmt(fact)} {unit}
      </p>
    </div>
  )
}

// ─── Год / полугодие ────────────────────────────────────────────────────────

function PeriodView({
  tab,
  year,
  facts,
  monthFacts,
  data,
  weights,
  activeMetric,
  setActiveMetric,
  onDelete,
}: {
  tab: Exclude<PeriodKind, 'month'>
  year: number
  facts: Facts
  monthFacts: Facts[]
  data: GoalsData
  weights: number[]
  activeMetric: Metric
  setActiveMetric: (m: Metric) => void
  onDelete: (ids: string[], title: string) => void
}) {
  const { can } = useCapabilities()
  const { plans, companies, dailyAggregates: daily, priorYearMonthly: priorMonthly, priorYearDaily: priorDaily, factEnd } = data
  const { start, end } = periodBounds(tab, year)
  const months = PERIOD_MONTHS[tab]

  const activeTarget = periodTarget(plans, tab, activeMetric, null)
  const explicitPlan = findPlan(plans, tab, null, activeMetric, null)

  // Цели месяцев для графика: цели месяцев, а явную цель периода — по сезонности
  const monthTargets = useMemo(() => {
    const out = new Array(12).fill(0) as number[]
    if (!ADDITIVE.includes(activeMetric)) return out
    if (explicitPlan) {
      const w = seasonalWeights(priorMonthly, activeMetric as 'revenue' | 'profit', null)
      const sum = months.reduce((s, m) => s + w[m], 0) || 1
      for (const m of months) out[m] = (Number(explicitPlan.target_amount) * w[m]) / sum
    } else {
      for (const m of months) out[m] = monthTarget(plans, m, activeMetric, null).value
    }
    return out
  }, [activeMetric, explicitPlan, months, plans, priorMonthly])

  const series = useMemo(
    () =>
      buildSeries({
        daily,
        companyId: null,
        start,
        end,
        factEnd,
        metric: activeMetric,
        monthTargets,
        marginTarget: activeMetric === 'margin' ? activeTarget.value : 0,
        weights,
      }),
    [daily, start, end, factEnd, activeMetric, monthTargets, activeTarget.value, weights],
  )

  const shares = useMemo(() => companyShares(daily, priorMonthly, companies), [daily, priorMonthly, companies])
  const factValue = facts[activeMetric]
  const yoy = yoyBase(priorDaily, null, start, end, factEnd, activeMetric)

  // Итог года по месячным целям выручки
  const summary = yearPlanSummary(
    months.map((m) => ({
      month: m + 1,
      target: monthTarget(plans, m, 'revenue', null).value || null,
      fact: monthFacts[m].revenue,
      closed: periodBounds('month', year, m).end <= factEnd,
    })),
  )
  const orgMonthPlanIds = plans.filter((p) => p.period_kind === 'month' && !p.company_id).map((p) => p.id)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {METRICS.map((m) => {
          const t = periodTarget(plans, tab, m.value, null)
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setActiveMetric(m.value)}
              className={`text-left transition ${activeMetric === m.value ? '' : 'opacity-75 hover:opacity-100'}`}
            >
              <KpiCard metric={m.value} fact={facts[m.value]} plan={t.value > 0 ? t.value : undefined} planLabel={SOURCE_LABEL[t.source]} large={activeMetric === m.value} />
            </button>
          )
        })}
      </div>

      {summary.closedWithPlan > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Trophy className="h-5 w-5 text-amber-500" />
            <p className="text-sm">
              План выручки выполнен в <b>{summary.hit} из {summary.closedWithPlan}</b> закрытых месяцев · факт {money(summary.totalFact)} из {money(summary.totalTarget)} (
              {Math.round((summary.totalFact / Math.max(1, summary.totalTarget)) * 100)}%)
            </p>
          </div>
          {summary.missed.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.missed.map((m) => (
                <span key={m.month} className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-2.5 py-1 text-xs">
                  <b>{MONTH_SHORT[m.month - 1]}</b> {m.pct}% · не хватило {money(m.shortfall)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Динамика: {metricMeta(activeMetric).label}</h2>
          <div className="flex flex-wrap gap-2">
            {explicitPlan && can('goals.delete') ? (
              <Button variant="outline" size="xs" onClick={() => onDelete([explicitPlan.id], `Удалить цель «${PERIOD_LABEL[tab]} · ${metricMeta(activeMetric).label}»?`)}>
                <Trash2 className="h-3.5 w-3.5" /> Удалить цель периода
              </Button>
            ) : null}
            {tab === 'year' && orgMonthPlanIds.length && can('goals.delete') ? (
              <Button variant="outline" size="xs" onClick={() => onDelete(orgMonthPlanIds, `Удалить общие цели всех месяцев ${year}?`)}>
                <Trash2 className="h-3.5 w-3.5" /> Удалить цели месяцев
              </Button>
            ) : null}
          </div>
        </div>
        <GoalChart series={series} metric={activeMetric} />
        <p className="mt-2 text-[11px] text-muted-foreground">Линия цели учитывает сезонность месяцев и ритм недели: выходные дают больше будней.</p>
      </div>

      {yoy ? <YoyCard base={yoy} fact={factValue} metric={activeMetric} label={`${yoy.from.slice(8, 10)}.${yoy.from.slice(5, 7)}–${yoy.until.slice(8, 10)}.${yoy.until.slice(5, 7)}.${year - 1}`} /> : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">По точкам</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => {
            const f = computeFacts(daily, c.id, start, end)
            const ct = periodTarget(plans, tab, activeMetric, c.id)
            const share = shares.get(c.id) || 0
            const allocated = ct.value <= 0 && activeTarget.value > 0 && ADDITIVE.includes(activeMetric) ? Math.round(activeTarget.value * share) : 0
            const value = f[activeMetric]
            return (
              <div key={c.id} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {fmt(value)} <span className="text-xs text-muted-foreground">{metricMeta(activeMetric).unit}</span>
                </p>
                {ct.value > 0 ? (
                  <ProgressLine label={`План ${fmt(ct.value)} ${metricMeta(activeMetric).unit}`} hint={SOURCE_LABEL[ct.source]} pct={Math.round((value / ct.value) * 1000) / 10} />
                ) : allocated > 0 ? (
                  <ProgressLine label={`Доля ${fmt(allocated)} ${metricMeta(activeMetric).unit}`} hint={`(${Math.round(share * 100)}% выручки)`} pct={Math.round((value / allocated) * 1000) / 10} />
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

// ─── Детали месяца ──────────────────────────────────────────────────────────

function MonthDetailDialog({
  year,
  monthIdx,
  facts,
  data,
  weights,
  outlook,
  onClose,
  onDelete,
  onEdit,
}: {
  year: number
  monthIdx: number
  facts: Facts
  data: GoalsData
  weights: number[]
  outlook: GoalsOutlookResponse | null
  onClose: () => void
  onDelete: (ids: string[], title: string) => void
  onEdit: (preset: Partial<FormState>) => void
}) {
  const { can } = useCapabilities()
  const [activeMetric, setActiveMetric] = useState<Metric>('revenue')
  const { plans, companies, dailyAggregates: daily, priorYearMonthly: priorMonthly, priorYearDaily: priorDaily, factEnd } = data
  const { start, end } = periodBounds('month', year, monthIdx)
  const isClosed = end <= factEnd
  const isCurrent = !isClosed && start <= shiftDate(factEnd, 1)

  const target = monthTarget(plans, monthIdx, activeMetric, null)
  const monthTargets = new Array(12).fill(0) as number[]
  monthTargets[monthIdx] = target.value
  const series = buildSeries({
    daily,
    companyId: null,
    start,
    end,
    factEnd,
    metric: activeMetric,
    monthTargets,
    marginTarget: activeMetric === 'margin' ? target.value : 0,
    weights,
  })

  const additive = ADDITIVE.includes(activeMetric)
  const pace = additive && target.value > 0 && !isClosed ? goalPace({ target: target.value, fact: facts[activeMetric], start, end, lastFactDate: factEnd, weights }) : null
  const scope = outlookFor(outlook, year, monthIdx, null)
  const verdict = additive && target.value > 0 ? verdictFor(target.value, facts[activeMetric], scope, activeMetric as 'revenue' | 'profit') : null
  const yoy = yoyBase(priorDaily, null, start, end, factEnd, activeMetric)
  const shares = useMemo(() => companyShares(daily, priorMonthly, companies), [daily, priorMonthly, companies])

  const orgPlans = plans.filter((p) => p.period_kind === 'month' && !p.company_id && p.period_start.slice(5, 7) === mm(monthIdx))
  const revenuePlan = orgPlans.find((p) => p.metric === 'revenue')
  const profitPlan = orgPlans.find((p) => p.metric === 'profit')

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="!w-[96vw] !max-w-[1200px] flex h-[90vh] flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {MONTH_FULL[monthIdx]} {year} — детали месяца
        </DialogTitle>
        <DialogDescription className="sr-only">Факт, план, темп и прогноз по выбранному месяцу с разбивкой по точкам.</DialogDescription>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-amber-500/[0.08] to-amber-500/[0.04] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/30">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold">
                {MONTH_FULL[monthIdx]} {year}
              </p>
              <p className="text-xs text-muted-foreground">{isCurrent ? `Идёт · факт по ${factEnd.slice(8, 10)} ${MONTH_GEN[monthIdx]}` : isClosed ? 'Закрытый месяц' : 'Будущий месяц'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {can('goals.create') ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onEdit({
                    period_kind: 'month',
                    month_idx: monthIdx,
                    company_id: 'all',
                    revenue: revenuePlan ? String(Math.round(revenuePlan.target_amount)) : '',
                    expense: revenuePlan && profitPlan ? String(Math.round(revenuePlan.target_amount - profitPlan.target_amount)) : '',
                  })
                }
              >
                {revenuePlan ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {revenuePlan ? 'Изменить цель' : 'Задать цель'}
              </Button>
            ) : null}
            {orgPlans.length && can('goals.delete') ? (
              <Button variant="outline" size="sm" onClick={() => onDelete(orgPlans.map((p) => p.id), `Удалить общие цели на ${MONTH_FULL[monthIdx].toLowerCase()}?`)}>
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {METRICS.map((m) => {
              const t = monthTarget(plans, monthIdx, m.value, null)
              return (
                <button key={m.value} type="button" onClick={() => setActiveMetric(m.value)} className={`text-left transition ${activeMetric === m.value ? '' : 'opacity-75 hover:opacity-100'}`}>
                  <KpiCard metric={m.value} fact={facts[m.value]} plan={t.value > 0 ? t.value : undefined} planLabel={SOURCE_LABEL[t.source]} large={activeMetric === m.value} />
                </button>
              )
            })}
          </div>

          {pace || (isCurrent && scope?.outlook && additive) || yoy ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {pace ? <PaceCard pace={pace} unit={metricMeta(activeMetric).unit} /> : null}
              {isCurrent && additive ? <ForecastCard verdict={verdict} scope={scope} metric={activeMetric as 'revenue' | 'profit'} /> : null}
              {yoy ? <YoyCard base={yoy} fact={facts[activeMetric]} metric={activeMetric} label={`${MONTH_FULL[monthIdx]} ${year - 1}${isClosed ? '' : ` по ${yoy.until.slice(8, 10)}-е`}`} /> : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Динамика по дням: {metricMeta(activeMetric).label}</h2>
            <GoalChart series={series} metric={activeMetric} height="h-56" />
          </div>

          {companies.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">По точкам</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {companies.map((c) => {
                  const f = computeFacts(daily, c.id, start, end)
                  const value = f[activeMetric]
                  const ct = monthTarget(plans, monthIdx, activeMetric, c.id)
                  const orgTarget = monthTarget(plans, monthIdx, activeMetric, null)
                  const share = shares.get(c.id) || 0
                  const allocated = ct.value <= 0 && orgTarget.source === 'plan' && additive ? Math.round(orgTarget.value * share) : 0
                  const companyTarget = ct.value || allocated
                  const companyPace =
                    additive && companyTarget > 0 && !isClosed
                      ? goalPace({ target: companyTarget, fact: value, start, end, lastFactDate: factEnd, weights: rhythm(daily, priorDaily, c.id, factEnd) })
                      : null
                  const companyVerdict =
                    additive && companyTarget > 0 && isCurrent ? verdictFor(companyTarget, value, outlookFor(outlook, year, monthIdx, c.id), activeMetric as 'revenue' | 'profit') : null
                  return (
                    <div key={c.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{c.name}</p>
                        <VerdictBadge verdict={companyVerdict} />
                      </div>
                      <p className="mt-2 text-xl font-bold tabular-nums">
                        {fmt(value)} <span className="text-xs text-muted-foreground">{metricMeta(activeMetric).unit}</span>
                      </p>
                      {ct.value > 0 ? (
                        <ProgressLine label={`План ${fmt(ct.value)} ${metricMeta(activeMetric).unit}`} pct={Math.round((value / ct.value) * 1000) / 10} />
                      ) : allocated > 0 ? (
                        <ProgressLine label={`Доля ${fmt(allocated)} ${metricMeta(activeMetric).unit}`} hint={`(${Math.round(share * 100)}% выручки)`} pct={Math.round((value / allocated) * 1000) / 10} />
                      ) : (
                        <p className="mt-2 text-[10px] text-muted-foreground">План не задан</p>
                      )}
                      {companyPace && companyPace.daysLeft > 0 ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Нужно <b className="text-foreground">{money(companyPace.requiredPerDay)}</b> в день ·{' '}
                          {companyPace.gap >= 0 ? `опережает ритм на ${money(companyPace.gap)}` : `отстаёт от ритма на ${money(-companyPace.gap)}`}
                        </p>
                      ) : null}
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

// ─── Диалог цели ────────────────────────────────────────────────────────────

function GoalDialog({
  open,
  onOpenChange,
  form,
  setForm,
  year,
  data,
  outlook,
  saving,
  canSave,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  year: number
  data: GoalsData | null
  outlook: GoalsOutlookResponse | null
  saving: boolean
  canSave: boolean
  onSave: () => void
}) {
  const companies = data?.companies ?? NO_COMPANIES
  const plans = data?.plans ?? NO_PLANS
  const priorMonthly = data?.priorYearMonthly ?? NO_PRIOR_MONTHLY
  const orgAllowed = data?.orgPlansAvailable ?? false
  const companyId = form.company_id === 'all' ? null : form.company_id

  // Нельзя задать общую цель (миграция не применена) — выбираем первую точку
  useEffect(() => {
    if (open && !orgAllowed && form.company_id === 'all' && companies.length) setForm((f) => ({ ...f, company_id: companies[0].id }))
  }, [open, orgAllowed, form.company_id, companies, setForm])

  const parse = (raw: string) => Number(String(raw).replace(/\s/g, '').replace(',', '.')) || 0
  const rev = parse(form.revenue)
  const exp = parse(form.expense)
  const profit = rev - exp
  const margin = rev > 0 ? (profit / rev) * 100 : 0

  // Уже заданная цель на выбранный период
  const existingRevenue =
    form.period_kind === 'month' ? findPlan(plans, 'month', form.month_idx, 'revenue', companyId) : findPlan(plans, form.period_kind, null, 'revenue', companyId)
  const existingProfit =
    form.period_kind === 'month' ? findPlan(plans, 'month', form.month_idx, 'profit', companyId) : findPlan(plans, form.period_kind, null, 'profit', companyId)

  // Подсказки: прогноз для идущего/следующего месяца, иначе прошлый год с ростом
  const suggestions = useMemo(() => {
    if (form.period_kind !== 'month' || !data) return []
    const key = `${year}-${mm(form.month_idx)}`
    const scope = outlook ? (companyId ? outlook.companies[companyId] : outlook.org) : null
    const scenarios = scope && outlook ? (key === outlook.month ? scope.outlook?.outlook ?? null : key === outlook.nextMonth ? scope.next : null) : null
    const lastRow = priorMonthly.filter((r) => matchCompany(r.company_id, companyId) && r.month === form.month_idx + 1)
    const lastYear = lastRow.length ? { revenue: lastRow.reduce((s, r) => s + r.revenue, 0), expense: lastRow.reduce((s, r) => s + r.expenses, 0) } : null
    const ytd = computeFacts(data.dailyAggregates, companyId, `${year}-01-01`, data.factEnd).revenue
    const priorYtd = yoyBase(data.priorYearDaily, companyId, `${year}-01-01`, `${year}-12-31`, data.factEnd, 'revenue')
    const growth = priorYtd && ytd > 0 ? ytd / priorYtd.value : null
    return suggestTargets({ scenarios, lastYear, growth })
  }, [form.period_kind, form.month_idx, companyId, data, outlook, priorMonthly, year])

  const hasPriorData = priorMonthly.some((r) => matchCompany(r.company_id, companyId) && (r.revenue !== 0 || r.expenses !== 0))
  const wRev = seasonalWeights(priorMonthly, 'revenue', companyId)
  const wProf = seasonalWeights(priorMonthly, 'profit', companyId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existingRevenue ? 'Изменить цель' : 'Новая цель'}</DialogTitle>
          <DialogDescription>Заполни выручку и расходы — прибыль и маржа посчитаются сами.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Период</Label>
              <Select value={form.period_kind} onValueChange={(v) => setForm((f) => ({ ...f, period_kind: v as PeriodKind }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_FULL.map((m, idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Год</Label>
                <div className="grid h-10 place-items-center rounded-lg border border-border bg-card text-sm tabular-nums">{year}</div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Точка</Label>
            <Select value={form.company_id} onValueChange={(v) => setForm((f) => ({ ...f, company_id: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" disabled={!orgAllowed}>
                  Вся организация{orgAllowed ? '' : ' (нужна миграция)'}
                </SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {existingRevenue ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs">
              <span>
                Уже задано: выручка {money(existingRevenue.target_amount)}
                {existingProfit ? `, прибыль ${money(existingProfit.target_amount)}` : ''}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    revenue: String(Math.round(existingRevenue.target_amount)),
                    expense: existingProfit ? String(Math.round(existingRevenue.target_amount - existingProfit.target_amount)) : f.expense,
                  }))
                }
              >
                Подставить
              </Button>
            </div>
          ) : null}

          {suggestions.length ? (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">
                Подсказка {suggestions[0].source === 'forecast' ? '— из прогноза' : '— по прошлому году с ростом этого года'}
              </Label>
              <div className="grid grid-cols-3 gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, revenue: String(s.revenue), expense: String(s.expense) }))}
                    className={`rounded-lg border px-2 py-1.5 text-left transition hover:bg-surface-muted ${rev === s.revenue ? 'border-amber-500/50 bg-amber-500/[0.06]' : 'border-border'}`}
                  >
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    <p className="text-xs font-semibold tabular-nums">{fmt(s.revenue / 1000)}k</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-emerald-700 dark:text-emerald-300">Выручка, ₸</Label>
              <Input value={form.revenue} onChange={(e) => setForm((f) => ({ ...f, revenue: e.target.value }))} placeholder="0" inputMode="numeric" className="h-11 text-base tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-rose-700 dark:text-rose-300">Расходы, ₸</Label>
              <Input value={form.expense} onChange={(e) => setForm((f) => ({ ...f, expense: e.target.value }))} placeholder="0" inputMode="numeric" className="h-11 text-base tabular-nums" />
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Прибыль</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${profit >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{money(profit)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Маржа</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${margin >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{margin.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          {form.period_kind === 'year' ? (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox className="mt-0.5" checked={form.distributeSeasonal} onCheckedChange={(v) => setForm((f) => ({ ...f, distributeSeasonal: v === true }))} />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">Разложить по месяцам с учётом сезонности</p>
                  <p className="text-[11px] text-muted-foreground">
                    {hasPriorData ? `Веса — из факта ${year - 1} года. Появятся цели на каждый месяц.` : `За ${year - 1} нет данных — поровну на каждый месяц.`}
                  </p>
                </div>
              </label>
              {form.distributeSeasonal && rev > 0 ? (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {MONTH_SHORT.map((label, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-card px-2 py-1.5 text-center">
                      <p className="text-[9px] uppercase text-muted-foreground">{label}</p>
                      <p className="text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt((rev * wRev[idx]) / 1000)}k</p>
                      <p className="text-[10px] tabular-nums text-amber-700 dark:text-amber-300">{fmt((profit * wProf[idx]) / 1000)}k</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          {canSave ? (
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
