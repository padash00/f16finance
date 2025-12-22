'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabaseClient'
import { calculateForecast } from '@/lib/kpiEngine'
import {
  RefreshCcw,
  Wand2,
  Save,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CalendarDays,
  Target,
  Wallet,
} from 'lucide-react'

// ================== НАСТРОЙКИ ==================
const KPI_BONUS_RATE = 0.2
const SUPERVISOR_SALARY = 250_000
const MARKETING_SALARY = 500_000

const COMPANIES = ['arena', 'ramen', 'extra'] as const
type CompanyCode = (typeof COMPANIES)[number]

type KpiRow = {
  plan_key: string
  month_start: string
  entity_type: 'collective' | 'operator' | 'role'
  company_code: string | null
  operator_id: string | null
  role_code: string | null
  turnover_target_month: number
  turnover_target_week: number
  shifts_target_month: number
  shifts_target_week: number
  meta: any
  is_locked: boolean
}

// ================== UTILS ==================
const money = (v: number) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ВАЖНО: безопасный парс YYYY-MM-DD без UTC-сдвигов
function parseLocalDate(dateStr: string) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function startOfMonth(monthStartISO: string) {
  return parseLocalDate(monthStartISO)
}
function endOfMonth(monthStartISO: string) {
  const s = parseLocalDate(monthStartISO)
  return new Date(s.getFullYear(), s.getMonth() + 1, 0)
}

function getMonthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function getForecastDates(targetMonthStart: string) {
  const target = parseLocalDate(targetMonthStart)
  const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1) // N-1
  const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1) // N-2

  const fetchStart = `${getMonthKey(prev2)}-01`
  const endPrev1 = new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)
  const fetchEnd = iso(endPrev1)
  return { target, prev1, prev2, fetchStart, fetchEnd }
}

// Недели внутри месяца (Пн–Вс)
function getWeeksInMonth(monthStartISO: string) {
  const start = startOfMonth(monthStartISO)
  const end = endOfMonth(monthStartISO)

  // откатываемся на понедельник
  const d = new Date(start)
  const dow = (d.getDay() + 6) % 7 // 0=Пн ... 6=Вс
  d.setDate(d.getDate() - dow)

  const weeks: { label: string; start: string; end: string }[] = []
  while (d <= end) {
    const ws = new Date(d)
    const we = new Date(d)
    we.setDate(we.getDate() + 6)

    const clippedStart = ws < start ? start : ws
    const clippedEnd = we > end ? end : we

    weeks.push({
      label: `${iso(clippedStart)} — ${iso(clippedEnd)}`,
      start: iso(clippedStart),
      end: iso(clippedEnd),
    })

    d.setDate(d.getDate() + 7)
  }
  return weeks
}

// Команды: Пн–Чт = weekday, Пт–Вс = weekend
function isWeekdayTeam(dateStr: string) {
  const d = parseLocalDate(dateStr)
  const day = d.getDay() // 0=Вс,1=Пн,...6=Сб
  // Пн(1) Вт(2) Ср(3) Чт(4)
  return day >= 1 && day <= 4
}

type TeamKey = 'weekday' | 'weekend'
type TeamAgg = { fact: number; plan: number; pct: number; ok: boolean }
type CompanyKpi = {
  company: CompanyCode
  week: Record<TeamKey, TeamAgg>
  month: TeamAgg
}

function pct(fact: number, plan: number) {
  if (!plan || plan <= 0) return 0
  return (fact / plan) * 100
}

