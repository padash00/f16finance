'use client'

/**
 * /ai-cfo — разбор периода глазами финдиректора.
 *
 * Цифры считает сервер (lib/analysis/cfo-review) так же, как /reports:
 * итоги, почему изменилась прибыль, вклад точек, безубыточность, оценка
 * здоровья. Калькулятор «что если» — формула в браузере. ИИ запускается
 * только кнопкой и объясняет уже посчитанное.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Calculator,
  HeartPulse,
  Info,
  Loader2,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Store,
  Target,
  TrendingUp,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { NativeSelect } from '@/components/ui/native-select'
import { readApiCache, writeApiCache } from '@/lib/client/use-api-cache'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { whatIf, type CfoReview } from '@/lib/analysis/cfo-review'
import type { MonthlyForecastResponse } from '@/lib/analysis/forecast-scope'

type Company = { id: string; name: string }

type CfoResponse = CfoReview & {
  ok: boolean
  days: number
  dateFrom: string
  dateTo: string
  prevFrom: string
  prevTo: string
  hasExtra: boolean
  includeExtra: boolean
  ai: AiAnalysis | null
}

type Tagged = { text: string; status: string }
type AiAnalysis = {
  state?: string
  changes?: Tagged[]
  rootCauses?: Tagged[]
  risks?: Array<{ risk: string; probability: string; impact: string; level: string }>
  losses?: Array<{ text: string; amount: string; status: string }>
  missedProfit?: Array<{ text: string; potential: string; status: string }>
  opportunities?: Array<{ title: string; action: string; effect: string; status: string }>
  actionPlan?: { today?: string[]; week?: string[]; month?: string[] }
  summary?: { where_losing: string; where_earn: string; main_risk: string; main_opportunity: string; extra_profit: string; three_actions: string[] } | null
  error?: string
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const money = (v: number) => `${Math.round(v || 0).toLocaleString('ru-RU')} ₸`
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('ru-RU')} ₸`
const dm = (iso?: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '')
const range = (a?: string, b?: string) => (a && b ? `${dm(a)}.${a.slice(0, 4)} — ${dm(b)}.${b.slice(0, 4)}` : '')
// Модель иногда оставляет теги статуса в тексте
const clean = (s?: string | null) => String(s || '').replace(/\[(ФАКТ|ОЦЕНКА|ГИПОТЕЗА)\]\s*/gi, '').trim()

