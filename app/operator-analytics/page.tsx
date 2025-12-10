'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  CalendarDays,
  ArrowLeft,
  Users2,
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

// те же виды корректировок, что и на зарплате
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

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type OperatorAnalyticsRow = {
  operatorId: string
  operatorName: string
  shifts: number
  days: number
  totalTurnover: number
  avgPerShift: number
  share: number
  autoDebts: number      // долги из таблицы debts
  manualMinus: number    // только debt/fine (штрафы/минус)
  manualPlus: number     // премии
  advances: number       // авансы (для инфы, в чистый эффект не лезут)
  netEffect: number      // чистый эффект = премии − штрафы − долги (БЕЗ авансов)
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7
  if (day !== 1) date.setDate(date.getDate() - (day - 1))
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
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])

  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      const [compRes, incRes, adjRes, opsRes, debtsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
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
        supabase
          .from('operators')
          .select('id,name,short_name,is_active'),
        supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', dateFrom)
          .lte('week_start', dateTo)
          .eq('status', 'active'),
      ])

      setCompanies((compRes.data || []) as Company[])
      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setOperators((opsRes.data || []) as Operator[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setLoading(false)
    }

    load()
  }, [dateFrom, dateTo])

  // Основная аналитика
  const {
    rows,
    totalTurnover,
    totalShifts,
    totalAutoDebts,
    totalMinus,
    totalPlus,
  } = useMemo(() => {
    const companyById: Record<string, Company> = {}
    for (const c of companies) companyById[c.id] = c

    const operatorById: Record<string, Operator> = {}
    for (const o of operators) operatorById[o.id] = o

    const byOperator = new Map<string, OperatorAnalyticsRow>()
    const daysByOperator = new Map<string, Set<string>>()
    let totalTurnover = 0
    let totalShifts = 0

    const ensureOp = (id: string | null): OperatorAnalyticsRow | null => {
      if (!id) return null
      let op = byOperator.get(id)
      if (!op) {
        const meta = operatorById[id]
        const name = meta?.short_name || meta?.name || 'Без имени'
        op = {
          operatorId: id,
          operatorName: name,
          shifts: 0,
          days: 0,
          totalTurnover: 0,
          avgPerShift: 0,
          share: 0,
          autoDebts: 0,
          manualMinus: 0,
          manualPlus: 0,
          advances: 0,
          netEffect: 0,
        }
        byOperator.set(id, op)
      }
      return op
    }

    // 1. Выручка и смены
    for (const row of incomes) {
      if (!row.operator_id) continue
      const company = companyById[row.company_id]
      if (!company || !company.code) continue
      if (!['arena', 'ramen', 'extra'].includes(company.code)) continue

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      const op = ensureOp(row.operator_id)
      if (!op) continue

      op.shifts += 1
      op.totalTurnover += total
      totalTurnover += total
      totalShifts += 1

      // дни
      if (!daysByOperator.has(row.operator_id)) {
        daysByOperator.set(row.operator_id, new Set())
      }
      daysByOperator.get(row.operator_id)!.add(row.date)
    }

    // 2. Долги из debts
    let totalAutoDebts = 0
    for (const d of debts) {
      const op = ensureOp(d.operator_id)
      if (!op) continue

      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      op.autoDebts += amount
      totalAutoDebts += amount
    }

    // 3. Ручные корректировки
    let totalMinus = 0
    let totalPlus = 0

    for (const adj of adjustments) {
      const op = ensureOp(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (adj.kind === 'bonus') {
        // премия
        op.manualPlus += amount
        totalPlus += amount
      } else if (adj.kind === 'advance') {
        // ✅ аванс: учитываем отдельно, в минуса НЕ идёт и на чистый эффект не влияет
        op.advances += amount
      } else {
        // debt / fine -> реальные минуса
        op.manualMinus += amount
        totalMinus += amount
      }
    }

    // 4. финальные показатели по каждому оператору
    const arr: OperatorAnalyticsRow[] = []

    for (const op of byOperator.values()) {
      const daysSet = daysByOperator.get(op.operatorId)
      op.days = daysSet ? daysSet.size : 0
      op.avgPerShift = op.shifts > 0 ? op.totalTurnover / op.shifts : 0
      op.share = totalTurnover > 0 ? op.totalTurnover / totalTurnover : 0
      // Чистый эффект: премии − штрафы − долги. Авансы не трогаем.
      op.netEffect = op.manualPlus - op.manualMinus - op.autoDebts
      arr.push(op)
    }

    arr.sort((a, b) => b.totalTurnover - a.totalTurnover)

    return {
      rows: arr,
      totalTurnover,
      totalShifts,
      totalAutoDebts,
      totalMinus,
      totalPlus,
    }
  }, [companies, incomes, adjustments, operators, debts])

  const bestOperator = rows[0]
  const totalPenalties = totalAutoDebts + totalMinus // долги + штрафы (без авансов)

  const mostNegative = useMemo(() => {
    if (!rows.length) return null
    return rows.reduce((min, cur) => {
      const curMinus = cur.autoDebts + cur.manualMinus
      const minMinus = min.autoDebts + min.manualMinus
      return curMinus > minMinus ? cur : min
    }, rows[0])
  }, [rows])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Users2 className="w-6 h-6 text-emerald-400" />
                  Аналитика операторов
                </h1>
                <p className="text-xs text-muted-foreground">
                  Выручка, смены, долги, штрафы, премии за выбранный период
                  (авансы в минусы не входят).
                </p>
              </div>
            </div>

            {/* Даты */}
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

          {/* Карточки сверху */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Общая выручка (Arena / Ramen / Extra)
              </p>
              <p className="text-2xl font-bold">{formatMoney(totalTurnover)}</p>
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Средняя выручка за смену по клубу
              </p>
              <p className="text-2xl font-bold text-emerald-400">
                {totalShifts > 0
                  ? formatMoney(Math.round(totalTurnover / totalShifts))
                  : '0 ₸'}
              </p>
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Лучший оператор по выручке
              </p>
              {bestOperator ? (
                <>
                  <p className="text-lg font-semibold">
                    {bestOperator.operatorName}
                  </p>
                  <p className="text-sm text-emerald-400">
                    {formatMoney(bestOperator.totalTurnover)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {bestOperator.shifts} смен •{' '}
                    {formatMoney(Math.round(bestOperator.avgPerShift))} / смена
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              )}
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Долги и штрафы за период
              </p>
              <p className="text-2xl font-bold text-red-400">
                {formatMoney(totalPenalties)}
              </p>
              {mostNegative && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Больше всего минусов:{' '}
                  <span className="text-red-300">
                    {mostNegative.operatorName}
                  </span>
                </p>
              )}
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="p-4 bg-card/80 border-border overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">Оператор</th>
                  <th className="py-2 px-2 text-center">Смен</th>
                  <th className="py-2 px-2 text-center">Дней</th>
                  <th className="py-2 px-2 text-right">Выручка всего</th>
                  <th className="py-2 px-2 text-right">Ср. смена</th>
                  <th className="py-2 px-2 text-right">Доля выручки</th>
                  <th className="py-2 px-2 text-right text-red-300">
                    Долги (авто)
                  </th>
                  <th className="py-2 px-2 text-right text-red-300">
                    Штрафы / минус
                  </th>
                  <th className="py-2 px-2 text-right text-emerald-300">
                    Премии / плюс
                  </th>
                  <th className="py-2 px-2 text-right">Чистый эффект</th>
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

                {!loading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Нет данных за выбранный период.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((op) => (
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
                        {op.days}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(op.totalTurnover)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {formatMoney(Math.round(op.avgPerShift || 0))}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {(op.share * 100).toFixed(1)}%
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
                        {formatMoney(op.netEffect)}
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
