'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  RefreshCcw,
  Wand2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CalendarDays,
  Target,
  Wallet,
  Users,
} from 'lucide-react'

// ================== НАСТРОЙКИ ==================
const KPI_BONUS_RATE = 0.2
const SUPERVISOR_SALARY = 250_000
const MARKETING_SALARY = 500_000

const SHIFT_BASE_PAY = 8_000

// Бонус команды за неделю: 10% от перевыполнения
const TEAM_POOL_RATE = 0.10

const COMPANIES = ['arena', 'ramen', 'extra'] as const
type CompanyCode = (typeof COMPANIES)[number]
type TeamKey = 'weekday' | 'weekend'

// ================== TYPES ==================
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

type IncomeRow = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  companies?: { code?: string | null } | null
}

type OperatorMap = Record<string, string>

type TeamAgg = { fact: number; plan: number; pct: number; ok: boolean }
type CompanyKpi = {
  company: CompanyCode
  week: Record<TeamKey, TeamAgg>
  month: TeamAgg
}

type PayRow = {
  operator_id: string
  name: string
  shifts: number
  turnover: number
  basePay: number
  thresholdBonus: number
  teamBonus: number
  total: number
}

type DashboardResponse = {
  collectivePlans: KpiRow[]
  weekRows: IncomeRow[]
  monthRows: IncomeRow[]
  weekdayShare: Record<CompanyCode, number>
  operatorNames: OperatorMap
}

// ================== UTILS ==================
const money = (v: number) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

