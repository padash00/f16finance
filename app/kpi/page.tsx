'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import { calculateForecast, CompanyCode } from '@/lib/kpiEngine' // <--- ИМПОРТ МОЗГА
import {
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Calculator,
  ArrowRight,
  Loader2,
} from 'lucide-react'

// ---------------- Utils ----------------

const money = (v: number) =>
  (Number(v || 0)).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const formatMonthLabel = (d: Date) =>
  d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })

const COMPANIES: CompanyCode[] = ['arena', 'ramen', 'extra']

// Типы для UI (структура ответа хука)
type CompanyStats = {
  prev2: number
  prev1: { rawTotal: number; estimatedTotal: number; isPartial: boolean }
  forecast: number
  trend: number
}

function monthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

// ---------------- Hook ----------------

function useKpiForecast(targetMonthStartISO: string) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Record<CompanyCode, CompanyStats> | null>(null)
  const [totals, setTotals] = useState({ prev2: 0, prev1: 0, forecast: 0 })
  const [isAnyPartial, setIsAnyPartial] = useState(false)

  useEffect(() => {
    async function fetchAndCalculate() {
      setLoading(true)

      const targetDate = new Date(targetMonthStartISO) // На какой месяц строим (Январь)
      const prev1Date = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1) // N-1 (Декабрь)
      const prev2Date = new Date(targetDate.getFullYear(), targetDate.getMonth() - 2, 1) // N-2 (Ноябрь)

      // Границы выборки: С 1-го числа N-2 по конец N-1
      const startISO = `${monthKey(prev2Date)}-01`
      const endISO = new Date(prev1Date.getFullYear(), prev1Date.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10)

      // 1. Загружаем данные
      const { data: rows, error } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, company_id, companies:company_id (code)')
        .gte('date', startISO)
        .lte('date', endISO)

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      // 2. Агрегируем суммы по месяцам и компаниям
      const k1 = monthKey(prev1Date)
      const k2 = monthKey(prev2Date)

      const sums: Record<string, Record<CompanyCode, number>> = {
        [k1]: { arena: 0, ramen: 0, extra: 0 },
        [k2]: { arena: 0, ramen: 0, extra: 0 },
      }

      for (const r of rows || []) {
        const d = new Date((r as any).date)
        const key = monthKey(d)
        // @ts-ignore
        const code = (r.companies?.code || '').toLowerCase() as CompanyCode

        if (!sums[key]) continue // Защита от дат вне диапазона (редко)
        if (!COMPANIES.includes(code)) continue

        const amount =
          Number((r as any).cash_amount || 0) +
          Number((r as any).kaspi_amount || 0) +
          Number((r as any).card_amount || 0)

        sums[key][code] += amount
      }

      // 3. Считаем прогноз через единый ENGINE
      const result: Record<CompanyCode, CompanyStats> = {
        arena: null as any, ramen: null as any, extra: null as any
      }

      let totalPrev2 = 0
      let totalPrev1 = 0
      let totalForecast = 0
      let anyPartial = false

      for (const code of COMPANIES) {
        const val2 = sums[k2][code]
        const val1Raw = sums[k1][code]

        // !!! MAGIC HAPPENS HERE !!!
        const calc = calculateForecast(targetDate, val1Raw, val2)

        result[code] = {
          prev2: val2,
          prev1: { 
            rawTotal: val1Raw, 
            estimatedTotal: calc.prev1Estimated, 
            isPartial: calc.isPartial 
          },
          forecast: calc.forecast,
          trend: calc.trend,
        }

        totalPrev2 += val2
        totalPrev1 += calc.prev1Estimated
        totalForecast += calc.forecast
        if (calc.isPartial) anyPartial = true
      }

      setData(result)
      setTotals({ prev2: totalPrev2, prev1: totalPrev1, forecast: totalForecast })
      setIsAnyPartial(anyPartial)
      setLoading(false)
    }

    fetchAndCalculate()
  }, [targetMonthStartISO])

  return { loading, data, totals, isAnyPartial }
}

// ---------------- Page Component ----------------

