'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { calculateForecast, CompanyCode } from '@/lib/kpiEngine'
import { monthKeyFromDateStr } from '@/lib/kpiTeams'
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCcw,
  AlertTriangle,
  Info,
} from 'lucide-react'

const COMPANIES: CompanyCode[] = ['arena', 'ramen', 'extra']

const money = (v: number) =>
  (Number(v || 0)).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const formatMonthLabel = (d: Date) =>
  d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })

function monthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

type CompanyStats = {
  prev2: number
  prev1: { rawTotal: number; estimatedTotal: number; isPartial: boolean }
  forecast: number
  trend: number
}

function useKpiForecast(targetMonthStartISO: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Record<CompanyCode, CompanyStats> | null>(null)
  const [totals, setTotals] = useState({ prev2: 0, prev1: 0, forecast: 0 })
  const [isAnyPartial, setIsAnyPartial] = useState(false)

  const reload = useMemo(() => targetMonthStartISO, [targetMonthStartISO])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)

      try {
        const targetDate = new Date(targetMonthStartISO)
        const prev1Date = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1) // N-1
        const prev2Date = new Date(targetDate.getFullYear(), targetDate.getMonth() - 2, 1) // N-2

        const startISO = `${monthKey(prev2Date)}-01`
        const endISO = new Date(prev1Date.getFullYear(), prev1Date.getMonth() + 1, 0).toISOString().slice(0, 10)

        const { data: rows, error: e } = await supabase
          .from('incomes')
          .select('date, cash_amount, kaspi_amount, card_amount, companies:company_id (code)')
          .gte('date', startISO)
          .lte('date', endISO)

        if (e) throw e

        const k1 = monthKey(prev1Date)
        const k2 = monthKey(prev2Date)

        const sums: Record<string, Record<CompanyCode, number>> = {
          [k1]: { arena: 0, ramen: 0, extra: 0 },
          [k2]: { arena: 0, ramen: 0, extra: 0 },
        }

        for (const r of rows || []) {
          const key = monthKeyFromDateStr((r as any).date)
          const code = String((r as any).companies?.code || '').toLowerCase() as CompanyCode
          if (!sums[key]) continue
          if (!COMPANIES.includes(code)) continue

          const amount =
            Number((r as any).cash_amount || 0) +
            Number((r as any).kaspi_amount || 0) +
            Number((r as any).card_amount || 0)

          sums[key][code] += amount
        }

        const result: Record<CompanyCode, CompanyStats> = {
          arena: null as any,
          ramen: null as any,
          extra: null as any,
        }

        let totalPrev2 = 0
        let totalPrev1 = 0
        let totalForecast = 0
        let anyPartial = false

        for (const code of COMPANIES) {
          const val2 = sums[k2][code]
          const val1Raw = sums[k1][code]

          const calc = calculateForecast(targetDate, val1Raw, val2)

          result[code] = {
            prev2: val2,
            prev1: {
              rawTotal: val1Raw,
              estimatedTotal: calc.prev1Estimated,
              isPartial: calc.isPartial,
            },
            forecast: calc.forecast,
            trend: calc.trend,
          }

          totalPrev2 += val2
          totalPrev1 += calc.prev1Estimated
          totalForecast += calc.forecast
          if (calc.isPartial) anyPartial = true
        }

        if (cancelled) return
        setData(result)
        setTotals({ prev2: totalPrev2, prev1: totalPrev1, forecast: totalForecast })
        setIsAnyPartial(anyPartial)
      } catch (err: any) {
        console.error(err)
        if (!cancelled) setError(err?.message || 'Ошибка расчёта')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [reload, targetMonthStartISO])

  return { loading, error, data, totals, isAnyPartial }
}