// ================== MAIN PAGE ==================
export default function KPIStatusPage() {
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}-01`
  })

  const weeks = useMemo(() => getWeeksInMonth(monthStart), [monthStart])
  const [weekIdx, setWeekIdx] = useState(0)
  useEffect(() => setWeekIdx(0), [monthStart])

  const weekRange = weeks[weekIdx] || weeks[0]

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  const [collectivePlans, setCollectivePlans] = useState<Record<CompanyCode, { week: number; month: number }>>({
    arena: { week: 0, month: 0 },
    ramen: { week: 0, month: 0 },
    extra: { week: 0, month: 0 },
  })

  const [weekdayShare, setWeekdayShare] = useState<Record<CompanyCode, number>>({
    arena: 4 / 7,
    ramen: 4 / 7,
    extra: 4 / 7,
  })

  const [factsWeek, setFactsWeek] = useState<Record<CompanyCode, Record<TeamKey, number>>>({
    arena: { weekday: 0, weekend: 0 },
    ramen: { weekday: 0, weekend: 0 },
    extra: { weekday: 0, weekend: 0 },
  })

  const [factsMonth, setFactsMonth] = useState<Record<CompanyCode, number>>({
    arena: 0,
    ramen: 0,
    extra: 0,
  })

  const loadAll = useCallback(async () => {
    if (!weekRange?.start) return
    setLoading(true)
    setStatus(null)

    try {
      // 1) Планы из kpi_plans (collective)
      const { data: plans, error: ep } = await supabase
        .from('kpi_plans')
        .select('*')
        .eq('month_start', monthStart)
        .eq('entity_type', 'collective')

      if (ep) throw ep

      const p: any = { arena: { week: 0, month: 0 }, ramen: { week: 0, month: 0 }, extra: { week: 0, month: 0 } }
      ;(plans as KpiRow[] | null)?.forEach((r) => {
        const c = String(r.company_code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return
        p[c] = { week: Number(r.turnover_target_week || 0), month: Number(r.turnover_target_month || 0) }
      })
      setCollectivePlans(p)

      // 2) Факты: неделя + месяц
      const mStart = iso(startOfMonth(monthStart))
      const mEnd = iso(endOfMonth(monthStart))

      const { data: incomesMonth, error: em } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', mStart)
        .lte('date', mEnd)

      if (em) throw em

      const { data: incomesWeek, error: ew } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', weekRange.start)
        .lte('date', weekRange.end)

      if (ew) throw ew

      const weekAgg: any = {
        arena: { weekday: 0, weekend: 0 },
        ramen: { weekday: 0, weekend: 0 },
        extra: { weekday: 0, weekend: 0 },
      }

      ;(incomesWeek as any[] | null)?.forEach((r) => {
        const c = String(r.companies?.code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return
        const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        const team: TeamKey = isWeekdayTeam(r.date) ? 'weekday' : 'weekend'
        weekAgg[c][team] += amount
      })

      const monthAgg: any = { arena: 0, ramen: 0, extra: 0 }
      ;(incomesMonth as any[] | null)?.forEach((r) => {
        const c = String(r.companies?.code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return
        const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        monthAgg[c] += amount
      })

      setFactsWeek(weekAgg)
      setFactsMonth(monthAgg)

      // 3) Доля плана на Пн–Чт / Пт–Вс (чтобы честно делить недельный план на команды)
      // Берём историю из N-2..N-1 (как и генерация)
      const { fetchStart, fetchEnd } = getForecastDates(monthStart)

      const { data: hist, error: eh } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', fetchStart)
        .lte('date', fetchEnd)

      if (eh) throw eh

      const wShare: any = { arena: { wd: 0, we: 0 }, ramen: { wd: 0, we: 0 }, extra: { wd: 0, we: 0 } }

      ;(hist as any[] | null)?.forEach((r) => {
        const c = String(r.companies?.code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return
        const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        const team: TeamKey = isWeekdayTeam(r.date) ? 'weekday' : 'weekend'
        if (team === 'weekday') wShare[c].wd += amount
        else wShare[c].we += amount
      })

      const res: any = { arena: 4 / 7, ramen: 4 / 7, extra: 4 / 7 }
      for (const c of COMPANIES) {
        const total = wShare[c].wd + wShare[c].we
        res[c] = total > 0 ? wShare[c].wd / total : 4 / 7
      }
      setWeekdayShare(res)

      setStatus({ type: 'success', msg: 'Данные обновлены' })
    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e?.message || 'Ошибка загрузки' })
    } finally {
      setLoading(false)
    }
  }, [monthStart, weekRange?.start, weekRange?.end])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Генерация планов: ТОЛЬКО collective + roles (без операторов)
  const generatePlans = useCallback(async () => {
    setLoading(true)
    setStatus(null)

    try {
      const { target, prev1, prev2, fetchStart, fetchEnd } = getForecastDates(monthStart)

      const { data: incomes, error } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', fetchStart)
        .lte('date', fetchEnd)

      if (error) throw error

      const k1 = getMonthKey(prev1)
      const k2 = getMonthKey(prev2)

      const sums: Record<CompanyCode, { t1: number; t2: number }> = {
        arena: { t1: 0, t2: 0 },
        ramen: { t1: 0, t2: 0 },
        extra: { t1: 0, t2: 0 },
      }

      ;(incomes as any[] | null)?.forEach((r) => {
        const c = String(r.companies?.code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return

        const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        const mKey = String(r.date).slice(0, 7)

        if (mKey === k2) sums[c].t2 += amount
        if (mKey === k1) sums[c].t1 += amount
      })

      const newRows: KpiRow[] = []

      for (const c of COMPANIES) {
        const calc = calculateForecast(target, sums[c].t1, sums[c].t2)
        const targetMonth = Math.round(calc.forecast)
        const targetWeek = Math.round(targetMonth / 4.345)

        newRows.push({
          plan_key: `${monthStart}|collective|${c}`,
          month_start: monthStart,
          entity_type: 'collective',
          company_code: c,
          operator_id: null,
          role_code: null,
          turnover_target_month: targetMonth,
          turnover_target_week: targetWeek,
          shifts_target_month: 0,
          shifts_target_week: 0,
          meta: { prev2: Math.round(sums[c].t2), prev1_est: Math.round(calc.prev1Estimated), trend: calc.trend.toFixed(1) },
          is_locked: false,
        })
      }

      const globalTotal = newRows.reduce((s, r) => s + r.turnover_target_month, 0)

      ;['supervisor', 'marketing'].forEach((role) => {
        newRows.push({
          plan_key: `${monthStart}|role|||${role}`,
          month_start: monthStart,
          entity_type: 'role',
          company_code: null,
          operator_id: null,
          role_code: role,
          turnover_target_month: globalTotal,
          turnover_target_week: Math.round(globalTotal / 4.345),
          shifts_target_month: 0,
          shifts_target_week: 0,
          meta: { note: 'Global total' },
          is_locked: false,
        })
      })

      const { error: up } = await supabase.from('kpi_plans').upsert(newRows, { onConflict: 'plan_key' })
      if (up) throw up

      setStatus({ type: 'success', msg: 'Планы сгенерированы' })
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e?.message || 'Ошибка генерации' })
    } finally {
      setLoading(false)
    }
  }, [monthStart, loadAll])

  // Визуальная таблица KPI
  const table: CompanyKpi[] = useMemo(() => {
    const out: CompanyKpi[] = []

    for (const c of COMPANIES) {
      const weekPlanTotal = collectivePlans[c]?.week || 0
      const share = weekdayShare[c] ?? 4 / 7

      const planWeekday = Math.round(weekPlanTotal * share)
      const planWeekend = Math.max(0, weekPlanTotal - planWeekday)

      const factWeekday = factsWeek[c]?.weekday || 0
      const factWeekend = factsWeek[c]?.weekend || 0

      const monthPlan = collectivePlans[c]?.month || 0
      const monthFact = factsMonth[c] || 0

      const w1 = pct(factWeekday, planWeekday)
      const w2 = pct(factWeekend, planWeekend)
      const m = pct(monthFact, monthPlan)

      out.push({
        company: c,
        week: {
          weekday: { fact: factWeekday, plan: planWeekday, pct: w1, ok: factWeekday >= planWeekday && planWeekday > 0 },
          weekend: { fact: factWeekend, plan: planWeekend, pct: w2, ok: factWeekend >= planWeekend && planWeekend > 0 },
        },
        month: { fact: monthFact, plan: monthPlan, pct: m, ok: monthFact >= monthPlan && monthPlan > 0 },
      })
    }
    return out
  }, [collectivePlans, weekdayShare, factsWeek, factsMonth])

  const totals = useMemo(() => {
    const monthPlan = table.reduce((s, r) => s + r.month.plan, 0)
    const monthFact = table.reduce((s, r) => s + r.month.fact, 0)
    const ok = monthPlan > 0 && monthFact >= monthPlan
    const supervisorBonus = ok ? Math.round(SUPERVISOR_SALARY * KPI_BONUS_RATE) : 0
    const marketingBonus = ok ? Math.round(MARKETING_SALARY * KPI_BONUS_RATE) : 0
    return { monthPlan, monthFact, ok, supervisorBonus, marketingBonus }
  }, [table])

  const StatusBadge = ({ ok }: { ok: boolean }) => (
    <Badge className={ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}>
      {ok ? (
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> выполнен</span>
      ) : (
        <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> не выполнен</span>
      )}
    </Badge>
  )

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 md:p-10">
        <div className="max-w-6xl mx-auto space-y-8">

          {/* HEADER */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-5 pb-6 border-b border-white/5">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Target className="w-7 h-7 text-indigo-400" />
                KPI Табло (2 команды + месяц)
              </h1>
              <div className="text-xs text-muted-foreground">
                Неделя = <b>Пн–Чт</b> и <b>Пт–Вс</b> ✅/❌. Месяц = общий KPI ✅/❌.
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-3 bg-zinc-900/50 p-2 rounded-xl border border-white/5">
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-muted-foreground">Месяц</span>
                <input
                  type="month"
                  value={monthStart.slice(0, 7)}
                  onChange={(e) => setMonthStart(e.target.value + '-01')}
                  className="bg-transparent border-none text-sm px-2 outline-none text-white"
                />
              </div>

              <div className="w-px h-8 bg-white/10 hidden md:block" />

              <div className="flex items-center gap-2 px-2">
                <CalendarDays className="w-4 h-4 text-zinc-500" />
                <select
                  value={weekIdx}
                  onChange={(e) => setWeekIdx(Number(e.target.value))}
                  className="bg-transparent border border-white/10 rounded px-2 py-1 text-sm text-white outline-none"
                >
                  {weeks.map((w, i) => (
                    <option key={w.label} value={i} className="bg-zinc-900">
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-px h-8 bg-white/10 hidden md:block" />

              <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading}>
                <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="secondary" size="sm" onClick={generatePlans} disabled={loading}>
                <Wand2 className="w-4 h-4 mr-2 text-indigo-400" /> Генерировать
              </Button>
            </div>
          </div>

          {/* STATUS */}
          {status && (
            <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
              status.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              {status.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {status.msg}
            </div>
          )}

          {/* MANAGEMENT KPI */}
          <Card className="p-4 bg-[#0A0A0A] border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-indigo-400" />
                  Месячный KPI менеджмента (общий)
                </div>
                <div className="text-xs text-muted-foreground">
                  Факт: <b className="text-zinc-200">{money(totals.monthFact)}</b> / План: <b className="text-zinc-200">{money(totals.monthPlan)}</b>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge ok={totals.ok} />
                <Badge variant="secondary" className="font-mono">
                  Руководитель: {money(SUPERVISOR_SALARY)} {totals.ok ? `+ ${money(totals.supervisorBonus)}` : '+ 0 ₸'} = {money(SUPERVISOR_SALARY + totals.supervisorBonus)}
                </Badge>
                <Badge variant="secondary" className="font-mono">
                  Маркетолог: {money(MARKETING_SALARY)} {totals.ok ? `+ ${money(totals.marketingBonus)}` : '+ 0 ₸'} = {money(MARKETING_SALARY + totals.marketingBonus)}
                </Badge>
              </div>
            </div>
          </Card>

          {/* TABLE KPI */}
          <Card className="bg-[#0A0A0A] border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="bg-white/[0.02] text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Точка</th>

                    <th className="text-center px-4 py-3" colSpan={4}>Неделя — Команда Пн–Чт</th>
                    <th className="text-center px-4 py-3" colSpan={4}>Неделя — Команда Пт–Вс</th>

                    <th className="text-center px-4 py-3" colSpan={4}>Месяц (общий)</th>
                  </tr>
                  <tr className="border-t border-white/5">
                    <th className="text-left px-4 py-3"></th>

                    <th className="text-right px-4 py-3">Факт</th>
                    <th className="text-right px-4 py-3">План</th>
                    <th className="text-right px-4 py-3">%</th>
                    <th className="text-center px-4 py-3">Статус</th>

                    <th className="text-right px-4 py-3">Факт</th>
                    <th className="text-right px-4 py-3">План</th>
                    <th className="text-right px-4 py-3">%</th>
                    <th className="text-center px-4 py-3">Статус</th>

                    <th className="text-right px-4 py-3">Факт</th>
                    <th className="text-right px-4 py-3">План</th>
                    <th className="text-right px-4 py-3">%</th>
                    <th className="text-center px-4 py-3">Статус</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/5">
                  {table.map((r) => (
                    <tr key={r.company} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-zinc-200 capitalize">F16 {r.company}</td>

                      {/* Weekday team */}
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.week.weekday.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.week.weekday.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{r.week.weekday.plan ? r.week.weekday.pct.toFixed(0) + '%' : '—'}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge ok={r.week.weekday.ok} /></td>

                      {/* Weekend team */}
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.week.weekend.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.week.weekend.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{r.week.weekend.plan ? r.week.weekend.pct.toFixed(0) + '%' : '—'}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge ok={r.week.weekend.ok} /></td>

                      {/* Month */}
                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.month.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.month.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{r.month.plan ? r.month.pct.toFixed(0) + '%' : '—'}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge ok={r.month.ok} /></td>
                    </tr>
                  ))}

                  {/* TOTAL */}
                  <tr className="bg-indigo-500/5">
                    <td className="px-4 py-3 font-semibold text-indigo-100">ИТОГО</td>

                    {/* totals week split считаем от фактов; план недели = сумма планов компаний, тоже делим по долям компаний */}
                    {(() => {
                      const factWd = table.reduce((s, r) => s + r.week.weekday.fact, 0)
                      const planWd = table.reduce((s, r) => s + r.week.weekday.plan, 0)
                      const okWd = planWd > 0 && factWd >= planWd

                      const factWe = table.reduce((s, r) => s + r.week.weekend.fact, 0)
                      const planWe = table.reduce((s, r) => s + r.week.weekend.plan, 0)
                      const okWe = planWe > 0 && factWe >= planWe

                      const factM = totals.monthFact
                      const planM = totals.monthPlan
                      const okM = totals.ok

                      return (
                        <>
                          <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(factWd)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(planWd)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{planWd ? (pct(factWd, planWd)).toFixed(0) + '%' : '—'}</td>
                          <td className="px-4 py-3 text-center"><StatusBadge ok={okWd} /></td>

                          <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(factWe)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(planWe)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{planWe ? (pct(factWe, planWe)).toFixed(0) + '%' : '—'}</td>
                          <td className="px-4 py-3 text-center"><StatusBadge ok={okWe} /></td>

                          <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(factM)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(planM)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{planM ? (pct(factM, planM)).toFixed(0) + '%' : '—'}</td>
                          <td className="px-4 py-3 text-center"><StatusBadge ok={okM} /></td>
                        </>
                      )
                    })()}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <div className="text-xs text-muted-foreground">
            Примечание: недельный план делится между командами по фактической доле выручки <b>Пн–Чт</b> и <b>Пт–Вс</b> из истории (N-2..N-1).
          </div>
        </div>
      </main>
    </div>
  )
}
