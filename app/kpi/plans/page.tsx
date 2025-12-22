'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabaseClient'
import { calculateForecast } from '@/lib/kpiEngine'
import {
  Save,
  Wand2,
  RefreshCcw,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  CalendarDays,
  Wallet,
} from 'lucide-react'

// -------------------- НАСТРОЙКИ ЗП --------------------
// База: 8000 ₸ за 1 смену
const SHIFT_BASE = 8000

// KPI бонус на МЕСЯЦ при выполнении плана (операторы + руководитель + маркетолог)
const KPI_BONUS_RATE = 0.2

// Оклады менеджмента
const SUPERVISOR_SALARY = 250_000
const MARKETING_SALARY = 500_000

// Бонусы по сменам (по факту выручки в одной смене)
// ВАЖНО: у тебя нет shift_type day/night в incomes, поэтому считаю по "дневным" порогам.
// Если добавишь shift_type — допишем за 2 минуты.
const SHIFT_BONUS_RULES: Record<
  string,
  { t1: number; b1: number; t2: number; b2: number }
> = {
  arena: { t1: 130_000, b1: 2_000, t2: 160_000, b2: 2_000 },
  ramen: { t1: 80_000, b1: 2_000, t2: 100_000, b2: 2_000 },
}

// Extra: честное правило вместо “всем по 5к хоть один раз вышел”
// Если суммарно по Extra за неделю >= 120k → каждый оператор получает +5000 за КАЖДУЮ свою смену в этой неделе.
const EXTRA_WEEK_THRESHOLD = 120_000
const EXTRA_BONUS_PER_SHIFT = 5_000

// -------------------- UTILS --------------------

const money = (v: number) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

function getMonthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfMonth(monthStart: string) {
  return new Date(monthStart)
}
function endOfMonth(monthStart: string) {
  const d = new Date(monthStart)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

// Недели внутри месяца (Пн–Вс). Для зарплаты неделя нужна обязательно.
function getWeeksInMonth(monthStart: string) {
  const start = startOfMonth(monthStart)
  const end = endOfMonth(monthStart)

  // делаем старт недели = Понедельник
  const d = new Date(start)
  const dow = (d.getDay() + 6) % 7 // 0=Пн ... 6=Вс
  d.setDate(d.getDate() - dow)

  const weeks: { label: string; start: string; end: string }[] = []
  while (d <= end) {
    const ws = new Date(d)
    const we = new Date(d)
    we.setDate(we.getDate() + 6)

    // режем в рамки месяца
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

function getForecastDates(targetMonthStart: string) {
  const target = new Date(targetMonthStart)
  const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1)
  const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1)

  const startStr = `${getMonthKey(prev2)}-01`
  const endOfPrev1 = new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)
  const endStr = iso(endOfPrev1)

  return { target, prev1, prev2, fetchStart: startStr, fetchEnd: endStr }
}

function monthKeyFromDateStr(dateStr: string) {
  return String(dateStr || '').slice(0, 7)
}

// -------------------- TYPES --------------------

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

type OperatorMap = Record<string, string>

type FactAgg = {
  turnover: number
  shifts: number
  shiftBonus: number
}

// ключи агрегации
const keyOp = (company: string, opId: string) => `${company}::${opId}`
const keyCompany = (company: string) => `COMP::${company}`

// бонус по одной смене
function calcShiftBonus(company: string, shiftTurnover: number) {
  const rule = SHIFT_BONUS_RULES[company]
  if (!rule) return 0
  let b = 0
  if (shiftTurnover >= rule.t1) b += rule.b1
  if (shiftTurnover >= rule.t2) b += rule.b2
  return b
}

// -------------------- LOGIC HOOK --------------------