export default function KPIPage() {
  const defaultMonth = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7) // YYYY-MM
  }, [])

  const [targetMonth, setTargetMonth] = useState(defaultMonth)
  const { loading, data, totals, isAnyPartial } = useKpiForecast(`${targetMonth}-01`)

  const monthLabel = (offset: number) => {
    const d = new Date(`${targetMonth}-01`)
    d.setMonth(d.getMonth() + offset)
    return formatMonthLabel(d)
  }

  const targetLabel = formatMonthLabel(new Date(`${targetMonth}-01`))
  
  // Тренд общего итога
  const trendTotal = totals.prev1 > 0 
    ? ((totals.forecast - totals.prev1) / totals.prev1) * 100 
    : 0

  // Вспомогательные расчеты
  const weeks = 4.345
  const perCompanyPerWeek = totals.forecast / COMPANIES.length / weeks
  
  const targetDateObj = new Date(`${targetMonth}-01`)
  const shiftsInMonth = daysInMonth(targetDateObj) * 2 // Грубо: дней * 2 смены
  const perCompanyPerShift = totals.forecast / COMPANIES.length / shiftsInMonth

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Calculator className="w-8 h-8 text-indigo-500" />
                Прогноз выручки
              </h1>
              <p className="text-zinc-400 mt-1">
                Использует <b>kpiEngine</b> (Holt&apos;s Linear). Источник данных: <code>incomes</code>.
              </p>
            </div>

            <div className="flex items-center gap-3 bg-zinc-900 p-2 rounded-lg border border-white/10">
              <span className="text-sm text-zinc-500 font-medium pl-2">План на:</span>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="bg-zinc-800 border-none rounded text-sm px-3 py-1.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-zinc-500 animate-pulse">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Анализируем данные...
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Card N-2 */}
                <Card className="p-5 bg-zinc-900/50 border-zinc-800 flex flex-col justify-between">
                  <span className="text-xs font-medium uppercase text-zinc-500">
                    База ({monthLabel(-2)})
                  </span>
                  <div className="text-2xl font-bold text-zinc-300 mt-2">{money(totals.prev2)}</div>
                </Card>

                {/* Card N-1 */}
                <Card className="p-5 bg-zinc-900/50 border-zinc-800 flex flex-col justify-between relative overflow-hidden">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-medium uppercase text-zinc-500">
                      База ({monthLabel(-1)})
                    </span>
                    {isAnyPartial && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
                        Прогноз закрытия
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-zinc-300 mt-2">{money(totals.prev1)}</div>
                  {isAnyPartial && (
                    <p className="text-[10px] text-zinc-500 mt-1">
                      (Факт на сегодня меньше, экстраполяция до конца месяца)
                    </p>
                  )}
                </Card>

                {/* Card Forecast */}
                <Card className="p-5 bg-gradient-to-br from-indigo-950/40 to-zinc-900 border-indigo-500/30 flex flex-col justify-between shadow-lg shadow-indigo-900/10">
                  <span className="text-xs font-medium uppercase text-indigo-300">Цель: {targetLabel}</span>
                  <div className="text-3xl font-bold text-white mt-2 tracking-tight">{money(totals.forecast)}</div>
                  <div className="flex items-center gap-2 mt-2">
                    {totals.forecast >= totals.prev1 ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-rose-400" />
                    )}
                    <span className={`text-xs font-medium ${totals.forecast >= totals.prev1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {trendTotal >= 0 ? '+' : ''}
                      {trendTotal.toFixed(1)}% к прошлому мес.
                    </span>
                  </div>
                </Card>
              </div>

              {/* Detailed Table */}
              <Card className="overflow-hidden border-zinc-800 bg-zinc-900/30">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50 border-b border-zinc-800">
                      <tr>
                        <th className="px-6 py-4 font-medium">Точка</th>
                        <th className="px-6 py-4 font-medium text-right">{monthLabel(-2)}</th>
                        <th className="px-6 py-4 font-medium text-right">
                          {monthLabel(-1)} <span className="normal-case opacity-50">(оценка)</span>
                        </th>
                        <th className="px-6 py-4 font-medium text-right w-12"></th>
                        <th className="px-6 py-4 font-medium text-right text-white bg-indigo-500/5 border-l border-zinc-800">
                          План {targetLabel}
                        </th>
                        <th className="px-6 py-4 font-medium text-right">Тренд</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {COMPANIES.map((code) => {
                        const row = data![code]
                        const isUp = row.forecast >= row.prev1.estimatedTotal
                        return (
                          <tr key={code} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-6 py-4 font-medium text-zinc-200 capitalize">F16 {code}</td>

                            <td className="px-6 py-4 text-right text-zinc-400">{money(row.prev2)}</td>

                            <td className="px-6 py-4 text-right text-zinc-400">
                              <div className="flex flex-col items-end">
                                <span>{money(row.prev1.estimatedTotal)}</span>
                                {row.prev1.isPartial && (
                                  <span className="text-[10px] text-zinc-600">
                                    Факт: {money(row.prev1.rawTotal)}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-6 py-4 text-center">
                              <ArrowRight className="w-4 h-4 text-zinc-700 mx-auto" />
                            </td>

                            <td className="px-6 py-4 text-right font-bold text-white bg-indigo-500/5 border-l border-zinc-800">
                              {money(row.forecast)}
                            </td>

                            <td className="px-6 py-4 text-right">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                  isUp ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                                }`}
                              >
                                {isUp ? '+' : ''}
                                {row.trend.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Info Block */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-500">
                <div className="p-4 rounded border border-zinc-800 bg-zinc-900/30">
                  <h3 className="text-zinc-300 font-semibold mb-2 flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Разбивка (среднее)
                  </h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>На точку в неделю:</span>
                      <span className="text-zinc-300 font-mono">{money(perCompanyPerWeek)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>На смену (на точку):</span>
                      <span className="text-zinc-300 font-mono">{money(perCompanyPerShift)}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded border border-zinc-800 bg-zinc-900/30">
                  <h3 className="text-zinc-300 font-semibold mb-2">Как работает Engine?</h3>
                  <p className="leading-relaxed">
                    Этот экран использует общую библиотеку <code>lib/kpiEngine.ts</code>. 
                    Если N-1 (прошлый месяц) еще не закрыт, мы экстраполируем его текущие показатели 
                    до полного месяца, чтобы алгоритм Хольта не получал заниженные данные. 
                    Те же алгоритмы используются при генерации детального плана.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
