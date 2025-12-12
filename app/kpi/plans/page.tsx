'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

import {
  ArrowLeft,
  RefreshCcw,
  Save,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  TrendingUp,
  TrendingDown,
  Target,
  Users,
} from 'lucide-react'

type CompanyCode = 'arena' | 'ramen' | 'extra'
type ShiftFilter = 'all' | 'day' | 'night'
type SortKey = 'percent' | 'fact' | 'remaining'

type KPIPlanRow = {
  plan_key: string
  month_start: string // YYYY-MM-01
  entity_type: 'collective' | 'operator' | 'role'
  company_code: string | null
  operator_id: string | null
  role_code: string | null
  turnover_target_month: number
  turnover_target_week: number
  shifts_target_month: number
  shifts_target_week: number
  meta: any | null
  is_locked: boolean
}

type IncomeRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string | null
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  operator_name?: string | null
}

type CompanyRow = { id: string; code: string; name: string }
type OperatorRow = { id: string; name: string; is_active?: boolean | null }

const COMPANY_LABEL: Record<CompanyCode, string> = {
  arena: 'F16 Arena',
  ramen: 'F16 Ramen',
  extra: 'F16 Extra',
}

const ROLE_LABEL: Record<string, string> = {
  supervisor: 'Руководитель операторов',
  marketing: 'Маркетолог',
}

const money = (v: number) => (v || 0).toLocaleString('ru-RU') + ' ₸'
const clamp0 = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)

