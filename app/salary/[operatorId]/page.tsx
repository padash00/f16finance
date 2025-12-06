'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  ArrowLeft,
  CalendarDays,
  Banknote,
  Smartphone,
  CreditCard,
  Sun,
  Moon,
  UserCircle2,
  TrendingUp,
  Settings2,
} from 'lucide-react'

type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type SalaryRule = {
  key: string
  label: string | null
  description: string | null
  value: number | null
}

type DateRangePreset = 'month' | 'week' | 'all'

type AggregatedShift = {
  id: string
  date: string
  shift: Shift
  totalIncome: number
  cash: number
  kaspi: number
  card: number
  zones: string[]
  comments: string[]
  salary: number
}

type PageProps = {
  params: { operatorId: string }
}

// helpers
const todayISO = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const addDaysISO = (iso: string, diff: number) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const formatMoney = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('ru-RU')

const formatDate = (value: string) => {
  if (!value) return ''
  const d = new Date(value)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const formatIsoToRu = (iso: string | '') => {
  if (!iso) return '…'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function OperatorSalaryPage({ params }: PageProps) {
  const { operatorId } = params

  const [operator, setOperator] = useState<Operator | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -29))
  const [dateTo, setDateTo] = useState(todayISO())
  const [preset, setPreset] = useState<DateRangePreset>('month')

  // reference maps
  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  // rules map
  const rulesMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rules) {
      if (r.value != null) map.set(r.key, Number(r.value))
    }
    return map
  }, [rules])

  const baseRate = rulesMap.get('base_rate') ?? 8000
  const bonus120Threshold = rulesMap.get('bonus_120_threshold') ?? 120_000
  const bonus120Value = rulesMap.get('bonus_120_value') ?? 2000
  const bonus160Threshold = rulesMap.get('bonus_160_threshold') ?? 160_000
  const bonus160Value = rulesMap.get('bonus_160_value') ?? 2000

  // load operator + companies + rules + incomes
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [
        { data: opData, error: opErr },
        { data: compData, error: compErr },
        { data: rulesData, error: rulesErr },
        { data: incomeData, error: incomeErr },
      ] = await Promise.all([
        supabase
          .from('operators')
          .select('id, name, short_name, is_active')
          .eq('id', operatorId)
          .single(),
        supabase.from('companies').select('id, name, code').order('name'),
        supabase
          .from('salary_rules')
          .select('key, label, description, value')
          .order('key'),
        supabase
          .from('incomes')
          .select(
            'id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, card_amount, comment',
          )
          .eq('operator_id', operatorId)
          .gte('date', dateFrom || '1900-01-01')
          .lte('date', dateTo || '2999-12-31')
          .order('date', { ascending: false }),
      ])

      if (opErr) {
        console.error(opErr)
        setError('Оператор не найден')
        setLoading(false)
        return
      }

      if (compErr || rulesErr || incomeErr) {
        console.error('Error loading operator salary data', {
          compErr,
          rulesErr,
          incomeErr,
        })
        setError('Ошибка при загрузке данных')
        setLoading(false)
        return
      }

      setOperator(opData as Operator)
      setCompanies((compData || []) as Company[])
      setRules((rulesData || []) as SalaryRule[])
      setIncomes((incomeData || []) as IncomeRow[])
      setLoading(false)
    }

    load()
  }, [operatorId, dateFrom, dateTo])

  // aggregated shifts
  const shifts: AggregatedShift[] = useMemo(() => {
    if (!incomes.length) return []

    const map = new Map<string, Omit<AggregatedShift, 'id' | 'salary'>>()

    for (const r of incomes) {
      if (!r.shift) continue
      const key = `${r.date}_${r.shift}`

      let agg = map.get(key)
      if (!agg) {
        agg = {
          date: r.date,
          shift: r.shift,
          totalIncome: 0,
          cash: 0,
          kaspi: 0,
          card: 0,
          zones: [],
          comments: [],
        }
        map.set(key, agg)
      }

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const total = cash + kaspi + card

      agg.totalIncome += total
      agg.cash += cash
      agg.kaspi += kaspi
      agg.card += card

      if (r.zone && !agg.zones.includes(r.zone)) {
        agg.zones.push(r.zone)
      }
      if (r.comment && !agg.comments.includes(r.comment)) {
        agg.comments.push(r.comment)
      }
    }

    const result: AggregatedShift[] = Array.from(map.entries()).map(
      ([key, agg]) => {
        let salary = baseRate

        if (agg.totalIncome >= bonus120Threshold) {
          salary += bonus120Value
        }
        if (agg.totalIncome >= bonus160Threshold) {
          salary += bonus160Value
        }

        return {
          id: key,
          date: agg.date,
          shift: agg.shift,
          totalIncome: agg.totalIncome,
          cash: agg.cash,
          kaspi: agg.kaspi,
          card: agg.card,
          zones: agg.zones,
          comments: agg.comments,
          salary,
        }
      },
    )

    result.sort((a, b) => a.date.localeCompare(b.date) || (a.shift > b.shift ? 1 : -1))

    return result
  }, [
    incomes,
    baseRate,
    bonus120Threshold,
    bonus120Value,
    bonus160Threshold,
    bonus160Value,
  ])

  const totals = useMemo(() => {
    const totalShifts = shifts.length
    const totalRevenue = shifts.reduce(
      (sum, s) => sum + s.totalIncome,
      0,
    )
    const totalSalary = shifts.reduce((sum, s) => sum + s.salary, 0)

    const avgRevenuePerShift =
      totalShifts > 0 ? totalRevenue / totalShifts : 0
    const avgSalaryPerShift =
      totalShifts > 0 ? totalSalary / totalShifts : 0

    return {
      totalShifts,
      totalRevenue,
      totalSalary,
      avgRevenuePerShift,
      avgSalaryPerShift,
    }
  }, [shifts])

  const handlePreset = (p: DateRangePreset) => {
    const today = todayISO()
    setPreset(p)

    if (p === 'month') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    } else if (p === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    } else if (p === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  const periodLabel =
    dateFrom || dateTo
      ? `${formatIsoToRu(dateFrom)} — ${formatIsoToRu(dateTo)}`
      : 'Весь период'

  const baseLabel =
    rules.find((r) => r.key === 'base_rate')?.label || 'Ставка за смену'

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          Загрузка карточки оператора...
        </main>
      </div>
    )
  }

  if (error || !operator) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>{error || 'Оператор не найден'}</p>
          <Link href="/salary">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Назад к зарплате
            </Button>
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link href="/salary">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-1 hidden md:inline-flex"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <UserCircle2 className="w-6 h-6 text-purple-500" />
                  <h1 className="text-2xl md:text-3xl font-bold">
                    {operator.short_name || operator.name}
                  </h1>
                  {!operator.is_active && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/40">
                      неактивен
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm mt-1">
                  Детальная статистика смен и зарплаты за выбранный период
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Link href="/salary/rules">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                >
                  <Settings2 className="w-4 h-4" />
                  Правила зарплаты
                </Button>
              </Link>
            </div>
          </div>

          {/* KPI блок */}
          <Card className="p-4 md:p-5 border-border bg-card/80 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Banknote className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">
                    Всего зарплата
                  </span>
                </div>
                <div className="text-xl md:text-2xl font-bold text-foreground">
                  {formatMoney(totals.totalSalary)} ₸
                </div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">
                    Выручка
                  </span>
                </div>
                <div className="text-xl md:text-2xl font-bold text-foreground">
                  {formatMoney(totals.totalRevenue)} ₸
                </div>
                <div className="text-[10px] text-muted-foreground">
                  В среднем за смену:{' '}
                  <span className="font-semibold">
                    {formatMoney(totals.avgRevenuePerShift)} ₸
                  </span>
                </div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CalendarDays className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">
                    Кол-во смен
                  </span>
                </div>
                <div className="text-xl md:text-2xl font-bold text-foreground">
                  {totals.totalShifts}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Средняя зарплата за смену:{' '}
                  <span className="font-semibold">
                    {formatMoney(totals.avgSalaryPerShift)} ₸
                  </span>
                </div>
              </Card>

              <Card className="p-4 border border-accent/60 bg-accent/10 flex flex-col justify-center">
                <div className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wider">
                  Текущие правила
                </div>
                <div className="text-xs space-y-1 text-foreground">
                  <div>
                    <span className="font-semibold">{baseLabel}</span>:{' '}
                    {formatMoney(baseRate)} ₸
                  </div>
                  <div>
                    Бонус ≥ {formatMoney(bonus120Threshold)} ₸:{' '}
                    {formatMoney(bonus120Value)} ₸
                  </div>
                  <div>
                    Бонус ≥ {formatMoney(bonus160Threshold)} ₸:{' '}
                    {formatMoney(bonus160Value)} ₸
                  </div>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                <span className="uppercase tracking-wide">
                  Период:
                </span>
                <span className="font-mono">{periodLabel}</span>
              </div>
              <div>
                Смен:{' '}
                <span className="font-semibold">
                  {totals.totalShifts}
                </span>
              </div>
            </div>
          </Card>

          {/* Фильтры дат */}
          <Card className="p-4 border-border bg-card">
            <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Период
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center bg-input/50 rounded-md border border-border/50 px-2 py-1">
                    <CalendarDays className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => {
                        setDateFrom(e.target.value)
                        setPreset(null as any)
                      }}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                    <span className="text-muted-foreground text-xs px-1">
                      →
                    </span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => {
                        setDateTo(e.target.value)
                        setPreset(null as any)
                      }}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                  </div>
                  <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                    {(['week', 'month', 'all'] as DateRangePreset[]).map(
                      (p) => (
                        <button
                          key={p}
                          onClick={() => handlePreset(p)}
                          className={`px-3 py-1 text-[10px] rounded transition-colors ${
                            preset === p
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-white/10 text-muted-foreground'
                          }`}
                        >
                          {p === 'week' && 'Неделя'}
                          {p === 'month' && '30 дн.'}
                          {p === 'all' && 'Всё'}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Таблица смен */}
          <Card className="border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-border bg-secondary/40 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-center">Смена</th>
                    <th className="px-4 py-3 text-left">Зоны</th>
                    <th className="px-4 py-3 text-right text-green-500">
                      Нал
                    </th>
                    <th className="px-4 py-3 text-right text-blue-500">
                      Kaspi
                    </th>
                    <th className="px-4 py-3 text-right text-purple-500">
                      Карта
                    </th>
                    <th className="px-4 py-3 text-right">Выручка</th>
                    <th className="px-4 py-3 text-right">Зарплата</th>
                    <th className="px-4 py-3 text-left">Комментарии</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {shifts.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-6 py-10 text-center text-muted-foreground"
                      >
                        Нет смен за выбранный период.
                      </td>
                    </tr>
                  )}

                  {shifts.map((s, idx) => (
                    <tr
                      key={s.id}
                      className={`border-b border-border/40 hover:bg-white/5 transition-colors ${
                        idx % 2 === 0 ? 'bg-card/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                        {formatDate(s.date)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {s.shift === 'day' ? (
                          <Sun className="w-4 h-4 text-yellow-400 inline" />
                        ) : (
                          <Moon className="w-4 h-4 text-blue-400 inline" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {s.zones.length
                          ? s.zones.join(', ')
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          s.cash
                            ? 'text-foreground'
                            : 'text-muted-foreground/20'
                        }`}
                      >
                        {s.cash ? formatMoney(s.cash) : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          s.kaspi
                            ? 'text-foreground'
                            : 'text-muted-foreground/20'
                        }`}
                      >
                        {s.kaspi ? formatMoney(s.kaspi) : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          s.card
                            ? 'text-foreground'
                            : 'text-muted-foreground/20'
                        }`}
                      >
                        {s.card ? formatMoney(s.card) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatMoney(s.totalIncome)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-accent bg-accent/5">
                        {formatMoney(s.salary)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                        {s.comments.length
                          ? s.comments.join(' | ')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
