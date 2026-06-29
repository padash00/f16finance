'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
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
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { isAbortError } from '@/lib/is-abort-error'

const MONTH_LABELS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTH_SHORT_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

type Company = { id: string; name: string; code?: string | null }

type MonthlyAggregate = {
  month: string
  cash: number
  kaspi: number
  card: number
  online: number
  revenue: number
  expenses: number
  profit: number
  margin_pct: number
  checks_count: number
  avg_check: number
  by_company: Record<string, {
    cash: number
    kaspi: number
    card: number
    online: number
    revenue: number
    checks_count: number
  }>
}

type ApiResponse = {
  ok: boolean
  data?: {
    year: number
    companies: Company[]
    months: MonthlyAggregate[]
    previousYear: Array<{ month: string; revenue: number }>
  }
  error?: string
}

const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU')

function monthShort(monthKey: string) {
  const idx = parseInt(monthKey.slice(5, 7), 10) - 1
  return MONTH_SHORT_RU[idx] || monthKey
}

function monthFull(monthKey: string) {
  const idx = parseInt(monthKey.slice(5, 7), 10) - 1
  return MONTH_LABELS_RU[idx] || monthKey
}

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/analytics/monthly?year=${year}`, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as ApiResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить аналитику')
      setData(json.data)
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      if (!soft) setData(null)
      setError(err?.message || 'Не удалось загрузить аналитику')
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

  const months = data?.months || []
  const previousYear = data?.previousYear || []
  const companies = data?.companies || []

  const totals = useMemo(() => {
    const revenue = months.reduce((s, m) => s + m.revenue, 0)
    const expenses = months.reduce((s, m) => s + m.expenses, 0)
    const profit = revenue - expenses
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0
    const checks = months.reduce((s, m) => s + m.checks_count, 0)
    const avgCheck = checks > 0 ? revenue / checks : 0
    const cash = months.reduce((s, m) => s + m.cash, 0)
    const kaspi = months.reduce((s, m) => s + m.kaspi, 0)
    const card = months.reduce((s, m) => s + m.card, 0)
    const prevTotal = previousYear.reduce((s, m) => s + m.revenue, 0)
    const yoyPct = prevTotal > 0 ? ((revenue - prevTotal) / prevTotal) * 100 : 0
    const best = months.reduce<{ month: string | null; revenue: number }>(
      (best, m) => (m.revenue > best.revenue ? { month: m.month, revenue: m.revenue } : best),
      { month: null, revenue: 0 },
    )
    const worst = months
      .filter((m) => m.revenue > 0)
      .reduce<{ month: string | null; revenue: number }>(
        (worst, m) => (worst.month === null || m.revenue < worst.revenue ? { month: m.month, revenue: m.revenue } : worst),
        { month: null, revenue: 0 },
      )
    return { revenue, expenses, profit, margin, checks, avgCheck, cash, kaspi, card, prevTotal, yoyPct, best, worst }
  }, [months, previousYear])

  // Данные для графика выручки (line) + предыдущий год
  const revenueChartData = useMemo(() => {
    return months.map((m, idx) => ({
      month: monthShort(m.month),
      'Текущий': Math.round(m.revenue),
      'Прошлый': Math.round(previousYear[idx]?.revenue || 0),
    }))
  }, [months, previousYear])

  // Bar по способам оплаты
  const paymentChartData = useMemo(() => {
    return months.map((m) => ({
      month: monthShort(m.month),
      Наличные: Math.round(m.cash),
      Безналичные: Math.round(m.kaspi + m.card + m.online),
    }))
  }, [months])

  // Bar для прибыли + расходов
  const profitChartData = useMemo(() => {
    return months.map((m) => ({
      month: monthShort(m.month),
      Расходы: Math.round(m.expenses),
      Прибыль: Math.round(m.profit),
    }))
  }, [months])

  return (
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Аналитика доходов"
        description="Сводка по месяцам · 12 мес. года"
        icon={<BarChart3 className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white dark:bg-white/[0.03] p-0.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setYear((y) => y - 1)}
                className="h-8 w-8 p-0"
                disabled={loading}
              >
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(undefined, { soft: true })}
              disabled={loading || refreshing}
              className="h-9 gap-1.5"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div>
      ) : null}

      {loading && !data ? (
        <Card className="border-border bg-card/70 p-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Грузим данные за {year}…
          </div>
        </Card>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Card className="border-border bg-white dark:bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Выручка</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-200">{fmt(totals.revenue)} ₸</p>
              {totals.prevTotal > 0 ? (
                <p className={`mt-1 text-xs ${totals.yoyPct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                  {totals.yoyPct >= 0 ? '↑' : '↓'} {Math.abs(totals.yoyPct).toFixed(1)}% YoY
                </p>
              ) : null}
            </Card>
            <Card className="border-border bg-white dark:bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Расходы</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-rose-700 dark:text-rose-200">{fmt(totals.expenses)} ₸</p>
            </Card>
            <Card className="border-border bg-white dark:bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Прибыль</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${totals.profit >= 0 ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'}`}>
                {fmt(totals.profit)} ₸
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Маржа {totals.margin.toFixed(1)}%</p>
            </Card>
            <Card className="border-border bg-white dark:bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Чеков</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totals.checks)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Средний {fmt(totals.avgCheck)} ₸</p>
            </Card>
            <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-300/70">Лучший месяц</p>
              <p className="mt-1 text-base font-semibold">{totals.best.month ? monthFull(totals.best.month) : '—'}</p>
              <p className="mt-1 text-xs tabular-nums text-emerald-700 dark:text-emerald-200">{fmt(totals.best.revenue)} ₸</p>
            </Card>
            <Card className="border-rose-500/20 bg-rose-500/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-widest text-rose-700 dark:text-rose-300/70">Худший месяц</p>
              <p className="mt-1 text-base font-semibold">{totals.worst.month ? monthFull(totals.worst.month) : '—'}</p>
              <p className="mt-1 text-xs tabular-nums text-rose-700 dark:text-rose-200">{fmt(totals.worst.revenue)} ₸</p>
            </Card>
          </div>

          {/* Чарт: выручка по месяцам + прошлый год */}
          <Card className="border-border bg-card/70 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Выручка по месяцам</h2>
              <span className="text-xs text-muted-foreground">Сравнение с {year - 1}</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
                  <XAxis dataKey="month" stroke="rgba(255,255,255,0.45)" fontSize={11} />
                  <YAxis stroke="rgba(255,255,255,0.45)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: any) => `${fmt(Number(v))} ₸`}
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Текущий" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Прошлый" stroke="#64748b" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Чарт: способы оплаты + прибыль */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border bg-card/70 p-5">
              <h2 className="mb-3 text-sm font-semibold">Способы оплаты по месяцам</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={paymentChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
                    <XAxis dataKey="month" stroke="rgba(255,255,255,0.45)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.45)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v: any) => `${fmt(Number(v))} ₸`}
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Наличные" stackId="a" fill="#10b981" />
                    <Bar dataKey="Безналичные" stackId="a" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="border-border bg-card/70 p-5">
              <h2 className="mb-3 text-sm font-semibold">Прибыль и расходы</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
                    <XAxis dataKey="month" stroke="rgba(255,255,255,0.45)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.45)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v: any) => `${fmt(Number(v))} ₸`}
                      contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Расходы" fill="#f43f5e" />
                    <Bar dataKey="Прибыль" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Таблица месяц × точка */}
          <Card className="border-border bg-card/70 overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">Выручка по точкам · {year}</h2>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur">
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-32 py-2.5 px-4 font-normal">Месяц</th>
                    {companies.map((c) => (
                      <th key={c.id} className="py-2.5 px-3 text-right font-normal">
                        {c.name}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right font-medium text-foreground">Итого</th>
                    <th className="w-20 py-2.5 px-3 text-right font-normal">Чеков</th>
                    <th className="w-24 py-2.5 px-3 text-right font-normal">Ср. чек</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {months.map((m) => (
                    <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="py-2 px-4 align-middle">{monthFull(m.month)}</td>
                      {companies.map((c) => {
                        const v = m.by_company[c.id]?.revenue || 0
                        return (
                          <td key={c.id} className="py-2 px-3 text-right tabular-nums">
                            <span className={v > 0 ? '' : 'text-muted-foreground'}>{v > 0 ? fmt(v) : '—'}</span>
                          </td>
                        )
                      })}
                      <td className="py-2 px-3 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-200">
                        {m.revenue > 0 ? fmt(m.revenue) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{m.checks_count > 0 ? fmt(m.checks_count) : '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                        {m.avg_check > 0 ? fmt(m.avg_check) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-white/[0.02] border-t border-slate-200 dark:border-white/[0.06]">
                  <tr>
                    <td className="py-3 px-4 font-semibold">Итого</td>
                    {companies.map((c) => {
                      const v = months.reduce((s, m) => s + (m.by_company[c.id]?.revenue || 0), 0)
                      return (
                        <td key={c.id} className="py-3 px-3 text-right font-semibold tabular-nums">
                          {fmt(v)}
                        </td>
                      )
                    })}
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{fmt(totals.revenue)}</td>
                    <td className="py-3 px-3 text-right font-semibold tabular-nums">{fmt(totals.checks)}</td>
                    <td className="py-3 px-3 text-right font-semibold tabular-nums text-muted-foreground">
                      {fmt(totals.avgCheck)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Маржа по месяцам */}
          <Card className="border-border bg-card/70 p-5">
            <h2 className="mb-3 text-sm font-semibold">Маржа по месяцам</h2>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {months.map((m) => {
                const pct = m.margin_pct
                const positive = pct >= 0
                return (
                  <div
                    key={m.month}
                    className={`rounded-xl border px-3 py-2 ${positive ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-rose-500/20 bg-rose-500/[0.04]'}`}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{monthShort(m.month)}</p>
                    <p className={`text-base font-semibold tabular-nums ${positive ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                      {pct.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {positive ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                      {' '}
                      {fmt(m.profit)} ₸
                    </p>
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
