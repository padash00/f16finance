'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Lock, Plus, RefreshCw, Target, Trash2 } from 'lucide-react'
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

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isAbortError } from '@/lib/is-abort-error'

const MONTH_LABELS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const METRICS: { value: Metric; label: string; unit: string }[] = [
  { value: 'revenue', label: 'Выручка', unit: '₸' },
  { value: 'profit', label: 'Прибыль', unit: '₸' },
  { value: 'checks', label: 'Число чеков', unit: 'шт' },
  { value: 'avg_check', label: 'Средний чек', unit: '₸' },
  { value: 'margin', label: 'Маржа', unit: '%' },
]

const PERIOD_LABELS: Record<PeriodKind, string> = {
  year: 'Год',
  h1: 'I полугодие',
  h2: 'II полугодие',
  month: 'Месяц',
}

type Metric = 'revenue' | 'profit' | 'checks' | 'avg_check' | 'margin'
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

type ApiResponse = {
  ok: boolean
  data?: { year: number; companies: Company[]; plans: Plan[]; dailyAggregates?: DailyAggregate[] }
  error?: string
}

const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU')

function metricUnit(m: Metric | null) {
  return METRICS.find((x) => x.value === m)?.unit || ''
}

function metricLabel(m: Metric | null) {
  return METRICS.find((x) => x.value === m)?.label || m || ''
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

/**
 * Кумулятивная серия для графика плана.
 * - Для revenue / profit / checks / avg_check / margin строим день-за-днём
 * - Цель — прямая линия от 0 до target равномерно по дням периода
 * - Сегодня и будущее — фактическая линия обрывается, целевая идёт до конца
 */
function buildSeries(params: {
  plan: Plan
  daily: DailyAggregate[]
}): Array<{ day: string; idx: number; Факт: number | null; Цель: number }> {
  const { plan, daily } = params
  const dates = enumerateDates(plan.period_start, plan.period_end)
  if (dates.length === 0) return []
  const todayKey = new Date().toISOString().slice(0, 10)

  // Фильтруем daily по company_id плана: общий план -> только company_id===null строки
  const target = Number(plan.target_amount || 0)
  const factByDate = new Map<string, { revenue: number; expenses: number; checks: number }>()
  for (const r of daily) {
    if (r.date < plan.period_start || r.date > plan.period_end) continue
    if (plan.company_id) {
      if (r.company_id !== plan.company_id) continue
    } else {
      if (r.company_id !== null) continue // только агрегированные (org)
    }
    const cur = factByDate.get(r.date) || { revenue: 0, expenses: 0, checks: 0 }
    cur.revenue += r.revenue
    cur.expenses += r.expenses
    cur.checks += r.checks
    factByDate.set(r.date, cur)
  }

  // Кумуляторы
  let cumRevenue = 0
  let cumExpenses = 0
  let cumChecks = 0
  const result: Array<{ day: string; idx: number; Факт: number | null; Цель: number }> = []
  const totalDays = dates.length
  dates.forEach((d, i) => {
    const day = d
    const t = factByDate.get(day)
    if (t) {
      cumRevenue += t.revenue
      cumExpenses += t.expenses
      cumChecks += t.checks
    }
    let factValue: number | null = null
    if (day <= todayKey) {
      switch (plan.metric) {
        case 'revenue':
          factValue = Math.round(cumRevenue)
          break
        case 'profit':
          factValue = Math.round(cumRevenue - cumExpenses)
          break
        case 'checks':
          factValue = cumChecks
          break
        case 'avg_check':
          factValue = cumChecks > 0 ? Math.round(cumRevenue / cumChecks) : 0
          break
        case 'margin':
          factValue = cumRevenue > 0 ? Math.round(((cumRevenue - cumExpenses) / cumRevenue) * 1000) / 10 : 0
          break
        default:
          factValue = 0
      }
    }
    // Целевая линия:
    //   - кумулятивные KPI (revenue, profit, checks) растут линейно от 0 до target
    //   - не-кумулятивные (avg_check, margin) — горизонтальная линия на уровне target
    const targetValue =
      plan.metric === 'avg_check' || plan.metric === 'margin'
        ? target
        : Math.round((target * (i + 1)) / totalDays)
    result.push({
      day: `${day.slice(8, 10)}.${day.slice(5, 7)}`,
      idx: i + 1,
      Факт: factValue,
      Цель: targetValue,
    })
  })
  return result
}

export default function GoalsPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [tab, setTab] = useState<PeriodKind>('month')
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    period_kind: 'month' as PeriodKind,
    month_idx: new Date().getMonth(),
    metric: 'revenue' as Metric,
    company_id: 'all' as string,
    target_amount: '',
  })
  const [saving, setSaving] = useState(false)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/kpi-plans?year=${year}`, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as ApiResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить планы')
      setData(json.data)
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

  const filteredPlans = useMemo(
    () => plans.filter((p) => p.period_kind === tab),
    [plans, tab],
  )

  const monthGroups = useMemo(() => {
    const map = new Map<number, Plan[]>()
    for (const p of filteredPlans) {
      const mIdx = parseInt(p.period_start.slice(5, 7), 10) - 1
      if (Number.isFinite(mIdx)) {
        const list = map.get(mIdx) || []
        list.push(p)
        map.set(mIdx, list)
      }
    }
    return map
  }, [filteredPlans])

  const groupedByCompanyMetric = useMemo(() => {
    const map: Record<string, Record<Metric, Plan[]>> = {}
    for (const p of filteredPlans) {
      if (!p.metric) continue
      const key = p.company_id || '__org__'
      map[key] = map[key] || ({} as Record<Metric, Plan[]>)
      const arr = map[key][p.metric] || []
      arr.push(p)
      map[key][p.metric] = arr
    }
    return map
  }, [filteredPlans])

  const summary = useMemo(() => {
    const byMetric: Record<Metric, { plan: number; fact: number; count: number }> = {
      revenue: { plan: 0, fact: 0, count: 0 },
      profit: { plan: 0, fact: 0, count: 0 },
      checks: { plan: 0, fact: 0, count: 0 },
      avg_check: { plan: 0, fact: 0, count: 0 },
      margin: { plan: 0, fact: 0, count: 0 },
    }
    for (const p of filteredPlans) {
      if (!p.metric) continue
      if (p.company_id) continue // только общеорганизационные
      byMetric[p.metric].plan += Number(p.target_amount || 0)
      byMetric[p.metric].fact += Number(p.fact_value || 0)
      byMetric[p.metric].count += 1
    }
    return byMetric
  }, [filteredPlans])

  const handleAddPlan = async () => {
    const target = Number(String(form.target_amount).replace(/\s/g, '').replace(',', '.'))
    if (!Number.isFinite(target) || target <= 0) {
      setError('Введите цель больше 0')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/admin/kpi-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          period_kind: form.period_kind,
          month_idx: form.period_kind === 'month' ? form.month_idx : undefined,
          metric: form.metric,
          company_id: form.company_id === 'all' ? null : form.company_id,
          target_amount: target,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setSuccess('План сохранён')
      setTimeout(() => setSuccess(null), 2000)
      setDialogOpen(false)
      setForm((f) => ({ ...f, target_amount: '' }))
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
      const response = await fetch(`/api/admin/kpi-plans?id=${encodeURIComponent(planId)}`, { method: 'DELETE' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить')
    }
  }

  return (
    <div className="app-page-wide space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
            <Target className="h-5 w-5 text-blue-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">Цели и план</h1>
            <p className="truncate text-xs text-muted-foreground">План vs факт по периодам и точкам</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            <Button size="sm" variant="ghost" onClick={() => setYear((y) => y - 1)} className="h-8 w-8 p-0" disabled={loading}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm font-medium tabular-nums">{year}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setYear((y) => Math.min(currentYear + 1, y + 1))}
              className="h-8 w-8 p-0"
              disabled={loading || year >= currentYear + 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)} className="h-9 gap-1.5 bg-blue-600 hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" />
            Новый план
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div>
      ) : null}

      <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
        {(['year', 'h1', 'h2', 'month'] as PeriodKind[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setTab(p)}
            className={`rounded-md px-3 py-1.5 transition ${tab === p ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Card className="border-white/10 bg-card/70 p-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Грузим планы за {year}…
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {METRICS.map((m) => {
              const row = summary[m.value]
              const pct = row.plan > 0 ? Math.round((row.fact / row.plan) * 1000) / 10 : 0
              const positive = pct >= 100
              return (
                <Card
                  key={m.value}
                  className={`border p-3 ${row.count > 0 ? (positive ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]') : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{m.label}</p>
                  {row.count > 0 ? (
                    <>
                      <p className="mt-1 text-base font-semibold tabular-nums">
                        {fmt(row.fact)} <span className="text-xs text-muted-foreground">/ {fmt(row.plan)} {m.unit}</span>
                      </p>
                      <p className={`mt-0.5 text-xs ${positive ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {pct}%{positive ? ' ✓' : ''}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">План не задан</p>
                  )}
                </Card>
              )
            })}
          </div>

          {tab === 'month' ? (
            <MonthsView year={year} monthGroups={monthGroups} companies={companies} daily={daily} onDelete={handleDelete} />
          ) : (
            <PeriodsView groupedByCompanyMetric={groupedByCompanyMetric} companies={companies} daily={daily} onDelete={handleDelete} />
          )}

          {filteredPlans.length === 0 ? (
            <Card className="border-dashed border-white/10 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              На {PERIOD_LABELS[tab].toLowerCase()} планов пока нет. Нажми «Новый план».
            </Card>
          ) : null}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новый план</DialogTitle>
            <DialogDescription>Задай цель по KPI на выбранный период.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Период</Label>
              <Select value={form.period_kind} onValueChange={(v) => setForm((f) => ({ ...f, period_kind: v as PeriodKind }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="year">Год</SelectItem>
                  <SelectItem value="h1">I полугодие</SelectItem>
                  <SelectItem value="h2">II полугодие</SelectItem>
                  <SelectItem value="month">Месяц</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.period_kind === 'month' ? (
              <div className="space-y-1.5">
                <Label>Месяц</Label>
                <Select value={String(form.month_idx)} onValueChange={(v) => setForm((f) => ({ ...f, month_idx: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS_RU.map((m, idx) => (
                      <SelectItem key={idx} value={String(idx)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>KPI</Label>
              <Select value={form.metric} onValueChange={(v) => setForm((f) => ({ ...f, metric: v as Metric }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label} ({m.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <div className="space-y-1.5">
              <Label>Цель ({METRICS.find((m) => m.value === form.metric)?.unit})</Label>
              <Input
                value={form.target_amount}
                onChange={(e) => setForm((f) => ({ ...f, target_amount: e.target.value }))}
                placeholder="0"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleAddPlan} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MonthsView({
  year,
  monthGroups,
  companies,
  daily,
  onDelete,
}: {
  year: number
  monthGroups: Map<number, Plan[]>
  companies: Company[]
  daily: DailyAggregate[]
  onDelete: (id: string) => void
}) {
  return (
    <Card className="border-white/10 bg-card/70 overflow-hidden p-0">
      <div className="border-b border-white/10 px-5 py-3">
        <h2 className="text-sm font-semibold">Планы по месяцам · {year}</h2>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {MONTH_LABELS_RU.map((mLabel, idx) => {
          const plans = monthGroups.get(idx) || []
          if (plans.length === 0) {
            return (
              <div key={idx} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium">{mLabel}</span>
                <span className="text-muted-foreground">План не задан</span>
              </div>
            )
          }
          return (
            <div key={idx} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{mLabel}</span>
                {plans[0]?.is_closed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-300">
                    <Lock className="h-3 w-3" /> Закрыт
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    Открыт
                  </span>
                )}
              </div>
              <div className="mt-2 space-y-1.5">
                {plans.map((p) => (
                  <PlanRow key={p.id} plan={p} companies={companies} daily={daily} onDelete={onDelete} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function PeriodsView({
  groupedByCompanyMetric,
  companies,
  daily,
  onDelete,
}: {
  groupedByCompanyMetric: Record<string, Record<Metric, Plan[]>>
  companies: Company[]
  daily: DailyAggregate[]
  onDelete: (id: string) => void
}) {
  const keys = Object.keys(groupedByCompanyMetric)
  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const company = key === '__org__' ? null : companies.find((c) => c.id === key)
        const title = company ? company.name : 'Общий план по организации'
        const metricMap = groupedByCompanyMetric[key]
        const allPlans: Plan[] = Object.values(metricMap).flat()
        return (
          <Card key={key} className="border-white/10 bg-card/70 p-5">
            <h2 className="mb-3 text-sm font-semibold">{title}</h2>
            <div className="space-y-1.5">
              {allPlans.map((p) => (
                <PlanRow key={p.id} plan={p} companies={companies} daily={daily} onDelete={onDelete} />
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function PlanRow({
  plan,
  companies,
  daily,
  onDelete,
}: {
  plan: Plan
  companies: Company[]
  daily: DailyAggregate[]
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const target = Number(plan.target_amount || 0)
  const fact = Number(plan.fact_value || 0)
  const pct = target > 0 ? Math.round((fact / target) * 1000) / 10 : 0
  const positive = pct >= 100
  const company = plan.company_id ? companies.find((c) => c.id === plan.company_id) : null
  const unit = metricUnit(plan.metric)

  const series = useMemo(
    () => (expanded ? buildSeries({ plan, daily }) : []),
    [expanded, plan, daily],
  )

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="grid grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_36px] items-center gap-3 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground"
          title={expanded ? 'Свернуть график' : 'Показать график'}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="min-w-0">
          <p className="truncate font-medium">{metricLabel(plan.metric)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {company ? company.name : 'Общий'}
            {plan.is_closed ? ' · закрыт' : ''}
          </p>
        </div>
        <div className="text-right tabular-nums">
          <p className="text-xs text-muted-foreground">План</p>
          <p className="font-semibold">{fmt(target)} {unit}</p>
        </div>
        <div className="text-right tabular-nums">
          <p className="text-xs text-muted-foreground">Факт</p>
          <p className={`font-semibold ${positive ? 'text-emerald-300' : pct > 0 ? 'text-amber-300' : 'text-muted-foreground'}`}>
            {fmt(fact)} {unit}
          </p>
        </div>
        <div>
          <div className="flex items-center justify-end gap-2 tabular-nums">
            <span className={`text-sm font-semibold ${positive ? 'text-emerald-300' : pct > 0 ? 'text-amber-300' : 'text-muted-foreground'}`}>
              {pct}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full transition-all ${positive ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(plan.id)}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-400 transition hover:bg-rose-500/10"
            title="Удалить план"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-white/[0.06] p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Кумулятивный факт по дням vs пропорциональная цель ·
            {' '}{plan.period_start.slice(8, 10)}.{plan.period_start.slice(5, 7)} — {plan.period_end.slice(8, 10)}.{plan.period_end.slice(5, 7)}
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.45)" fontSize={10} interval="preserveStartEnd" />
                <YAxis
                  stroke="rgba(255,255,255,0.45)"
                  fontSize={10}
                  tickFormatter={(v) => {
                    if (plan.metric === 'margin') return `${v}%`
                    if (plan.metric === 'checks' || plan.metric === 'avg_check') return fmt(Number(v))
                    return `${Math.round(Number(v) / 1000)}k`
                  }}
                />
                <Tooltip
                  formatter={(v: any) => {
                    if (v == null) return '—'
                    if (plan.metric === 'margin') return `${v}%`
                    return `${fmt(Number(v))} ${unit}`
                  }}
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Цель" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line type="monotone" dataKey="Факт" stroke={positive ? '#10b981' : '#f59e0b'} strokeWidth={2.5} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  )
}
