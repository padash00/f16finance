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
  Users2,
  CalendarDays,
} from 'lucide-react'

// --- UTILS ---

const money = (v: number) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

function getMonthKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function getForecastDates(targetMonthStart: string) {
  const target = new Date(targetMonthStart)
  const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1) // N-1
  const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1) // N-2

  const startStr = `${getMonthKey(prev2)}-01`

  const endOfPrev1 = new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)
  const endStr = `${endOfPrev1.getFullYear()}-${String(endOfPrev1.getMonth() + 1).padStart(2, '0')}-${String(
    endOfPrev1.getDate()
  ).padStart(2, '0')}`

  return { target, prev1, prev2, fetchStart: startStr, fetchEnd: endStr }
}

type TeamCode = 'wk' | 'we' | 'all'
const TEAM_LABEL: Record<TeamCode, string> = {
  wk: 'Команда A (Пн–Чт)',
  we: 'Команда B (Пт–Вс)',
  all: 'Без команды',
}

// безопасно получаем день недели без UTC-сдвигов
function getDayOfWeekLocal(dateStr: string) {
  // dateStr обычно "YYYY-MM-DD"
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  return d.getDay() // 0=Вс ... 6=Сб
}

function teamFromDate(dateStr: string): TeamCode {
  const dow = getDayOfWeekLocal(dateStr)
  // Пн(1)-Чт(4) => wk, Пт(5)-Вс(0)-Сб(6) => we
  if (dow >= 1 && dow <= 4) return 'wk'
  return 'we'
}

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

// --- LOGIC HOOK ---