function toMonthStartISO(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function addMonthsISO(monthStartISO: string, delta: number) {
  const [y, m] = monthStartISO.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  dt.setMonth(dt.getMonth() + delta)
  return toMonthStartISO(dt)
}

function monthLabelRu(monthStartISO: string) {
  const [y, m] = monthStartISO.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  return dt.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

function monthEndExclusive(monthStartISO: string) {
  return addMonthsISO(monthStartISO, 1)
}

function safeNum(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function planKeyOf(p: {
  month_start: string
  entity_type: KPIPlanRow['entity_type']
  company_code?: string | null
  operator_id?: string | null
  role_code?: string | null
}) {
  return [
    p.month_start,
    p.entity_type,
    p.company_code ?? 'all',
    p.operator_id ?? 'none',
    p.role_code ?? 'none',
  ].join('|')
}

function uniqShiftKey(i: IncomeRow) {
  // Важно: смена = уникальные (date + shift + operator_id)
  return `${i.date}|${i.shift ?? 'na'}|${i.operator_id ?? 'none'}`
}

function kpiColor(percent: number) {
  if (percent >= 1) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  if (percent >= 0.7) return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  return 'bg-red-500/15 text-red-300 border-red-500/30'
}

function pct(v: number) {
  return `${Math.round((v || 0) * 100)}%`
}

export default function KPIPlansPage() {
  const [monthStart, setMonthStart] = useState<string>(() => {
    const now = new Date()
    return toMonthStartISO(now)
  })

  const [companyTab, setCompanyTab] = useState<'all' | CompanyCode>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('percent')

  const [growthPct, setGrowthPct] = useState<number>(5)

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [operators, setOperators] = useState<OperatorRow[]>([])

  const [plans, setPlans] = useState<KPIPlanRow[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // ---------- LOADERS ----------
  const loadCompanies = async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, code, name')
      .order('code', { ascending: true })
    if (error) throw error
    setCompanies((data || []) as CompanyRow[])
  }

  const loadOperators = async () => {
    const { data, error } = await supabase
      .from('operators')
      .select('id, name, is_active')
      .order('name', { ascending: true })
    if (error) throw error
    setOperators((data || []) as OperatorRow[])
  }

  const loadPlans = async (mStart: string) => {
    const { data, error } = await supabase
      .from('kpi_plans')
      .select(
        'plan_key, month_start, entity_type, company_code, operator_id, role_code, turnover_target_month, turnover_target_week, shifts_target_month, shifts_target_week, meta, is_locked',
      )
      .eq('month_start', mStart)
      .order('entity_type', { ascending: true })
      .order('company_code', { ascending: true })
    if (error) throw error
    setPlans((data || []) as KPIPlanRow[])
  }

  const loadIncomes = async (mStart: string) => {
    const from = mStart
    const to = monthEndExclusive(mStart)

    const q = supabase
      .from('incomes')
      .select(
        'id, date, company_id, shift, cash_amount, kaspi_amount, card_amount, operator_id, operator_name',
      )
      .gte('date', from)
      .lt('date', to)

    // фильтр смены
    if (shiftFilter !== 'all') q.eq('shift', shiftFilter)

    const { data, error } = await q
    if (error) throw error
    setIncomes((data || []) as IncomeRow[])
  }

  const reloadAll = async () => {
    setLoading(true)
    setError(null)
    setOk(null)
    try {
      await Promise.all([loadCompanies(), loadOperators()])
      await Promise.all([loadPlans(monthStart), loadIncomes(monthStart)])
    } catch (e: any) {
      console.error(e)
      setError(e?.message ? String(e.message) : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      setOk(null)
      try {
        await Promise.all([loadPlans(monthStart), loadIncomes(monthStart)])
      } catch (e: any) {
        console.error(e)
        setError(e?.message ? String(e.message) : 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart, shiftFilter])

  const companyIdToCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of companies) map.set(c.id, c.code)
    return map
  }, [companies])

  const operatorIdToName = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of operators) map.set(o.id, o.name)
    return map
  }, [operators])

  // ---------- FACT AGGREGATION ----------
  const facts = useMemo(() => {
    // company -> { turnover, shiftsSet, byOperator: Map }
    const byCompany = new Map<string, { turnover: number; shiftKeys: Set<string>; byOp: Map<string, { turnover: number; shiftKeys: Set<string> }> }>()
    const allKey = 'all'

    const ensureCompany = (code: string) => {
      if (!byCompany.has(code)) {
        byCompany.set(code, { turnover: 0, shiftKeys: new Set(), byOp: new Map() })
      }
      return byCompany.get(code)!
    }

    const ensureOp = (bucket: ReturnType<typeof ensureCompany>, opId: string) => {
      if (!bucket.byOp.has(opId)) bucket.byOp.set(opId, { turnover: 0, shiftKeys: new Set() })
      return bucket.byOp.get(opId)!
    }

    for (const inc of incomes) {
      const code = inc.company_id ? (companyIdToCode.get(inc.company_id) ?? 'unknown') : 'unknown'
      const turnover = safeNum(inc.cash_amount) + safeNum(inc.kaspi_amount) + safeNum(inc.card_amount)
      const sKey = uniqShiftKey(inc)

      // company bucket
      const cb = ensureCompany(code)
      cb.turnover += turnover
      cb.shiftKeys.add(sKey)

      // all bucket
      const ab = ensureCompany(allKey)
      ab.turnover += turnover
      ab.shiftKeys.add(sKey)

      // per operator
      if (inc.operator_id) {
        const opbC = ensureOp(cb, inc.operator_id)
        opbC.turnover += turnover
        opbC.shiftKeys.add(sKey)

        const opbA = ensureOp(ab, inc.operator_id)
        opbA.turnover += turnover
        opbA.shiftKeys.add(sKey)
      }
    }

    return { byCompany }
  }, [incomes, companyIdToCode])

  // ---------- PLAN LOOKUPS ----------
  const planByKey = useMemo(() => {
    const map = new Map<string, KPIPlanRow>()
    for (const p of plans) map.set(p.plan_key, p)
    return map
  }, [plans])

  const dirtyMap = useMemo(() => new Map<string, KPIPlanRow>(), [])
  const [, forceRerender] = useState(0)

  const getLiveRow = (plan_key: string) => {
    return dirtyMap.get(plan_key) ?? planByKey.get(plan_key) ?? null
  }

  const setDirtyRow = (row: KPIPlanRow) => {
    dirtyMap.set(row.plan_key, row)
    forceRerender((x) => x + 1)
  }

  const liveRows = useMemo(() => {
    // merge planByKey + dirtyMap
    const merged = new Map<string, KPIPlanRow>()
    for (const [k, v] of planByKey) merged.set(k, v)
    for (const [k, v] of dirtyMap) merged.set(k, v)
    return Array.from(merged.values())
  }, [planByKey, dirtyMap])

  // ---------- TOP SUMMARY ----------
  const summary = useMemo(() => {
    const selected = companyTab === 'all' ? 'all' : companyTab
    const bucket = facts.byCompany.get(selected)
    const factTurnoverMonth = bucket?.turnover ?? 0
    const factShiftsMonth = bucket?.shiftKeys.size ?? 0

    const collectivePlan = liveRows.find(
      (p) =>
        p.entity_type === 'collective' &&
        (companyTab === 'all'
          ? p.company_code === null || p.company_code === 'all'
          : p.company_code === companyTab),
    )

    const planTurnoverMonth = collectivePlan?.turnover_target_month ?? 0
    const planShiftsMonth = collectivePlan?.shifts_target_month ?? 0

    // недельный план/факт: грубо делим месяц на 4.43 недели
    const weeks = 4.43
    const factTurnoverWeek = factTurnoverMonth / weeks
    const factShiftsWeek = factShiftsMonth / weeks

    const planTurnoverWeek = collectivePlan?.turnover_target_week ?? Math.round(planTurnoverMonth / weeks)
    const planShiftsWeek = collectivePlan?.shifts_target_week ?? +(planShiftsMonth / weeks).toFixed(2)

    const pctMonth = planTurnoverMonth > 0 ? factTurnoverMonth / planTurnoverMonth : 0

    return {
      factTurnoverMonth,
      planTurnoverMonth,
      pctMonth,
      factTurnoverWeek,
      planTurnoverWeek,
      factShiftsMonth,
      planShiftsMonth,
      factShiftsWeek,
      planShiftsWeek,
    }
  }, [companyTab, facts, liveRows])

  // ---------- TABLE ROWS ----------
  type OperatorKpiRow = {
    operator_id: string
    operator_name: string
    company_code: string
    plan_turnover_month: number
    plan_shifts_month: number
    fact_turnover_month: number
    fact_shifts_month: number
    percent_turnover: number
    remaining_turnover: number
    plan_key?: string
    is_locked?: boolean
  }

  const operatorRows = useMemo(() => {
    const selected = companyTab === 'all' ? 'all' : companyTab
    const bucket = facts.byCompany.get(selected)
    const byOp = bucket?.byOp ?? new Map()

    const rows: OperatorKpiRow[] = []

    // планы операторов: entity_type=operator
    const operatorPlans = liveRows.filter((p) => p.entity_type === 'operator')

    // Соберём set операторов, которые есть либо в плане, либо по факту.
    const opIds = new Set<string>()
    for (const p of operatorPlans) if (p.operator_id) opIds.add(p.operator_id)
    for (const opId of byOp.keys()) opIds.add(opId)

    for (const opId of opIds) {
      // Определяем компанию оператора:
      // 1) если вкладка конкретная — она и есть
      // 2) если вкладка all — берём company_code из плана если есть, иначе "all"
      let comp: string = selected
      const planRow = operatorPlans.find((p) => p.operator_id === opId && (selected === 'all' ? true : p.company_code === selected))
      if (selected === 'all') comp = planRow?.company_code ?? 'all'

      const fact = byOp.get(opId)
      const factTurnover = fact?.turnover ?? 0
      const factShifts = fact?.shiftKeys.size ?? 0

      const planTurnover = planRow?.turnover_target_month ?? 0
      const planShifts = planRow?.shifts_target_month ?? 0

      const percent = planTurnover > 0 ? factTurnover / planTurnover : 0
      const remaining = clamp0(planTurnover - factTurnover)

      const name =
        operatorIdToName.get(opId) ??
        incomes.find((x) => x.operator_id === opId)?.operator_name ??
        '—'

      rows.push({
        operator_id: opId,
        operator_name: name,
        company_code: comp,
        plan_turnover_month: planTurnover,
        plan_shifts_month: planShifts,
        fact_turnover_month: factTurnover,
        fact_shifts_month: factShifts,
        percent_turnover: percent,
        remaining_turnover: remaining,
        plan_key: planRow?.plan_key,
        is_locked: planRow?.is_locked ?? false,
      })
    }

    // фильтр по компании, если не all (чтобы не было мусора)
    const filtered =
      companyTab === 'all'
        ? rows.filter((r) => r.company_code !== 'all') // "all" операторов в реале нет
        : rows

    // сортировка
    const sorted = filtered.sort((a, b) => {
      if (sortKey === 'percent') return b.percent_turnover - a.percent_turnover
      if (sortKey === 'fact') return b.fact_turnover_month - a.fact_turnover_month
      return b.remaining_turnover - a.remaining_turnover
    })

    return sorted
  }, [companyTab, facts, liveRows, operatorIdToName, incomes, sortKey])

  // ---------- EDIT HELPERS ----------
  const handleEditNumber = (plan_key: string, field: keyof KPIPlanRow, v: string) => {
    const row = getLiveRow(plan_key)
    if (!row) return
    if (row.is_locked) return
    const num = Math.max(0, Math.round(Number(String(v).replace(/\s/g, '')) || 0))
    setDirtyRow({ ...row, [field]: num } as KPIPlanRow)
  }

  const handleToggleLock = (plan_key: string, locked: boolean) => {
    const row = getLiveRow(plan_key)
    if (!row) return
    setDirtyRow({ ...row, is_locked: locked })
  }

  // ---------- SAVE ----------
  const saveAll = async () => {
    setError(null)
    setOk(null)
    setBusy(true)
    try {
      const changed = Array.from(dirtyMap.values())
      if (changed.length === 0) {
        setOk('Нет изменений')
        setBusy(false)
        return
      }

      const payload = changed.map((r) => ({
        plan_key: r.plan_key,
        month_start: r.month_start,
        entity_type: r.entity_type,
        company_code: r.company_code,
        operator_id: r.operator_id,
        role_code: r.role_code,
        turnover_target_month: Math.round(safeNum(r.turnover_target_month)),
        turnover_target_week: Math.round(safeNum(r.turnover_target_week)),
        shifts_target_month: Math.round(safeNum(r.shifts_target_month)),
        shifts_target_week: safeNum(r.shifts_target_week),
        meta: r.meta ?? null,
        is_locked: !!r.is_locked,
      }))

      const { error } = await supabase
        .from('kpi_plans')
        .upsert(payload, { onConflict: 'plan_key' })

      if (error) throw error

      dirtyMap.clear()
      await loadPlans(monthStart)
      setOk('Сохранено')
    } catch (e: any) {
      console.error(e)
      setError(e?.message ? String(e.message) : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  // ---------- GENERATE ----------
  const generatePlan = async () => {
    setError(null)
    setOk(null)
    setBusy(true)

    try {
      const prev1 = addMonthsISO(monthStart, -1)
      const prev2 = addMonthsISO(monthStart, -2)

      const fetchIncomesForMonth = async (mStart: string) => {
        const from = mStart
        const to = monthEndExclusive(mStart)
        const q = supabase
          .from('incomes')
          .select(
            'id, date, company_id, shift, cash_amount, kaspi_amount, card_amount, operator_id, operator_name',
          )
          .gte('date', from)
          .lt('date', to)
        const { data, error } = await q
        if (error) throw error
        return (data || []) as IncomeRow[]
      }

      const [inc1, inc2] = await Promise.all([
        fetchIncomesForMonth(prev1),
        fetchIncomesForMonth(prev2),
      ])

      // агрегируем по месяцу: company и operator (уникальные смены date+shift+operator)
      const agg = (arr: IncomeRow[]) => {
        const byCompany = new Map<string, { turnover: number; shifts: Set<string>; byOp: Map<string, { turnover: number; shifts: Set<string> }> }>()
        const ensureC = (code: string) => {
          if (!byCompany.has(code)) byCompany.set(code, { turnover: 0, shifts: new Set(), byOp: new Map() })
          return byCompany.get(code)!
        }
        const ensureO = (c: ReturnType<typeof ensureC>, opId: string) => {
          if (!c.byOp.has(opId)) c.byOp.set(opId, { turnover: 0, shifts: new Set() })
          return c.byOp.get(opId)!
        }

        for (const i of arr) {
          const code = i.company_id ? (companyIdToCode.get(i.company_id) ?? 'unknown') : 'unknown'
          const t = safeNum(i.cash_amount) + safeNum(i.kaspi_amount) + safeNum(i.card_amount)
          const sKey = uniqShiftKey(i)

          const c = ensureC(code)
          c.turnover += t
          c.shifts.add(sKey)

          if (i.operator_id) {
            const o = ensureO(c, i.operator_id)
            o.turnover += t
            o.shifts.add(sKey)
          }
        }

        return byCompany
      }

      const a1 = agg(inc1)
      const a2 = agg(inc2)

      const grow = 1 + Math.max(0, safeNum(growthPct)) / 100
      const weeks = 4.43

      const upserts: KPIPlanRow[] = []

      const makeRow = (r: Omit<KPIPlanRow, 'plan_key'>): KPIPlanRow => {
        return { ...r, plan_key: planKeyOf(r) }
      }

      // компании: только наши 3, если в companies они есть по code
      const targetCompanies: CompanyCode[] = ['arena', 'ramen', 'extra']

      for (const cc of targetCompanies) {
        // коллектив
        const c1 = a1.get(cc)
        const c2 = a2.get(cc)
        const baseTurnover = ((c1?.turnover ?? 0) + (c2?.turnover ?? 0)) / 2
        const baseShifts = ((c1?.shifts.size ?? 0) + (c2?.shifts.size ?? 0)) / 2

        const tm = Math.round(baseTurnover * grow)
        const sm = Math.round(baseShifts * grow)

        upserts.push(
          makeRow({
            month_start: monthStart,
            entity_type: 'collective',
            company_code: cc,
            operator_id: null,
            role_code: null,
            turnover_target_month: tm,
            turnover_target_week: Math.round(tm / weeks),
            shifts_target_month: sm,
            shifts_target_week: +(sm / weeks).toFixed(2),
            meta: { baseline_months: [prev2, prev1], growthPct },
            is_locked: false,
          }),
        )

        // операторы по факту (если человек работал хотя бы в одном из месяцев)
        const opIds = new Set<string>()
        for (const src of [c1, c2]) {
          if (!src) continue
          for (const id of src.byOp.keys()) opIds.add(id)
        }

        for (const opId of opIds) {
          const o1 = c1?.byOp.get(opId)
          const o2 = c2?.byOp.get(opId)
          const baseOpTurnover = ((o1?.turnover ?? 0) + (o2?.turnover ?? 0)) / 2
          const baseOpShifts = ((o1?.shifts.size ?? 0) + (o2?.shifts.size ?? 0)) / 2

          const opTm = Math.round(baseOpTurnover * grow)
          const opSm = Math.round(baseOpShifts * grow)

          upserts.push(
            makeRow({
              month_start: monthStart,
              entity_type: 'operator',
              company_code: cc,
              operator_id: opId,
              role_code: null,
              turnover_target_month: opTm,
              turnover_target_week: Math.round(opTm / weeks),
              shifts_target_month: opSm,
              shifts_target_week: +(opSm / weeks).toFixed(2),
              meta: { baseline_months: [prev2, prev1], growthPct },
              is_locked: false,
            }),
          )
        }
      }

      // роли: их KPI = общий коллектив (all 3 суммарно)
      const sumCompany = (m: Map<string, any>) => {
        let t = 0
        let s = 0
        for (const cc of targetCompanies) {
          const c = m.get(cc)
          t += c?.turnover ?? 0
          s += c?.shifts.size ?? 0
        }
        return { t, s }
      }
      const s1 = sumCompany(a1)
      const s2 = sumCompany(a2)
      const baseAllTurnover = (s1.t + s2.t) / 2
      const baseAllShifts = (s1.s + s2.s) / 2

      const allTm = Math.round(baseAllTurnover * grow)
      const allSm = Math.round(baseAllShifts * grow)

      for (const role_code of ['supervisor', 'marketing']) {
        upserts.push(
          makeRow({
            month_start: monthStart,
            entity_type: 'role',
            company_code: null,
            operator_id: null,
            role_code,
            turnover_target_month: allTm,
            turnover_target_week: Math.round(allTm / weeks),
            shifts_target_month: allSm,
            shifts_target_week: +(allSm / weeks).toFixed(2),
            meta: { baseline_months: [prev2, prev1], growthPct, scope: 'all_companies' },
            is_locked: false,
          }),
        )
      }

      // upsert в БД
      const { error } = await supabase
        .from('kpi_plans')
        .upsert(
          upserts.map((r) => ({
            plan_key: r.plan_key,
            month_start: r.month_start,
            entity_type: r.entity_type,
            company_code: r.company_code,
            operator_id: r.operator_id,
            role_code: r.role_code,
            turnover_target_month: r.turnover_target_month,
            turnover_target_week: r.turnover_target_week,
            shifts_target_month: r.shifts_target_month,
            shifts_target_week: r.shifts_target_week,
            meta: r.meta ?? null,
            is_locked: r.is_locked,
          })),
          { onConflict: 'plan_key' },
        )

      if (error) throw error

      dirtyMap.clear()
      await loadPlans(monthStart)
      setOk(`План сгенерирован из ${monthLabelRu(prev2)} + ${monthLabelRu(prev1)}`)
    } catch (e: any) {
      console.error(e)
      setError(e?.message ? String(e.message) : 'Ошибка генерации')
    } finally {
      setBusy(false)
    }
  }

  // ---------- RENDER HELPERS ----------
  const CompanySelectorTabs = (
    <Tabs
      value={companyTab}
      onValueChange={(v) => setCompanyTab(v as any)}
      className="w-full"
    >
      <TabsList className="grid grid-cols-4 w-full">
        <TabsTrigger value="all">Все</TabsTrigger>
        <TabsTrigger value="arena">Arena</TabsTrigger>
        <TabsTrigger value="ramen">Ramen</TabsTrigger>
        <TabsTrigger value="extra">Extra</TabsTrigger>
      </TabsList>
    </Tabs>
  )

  const shiftPill = (v: ShiftFilter, label: string) => (
    <Button
      type="button"
      variant={shiftFilter === v ? 'default' : 'outline'}
      size="sm"
      onClick={() => setShiftFilter(v)}
    >
      {label}
    </Button>
  )

  const sortPill = (v: SortKey, label: string) => (
    <Button
      type="button"
      variant={sortKey === v ? 'default' : 'outline'}
      size="sm"
      onClick={() => setSortKey(v)}
    >
      {label}
    </Button>
  )

  // коллективные планы для выбранной вкладки
  const collectiveRows = useMemo(() => {
    const rows = liveRows.filter((p) => p.entity_type === 'collective')
    if (companyTab === 'all') return rows.filter((r) => r.company_code === null || r.company_code === 'all')
    return rows.filter((r) => r.company_code === companyTab)
  }, [liveRows, companyTab])

  const roleRows = useMemo(() => liveRows.filter((p) => p.entity_type === 'role'), [liveRows])

  const monthPickerOptions = useMemo(() => {
    // 8 месяцев: -5 .. +2 от текущего выбранного
    const opts: string[] = []
    for (let d = -5; d <= 2; d++) opts.push(addMonthsISO(monthStart, d))
    // уникальные
    return Array.from(new Set(opts))
  }, [monthStart])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/kpi">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>

              <div>
                <h1 className="text-2xl font-bold">KPI планы</h1>
                <p className="text-xs text-muted-foreground">
                  План vs Факт. Факт = cash + kaspi + card. Смены = уникальные date+shift+operator_id.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={reloadAll}
                disabled={loading || busy}
              >
                <RefreshCcw className="w-4 h-4" />
                Обновить
              </Button>

              <Button
                size="sm"
                className="gap-2"
                onClick={generatePlan}
                disabled={loading || busy}
              >
                <Wand2 className="w-4 h-4" />
                Сгенерировать план
              </Button>

              <Button
                size="sm"
                className="gap-2"
                onClick={saveAll}
                disabled={loading || busy || dirtyMap.size === 0}
              >
                <Save className="w-4 h-4" />
                Сохранить ({dirtyMap.size})
              </Button>
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <Card className="p-3 border border-red-500/50 bg-red-950/40 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </Card>
          )}
          {ok && (
            <Card className="p-3 border border-emerald-500/40 bg-emerald-950/30 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {ok}
            </Card>
          )}

          {/* Controls */}
          <Card className="p-4 border-border bg-card/70">
            <div className="grid gap-3 md:grid-cols-12 items-end">
              <div className="md:col-span-4 space-y-2">
                <div className="text-xs text-muted-foreground">Компания</div>
                {CompanySelectorTabs}
              </div>

              <div className="md:col-span-3 space-y-2">
                <div className="text-xs text-muted-foreground">Месяц</div>
                <select
                  className="bg-input border border-border rounded px-3 py-2 text-sm w-full"
                  value={monthStart}
                  onChange={(e) => setMonthStart(e.target.value)}
                >
                  {monthPickerOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthLabelRu(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3 space-y-2">
                <div className="text-xs text-muted-foreground">Фильтр смен</div>
                <div className="flex gap-2 flex-wrap">
                  {shiftPill('all', 'Все')}
                  {shiftPill('day', 'День')}
                  {shiftPill('night', 'Ночь')}
                </div>
              </div>

              <div className="md:col-span-2 space-y-2">
                <div className="text-xs text-muted-foreground">Рост при генерации (%)</div>
                <Input
                  type="number"
                  value={growthPct}
                  onChange={(e) => setGrowthPct(Math.max(0, Number(e.target.value || 0)))}
                />
              </div>
            </div>
          </Card>

          {/* Top Summary */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-border bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" /> План месяца
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">{money(summary.planTurnoverMonth)}</div>
                <div className="text-xs text-muted-foreground">
                  Факт: <b>{money(summary.factTurnoverMonth)}</b> · Выполнение:{' '}
                  <Badge className={`border ${kpiColor(summary.pctMonth)}`}>
                    {pct(summary.pctMonth)}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Неделя (срез)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">{money(Math.round(summary.planTurnoverWeek))}</div>
                <div className="text-xs text-muted-foreground">
                  Факт (средн.): <b>{money(Math.round(summary.factTurnoverWeek))}</b>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" /> Смены
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">
                  {summary.factShiftsMonth} / {summary.planShiftsMonth}
                </div>
                <div className="text-xs text-muted-foreground">
                  Средняя выручка/смена:{' '}
                  <b>
                    {money(
                      summary.factShiftsMonth > 0
                        ? Math.round(summary.factTurnoverMonth / summary.factShiftsMonth)
                        : 0,
                    )}
                  </b>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Collective plan editor (for selected tab) */}
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Коллективный план (редактирование)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="text-sm text-muted-foreground">Загрузка…</div>
              ) : collectiveRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Нет коллективного плана. Нажми «Сгенерировать план».
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {collectiveRows.map((r) => (
                    <Card key={r.plan_key} className="border-border bg-card/60">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold">
                            {r.company_code ? COMPANY_LABEL[r.company_code as CompanyCode] : 'Все компании'}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => handleToggleLock(r.plan_key, !getLiveRow(r.plan_key)?.is_locked)}
                          >
                            {getLiveRow(r.plan_key)?.is_locked ? (
                              <>
                                <Lock className="w-4 h-4" /> Locked
                              </>
                            ) : (
                              <>
                                <Unlock className="w-4 h-4" /> Edit
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="text-[11px] text-muted-foreground">План месяца (₸)</div>
                            <Input
                              type="number"
                              value={getLiveRow(r.plan_key)?.turnover_target_month ?? 0}
                              onChange={(e) => handleEditNumber(r.plan_key, 'turnover_target_month', e.target.value)}
                              disabled={getLiveRow(r.plan_key)?.is_locked}
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] text-muted-foreground">План недели (₸)</div>
                            <Input
                              type="number"
                              value={getLiveRow(r.plan_key)?.turnover_target_week ?? 0}
                              onChange={(e) => handleEditNumber(r.plan_key, 'turnover_target_week', e.target.value)}
                              disabled={getLiveRow(r.plan_key)?.is_locked}
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-muted-foreground">Смены/мес</div>
                            <Input
                              type="number"
                              value={getLiveRow(r.plan_key)?.shifts_target_month ?? 0}
                              onChange={(e) => handleEditNumber(r.plan_key, 'shifts_target_month', e.target.value)}
                              disabled={getLiveRow(r.plan_key)?.is_locked}
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] text-muted-foreground">Смены/нед</div>
                            <Input
                              type="number"
                              value={getLiveRow(r.plan_key)?.shifts_target_week ?? 0}
                              onChange={(e) => handleEditNumber(r.plan_key, 'shifts_target_week', e.target.value)}
                              disabled={getLiveRow(r.plan_key)?.is_locked}
                            />
                          </div>
                        </div>

                        <div className="text-[11px] text-muted-foreground">
                          {getLiveRow(r.plan_key)?.meta?.baseline_months ? (
                            <>
                              База: <b>{String(getLiveRow(r.plan_key)?.meta?.baseline_months?.[0])}</b> +{' '}
                              <b>{String(getLiveRow(r.plan_key)?.meta?.baseline_months?.[1])}</b>, рост{' '}
                              <b>{String(getLiveRow(r.plan_key)?.meta?.growthPct ?? '')}%</b>
                            </>
                          ) : (
                            <>База: —</>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Operator Rating Table */}
          <Card className="border-border bg-card/70 overflow-x-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between gap-3">
                <span>Рейтинг операторов</span>
                <div className="flex gap-2 flex-wrap">
                  {sortPill('percent', 'По %')}
                  {sortPill('fact', 'По факту')}
                  {sortPill('remaining', 'По “осталось”')}
                </div>
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              <table className="w-full text-xs md:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Оператор</th>
                    <th className="px-3 py-2 text-left">Компания</th>
                    <th className="px-3 py-2 text-right">Смены факт/план</th>
                    <th className="px-3 py-2 text-right">Выручка факт</th>
                    <th className="px-3 py-2 text-right">План</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-right">Осталось</th>
                    <th className="px-3 py-2 text-right">Lock</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        Загрузка…
                      </td>
                    </tr>
                  ) : operatorRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        Нет данных. Сгенерируй план и проверь доходы.
                      </td>
                    </tr>
                  ) : (
                    operatorRows.map((r) => {
                      const badgeCls = `border ${kpiColor(r.percent_turnover)}`
                      const locked = !!r.is_locked
                      return (
                        <tr key={r.operator_id} className="border-t border-border/40 hover:bg-white/5">
                          <td className="px-3 py-2 font-medium">{r.operator_name}</td>
                          <td className="px-3 py-2">
                            {r.company_code === 'all'
                              ? '—'
                              : COMPANY_LABEL[(r.company_code as CompanyCode) ?? 'arena']}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.fact_shifts_month} / {r.plan_shifts_month}
                          </td>
                          <td className="px-3 py-2 text-right">{money(Math.round(r.fact_turnover_month))}</td>
                          <td className="px-3 py-2 text-right">{money(Math.round(r.plan_turnover_month))}</td>
                          <td className="px-3 py-2 text-right">
                            <Badge className={badgeCls}>{pct(r.percent_turnover)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">{money(Math.round(r.remaining_turnover))}</td>
                          <td className="px-3 py-2 text-right">
                            {r.plan_key ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => handleToggleLock(r.plan_key!, !locked)}
                              >
                                {locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Roles */}
          <div className="grid gap-4 md:grid-cols-2">
            {roleRows.map((r) => (
              <Card key={r.plan_key} className="border-border bg-card/70">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{ROLE_LABEL[r.role_code ?? ''] ?? `Роль: ${r.role_code}`}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleToggleLock(r.plan_key, !getLiveRow(r.plan_key)?.is_locked)}
                    >
                      {getLiveRow(r.plan_key)?.is_locked ? (
                        <>
                          <Lock className="w-4 h-4" /> Locked
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4" /> Edit
                        </>
                      )}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">План месяца (₸)</div>
                      <Input
                        type="number"
                        value={getLiveRow(r.plan_key)?.turnover_target_month ?? 0}
                        onChange={(e) => handleEditNumber(r.plan_key, 'turnover_target_month', e.target.value)}
                        disabled={getLiveRow(r.plan_key)?.is_locked}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">План недели (₸)</div>
                      <Input
                        type="number"
                        value={getLiveRow(r.plan_key)?.turnover_target_week ?? 0}
                        onChange={(e) => handleEditNumber(r.plan_key, 'turnover_target_week', e.target.value)}
                        disabled={getLiveRow(r.plan_key)?.is_locked}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">Смены/мес</div>
                      <Input
                        type="number"
                        value={getLiveRow(r.plan_key)?.shifts_target_month ?? 0}
                        onChange={(e) => handleEditNumber(r.plan_key, 'shifts_target_month', e.target.value)}
                        disabled={getLiveRow(r.plan_key)?.is_locked}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">Смены/нед</div>
                      <Input
                        type="number"
                        value={getLiveRow(r.plan_key)?.shifts_target_week ?? 0}
                        onChange={(e) => handleEditNumber(r.plan_key, 'shifts_target_week', e.target.value)}
                        disabled={getLiveRow(r.plan_key)?.is_locked}
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    KPI этой роли завязан на <b>общий коллективный план</b> (все компании).
                    Если хочешь — добавим отдельные KPI метрики для маркетолога в meta (контент/баннеры/рост).
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-[11px] text-muted-foreground">
            {loading ? 'Загрузка…' : busy ? 'Работаем…' : 'Готово.'}{' '}
            {dirtyMap.size > 0 ? (
              <span className="text-amber-300">Есть несохранённые изменения.</span>
            ) : (
              <span>Изменений нет.</span>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