function useKpiManager(monthStart: string, weekRange: { start: string; end: string }) {
  const [rows, setRows] = useState<KpiRow[]>([])
  const [operatorNames, setOperatorNames] = useState<OperatorMap>({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  // Факты
  const [factWeek, setFactWeek] = useState<Map<string, FactAgg>>(new Map())
  const [factMonth, setFactMonth] = useState<Map<string, FactAgg>>(new Map())
  const [factMonthGlobal, setFactMonthGlobal] = useState(0)

  // Загрузка планов
  const load = useCallback(async () => {
    setLoading(true)
    setStatus(null)

    const { data: plans, error } = await supabase
      .from('kpi_plans')
      .select('*')
      .eq('month_start', monthStart)
      .order('entity_type')
      .order('company_code')

    if (error) {
      setStatus({ type: 'error', msg: 'Ошибка загрузки планов' })
      setLoading(false)
      return
    }

    setRows(plans as KpiRow[])

    const opIds = Array.from(new Set(plans?.map((r: any) => r.operator_id).filter(Boolean)))
    if (opIds.length > 0) {
      const { data: ops } = await supabase.from('operators').select('id, name').in('id', opIds)
      const map: OperatorMap = {}
      ops?.forEach((o: any) => (map[o.id] = o.name))
      setOperatorNames((prev) => ({ ...prev, ...map }))
    }

    setLoading(false)
  }, [monthStart])

  // ФАКТЫ по доходам (неделя и месяц) + бонусы по сменам
  const loadFacts = useCallback(async () => {
    // месяц
    const mStart = iso(startOfMonth(monthStart))
    const mEnd = iso(endOfMonth(monthStart))

    // неделя (в рамках месяца)
    const wStart = weekRange.start
    const wEnd = weekRange.end

    // грузим месяц (одним запросом)
    const { data: incomesMonth, error: em } = await supabase
      .from('incomes')
      .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code), operator_id')
      .gte('date', mStart)
      .lte('date', mEnd)

    if (em) {
      console.error(em)
      setStatus({ type: 'error', msg: 'Ошибка загрузки факта (месяц)' })
      return
    }

    // грузим неделю
    const { data: incomesWeek, error: ew } = await supabase
      .from('incomes')
      .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code), operator_id')
      .gte('date', wStart)
      .lte('date', wEnd)

    if (ew) {
      console.error(ew)
      setStatus({ type: 'error', msg: 'Ошибка загрузки факта (неделя)' })
      return
    }

    const agg = (rows: any[]) => {
      const map = new Map<string, FactAgg>()
      const add = (k: string, amount: number, shiftBonus: number) => {
        const cur = map.get(k) || { turnover: 0, shifts: 0, shiftBonus: 0 }
        cur.turnover += amount
        cur.shifts += 1
        cur.shiftBonus += shiftBonus
        map.set(k, cur)
      }

      // Для Extra-недели нужен общий turnover по компании, чтобы включить +5000/смена
      const extraTurnoverTotal = rows
        .filter((r) => String(r.companies?.code || '').toLowerCase() === 'extra')
        .reduce((s, r) => {
          const amount =
            Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
          return s + amount
        }, 0)

      const extraBonusEnabled = extraTurnoverTotal >= EXTRA_WEEK_THRESHOLD

      for (const r of rows || []) {
        const company = String(r.companies?.code || '').toLowerCase()
        const opId = String(r.operator_id || '')
        if (!company) continue

        const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)

        // бонусы по смене
        let bonus = 0
        bonus += calcShiftBonus(company, amount)

        // Extra: если порог недели выполнен → +5000 за смену
        // (для месяца считаем так же по каждой неделе нельзя одним махом, поэтому в месяце считаем только shiftBonus rules arena/ramen.
        // Extra месячный бонус будет только KPI 20% + базовая. Это ок. Если хочешь Extra-месяц по неделям — сделаем второй проход.)
        if (company === 'extra' && extraBonusEnabled) bonus += EXTRA_BONUS_PER_SHIFT

        // агрегируем по оператору
        if (opId) add(keyOp(company, opId), amount, bonus)

        // агрегируем по компании (для коллективного факта)
        add(keyCompany(company), amount, 0)
      }

      const global = Array.from(map.entries())
        .filter(([k]) => k.startsWith('COMP::'))
        .reduce((s, [, v]) => s + v.turnover, 0)

      return { map, global }
    }

    const w = agg(incomesWeek as any[])
    const m = agg(incomesMonth as any[])

    setFactWeek(w.map)
    setFactMonth(m.map)
    setFactMonthGlobal(m.global)
  }, [monthStart, weekRange.start, weekRange.end])

  useEffect(() => {
    loadFacts()
  }, [loadFacts])

  // ГЕНЕРАЦИЯ ПЛАНОВ (оставил твою логику как есть)
  const generate = async () => {
    setLoading(true)
    setStatus(null)

    try {
      const { target, prev1, prev2, fetchStart, fetchEnd } = getForecastDates(monthStart)

      const { data: incomes, error } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code), operator_id')
        .gte('date', fetchStart)
        .lte('date', fetchEnd)

      if (error) throw error

      const k1 = getMonthKey(prev1)
      const k2 = getMonthKey(prev2)

      type Agg = { t2: number; t1: number; s2: number; s1: number; ops: Record<string, { t: number; s: number }> }
      const stats: Record<string, Agg> = {}

      const now = new Date()
      const isPrev1Current = prev1.getMonth() === now.getMonth() && prev1.getFullYear() === now.getFullYear()
      const scaleWeight = isPrev1Current
        ? new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0).getDate() / Math.max(1, now.getDate())
        : 1

      incomes?.forEach((inc: any) => {
        const code = String(inc.companies?.code || 'other').toLowerCase()
        if (!stats[code]) stats[code] = { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} }

        const amount = (inc.cash_amount || 0) + (inc.kaspi_amount || 0) + (inc.card_amount || 0)

        const mKey = monthKeyFromDateStr(inc.date)
        const isM1 = mKey === k1
        const isM2 = mKey === k2

        if (isM2) {
          stats[code].t2 += amount
          stats[code].s2 += 1
        } else if (isM1) {
          stats[code].t1 += amount
          stats[code].s1 += 1
        }

        if (inc.operator_id && (isM1 || isM2)) {
          if (!stats[code].ops[inc.operator_id]) stats[code].ops[inc.operator_id] = { t: 0, s: 0 }
          const w = isM1 ? amount * scaleWeight : amount
          stats[code].ops[inc.operator_id].t += w
          stats[code].ops[inc.operator_id].s += 1
        }
      })

      const newRows: KpiRow[] = []

      Object.entries(stats).forEach(([code, d]) => {
        const turnCalc = calculateForecast(target, d.t1, d.t2)
        const targetT = Math.round(turnCalc.forecast)

        const shiftsCalc = calculateForecast(target, d.s1, d.s2)
        const targetS = Math.round(shiftsCalc.forecast)

        newRows.push({
          plan_key: `${monthStart}|collective|${code}`,
          month_start: monthStart,
          entity_type: 'collective',
          company_code: code,
          operator_id: null,
          role_code: null,
          turnover_target_month: targetT,
          turnover_target_week: Math.round(targetT / 4.345),
          shifts_target_month: targetS,
          shifts_target_week: Number((targetS / 4.345).toFixed(2)),
          meta: { prev2: Math.round(d.t2), prev1_est: Math.round(turnCalc.prev1Estimated), trend: turnCalc.trend.toFixed(1) },
          is_locked: false,
        })

        const totalOpWeight = Object.values(d.ops).reduce((acc, v) => acc + v.t, 0)

        Object.entries(d.ops).forEach(([opId, opData]) => {
          if (opData.t < 1000) return

          const share = totalOpWeight > 0 ? opData.t / totalOpWeight : 0
          const opTarget = Math.round(targetT * share)
          const opShifts = Math.round(targetS * share)

          newRows.push({
            plan_key: `${monthStart}|operator|${code}|${opId}`,
            month_start: monthStart,
            entity_type: 'operator',
            company_code: code,
            operator_id: opId,
            role_code: null,
            turnover_target_month: opTarget,
            turnover_target_week: Math.round(opTarget / 4.345),
            shifts_target_month: opShifts,
            shifts_target_week: Number((opShifts / 4.345).toFixed(2)),
            meta: { share: (share * 100).toFixed(1) + '%', hist_val: Math.round(opData.t) },
            is_locked: false,
          })
        })
      })

      const globalTotal = newRows
        .filter((r) => r.entity_type === 'collective')
        .reduce((sum, r) => sum + r.turnover_target_month, 0)

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

      setRows((prev) => {
        const lockedMap = new Map(prev.filter((r) => r.is_locked).map((r) => [r.plan_key, r]))
        return newRows.map((newRow) => lockedMap.get(newRow.plan_key) || newRow)
      })

      setStatus({ type: 'success', msg: 'План пересчитан' })
    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e?.message || 'Ошибка генерации' })
    } finally {
      setLoading(false)
      // после генерации обновим факт
      loadFacts()
    }
  }

  const save = async () => {
    setLoading(true)
    const { error } = await supabase.from('kpi_plans').upsert(rows, { onConflict: 'plan_key' })
    setLoading(false)
    if (error) setStatus({ type: 'error', msg: 'Ошибка сохранения' })
    else setStatus({ type: 'success', msg: 'Сохранено' })
  }

  const updateRow = (key: string, patch: Partial<KpiRow>) => {
    setRows((prev) => prev.map((r) => (r.plan_key === key ? { ...r, ...patch } : r)))
  }

  return {
    rows,
    operatorNames,
    loading,
    status,
    load,
    generate,
    save,
    updateRow,
    factWeek,
    factMonth,
    factMonthGlobal,
  }
}