function useKpiManager(monthStart: string) {
  const [rows, setRows] = useState<KpiRow[]>([])
  const [operatorNames, setOperatorNames] = useState<OperatorMap>({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

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
      setStatus({ type: 'error', msg: 'Ошибка загрузки' })
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

      const k1 = getMonthKey(prev1) // N-1
      const k2 = getMonthKey(prev2) // N-2

      type OpAgg = Record<string, { t: number; s: number }>
      type Agg = { t2: number; t1: number; s2: number; s1: number; ops: OpAgg }

      // stats[company][team] = Agg
      const stats: Record<string, Record<TeamCode, Agg>> = {}

      const now = new Date()
      const isPrev1Current = prev1.getMonth() === now.getMonth() && prev1.getFullYear() === now.getFullYear()
      const scaleWeight =
        isPrev1Current ? new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0).getDate() / Math.max(1, now.getDate()) : 1

      const ensure = (code: string, team: TeamCode) => {
        if (!stats[code]) stats[code] = { wk: { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} }, we: { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} }, all: { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} } }
        if (!stats[code][team]) stats[code][team] = { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} }
      }

      incomes?.forEach((inc: any) => {
        const code = String(inc.companies?.code || 'other').toLowerCase()
        const dateStr = String(inc.date).slice(0, 10)

        const amount = (inc.cash_amount || 0) + (inc.kaspi_amount || 0) + (inc.card_amount || 0)

        const mKey = dateStr.slice(0, 7)
        const isM1 = mKey === k1
        const isM2 = mKey === k2
        if (!isM1 && !isM2) return

        const team = teamFromDate(dateStr)
        ensure(code, team)

        if (isM2) {
          stats[code][team].t2 += amount
          stats[code][team].s2 += 1
        } else if (isM1) {
          stats[code][team].t1 += amount
          stats[code][team].s1 += 1
        }

        if (inc.operator_id) {
          if (!stats[code][team].ops[inc.operator_id]) stats[code][team].ops[inc.operator_id] = { t: 0, s: 0 }

          const w = isM1 ? amount * scaleWeight : amount
          stats[code][team].ops[inc.operator_id].t += w
          stats[code][team].ops[inc.operator_id].s += 1
        }
      })

      const newRows: KpiRow[] = []

      Object.entries(stats).forEach(([code, teams]) => {
        // 1) общий прогноз на компанию считаем суммой команд (чтобы Holt видел целостную картину)
        const compT1 = (teams.wk?.t1 || 0) + (teams.we?.t1 || 0)
        const compT2 = (teams.wk?.t2 || 0) + (teams.we?.t2 || 0)
        const compS1 = (teams.wk?.s1 || 0) + (teams.we?.s1 || 0)
        const compS2 = (teams.wk?.s2 || 0) + (teams.we?.s2 || 0)

        const turnCalcCompany = calculateForecast(target, compT1, compT2)
        const shiftsCalcCompany = calculateForecast(target, compS1, compS2)

        const companyTargetT = turnCalcCompany.forecast
        const companyTargetS = shiftsCalcCompany.forecast

        // 2) делим цель на команды по доле базы N-1 (оценка)
        const compScale = compT1 > 0 ? turnCalcCompany.prev1Estimated / compT1 : 1
        const wkPrev1Est = (teams.wk?.t1 || 0) * compScale
        const wePrev1Est = (teams.we?.t1 || 0) * compScale
        const denom = Math.max(1, wkPrev1Est + wePrev1Est)

        const wkShare = wkPrev1Est / denom
        const weShare = wePrev1Est / denom

        const teamTargets: Record<TeamCode, { t: number; s: number; prev1_est: number; prev2: number; prev1_raw: number; share: number }> = {
          wk: {
            t: Math.round(companyTargetT * wkShare),
            s: Math.round(companyTargetS * wkShare),
            prev1_est: wkPrev1Est,
            prev2: teams.wk?.t2 || 0,
            prev1_raw: teams.wk?.t1 || 0,
            share: wkShare,
          },
          we: {
            t: Math.round(companyTargetT * weShare),
            s: Math.round(companyTargetS * weShare),
            prev1_est: wePrev1Est,
            prev2: teams.we?.t2 || 0,
            prev1_raw: teams.we?.t1 || 0,
            share: weShare,
          },
          all: { t: 0, s: 0, prev1_est: 0, prev2: 0, prev1_raw: 0, share: 0 },
        }

        ;(['wk', 'we'] as TeamCode[]).forEach((team) => {
          const d = teams[team]
          if (!d) return

          const tTarget = teamTargets[team].t
          const sTarget = teamTargets[team].s

          // A) Team collective
          newRows.push({
            plan_key: `${monthStart}|collective|${code}|team:${team}`,
            month_start: monthStart,
            entity_type: 'collective',
            company_code: code,
            operator_id: null,
            role_code: null,
            turnover_target_month: tTarget,
            turnover_target_week: Math.round(tTarget / 4.345),
            shifts_target_month: sTarget,
            shifts_target_week: Number((sTarget / 4.345).toFixed(2)),
            meta: {
              team,
              team_label: TEAM_LABEL[team],
              prev2: teamTargets[team].prev2,
              prev1_raw: teamTargets[team].prev1_raw,
              prev1_est: Math.round(teamTargets[team].prev1_est),
              share: (teamTargets[team].share * 100).toFixed(1) + '%',
              company_prev1_est: Math.round(turnCalcCompany.prev1Estimated),
              company_target: Math.round(companyTargetT),
              company_trend: Number(turnCalcCompany.trend.toFixed(1)),
            },
            is_locked: false,
          })

          // B) Operators in team
          const totalOpWeight = Object.values(d.ops).reduce((acc, v) => acc + v.t, 0)
          Object.entries(d.ops).forEach(([opId, opData]) => {
            if (opData.t < 1000) return
            const share = totalOpWeight > 0 ? opData.t / totalOpWeight : 0
            const opTarget = Math.round(tTarget * share)
            const opShifts = Math.round(sTarget * share)

            newRows.push({
              plan_key: `${monthStart}|operator|${code}|${opId}|team:${team}`,
              month_start: monthStart,
              entity_type: 'operator',
              company_code: code,
              operator_id: opId,
              role_code: null,
              turnover_target_month: opTarget,
              turnover_target_week: Math.round(opTarget / 4.345),
              shifts_target_month: opShifts,
              shifts_target_week: Number((opShifts / 4.345).toFixed(2)),
              meta: {
                team,
                team_label: TEAM_LABEL[team],
                share: (share * 100).toFixed(1) + '%',
                hist_val: Math.round(opData.t),
              },
              is_locked: false,
            })
          })
        })
      })

      // C) Roles (global)
      const globalTotal = newRows
        .filter((r) => r.entity_type === 'collective')
        .reduce((sum, r) => sum + (r.turnover_target_month || 0), 0)

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
          meta: { note: 'Global total (sum of team collectives)' },
          is_locked: false,
        })
      })

      // сохраняем локи
      setRows((prev) => {
        const lockedMap = new Map(prev.filter((r) => r.is_locked).map((r) => [r.plan_key, r]))
        return newRows.map((newRow) => lockedMap.get(newRow.plan_key) || newRow)
      })

      setStatus({ type: 'success', msg: 'План пересчитан: команды (Пн–Чт / Пт–Вс) + доли операторов' })

      // имена
      const newOpIds = newRows.map((r) => r.operator_id).filter(Boolean) as string[]
      if (newOpIds.length) {
        const { data: names } = await supabase.from('operators').select('id, name').in('id', newOpIds)
        const map: OperatorMap = {}
        names?.forEach((n: any) => (map[n.id] = n.name))
        setOperatorNames((prev) => ({ ...prev, ...map }))
      }
    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e?.message || 'Ошибка генерации' })
    } finally {
      setLoading(false)
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

  return { rows, operatorNames, loading, status, load, generate, save, updateRow }
}

