'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabaseClient'
import { calculateForecast } from '@/lib/kpiEngine' // <--- ИМПОРТ МОЗГА
import {
  Save,
  Wand2,
  RefreshCcw,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp
} from 'lucide-react'

// --- 1. UTILS & TYPES ---

const money = (v: number) =>
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

// Вспомогательная функция для дат выборки
function getMonthDates(targetIso: string) {
  // targetIso: '2025-01-01'
  const target = new Date(targetIso)
  const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1) // Dec
  const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1) // Nov
  
  // Диапазон для выборки данных (с 1 числа N-2 по конец N-1)
  const fetchStart = new Date(prev2.getFullYear(), prev2.getMonth(), 1).toISOString().split('T')[0]
  const fetchEndObj = new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)
  const fetchEnd = fetchEndObj.toISOString().split('T')[0]

  return { target, prev1, prev2, fetchStart, fetchEnd }
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

// --- 2. CUSTOM HOOK (Logic) ---

function useKpiManager(monthStart: string) {
  const [rows, setRows] = useState<KpiRow[]>([])
  const [operatorNames, setOperatorNames] = useState<OperatorMap>({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success', msg: string } | null>(null)

  // A. Load existing plans
  const load = useCallback(async () => {
    setLoading(true)
    setStatus(null)
    
    // 1. Грузим планы
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

    // 2. Грузим имена операторов (лениво)
    const opIds = Array.from(new Set(plans?.map((r: any) => r.operator_id).filter(Boolean)))
    if (opIds.length > 0) {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name')
        .in('id', opIds)
      
      const map: OperatorMap = {}
      ops?.forEach((o: any) => map[o.id] = o.name)
      setOperatorNames(prev => ({ ...prev, ...map }))
    }

    setLoading(false)
  }, [monthStart])

  // B. Generate Logic
  const generate = async () => {
    setLoading(true)
    setStatus(null)
    
    try {
      const { target, prev1, prev2, fetchStart, fetchEnd } = getMonthDates(monthStart)
      
      // 1. Fetch Incomes
      const { data: incomes, error } = await supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code), operator_id')
        .gte('date', fetchStart)
        .lte('date', fetchEnd)
      
      if (error) throw error

      // 2. Aggregate Data
      // Нам нужно собрать "сырые" суммы за N-1 и N-2, чтобы скормить их в engine
      type Agg = { t2: number, t1: number, s2: number, s1: number, ops: Record<string, {t: number, s: number}> }
      const stats: Record<string, Agg> = {} // by company_code

      const getKey = (d: string) => d.slice(0, 7) // YYYY-MM
      const k1 = prev1.toISOString().slice(0, 7)
      const k2 = prev2.toISOString().slice(0, 7)

      // Предварительно рассчитываем scalePrev1 ТОЛЬКО для весов операторов
      // (сам прогноз считается внутри engine, но веса нужно масштабировать здесь, чтобы декабрьские работники не просели)
      const now = new Date()
      const isPrev1Current = prev1.getMonth() === now.getMonth() && prev1.getFullYear() === now.getFullYear()
      const scalePrev1ForWeights = isPrev1Current 
        ? new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0).getDate() / Math.max(1, now.getDate())
        : 1

      incomes?.forEach((inc: any) => {
        const code = inc.companies?.code || 'other'
        if (!stats[code]) stats[code] = { t2: 0, t1: 0, s2: 0, s1: 0, ops: {} }
        
        const amount = (inc.cash_amount || 0) + (inc.kaspi_amount || 0) + (inc.card_amount || 0)
        const mKey = getKey(inc.date)
        const isM1 = mKey === k1
        const isM2 = mKey === k2

        if (isM2) {
          stats[code].t2 += amount
          stats[code].s2 += 1
        } else if (isM1) {
          stats[code].t1 += amount
          stats[code].s1 += 1
        }

        // Агрегация по операторам (для вычисления долей)
        if (inc.operator_id) {
           if (!stats[code].ops[inc.operator_id]) stats[code].ops[inc.operator_id] = { t: 0, s: 0 }
           
           // Масштабируем вклад оператора в N-1, чтобы уравнять шансы с N-2
           const weight = isM1 ? (amount * scalePrev1ForWeights) : amount
           
           stats[code].ops[inc.operator_id].t += weight
           stats[code].ops[inc.operator_id].s += 1
        }
      })

      // 3. Build Plans using kpiEngine
      const newRows: KpiRow[] = []
      
      Object.entries(stats).forEach(([code, d]) => {
        // --- PROGNOZ (ENGINE) ---
        // Считаем выручку
        const turnoverCalc = calculateForecast(target, d.t1, d.t2)
        const targetT = turnoverCalc.forecast

        // Считаем смены (Shifts) через тот же движок!
        // Смены тоже линейно зависят от времени, так что метод подходит.
        const shiftsCalc = calculateForecast(target, d.s1, d.s2)
        const targetS = shiftsCalc.forecast
        
        // A. Collective Row
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
          meta: { 
            method: 'holt_v2', 
            prev2: d.t2, 
            prev1_est: turnoverCalc.prev1Estimated // сохраняем оценку N-1 для UI
          },
          is_locked: false
        })

        // B. Operators (Распределение по доле)
        const totalOpWeight = Object.values(d.ops).reduce((acc, v) => acc + v.t, 0)
        
        Object.entries(d.ops).forEach(([opId, opData]) => {
           if (opData.t < 1000) return // Игнорируем мусор

           const share = opData.t / totalOpWeight
           const opTarget = Math.round(targetT * share)
           // Смены операторам тоже ставим по доле от общих смен (простой и честный вариант)
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
            meta: { 
              share: (share * 100).toFixed(1) + '%', 
              hist_val: Math.round(opData.t) 
            },
            is_locked: false
           })
        })
      })

      // C. Roles (Global)
      const globalTotal = newRows
        .filter(r => r.entity_type === 'collective')
        .reduce((sum, r) => sum + r.turnover_target_month, 0)
      
      const roles = ['supervisor', 'marketing']
      roles.forEach(role => {
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
            is_locked: false
        })
      })

      // Merge with locks
      setRows(prev => {
        const lockedMap = new Map(prev.filter(r => r.is_locked).map(r => [r.plan_key, r]))
        return newRows.map(newRow => lockedMap.get(newRow.plan_key) || newRow)
      })

      setStatus({ type: 'success', msg: 'План сгенерирован (KPI Engine)' })

      // Подгрузим имена для новых операторов
      const newOpIds = newRows.map(r => r.operator_id).filter(Boolean) as string[]
      if (newOpIds.length) {
         const { data: names } = await supabase.from('operators').select('id, name').in('id', newOpIds)
         const map: OperatorMap = {}
         names?.forEach((n: any) => map[n.id] = n.name)
         setOperatorNames(prev => ({...prev, ...map}))
      }

    } catch (e: any) {
      console.error(e)
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setLoading(false)
    }
  }

  // C. Save Logic
  const save = async () => {
    setLoading(true)
    const { error } = await supabase.from('kpi_plans').upsert(rows, { onConflict: 'plan_key' })
    setLoading(false)
    if (error) setStatus({ type: 'error', msg: 'Ошибка сохранения' })
    else setStatus({ type: 'success', msg: 'Все изменения сохранены' })
  }

  const updateRow = (key: string, patch: Partial<KpiRow>) => {
    setRows(prev => prev.map(r => r.plan_key === key ? { ...r, ...patch } : r))
  }

  return { rows, operatorNames, loading, status, load, generate, save, updateRow }
}

