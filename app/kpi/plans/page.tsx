'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  Save,
  RefreshCcw,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
} from 'lucide-react'

type CompanyRow = { id: string; code: string; name: string }
type OperatorRow = { id: string; name: string; company_id: string | null }

type IncomeRow = {
  date: string
  company_id: string | null
  operator_id: string | null
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

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

const money = (v: number) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const num = (v: any) => {
  const n = Number(String(v ?? '').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : 0
}

function monthStartISO(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}
function parseMonthStart(iso: string) {
  // iso: YYYY-MM-01
  const [y, m] = iso.split('-').map((x) => Number(x))
  return new Date(y, (m || 1) - 1, 1)
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}
function monthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
function safeCompanyCode(code: any) {
  const c = String(code || '').toLowerCase().trim()
  return c || null
}
function buildPlanKey(p: {
  month_start: string
  entity_type: string
  company_code?: string | null
  operator_id?: string | null
  role_code?: string | null
}) {
  return [
    p.month_start,
    p.entity_type,
    p.company_code ?? '',
    p.operator_id ?? '',
    p.role_code ?? '',
  ].join('|')
}

// Holt (двойное экспоненциальное сглаживание) — простая, но годная штука
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

export default function KPIPlansPage() {
  const now = new Date()

  // По умолчанию: план на следующий месяц (если сейчас декабрь — план на январь)
  const defaultTarget = monthStartISO(addMonths(new Date(now.getFullYear(), now.getMonth(), 1), 1))

  const [monthStart, setMonthStart] = useState<string>(defaultTarget)
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [rows, setRows] = useState<KPIPlanRow[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const companyById = useMemo(() => {
    const m = new Map<string, CompanyRow>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const operatorById = useMemo(() => {
    const m = new Map<string, OperatorRow>()
    for (const o of operators) m.set(o.id, o)
    return m
  }, [operators])

  const loadBase = async () => {
    setError(null)
    setOk(null)
    setLoading(true)

    const [{ data: cData, error: cErr }, { data: oData, error: oErr }] =
      await Promise.all([
        supabase.from('companies').select('id,code,name').order('name', { ascending: true }),
        supabase.from('operators').select('id,name,company_id').order('name', { ascending: true }),
      ])

    if (cErr) {
      console.error(cErr)
      setError('Ошибка загрузки companies')
      setLoading(false)
      return
    }
    if (oErr) {
      console.error(oErr)
      setError('Ошибка загрузки operators')
      setLoading(false)
      return
    }

    setCompanies((cData || []) as any)
    setOperators((oData || []) as any)

    setLoading(false)
  }

  const loadPlansFromDb = async () => {
    setError(null)
    setOk(null)
    setLoading(true)

    const { data, error } = await supabase
      .from('kpi_plans')
      .select(
        'plan_key, month_start, entity_type, company_code, operator_id, role_code, turnover_target_month, turnover_target_week, shifts_target_month, shifts_target_week, meta, is_locked',
      )
      .eq('month_start', monthStart)
      .order('entity_type', { ascending: true })
      .order('company_code', { ascending: true })

    if (error) {
      console.error(error)
      setError('Ошибка загрузки kpi_plans')
      setLoading(false)
      return
    }

    setRows((data || []) as any)
    setLoading(false)
  }

  useEffect(() => {
    loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (companies.length === 0) return
    loadPlansFromDb()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart, companies.length])

  const handleChange = (plan_key: string, field: keyof KPIPlanRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.plan_key !== plan_key) return r
        if (r.is_locked && field !== 'is_locked') return r
        return { ...r, [field]: value }
      }),
    )
  }

  // ---------- generator ----------
  const generatePlans = async () => {
    setError(null)
    setOk(null)
    setLoading(true)

    const target = parseMonthStart(monthStart)
    const prev1 = addMonths(target, -1) // декабрь
    const prev2 = addMonths(target, -2) // ноябрь

    const fromISO = monthStartISO(prev2) // 1 ноября
    const toISO = new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0) // конец декабря
    const toISOstr = `${toISO.getFullYear()}-${String(toISO.getMonth() + 1).padStart(2, '0')}-${String(toISO.getDate()).padStart(2,'0')}`

    // грузим incomes за 2 месяца
    const { data: inc, error: incErr } = await supabase
      .from('incomes')
      .select('date, company_id, operator_id, shift, cash_amount, kaspi_amount, card_amount')
      .gte('date', fromISO)
      .lte('date', toISOstr)

    if (incErr) {
      console.error(incErr)
      setError('Ошибка загрузки incomes для генерации')
      setLoading(false)
      return
    }

    const incomes = (inc || []) as IncomeRow[]

    const prev1Key = monthKey(prev1)
    const prev2Key = monthKey(prev2)

    const isPrev1CurrentMonth =
      prev1.getFullYear() === now.getFullYear() && prev1.getMonth() === now.getMonth()

    const scalePrev1 =
      isPrev1CurrentMonth ? daysInMonth(prev1) / Math.max(1, now.getDate()) : 1

    // агрегаты: month -> company_code -> turnover, shifts
    const compTurn = new Map<string, Record<string, number>>()
    const compShifts = new Map<string, Record<string, number>>()

    // month -> company_code -> operator_id -> turnover, shifts
    const opTurn = new Map<string, Record<string, Record<string, number>>>()
    const opShifts = new Map<string, Record<string, Record<string, number>>>()

    const add = (
      map: any,
      mKey: string,
      company: string,
      value: number,
      opId?: string | null,
    ) => {
      if (!map.has(mKey)) map.set(mKey, {})
      const a = map.get(mKey)
      if (!a[company]) a[company] = opId ? {} : 0
      if (opId) {
        if (!a[company][opId]) a[company][opId] = 0
        a[company][opId] += value
      } else {
        a[company] += value
      }
      map.set(mKey, a)
    }

    for (const r of incomes) {
      if (!r.date || !r.company_id) continue
      const c = companyById.get(r.company_id)
      const code = safeCompanyCode(c?.code)
      if (!code) continue

      const mKey = r.date.slice(0, 7)
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0)

      if (total > 0) add(compTurn, mKey, code, total)
      add(compShifts, mKey, code, 1) // считаем запись как смену

      if (r.operator_id) {
        if (total > 0) add(opTurn, mKey, code, total, r.operator_id)
        add(opShifts, mKey, code, 1, r.operator_id)
      }
    }

    const getComp = (map: Map<string, any>, mKey: string, code: string) =>
      Number(map.get(mKey)?.[code] || 0)

    const getOp = (map: Map<string, any>, mKey: string, code: string) =>
      (map.get(mKey)?.[code] as Record<string, number>) || {}

    // компании, которые реально существуют
    const companyCodes = companies
      .map((c) => safeCompanyCode(c.code))
      .filter(Boolean) as string[]

    // прогноз по компаниям
    const forecastByCompany: Record<string, number> = {}
    const shiftsByCompany: Record<string, number> = {}

    for (const code of companyCodes) {
      const v2 = getComp(compTurn, prev2Key, code)
      const v1raw = getComp(compTurn, prev1Key, code)
      const v1 = v1raw * scalePrev1

      forecastByCompany[code] = holtForecastNext([v2, v1])

      const s2 = getComp(compShifts, prev2Key, code)
      const s1raw = getComp(compShifts, prev1Key, code)
      const s1 = s1raw * scalePrev1
      shiftsByCompany[code] = Math.max(0, Math.round(holtForecastNext([s2, s1])))
    }

    const totalForecastAll =
      Object.values(forecastByCompany).reduce((a, b) => a + b, 0) || 0

    // собираем строки
    const gen: KPIPlanRow[] = []

    const addRow = (r: Omit<KPIPlanRow, 'plan_key'>) => {
      const plan_key = buildPlanKey({
        month_start: r.month_start,
        entity_type: r.entity_type,
        company_code: r.company_code,
        operator_id: r.operator_id,
        role_code: r.role_code,
      })
      gen.push({ ...r, plan_key })
    }

    // 1) коллектив по компаниям
    for (const code of companyCodes) {
      const m = Math.round(forecastByCompany[code] || 0)
      const w = Math.round(m / 4.345)
      const sm = Math.round(shiftsByCompany[code] || 0)
      const sw = Number((sm / 4.345).toFixed(2))

      addRow({
        month_start: monthStart,
        entity_type: 'collective',
        company_code: code,
        operator_id: null,
        role_code: null,
        turnover_target_month: m,
        turnover_target_week: w,
        shifts_target_month: sm,
        shifts_target_week: sw,
        meta: {
          source_months: [prev2Key, prev1Key],
          prev1_scaled: scalePrev1,
        },
        is_locked: false,
      })

      // 2) операторы по доле выручки в истории (2 месяца)
      const op2 = getOp(opTurn, prev2Key, code)
      const op1raw = getOp(opTurn, prev1Key, code)

      // объединяем суммы за 2 месяца (для декаб — масштабируем)
      const merged: Record<string, number> = {}

      for (const [k, v] of Object.entries(op2)) merged[k] = (merged[k] || 0) + v
      for (const [k, v] of Object.entries(op1raw)) merged[k] = (merged[k] || 0) + v * scalePrev1

      const totalHist = Object.values(merged).reduce((a, b) => a + b, 0)

      // если вдруг в истории нет операторов — пропускаем
      if (totalHist > 0) {
        for (const [opId, histVal] of Object.entries(merged)) {
          const share = histVal / totalHist
          const opMonth = Math.round(m * share)
          const opWeek = Math.round(opMonth / 4.345)

          // shifts по операторам — также по доле (быстро и честно)
          const opSm = Math.max(0, Math.round(sm * share))
          const opSw = Number((opSm / 4.345).toFixed(2))

          addRow({
            month_start: monthStart,
            entity_type: 'operator',
            company_code: code,
            operator_id: opId,
            role_code: null,
            turnover_target_month: opMonth,
            turnover_target_week: opWeek,
            shifts_target_month: opSm,
            shifts_target_week: opSw,
            meta: { share, hist_val: Math.round(histVal) },
            is_locked: false,
          })
        }
      }
    }

    // 3) роли (руководитель + маркетолог) — от общего плана
    const roleMonth = Math.round(totalForecastAll)
    const roleWeek = Math.round(roleMonth / 4.345)

    addRow({
      month_start: monthStart,
      entity_type: 'role',
      company_code: null,
      operator_id: null,
      role_code: 'supervisor',
      turnover_target_month: roleMonth,
      turnover_target_week: roleWeek,
      shifts_target_month: 0,
      shifts_target_week: 0,
      meta: { note: 'Руководитель отвечает за выполнение общего плана' },
      is_locked: false,
    })
    addRow({
      month_start: monthStart,
      entity_type: 'role',
      company_code: null,
      operator_id: null,
      role_code: 'marketing',
      turnover_target_month: roleMonth,
      turnover_target_week: roleWeek,
      shifts_target_month: 0,
      shifts_target_week: 0,
      meta: { note: 'Маркетинг влияет на общий план' },
      is_locked: false,
    })

    setRows(gen)
    setOk('План сгенерирован (на основе incomes)')
    setLoading(false)
  }

  const saveAll = async () => {
    setError(null)
    setOk(null)
    setSaving(true)

    const payload = rows.map((r) => ({
      plan_key: r.plan_key,
      month_start: r.month_start,
      entity_type: r.entity_type,
      company_code: r.company_code,
      operator_id: r.operator_id,
      role_code: r.role_code,
      turnover_target_month: Number(r.turnover_target_month || 0),
      turnover_target_week: Number(r.turnover_target_week || 0),
      shifts_target_month: Number(r.shifts_target_month || 0),
      shifts_target_week: Number(r.shifts_target_week || 0),
      meta: r.meta ?? null,
      is_locked: !!r.is_locked,
    }))

    const { error } = await supabase
      .from('kpi_plans')
      .upsert(payload, { onConflict: 'plan_key' })

    setSaving(false)

    if (error) {
      console.error(error)
      setError('Ошибка сохранения kpi_plans')
      return
    }

    setOk('Сохранено')
    await loadPlansFromDb()
  }

  const totals = useMemo(() => {
    const collective = rows.filter((r) => r.entity_type === 'collective')
    const sumMonth = collective.reduce((a, b) => a + Number(b.turnover_target_month || 0), 0)
    const sumWeek = collective.reduce((a, b) => a + Number(b.turnover_target_week || 0), 0)
    return { sumMonth, sumWeek, count: rows.length }
  }, [rows])

  const titleForRow = (r: KPIPlanRow) => {
    if (r.entity_type === 'collective') return 'Коллектив'
    if (r.entity_type === 'operator') return 'Оператор'
    return 'Роль'
  }

  const companyLabel = (code: string | null) => {
    if (!code) return '—'
    const c = companies.find((x) => x.code?.toLowerCase() === code.toLowerCase())
    return c ? `${c.name} (${code})` : code
  }

  const whoLabel = (r: KPIPlanRow) => {
    if (r.entity_type === 'operator') {
      const op = r.operator_id ? operatorById.get(r.operator_id) : null
      return op?.name || (r.operator_id ? `ID: ${r.operator_id}` : '—')
    }
    if (r.entity_type === 'role') {
      if (r.role_code === 'supervisor') return 'Руководитель операторов'
      if (r.role_code === 'marketing') return 'Маркетолог'
      return r.role_code || '—'
    }
    return 'Коллектив'
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/kpi">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">KPI планы (нормальная версия)</h1>
                <p className="text-xs text-muted-foreground">
                  Генерация из <code>incomes</code> → сохранение в <code>kpi_plans</code>.
                  С декабрём работаем честно: если месяц не закрыт — прогнозируем.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadPlansFromDb} disabled={loading}>
                <RefreshCcw className="w-4 h-4 mr-2" /> Обновить
              </Button>
              <Button size="sm" onClick={generatePlans} disabled={loading}>
                <Wand2 className="w-4 h-4 mr-2" /> Сгенерировать
              </Button>
              <Button size="sm" onClick={saveAll} disabled={saving || loading || rows.length === 0}>
                <Save className="w-4 h-4 mr-2" /> {saving ? 'Сохраняю…' : 'Сохранить'}
              </Button>
            </div>
          </div>

          {/* Month picker */}
          <Card className="p-4 border-border bg-card/70 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">Месяц плана</div>
              <div className="font-semibold">{monthStart}</div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Выбрать:</label>
              <input
                type="month"
                className="bg-input border border-border rounded px-2 py-1 text-sm"
                value={monthStart.slice(0, 7)}
                onChange={(e) => setMonthStart(`${e.target.value}-01`)}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Коллектив (месяц): <b className="text-foreground">{money(totals.sumMonth)}</b> ·
              Недельный: <b className="text-foreground">{money(totals.sumWeek)}</b> ·
              Строк: <b className="text-foreground">{totals.count}</b>
            </div>
          </Card>

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

          {/* Table */}
          <Card className="p-0 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Тип</th>
                  <th className="px-3 py-2 text-left">Компания</th>
                  <th className="px-3 py-2 text-left">Кто</th>
                  <th className="px-3 py-2 text-right">План месяц</th>
                  <th className="px-3 py-2 text-right">План неделя</th>
                  <th className="px-3 py-2 text-right">Смены/мес</th>
                  <th className="px-3 py-2 text-right">Смены/нед</th>
                  <th className="px-3 py-2 text-center">Lock</th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      На этот месяц планов нет. Нажми «Сгенерировать».
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((r) => (
                    <tr
                      key={r.plan_key}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      <td className="px-3 py-2">{titleForRow(r)}</td>
                      <td className="px-3 py-2">{companyLabel(r.company_code)}</td>
                      <td className="px-3 py-2">{whoLabel(r)}</td>

                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-40"
                          value={r.turnover_target_month ?? 0}
                          disabled={r.is_locked}
                          onChange={(e) =>
                            handleChange(r.plan_key, 'turnover_target_month', num(e.target.value))
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {money(r.turnover_target_month)}
                        </div>
                      </td>

                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-40"
                          value={r.turnover_target_week ?? 0}
                          disabled={r.is_locked}
                          onChange={(e) =>
                            handleChange(r.plan_key, 'turnover_target_week', num(e.target.value))
                          }
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {money(r.turnover_target_week)}
                        </div>
                      </td>

                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-24"
                          value={r.shifts_target_month ?? 0}
                          disabled={r.is_locked}
                          onChange={(e) =>
                            handleChange(r.plan_key, 'shifts_target_month', num(e.target.value))
                          }
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="bg-input border border-border rounded px-2 py-1 text-right text-xs w-24"
                          value={r.shifts_target_week ?? 0}
                          disabled={r.is_locked}
                          onChange={(e) =>
                            handleChange(r.plan_key, 'shifts_target_week', num(e.target.value))
                          }
                        />
                      </td>

                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleChange(r.plan_key, 'is_locked', !r.is_locked)}
                        >
                          {r.is_locked ? (
                            <Lock className="w-4 h-4" />
                          ) : (
                            <Unlock className="w-4 h-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4 border-border bg-card/70 text-xs text-muted-foreground">
            <b className="text-foreground">Почему декабрь может быть меньше ноября?</b> Потому что декабрь часто
            не закрыт (MTD). Здесь мы масштабируем декабрь по дням и прогнозируем закрытие месяца —
            чтобы план на январь не строился на “половине месяца”.
          </Card>
        </div>
      </main>
    </div>
  )
}
