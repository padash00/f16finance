'use client'

import { useEffect, useMemo, useState } from 'react'
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
import Link from 'next/link'

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

type OperatorWeekStat = {
  operatorId: string
  operatorName: string
  shifts: number
  basePerShift: number
  baseSalary: number
  bonusSalary: number
  totalSalary: number
  totalTurnover: number
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

// Понедельник для заданной даты
const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7 // 1..7, где 1 = Пн
  if (day !== 1) {
    date.setDate(date.getDate() - (day - 1))
  }
  return date
}

const formatISO = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SalaryPage() {
  // Диапазон по умолчанию — текущая неделя Пн–Вс
  const today = new Date()
  const monday = getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(formatISO(monday))
  const [dateTo, setDateTo] = useState(formatISO(sunday))

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Быстрые кнопки: эта неделя / прошлая неделя
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

      const [compRes, incRes, rulesRes] = await Promise.all([
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
      ])

      if (compRes.error || incRes.error || rulesRes.error) {
        console.error('Salary load error', compRes.error, incRes.error, rulesRes.error)
        setError('Ошибка загрузки данных для расчёта зарплаты')
        setLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setIncomes((incRes.data || []) as IncomeRow[])
      setRules((rulesRes.data || []) as SalaryRule[])
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

  // Основная математика: группировка смен и расчёт ЗП
  const stats = useMemo(() => {
    if (!incomes.length) {
      return {
        operators: [] as OperatorWeekStat[],
        totalSalary: 0,
        totalTurnover: 0,
      }
    }

    const aggregated = new Map<string, AggregatedShift>()

    // 1. Аггрегируем доход по смене:
    // ключ = оператор + компания + дата + смена
    for (const row of incomes) {
      if (!row.operator_id || !row.operator_name) continue

      const company = companyById[row.company_id]
      if (!company || !company.code) continue

      // считаем только наши точки
      if (!['arena', 'ramen', 'extra'].includes(company.code)) continue

      const shift: 'day' | 'night' = row.shift === 'night' ? 'night' : 'day'

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      // даже если выручка 0 – смену можно учитывать, но обычно таких строк не будет
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
    let totalSalary = 0
    let totalTurnover = 0

    const DEFAULT_BASE = 8000

    for (const sh of aggregated.values()) {
      const keyRule = `${sh.companyCode}_${sh.shift}`
      const rule = rulesMap[keyRule]

      const basePerShift = rule?.base_per_shift ?? DEFAULT_BASE

      // бонус по порогам
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
        }
      }

      op.shifts += 1
      op.baseSalary += basePerShift
      op.bonusSalary += bonus
      op.totalSalary += basePerShift + bonus
      op.totalTurnover += sh.turnover

      byOperator.set(sh.operatorId, op)
      totalSalary += basePerShift + bonus
      totalTurnover += sh.turnover
    }

    const operators = Array.from(byOperator.values()).sort((a, b) =>
      a.operatorName.localeCompare(b.operatorName, 'ru'),
    )

    return { operators, totalSalary, totalTurnover }
  }, [incomes, companyById, rulesMap])

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
                  Расчёт по сменам и бонусам (F16 Arena / Ramen / Extra)
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Всего смен</p>
              <p className="text-2xl font-bold">
                {stats.operators.reduce((s, o) => s + o.shifts, 0)}
              </p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Итого зарплата</p>
              <p className="text-2xl font-bold text-emerald-400">
                {formatMoney(stats.totalSalary)}
              </p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Выручка (для расчёта)</p>
              <p className="text-2xl font-bold text-sky-400">
                {formatMoney(stats.totalTurnover)}
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
                  <th className="py-2 text-right px-2">Оклад за смену</th>
                  <th className="py-2 text-right px-2">База (оклад)</th>
                  <th className="py-2 text-right px-2">Бонус</th>
                  <th className="py-2 text-right px-2">Итого</th>
                  <th className="py-2 text-right px-2 text-[10px]">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-6 text-center text-muted-foreground text-xs"
                    >
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!loading && stats.operators.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
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
                      <td className="py-1.5 px-2 font-medium">{op.operatorName}</td>
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
                      <td className="py-1.5 px-2 text-right font-semibold">
                        {formatMoney(op.totalSalary)}
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
                      {formatMoney(
                        stats.operators.reduce((s, o) => s + o.baseSalary, 0),
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-emerald-300">
                      {formatMoney(
                        stats.operators.reduce((s, o) => s + o.bonusSalary, 0),
                      )}
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
        </div>
      </main>
    </div>
  )
}
