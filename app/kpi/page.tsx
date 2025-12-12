'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import { CalendarDays, TrendingUp, BarChart3 } from 'lucide-react'

// ---------- forecast ----------
function holtForecastNext(
  series: number[],
  alpha = 0.55,
  beta = 0.25,
  growthClampPct = 0.15,
) {
  if (series.length === 0) return 0
  if (series.length === 1) return Math.max(0, series[0])

  let L = series[0]
  let T = series[1] - series[0]

  for (let i = 1; i < series.length; i++) {
    const y = series[i]
    const prevL = L

    L = alpha * y + (1 - alpha) * (L + T)
    T = beta * (L - prevL) + (1 - beta) * T

    const clamp = Math.abs(L) * growthClampPct
    if (T > clamp) T = clamp
    if (T < -clamp) T = -clamp
  }

  return Math.max(0, L + T)
}

const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

type IncomeJoined = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  companies: { code: string | null; name: string }
}

type CompanyCode = 'arena' | 'ramen' | 'extra'

function monthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function firstDayOfMonthISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function lastDayOfMonthISO(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2,'0')}`
}

export default function KPIPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<IncomeJoined[]>([])
  const [error, setError] = useState<string | null>(null)

  // считаем план на январь, находясь в декабре (текущая дата)
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1) // декабрь
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1) // ноябрь
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1) // январь

  const dateFrom = firstDayOfMonthISO(prevMonth) // с 1 ноября
  const dateTo = lastDayOfMonthISO(currentMonth) // по 31 декабря (чтобы взять весь декабрь, если уже есть будущие даты — не страшно)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      // incomes + join companies
      const { data, error } = await supabase
        .from('incomes')
        .select('date,cash_amount,kaspi_amount,card_amount,companies:company_id(code,name)')
        .gte('date', dateFrom)
        .lte('date', dateTo)

      if (error) {
        console.error(error)
        setError('Ошибка загрузки KPI данных')
        setLoading(false)
        return
      }

      setRows((data || []) as any)
      setLoading(false)
    }

    load()
  }, [dateFrom, dateTo])

  const analytics = useMemo(() => {
    const allowed: CompanyCode[] = ['arena', 'ramen', 'extra']

    // month -> company -> turnover
    const map = new Map<string, Record<string, number>>()

    // текущий декабрь — отдельно MTD для оценки
    const currentMonthKey = monthKey(currentMonth)
    const todayDay = now.getDate()
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

    for (const r of rows) {
      const code = (r.companies?.code || '').toLowerCase() as CompanyCode
      if (!allowed.includes(code)) continue

      const mKey = r.date.slice(0, 7) // YYYY-MM
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0)

      if (total <= 0) continue

      const entry = map.get(mKey) || {}
      entry[code] = (entry[code] || 0) + total
      map.set(mKey, entry)
    }

    const novKey = monthKey(prevMonth)
    const decKey = monthKey(currentMonth)
    const janKey = monthKey(nextMonth)

    const get = (k: string, code: CompanyCode) => map.get(k)?.[code] || 0
    const nov = {
      arena: get(novKey, 'arena'),
      ramen: get(novKey, 'ramen'),
      extra: get(novKey, 'extra'),
    }
    const decFact = {
      arena: get(decKey, 'arena'),
      ramen: get(decKey, 'ramen'),
      extra: get(decKey, 'extra'),
    }

    // декабрь может быть не полный → оцениваем закрытие месяца
    const scale = daysInCurrentMonth > 0 ? (daysInCurrentMonth / Math.max(1, todayDay)) : 1
    const decEstimated = {
      arena: decFact.arena * scale,
      ramen: decFact.ramen * scale,
      extra: decFact.extra * scale,
    }

    // прогноз января: берем series [ноябрь, декабрь_оценка]
    const janPlan = {
      arena: holtForecastNext([nov.arena, decEstimated.arena]),
      ramen: holtForecastNext([nov.ramen, decEstimated.ramen]),
      extra: holtForecastNext([nov.extra, decEstimated.extra]),
    }

    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

    const janTotal = sum(janPlan)
    const janWeekly = janTotal / 4.345 // среднее недель в месяце
    const janPerDay = janTotal / 30 // грубо, можно заменить на daysInMonth(jan)
    const janPerShift = janPerDay / 2 // 2 смены

    return {
      months: { novKey, decKey, janKey },
      nov,
      decFact,
      decEstimated,
      janPlan,
      totals: {
        janTotal,
        janWeekly,
        janPerShift,
      },
    }
  }, [rows])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          Загрузка KPI...
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-red-400">
          {error}
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-purple-400" />
            <h1 className="text-2xl font-bold">KPI / План (автогенерация)</h1>
          </div>

          <Card className="p-4 bg-card/70 border-border text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            Берём данные из <b>incomes</b> за {analytics.months.novKey} и {analytics.months.decKey},
            оцениваем декабрь (если не полный) и генерируем план на {analytics.months.janKey}.
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-card/80 border-border">
              <div className="text-xs text-muted-foreground mb-1">Ноябрь факт</div>
              <div className="text-lg font-bold">{money(analytics.nov.arena + analytics.nov.ramen + analytics.nov.extra)}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Arena: {money(analytics.nov.arena)}<br />
                Ramen: {money(analytics.nov.ramen)}<br />
                Extra: {money(analytics.nov.extra)}
              </div>
            </Card>

            <Card className="p-4 bg-card/80 border-border">
              <div className="text-xs text-muted-foreground mb-1">Декабрь факт (MTD)</div>
              <div className="text-lg font-bold">{money(analytics.decFact.arena + analytics.decFact.ramen + analytics.decFact.extra)}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Arena: {money(analytics.decFact.arena)}<br />
                Ramen: {money(analytics.decFact.ramen)}<br />
                Extra: {money(analytics.decFact.extra)}
              </div>
            </Card>

            <Card className="p-4 bg-card/80 border-border">
              <div className="text-xs text-muted-foreground mb-1">Декабрь оценка закрытия</div>
              <div className="text-lg font-bold">{money(analytics.decEstimated.arena + analytics.decEstimated.ramen + analytics.decEstimated.extra)}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Arena: {money(analytics.decEstimated.arena)}<br />
                Ramen: {money(analytics.decEstimated.ramen)}<br />
                Extra: {money(analytics.decEstimated.extra)}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5 bg-card border-border">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h2 className="font-semibold">План на январь (месяц)</h2>
              </div>

              <div className="text-3xl font-bold mb-3">{money(analytics.totals.janTotal)}</div>

              <div className="text-sm text-muted-foreground space-y-1">
                <div>Arena: <span className="text-foreground">{money(analytics.janPlan.arena)}</span></div>
                <div>Ramen: <span className="text-foreground">{money(analytics.janPlan.ramen)}</span></div>
                <div>Extra: <span className="text-foreground">{money(analytics.janPlan.extra)}</span></div>
              </div>
            </Card>

            <Card className="p-5 bg-card border-border">
              <h2 className="font-semibold mb-2">Разбивка плана</h2>
              <div className="text-sm text-muted-foreground space-y-2">
                <div>Недельный: <span className="text-foreground font-semibold">{money(analytics.totals.janWeekly)}</span></div>
                <div>На смену (2 смены/день): <span className="text-foreground font-semibold">{money(analytics.totals.janPerShift)}</span></div>
                <div className="text-[11px] text-muted-foreground/80">
                  Это “опорные цифры”. Индивидуальные планы распределим по доле оператора (по выручке/сменам) — следующим шагом.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
