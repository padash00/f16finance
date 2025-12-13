'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import {
  CalendarDays,
  ArrowLeft,
  TrendingUp,
  Calculator,
  BarChart3,
  RefreshCcw,
  CalendarRange,
  Info
} from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

// --- Типы ---
type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

type CompanyCode = 'all' | 'arena' | 'ramen' | 'extra'

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
  return (day === 0 || day === 5 || day === 6) ? 'weekend' : 'weekday'
}

// --- “Умная” статистика без массива values[] ---
// Welford online variance
type StatBucket = {
  sum: number
  count: number
  mean: number
  m2: number
}

const newBucket = (): StatBucket => ({ sum: 0, count: 0, mean: 0, m2: 0 })

const pushValue = (b: StatBucket, x: number) => {
  b.sum += x
  b.count += 1

  // Welford
  const delta = x - b.mean
  b.mean += delta / b.count
  const delta2 = x - b.mean
  b.m2 += delta * delta2
}

const finalize = (b: StatBucket) => {
  const avg = b.count > 0 ? b.mean : 0

  // population variance (как у тебя было: / n)
  const variance = b.count > 1 ? (b.m2 / b.count) : 0
  // если захочешь sample variance:
  // const variance = b.count > 1 ? (b.m2 / (b.count - 1)) : 0

  const stdDev = Math.sqrt(variance)

  // Индекс стабильности (0-100%)
  const stability = avg === 0 ? 0 : Math.max(0, 1 - (stdDev / avg)) * 100

  return {
    avg,
    stdDev,
    stability,
    sum: b.sum,
    count: b.count
  }
}