// -------------------- UI COMPONENTS --------------------

function ProgressBadge({ fact, plan }: { fact: number; plan: number }) {
  const p = plan > 0 ? (fact / plan) * 100 : 0
  const ok = p >= 100
  return (
    <Badge className={ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}>
      {p.toFixed(0)}%
    </Badge>
  )
}

const SmartInput = ({ value, meta, locked, onChange }: any) => {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        disabled={locked}
        value={money(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, '')))}
        className={`w-32 bg-transparent text-right border-b border-transparent hover:border-white/20 focus:border-indigo-500 outline-none transition-colors text-sm ${
          locked ? 'opacity-50 cursor-not-allowed text-zinc-500' : 'text-zinc-100'
        }`}
      />
      <div className="text-[10px] text-muted-foreground flex gap-2">
        {meta?.prev1_est && <span title="База">База: {money(meta.prev1_est)}</span>}
        {meta?.share && <span title="Доля">Доля: {meta.share}</span>}
      </div>
    </div>
  )
}

function RowItem({
  row,
  name,
  isMain,
  onChange,
  weekFact,
  monthFact,
  weekSalary,
  monthSalary,
  weekBonus,
  monthBonus,
}: any) {
  return (
    <tr className={`group hover:bg-white/[0.02] transition-colors ${isMain ? 'bg-indigo-500/5' : ''}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {isMain ? <TrendingUp className="w-4 h-4 text-indigo-400" /> : <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />}
          <span className={isMain ? 'font-medium text-indigo-100' : 'text-zinc-300'}>{name}</span>
        </div>
      </td>

      {/* НЕДЕЛЯ */}
      <td className="px-4 py-2 text-right text-zinc-300 font-mono">
        {money(weekFact || 0)}
      </td>
      <td className="px-4 py-2 text-right">
        <span className="text-zinc-500 font-mono">{money(row.turnover_target_week || 0)}</span>
      </td>
      <td className="px-4 py-2 text-center">
        <ProgressBadge fact={weekFact || 0} plan={row.turnover_target_week || 0} />
      </td>
      <td className="px-4 py-2 text-right text-emerald-400 font-mono">
        +{money(weekBonus || 0)}
      </td>
      <td className="px-4 py-2 text-right text-white font-mono">
        {money(weekSalary || 0)}
      </td>

      {/* МЕСЯЦ */}
      <td className="px-4 py-2 text-right text-zinc-300 font-mono">
        {money(monthFact || 0)}
      </td>
      <td className="px-4 py-2 text-right">
        <SmartInput
          value={row.turnover_target_month}
          meta={row.meta}
          locked={row.is_locked}
          onChange={(v: number) =>
            onChange(row.plan_key, { turnover_target_month: v, turnover_target_week: Math.round(v / 4.345) })
          }
        />
      </td>
      <td className="px-4 py-2 text-center">
        <ProgressBadge fact={monthFact || 0} plan={row.turnover_target_month || 0} />
      </td>
      <td className="px-4 py-2 text-right text-emerald-400 font-mono">
        +{money(monthBonus || 0)}
      </td>
      <td className="px-4 py-2 text-right text-white font-mono">
        {money(monthSalary || 0)}
      </td>

      <td className="px-4 py-2 text-center">
        <button
          onClick={() => onChange(row.plan_key, { is_locked: !row.is_locked })}
          className={`p-2 rounded hover:bg-white/10 ${row.is_locked ? 'text-amber-500' : 'text-zinc-600'}`}
        >
          {row.is_locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
      </td>
    </tr>
  )
}

// -------------------- MAIN PAGE --------------------

export default function KPIPlansPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7) + '-01'
  })

  const weeks = useMemo(() => getWeeksInMonth(month), [month])
  const [weekIdx, setWeekIdx] = useState(0)

  useEffect(() => {
    setWeekIdx(0)
  }, [month])

  const weekRange = weeks[weekIdx] || weeks[0]

  const {
    rows,
    operatorNames,
    loading,
    status,
    load,
    generate,
    save,
    updateRow,
    factWeek,
    factMonth,
    factMonthGlobal,
  } = useKpiManager(month, weekRange)

  useEffect(() => {
    load()
  }, [load])

  const groupedData = useMemo(() => {
    const groups: Record<string, KpiRow[]> = {}
    const roles: KpiRow[] = []

    rows.forEach((r) => {
      if (r.entity_type === 'role') roles.push(r)
      else {
        const key = r.company_code || 'unknown'
        if (!groups[key]) groups[key] = []
        groups[key].push(r)
      }
    })

    return { groups, roles }
  }, [rows])

  const globalPlanMonth = useMemo(() => {
    const roleRow = rows.find((r) => r.entity_type === 'role' && r.role_code === 'supervisor')
    return roleRow?.turnover_target_month || rows.filter((r) => r.entity_type === 'collective').reduce((s, r) => s + (r.turnover_target_month || 0), 0)
  }, [rows])

  const globalAchieved = globalPlanMonth > 0 ? factMonthGlobal >= globalPlanMonth : false

  const supervisorMonthBonus = globalAchieved ? Math.round(SUPERVISOR_SALARY * KPI_BONUS_RATE) : 0
  const marketingMonthBonus = globalAchieved ? Math.round(MARKETING_SALARY * KPI_BONUS_RATE) : 0

  // Зарплата оператора: база = смены * 8000 + shiftBonus (arena/ramen + extra week-rule) + KPI-бонус (20% базы) если месячный план выполнен
  const calcOperatorPay = useCallback(
    (company: string, opId: string, planWeek: number, planMonth: number) => {
      const wk = factWeek.get(keyOp(company, opId)) || { turnover: 0, shifts: 0, shiftBonus: 0 }
      const mo = factMonth.get(keyOp(company, opId)) || { turnover: 0, shifts: 0, shiftBonus: 0 }

      // неделя: база + бонусы смен
      const weekBase = wk.shifts * SHIFT_BASE
      const weekSalary = weekBase + wk.shiftBonus

      // месяц: база + бонусы смен (arena/ramen) + KPI бонус 20% от базы при выполнении плана месяца
      const monthBase = mo.shifts * SHIFT_BASE
      const monthKpiBonus = planMonth > 0 && mo.turnover >= planMonth ? Math.round(monthBase * KPI_BONUS_RATE) : 0
      const monthSalary = monthBase + mo.shiftBonus + monthKpiBonus

      return {
        weekFact: wk.turnover,
        monthFact: mo.turnover,
        weekBonus: wk.shiftBonus,
        monthBonus: mo.shiftBonus + monthKpiBonus,
        weekSalary,
        monthSalary,
      }
    },
    [factWeek, factMonth]
  )

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 md:p-10">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* HEADER */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 pb-6 border-b border-white/5">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Wallet className="w-7 h-7 text-indigo-400" />
                KPI + Зарплата (неделя/месяц)
              </h1>

              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary" className="font-mono">Неделя: {weekRange?.label || '-'}</Badge>
                <Badge variant="secondary" className="font-mono">Месяц: {month.slice(0, 7)}</Badge>
              </div>

              <div className="text-xs text-muted-foreground leading-relaxed">
                <b>Неделя:</b> смены*8000 + бонусы смен (Arena/Ramen) + Extra (если неделя ≥ {money(EXTRA_WEEK_THRESHOLD)} → +{money(EXTRA_BONUS_PER_SHIFT)} за смену).<br/>
                <b>Месяц:</b> смены*8000 + бонусы смен + KPI-бонус {Math.round(KPI_BONUS_RATE*100)}% от базы, если план месяца выполнен.
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-3 bg-zinc-900/50 p-2 rounded-xl border border-white/5">
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-muted-foreground">Месяц</span>
                <input
                  type="month"
                  value={month.slice(0, 7)}
                  onChange={(e) => setMonth(e.target.value + '-01')}
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

              <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="secondary" size="sm" onClick={generate} disabled={loading}>
                <Wand2 className="w-4 h-4 mr-2 text-indigo-400" /> Генерировать
              </Button>
              <Button size="sm" onClick={save} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 text-white">
                <Save className="w-4 h-4 mr-2" /> Сохранить
              </Button>
            </div>
          </div>

          {/* STATUS */}
          {status && (
            <div
              className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                status.type === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {status.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {status.msg}
            </div>
          )}

          {/* MANAGEMENT KPI */}
          <Card className="p-4 bg-[#0A0A0A] border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm text-zinc-200 font-semibold">Месячный KPI менеджмента</div>
                <div className="text-xs text-muted-foreground">
                  Факт месяца: <b className="text-zinc-200 font-mono">{money(factMonthGlobal)} ₸</b> /
                  План: <b className="text-zinc-200 font-mono">{money(globalPlanMonth)} ₸</b>{' '}
                  <ProgressBadge fact={factMonthGlobal} plan={globalPlanMonth} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary" className="font-mono">
                  Руководитель: {money(SUPERVISOR_SALARY)} + {money(supervisorMonthBonus)} = {money(SUPERVISOR_SALARY + supervisorMonthBonus)}
                </Badge>
                <Badge variant="secondary" className="font-mono">
                  Маркетолог: {money(MARKETING_SALARY)} + {money(marketingMonthBonus)} = {money(MARKETING_SALARY + marketingMonthBonus)}
                </Badge>
              </div>
            </div>
          </Card>

          {/* TABLES */}
          {loading && rows.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-10">
              {Object.entries(groupedData.groups)
                .sort()
                .map(([code, items]) => {
                  const company = String(code || '').toLowerCase()
                  const collective = items.find((i) => i.entity_type === 'collective')
                  const operators = items
                    .filter((i) => i.entity_type === 'operator')
                    .sort((a, b) => (b.turnover_target_month || 0) - (a.turnover_target_month || 0))

                  const companyWeekFact = factWeek.get(keyCompany(company))?.turnover || 0
                  const companyMonthFact = factMonth.get(keyCompany(company))?.turnover || 0

                  return (
                    <section key={code} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold capitalize text-zinc-200">F16 {code}</h2>
                        <div className="h-px flex-1 bg-white/5" />

                        {collective && (
                          <div className="flex flex-wrap gap-2 items-center">
                            <Badge variant="secondary" className="font-mono text-xs">
                              Факт нед: {money(companyWeekFact)}
                            </Badge>
                            <Badge variant="secondary" className="font-mono text-xs">
                              Факт мес: {money(companyMonthFact)}
                            </Badge>
                          </div>
                        )}
                      </div>

                      <Card className="bg-[#0A0A0A] border-white/5 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm min-w-[1200px]">
                            <thead className="bg-white/[0.02] text-xs text-muted-foreground uppercase">
                              <tr>
                                <th className="text-left px-4 py-3 font-medium">Сотрудник</th>

                                <th className="text-right px-4 py-3 font-medium">Факт нед</th>
                                <th className="text-right px-4 py-3 font-medium">План нед</th>
                                <th className="text-center px-4 py-3 font-medium">%</th>
                                <th className="text-right px-4 py-3 font-medium">Бонус нед</th>
                                <th className="text-right px-4 py-3 font-medium text-white">ЗП нед</th>

                                <th className="text-right px-4 py-3 font-medium">Факт мес</th>
                                <th className="text-right px-4 py-3 font-medium">План мес</th>
                                <th className="text-center px-4 py-3 font-medium">%</th>
                                <th className="text-right px-4 py-3 font-medium">Бонус мес</th>
                                <th className="text-right px-4 py-3 font-medium text-white">ЗП мес</th>

                                <th className="text-center px-4 py-3 w-16">Lock</th>
                              </tr>
                            </thead>

                            <tbody className="divide-y divide-white/5">
                              {/* Командная цель */}
                              {collective && (
                                <RowItem
                                  row={collective}
                                  name="Команда (общая цель)"
                                  isMain
                                  onChange={updateRow}
                                  weekFact={companyWeekFact}
                                  monthFact={companyMonthFact}
                                  weekBonus={0}
                                  monthBonus={0}
                                  weekSalary={0}
                                  monthSalary={0}
                                />
                              )}

                              {/* Операторы */}
                              {operators.map((op) => {
                                const opId = String(op.operator_id || '')
                                const pay = calcOperatorPay(company, opId, op.turnover_target_week, op.turnover_target_month)

                                const opName = operatorNames[opId] || opId || 'ID?'

                                return (
                                  <RowItem
                                    key={op.plan_key}
                                    row={op}
                                    name={opName}
                                    isMain={false}
                                    onChange={updateRow}
                                    weekFact={pay.weekFact}
                                    monthFact={pay.monthFact}
                                    weekBonus={pay.weekBonus}
                                    monthBonus={pay.monthBonus}
                                    weekSalary={pay.weekSalary}
                                    monthSalary={pay.monthSalary}
                                  />
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </Card>

                      {/* подсказка по Extra */}
                      {company === 'extra' && (
                        <div className="text-xs text-muted-foreground">
                          Extra правило: если неделя по Extra ≥ <b className="text-zinc-200">{money(EXTRA_WEEK_THRESHOLD)} ₸</b> → каждый получает <b className="text-zinc-200">{money(EXTRA_BONUS_PER_SHIFT)} ₸</b> за каждую свою смену.
                        </div>
                      )}
                    </section>
                  )
                })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