function monthOptions() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
  })
}
function monthRange(value: string) {
  const [y, m] = value.split('-').map(Number)
  return { dateFrom: `${value}-01`, dateTo: `${value}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}

type Params = { days?: number; dateFrom?: string; dateTo?: string; company_id?: string; include_extra?: boolean }

function Delta({ value, goodWhenUp = true, pp = false, hidden = false }: { value: number; goodWhenUp?: boolean; pp?: boolean; hidden?: boolean }) {
  if (hidden) return <span className="text-xs text-muted-foreground">не с чем сравнить</span>
  if (!value) return <span className="text-xs text-muted-foreground">без изменений</span>
  const up = value > 0
  const good = up === goodWhenUp
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
      {pp ? ' п.п.' : '%'}
    </span>
  )
}

function HowCalculated({ children }: { children: ReactNode }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <Info className="h-3.5 w-3.5" /> Как считается
      </summary>
      <div className="mt-2 space-y-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  )
}

function SectionTitle({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

const StatusTag = ({ status }: { status?: string }) => {
  const s = String(status || '').toUpperCase()
  if (!s) return null
  const cls = s.includes('ФАКТ')
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : s.includes('ОЦЕНКА')
      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'bg-slate-500/10 text-muted-foreground'
  const label = s.includes('ФАКТ') ? 'факт' : s.includes('ОЦЕНКА') ? 'оценка' : 'гипотеза'
  return <span className={`ml-1.5 inline-block rounded px-1.5 py-px align-middle text-[10px] font-medium ${cls}`}>{label}</span>
}

export default function AiCfoPage() {
  const { can } = useCapabilities()
  const canGenerate = can('ai-cfo.generate')
  const MONTH_OPTIONS = useMemo(() => monthOptions(), [])

  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [period, setPeriod] = useState('d30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<CfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<AiAnalysis | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(Array.isArray(j?.data) ? j.data : []))
      .catch(() => setCompanies([]))
  }, [])

  const waitingForDates = period === 'custom' && !(customFrom && customTo)

  const params = useMemo<Params | null>(() => {
    const base: Params = {}
    if (period.startsWith('d')) base.days = Number(period.slice(1))
    else if (period.startsWith('m:')) Object.assign(base, monthRange(period.slice(2)))
    else if (customFrom && customTo) Object.assign(base, { dateFrom: customFrom, dateTo: customTo })
    else return null
    if (companyId) base.company_id = companyId
    else if (includeExtra) base.include_extra = true
    return base
  }, [period, customFrom, customTo, companyId, includeExtra])

  const paramsKey = params ? JSON.stringify(params) : ''

  const load = useCallback(
    async (force = false) => {
      if (!params) return
      const cacheKey = `cfo:${paramsKey}`
      const cached = force ? null : readApiCache<CfoResponse>(cacheKey)
      if (cached) setData(cached)
      setLoading(!cached)
      setError(null)
      // Разбор ИИ привязан к периоду: сменили период — старый разбор не показываем
      let savedAi: AiAnalysis | null = null
      try {
        const raw = sessionStorage.getItem(`orda.cfo.ai.v2.${paramsKey}`)
        if (raw) {
          const c = JSON.parse(raw)
          if (c?.ai && Date.now() - c.ts < 3 * 3600_000) savedAi = c.ai
        }
      } catch {}
      setAi(savedAi)
      try {
        const res = await fetch('/api/ai/cfo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, ai: false }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось посчитать')
        setData(body)
        writeApiCache(cacheKey, body)
      } catch (e: any) {
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey],
  )

  useEffect(() => {
    void load()
  }, [load])

  const askAi = async () => {
    if (!params) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/ai/cfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, ai: true }),
      })
      const body = await res.json().catch(() => null)
      const analysis: AiAnalysis = body?.ai || { error: body?.error || 'ИИ недоступен' }
      setAi(analysis)
      if (!analysis.error) {
        try {
          sessionStorage.setItem(`orda.cfo.ai.v2.${paramsKey}`, JSON.stringify({ ts: Date.now(), ai: analysis }))
        } catch {}
      }
    } catch {
      setAi({ error: 'ИИ недоступен' })
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="app-page-wide space-y-5 text-foreground">
      <AdminPageHeader
        title="AI Финдиректор"
        description="Почему прибыль такая, что на неё повлияло и что с этим делать"
        icon={<Briefcase className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Период">
              <option value="d7">7 дней</option>
              <option value="d30">30 дней</option>
              <option value="d90">90 дней</option>
              <option value="d365">Год</option>
              {MONTH_OPTIONS.map((o) => (
                <option key={o.value} value={`m:${o.value}`}>
                  {o.label}
                </option>
              ))}
              <option value="custom">Свой период</option>
            </NativeSelect>
            {period === 'custom' ? (
              <>
                <DatePicker value={customFrom} max={customTo || undefined} onChange={setCustomFrom} />
                <span className="text-sm text-muted-foreground">—</span>
                <DatePicker value={customTo} min={customFrom || undefined} onChange={setCustomTo} />
              </>
            ) : null}
            <NativeSelect className="w-auto" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Точка">
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {data?.hasExtra && !companyId ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={includeExtra} onCheckedChange={(v) => setIncludeExtra(v === true)} /> с Extra
              </label>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || waitingForDates}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
            </Button>
          </div>
        }
      />

      {waitingForDates ? <p className="text-sm text-muted-foreground">Выберите обе даты периода.</p> : null}

      {error ? (
        <Card className="flex-row items-center gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      ) : null}

      {loading && !data ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm">Считаем доходы, расходы и что изменилось…</p>
        </div>
      ) : data ? (
        <div className={loading ? 'space-y-5 opacity-60 transition-opacity' : 'space-y-5'}>
          <Totals data={data} />
          <DataGaps data={data} />
          <BridgeCard data={data} />
          <div className="grid gap-5 xl:grid-cols-2">
            <CompaniesCard data={data} />
            <HealthCard data={data} />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <SafetyCard data={data} />
            <WhatIfCard data={data} />
          </div>
          <ForecastCard companyId={companyId} includeExtra={includeExtra} />
          <AiCard ai={ai} loading={aiLoading} canGenerate={canGenerate} onAsk={askAi} disabled={loading} />
        </div>
      ) : null}
    </div>
  )
}

// ── Итоги ───────────────────────────────────────────────────────────────────

function Totals({ data }: { data: CfoResponse }) {
  const ex = data.executive
  const noPrev = data.previous.revenue === 0 && data.previous.expenses === 0
  const tiles = [
    { label: 'Выручка', value: money(ex.revenue), delta: <Delta value={ex.revenueDeltaPct} hidden={noPrev} /> },
    { label: 'Расходы', value: money(ex.expenses), delta: <Delta value={ex.expensesDeltaPct} goodWhenUp={false} hidden={noPrev} /> },
    {
      label: 'Прибыль',
      value: money(ex.profit),
      delta: <Delta value={ex.profitDeltaPct} hidden={noPrev} />,
      tone: ex.profit < 0 ? 'text-rose-600 dark:text-rose-400' : '',
    },
    { label: 'Маржа', value: `${ex.margin.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, delta: <Delta value={ex.marginDeltaPp} pp hidden={noPrev} /> },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="gap-1 p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={`text-xl font-semibold tabular-nums ${t.tone || ''}`}>{t.value}</p>
            {t.delta}
          </Card>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {range(data.dateFrom, data.dateTo)} против {range(data.prevFrom, data.prevTo)} · считается как в{' '}
        <Link href="/reports" className="text-violet-600 hover:underline dark:text-violet-400">
          отчётах
        </Link>
        : все расходы, безнал ночной смены — на следующий день{data.hasExtra && !data.includeExtra ? ', без F16 Extra' : ''}.
      </p>
    </div>
  )
}