// --- UI COMPONENTS ---

const SmartInput = ({ value, meta, locked, onChange }: any) => {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        disabled={locked}
        value={money(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, '')))}
        className={`w-36 bg-transparent text-right border-b border-transparent hover:border-white/20 focus:border-indigo-500 outline-none transition-colors text-sm ${
          locked ? 'opacity-50 cursor-not-allowed text-zinc-500' : 'text-zinc-100'
        }`}
      />
      <div className="text-[10px] text-muted-foreground flex gap-2">
        {meta?.prev1_est && <span title="База N-1 (оценка)">База: {money(meta.prev1_est)}</span>}
        {meta?.share && <span title="Доля">Доля: {meta.share}</span>}
      </div>
    </div>
  )
}

function RowItem({ row, name, isMain, onChange }: any) {
  return (
    <tr className={`group hover:bg-white/[0.02] transition-colors ${isMain ? 'bg-indigo-500/5' : ''}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {isMain ? <TrendingUp className="w-4 h-4 text-indigo-400" /> : <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />}
          <span className={isMain ? 'font-medium text-indigo-100' : 'text-zinc-300'}>{name}</span>
        </div>
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
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          disabled={row.is_locked}
          value={row.shifts_target_month}
          onChange={(e) => onChange(row.plan_key, { shifts_target_month: Number(e.target.value) })}
          className={`w-16 bg-transparent text-right border-b border-transparent focus:border-white/20 outline-none ${
            row.is_locked ? 'text-zinc-500' : 'text-zinc-400'
          }`}
        />
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

// --- MAIN PAGE ---

export default function KPIPlansPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7) + '-01'
  })

  const { rows, operatorNames, loading, status, load, generate, save, updateRow } = useKpiManager(month)

  useEffect(() => {
    load()
  }, [load])

  const grouped = useMemo(() => {
    const byCompany: Record<string, { byTeam: Record<TeamCode, KpiRow[]> }> = {}
    const roles: KpiRow[] = []

    rows.forEach((r) => {
      if (r.entity_type === 'role') {
        roles.push(r)
        return
      }
      const code = r.company_code || 'unknown'
      const team = (r.meta?.team as TeamCode) || 'all'

      if (!byCompany[code]) byCompany[code] = { byTeam: { wk: [], we: [], all: [] } }
      if (!byCompany[code].byTeam[team]) byCompany[code].byTeam[team] = []
      byCompany[code].byTeam[team].push(r)
    })

    // сортировка внутри
    Object.values(byCompany).forEach((c) => {
      ;(['wk', 'we', 'all'] as TeamCode[]).forEach((t) => {
        c.byTeam[t] = c.byTeam[t].sort((a, b) => {
          if (a.entity_type === b.entity_type) return (b.turnover_target_month || 0) - (a.turnover_target_month || 0)
          return a.entity_type === 'collective' ? -1 : 1
        })
      })
    })

    return { byCompany, roles }
  }, [rows])

  const totals = useMemo(() => {
    return rows
      .filter((r) => r.entity_type === 'collective')
      .reduce((acc, r) => acc + (r.turnover_target_month || 0), 0)
  }, [rows])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 md:p-10">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-6 border-b border-white/5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Планирование KPI</h1>
              <div className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                Общий план на месяц:{' '}
                <Badge variant="secondary" className="text-sm font-mono">
                  {money(totals)}
                </Badge>
                <Badge variant="secondary" className="text-sm font-mono">
                  Команды: Пн–Чт / Пт–Вс
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-zinc-900/50 p-1.5 rounded-xl border border-white/5">
              <input
                type="month"
                value={month.slice(0, 7)}
                onChange={(e) => setMonth(e.target.value + '-01')}
                className="bg-transparent border-none text-sm px-3 outline-none text-white"
              />
              <div className="w-px h-6 bg-white/10" />
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

          {loading && rows.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-12">
              {Object.entries(grouped.byCompany)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([code, pack]) => {
                  const teamsOrder: TeamCode[] = ['wk', 'we', 'all']
                  return (
                    <section key={code} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold capitalize text-zinc-200">F16 {code}</h2>
                        <div className="h-px flex-1 bg-white/5" />
                        <Badge variant="secondary" className="font-mono text-xs">
                          <CalendarDays className="w-3.5 h-3.5 mr-1" />
                          2 команды
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {teamsOrder.map((team) => {
                          const items = pack.byTeam[team] || []
                          if (items.length === 0) return null

                          const collective = items.find((i) => i.entity_type === 'collective')
                          const operators = items
                            .filter((i) => i.entity_type === 'operator')
                            .sort((a, b) => (b.turnover_target_month || 0) - (a.turnover_target_month || 0))

                          return (
                            <Card key={team} className="bg-[#0A0A0A] border-white/5 overflow-hidden">
                              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Users2 className="w-4 h-4 text-indigo-400" />
                                  <span className="font-semibold text-zinc-200">{TEAM_LABEL[team]}</span>
                                </div>
                                {collective?.meta?.share && (
                                  <Badge variant="secondary" className="font-mono text-xs">
                                    доля: {collective.meta.share}
                                  </Badge>
                                )}
                              </div>

                              <table className="w-full text-sm">
                                <thead className="bg-white/[0.02] text-xs text-muted-foreground uppercase">
                                  <tr>
                                    <th className="text-left px-4 py-3 font-medium">Сотрудник</th>
                                    <th className="text-right px-4 py-3 font-medium">План (Месяц)</th>
                                    <th className="text-right px-4 py-3 font-medium">Смены</th>
                                    <th className="text-center px-4 py-3 w-16">Lock</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                  {collective && (
                                    <RowItem
                                      row={collective}
                                      name="Команда (цель недели/месяца)"
                                      isMain
                                      onChange={updateRow}
                                    />
                                  )}
                                  {operators.map((op) => (
                                    <RowItem
                                      key={op.plan_key}
                                      row={op}
                                      name={operatorNames[op.operator_id || ''] || op.operator_id || 'ID?'}
                                      onChange={updateRow}
                                    />
                                  ))}
                                </tbody>
                              </table>
                            </Card>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}

              {grouped.roles.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-bold text-zinc-400">Менеджмент</h2>
                  <Card className="bg-[#0A0A0A] border-white/5">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-white/5">
                        {grouped.roles.map((r) => (
                          <RowItem
                            key={r.plan_key}
                            row={r}
                            name={r.role_code === 'supervisor' ? 'Руководитель' : 'Маркетолог'}
                            onChange={updateRow}
                          />
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
