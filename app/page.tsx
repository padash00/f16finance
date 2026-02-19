'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CalendarDays,
  Filter,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Smartphone,
  BarChart3,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'

// ==================== TYPES ====================

type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
  comment: string | null
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type RangeType = 'today' | 'week' | 'month30' | 'currentMonth' | 'quarter' | 'year' | 'custom'

type Totals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  incomeTotal: number

  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  profit: number
  netCash: number
  netNonCash: number
}

type DayRow = {
  date: string
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  incomeTotal: number

  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  profit: number
}

// ==================== UTILS ====================

const DateUtils = {
  toISODateLocal: (d: Date): string => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },
  todayISO: (): string => DateUtils.toISODateLocal(new Date()),
  addDaysISO: (iso: string, diff: number): string => {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },
  getCurrentMonthBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    return {
      start: DateUtils.toISODateLocal(new Date(y, m, 1)),
      end: DateUtils.toISODateLocal(new Date(y, m + 1, 0)),
    }
  },
  getQuarterBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0)),
    }
  },
  getYearBounds: () => {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31)),
    }
  },
  getDatesInRange: (from: string, to: string): string[] => {
    const dates: string[] = []
    let cur = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    while (cur <= end) {
      dates.push(DateUtils.toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  },
  formatRuShort: (iso: string) => {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  },
  formatRuLong: (iso: string) => {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },
}

const Fmt = {
  money: (v: number) => (Number(v || 0)).toLocaleString('ru-RU', { maximumFractionDigits: 0 }),
  moneyShort: (v: number) => {
    const n = Number(v || 0)
    const a = Math.abs(n)
    if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (a >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toString()
  },
}

// ==================== UI HELPERS ====================

function Pill({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[11px] rounded-md border transition-colors ${
        active
          ? 'bg-white text-black border-white'
          : 'bg-white/0 text-muted-foreground border-white/10 hover:bg-white/5 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function KpiCard({
  title,
  value,
  sub,
  icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'accent'
}) {
  const toneCls =
    tone === 'good'
      ? 'border-green-500/20 bg-green-500/5'
      : tone === 'bad'
      ? 'border-red-500/20 bg-red-500/5'
      : tone === 'accent'
      ? 'border-purple-500/20 bg-purple-500/5'
      : 'border-white/10 bg-white/[0.03]'

  return (
    <Card className={`p-4 border ${toneCls}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{title}</div>
          <div className="text-2xl font-black tracking-tight mt-1">{value}</div>
          {sub ? <div className="text-[11px] text-muted-foreground mt-1">{sub}</div> : null}
        </div>
        <div className="h-10 w-10 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center">
          {icon}
        </div>
      </div>
    </Card>
  )
}

// ==================== PAGE ====================

export default function SmartDashboardPage() {
  // date state
  const [rangeType, setRangeType] = useState<RangeType>('month30')
  const [dateFrom, setDateFrom] = useState(() => DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(() => DateUtils.todayISO())

  // extra filter
  const [includeExtra, setIncludeExtra] = useState(false)

  // data
  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ==================== LOAD ====================

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: compData, error: compErr }, { data: incomeData, error: incErr }, { data: expData, error: expErr }] =
        await Promise.all([
          supabase.from('companies').select('id,name,code').order('name'),
          supabase
            .from('incomes')
            // ✅ online_amount добавлен
            .select('id,date,company_id,cash_amount,kaspi_amount,card_amount,online_amount,comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('date', { ascending: false }),
          supabase
            .from('expenses')
            .select('id,date,company_id,category,cash_amount,kaspi_amount,comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('date', { ascending: false }),
        ])

      if (compErr || incErr || expErr) throw new Error('Ошибка загрузки данных')
      setCompanies(compData || [])
      setIncomes(incomeData || [])
      setExpenses(expData || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    reload()
  }, [reload])

  // ==================== DERIVED ====================

  const companyById = useMemo(() => {
    const m: Record<string, Company> = {}
    companies.forEach(c => (m[c.id] = c))
    return m
  }, [companies])

  const isExtraCompany = useCallback(
    (companyId: string) => ((companyById[companyId]?.code || '').toLowerCase() === 'extra'),
    [companyById]
  )

  const hasExtraCompany = useMemo(() => companies.some(c => (c.code || '').toLowerCase() === 'extra'), [companies])

  const setQuickRange = useCallback((type: RangeType) => {
    const today = DateUtils.todayISO()
    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'week') {
      setDateFrom(DateUtils.addDaysISO(today, -6))
      setDateTo(today)
    } else if (type === 'month30') {
      setDateFrom(DateUtils.addDaysISO(today, -29))
      setDateTo(today)
    } else if (type === 'currentMonth') {
      const { start, end } = DateUtils.getCurrentMonthBounds()
      setDateFrom(start)
      setDateTo(end)
    } else if (type === 'quarter') {
      const { start, end } = DateUtils.getQuarterBounds()
      setDateFrom(start)
      setDateTo(end)
    } else if (type === 'year') {
      const { start, end } = DateUtils.getYearBounds()
      setDateFrom(start)
      setDateTo(end)
    }
    setRangeType(type)
  }, [])

  const analytics = useMemo(() => {
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)

    const dayMap = new Map<string, DayRow>()
    dates.forEach(d => {
      dayMap.set(d, {
        date: d,
        incomeCash: 0,
        incomeKaspi: 0,
        incomeCard: 0,
        incomeOnline: 0,
        incomeTotal: 0,
        expenseCash: 0,
        expenseKaspi: 0,
        expenseTotal: 0,
        profit: 0,
      })
    })

    const totals: Totals = {
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeOnline: 0,
      incomeTotal: 0,
      expenseCash: 0,
      expenseKaspi: 0,
      expenseTotal: 0,
      profit: 0,
      netCash: 0,
      netNonCash: 0,
    }

    const incomeCats: Record<string, number> = {}
    const expenseCats: Record<string, number> = {}

    const allowCompany = (companyId: string) => (includeExtra ? true : !isExtraCompany(companyId))

    // incomes
    for (const r of incomes) {
      if (!allowCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const online = Number(r.online_amount || 0)
      const total = cash + kaspi + card + online
      if (total <= 0) continue

      totals.incomeCash += cash
      totals.incomeKaspi += kaspi
      totals.incomeCard += card
      totals.incomeOnline += online
      totals.incomeTotal += total

      const cat = (r.comment || 'Продажи').trim()
      incomeCats[cat] = (incomeCats[cat] || 0) + total

      const day = dayMap.get(r.date)
      if (day) {
        day.incomeCash += cash
        day.incomeKaspi += kaspi
        day.incomeCard += card
        day.incomeOnline += online
        day.incomeTotal += total
      }
    }

    // expenses
    for (const r of expenses) {
      if (!allowCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      totals.expenseCash += cash
      totals.expenseKaspi += kaspi
      totals.expenseTotal += total

      const cat = (r.category || r.comment || 'Прочее').trim()
      expenseCats[cat] = (expenseCats[cat] || 0) + total

      const day = dayMap.get(r.date)
      if (day) {
        day.expenseCash += cash
        day.expenseKaspi += kaspi
        day.expenseTotal += total
      }
    }

    // finalize
    dayMap.forEach(d => {
      d.profit = d.incomeTotal - d.expenseTotal
    })

    totals.profit = totals.incomeTotal - totals.expenseTotal
    totals.netCash = totals.incomeCash - totals.expenseCash
    totals.netNonCash = (totals.incomeKaspi + totals.incomeCard + totals.incomeOnline) - totals.expenseKaspi

    const rows = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date))

    const topIncome = Object.entries(incomeCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, amount]) => ({
        name,
        amount,
        pct: totals.incomeTotal > 0 ? (amount / totals.incomeTotal) * 100 : 0,
      }))

    const topExpense = Object.entries(expenseCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, amount]) => ({
        name,
        amount,
        pct: totals.expenseTotal > 0 ? (amount / totals.expenseTotal) * 100 : 0,
      }))

    const margin = totals.incomeTotal > 0 ? (totals.profit / totals.incomeTotal) * 100 : 0

    return { totals, rows, topIncome, topExpense, margin }
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  const feed = useMemo(() => {
    const items: Array<{ id: string; date: string; title: string; amount: number; kind: 'income' | 'expense' }> = []

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue

      const amount =
        Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      if (amount <= 0) continue

      items.push({ id: `i-${r.id}`, date: r.date, title: r.comment || 'Продажа', amount, kind: 'income' })
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (amount <= 0) continue
      items.push({ id: `e-${r.id}`, date: r.date, title: r.category || r.comment || 'Расход', amount, kind: 'expense' })
    }

    return items.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount).slice(0, 12)
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  // ==================== RENDER ====================

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
            <p className="text-muted-foreground">Загрузка...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="p-6 max-w-md border border-red-500/20 bg-red-500/5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-300" />
              <div className="font-semibold">Ошибка</div>
            </div>
            <div className="text-sm text-muted-foreground">{error}</div>
            <div className="mt-4">
              <Button onClick={reload} className="w-full">
                Повторить
              </Button>
            </div>
          </Card>
        </main>
      </div>
    )
  }

  const { totals, rows, topIncome, topExpense, margin } = analytics
  const profitTone = totals.profit >= 0 ? 'good' : 'bad'
  const marginText = `${margin.toFixed(1)}%`

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* HEADER */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12px] text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Финансы • Период: <span className="text-foreground">{DateUtils.formatRuLong(dateFrom)}</span> —{' '}
                  <span className="text-foreground">{DateUtils.formatRuLong(dateTo)}</span>
                </div>
                <div className="text-3xl font-black tracking-tight mt-1">Dashboard</div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  Простой смысл: <span className="text-foreground">доход</span> − <span className="text-foreground">расход</span> ={' '}
                  <span className="text-foreground">прибыль</span>. Без магии 🙂
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={reload} className="gap-2">
                  <RefreshCcw className="w-4 h-4" />
                  Обновить
                </Button>
                <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
                  <Button className="gap-2">
                    Операции
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* FILTER BAR */}
            <Card className="p-3 border border-white/10 bg-white/[0.03]">
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Filter className="w-4 h-4" />
                    Диапазон:
                  </div>

                  <Pill active={rangeType === 'today'} onClick={() => setQuickRange('today')}>
                    Сегодня
                  </Pill>
                  <Pill active={rangeType === 'week'} onClick={() => setQuickRange('week')}>
                    7 дней
                  </Pill>
                  <Pill active={rangeType === 'month30'} onClick={() => setQuickRange('month30')}>
                    30 дней
                  </Pill>
                  <Pill active={rangeType === 'currentMonth'} onClick={() => setQuickRange('currentMonth')}>
                    Месяц
                  </Pill>
                  <Pill active={rangeType === 'quarter'} onClick={() => setQuickRange('quarter')}>
                    Квартал
                  </Pill>
                  <Pill active={rangeType === 'year'} onClick={() => setQuickRange('year')}>
                    Год
                  </Pill>

                  {hasExtraCompany && (
                    <button
                      onClick={() => setIncludeExtra(v => !v)}
                      className={`ml-2 px-3 py-1.5 text-[11px] rounded-md border transition-colors ${
                        includeExtra
                          ? 'bg-red-500/10 text-red-200 border-red-500/20'
                          : 'bg-white/0 text-muted-foreground border-white/10 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {includeExtra ? 'Extra: включён' : 'Extra: исключён'}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-[12px] text-muted-foreground flex items-center gap-2">
                    <CalendarDays className="w-4 h-4" />
                    Даты:
                  </div>

                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setRangeType('custom')
                    }}
                    className="bg-transparent border border-white/10 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                  <span className="text-muted-foreground text-[12px]">—</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setRangeType('custom')
                    }}
                    className="bg-transparent border border-white/10 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <KpiCard
              title="Доход (итого)"
              value={`${Fmt.money(totals.incomeTotal)} ₸`}
              sub={`Cash ${Fmt.moneyShort(totals.incomeCash)} • Kaspi ${Fmt.moneyShort(totals.incomeKaspi)} • Card ${Fmt.moneyShort(
                totals.incomeCard
              )} • Online ${Fmt.moneyShort(totals.incomeOnline)}`}
              icon={<TrendingUp className="w-5 h-5 text-green-300" />}
              tone="good"
            />
            <KpiCard
              title="Расход (итого)"
              value={`${Fmt.money(totals.expenseTotal)} ₸`}
              sub={`Cash ${Fmt.moneyShort(totals.expenseCash)} • Kaspi ${Fmt.moneyShort(totals.expenseKaspi)}`}
              icon={<TrendingDown className="w-5 h-5 text-red-300" />}
              tone="bad"
            />
            <KpiCard
              title="Прибыль"
              value={`${Fmt.money(totals.profit)} ₸`}
              sub={`Маржа: ${marginText}`}
              icon={<BarChart3 className="w-5 h-5 text-purple-300" />}
              tone={profitTone}
            />
            <KpiCard
              title="Net Cash"
              value={`${Fmt.money(totals.netCash)} ₸`}
              sub="наличные доходы − наличные расходы"
              icon={<Wallet className="w-5 h-5 text-white" />}
              tone="neutral"
            />
            <KpiCard
              title="Net Non-Cash"
              value={`${Fmt.money(totals.netNonCash)} ₸`}
              sub="Kaspi+Card+Online − Kaspi расходы"
              icon={<CreditCard className="w-5 h-5 text-white" />}
              tone="neutral"
            />
            <KpiCard
              title="Online"
              value={`${Fmt.money(totals.incomeOnline)} ₸`}
              sub="онлайн платежи из incomes.online_amount"
              icon={<Smartphone className="w-5 h-5 text-white" />}
              tone="accent"
            />
          </div>

          {/* MAIN GRID */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* TABLE */}
            <Card className="xl:col-span-2 p-0 border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="font-semibold">Дни (таблица)</div>
                <div className="text-[12px] text-muted-foreground">Сортировка: новые сверху</div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-[12px]">
                  <thead className="sticky top-0 bg-[#0b0b0b] border-b border-white/10">
                    <tr className="text-muted-foreground">
                      <th className="text-left p-3 w-[110px]">Дата</th>
                      <th className="text-right p-3">Доход</th>
                      <th className="text-right p-3">Cash</th>
                      <th className="text-right p-3">Kaspi</th>
                      <th className="text-right p-3">Card</th>
                      <th className="text-right p-3">Online</th>
                      <th className="text-right p-3">Расход</th>
                      <th className="text-right p-3">Прибыль</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td className="p-6 text-center text-muted-foreground" colSpan={8}>
                          Нет данных за период
                        </td>
                      </tr>
                    ) : (
                      rows.map(r => {
                        const profitPos = r.profit >= 0
                        return (
                          <tr key={r.date} className="border-b border-white/5 hover:bg-white/[0.03]">
                            <td className="p-3 font-medium">
                              <div className="flex flex-col">
                                <span className="text-foreground">{DateUtils.formatRuShort(r.date)}</span>
                                <span className="text-[10px] text-muted-foreground">{r.date}</span>
                              </div>
                            </td>

                            <td className="p-3 text-right font-semibold">{Fmt.money(r.incomeTotal)}</td>
                            <td className="p-3 text-right text-muted-foreground">{Fmt.moneyShort(r.incomeCash)}</td>
                            <td className="p-3 text-right text-muted-foreground">{Fmt.moneyShort(r.incomeKaspi)}</td>
                            <td className="p-3 text-right text-muted-foreground">{Fmt.moneyShort(r.incomeCard)}</td>
                            <td className="p-3 text-right text-muted-foreground">{Fmt.moneyShort(r.incomeOnline)}</td>

                            <td className="p-3 text-right">{Fmt.money(r.expenseTotal)}</td>

                            <td className={`p-3 text-right font-bold ${profitPos ? 'text-green-300' : 'text-red-300'}`}>
                              {profitPos ? '+' : ''}
                              {Fmt.money(r.profit)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-3 border-t border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground">
                Подсказка: “Online” берётся из <span className="text-foreground">incomes.online_amount</span>.
              </div>
            </Card>

            {/* RIGHT COLUMN */}
            <div className="space-y-6">
              {/* TOP INCOME */}
              <Card className="p-4 border border-white/10 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-300" />
                    Топ доходов
                  </div>
                  <div className="text-[11px] text-muted-foreground">по comment</div>
                </div>

                <div className="mt-3 space-y-3">
                  {topIncome.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground text-center py-4">Нет данных</div>
                  ) : (
                    topIncome.map((x, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[12px] text-muted-foreground truncate">{x.name}</div>
                          <div className="text-[12px] font-semibold">{Fmt.moneyShort(x.amount)}</div>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-green-500" style={{ width: `${Math.min(100, x.pct)}%` }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground">{x.pct.toFixed(1)}%</div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* TOP EXPENSE */}
              <Card className="p-4 border border-white/10 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-red-300" />
                    Топ расходов
                  </div>
                  <div className="text-[11px] text-muted-foreground">по category</div>
                </div>

                <div className="mt-3 space-y-3">
                  {topExpense.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground text-center py-4">Нет данных</div>
                  ) : (
                    topExpense.map((x, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[12px] text-muted-foreground truncate">{x.name}</div>
                          <div className="text-[12px] font-semibold">{Fmt.moneyShort(x.amount)}</div>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-red-500" style={{ width: `${Math.min(100, x.pct)}%` }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground">{x.pct.toFixed(1)}%</div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* FEED */}
              <Card className="p-0 border border-white/10 bg-white/[0.02] overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-white/70" />
                    Последние операции
                  </div>
                  <div className="text-[11px] text-muted-foreground">{feed.length}</div>
                </div>

                <div className="max-h-[280px] overflow-auto p-2">
                  {feed.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground text-center py-6">Нет операций</div>
                  ) : (
                    <div className="space-y-1">
                      {feed.map(it => (
                        <div key={it.id} className="flex items-center justify-between p-2 rounded-md hover:bg-white/[0.03]">
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium truncate">{it.title}</div>
                            <div className="text-[10px] text-muted-foreground">{DateUtils.formatRuShort(it.date)}</div>
                          </div>
                          <div className={`text-[12px] font-bold font-mono ${it.kind === 'income' ? 'text-green-300' : 'text-red-300'}`}>
                            {it.kind === 'income' ? '+' : '-'}
                            {Fmt.moneyShort(it.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3 border-t border-white/10">
                  <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
                    <Button variant="ghost" className="w-full justify-center gap-2 text-muted-foreground hover:text-white">
                      Открыть журнал
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </Card>
            </div>
          </div>

          {/* FOOTNOTE */}
          <div className="text-[11px] text-muted-foreground">
            Если захочешь ещё жёстче: добавим переключатель “по компаниям” + мини-график по дням. Но сначала пусть это заработает.
          </div>
        </div>
      </main>
    </div>
  )
}