function DataGaps({ data }: { data: CfoResponse }) {
  const { gaps, daysInPeriod } = data.dataQuality
  if (!gaps.length) return null
  return (
    <Card className="flex-row items-start gap-2 border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        Отчёты внесены не за все дни — выводы по этим точкам неточные:{' '}
        {gaps.map((g, i) => (
          <span key={g.companyId}>
            {i ? ', ' : ''}
            <b>{g.name}</b> ({g.daysWithSales} из {daysInPeriod} дн.)
          </span>
        ))}
        .
      </div>
    </Card>
  )
}

// ── Почему изменилась прибыль ───────────────────────────────────────────────

function BridgeCard({ data }: { data: CfoResponse }) {
  const { bridge } = data
  const change = bridge.endProfit - bridge.startProfit
  const maxAbs = Math.max(1, ...bridge.lines.map((l) => Math.abs(l.effect)))
  const noPrev = data.previous.revenue === 0 && data.previous.expenses === 0
  return (
    <Card className="gap-0 p-5">
      <SectionTitle
        icon={<Scale className="h-4 w-4 text-violet-500" />}
        title="Почему прибыль изменилась"
        subtitle={
          noPrev
            ? 'В прошлом периоде нет данных — сравнивать не с чем.'
            : `Была ${money(bridge.startProfit)}, стала ${money(bridge.endProfit)} (${signed(change)}). Что добавило и что отняло:`
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/expenses">
              Расходы <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />
      {noPrev ? null : (
        <div className="space-y-1">
          {bridge.lines.map((line) => {
            const up = line.effect >= 0
            const width = `${Math.max(2, (Math.abs(line.effect) / maxAbs) * 100)}%`
            const verb =
              line.kind === 'revenue'
                ? `${money(line.previous)} → ${money(line.current)}`
                : `${money(line.previous)} → ${money(line.current)} расходов`
            return (
              <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 hover:bg-surface-muted sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7.5rem]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {line.label}
                    {line.groupLabel ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{line.groupLabel}</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{verb}</p>
                </div>
                <div className="order-3 col-span-2 flex h-2.5 sm:order-none sm:col-span-1">
                  <div className="relative h-2.5 w-full rounded-full bg-surface-muted">
                    <div
                      className={`absolute top-0 h-2.5 rounded-full ${up ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-rose-500'}`}
                      style={{ width: `calc(${width} / 2)` }}
                    />
                    <div className="absolute left-1/2 top-[-2px] h-[14px] w-px bg-border" />
                  </div>
                </div>
                <p className={`text-right text-sm font-semibold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {signed(line.effect)}
                </p>
              </div>
            )
          })}
          <div className="mt-2 flex items-center justify-between border-t border-border px-2 pt-3 text-sm">
            <span className="font-medium">Итого изменение прибыли</span>
            <span className={`font-semibold tabular-nums ${change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{signed(change)}</span>
          </div>
        </div>
      )}
      <HowCalculated>
        <p>Прибыль = выручка − все расходы (как в отчётах). Изменение прибыли раскладывается без остатка: рост выручки её добавляет, рост статьи расходов — отнимает.</p>
        <p>Показаны статьи с самым сильным влиянием, остальные — одной строкой. Сумма всех строк равна изменению прибыли.</p>
        <p>
          С чем сравниваем: месяц — с прошлым месяцем, идущий месяц — с теми же днями прошлого месяца, остальные периоды — с таким же
          отрезком сразу перед выбранным. Сегодняшний день не входит: отчёты смен за него ещё не внесены.
        </p>
      </HowCalculated>
    </Card>
  )
}

// ── Точки ───────────────────────────────────────────────────────────────────

function CompaniesCard({ data }: { data: CfoResponse }) {
  const rows = [...data.companies].sort((a, b) => a.profitDelta - b.profitDelta)
  const maxAbs = Math.max(1, ...rows.map((c) => Math.abs(c.profitDelta)))
  return (
    <Card className="gap-0 p-5">
      <SectionTitle icon={<Store className="h-4 w-4 text-sky-500" />} title="Какая точка сколько добавила" subtitle="Изменение прибыли каждой точки к прошлому периоду. Сверху — те, что отняли больше всего." />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет данных по точкам.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((c) => (
            <div key={c.companyId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{c.name}</span>
                <span className={`shrink-0 font-semibold tabular-nums ${c.profitDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {signed(c.profitDelta)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                <div
                  className={`h-1.5 rounded-full ${c.profitDelta >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ width: `${Math.max(2, (Math.abs(c.profitDelta) / maxAbs) * 100)}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                прибыль {money(c.profit)} · выручка {money(c.revenue)} · маржа {c.margin.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Здоровье ────────────────────────────────────────────────────────────────

function HealthCard({ data }: { data: CfoResponse }) {
  const { health } = data
  const tone = health.score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : health.score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
  const bar = (share: number) => (share >= 0.8 ? 'bg-emerald-500' : share >= 0.5 ? 'bg-amber-500' : 'bg-rose-500')
  return (
    <Card className="gap-0 p-5">
      <SectionTitle icon={<HeartPulse className="h-4 w-4 text-rose-500" />} title="Здоровье бизнеса" subtitle="Одна формула — при тех же цифрах всегда тот же балл." />
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-bold tabular-nums ${tone}`}>{health.score}</span>
        <span className="pb-1 text-sm text-muted-foreground">/ 100 · {health.band === 'healthy' ? 'здоровый' : health.band === 'attention' ? 'требует внимания' : 'проблемный'}</span>
      </div>
      <div className="mt-4 space-y-3">
        {health.items.map((item) => (
          <div key={item.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {item.points} из {item.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
              <div className={`h-1.5 rounded-full ${bar(item.points / item.max)}`} style={{ width: `${(item.points / item.max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p>
          </div>
        ))}
      </div>
      {health.missing.length ? <p className="mt-3 text-xs text-muted-foreground">Не учтено: {health.missing.join('; ')}.</p> : null}
      <HowCalculated>
        <p>Рентабельность (30): маржа до 30% и запас прочности до 40% — по 15 баллов.</p>
        <p>Динамика (30): выручка от −10% до +10% к прошлому периоду и прибыль от −20% до +20% — по 15 баллов.</p>
        <p>Риски (20): зарплаты до 25% выручки — 10 баллов; если точек несколько, крупнейшая меньше 35% выручки — ещё 10.</p>
        <p>Полнота данных (20): доля дней с отчётами по точкам. Итог — набранные баллы от возможных.</p>
      </HowCalculated>
    </Card>
  )
}

// ── Запас прочности ─────────────────────────────────────────────────────────

function SafetyCard({ data }: { data: CfoResponse }) {
  const cs = data.costStructure
  const rows: Array<[string, string, string?]> = [
    ['Постоянные расходы', money(cs.fixedExpenses), 'аренда, зарплаты, коммуналка — платятся при любой выручке'],
    ['Переменные расходы', money(cs.variableExpenses), 'себестоимость и комиссии — растут вместе с продажами'],
    ['Зарплаты', `${money(cs.payroll)} · ${data.fotShare.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% выручки`],
    ['Разовые и оборудование', money(cs.oneOffExpenses)],
    ['Выплаты партнёрам', money(cs.profitDistribution)],
  ]
  return (
    <Card className="gap-0 p-5">
      <SectionTitle icon={<ShieldAlert className="h-4 w-4 text-amber-500" />} title="Запас прочности" subtitle="Сколько нужно зарабатывать, чтобы не уйти в минус." />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Выручка безубыточности</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{cs.breakevenRevenue ? money(cs.breakevenRevenue) : '—'}</p>
          <p className="text-xs text-muted-foreground">за этот период</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Запас прочности</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${cs.safetyMarginPct < 15 ? 'text-rose-600 dark:text-rose-400' : cs.safetyMarginPct < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {cs.breakevenRevenue ? `${cs.safetyMarginPct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '—'}
          </p>
          <p className="text-xs text-muted-foreground">на столько может упасть выручка</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-border text-sm">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="flex items-start justify-between gap-3 py-2">
            <div>
              <p>{label}</p>
              {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
            </div>
            <p className="shrink-0 font-medium tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <HowCalculated>
        <p>С каждого тенге выручки после переменных расходов остаётся {cs.contributionRatePct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%. Безубыточность = постоянные расходы ÷ эту долю.</p>
        <p>Запас прочности — насколько выручка выше безубыточности. Разовые покупки, налог и выплаты партнёрам в расчёт не входят. Группы статей — из справочника расходов.</p>
      </HowCalculated>
    </Card>
  )
}

// ── Что если ────────────────────────────────────────────────────────────────

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className={`font-semibold tabular-nums ${value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
          {value > 0 ? '+' : ''}
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={-30}
        max={30}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-violet-600"
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function WhatIfCard({ data }: { data: CfoResponse }) {
  const [pricePct, setPricePct] = useState(0)
  const [volumePct, setVolumePct] = useState(0)
  const [fixedPct, setFixedPct] = useState(0)
  const cs = data.costStructure
  const base = { revenue: data.executive.revenue, variable: cs.variableExpenses, fixed: cs.fixedExpenses }
  const result = whatIf(base, { pricePct, volumePct, fixedPct })
  const touched = pricePct || volumePct || fixedPct
  return (
    <Card className="gap-0 p-5">
      <SectionTitle
        icon={<Calculator className="h-4 w-4 text-emerald-500" />}
        title="Что если"
        subtitle="Подвигайте и посмотрите, как изменится прибыль за такой же период."
        action={
          touched ? (
            <Button variant="ghost" size="xs" onClick={() => { setPricePct(0); setVolumePct(0); setFixedPct(0) }}>
              Сбросить
            </Button>
          ) : null
        }
      />
      <div className="space-y-4">
        <Slider label="Цены" value={pricePct} onChange={setPricePct} hint="подняли прайс — выручка растёт, себестоимость та же" />
        <Slider label="Гостей и продаж" value={volumePct} onChange={setVolumePct} hint="больше продаж — растут и выручка, и себестоимость" />
        <Slider label="Постоянные расходы" value={fixedPct} onChange={setFixedPct} hint="аренда, зарплаты, коммуналка" />
      </div>
      <div className="mt-5 rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">Операционная прибыль</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-2xl font-semibold tabular-nums">{money(result.operatingProfit)}</span>
          <span className={`text-sm font-semibold tabular-nums ${result.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {signed(result.delta)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          сейчас {money(cs.operatingProfit)} · выручка {money(result.revenue)}
        </p>
      </div>
      <HowCalculated>
        <p>Выручка × (1 + цены) × (1 + продажи) − переменные × (1 + продажи) − постоянные × (1 + изменение). Разовые покупки, налог и выплаты партнёрам не входят.</p>
        <p>Это арифметика, а не прогноз: если поднять цены, часть гостей может уйти — это можно учесть, уменьшив продажи.</p>
      </HowCalculated>
    </Card>
  )
}

// ── Прогноз из /analysis ────────────────────────────────────────────────────

function ForecastCard({ companyId, includeExtra }: { companyId: string; includeExtra: boolean }) {
  const [forecast, setForecast] = useState<MonthlyForecastResponse | null>(null)
  useEffect(() => {
    let active = true
    const p = new URLSearchParams()
    if (companyId) p.set('company_id', companyId)
    if (includeExtra && !companyId) p.set('include_extra', '1')
    fetch(`/api/admin/monthly-forecast?${p}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && setForecast(j?.next ? j : null))
      .catch(() => active && setForecast(null))
    return () => {
      active = false
    }
  }, [companyId, includeExtra])

  const outlook = forecast?.current.outlook
  const next = forecast?.next.scenarios
  if (!outlook && !next) return null
  const monthName = (ym?: string | null) => (ym ? MONTH_GEN[Number(ym.slice(5, 7)) - 1] : '')
  return (
    <Card className="gap-0 p-5">
      <SectionTitle
        icon={<TrendingUp className="h-4 w-4 text-violet-500" />}
        title="Прогноз прибыли"
        subtitle="Из раздела «Прогноз и точность» — модель сверяется с фактом каждый месяц."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/analysis">
              Подробнее <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {outlook ? (
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">К концу {monthName(outlook.month)}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(outlook.outlook.realistic.profit)}</p>
            <p className="text-xs text-muted-foreground">
              от {money(outlook.outlook.pessimistic.profit)} до {money(outlook.outlook.optimistic.profit)}
            </p>
          </div>
        ) : null}
        {next ? (
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Следующий месяц</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(next.realistic.profit)}</p>
            <p className="text-xs text-muted-foreground">
              от {money(next.pessimistic.profit)} до {money(next.optimistic.profit)}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

// ── Разбор ИИ ───────────────────────────────────────────────────────────────

function AiCard({ ai, loading, canGenerate, onAsk, disabled }: { ai: AiAnalysis | null; loading: boolean; canGenerate: boolean; onAsk: () => void; disabled: boolean }) {
  const s = ai?.summary
  const LEVEL: Record<string, { label: string; cls: string }> = {
    critical: { label: 'критический', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
    high: { label: 'высокий', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
    medium: { label: 'средний', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
    low: { label: 'низкий', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  }
  const hasContent = ai && !ai.error
  return (
    <Card className="gap-0 p-5">
      <SectionTitle
        icon={<Sparkles className="h-4 w-4 text-violet-500" />}
        title="Разбор финдиректора"
        subtitle="ИИ читает посчитанные цифры выше и объясняет: где теряем, что проверить, что сделать. Своих сумм без расчёта не называет."
        action={
          canGenerate ? (
            <Button size="sm" onClick={onAsk} disabled={loading || disabled}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {hasContent ? 'Разобрать заново' : 'Разобрать период'}
            </Button>
          ) : null
        }
      />
      {!canGenerate && !hasContent ? <p className="text-sm text-muted-foreground">Запуск разбора ИИ доступен сотрудникам с правом «Сгенерировать анализ».</p> : null}
      {loading && !hasContent ? <p className="text-sm text-muted-foreground">Разбираем период — обычно 15–40 секунд…</p> : null}
      {ai?.error ? <p className="text-sm text-amber-700 dark:text-amber-300">{ai.error}</p> : null}

      {hasContent ? (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          {ai.state ? <p className="text-sm leading-relaxed">{clean(ai.state)}</p> : null}

          {s ? (
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ['Где теряем', s.where_losing, 'text-rose-600 dark:text-rose-400'],
                ['Где заработать', s.where_earn, 'text-emerald-600 dark:text-emerald-400'],
                ['Главный риск', s.main_risk, 'text-amber-600 dark:text-amber-400'],
              ].map(([title, text, cls]) =>
                text ? (
                  <div key={title} className="rounded-xl border border-border p-3">
                    <p className={`text-sm font-semibold ${cls}`}>{title}</p>
                    <p className="mt-1 text-sm leading-relaxed">{clean(text)}</p>
                  </div>
                ) : null,
              )}
            </div>
          ) : null}

          {s?.three_actions?.length ? (
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Target className="h-4 w-4 text-violet-500" /> Что сделать в первую очередь
              </p>
              <ol className="space-y-2">
                {s.three_actions.map((a, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">{i + 1}</span>
                    <span className="leading-relaxed">{clean(a)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            {ai.rootCauses?.length ? (
              <TextList title="Причины" items={ai.rootCauses.map((c) => ({ text: c.text, status: c.status }))} />
            ) : null}
            {ai.changes?.length ? <TextList title="Что изменилось" items={ai.changes.map((c) => ({ text: c.text, status: c.status }))} /> : null}
            {ai.losses?.length ? (
              <TextList title="Где утекают деньги" items={ai.losses.map((l) => ({ text: l.amount ? `${clean(l.amount)} — ${clean(l.text)}` : l.text, status: l.status }))} />
            ) : null}
            {ai.opportunities?.length ? (
              <TextList
                title="Возможности"
                items={ai.opportunities.map((o) => ({ text: `${clean(o.title)}: ${clean(o.action)}${o.effect ? ` (${clean(o.effect)})` : ''}`, status: o.status }))}
              />
            ) : null}
          </div>

          {ai.risks?.length ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Риски</p>
              <div className="space-y-2">
                {ai.risks.map((r, i) => {
                  const lv = LEVEL[String(r.level || '').toLowerCase()] || LEVEL.medium
                  return (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                      <p className="text-sm leading-relaxed">{clean(r.risk)}</p>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${lv.cls}`}>{lv.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {ai.actionPlan && (ai.actionPlan.today?.length || ai.actionPlan.week?.length || ai.actionPlan.month?.length) ? (
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ['Сегодня', ai.actionPlan.today],
                  ['На этой неделе', ai.actionPlan.week],
                  ['В этом месяце', ai.actionPlan.month],
                ] as const
              ).map(([title, list]) => (
                <div key={title}>
                  <p className="mb-1.5 text-xs font-semibold text-violet-600 dark:text-violet-300">{title}</p>
                  <ul className="space-y-1.5">
                    {(list || []).map((x, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                        <span>{clean(x)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function TextList({ title, items }: { title: string; items: Array<{ text: string; status?: string }> }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>
              {clean(item.text)}
              <StatusTag status={item.status} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
