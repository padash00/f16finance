'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  Users2,
  TrendingUp,
  Gauge,
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

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
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

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyCode: string
  date: string
  shift: 'day' | 'night'
  turnover: number
}

type OperatorAnalytics = {
  operatorId: string
  operatorName: string
  shifts: number
  daysWorked: number
  totalTurnover: number
  avgTurnoverPerShift: number
  shareOfTurnover: number
  autoDebts: number
  manualMinus: number
  manualPlus: number
  netAdjustments: number // plus - minus - autoDebts
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7 // 1..7, 1 = Пн
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

export default function OperatorAnalyticsPage() {
  const today = new Date()
  const monday = getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(formatISO(monday))
  const [dateTo, setDateTo] = useState(formatISO(sunday))

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // Загрузка данных
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [compRes, incRes, opsRes, adjRes, debtsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase
          .from('incomes')
          .select(
            'id,date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id,operator_name',
          )
          .gte('date', dateFrom)
          .lte('date', dateTo),
        supabase
          .from('operators')
          .select('id,name,short_name,is_active'),
        supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo),
        supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', dateFrom)
          .lte('week_start', dateTo)
          .eq('status', 'active'),
      ])

      if (compRes.error || incRes.error || opsRes.error || adjRes.error || debtsRes.error) {
        console.error(
          'Operator analytics load error',
          compRes.error,
          incRes.error,
          opsRes.error,
          adjRes.error,
          debtsRes.error,
        )
        setError('Ошибка загрузки данных для аналитики операторов')
        setLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setIncomes((incRes.data || []) as IncomeRow[])
      setOperators((opsRes.data || []) as Operator[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setLoading(false)
    }

    load()
  }, [dateFrom, dateTo])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const stats = useMemo(() => {
    const operatorById: Record<string, Operator> = {}
    for (const o of operators) operatorById[o.id] = o

    const aggregated = new Map<string, AggregatedShift>()
    const byOperator = new Map<string, OperatorAnalytics>()
    const daysByOperator = new Map<string, Set<string>>()

    const ensureOperator = (id: string | null): OperatorAnalytics | null => {
      if (!id) return null
      let op = byOperator.get(id)
      if (!op) {
        const meta = operatorById[id]
        const displayName =
          meta?.short_name || meta?.name || 'Без имени'
        op = {
          operatorId: id,
          operatorName: displayName,
          shifts: 0,
          daysWorked: 0,
          totalTurnover: 0,
          avgTurnoverPerShift: 0,
          shareOfTurnover: 0,
          autoDebts: 0,
          manualMinus: 0,
          manualPlus: 0,
          netAdjustments: 0,
        }
        byOperator.set(id, op)
      }
      return op
    }

    // 1. Собираем смены (выручка)
    let totalTurnoverAll = 0

    for (const row of incomes) {
      if (!row.operator_id) continue

      const company = companyById[row.company_id]
      if (!company || !company.code) continue
      if (!['arena', 'ramen', 'extra'].includes(company.code)) continue

      const shift: 'day' | 'night' =
        row.shift === 'night' ? 'night' : 'day'

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      const key = `${row.operator_id}_${row.company_id}_${row.date}_${shift}`

      const meta = operatorById[row.operator_id]
      const displayName =
        meta?.short_name ||
        meta?.name ||
        row.operator_name ||
        'Без имени'

      const ex =
        aggregated.get(key) || {
          operatorId: row.operator_id,
          operatorName: displayName,
          companyCode: company.code,
          date: row.date,
          shift,
          turnover: 0,
        }

      ex.turnover += total
      aggregated.set(key, ex)
    }

    // 2. Выручка по сменам
    for (const sh of aggregated.values()) {
      const op = ensureOperator(sh.operatorId)
      if (!op) continue

      op.shifts += 1
      op.totalTurnover += sh.turnover
      totalTurnoverAll += sh.turnover

      let days = daysByOperator.get(sh.operatorId)
      if (!days) {
        days = new Set()
        daysByOperator.set(sh.operatorId, days)
      }
      days.add(sh.date)
    }

    // 2а. Все активные операторы хотя бы с нулевыми значениями
    for (const o of operators) {
      if (!o.is_active) continue
      ensureOperator(o.id)
    }

    // 3. Ручные корректировки (штрафы / премии / авансы)
    for (const adj of adjustments) {
      const op = ensureOperator(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (adj.kind === 'bonus') {
        op.manualPlus += amount
      } else {
        // debt / fine / advance — всё минус
        op.manualMinus += amount
      }
    }

    // 4. Долги из таблицы debts (за неделю)
    let totalDebtsAll = 0
    for (const d of debts) {
      const op = ensureOperator(d.operator_id)
      if (!op) continue

      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      op.autoDebts += amount
      totalDebtsAll += amount
    }

    // 5. Финалка по каждому оператору
    const result: OperatorAnalytics[] = []

    for (const op of byOperator.values()) {
      const daysSet = daysByOperator.get(op.operatorId)
      op.daysWorked = daysSet ? daysSet.size : 0
      op.avgTurnoverPerShift =
        op.shifts > 0 ? Math.round(op.totalTurnover / op.shifts) : 0
      op.shareOfTurnover =
        totalTurnoverAll > 0
          ? (op.totalTurnover / totalTurnoverAll) * 100
          : 0
      op.netAdjustments =
        op.manualPlus - op.manualMinus - op.autoDebts

      result.push(op)
    }

    // Сортируем по выручке (сверху самые сильные)
    result.sort((a, b) => b.totalTurnover - a.totalTurnover)

    return {
      operators: result,
      totalTurnoverAll,
      totalDebtsAll,
    }
  }, [incomes, companies, operators, adjustments, debts])

  const bestOperator = stats.operators[0]
  const worstByDebts = [...stats.operators].sort(
    (a, b) =>
      (b.autoDebts + b.manualMinus) - (a.autoDebts + a.manualMinus),
  )[0]

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/income">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Users2 className="w-6 h-6 text-emerald-400" />
                  Аналитика операторов
                </h1>
                <p className="text-xs text-muted-foreground">
                  Выручка, смены, доли, долги и корректировки за период
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
                <span className="text-[10px] text-muted-foreground">
                  Период
                </span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
                <span className="text-[10px] text-muted-foreground">
                  —
                </span>
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

          {/* Верхняя сводка */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                Общая выручка (Arena / Ramen / Extra)
              </p>
              <p className="text-2xl font-bold text-sky-400">
                {formatMoney(stats.totalTurnoverAll || 0)}
              </p>
            </Card>

            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                Средняя выручка за смену по клубу
              </p>
              <p className="text-2xl font-bold flex items-center gap-2">
                <Gauge className="w-5 h-5 text-emerald-400" />
                {formatMoney(
                  (() => {
                    const totalShifts = stats.operators.reduce(
                      (s, o) => s + o.shifts,
                      0,
                    )
                    if (!totalShifts) return 0
                    return Math.round(
                      (stats.totalTurnoverAll || 0) / totalShifts,
                    )
                  })(),
                )}
              </p>
            </Card>

            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                Лучший оператор по выручке
              </p>
              {bestOperator ? (
                <>
                  <p className="text-sm font-semibold">
                    {bestOperator.operatorName}
                  </p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatMoney(bestOperator.totalTurnover)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {bestOperator.shifts} смен ·{' '}
                    {formatMoney(bestOperator.avgTurnoverPerShift)}{' '}
                    / смена
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Нет данных за период
                </p>
              )}
            </Card>

            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">
                Долги и штрафы за период
              </p>
              <p className="text-lg font-bold text-red-400">
                {formatMoney(
                  stats.totalDebtsAll +
                    stats.operators.reduce(
                      (s, o) => s + o.manualMinus,
                      0,
                    ),
                )}
              </p>
              {worstByDebts && (
                <p className="text-[11px] text-red-300 mt-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Больше всего минусов:{' '}
                  <span className="font-semibold">
                    {worstByDebts.operatorName}
                  </span>
                </p>
              )}
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="p-4 border-border bg-card/80 overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">Оператор</th>
                  <th className="py-2 px-2 text-center">Смен</th>
                  <th className="py-2 px-2 text-center">Дней</th>
                  <th className="py-2 px-2 text-right">
                    Выручка всего
                  </th>
                  <th className="py-2 px-2 text-right">
                    Ср. смена
                  </th>
                  <th className="py-2 px-2 text-right">
                    Доля выручки
                  </th>
                  <th className="py-2 px-2 text-right text-red-300">
                    Долги (авто)
                  </th>
                  <th className="py-2 px-2 text-right text-red-300">
                    Штрафы / минус
                  </th>
                  <th className="py-2 px-2 text-right text-emerald-300">
                    Премии / плюс
                  </th>
                  <th className="py-2 px-2 text-right">
                    Чистый эффект
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && stats.operators.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
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
                      <td className="py-1.5 px-2 font-medium">
                        {op.operatorName}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {op.shifts}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {op.daysWorked}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(op.totalTurnover)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(op.avgTurnoverPerShift)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {op.shareOfTurnover.toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-2 text-right text-red-300">
                        {formatMoney(op.autoDebts)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-red-300">
                        {formatMoney(op.manualMinus)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-emerald-300">
                        {formatMoney(op.manualPlus)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-semibold">
                        {formatMoney(op.netAdjustments)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