function TrendBadge({ value }: { value: number }) {
  const up = value >= 0
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
        up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
      }`}
    >
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  )
}

function CompanyTitle(code: CompanyCode) {
  if (code === 'arena') return 'F16 Arena'
  if (code === 'ramen') return 'F16 Ramen'
  return 'F16 Extra'
}

export default function KPIPage() {
  const defaultMonth = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7) // YYYY-MM
  }, [])

  const [targetMonth, setTargetMonth] = useState(defaultMonth)
  const { loading, error, data, totals, isAnyPartial } = useKpiForecast(`${targetMonth}-01`)

  const monthLabel = (offset: number) => {
    const d = new Date(`${targetMonth}-01`)
    d.setMonth(d.getMonth() + offset)
    return formatMonthLabel(d)
  }

  const targetLabel = formatMonthLabel(new Date(`${targetMonth}-01`))
  const trendTotal = totals.prev1 > 0 ? ((totals.forecast - totals.prev1) / totals.prev1) * 100 : 0

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 md:p-10">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-6 border-b border-white/5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Calculator className="w-7 h-7 text-indigo-400" />
                Прогноз выручки
              </h1>
              <div className="text-sm text-muted-foreground mt-2 flex flex-wrap items-center gap-2">
                Источник: <Badge variant="secondary" className="font-mono">incomes</Badge>
                Движок: <Badge variant="secondary" className="font-mono">kpiEngine</Badge>
                {isAnyPartial && (
                  <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    N-1 не закрыт → оценка
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 bg-zinc-900/50 p-1.5 rounded-xl border border-white/5">
              <span className="text-xs text-muted-foreground pl-3">План на:</span>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="bg-transparent border-none text-sm px-3 outline-none text-white"
              />
              <div className="w-px h-6 bg-white/10" />
              <Button variant="ghost" size="sm" onClick={() => setTargetMonth((v) => v)} disabled={loading}>
                <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* States */}
          {loading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Считаем…
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-5 bg-[#0A0A0A] border-white/5">
                  <div className="text-xs text-muted-foreground uppercase">База (N-2)</div>
                  <div className="text-2xl font-bold mt-2">{money(totals.prev2)}</div>
                  <div className="text-xs text-muted-foreground mt-2">{monthLabel(-2)}</div>
                </Card>

                <Card className="p-5 bg-[#0A0A0A] border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground uppercase">База (N-1)</div>
                    {isAnyPartial && (
                      <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20">оценка</Badge>
                    )}
                  </div>
                  <div className="text-2xl font-bold mt-2">{money(totals.prev1)}</div>
                  <div className="text-xs text-muted-foreground mt-2">{monthLabel(-1)}</div>
                </Card>

                <Card className="p-5 bg-gradient-to-br from-indigo-950/40 to-[#0A0A0A] border-indigo-500/20 shadow-lg shadow-indigo-900/10">
                  <div className="text-xs text-indigo-200 uppercase">План</div>
                  <div className="text-3xl font-bold mt-2">{money(totals.forecast)}</div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">{targetLabel}</div>
                    <TrendBadge value={trendTotal} />
                  </div>
                </Card>
              </div>

              {/* Per company */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {COMPANIES.map((code) => {
                  const row = data![code]
                  const base = row.prev1.estimatedTotal
                  const trend = base > 0 ? ((row.forecast - base) / base) * 100 : 0
                  return (
                    <Card key={code} className="p-5 bg-[#0A0A0A] border-white/5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-200">{CompanyTitle(code)}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {monthLabel(-1)} → {targetLabel}
                          </div>
                        </div>
                        <TrendBadge value={trend} />
                      </div>

                      <div className="mt-4 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">N-2:</span>
                          <span className="font-mono text-zinc-200">{money(row.prev2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">N-1 (оценка):</span>
                          <span className="font-mono text-zinc-200">{money(row.prev1.estimatedTotal)}</span>
                        </div>
                        {row.prev1.isPartial && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">N-1 факт сейчас:</span>
                            <span className="font-mono text-zinc-400">{money(row.prev1.rawTotal)}</span>
                          </div>
                        )}
                        <div className="pt-3 mt-3 border-t border-white/5 flex justify-between">
                          <span className="text-indigo-200">План:</span>
                          <span className="font-mono text-white">{money(row.forecast)}</span>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>

              {/* Clear explanation */}
              <Card className="p-5 bg-[#0A0A0A] border-white/5">
                <div className="flex items-center gap-2 text-zinc-200 font-semibold">
                  <Info className="w-4 h-4 text-indigo-400" />
                  Как это понимать?
                </div>
                <div className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Это просто прогноз по точкам. А “команды Пн–Чт / Пт–Вс” и планы по операторам делаются на странице{' '}
                  <b>Планирование KPI</b>.
                </div>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
