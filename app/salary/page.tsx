'use client'

import { useEffect, useMemo, useState, FormEvent } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  CalendarDays,
  ArrowLeft,
  DollarSign,
  Users2,
  AlertTriangle,
} from 'lucide-react'

type Company = {
  id: string
  name: string
  code: string | null
}

type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  operator_name: string | null
}

type SalaryRule = {
  id: number
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
}

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyCode: string
  date: string
  shift: 'day' | 'night'
  turnover: number
}

type AdjustmentKind = 'debt' | 'fine' | 'bonus'

type AdjustmentRow = {
  id: number
  operator_id: string
  date: string
  amount: number
  kind: AdjustmentKind
  comment: string | null
}

type OperatorWeekStat = {
  operatorId: string
  operatorName: string
  shifts: number
  basePerShift: number
  baseSalary: number
  bonusSalary: number
  totalSalary: number       // база + авто-бонусы
  totalTurnover: number
  manualPlus: number        // ручные премии
  manualMinus: number       // долги/штрафы
  finalSalary: number       // к выплате
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7 // 1..7, где 1 = Пн
  if (day !== 1) {
    date.setDate(date.getDate() - (day - 1))
  }
  return date
}

const formatISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`

export default function SalaryPage() {
  // Текущая неделя по умолчанию
  const today = new Date()
  const monday = getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(formatISO(monday))
  const [dateTo, setDateTo] = useState(formatISO(sunday))

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Форма добавления корректировки
  const [adjOperatorId, setAdjOperatorId] = useState('')
  const [adjDate, setAdjDate] = useState(formatISO(today))
  const [adjKind, setAdjKind] = useState<AdjustmentKind>('debt')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)

  const setThisWeek = () => {
    const now = new Date()
    const mon = getMonday(now)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    setDateFrom(formatISO(mon))
    setDateTo(formatISO(sun))
  }

  const setLastWeek = () => {
    const now = new Date()
    const mon = getMonday(now)
    mon.setDate(mon.getDate() - 7)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    setDateFrom(formatISO(mon))
    setDateTo(formatISO(sun))
  }

  // Загрузка данных по диапазону
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [compRes, incRes, rulesRes, adjRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase
          .from('incomes')
          .select(
            'id,date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id,operator_name',
          )
          .gte('date', dateFrom)
          .lte('date', dateTo),
        supabase
          .from('operator_salary_rules')
          .select(
            'id,company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus',
          )
          .eq('is_active', true),
        supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo),
      ])

      if (compRes.error || incRes.error || rulesRes.error || adjRes.error) {
        console.error(
          'Salary load error',
          compRes.error,
          incRes.error,
          rulesRes.error,
          adjRes.error,
        )
        setError('Ошибка загрузки данных для расчёта зарплаты')
        setLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setIncomes((incRes.data || []) as IncomeRow[])
      setRules((rulesRes.data || []) as SalaryRule[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setLoading(false)
    }

    load()
  }, [dateFrom, dateTo])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const rulesMap = useMemo(() => {
    const map: Record<string, SalaryRule> = {}
    for (const r of rules) {
      const key = `${r.company_code}_${r.shift_type}`
      map[key] = r
    }
    return map
  }, [rules])

  // Основная математика
  const stats = useMemo(() => {
    if (!incomes.length) {
      return {
        operators: [] as OperatorWeekStat[],
        totalSalary: 0,
        totalTurnover: 0,
      }
    }

    const aggregated = new Map<string, AggregatedShift>()

    // 1. Собираем смены (оператор + компания + дата + смена)
    for (const row of incomes) {
      if (!row.operator_id || !row.operator_name) continue

      const company = companyById[row.company_id]
      if (!company || !company.code) continue
      if (!['arena', 'ramen', 'extra'].includes(company.code)) continue

      const shift: 'day' | 'night' = row.shift === 'night' ? 'night' : 'day'

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      const key = `${row.operator_id}_${row.company_id}_${row.date}_${shift}`

      const ex = aggregated.get(key) || {
        operatorId: row.operator_id,
        operatorName: row.operator_name,
        companyCode: company.code,
        date: row.date,
        shift,
        turnover: 0,
      }

      ex.turnover += total
      aggregated.set(key, ex)
    }

    const byOperator = new Map<string, OperatorWeekStat>()
    let totalTurnover = 0
    const DEFAULT_BASE = 8000

    // 2. Считаем базу и авто-бонусы по правилам
    for (const sh of aggregated.values()) {
      const keyRule = `${sh.companyCode}_${sh.shift}`
      const rule = rulesMap[keyRule]

      const basePerShift = rule?.base_per_shift ?? DEFAULT_BASE

      let bonus = 0
      if (rule?.threshold1_turnover && sh.turnover >= rule.threshold1_turnover) {
        bonus += rule.threshold1_bonus || 0
      }
      if (rule?.threshold2_turnover && sh.turnover >= rule.threshold2_turnover) {
        bonus += rule.threshold2_bonus || 0
      }

      let op = byOperator.get(sh.operatorId)
      if (!op) {
        op = {
          operatorId: sh.operatorId,
          operatorName: sh.operatorName,
          shifts: 0,
          basePerShift,
          baseSalary: 0,
          bonusSalary: 0,
          totalSalary: 0,
          totalTurnover: 0,
          manualPlus: 0,
          manualMinus: 0,
          finalSalary: 0,
        }
      }

      op.shifts += 1
      op.baseSalary += basePerShift
      op.bonusSalary += bonus
      op.totalSalary += basePerShift + bonus
      op.totalTurnover += sh.turnover

      byOperator.set(sh.operatorId, op)
      totalTurnover += sh.turnover
    }

    // 3. Накладываем ручные корректировки (долги/штрафы/премии)
    for (const adj of adjustments) {
      const op = byOperator.get(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (amount <= 0) continue

      const isPlus = adj.kind === 'bonus'
      if (isPlus) {
        op.manualPlus += amount
      } else {
        op.manualMinus += amount
      }
    }

    // 4. Финальный пересчёт «к выплате»
    let totalSalary = 0
    for (const op of byOperator.values()) {
      op.finalSalary = op.totalSalary + op.manualPlus - op.manualMinus
      totalSalary += op.finalSalary
    }

    const operators = Array.from(byOperator.values()).sort((a, b) =>
      a.operatorName.localeCompare(b.operatorName, 'ru'),
    )

    return { operators, totalSalary, totalTurnover }
  }, [incomes, companyById, rulesMap, adjustments])

  // Добавление корректировки
  const handleAddAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      if (!adjOperatorId) throw new Error('Выберите оператора')
      if (!adjDate) throw new Error('Выберите дату корректировки')

      const amountNum = Number(
        adjAmount.replace(',', '.').replace(/\s/g, ''),
      )
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error('Введите сумму корректировки')
      }

      setAdjSaving(true)

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([
          {
            operator_id: adjOperatorId,
            date: adjDate,
            amount: Math.round(amountNum),
            kind: adjKind,
            comment: adjComment.trim() || null,
          },
        ])
        .select()
        .single()

      if (error) throw error

      setAdjustments((prev) => [...prev, data as AdjustmentRow])

      // Сброс формы
      setAdjAmount('')
      setAdjComment('')
      setAdjKind('debt')
      setAdjSaving(false)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при добавлении корректировки')
      setAdjSaving(false)
    }
  }

  const totalShifts = stats.operators.reduce((s, o) => s + o.shifts, 0)
  const totalBase = stats.operators.reduce((s, o) => s + o.baseSalary, 0)
  const totalBonus = stats.operators.reduce((s, o) => s + o.bonusSalary, 0)
  const totalMinus = stats.operators.reduce((s, o) => s + o.manualMinus, 0)
  const totalPlus = stats.operators.reduce((s, o) => s + o.manualPlus, 0)

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/income">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Users2 className="w-6 h-6 text-emerald-400" />
                  Зарплата операторов
                </h1>
                <p className="text-xs text-muted-foreground">
                  База + авто-бонусы + корректировки (F16 Arena / Ramen / Extra)
                </p>
              </div>
            </div>

            {/* Быстрый выбор недели + даты */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={setLastWeek}
                  className="h-7 text-[11px]"
                >
                  Прошлая неделя
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={setThisWeek}
                  className="h-7 text-[11px]"
                >
                  Эта неделя
                </Button>
              </div>
              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
                <span className="text-[10px] text-muted-foreground">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <Card className="p-4 border border-red-500/40 bg-red-950/30 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          {/* Сводка по неделе */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Всего смен</p>
              <p className="text-2xl font-bold">{totalShifts}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">База (оклад)</p>
              <p className="text-2xl font-bold">{formatMoney(totalBase)}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Авто-бонусы</p>
              <p className="text-2xl font-bold text-emerald-400">
                {formatMoney(totalBonus)}
              </p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                К выплате (после корректировок)
              </p>
              <p className="text-2xl font-bold text-sky-400">
                {formatMoney(stats.totalSalary)}
              </p>
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 text-left px-2">Оператор</th>
                  <th className="py-2 text-center px-2">Смен</th>
                  <th className="py-2 text-right px-2">Оклад / смена</th>
                  <th className="py-2 text-right px-2">База</th>
                  <th className="py-2 text-right px-2">Авто-бонус</th>
                  <th className="py-2 text-right px-2">Корр. −</th>
                  <th className="py-2 text-right px-2">Корр. +</th>
                  <th className="py-2 text-right px-2">К выплате</th>
                  <th className="py-2 text-right px-2 text-[10px]">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && stats.operators.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Нет смен в выбранном периоде.
                    </td>
                  </tr>
                )}

                {!loading &&
                  stats.operators.map((op) => (
                    <tr
                      key={op.operatorId}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      <td className="py-1.5 px-2 font-medium">
                        {op.operatorName}
                      </td>
                      <td className="py-1.5 px-2 text-center">{op.shifts}</td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(op.basePerShift)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(op.baseSalary)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-emerald-300">
                        {formatMoney(op.bonusSalary)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-red-300">
                        {formatMoney(op.manualMinus)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-emerald-300">
                        {formatMoney(op.manualPlus)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-semibold">
                        {formatMoney(op.finalSalary)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">
                        {formatMoney(op.totalTurnover)}
                      </td>
                    </tr>
                  ))}

                {!loading && stats.operators.length > 0 && (
                  <tr className="border-t border-border mt-2">
                    <td className="py-2 px-2 font-bold text-right" colSpan={3}>
                      Итого:
                    </td>
                    <td className="py-2 px-2 text-right font-bold">
                      {formatMoney(totalBase)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-emerald-300">
                      {formatMoney(totalBonus)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-red-300">
                      {formatMoney(totalMinus)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-emerald-300">
                      {formatMoney(totalPlus)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold">
                      {formatMoney(stats.totalSalary)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-sky-400">
                      {formatMoney(stats.totalTurnover)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          {/* Форма добавления корректировки (как маленькая "ячейка Excel") */}
          {stats.operators.length > 0 && (
            <Card className="p-4 border-border bg-card/80">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Добавить долг / штраф / премию
              </h3>

              <form
                onSubmit={handleAddAdjustment}
                className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
              >
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Оператор
                  </label>
                  <select
                    value={adjOperatorId}
                    onChange={(e) => setAdjOperatorId(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="">Не выбран</option>
                    {stats.operators.map((op) => (
                      <option key={op.operatorId} value={op.operatorId}>
                        {op.operatorName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Дата
                  </label>
                  <input
                    type="date"
                    value={adjDate}
                    onChange={(e) => setAdjDate(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Тип
                  </label>
                  <select
                    value={adjKind}
                    onChange={(e) =>
                      setAdjKind(e.target.value as AdjustmentKind)
                    }
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="debt">Долг (минус)</option>
                    <option value="fine">Штраф (минус)</option>
                    <option value="bonus">Премия (плюс)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Сумма
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                    placeholder="0"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Комментарий
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={adjComment}
                      onChange={(e) => setAdjComment(e.target.value)}
                      className="flex-1 bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                      placeholder="Например: штраф за кассу −10к / премия за турнир..."
                    />
                    <Button
                      type="submit"
                      disabled={adjSaving}
                      className="whitespace-nowrap h-9 text-xs"
                    >
                      {adjSaving ? 'Сохранение...' : 'Добавить'}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
