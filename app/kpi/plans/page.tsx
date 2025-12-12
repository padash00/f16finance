'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Save, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react'

type EntityType = 'collective' | 'operator' | 'role'
type RoleCode = 'marketing' | 'supervisor'

type Company = {
  id: string
  name: string
  code: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type IncomeRow = {
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
}

type KpiPlanRow = {
  plan_key: string
  month_start: string
  entity_type: EntityType
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

const formatMoney = (v: number) =>
  (v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const parseIntSafe = (v: any): number => {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

const parseFloatSafe = (v: any): number => {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const toMonthStartISO = (yyyyMm: string) => `${yyyyMm}-01`

const monthKeyFromISODate = (iso: string) => iso.slice(0, 7) // YYYY-MM

const addMonths = (yyyyMm: string, delta: number) => {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

const daysInMonth = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

const lastDayISO = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m, 0)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const planKey = (args: {
  monthStart: string
  entityType: EntityType
  companyCode?: string | null
  operatorId?: string | null
  roleCode?: string | null
}) => {
  const c = args.companyCode || '-'
  const o = args.operatorId || '-'
  const r = args.roleCode || '-'
  return `${args.monthStart}|${args.entityType}|${c}|${o}|${r}`
}

export default function KPIPlansPage() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // по умолчанию показываем следующий месяц (план обычно строим наперёд)
  const [selectedMonth, setSelectedMonth] = useState(addMonths(currentMonth, 1)) // YYYY-MM

  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [plans, setPlans] = useState<KpiPlanRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [savingAll, setSavingAll] = useState(false)
  const [generating, setGenerating] = useState(false)

  // рост к плану (в %)
  const [growthPct, setGrowthPct] = useState(5) // 5% по умолчанию

  const monthStart = useMemo(() => toMonthStartISO(selectedMonth), [selectedMonth])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const operatorById = useMemo(() => {
    const map: Record<string, Operator> = {}
    for (const o of operators) map[o.id] = o
    return map
  }, [operators])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    const [compRes, opsRes, planRes] = await Promise.all([
      supabase.from('companies').select('id,name,code').order('name'),
      supabase.from('operators').select('id,name,short_name,is_active').order('name'),
      supabase
        .from('kpi_plans')
        .select(
          'plan_key,month_start,entity_type,company_code,operator_id,role_code,turnover_target_month,turnover_target_week,shifts_target_month,shifts_target_week,meta,is_locked',
        )
        .eq('month_start', monthStart),
    ])

    if (compRes.error || opsRes.error || planRes.error) {
      console.error(compRes.error, opsRes.error, planRes.error)
      setError('Ошибка загрузки KPI планов')
      setLoading(false)
      return
    }

    setCompanies((compRes.data || []) as Company[])
    setOperators((opsRes.data || []) as Operator[])
    setPlans((planRes.data || []) as KpiPlanRow[])
    setDirtyKeys(new Set())
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart])

  const markDirty = (key: string) => {
    setDirtyKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  const handlePlanChange = (
    key: string,
    field: keyof KpiPlanRow,
    value: string | boolean,
  ) => {
    setPlans((prev) =>
      prev.map((p) => (p.plan_key === key ? ({ ...p, [field]: value } as any) : p)),
    )
    markDirty(key)
    setSuccessMsg(null)
  }

  const handleSaveAll = async () => {
    setError(null)
    setSuccessMsg(null)
    setSavingAll(true)

    try {
      const dirty = plans.filter((p) => dirtyKeys.has(p.plan_key))
      if (dirty.length === 0) {
        setSuccessMsg('Нечего сохранять')
        return
      }

      const payload = dirty.map((p) => ({
        plan_key: p.plan_key,
        month_start: p.month_start,
        entity_type: p.entity_type,
        company_code: p.company_code,
        operator_id: p.operator_id,
        role_code: p.role_code,
        turnover_target_month: parseIntSafe(p.turnover_target_month),
        turnover_target_week: parseIntSafe(p.turnover_target_week),
        shifts_target_month: parseIntSafe(p.shifts_target_month),
        shifts_target_week: parseFloatSafe(p.shifts_target_week),
        meta: p.meta ?? null,
        is_locked: !!p.is_locked,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('kpi_plans')
        .upsert(payload, { onConflict: 'plan_key' })

      if (error) throw error

      setSuccessMsg('Сохранено')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSavingAll(false)
    }
  }

  // ====== ГЕНЕРАЦИЯ ПЛАНА ИЗ 2 МЕСЯЦЕВ ДО ВЫБРАННОГО ======
  const handleGenerate = async () => {
    setError(null)
    setSuccessMsg(null)
    setGenerating(true)

    try {
      const baseM1 = addMonths(selectedMonth, -2) // например для Jan: Nov
      const baseM2 = addMonths(selectedMonth, -1) // для Jan: Dec

      const rangeFrom = `${baseM1}-01`
      const rangeTo = lastDayISO(baseM2)

      // берём доходы за 2 месяца
      const { data: inc, error: incErr } = await supabase
        .from('incomes')
        .select('date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id')
        .gte('date', rangeFrom)
        .lte('date', rangeTo)

      if (incErr) throw incErr

      // агрегаты:
      // companyMonthTurnover[YYYY-MM][company_code] = turnover
      const companyMonthTurnover: Record<string, Record<string, number>> = {}
      const companyMonthShifts: Record<string, Record<string, number>> = {}

      // companyOpTurnover[company_code][operator_id] = turnover(за 2 месяца суммарно)
      const companyOpTurnover: Record<string, Record<string, number>> = {}
      const companyOpShifts: Record<string, Record<string, number>> = {}

      const shiftSeen = new Set<string>()

      for (const row of (inc || []) as IncomeRow[]) {
        const comp = companyById[row.company_id]
        const code = comp?.code
        if (!code) continue
        if (!['arena', 'ramen', 'extra'].includes(code)) continue

        const mk = monthKeyFromISODate(row.date)
        companyMonthTurnover[mk] ||= {}
        companyMonthShifts[mk] ||= {}
        companyMonthTurnover[mk][code] ||= 0
        companyMonthShifts[mk][code] ||= 0

        const total =
          Number(row.cash_amount || 0) +
          Number(row.kaspi_amount || 0) +
          Number(row.card_amount || 0)

        companyMonthTurnover[mk][code] += total

        // смены считаем уникально как (operator_id + company + date + shift)
        const shift = row.shift === 'night' ? 'night' : 'day'
        const opId = row.operator_id
        if (opId) {
          const sk = `${opId}|${code}|${row.date}|${shift}`
          if (!shiftSeen.has(sk)) {
            shiftSeen.add(sk)
            companyMonthShifts[mk][code] += 1

            companyOpShifts[code] ||= {}
            companyOpShifts[code][opId] ||= 0
            companyOpShifts[code][opId] += 1
          }

          companyOpTurnover[code] ||= {}
          companyOpTurnover[code][opId] ||= 0
          companyOpTurnover[code][opId] += total
        }
      }

      const weeks = daysInMonth(selectedMonth) / 7
      const growth = 1 + Math.max(0, Number(growthPct) || 0) / 100

      const monthStartISO = toMonthStartISO(selectedMonth)

      const newRows: KpiPlanRow[] = []

      const companyCodes: string[] = ['arena', 'ramen', 'extra']

      // 1) коллективные планы по компаниям
      for (const code of companyCodes) {
        const t1 = companyMonthTurnover[baseM1]?.[code] || 0
        const t2 = companyMonthTurnover[baseM2]?.[code] || 0
        const s1 = companyMonthShifts[baseM1]?.[code] || 0
        const s2 = companyMonthShifts[baseM2]?.[code] || 0

        const avgTurnover = (t1 + t2) / 2
        const avgShifts = (s1 + s2) / 2

        const targetMonth = Math.round(avgTurnover * growth)
        const targetWeek = Math.round(targetMonth / weeks)

        const shiftsMonth = Math.round(avgShifts * growth)
        const shiftsWeek = Number((shiftsMonth / weeks).toFixed(2))

        newRows.push({
          plan_key: planKey({ monthStart: monthStartISO, entityType: 'collective', companyCode: code }),
          month_start: monthStartISO,
          entity_type: 'collective',
          company_code: code,
          operator_id: null,
          role_code: null,
          turnover_target_month: targetMonth,
          turnover_target_week: targetWeek,
          shifts_target_month: shiftsMonth,
          shifts_target_week: shiftsWeek,
          meta: {
            basisMonths: [baseM1, baseM2],
            basisTurnover: { [baseM1]: t1, [baseM2]: t2, avg: avgTurnover },
            basisShifts: { [baseM1]: s1, [baseM2]: s2, avg: avgShifts },
            growthPct: growthPct,
            source: 'auto',
          },
          is_locked: false,
        })
      }

      // 2) индивидуальные планы операторов (по доле внутри компании)
      for (const code of companyCodes) {
        const sum2m = (companyMonthTurnover[baseM1]?.[code] || 0) + (companyMonthTurnover[baseM2]?.[code] || 0)
        const sum2mShifts = (companyMonthShifts[baseM1]?.[code] || 0) + (companyMonthShifts[baseM2]?.[code] || 0)

        // берём target из коллективного (чтобы сумма операторов = план компании)
        const collective = newRows.find(
          (x) => x.entity_type === 'collective' && x.company_code === code,
        )
        const companyTargetMonth = collective?.turnover_target_month || 0
        const companyTargetShiftsMonth = collective?.shifts_target_month || 0

        const opMap = companyOpTurnover[code] || {}
        const opShiftMap = companyOpShifts[code] || {}

        for (const opId of Object.keys(opMap)) {
          const opTurn2m = opMap[opId] || 0
          const opShifts2m = opShiftMap[opId] || 0

          const share = sum2m > 0 ? opTurn2m / sum2m : 0
          const shareSh = sum2mShifts > 0 ? opShifts2m / sum2mShifts : 0

          const targetMonth = Math.round(companyTargetMonth * share)
          const targetWeek = Math.round(targetMonth / weeks)

          const shiftsMonth = Math.round(companyTargetShiftsMonth * shareSh)
          const shiftsWeek = Number((shiftsMonth / weeks).toFixed(2))

          newRows.push({
            plan_key: planKey({
              monthStart: monthStartISO,
              entityType: 'operator',
              companyCode: code,
              operatorId: opId,
            }),
            month_start: monthStartISO,
            entity_type: 'operator',
            company_code: code,
            operator_id: opId,
            role_code: null,
            turnover_target_month: targetMonth,
            turnover_target_week: targetWeek,
            shifts_target_month: shiftsMonth,
            shifts_target_week: shiftsWeek,
            meta: {
              basisMonths: [baseM1, baseM2],
              share: Number((share * 100).toFixed(2)),
              shareShifts: Number((shareSh * 100).toFixed(2)),
              source: 'auto',
            },
            is_locked: false,
          })
        }
      }

      // 3) роли (пока KPI от коллективного плана всех компаний)
      const totalCollectiveMonth = newRows
        .filter((x) => x.entity_type === 'collective')
        .reduce((s, x) => s + (x.turnover_target_month || 0), 0)

      const roleDefaults: Array<{ role: RoleCode; base: number }> = [
        { role: 'supervisor', base: 220000 }, // ты хотел 220к
        { role: 'marketing', base: 50000 },   // ты хотел 50к
      ]

      for (const rd of roleDefaults) {
        newRows.push({
          plan_key: planKey({
            monthStart: monthStartISO,
            entityType: 'role',
            roleCode: rd.role,
          }),
          month_start: monthStartISO,
          entity_type: 'role',
          company_code: null,
          operator_id: null,
          role_code: rd.role,
          turnover_target_month: totalCollectiveMonth,
          turnover_target_week: Math.round(totalCollectiveMonth / weeks),
          shifts_target_month: 0,
          shifts_target_week: 0,
          meta: {
            baseSalary: rd.base,
            // бонусы можно потом детализировать:
            bonusRules: [
              { pctFrom: 100, bonus: 0 },
              { pctFrom: 110, bonus: 50000 },
              { pctFrom: 120, bonus: 100000 },
            ],
            source: 'auto',
          },
          is_locked: false,
        })
      }

      // UPSERT
      const { error: upErr } = await supabase
        .from('kpi_plans')
        .upsert(
          newRows.map((p) => ({
            ...p,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'plan_key' },
        )

      if (upErr) throw upErr

      setSuccessMsg(`План сгенерирован для ${selectedMonth} из ${baseM1} + ${baseM2}`)
      await loadAll()
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка генерации плана')
    } finally {
      setGenerating(false)
    }
  }

  // ===== UI группировка =====
  const collectivePlans = plans.filter((p) => p.entity_type === 'collective')
  const operatorPlans = plans.filter((p) => p.entity_type === 'operator')
  const rolePlans = plans.filter((p) => p.entity_type === 'role')

  const totals = useMemo(() => {
    const totalMonth = collectivePlans.reduce((s, x) => s + (x.turnover_target_month || 0), 0)
    const totalWeek = collectivePlans.reduce((s, x) => s + (x.turnover_target_week || 0), 0)
    const shiftsMonth = collectivePlans.reduce((s, x) => s + (x.shifts_target_month || 0), 0)
    return { totalMonth, totalWeek, shiftsMonth }
  }, [collectivePlans])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/salary">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">KPI планы (коллектив + личные)</h1>
                <p className="text-xs text-muted-foreground">
                  Генерация плана: берём 2 месяца до выбранного месяца и строим план по выручке/сменам.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <span className="text-[11px] text-muted-foreground">Месяц:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>

              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <span className="text-[11px] text-muted-foreground">Рост %:</span>
                <input
                  type="number"
                  value={growthPct}
                  min={0}
                  max={50}
                  onChange={(e) => setGrowthPct(parseIntSafe(e.target.value))}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none w-[70px] text-right"
                />
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerate}
                disabled={generating}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                {generating ? 'Генерирую…' : 'Сгенерировать план'}
              </Button>

              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={savingAll || dirtyKeys.size === 0}
                className="gap-2"
              >
                <Save className="w-4 h-4" />
                {savingAll ? 'Сохраняю…' : `Сохранить (${dirtyKeys.size})`}
              </Button>
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/50 bg-red-950/40 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </Card>
          )}

          {successMsg && (
            <Card className="p-3 border border-emerald-500/40 bg-emerald-950/30 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {successMsg}
            </Card>
          )}

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Коллективный план (месяц)</p>
              <p className="text-2xl font-bold text-sky-300">{formatMoney(totals.totalMonth)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Неделя: {formatMoney(totals.totalWeek)}
              </p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Смены (коллектив)</p>
              <p className="text-2xl font-bold">{totals.shiftsMonth}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Строк планов</p>
              <p className="text-2xl font-bold">{plans.length}</p>
            </Card>
          </div>

          {/* Table */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 text-left px-2">Тип</th>
                  <th className="py-2 text-left px-2">Компания</th>
                  <th className="py-2 text-left px-2">Кто</th>
                  <th className="py-2 text-right px-2">План месяц</th>
                  <th className="py-2 text-right px-2">План неделя</th>
                  <th className="py-2 text-right px-2">Смены мес</th>
                  <th className="py-2 text-right px-2">Смены нед</th>
                  <th className="py-2 text-center px-2">Lock</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground text-xs">
                      Загрузка…
                    </td>
                  </tr>
                )}

                {!loading && plans.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground text-xs">
                      Нет планов на этот месяц. Нажми «Сгенерировать план».
                    </td>
                  </tr>
                )}

                {!loading &&
                  [...collectivePlans, ...operatorPlans, ...rolePlans].map((p) => {
                    const companyName =
                      p.company_code === 'arena'
                        ? 'F16 Arena'
                        : p.company_code === 'ramen'
                          ? 'F16 Ramen'
                          : p.company_code === 'extra'
                            ? 'F16 Extra'
                            : p.company_code || '—'

                    const who =
                      p.entity_type === 'operator'
                        ? (operatorById[p.operator_id || '']?.short_name ||
                            operatorById[p.operator_id || '']?.name ||
                            p.operator_id ||
                            '—')
                        : p.entity_type === 'role'
                          ? p.role_code === 'marketing'
                            ? 'Маркетолог'
                            : p.role_code === 'supervisor'
                              ? 'Руководитель операторов'
                              : p.role_code
                          : 'Коллектив'

                    const typeLabel =
                      p.entity_type === 'collective'
                        ? 'Коллектив'
                        : p.entity_type === 'operator'
                          ? 'Оператор'
                          : 'Роль'

                    return (
                      <tr key={p.plan_key} className="border-t border-border/40 hover:bg-white/5">
                        <td className="py-1.5 px-2">{typeLabel}</td>
                        <td className="py-1.5 px-2">{companyName}</td>
                        <td className="py-1.5 px-2 font-medium">{who}</td>

                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            disabled={p.is_locked}
                            value={p.turnover_target_month}
                            onChange={(e) =>
                              handlePlanChange(p.plan_key, 'turnover_target_month', e.target.value)
                            }
                            className="w-[140px] bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            disabled={p.is_locked}
                            value={p.turnover_target_week}
                            onChange={(e) =>
                              handlePlanChange(p.plan_key, 'turnover_target_week', e.target.value)
                            }
                            className="w-[140px] bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            disabled={p.is_locked}
                            value={p.shifts_target_month}
                            onChange={(e) =>
                              handlePlanChange(p.plan_key, 'shifts_target_month', e.target.value)
                            }
                            className="w-[90px] bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            disabled={p.is_locked}
                            value={p.shifts_target_week}
                            onChange={(e) =>
                              handlePlanChange(p.plan_key, 'shifts_target_week', e.target.value)
                            }
                            className="w-[90px] bg-input border border-border rounded px-2 py-1 text-right text-xs"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.is_locked}
                            onChange={(e) =>
                              handlePlanChange(p.plan_key, 'is_locked', e.target.checked)
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
