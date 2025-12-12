'use client'

import { useEffect, useMemo, useState, FormEvent, useCallback } from 'react'
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

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyCode: string
  date: string
  shift: 'day' | 'night'
  turnover: number
}

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type AdjustmentRow = {
  id: number
  operator_id: string
  date: string
  amount: number
  kind: AdjustmentKind
  comment: string | null
}

type DebtRow = {
  id: string
  operator_id: string | null
  amount: number | null
  week_start: string | null
  status: string | null
}

type OperatorWeekStat = {
  operatorId: string
  operatorName: string
  shifts: number
  basePerShift: number
  baseSalary: number
  bonusSalary: number
  totalSalary: number
  totalTurnover: number
  autoDebts: number
  manualPlus: number
  manualMinus: number
  advances: number
  finalSalary: number
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

// --- Даты: локальный ISO без UTC-сдвигов ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7 // 1..7 (Пн..Вс)
  if (day !== 1) date.setDate(date.getDate() - (day - 1))
  return date
}

const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const parseAmount = (raw: string) => {
  const n = Number(raw.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : NaN
}

export default function SalaryPage() {
  const today = new Date()
  const monday = getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(toISODateLocal(monday))
  const [dateTo, setDateTo] = useState(toISODateLocal(sunday))

  // Статика (грузим 1 раз)
  const [companies, setCompanies] = useState<Company[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [staticLoading, setStaticLoading] = useState(true)

  // Динамика (по диапазону дат)
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])
  const [rangeLoading, setRangeLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  // Форма корректировок
  const [adjOperatorId, setAdjOperatorId] = useState('')
  const [adjDate, setAdjDate] = useState(toISODateLocal(today))
  const [adjKind, setAdjKind] = useState<AdjustmentKind>('debt')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)

  // Если пользователь руками поставил кривой диапазон — подчиним
  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateFrom(dateTo)
      setDateTo(dateFrom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  const setThisWeek = useCallback(() => {
    const now = new Date()
    const mon = getMonday(now)
    const from = toISODateLocal(mon)
    const to = addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  const setLastWeek = useCallback(() => {
    const now = new Date()
    const mon = getMonday(now)
    mon.setDate(mon.getDate() - 7)
    const from = toISODateLocal(mon)
    const to = addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  // 1) Статика — один раз
  useEffect(() => {
    let alive = true

    const loadStatic = async () => {
      setStaticLoading(true)
      setError(null)

      const [compRes, rulesRes, opsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase
          .from('operator_salary_rules')
          .select(
            'id,company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus',
          )
          .eq('is_active', true),
        supabase.from('operators').select('id,name,short_name,is_active'),
      ])

      if (!alive) return

      if (compRes.error || rulesRes.error || opsRes.error) {
        console.error('Salary static load error', compRes.error, rulesRes.error, opsRes.error)
        setError('Ошибка загрузки справочников (компании/правила/операторы)')
        setStaticLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setRules((rulesRes.data || []) as SalaryRule[])
      setOperators((opsRes.data || []) as Operator[])
      setStaticLoading(false)
    }

    loadStatic()
    return () => {
      alive = false
    }
  }, [])

  // 2) Данные диапазона — при смене дат
  useEffect(() => {
    let alive = true

    const loadRange = async () => {
      setRangeLoading(true)
      setError(null)

      const [incRes, adjRes, debtsRes] = await Promise.all([
        supabase
          .from('incomes')
          .select(
            'id,date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id,operator_name',
          )
          .gte('date', dateFrom)
          .lte('date', dateTo),
        supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo),
        // week_start обычно = ПН. Под диапазон недели ок.
        supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', dateFrom)
          .lte('week_start', dateTo)
          .eq('status', 'active'),
      ])

      if (!alive) return

      if (incRes.error || adjRes.error || debtsRes.error) {
        console.error('Salary range load error', incRes.error, adjRes.error, debtsRes.error)
        setError('Ошибка загрузки данных для расчёта зарплаты')
        setRangeLoading(false)
        return
      }

      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setRangeLoading(false)
    }

    loadRange()
    return () => {
      alive = false
    }
  }, [dateFrom, dateTo])

  const loading = staticLoading || rangeLoading

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const rulesMap = useMemo(() => {
    const map: Record<string, SalaryRule> = {}
    for (const r of rules) map[`${r.company_code}_${r.shift_type}`] = r
    return map
  }, [rules])

  // Список операторов для селекта (все активные)
  const operatorOptions = useMemo(
    () =>
      operators
        .filter((o) => o.is_active)
        .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name, 'ru')),
    [operators],
  )

  // Основная математика
  const stats = useMemo(() => {
    const operatorById: Record<string, Operator> = {}
    for (const o of operators) operatorById[o.id] = o

    const aggregated = new Map<string, AggregatedShift>()
    const byOperator = new Map<string, OperatorWeekStat>()

    let totalTurnover = 0
    const DEFAULT_BASE = 8000

    const ensureOperator = (id: string | null): OperatorWeekStat | null => {
      if (!id) return null

      let op = byOperator.get(id)
      if (!op) {
        const meta = operatorById[id]
        const displayName = meta?.short_name || meta?.name || 'Без имени'

        op = {
          operatorId: id,
          operatorName: displayName,
          shifts: 0,
          basePerShift: DEFAULT_BASE,
          baseSalary: 0,
          bonusSalary: 0,
          totalSalary: 0,
          totalTurnover: 0,
          autoDebts: 0,
          manualPlus: 0,
          manualMinus: 0,
          advances: 0,
          finalSalary: 0,
        }
        byOperator.set(id, op)
      }
      return op
    }

    // 1) Смены (агрегация)
    for (const row of incomes) {
      if (!row.operator_id) continue

      const company = companyById[row.company_id]
      const code = company?.code?.toLowerCase() || null
      if (!code) continue
      if (!['arena', 'ramen', 'extra'].includes(code)) continue

      const shift: 'day' | 'night' = row.shift === 'night' ? 'night' : 'day'

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      if (total <= 0) continue

      const meta = operatorById[row.operator_id]
      const displayName =
        meta?.short_name || meta?.name || row.operator_name || 'Без имени'

      const key = `${row.operator_id}_${code}_${row.date}_${shift}`

      const ex =
        aggregated.get(key) || {
          operatorId: row.operator_id,
          operatorName: displayName,
          companyCode: code,
          date: row.date,
          shift,
          turnover: 0,
        }

      ex.turnover += total
      aggregated.set(key, ex)
    }

    // 2) База + авто-бонусы
    for (const sh of aggregated.values()) {
      const rule = rulesMap[`${sh.companyCode}_${sh.shift}`]
      const basePerShift = rule?.base_per_shift ?? DEFAULT_BASE

      let bonus = 0
      if (rule?.threshold1_turnover && sh.turnover >= rule.threshold1_turnover) {
        bonus += rule.threshold1_bonus || 0
      }
      if (rule?.threshold2_turnover && sh.turnover >= rule.threshold2_turnover) {
        bonus += rule.threshold2_bonus || 0
      }

      const op = ensureOperator(sh.operatorId)
      if (!op) continue

      op.basePerShift = basePerShift
      op.shifts += 1
      op.baseSalary += basePerShift
      op.bonusSalary += bonus
      op.totalSalary += basePerShift + bonus
      op.totalTurnover += sh.turnover
      totalTurnover += sh.turnover
    }

    // 2a) Все активные операторы — в таблицу (даже с нулями)
    for (const o of operators) {
      if (!o.is_active) continue
      ensureOperator(o.id)
    }

    // 3) Ручные корректировки
    for (const adj of adjustments) {
      const op = ensureOperator(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (adj.kind === 'bonus') op.manualPlus += amount
      else if (adj.kind === 'advance') op.advances += amount
      else op.manualMinus += amount // debt/fine
    }

    // 4) Долги недели
    let totalDebts = 0
    for (const d of debts) {
      const op = ensureOperator(d.operator_id)
      if (!op) continue

      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      op.autoDebts += amount
      totalDebts += amount
    }

    // 5) Итог к выплате
    let totalSalary = 0
    for (const op of byOperator.values()) {
      op.finalSalary =
        op.totalSalary +
        op.manualPlus -
        op.manualMinus -
        op.autoDebts -
        op.advances

      totalSalary += op.finalSalary
    }

    const operatorsStats = Array.from(byOperator.values()).sort((a, b) =>
      a.operatorName.localeCompare(b.operatorName, 'ru'),
    )

    return { operators: operatorsStats, totalSalary, totalTurnover, totalDebts }
  }, [incomes, companyById, rulesMap, adjustments, operators, debts])

  const totalShifts = stats.operators.reduce((s, o) => s + o.shifts, 0)
  const totalBase = stats.operators.reduce((s, o) => s + o.baseSalary, 0)
  const totalBonus = stats.operators.reduce((s, o) => s + o.bonusSalary, 0)
  const totalAutoDebts = stats.operators.reduce((s, o) => s + o.autoDebts, 0)
  const totalMinus = stats.operators.reduce((s, o) => s + o.manualMinus, 0)
  const totalPlus = stats.operators.reduce((s, o) => s + o.manualPlus, 0)
  const totalAdvances = stats.operators.reduce((s, o) => s + o.advances, 0)

  const handleAddAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      if (!adjOperatorId) throw new Error('Выберите оператора')
      if (!adjDate) throw new Error('Выберите дату корректировки')

      const amountNum = parseAmount(adjAmount)
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error('Введите сумму корректировки')
      }

      setAdjSaving(true)

      const payload = {
        operator_id: adjOperatorId,
        date: adjDate,
        amount: Math.round(amountNum),
        kind: adjKind,
        comment: adjComment.trim() || null,
      }

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([payload])
        .select('id,operator_id,date,amount,kind,comment')
        .single()

      if (error) throw error

      setAdjustments((prev) => [...prev, data as AdjustmentRow])

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
                  База + авто-бонусы + корректировки − долги − авансы (F16 Arena / Ramen / Extra)
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
              <p className="text-2xl font-bold">{loading ? '—' : totalShifts}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">База (оклад)</p>
              <p className="text-2xl font-bold">{loading ? '—' : formatMoney(totalBase)}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Авто-бонусы</p>
              <p className="text-2xl font-bold text-emerald-400">
                {loading ? '—' : formatMoney(totalBonus)}
              </p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                К выплате (после долгов, корректировок и авансов)
              </p>
              <p className="text-2xl font-bold text-sky-400">
                {loading ? '—' : formatMoney(stats.totalSalary)}
              </p>
              {!loading && totalAutoDebts > 0 && (
                <p className="mt-1 text-[11px] text-red-300">
                  Включая долги недели: {formatMoney(totalAutoDebts)}
                </p>
              )}
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead className="sticky top-0 bg-card/90 backdrop-blur border-b border-border">
                <tr className="text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 text-left px-2">Оператор</th>
                  <th className="py-2 text-center px-2">Смен</th>
                  <th className="py-2 text-right px-2">Оклад / смена</th>
                  <th className="py-2 text-right px-2">База</th>
                  <th className="py-2 text-right px-2">Авто-бонус</th>
                  <th className="py-2 text-right px-2 text-red-300">Долги недели</th>
                  <th className="py-2 text-right px-2">Корр. −</th>
                  <th className="py-2 text-right px-2">Аванс</th>
                  <th className="py-2 text-right px-2">Корр. +</th>
                  <th className="py-2 text-right px-2">К выплате</th>
                  <th className="py-2 text-right px-2 text-[10px]">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-muted-foreground text-xs">
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && stats.operators.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-muted-foreground text-xs">
                      Нет данных в выбранном периоде.
                    </td>
                  </tr>
                )}

                {!loading &&
                  stats.operators.map((op) => (
                    <tr
                      key={op.operatorId}
                      className="border-t border-border/40 hover:bg-white/5"
                    >
                      <td className="py-1.5 px-2 font-medium">{op.operatorName}</td>
                      <td className="py-1.5 px-2 text-center">{op.shifts}</td>
                      <td className="py-1.5 px-2 text-right">{formatMoney(op.basePerShift)}</td>
                      <td className="py-1.5 px-2 text-right">{formatMoney(op.baseSalary)}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-300">
                        {formatMoney(op.bonusSalary)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-red-300">
                        {formatMoney(op.autoDebts)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-red-300">
                        {formatMoney(op.manualMinus)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-amber-300">
                        {formatMoney(op.advances)}
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
                  <tr className="border-t border-border">
                    <td className="py-2 px-2 font-bold text-right" colSpan={3}>
                      Итого:
                    </td>
                    <td className="py-2 px-2 text-right font-bold">{formatMoney(totalBase)}</td>
                    <td className="py-2 px-2 text-right font-bold text-emerald-300">
                      {formatMoney(totalBonus)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-red-300">
                      {formatMoney(totalAutoDebts)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-red-300">
                      {formatMoney(totalMinus)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-amber-300">
                      {formatMoney(totalAdvances)}
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

          {/* Форма корректировок */}
          {operatorOptions.length > 0 && (
            <Card className="p-4 border-border bg-card/80">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Добавить долг / штраф / премию / аванс (ручная корректировка)
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
                    {operatorOptions.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.short_name || op.name}
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
                    onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="debt">Долг (минус)</option>
                    <option value="fine">Штраф (минус)</option>
                    <option value="advance">Аванс (минус из выплаты)</option>
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
                      placeholder="Аванс −20k / штраф за кассу −10k / премия за турнир..."
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
