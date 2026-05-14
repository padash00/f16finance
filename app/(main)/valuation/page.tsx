'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Building2,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

type Factor = {
  key: string
  label: string
  status: 'good' | 'neutral' | 'bad'
  effect: number
  note: string
}

type MonthRow = {
  month: string
  revenue: number
  ebitda: number
  net_profit: number
  ebitda_margin: number
}

type ValuationData = {
  period: { start: string; end: string }
  revenue_12mo: number
  ebitda_12mo: number
  ebitda_prev_12mo: number
  net_profit_12mo: number
  ebitda_margin: number
  trend_pct: number | null
  margin_cv: number | null
  companies_count: number
  profitable: boolean
  multiple: { base: number; low: number; mid: number; high: number }
  valuation: { low: number; mid: number; high: number }
  factors: Factor[]
  monthly: MonthRow[]
}

const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function fmtMonth(key: string) {
  const [y, m] = key.split('-')
  return `${MONTHS_SHORT[Number(m) - 1] || m} ${String(y).slice(2)}`
}
function fmtMln(v: number) {
  return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₸`
}

export default function ValuationPage() {
  const [data, setData] = useState<ValuationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/valuation', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить оценку')
      setData(json.data || null)
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) {
    return (
      <div className="app-page-wide flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="app-page-wide space-y-4">
        <Card className="border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
          {error || 'Недостаточно данных для оценки бизнеса. Нужна история доходов и расходов хотя бы за несколько месяцев.'}
        </Card>
      </div>
    )
  }

  const trendUp = (data.trend_pct ?? 0) > 0
  const chartData = data.monthly.slice(12).map((m) => ({
    month: fmtMonth(m.month),
    EBITDA: m.ebitda,
  }))

  return (
    <div className="app-page-wide relative space-y-6">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/30">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">Оценка бизнеса</h1>
          <p className="truncate text-xs text-muted-foreground">
            EBITDA × мультипликатор · период {data.period.start} — {data.period.end}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="ml-auto grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
          title="Обновить"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Hero — диапазон оценки */}
      <Card className="relative overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.03] p-6">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
        <p className="text-[11px] uppercase tracking-widest text-amber-300/80">Ориентировочная стоимость бизнеса</p>
        {data.profitable ? (
          <>
            <p className="mt-2 text-4xl font-bold tabular-nums text-amber-200">
              {fmtMln(data.valuation.low)} — {fmtMln(data.valuation.high)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Средняя оценка: <span className="font-semibold text-foreground">{formatMoney(data.valuation.mid)} ₸</span>
              {' '}· мультипликатор <span className="font-semibold text-amber-200">{data.multiple.mid}×</span> к годовой EBITDA
            </p>
          </>
        ) : (
          <p className="mt-2 text-lg font-semibold text-rose-200">
            Бизнес убыточен на уровне EBITDA — оценка по мультипликатору неприменима. Сначала нужно выйти в плюс.
          </p>
        )}
      </Card>

      {/* KPI ряд */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">EBITDA за 12 мес</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{formatMoney(data.ebitda_12mo)} ₸</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Выручка {formatMoney(data.revenue_12mo)} ₸ · чистая прибыль {formatMoney(data.net_profit_12mo)} ₸
          </p>
        </Card>
        <Card className="border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">EBITDA-маржа</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-violet-300">{data.ebitda_margin}%</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.margin_cv != null
              ? `Стабильность: ${data.margin_cv < 0.2 ? 'высокая' : data.margin_cv > 0.5 ? 'низкая' : 'средняя'}`
              : 'Стабильность: мало данных'}
          </p>
        </Card>
        <Card className="border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Тренд год к году</p>
          {data.trend_pct == null ? (
            <p className="mt-1 flex items-center gap-1.5 text-2xl font-bold text-muted-foreground">
              <Minus className="h-5 w-5" /> нет данных
            </p>
          ) : (
            <p className={`mt-1 flex items-center gap-1.5 text-2xl font-bold tabular-nums ${trendUp ? 'text-emerald-300' : 'text-rose-300'}`}>
              {trendUp ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {trendUp ? '+' : ''}{data.trend_pct}%
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            EBITDA: было {formatMoney(data.ebitda_prev_12mo)} → стало {formatMoney(data.ebitda_12mo)}
          </p>
        </Card>
      </div>

      {/* Как сложился мультипликатор */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold">Как сложился мультипликатор</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Базовый мультипликатор {data.multiple.base}× корректируется по факторам ниже → итог {data.multiple.mid}×
        </p>
        <div className="mt-4 space-y-2">
          {data.factors.map((f) => {
            const dot =
              f.status === 'good' ? 'bg-emerald-400' : f.status === 'bad' ? 'bg-rose-400' : 'bg-white/30'
            const effectText =
              f.effect === 0 ? '—' : `${f.effect > 0 ? '+' : ''}${f.effect}×`
            const effectColor =
              f.effect > 0 ? 'text-emerald-300' : f.effect < 0 ? 'text-rose-300' : 'text-muted-foreground'
            return (
              <div key={f.key} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{f.label}</p>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${effectColor}`}>{effectText}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{f.note}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
          <span className="text-sm font-semibold text-amber-200">Итоговый мультипликатор</span>
          <span className="text-lg font-bold tabular-nums text-amber-200">{data.multiple.mid}×</span>
        </div>
      </Card>

      {/* График EBITDA по месяцам */}
      <Card className="border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold">EBITDA по месяцам (12 мес)</h2>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.45)" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="rgba(255,255,255,0.45)" fontSize={10} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip
                formatter={(v: any) => `${formatMoney(Number(v))} ₸`}
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="EBITDA" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.EBITDA >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Дисклеймер */}
      <Card className="border-white/10 bg-white/[0.02] p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/80">Как читать эту оценку</p>
        <p className="mt-1">
          Это ориентир, а не официальная оценка. Реальная цена всегда обсуждается с покупателем и зависит от вещей,
          которые система не видит: договор аренды и его срок, состояние оборудования, бренд и лояльность клиентов,
          прозрачность учёта (недокументированный нал в оценку не идёт), зависимость бизнеса от вас лично.
        </p>
        <p className="mt-1.5">
          EBITDA = выручка − себестоимость − операционные расходы − ФОТ и налоги на зарплату − комиссии POS.
          Не вычитаются: амортизация, проценты по кредитам, налог на прибыль.
        </p>
      </Card>
    </div>
  )
}