function getWeeksInMonth(monthStartISO: string) {
  const start = startOfMonth(monthStartISO)
  const end = endOfMonth(monthStartISO)

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

function isWeekdayTeam(dateStr: string) {
  const d = parseLocalDate(dateStr)
  const day = d.getDay() // 0=Вс,1=Пн,...6=Сб
  return day >= 1 && day <= 4
}

function pct(fact: number, plan: number) {
  if (!plan || plan <= 0) return 0
  return (fact / plan) * 100
}

function getAmount(r: IncomeRow) {
  return Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
}

function getCompanyCode(r: IncomeRow): CompanyCode | null {
  const c = String(r.companies?.code || '').toLowerCase()
  return (COMPANIES as readonly string[]).includes(c) ? (c as CompanyCode) : null
}

// ✅ Сейчас у тебя в incomes нет поля "ночь/день", поэтому считаем ВСЕ смены дневными.
function isNightShift(_r: IncomeRow): boolean {
  return false
}

// Пороговые бонусы
function thresholdBonusForShift(company: CompanyCode, amount: number, night: boolean) {
  if (company === 'arena') {
    if (!night) {
      let b = 0
      if (amount >= 130_000) b += 2_000
      if (amount >= 160_000) b += 2_000
      return b
    } else {
      let b = 0
      if (amount >= 150_000) b += 2_000
      if (amount >= 180_000) b += 2_000
      return b
    }
  }

  if (company === 'ramen') {
    let b = 0
    if (amount >= 80_000) b += 2_000
    if (amount >= 100_000) b += 2_000
    return b
  }

  return 0
}

// ================== MAIN PAGE ==================
export default function KPIStatusAndPayoutPage() {
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

  const [weekRows, setWeekRows] = useState<IncomeRow[]>([])
  const [monthRows, setMonthRows] = useState<IncomeRow[]>([])
  const [operatorNames, setOperatorNames] = useState<OperatorMap>({})

  const loadAll = useCallback(async () => {
    if (!weekRange?.start) return
    setLoading(true)
    setStatus(null)

    try {
      // 1) Планы collective
      const params = new URLSearchParams({
        monthStart,
        weekStart: weekRange.start,
        weekEnd: weekRange.end,
      })
      const response = await fetch(`/api/admin/kpi-dashboard?${params.toString()}`, {
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as (DashboardResponse & { error?: string }) | null
      if (!response.ok) throw new Error(payload?.error || 'Ошибка загрузки KPI')

      const p: any = { arena: { week: 0, month: 0 }, ramen: { week: 0, month: 0 }, extra: { week: 0, month: 0 } }
      ;(payload?.collectivePlans || []).forEach((r) => {
        const c = String(r.company_code || '').toLowerCase() as CompanyCode
        if (!COMPANIES.includes(c)) return
        p[c] = { week: Number(r.turnover_target_week || 0), month: Number(r.turnover_target_month || 0) }
      })
      setCollectivePlans(p)

      // 2) Факты неделя + месяц
      const weekList = payload?.weekRows || []
      const monthList = payload?.monthRows || []

      // ✅ ВАЖНО: select только из реальных колонок
      setWeekRows(weekList)
      setMonthRows(monthList)

      const weekAgg: any = {
        arena: { weekday: 0, weekend: 0 },
        ramen: { weekday: 0, weekend: 0 },
        extra: { weekday: 0, weekend: 0 },
      }

      weekList.forEach((r: IncomeRow) => {
        const c = getCompanyCode(r)
        if (!c) return
        const amount = getAmount(r)
        const team: TeamKey = isWeekdayTeam(r.date) ? 'weekday' : 'weekend'
        weekAgg[c][team] += amount
      })
      setFactsWeek(weekAgg)

      const monthAgg: any = { arena: 0, ramen: 0, extra: 0 }
      monthList.forEach((r: IncomeRow) => {
        const c = getCompanyCode(r)
        if (!c) return
        monthAgg[c] += getAmount(r)
      })
      setFactsMonth(monthAgg)

      // 3) Доля Пн–Чт / Пт–Вс по истории (N-2..N-1)
      setWeekdayShare(payload?.weekdayShare || { arena: 4 / 7, ramen: 4 / 7, extra: 4 / 7 })

      // 4) Имена операторов
      setOperatorNames(payload?.operatorNames || {})

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

  // ======= GENERATE collective plans only =======
  const generatePlans = useCallback(async () => {
    setLoading(true)
    setStatus(null)

    try {
      const response = await fetch('/api/admin/kpi-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'generateCollectivePlans',
          monthStart,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'Ошибка генерации')

      setStatus({ type: 'success', msg: 'Планы сгенерированы' })
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e?.message || 'Ошибка генерации' })
    } finally {
      setLoading(false)
    }
  }, [monthStart, loadAll])

  // ======= KPI TABLE =======
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
          weekday: { fact: factWeekday, plan: planWeekday, pct: w1, ok: planWeekday > 0 && factWeekday >= planWeekday },
          weekend: { fact: factWeekend, plan: planWeekend, pct: w2, ok: planWeekend > 0 && factWeekend >= planWeekend },
        },
        month: { fact: monthFact, plan: monthPlan, pct: m, ok: monthPlan > 0 && monthFact >= monthPlan },
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

  // ======= WEEK TEAM POOLS =======
  const teamPools = useMemo(() => {
    let poolWeekday = 0
    let poolWeekend = 0

    for (const c of COMPANIES) {
      const weekPlanTotal = collectivePlans[c]?.week || 0
      const share = weekdayShare[c] ?? 4 / 7
      const planWd = Math.round(weekPlanTotal * share)
      const planWe = Math.max(0, weekPlanTotal - planWd)

      const factWd = factsWeek[c]?.weekday || 0
      const factWe = factsWeek[c]?.weekend || 0

      const overWd = Math.max(0, factWd - planWd)
      const overWe = Math.max(0, factWe - planWe)

      poolWeekday += overWd * TEAM_POOL_RATE
      poolWeekend += overWe * TEAM_POOL_RATE
    }

    return {
      weekday: Math.round(poolWeekday),
      weekend: Math.round(poolWeekend),
    }
  }, [collectivePlans, weekdayShare, factsWeek])

  // ======= PAY CALC =======
  const buildTeamPay = useCallback(
    (team: TeamKey) => {
      const rows = weekRows.filter((r) => (isWeekdayTeam(r.date) ? 'weekday' : 'weekend') === team)

      const map = new Map<string, { shifts: number; turnover: number; thresholdBonus: number }>()
      for (const r of rows) {
        const opId = r.operator_id
        const c = getCompanyCode(r)
        if (!opId || !c) continue

        const amount = getAmount(r)
        const night = isNightShift(r)
        const b = thresholdBonusForShift(c, amount, night)

        const cur = map.get(opId) || { shifts: 0, turnover: 0, thresholdBonus: 0 }
        cur.shifts += 1
        cur.turnover += amount
        cur.thresholdBonus += b
        map.set(opId, cur)
      }

      const pool = teamPools[team] || 0
      const totalShifts = Array.from(map.values()).reduce((s, v) => s + v.shifts, 0)

      const out: PayRow[] = Array.from(map.entries()).map(([opId, v]) => {
        const name = operatorNames[opId] || opId
        const basePay = v.shifts * SHIFT_BASE_PAY
        const teamBonus = totalShifts > 0 ? Math.round(pool * (v.shifts / totalShifts)) : 0
        const total = basePay + v.thresholdBonus + teamBonus
        return {
          operator_id: opId,
          name,
          shifts: v.shifts,
          turnover: Math.round(v.turnover),
          basePay,
          thresholdBonus: v.thresholdBonus,
          teamBonus,
          total,
        }
      })

      out.sort((a, b) => b.total - a.total)
      return out
    },
    [weekRows, teamPools, operatorNames]
  )

  const buildMonthPay = useCallback(() => {
    const map = new Map<string, { shifts: number; turnover: number; thresholdBonus: number }>()
    for (const r of monthRows) {
      const opId = r.operator_id
      const c = getCompanyCode(r)
      if (!opId || !c) continue

      const amount = getAmount(r)
      const night = isNightShift(r)
      const b = thresholdBonusForShift(c, amount, night)

      const cur = map.get(opId) || { shifts: 0, turnover: 0, thresholdBonus: 0 }
      cur.shifts += 1
      cur.turnover += amount
      cur.thresholdBonus += b
      map.set(opId, cur)
    }

    const out: PayRow[] = Array.from(map.entries()).map(([opId, v]) => {
      const name = operatorNames[opId] || opId
      const basePay = v.shifts * SHIFT_BASE_PAY
      const total = basePay + v.thresholdBonus
      return {
        operator_id: opId,
        name,
        shifts: v.shifts,
        turnover: Math.round(v.turnover),
        basePay,
        thresholdBonus: v.thresholdBonus,
        teamBonus: 0,
        total,
      }
    })

    out.sort((a, b) => b.total - a.total)
    return out
  }, [monthRows, operatorNames])

  const payWeekday = useMemo(() => buildTeamPay('weekday'), [buildTeamPay])
  const payWeekend = useMemo(() => buildTeamPay('weekend'), [buildTeamPay])
  const payMonth = useMemo(() => buildMonthPay(), [buildMonthPay])

  const payTotals = useMemo(() => {
    const sum = (arr: PayRow[]) => arr.reduce((s, r) => s + r.total, 0)
    const sumBase = (arr: PayRow[]) => arr.reduce((s, r) => s + r.basePay, 0)
    const sumThr = (arr: PayRow[]) => arr.reduce((s, r) => s + r.thresholdBonus, 0)
    const sumTeam = (arr: PayRow[]) => arr.reduce((s, r) => s + r.teamBonus, 0)

    return {
      week: {
        weekday: { total: sum(payWeekday), base: sumBase(payWeekday), thr: sumThr(payWeekday), team: sumTeam(payWeekday) },
        weekend: { total: sum(payWeekend), base: sumBase(payWeekend), thr: sumThr(payWeekend), team: sumTeam(payWeekend) },
      },
      month: { total: sum(payMonth), base: sumBase(payMonth), thr: sumThr(payMonth) },
    }
  }, [payWeekday, payWeekend, payMonth])

  const StatusBadge = ({ ok }: { ok: boolean }) => (
    <Badge
      className={
        ok
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
      }
    >
      {ok ? (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> выполнен
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5" /> не выполнен
        </span>
      )}
    </Badge>
  )

  return (
    <>
        <div className="app-page-tight max-w-6xl space-y-8">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-5 pb-6 border-b border-white/5">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Target className="w-7 h-7 text-indigo-400" />
                KPI Табло + выплаты (неделя / месяц)
              </h1>
              <div className="text-xs text-muted-foreground">
                Ошибка про is_night убрана. Сейчас все смены считаются дневными (пока не добавим поле).
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
                <Wand2 className="w-4 h-4 mr-2 text-indigo-400" /> Генерировать планы
              </Button>
            </div>
          </div>

          {status && (
            <div
              className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                status.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {status.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {status.msg}
            </div>
          )}

          <Card className="p-4 bg-[#0A0A0A] border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-indigo-400" />
                  Месячный KPI менеджмента (общий)
                </div>
                <div className="text-xs text-muted-foreground">
                  Факт: <b className="text-zinc-200">{money(totals.monthFact)}</b> / План:{' '}
                  <b className="text-zinc-200">{money(totals.monthPlan)}</b>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge ok={totals.ok} />
                <Badge variant="secondary" className="font-mono">
                  Руководитель: {money(SUPERVISOR_SALARY)} {totals.ok ? `+ ${money(totals.supervisorBonus)}` : '+ 0 ₸'} ={' '}
                  {money(SUPERVISOR_SALARY + totals.supervisorBonus)}
                </Badge>
                <Badge variant="secondary" className="font-mono">
                  Маркетолог: {money(MARKETING_SALARY)} {totals.ok ? `+ ${money(totals.marketingBonus)}` : '+ 0 ₸'} ={' '}
                  {money(MARKETING_SALARY + totals.marketingBonus)}
                </Badge>
              </div>
            </div>
          </Card>

          <Card className="bg-[#0A0A0A] border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="bg-white/[0.02] text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Точка</th>
                    <th className="text-center px-4 py-3" colSpan={4}>
                      Неделя — Пн–Чт
                    </th>
                    <th className="text-center px-4 py-3" colSpan={4}>
                      Неделя — Пт–Вс
                    </th>
                    <th className="text-center px-4 py-3" colSpan={4}>
                      Месяц (общий)
                    </th>
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

                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.week.weekday.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.week.weekday.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">
                        {r.week.weekday.plan ? r.week.weekday.pct.toFixed(0) + '%' : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge ok={r.week.weekday.ok} />
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.week.weekend.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.week.weekend.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">
                        {r.week.weekend.plan ? r.week.weekend.pct.toFixed(0) + '%' : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge ok={r.week.weekend.ok} />
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-zinc-200">{money(r.month.fact)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{money(r.month.plan)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-500">{r.month.plan ? r.month.pct.toFixed(0) + '%' : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge ok={r.month.ok} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 bg-[#0A0A0A] border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" />
                  <div className="font-semibold text-zinc-200">Выплаты за неделю — Команда Пн–Чт</div>
                </div>
                <Badge variant="secondary" className="font-mono">Фонд команды: {money(teamPools.weekday)}</Badge>
              </div>

              <div className="text-xs text-muted-foreground mt-1">
                Итого к выплате: <b className="text-zinc-200">{money(payTotals.week.weekday.total)}</b>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="text-xs text-muted-foreground uppercase bg-white/[0.02]">
                    <tr>
                      <th className="text-left px-3 py-2">Сотрудник</th>
                      <th className="text-right px-3 py-2">Смены</th>
                      <th className="text-right px-3 py-2">База</th>
                      <th className="text-right px-3 py-2">Пороги</th>
                      <th className="text-right px-3 py-2">Команда</th>
                      <th className="text-right px-3 py-2">Итого</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {payWeekday.length === 0 ? (
                      <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Нет смен за выбранную неделю (Пн–Чт).</td></tr>
                    ) : payWeekday.map((r) => (
                      <tr key={r.operator_id} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-zinc-200">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-200">{r.shifts}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-200">{money(r.basePay)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{money(r.thresholdBonus)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{money(r.teamBonus)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-200">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-4 bg-[#0A0A0A] border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" />
                  <div className="font-semibold text-zinc-200">Выплаты за неделю — Команда Пт–Вс</div>
                </div>
                <Badge variant="secondary" className="font-mono">Фонд команды: {money(teamPools.weekend)}</Badge>
              </div>

              <div className="text-xs text-muted-foreground mt-1">
                Итого к выплате: <b className="text-zinc-200">{money(payTotals.week.weekend.total)}</b>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="text-xs text-muted-foreground uppercase bg-white/[0.02]">
                    <tr>
                      <th className="text-left px-3 py-2">Сотрудник</th>
                      <th className="text-right px-3 py-2">Смены</th>
                      <th className="text-right px-3 py-2">База</th>
                      <th className="text-right px-3 py-2">Пороги</th>
                      <th className="text-right px-3 py-2">Команда</th>
                      <th className="text-right px-3 py-2">Итого</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {payWeekend.length === 0 ? (
                      <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Нет смен за выбранную неделю (Пт–Вс).</td></tr>
                    ) : payWeekend.map((r) => (
                      <tr key={r.operator_id} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-zinc-200">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-200">{r.shifts}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-200">{money(r.basePay)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{money(r.thresholdBonus)}</td>
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">{money(r.teamBonus)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-200">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card className="p-4 bg-[#0A0A0A] border-white/5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-indigo-400" />
                <div className="font-semibold text-zinc-200">Выплаты за месяц (операторы)</div>
              </div>
              <Badge variant="secondary" className="font-mono">
                Итого: {money(payTotals.month.total)}
              </Badge>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="text-xs text-muted-foreground uppercase bg-white/[0.02]">
                  <tr>
                    <th className="text-left px-3 py-2">Сотрудник</th>
                    <th className="text-right px-3 py-2">Смены</th>
                    <th className="text-right px-3 py-2">База</th>
                    <th className="text-right px-3 py-2">Пороги</th>
                    <th className="text-right px-3 py-2">Итого</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {payMonth.length === 0 ? (
                    <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Нет смен за выбранный месяц.</td></tr>
                  ) : payMonth.map((r) => (
                    <tr key={r.operator_id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-zinc-200">{r.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">{r.shifts}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">{money(r.basePay)}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-400">{money(r.thresholdBonus)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-200">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-muted-foreground mt-2">
              Месячный бонус 20% применяется только к руководителю и маркетологу (сверху), если общий KPI месяца выполнен{' '}<CheckCircle2 className="inline w-3 h-3 text-green-500" />.
            </div>
          </Card>

          <div className="text-xs text-muted-foreground">
            Бонус команды (неделя) = {Math.round(TEAM_POOL_RATE * 100)}% от перевыполнения и делится по сменам.
          </div>
        </div>
    </>
  )
}
