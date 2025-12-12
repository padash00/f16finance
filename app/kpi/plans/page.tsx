'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Plus, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'

type Company = { id: string; name: string; code: string | null }
type Operator = { id: string; name: string; short_name: string | null; is_active: boolean }

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
  id: number
  period_start: string
  period_type: string // 'month'
  company_code: string | null
  shift_type: string | null
  owner_role: string // 'collective' | 'operator' | 'supervisor' | 'marketing'
  owner_id: string | null

  turnover_target_month: number
  turnover_target_week: number
  shifts_target_month: number
  shifts_target_week: number

  meta: any | null
  is_locked: boolean
}

const ROLE_LABELS: Record<string, string> = {
  collective: 'Коллектив',
  operator: 'Оператор',
  supervisor: 'Руководитель операторов',
  marketing: 'Маркетолог',
}

const COMPANY_LABELS: Record<string, string> = {
  arena: 'F16 Arena',
  ramen: 'F16 Ramen',
  extra: 'F16 Extra',
}

const fmtMoney = (v: number) => (v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
const fmtNum = (v: number) => (Number.isFinite(v) ? v.toLocaleString('ru-RU') : '0')

function monthStartISO(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}
function addMonthsISO(isoMonthStart: string, delta: number) {
  const d = new Date(isoMonthStart + 'T00:00:00')
  d.setMonth(d.getMonth() + delta)
  return monthStartISO(d)
}
function daysInMonth(isoMonthStart: string) {
  const d = new Date(isoMonthStart + 'T00:00:00')
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

export default function KPIPlansPage() {
  const now = new Date()
  const [periodStart, setPeriodStart] = useState(monthStartISO(now))
  const [growthPct, setGrowthPct] = useState(5)

  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [plans, setPlans] = useState<KpiPlanRow[]>([])

  const [loading, setLoading] = useState(true)
  const [busyGen, setBusyGen] = useState(false)
  const [busySave, setBusySave] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const companyById = useMemo(() => {
    const m: Record<string, Company> = {}
    companies.forEach(c => (m[c.id] = c))
    return m
  }, [companies])

  const operatorLabelById = useMemo(() => {
    const m: Record<string, string> = {}
    operators.forEach(o => (m[o.id] = o.short_name || o.name))
    return m
  }, [operators])

  const reload = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    const [cRes, oRes, pRes] = await Promise.all([
      supabase.from('companies').select('id,name,code'),
      supabase.from('operators').select('id,name,short_name,is_active'),
      supabase
        .from('kpi_plans')
        .select(
          'id,period_start,period_type,company_code,shift_type,owner_role,owner_id,turnover_target_month,turnover_target_week,shifts_target_month,shifts_target_week,meta,is_locked',
        )
        .eq('period_start', periodStart)
        .eq('period_type', 'month')
        .order('owner_role', { ascending: true })
        .order('company_code', { ascending: true }),
    ])

    if (cRes.error || oRes.error || pRes.error) {
      console.error(cRes.error, oRes.error, pRes.error)
      setError('Ошибка загрузки KPI планов')
      setLoading(false)
      return
    }

    setCompanies((cRes.data || []) as Company[])
    setOperators((oRes.data || []) as Operator[])
    setPlans((pRes.data || []) as KpiPlanRow[])
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStart])

  // ===== генерация плана из 2 предыдущих месяцев =====

  const handleGenerate = async () => {
    setError(null)
    setSuccess(null)
    setBusyGen(true)

    try {
      const m1 = addMonthsISO(periodStart, -1)
      const m2 = addMonthsISO(periodStart, -2)
      const rangeFrom = m2
      const rangeTo = periodStart // не включительно

      const incRes = await supabase
        .from('incomes')
        .select('date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id')
        .gte('date', rangeFrom)
        .lt('date', rangeTo)

      if (incRes.error) throw incRes.error
      const incomes = (incRes.data || []) as IncomeRow[]

      // Агрегация: оборот + смены (смена = оператор+компания+дата+shift)
      type Agg = { turnover: number; shiftsSet: Set<string> }
      const aggCompanyMonth = new Map<string, Agg>() // key: companyCode|month
      const aggOpMonth = new Map<string, Agg>() // key: operatorId|companyCode|month

      const getAgg = (map: Map<string, Agg>, key: string) => {
        let a = map.get(key)
        if (!a) {
          a = { turnover: 0, shiftsSet: new Set() }
          map.set(key, a)
        }
        return a
      }

      for (const r of incomes) {
        const comp = companyById[r.company_id]
        const code = comp?.code || null
        if (!code || !['arena', 'ramen', 'extra'].includes(code)) continue

        const monthKey = r.date.slice(0, 7) + '-01'
        const shift = r.shift === 'night' ? 'night' : 'day'

        const turnover =
          Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)

        const shiftKey = `${r.operator_id || 'no'}|${code}|${r.date}|${shift}`

        const cAgg = getAgg(aggCompanyMonth, `${code}|${monthKey}`)
        cAgg.turnover += turnover
        cAgg.shiftsSet.add(shiftKey)

        if (r.operator_id) {
          const oAgg = getAgg(aggOpMonth, `${r.operator_id}|${code}|${monthKey}`)
          oAgg.turnover += turnover
          oAgg.shiftsSet.add(shiftKey)
        }
      }

      const factor = 1 + Number(growthPct || 0) / 100
      const weeks = daysInMonth(periodStart) / 7

      const avg2 = (a: number, b: number) => (a + b) / 2

      const getMonthValCompany = (code: string, month: string) => {
        const a = aggCompanyMonth.get(`${code}|${month}`)
        return { turnover: a?.turnover || 0, shifts: a?.shiftsSet.size || 0 }
      }
      const getMonthValOp = (opId: string, code: string, month: string) => {
        const a = aggOpMonth.get(`${opId}|${code}|${month}`)
        return { turnover: a?.turnover || 0, shifts: a?.shiftsSet.size || 0 }
      }

      // 1) Коллектив по компаниям
      const rows: Omit<KpiPlanRow, 'id'>[] = []
      let totalTurnoverMonth = 0

      for (const code of ['arena', 'ramen', 'extra']) {
        const a = getMonthValCompany(code, m2)
        const b = getMonthValCompany(code, m1)

        const baseTurnover = avg2(a.turnover, b.turnover)
        const baseShifts = avg2(a.shifts, b.shifts)

        const tMonth = Math.round(baseTurnover * factor)
        const sMonth = Math.round(baseShifts * factor)

        totalTurnoverMonth += tMonth

        rows.push({
          period_start: periodStart,
          period_type: 'month',
          company_code: code,
          shift_type: null,
          owner_role: 'collective',
          owner_id: null,
          turnover_target_month: tMonth,
          turnover_target_week: Math.round(tMonth / weeks),
          shifts_target_month: sMonth,
          shifts_target_week: Number((sMonth / weeks).toFixed(2)),
          meta: { baseline: { m2, m1 }, growthPct },
          is_locked: false,
        })
      }

      // 2) Личные по операторам (по компаниям)
      const activeOps = operators.filter(o => o.is_active)
      for (const op of activeOps) {
        for (const code of ['arena', 'ramen', 'extra']) {
          const a = getMonthValOp(op.id, code, m2)
          const b = getMonthValOp(op.id, code, m1)

          const baseTurnover = avg2(a.turnover, b.turnover)
          const baseShifts = avg2(a.shifts, b.shifts)

          if (baseTurnover <= 0 && baseShifts <= 0) continue

          const tMonth = Math.round(baseTurnover * factor)
          const sMonth = Math.round(baseShifts * factor)

          rows.push({
            period_start: periodStart,
            period_type: 'month',
            company_code: code,
            shift_type: null,
            owner_role: 'operator',
            owner_id: op.id,
            turnover_target_month: tMonth,
            turnover_target_week: Math.round(tMonth / weeks),
            shifts_target_month: sMonth,
            shifts_target_week: Number((sMonth / weeks).toFixed(2)),
            meta: { baseline: { m2, m1 }, growthPct },
            is_locked: false,
          })
        }
      }

      // 3) Роли (руководитель/маркетолог) = общий план
      for (const role of ['supervisor', 'marketing']) {
        rows.push({
          period_start: periodStart,
          period_type: 'month',
          company_code: null,
          shift_type: null,
          owner_role: role,
          owner_id: null,
          turnover_target_month: totalTurnoverMonth,
          turnover_target_week: Math.round(totalTurnoverMonth / weeks),
          shifts_target_month: 0,
          shifts_target_week: 0,
          meta: { note: 'Отвечает за выполнение коллективного плана', baseline: { m2, m1 }, growthPct },
          is_locked: false,
        })
      }

      // удаляем только НЕ locked (чтобы “замороженные” планы не затирались)
      const delRes = await supabase
        .from('kpi_plans')
        .delete()
        .eq('period_start', periodStart)
        .eq('period_type', 'month')
        .eq('is_locked', false)

      if (delRes.error) throw delRes.error

      const insRes = await supabase.from('kpi_plans').insert(rows).select()
      if (insRes.error) throw insRes.error

      setSuccess(`План сгенерирован: ${rows.length} строк`)
      await reload()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Ошибка генерации')
    } finally {
      setBusyGen(false)
    }
  }

  // ===== редактирование + сохранение =====

  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())

  const markDirty = (id: number) => {
    setDirtyIds(prev => {
      const n = new Set(prev)
      n.add(id)
      return n
    })
  }

  const updateField = (id: number, field: keyof KpiPlanRow, value: any) => {
    setPlans(prev => prev.map(p => (p.id === id ? ({ ...p, [field]: value } as KpiPlanRow) : p)))
    markDirty(id)
  }

  const handleSave = async () => {
    setError(null)
    setSuccess(null)
    setBusySave(true)
    try {
      const ids = Array.from(dirtyIds)
      for (const id of ids) {
        const row = plans.find(p => p.id === id)
        if (!row) continue

        const payload = {
          turnover_target_month: Number(row.turnover_target_month || 0),
          turnover_target_week: Number(row.turnover_target_week || 0),
          shifts_target_month: Number(row.shifts_target_month || 0),
          shifts_target_week: Number(row.shifts_target_week || 0),
          is_locked: !!row.is_locked,
          meta: row.meta || null,
        }

        const { error } = await supabase.from('kpi_plans').update(payload).eq('id', id)
        if (error) throw error
      }

      setDirtyIds(new Set())
      setSuccess('Сохранено')
      await reload()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setBusySave(false)
    }
  }

  // ===== UI helpers =====

  const rowsSorted = useMemo(() => {
    const rank: Record<string, number> = { collective: 0, operator: 1, supervisor: 2, marketing: 3 }
    return [...plans].sort((a, b) => {
      const ra = rank[a.owner_role] ?? 99
      const rb = rank[b.owner_role] ?? 99
      if (ra !== rb) return ra - rb
      const ca = a.company_code || ''
      const cb = b.company_code || ''
      if (ca !== cb) return ca.localeCompare(cb, 'ru')
      const na = a.owner_id ? (operatorLabelById[a.owner_id] || '') : ''
      const nb = b.owner_id ? (operatorLabelById[b.owner_id] || '') : ''
      return na.localeCompare(nb, 'ru')
    })
  }, [plans, operatorLabelById])

  const totals = useMemo(() => {
    const collective = rowsSorted.filter(r => r.owner_role === 'collective')
    const turnover = collective.reduce((s, r) => s + Number(r.turnover_target_month || 0), 0)
    const shifts = collective.reduce((s, r) => s + Number(r.shifts_target_month || 0), 0)
    return { turnover, shifts, rows: rowsSorted.length }
  }, [rowsSorted])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">KPI планы (коллектив + личные)</h1>
                <p className="text-xs text-muted-foreground">
                  Генерация берёт 2 предыдущих месяца от выбранного месяца и строит план по выручке/сменам.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <span className="text-xs text-muted-foreground">Месяц</span>
                <input
                  type="month"
                  value={periodStart.slice(0, 7)}
                  onChange={(e) => setPeriodStart(e.target.value + '-01')}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>

              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <span className="text-xs text-muted-foreground">Рост %</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={growthPct}
                  onChange={(e) => setGrowthPct(Number(e.target.value || 0))}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none w-16 text-right"
                />
              </div>

              <Button onClick={handleGenerate} disabled={busyGen} className="gap-2">
                <Plus className="w-4 h-4" />
                {busyGen ? 'Генерирую…' : 'Сгенерировать план'}
              </Button>

              <Button onClick={handleSave} disabled={busySave || dirtyIds.size === 0} className="gap-2" variant="outline">
                <Save className="w-4 h-4" />
                {busySave ? 'Сохраняю…' : `Сохранить (${dirtyIds.size})`}
              </Button>
            </div>
          </div>

          {error && (
            <Card className="p-3 border border-red-500/50 bg-red-950/40 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </Card>
          )}
          {success && (
            <Card className="p-3 border border-emerald-500/40 bg-emerald-950/30 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {success}
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Коллективный план (месяц)</p>
              <p className="text-2xl font-bold text-sky-400">{fmtMoney(totals.turnover)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Строк планов: {totals.rows}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Смены (коллектив)</p>
              <p className="text-2xl font-bold">{fmtNum(totals.shifts)}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Дней в месяце</p>
              <p className="text-2xl font-bold">{daysInMonth(periodStart)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Недели ≈ {(daysInMonth(periodStart) / 7).toFixed(2)}
              </p>
            </Card>
          </div>

          <Card className="p-0 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Тип</th>
                  <th className="px-3 py-2 text-left">Компания</th>
                  <th className="px-3 py-2 text-left">Кто</th>
                  <th className="px-3 py-2 text-right">План месяц</th>
                  <th className="px-3 py-2 text-right">План неделя</th>
                  <th className="px-3 py-2 text-right">Смены мес</th>
                  <th className="px-3 py-2 text-right">Смены нед</th>
                  <th className="px-3 py-2 text-center">LOCK</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}

                {!loading && rowsSorted.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      Планов нет. Нажми “Сгенерировать план”.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rowsSorted.map((r) => {
                    const who =
                      r.owner_role === 'operator'
                        ? (r.owner_id ? (operatorLabelById[r.owner_id] || 'Оператор') : 'Оператор')
                        : (ROLE_LABELS[r.owner_role] || r.owner_role)

                    const comp = r.company_code ? (COMPANY_LABELS[r.company_code] || r.company_code) : '—'

                    return (
                      <tr key={r.id} className="border-t border-border/40 hover:bg-white/5">
                        <td className="px-3 py-2 font-medium">{ROLE_LABELS[r.owner_role] || r.owner_role}</td>
                        <td className="px-3 py-2">{comp}</td>
                        <td className="px-3 py-2">{who}</td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-40"
                            value={r.turnover_target_month ?? 0}
                            onChange={(e) => updateField(r.id, 'turnover_target_month', Number(e.target.value || 0))}
                          />
                          <div className="text-[10px] text-muted-foreground">{fmtMoney(Number(r.turnover_target_month || 0))}</div>
                        </td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-32"
                            value={r.turnover_target_week ?? 0}
                            onChange={(e) => updateField(r.id, 'turnover_target_week', Number(e.target.value || 0))}
                          />
                          <div className="text-[10px] text-muted-foreground">{fmtMoney(Number(r.turnover_target_week || 0))}</div>
                        </td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-20"
                            value={r.shifts_target_month ?? 0}
                            onChange={(e) => updateField(r.id, 'shifts_target_month', Number(e.target.value || 0))}
                          />
                        </td>

                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-20"
                            value={r.shifts_target_week ?? 0}
                            onChange={(e) => updateField(r.id, 'shifts_target_week', Number(e.target.value || 0))}
                          />
                        </td>

                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={!!r.is_locked}
                            onChange={(e) => updateField(r.id, 'is_locked', e.target.checked)}
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