export default function AnalyticsPage() {
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)

  // По умолчанию текущий год
  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const [dateFrom, setDateFrom] = useState(toISODateLocal(startOfYear))
  const [dateTo, setDateTo] = useState(toISODateLocal(new Date()))
  const [company, setCompany] = useState<CompanyCode>('all')

  const lastReqId = useRef(0)

  // Авто-валидация диапазона: если from > to — аккуратно меняем местами
  useEffect(() => {
    if (!dateFrom || !dateTo) return
    if (dateFrom > dateTo) {
      setDateFrom(dateTo)
      setDateTo(dateFrom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  const loadData = useCallback(async () => {
    const reqId = ++lastReqId.current
    setLoading(true)
    setErrorText(null)

    let query = supabase
      .from('incomes')
      .select('id, date, company_id, cash_amount, kaspi_amount, card_amount')
      .order('date', { ascending: false })

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo) query = query.lte('date', dateTo)
    if (company !== 'all') query = query.eq('company_id', company)

    query = query.limit(5000)

    const { data, error } = await query

    // защита от гонок: если пришёл старый ответ — игнорируем
    if (reqId !== lastReqId.current) return

    if (error) {
      setRows([])
      setErrorText(error.message ?? 'Ошибка загрузки данных')
      setLoading(false)
      return
    }

    setRows((data ?? []) as IncomeRow[])
    setLoading(false)
  }, [dateFrom, dateTo, company])

  useEffect(() => {
    loadData()
  }, [loadData])

  const stats = useMemo(() => {
    const monthsMap = new Map<string, {
      monthKey: string
      monthName: string
      weekday: StatBucket
      weekend: StatBucket
    }>()

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
          weekend: newBucket()
        })
      }

      const m = monthsMap.get(monthKey)!

      // месяц
      pushValue(m[type], total)

      // глобал
      if (type === 'weekday') pushValue(globalWd, total)
      else pushValue(globalWe, total)
    }

    const finalGlobalWd = finalize(globalWd)
    const finalGlobalWe = finalize(globalWe)

    const multiplier =
      finalGlobalWd.avg > 0 ? (finalGlobalWe.avg / finalGlobalWd.avg).toFixed(2) : '—'

    const sortedMonths = Array.from(monthsMap.values())
      .map(m => ({
        ...m,
        wdStats: finalize(m.weekday),
        weStats: finalize(m.weekend)
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))

    return {
      global: {
        weekday: finalGlobalWd,
        weekend: finalGlobalWe,
        multiplier
      },
      months: sortedMonths
    }
  }, [rows])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-8">

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
                Глубокий анализ: Будни (Пн-Чт) vs Выходные (Пт-Вс)
              </p>
              {errorText && (
                <p className="text-sm text-red-400 ml-7 mt-2">
                  {errorText}
                </p>
              )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              {/* Company filter */}
              <div className="flex items-center bg-card border border-border rounded-lg px-3 py-2 gap-2">
                <span className="text-xs text-muted-foreground">Компания:</span>
                <select
                  value={company}
                  onChange={(e) => setCompany(e.target.value as CompanyCode)}
                  className="bg-transparent text-sm outline-none"
                >
                  <option value="all">Все</option>
                  <option value="arena">Arena</option>
                  <option value="ramen">Ramen</option>
                  <option value="extra">Extra</option>
                </select>
              </div>

              {/* Date filters */}
              <div className="flex items-center bg-card border border-border rounded-lg p-1">
                <div className="flex items-center px-3 py-2 gap-2 border-r border-border/50">
                  <CalendarRange className="w-4 h-4 text-muted-foreground" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="bg-transparent text-sm outline-none w-[110px]"
                  />
                  <span className="text-muted-foreground">-</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="bg-transparent text-sm outline-none w-[110px]"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={loadData}
                  className="h-9 w-9 text-muted-foreground hover:text-accent"
                  title="Обновить"
                >
                  <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </div>

          {/* --- KPI BLOCK --- */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* 1. Будние дни */}
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
                <span
                  className="flex items-center gap-1"
                  title={`σ=${formatMoney(stats.global.weekday.stdDev)} ₸`}
                >
                  Стабильность:{' '}
                  <b className={stats.global.weekday.stability > 70 ? 'text-green-500' : 'text-yellow-500'}>
                    {Math.round(stats.global.weekday.stability)}%
                  </b>
                </span>
              </div>
            </Card>

            {/* 2. Выходные дни */}
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
                <span
                  className="flex items-center gap-1"
                  title={`σ=${formatMoney(stats.global.weekend.stdDev)} ₸`}
                >
                  Стабильность:{' '}
                  <b className={stats.global.weekend.stability > 70 ? 'text-green-500' : 'text-yellow-500'}>
                    {Math.round(stats.global.weekend.stability)}%
                  </b>
                </span>
              </div>
            </Card>

            {/* 3. Инсайты / Множитель */}
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
                    style={{
                      width: `${Math.min(
                        100,
                        (stats.global.weekend.avg / (stats.global.weekday.avg || 1)) * 30
                      )}%`
                    }}
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
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Будни
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  Выходные
                </span>
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
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        Загрузка данных...
                      </td>
                    </tr>
                  ) : stats.months.map((m) => (
                    <tr key={m.monthKey} className="border-b border-border/30 hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4 font-medium text-foreground">
                        {m.monthName}
                        <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
                          {m.wdStats.count + m.weStats.count} смен
                        </div>
                      </td>

                      {/* Будни */}
                      <td className="px-6 py-4 text-right">
                        <div className="font-mono text-blue-200">{formatMoney(m.wdStats.avg)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5" title={`σ=${formatMoney(m.wdStats.stdDev)} ₸`}>
                          Стаб: {Math.round(m.wdStats.stability)}%
                        </div>
                      </td>

                      {/* Выходные */}
                      <td className="px-6 py-4 text-right relative">
                        <div className="absolute inset-y-2 right-2 w-1 bg-purple-500/10 rounded-full">
                          <div
                            className="absolute bottom-0 w-full bg-purple-500 rounded-full transition-all"
                            style={{
                              height: `${Math.min(
                                100,
                                (m.weStats.avg / (stats.global.weekend.avg || 1)) * 60
                              )}%`
                            }}
                          />
                        </div>
                        <div className="font-mono font-bold text-purple-300 pr-3">{formatMoney(m.weStats.avg)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 pr-3" title={`σ=${formatMoney(m.weStats.stdDev)} ₸`}>
                          Стаб: {Math.round(m.weStats.stability)}%
                        </div>
                      </td>

                      {/* Множитель */}
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

                      {/* Итого */}
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
        </div>
      </main>
    </div>
  )
}