// --- 3. UI COMPONENTS ---

const SmartInput = ({ 
  value, meta, locked, onChange 
}: { value: number, meta: any, locked: boolean, onChange: (v: number) => void }) => {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        disabled={locked}
        value={money(value)}
        onChange={e => {
            const n = Number(e.target.value.replace(/[^\d]/g, ''))
            onChange(n)
        }}
        className={`w-32 bg-transparent text-right border-b border-transparent hover:border-white/20 focus:border-indigo-500 outline-none transition-colors text-sm ${locked ? 'opacity-50 cursor-not-allowed text-zinc-500' : 'text-zinc-100'}`}
      />
      <div className="text-[10px] text-muted-foreground flex gap-2">
         {meta?.prev1_est && <span title="Прогноз базы (прошлый мес)">База: {money(meta.prev1_est)}</span>}
         {meta?.share && <span title="Историческая доля выручки">Доля: {meta.share}</span>}
      </div>
    </div>
  )
}

// --- 4. MAIN PAGE ---

export default function KPIPlansPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 7) + '-01'
  })

  const { rows, operatorNames, loading, status, load, generate, save, updateRow } = useKpiManager(month)

  useEffect(() => { load() }, [load])

  const groupedData = useMemo(() => {
    const groups: Record<string, KpiRow[]> = {}
    const roles: KpiRow[] = []

    rows.forEach(r => {
      if (r.entity_type === 'role') {
        roles.push(r)
        return
      }
      const key = r.company_code || 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    })
    return { groups, roles }
  }, [rows])

  const totals = useMemo(() => {
     return rows.filter(r => r.entity_type === 'collective')
        .reduce((acc, r) => acc + r.turnover_target_month, 0)
  }, [rows])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 md:p-10">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {/* Header Controls */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-6 border-b border-white/5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Планирование KPI</h1>
              <div className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                Общий план на месяц: <Badge variant="secondary" className="text-sm font-mono">{money(totals)}</Badge>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-zinc-900/50 p-1.5 rounded-xl border border-white/5">
               <input 
                 type="month" 
                 value={month.slice(0, 7)}
                 onChange={e => setMonth(e.target.value + '-01')}
                 className="bg-transparent border-none text-sm px-3 outline-none text-white"
               />
               <div className="w-px h-6 bg-white/10" />
               
               <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                 <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
               </Button>
               
               <Button variant="secondary" size="sm" onClick={generate} disabled={loading}>
                 <Wand2 className="w-4 h-4 mr-2 text-indigo-400" />
                 Генерировать
               </Button>
               
               <Button size="sm" onClick={save} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 text-white">
                 <Save className="w-4 h-4 mr-2" />
                 Сохранить
               </Button>
            </div>
          </div>

          {/* Status Bar */}
          {status && (
            <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${status.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
               {status.type === 'error' ? <AlertTriangle className="w-4 h-4"/> : <CheckCircle2 className="w-4 h-4"/>}
               {status.msg}
            </div>
          )}

          {/* Content */}
          {loading && rows.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-10">
              
              {/* 1. Companies */}
              {Object.entries(groupedData.groups).sort().map(([code, items]) => {
                const collective = items.find(i => i.entity_type === 'collective')
                const operators = items.filter(i => i.entity_type === 'operator')
                  .sort((a, b) => b.turnover_target_month - a.turnover_target_month)

                return (
                  <section key={code} className="space-y-3">
                    <div className="flex items-center gap-3">
                       <h2 className="text-xl font-bold capitalize text-zinc-200">F16 {code}</h2>
                       <div className="h-px flex-1 bg-white/5" />
                       {collective && (
                         <span className="text-xs font-mono text-zinc-500">
                           Цель: {money(collective.turnover_target_month)}
                         </span>
                       )}
                    </div>

                    <Card className="bg-[#0A0A0A] border-white/5 overflow-hidden">
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
                               name="Команда (Общая цель)" 
                               isMain 
                               onChange={updateRow} 
                             />
                           )}
                           {operators.map(op => (
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
                  </section>
                )
              })}

              {/* 2. Roles */}
              {groupedData.roles.length > 0 && (
                 <section className="space-y-3">
                    <h2 className="text-lg font-bold text-zinc-400">Менеджмент</h2>
                    <Card className="bg-[#0A0A0A] border-white/5">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-white/5">
                          {groupedData.roles.map(r => (
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

function RowItem({ row, name, isMain, onChange }: { row: KpiRow, name: string, isMain?: boolean, onChange: any }) {
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
          onChange={v => onChange(row.plan_key, { turnover_target_month: v, turnover_target_week: Math.round(v/4.345) })}
        />
      </td>
      <td className="px-4 py-2 text-right">
         <input 
            type="number"
            disabled={row.is_locked}
            value={row.shifts_target_month}
            onChange={e => onChange(row.plan_key, { shifts_target_month: Number(e.target.value) })}
            className={`w-16 bg-transparent text-right border-b border-transparent focus:border-white/20 outline-none ${row.is_locked ? 'text-zinc-500 cursor-not-allowed' : 'text-zinc-400'}`}
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
