'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  PieChart,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'

// --- Типы ---
type Company = { id: string; name: string; code: string | null }

type IncomeSlim = {
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

type ExpenseSlim = {
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type Totals = {
  incomeCash: number
  incomeKaspi: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number

  // extra отдельно
  extraTotal: number

  // по компаниям (без extra)
  statsByCompany: Record<string, { cash: number; kaspi: number }>

  // топ расходов
  expenseCategories: { name: string; value: number }[]

  // prev week
  prev: {
    incomeTotal: number
    expenseTotal: number
    profit: number
  }

  // проценты
  change: {
    income: string
    expense: string
    profit: string
  }

  // “умные” показатели
  metrics: {
    expenseRate: number // % расходов от выручки
    cashShare: number   // % налички в выручке
    netCash: number     // incomeCash - expenseCash
    netKaspi: number    // incomeKaspi - expenseKaspi
    topExpenseName: string | null
    topExpenseShare: number
  }
}

// --- Даты (локально, без UTC-сдвигов) ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const getTodayISO = () => toISODateLocal(new Date())

// Получаем понедельник-воскресенье (локально)
const getWeekBounds = (dateISO: string) => {
  const d = fromISO(dateISO)
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay() // 1=Пн ... 7=Вс

  const monday = new Date(d)
  monday.setDate(d.getDate() - (dayOfWeek - 1))

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return { start: toISODateLocal(monday), end: toISODateLocal(sunday) }
}

const formatKzt = (value: number) =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const formatRangeTitle = (start: string, end: string) => {
  const d1 = fromISO(start)
  const d2 = fromISO(end)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${d1.toLocaleDateString('ru-RU', opts)} — ${d2.toLocaleDateString('ru-RU', opts)}`
}

const pctChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? '+100%' : '—'
  if (current === 0) return '-100%'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

export default function WeeklyReportPage() {
  const today = getTodayISO()
  const bounds = getWeekBounds(today)

  const [startDate, setStartDate] = useState(bounds.start)
  const [endDate, setEndDate] = useState(bounds.end)

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [error, setError] = useState<string | null>(null)

  const extraCompanyId = useMemo(() => {
    const c = companies.find(
      (x) => (x.code || '').toLowerCase() === 'extra' || x.name === 'F16 Extra',
    )
    return c?.id ?? null
  }, [companies])

  const activeCompanies = useMemo(
    () => companies.filter((c) => (c.code || '').toLowerCase() !== 'extra'),
    [companies],
  )

  const isCurrentWeek = useMemo(() => startDate === getWeekBounds(today).start, [startDate, today])

  // --- НАВИГАЦИЯ ---
  const handleCurrentWeek = () => {
    const { start, end } = getWeekBounds(today)
    setStartDate(start)
    setEndDate(end)
  }

  const shiftWeek = (direction: -1 | 1) => {
    const d = fromISO(startDate)
    d.setDate(d.getDate() + direction * 7)
    const iso = toISODateLocal(d)
    const { start, end } = getWeekBounds(iso)
    setStartDate(start)
    setEndDate(end)
  }

  // 1) Компании — один раз
  useEffect(() => {
    const loadCompanies = async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id,name,code')
        .order('name')

      if (error) {
        console.error(error)
        setError('Не удалось загрузить компании')
        return
      }
      setCompanies((data || []) as Company[])
    }
    loadCompanies()
  }, [])

  // 2) Неделя + предыдущая неделя
  useEffect(() => {
    const load = async () => {
      if (!companies.length) return

      setLoading(true)
      setError(null)

      const prevStart = toISODateLocal(new Date(fromISO(startDate).setDate(fromISO(startDate).getDate() - 7)))
      const prevEnd = toISODateLocal(new Date(fromISO(endDate).setDate(fromISO(endDate).getDate() - 7)))

      // main (без extra)
      const incomeMainQ = supabase
        .from('incomes')
        .select('company_id,cash_amount,kaspi_amount,card_amount')
        .gte('date', startDate)
        .lte('date', endDate)

      const expenseMainQ = supabase
        .from('expenses')
        .select('company_id,category,cash_amount,kaspi_amount')
        .gte('date', startDate)
        .lte('date', endDate)

      const incomePrevQ = supabase
        .from('incomes')
        .select('company_id,cash_amount,kaspi_amount,card_amount')
        .gte('date', prevStart)
        .lte('date', prevEnd)

      const expensePrevQ = supabase
        .from('expenses')
        .select('company_id,category,cash_amount,kaspi_amount')
        .gte('date', prevStart)
        .lte('date', prevEnd)

      // extra отдельно (только доход, как у тебя)
      let incomeExtraQ = null as any
      if (extraCompanyId) {
        incomeMainQ.neq('company_id', extraCompanyId)
        expenseMainQ.neq('company_id', extraCompanyId)
        incomePrevQ.neq('company_id', extraCompanyId)
        expensePrevQ.neq('company_id', extraCompanyId)

        incomeExtraQ = supabase
          .from('incomes')
          .select('company_id,cash_amount,kaspi_amount,card_amount')
          .gte('date', startDate)
          .lte('date', endDate)
          .eq('company_id', extraCompanyId)
      }

      const [
        incMainRes,
        expMainRes,
        incPrevRes,
        expPrevRes,
        incExtraRes,
      ] = await Promise.all([
        incomeMainQ,
        expenseMainQ,
        incomePrevQ,
        expensePrevQ,
        incomeExtraQ ? incomeExtraQ : Promise.resolve({ data: [], error: null }),
      ])

      if (incMainRes.error || expMainRes.error || incPrevRes.error || expPrevRes.error || incExtraRes.error) {
        console.error({
          incMainErr: incMainRes.error,
          expMainErr: expMainRes.error,
          incPrevErr: incPrevRes.error,
          expPrevErr: expPrevRes.error,
          incExtraErr: incExtraRes.error,
        })
        setError('Не удалось загрузить данные недели')
        setLoading(false)
        return
      }

      const incomes = (incMainRes.data || []) as IncomeSlim[]
      const expenses = (expMainRes.data || []) as ExpenseSlim[]
      const incomesPrev = (incPrevRes.data || []) as IncomeSlim[]
      const expensesPrev = (expPrevRes.data || []) as ExpenseSlim[]
      const incomesExtra = (incExtraRes.data || []) as IncomeSlim[]

      // init
      let iCash = 0, iKaspi = 0, eCash = 0, eKaspi = 0, extra = 0
      const companyStats: Record<string, { cash: number; kaspi: number }> = {}
      const catMap = new Map<string, number>()

      for (const c of activeCompanies) companyStats[c.id] = { cash: 0, kaspi: 0 }

      // доходы
      for (const r of incomes) {
        const cash = Number(r.cash_amount || 0)
        const kaspi = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        if (cash + kaspi <= 0) continue

        iCash += cash
        iKaspi += kaspi

        if (companyStats[r.company_id]) {
          companyStats[r.company_id].cash += cash
          companyStats[r.company_id].kaspi += kaspi
        }
      }

      // extra
      for (const r of incomesExtra) {
        const cash = Number(r.cash_amount || 0)
        const kaspi = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        extra += cash + kaspi
      }

      // расходы
      for (const r of expenses) {
        const cash = Number(r.cash_amount || 0)
        const kaspi = Number(r.kaspi_amount || 0)
        const total = cash + kaspi
        if (total <= 0) continue

        eCash += cash
        eKaspi += kaspi

        const catName = r.category || 'Без категории'
        catMap.set(catName, (catMap.get(catName) || 0) + total)
      }

      const expenseCategories = Array.from(catMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)

      // prev totals
      let pIncome = 0, pExpense = 0
      for (const r of incomesPrev) {
        const cash = Number(r.cash_amount || 0)
        const kaspi = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
        pIncome += cash + kaspi
      }
      for (const r of expensesPrev) {
        const cash = Number(r.cash_amount || 0)
        const kaspi = Number(r.kaspi_amount || 0)
        pExpense += cash + kaspi
      }
      const pProfit = pIncome - pExpense

      const incomeTotal = iCash + iKaspi
      const expenseTotal = eCash + eKaspi
      const profit = incomeTotal - expenseTotal

      const topExpense = expenseCategories[0] || null
      const expenseRate = incomeTotal > 0 ? (expenseTotal / incomeTotal) * 100 : 0
      const cashShare = incomeTotal > 0 ? (iCash / incomeTotal) * 100 : 0
      const netCash = iCash - eCash
      const netKaspi = iKaspi - eKaspi
      const topExpenseShare = expenseTotal > 0 && topExpense ? (topExpense.value / expenseTotal) * 100 : 0

      setTotals({
        incomeCash: iCash,
        incomeKaspi: iKaspi,
        incomeTotal,
        expenseCash: eCash,
        expenseKaspi: eKaspi,
        expenseTotal,
        profit,
        extraTotal: extra,
        statsByCompany: companyStats,
        expenseCategories,
        prev: { incomeTotal: pIncome, expenseTotal: pExpense, profit: pProfit },
        change: {
          income: pctChange(incomeTotal, pIncome),
          expense: pctChange(expenseTotal, pExpense),
          profit: pctChange(profit, pProfit),
        },
        metrics: {
          expenseRate,
          cashShare,
          netCash,
          netKaspi,
          topExpenseName: topExpense?.name ?? null,
          topExpenseShare,
        },
      })

      setLoading(false)
    }

    load()
  }, [startDate, endDate, companies.length, extraCompanyId, activeCompanies])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          {/* Заголовок + навигация */}
          <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <CalendarDays className="w-8 h-8 text-accent" /> Недельный отчёт
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Финансовая сводка (Понедельник — Воскресенье)
              </p>
            </div>

            <Card className="p-1.5 flex items-center gap-2 border-border bg-card neon-glow">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(-1)}
                className="hover:bg-white/10 w-8 h-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>

              <div className="px-2 text-center min-w-[160px]">
                <span className="text-sm font-bold text-foreground block">
                  {formatRangeTitle(startDate, endDate)}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {isCurrentWeek ? 'Текущая неделя' : 'Архив'}
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => shiftWeek(1)}
                className="hover:bg-white/10 w-8 h-8"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>

              {!isCurrentWeek && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-2 text-xs h-7 bg-accent text-accent-foreground hover:bg-accent/80"
                  onClick={handleCurrentWeek}
                >
                  Вернуться
                </Button>
              )}
            </Card>
          </div>

          {error && (
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-muted-foreground animate-pulse">
              Считаем финансы...
            </div>
          )}

          {!loading && totals && (
            <>
              {/* “умная строка” */}
              <Card className="p-4 border-border bg-card neon-glow">
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Расходы/выручка: <b className={totals.metrics.expenseRate > 80 ? 'text-red-300' : 'text-foreground'}>
                      {totals.metrics.expenseRate.toFixed(1)}%
                    </b>
                  </span>
                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Доля налички: <b className="text-foreground">{totals.metrics.cashShare.toFixed(1)}%</b>
                  </span>
                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Сальдо нал: <b className={totals.metrics.netCash >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                      {formatKzt(totals.metrics.netCash)}
                    </b>
                  </span>
                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Сальдо Kaspi: <b className={totals.metrics.netKaspi >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                      {formatKzt(totals.metrics.netKaspi)}
                    </b>
                  </span>
                  {totals.metrics.topExpenseName && (
                    <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                      Топ расход: <b className="text-foreground">{totals.metrics.topExpenseName}</b>{' '}
                      <span className="text-muted-foreground">
                        ({totals.metrics.topExpenseShare.toFixed(1)}%)
                      </span>
                    </span>
                  )}
                </div>
              </Card>

              {/* Главные цифры */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* ДОХОДЫ */}
                <Card className="p-5 border-border bg-card neon-glow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        Общий Доход
                      </p>
                      <h2 className="text-3xl font-bold text-green-400 mt-1">
                        {formatKzt(totals.incomeTotal)}
                      </h2>
                    </div>
                    <div className="p-2 bg-green-500/10 rounded-full">
                      <TrendingUp className="w-6 h-6 text-green-500" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                    <span>Δ к прошлой неделе</span>
                    <span className="font-semibold text-foreground">{totals.change.income}</span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Wallet className="w-3 h-3" /> Наличные
                      </span>
                      <span className="font-mono text-foreground">
                        {formatKzt(totals.incomeCash)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-green-500"
                        style={{
                          width: `${totals.incomeTotal > 0 ? (totals.incomeCash / totals.incomeTotal) * 100 : 0}%`,
                        }}
                      />
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${totals.incomeTotal > 0 ? (totals.incomeKaspi / totals.incomeTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <CreditCard className="w-3 h-3" /> Kaspi / QR
                      </span>
                      <span className="font-mono text-foreground">
                        {formatKzt(totals.incomeKaspi)}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* РАСХОДЫ */}
                <Card className="p-5 border-border bg-card neon-glow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        Общий Расход
                      </p>
                      <h2 className="text-3xl font-bold text-red-400 mt-1">
                        {formatKzt(totals.expenseTotal)}
                      </h2>
                    </div>
                    <div className="p-2 bg-red-500/10 rounded-full">
                      <TrendingDown className="w-6 h-6 text-red-500" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                    <span>Δ к прошлой неделе</span>
                    <span className="font-semibold text-foreground">{totals.change.expense}</span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Wallet className="w-3 h-3" /> Наличные
                      </span>
                      <span className="font-mono text-foreground">
                        {formatKzt(totals.expenseCash)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-red-500"
                        style={{
                          width: `${totals.expenseTotal > 0 ? (totals.expenseCash / totals.expenseTotal) * 100 : 0}%`,
                        }}
                      />
                      <div
                        className="h-full bg-orange-500"
                        style={{
                          width: `${totals.expenseTotal > 0 ? (totals.expenseKaspi / totals.expenseTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <CreditCard className="w-3 h-3" /> Kaspi
                      </span>
                      <span className="font-mono text-foreground">
                        {formatKzt(totals.expenseKaspi)}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* ПРИБЫЛЬ */}
                <Card className="p-5 border border-accent/50 bg-accent/5 neon-glow flex flex-col justify-between">
                  <div>
                    <p className="text-xs text-accent/80 uppercase tracking-wider font-bold">
                      Чистая Прибыль
                    </p>
                    <h2 className="text-4xl font-bold text-yellow-400 mt-2">
                      {formatKzt(totals.profit)}
                    </h2>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-3">
                      <span>Δ к прошлой неделе</span>
                      <span className="font-semibold text-foreground">{totals.change.profit}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-accent/20">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">
                        F16 Extra (не включено)
                      </span>
                      <span className="text-sm font-bold text-purple-400">
                        {formatKzt(totals.extraTotal)}
                      </span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Деталка */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                {/* Таблица по компаниям */}
                <Card className="lg:col-span-2 p-6 border-border bg-card neon-glow">
                  <h3 className="text-sm font-bold text-foreground mb-4">
                    Разбивка по точкам
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase">
                          <th className="px-4 py-3 text-left">Точка</th>
                          <th className="px-4 py-3 text-right text-green-500">Нал</th>
                          <th className="px-4 py-3 text-right text-blue-500">Kaspi</th>
                          <th className="px-4 py-3 text-right text-foreground">Всего</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeCompanies.map((c) => {
                          const stats = totals.statsByCompany[c.id] || { cash: 0, kaspi: 0 }
                          const total = stats.cash + stats.kaspi
                          return (
                            <tr
                              key={c.id}
                              className="border-b border-white/5 hover:bg-white/5 transition-colors"
                            >
                              <td className="px-4 py-3 font-medium">{c.name}</td>
                              <td className="px-4 py-3 text-right opacity-80">
                                {formatKzt(stats.cash)}
                              </td>
                              <td className="px-4 py-3 text-right opacity-80">
                                {formatKzt(stats.kaspi)}
                              </td>
                              <td className="px-4 py-3 text-right font-bold">
                                {formatKzt(total)}
                              </td>
                            </tr>
                          )
                        })}
                        <tr className="bg-yellow-500/5">
                          <td className="px-4 py-3 font-medium text-yellow-500">
                            F16 Extra
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground text-xs" colSpan={2}>
                            отдельный учет
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-yellow-500">
                            {formatKzt(totals.extraTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* График расходов */}
                <Card className="lg:col-span-1 p-6 border-border bg-card neon-glow">
                  <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-red-400" /> Куда ушли деньги?
                  </h3>

                  {totals.expenseCategories.length === 0 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-xs">
                      Нет расходов
                    </div>
                  ) : (
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={totals.expenseCategories}
                          layout="vertical"
                          margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                        >
                          <XAxis type="number" hide />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={100}
                            tick={{ fill: '#888', fontSize: 10 }}
                          />
                          <Tooltip
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                            formatter={(val: number) => [formatKzt(val), 'Сумма']}
                          />
                          <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20}>
                            {totals.expenseCategories.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : '#ef444480'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
