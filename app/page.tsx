'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { 
  TrendingUp, 
  TrendingDown, 
  Percent, 
  Zap, 
  Clock, 
  BarChart2, 
  Brain, 
  AlertTriangle, 
  CheckCircle2, 
  Activity,
  CalendarDays,
  DollarSign 
} from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts'

// --- Типы данных ---
type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
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

type RangeType = 'today' | 'week' | 'month30' | 'currentMonth' | 'custom'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  netCash: number
  netKaspi: number
  netTotal: number
}

type AIInsight = {
  score: number
  status: 'critical' | 'warning' | 'healthy' | 'excellent'
  summary: string
  recommendation: string
  margin: number
  efficiency: number
}

type ChartPoint = {
  date: string
  income: number
  expense: number
  profit: number
}

// --- Вспомогательные функции ---
const todayISO = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const addDaysISO = (iso: string, diff: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const formatRuDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const getCurrentMonthBounds = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const firstDay = new Date(y, m, 1)
  const lastDay = new Date(y, m + 1, 0)

  const fmt = (d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return { start: fmt(firstDay), end: fmt(lastDay) }
}

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = new Date(dateFrom + 'T00:00:00')
  const dTo = new Date(dateTo + 'T00:00:00')
  const durationDays =
    Math.floor((dTo.getTime() - dFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

const getPercentageChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0
  if (current === 0) return -100
  return ((current - previous) / previous) * 100
}

const formatMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

export default function DashboardPage() {
  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('week')

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setQuickRange = (type: RangeType) => {
    const today = todayISO()

    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    } else if (type === 'month30') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    } else if (type === 'currentMonth') {
      const { start, end } = getCurrentMonthBounds()
      setDateFrom(start)
      setDateTo(end)
    }
    setRangeType(type)
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)

      const [
        { data: compData, error: compErr },
        { data: incomeData, error: incomeErr },
        { data: expenseData, error: expenseErr },
      ] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name'),
        supabase
          .from('incomes')
          .select('*')
          .gte('date', prevFrom)
          .lte('date', dateTo)
          .order('date', { ascending: false }),
        supabase
          .from('expenses')
          .select('*')
          .gte('date', prevFrom)
          .lte('date', dateTo)
          .order('date', { ascending: false }),
      ])

      if (compErr || incomeErr || expenseErr) {
        console.error('Dashboard load error', { compErr, incomeErr, expenseErr })
        setError('Ошибка загрузки данных')
        setLoading(false)
        return
      }
      setCompanies((compData || []) as Company[])
      setIncomes((incomeData || []) as IncomeRow[])
      setExpenses((expenseData || []) as ExpenseRow[])
      setLoading(false)
    }
    load()
  }, [dateFrom, dateTo])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const companyName = (id: string) => companyById[id]?.name ?? '—'
  const isExtraCompany = (companyId: string) =>
    companyById[companyId]?.code === 'extra'

  const analytics = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const getRange = (date: string): 'current' | 'previous' | null => {
      if (date >= dateFrom && date <= dateTo) return 'current'
      if (date >= prevFrom && date <= prevTo) return 'previous'
      return null
    }

    const makeTotals = (): FinancialTotals => ({
      incomeCash: 0,
      incomeKaspi: 0,
      incomeCard: 0,
      incomeTotal: 0,
      expenseCash: 0,
      expenseKaspi: 0,
      expenseTotal: 0,
      profit: 0,
      netCash: 0,
      netKaspi: 0,
      netTotal: 0,
    })

    const current: FinancialTotals = makeTotals()
    const previous: FinancialTotals = makeTotals()
    const chartMap = new Map<string, ChartPoint>()

    // Доходы
    for (const r of incomes) {
      if (isExtraCompany(r.company_id)) continue
      const range = getRange(r.date)
      if (!range) continue

      const target = range === 'current' ? current : previous
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const total = cash + kaspi + card

      if (total <= 0) continue

      target.incomeTotal += total
      target.incomeCash += cash
      target.incomeKaspi += kaspi
      target.incomeCard += card

      if (range === 'current') {
        const ex =
          chartMap.get(r.date) || {
            date: r.date,
            income: 0,
            expense: 0,
            profit: 0,
          }
        ex.income += total
        chartMap.set(r.date, ex)
      }
    }

    // Расходы
    for (const r of expenses) {
      if (isExtraCompany(r.company_id)) continue
      const range = getRange(r.date)
      if (!range) continue

      const target = range === 'current' ? current : previous
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi

      if (total <= 0) continue

      target.expenseTotal += total
      target.expenseCash += cash
      target.expenseKaspi += kaspi

      if (range === 'current') {
        const ex =
          chartMap.get(r.date) || {
            date: r.date,
            income: 0,
            expense: 0,
            profit: 0,
          }
        ex.expense += total
        chartMap.set(r.date, ex)
      }
    }

    // Итоги
    const finalizeTotals = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      t.netKaspi = t.incomeKaspi + t.incomeCard - t.expenseKaspi
      t.netTotal = t.incomeTotal - t.expenseTotal
    }

    finalizeTotals(current)
    finalizeTotals(previous)

    const margin =
      current.incomeTotal > 0
        ? (current.profit / current.incomeTotal) * 100
        : 0

    let efficiency = 0
    if (current.expenseTotal > 0) {
      efficiency = current.incomeTotal / current.expenseTotal
    } else if (current.incomeTotal > 0) {
      // если расходов нет — считаем как очень высокий ROI, но ограничиваем
      efficiency = 10
    }

    const incomeChange = getPercentageChange(
      current.incomeTotal,
      previous.incomeTotal,
    )
    const profitChange = getPercentageChange(current.profit, previous.profit)

    // Примитивный скоринг, но работает
    let score = 50
    if (margin > 20) score += 20
    if (margin > 40) score += 10
    if (incomeChange > 0) score += 10
    if (profitChange > 0) score += 10
    if (efficiency > 1.5) score += 10
    score = Math.min(100, Math.max(0, score))

    let status: AIInsight['status'] = 'healthy'
    let summary = ''
    let recommendation = ''

    if (score >= 80) {
      status = 'excellent'
      summary = 'Отличные показатели. Высокая эффективность и рост прибыли.'
      recommendation = 'Реинвестируйте часть прибыли в маркетинг или расширение.'
    } else if (score >= 50) {
      status = 'healthy'
      summary = 'Стабильная работа. Бизнес уверенно в плюсе.'
      recommendation = 'Ищите мелкие точки оптимизации, чтобы подтянуть маржу.'
    } else if (score >= 30) {
      status = 'warning'
      summary = 'Внимание: расходы заметно давят на прибыль.'
      recommendation = 'Сделайте ревизию затрат и пересмотрите слабые направления.'
    } else {
      status = 'critical'
      summary = 'Критическое состояние. Высокий риск убытков.'
      recommendation = 'Срочно режьте лишние расходы и подумайте о повышении цен.'
    }

    const chartData: ChartPoint[] = Array.from(chartMap.values())
      .map((d) => ({ ...d, profit: d.income - d.expense }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const insight: AIInsight = {
      score,
      status,
      summary,
      recommendation,
      margin,
      efficiency,
    }

    return {
      current,
      previous,
      chartData,
      insight,
    }
  }, [incomes, expenses, dateFrom, dateTo, companyById])

  const { current, previous, chartData, insight } = analytics

  const fmtPct = (val: number) => {
    const sign = val > 0 ? '+' : ''
    return `${sign}${val.toFixed(1)}%`
  }

  const transactionsCount = useMemo(
    () =>
      incomes.filter(
        (x) =>
          !isExtraCompany(x.company_id) &&
          x.date >= dateFrom &&
          x.date <= dateTo,
      ).length,
    [incomes, dateFrom, dateTo, companyById],
  )

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Хедер + Фильтры */}
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Brain className="w-8 h-8 text-purple-500" />
                AI Dashboard
              </h1>
              <p className="text-muted-foreground text-sm">
                Умная аналитика бизнеса
              </p>
            </div>

            {/* 🎯 БЛОК ФИЛЬТРОВ */}
            <div className="flex flex-col sm:flex-row items-center gap-2 w-full xl:w-auto">
              <div className="bg-card/50 border border-border/50 rounded-lg p-1 flex items-center gap-1 w-full sm:w-auto justify-center">
                <button
                  onClick={() => setQuickRange('today')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    rangeType === 'today'
                      ? 'bg-purple-600 text-white'
                      : 'hover:bg-white/5 text-muted-foreground'
                  }`}
                >
                  Сегодня
                </button>
                <button
                  onClick={() => setQuickRange('week')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    rangeType === 'week'
                      ? 'bg-purple-600 text-white'
                      : 'hover:bg-white/5 text-muted-foreground'
                  }`}
                >
                  7 дней
                </button>
                <button
                  onClick={() => setQuickRange('currentMonth')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    rangeType === 'currentMonth'
                      ? 'bg-purple-600 text-white'
                      : 'hover:bg-white/5 text-muted-foreground'
                  }`}
                >
                  <CalendarDays className="w-3 h-3" /> Этот месяц
                </button>
                <button
                  onClick={() => setQuickRange('month30')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    rangeType === 'month30'
                      ? 'bg-purple-600 text-white'
                      : 'hover:bg-white/5 text-muted-foreground'
                  }`}
                >
                  30 дней
                </button>
              </div>

              {/* Ручной выбор дат */}
              <div className="flex items-center gap-2 bg-card/30 p-1 rounded-lg border border-border/30">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value)
                    setRangeType('custom')
                  }}
                  className="bg-transparent text-xs text-foreground px-2 py-1 rounded focus:outline-none"
                />
                <span className="text-muted-foreground text-[10px]">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value)
                    setRangeType('custom')
                  }}
                  className="bg-transparent text-xs text-foreground px-2 py-1 rounded focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 🧠 БЛОК 1: AI ИНСАЙТЫ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card
              className={`lg:col-span-2 p-6 border relative overflow-hidden ${
                insight.status === 'excellent'
                  ? 'border-green-500/30 bg-green-950/10'
                  : insight.status === 'healthy'
                  ? 'border-purple-500/30 bg-purple-950/10'
                  : insight.status === 'warning'
                  ? 'border-yellow-500/30 bg-yellow-950/10'
                  : 'border-red-500/30 bg-red-950/10'
              }`}
            >
              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wider bg-white/10 border border-white/10">
                      Анализ
                    </span>
                    <span
                      className={`text-sm font-bold uppercase ${
                        insight.status === 'excellent'
                          ? 'text-green-400'
                          : insight.status === 'healthy'
                          ? 'text-purple-400'
                          : insight.status === 'warning'
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }`}
                    >
                      {insight.status === 'excellent'
                        ? 'Отлично'
                        : insight.status === 'healthy'
                        ? 'Норма'
                        : insight.status === 'warning'
                        ? 'Внимание'
                        : 'Критично'}
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold leading-tight max-w-xl">
                    {insight.summary}
                  </h2>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    Совет: {insight.recommendation}
                  </p>
                </div>
                <div className="flex items-center gap-4 min-w-[140px]">
                  <div className="text-right">
                    <div className="text-4xl font-bold">{insight.score}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      Балл
                    </div>
                  </div>
                  {insight.score > 80 ? (
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  ) : insight.score > 50 ? (
                    <Activity className="w-10 h-10 text-purple-500" />
                  ) : (
                    <AlertTriangle className="w-10 h-10 text-yellow-500" />
                  )}
                </div>
              </div>
              <div
                className={`absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl -mr-20 -mt-20 opacity-20 pointer-events-none ${
                  insight.status === 'excellent'
                    ? 'bg-green-500'
                    : 'bg-purple-600'
                }`}
              />
            </Card>

            <div className="grid grid-cols-1 gap-4">
              <Card className="p-4 border border-border bg-card flex flex-col justify-center relative overflow-hidden">
                <div className="flex justify-between items-center z-10">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Чистая Прибыль
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {formatMoney(current.profit)} ₸
                    </p>
                  </div>
                  <div
                    className={`text-right ${
                      getPercentageChange(
                        current.profit,
                        previous.profit,
                      ) >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}
                  >
                    <div className="text-sm font-bold">
                      {fmtPct(
                        getPercentageChange(
                          current.profit,
                          previous.profit,
                        ),
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, insight.margin),
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-right mt-1 text-muted-foreground">
                  Маржа: {insight.margin.toFixed(1)}%
                </p>
              </Card>

              <Card className="p-4 border border-border bg-card flex flex-col justify-center">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Коэф. Эффективности
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {insight.efficiency.toFixed(2)}x
                    </p>
                  </div>
                  <Zap className="w-6 h-6 text-purple-500 opacity-50" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  ROI: На 1₸ затрат →{' '}
                  {insight.efficiency.toFixed(2)}₸ выручки
                </p>
              </Card>
            </div>
          </div>

          {/* 📊 БЛОК 2: УМНЫЕ МЕТРИКИ */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors group">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Общий Доход
                </span>
                <TrendingUp className="w-4 h-4 text-green-500 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xl font-bold">
                {formatMoney(current.incomeTotal)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Нал:{' '}
                <span className="text-foreground">
                  {formatMoney(current.incomeCash)}
                </span>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors group">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Общий Расход
                </span>
                <TrendingDown className="w-4 h-4 text-red-500 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xl font-bold">
                {formatMoney(current.expenseTotal)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Нал:{' '}
                <span className="text-foreground">
                  {formatMoney(current.expenseCash)}
                </span>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Безнал (Kaspi + Card)
                </span>
                <DollarSign className="w-4 h-4 text-blue-500 opacity-50" />
              </div>
              <div className="text-xl font-bold">
                {formatMoney(current.incomeKaspi + current.incomeCard)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {(
                  current.incomeTotal > 0
                    ? ((current.incomeKaspi + current.incomeCard) /
                        current.incomeTotal) *
                      100
                    : 0
                ).toFixed(0)}
                % от выручки
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Остаток Нал
                </span>
                <BarChart2 className="w-4 h-4 text-emerald-500 opacity-50" />
              </div>
              <div className="text-xl font-bold">
                {formatMoney(current.netCash)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Доход (нал) − Расход (нал)
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Остаток Kaspi/Card
                </span>
                <BarChart2 className="w-4 h-4 text-sky-500 opacity-50" />
              </div>
              <div className="text-xl font-bold">
                {formatMoney(current.netKaspi)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Kaspi + Card − Расход (Kaspi)
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  Транзакций
                </span>
                <BarChart2 className="w-4 h-4 text-gray-500 opacity-50" />
              </div>
              <div className="text-xl font-bold">{transactionsCount}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Операций дохода
              </div>
            </Card>
          </div>

          {/* 📈 БЛОК 3: ГРАФИК И ЛЕНТА */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 p-6 border-border bg-card">
              <h3 className="text-sm font-semibold text-foreground mb-6 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-500" />
                Дневная динамика (Доход / Расход / Прибыль)
              </h3>
              {chartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  Нет данных
                </div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient
                          id="colorProfit"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#a855f7"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#a855f7"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        opacity={0.1}
                        stroke="#444"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v / 1000}k`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#111',
                          border: '1px solid #333',
                          borderRadius: '8px',
                        }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(val: number) => [
                          formatMoney(val) + ' ₸',
                          '',
                        ]}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="profit"
                        name="Прибыль"
                        stroke="#a855f7"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorProfit)"
                      />
                      <Line
                        type="monotone"
                        dataKey="income"
                        name="Доход"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.5}
                      />
                      <Line
                        type="monotone"
                        dataKey="expense"
                        name="Расход"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.5}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Лента событий */}
            <Card className="lg:col-span-1 p-0 border-border bg-card overflow-hidden flex flex-col">
              <div className="p-4 border-b border-white/5 bg-white/5">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  Лента событий
                </h3>
              </div>
              <div className="flex-1 overflow-auto max-h-[320px] p-2 space-y-1">
                {!loading &&
                  incomes.length === 0 &&
                  expenses.length === 0 && (
                    <p className="text-xs text-center p-4 text-muted-foreground">
                      Пусто
                    </p>
                  )}

                {[...incomes, ...expenses]
                  .filter(
                    (i) =>
                      !isExtraCompany(i.company_id) &&
                      i.date >= dateFrom &&
                      i.date <= dateTo,
                  )
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 7)
                  .map((op: any) => {
                    const isIncome = 'card_amount' in op
                    const amount = isIncome
                      ? (op.cash_amount || 0) +
                        (op.kaspi_amount || 0) +
                        (op.card_amount || 0)
                      : (op.cash_amount || 0) + (op.kaspi_amount || 0)

                    if (amount <= 0) return null

                    return (
                      <div
                        key={op.id}
                        className="group flex items-center justify-between p-3 hover:bg.white/5 hover:bg-white/5 rounded-lg transition-colors cursor-default"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              isIncome
                                ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                                : 'bg-red-500'
                            }`}
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground/90">
                              {op.category ||
                                op.comment ||
                                (isIncome ? 'Продажа' : 'Расход')}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {companyName(op.company_id)} •{' '}
                              {formatRuDate(op.date)}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-bold font-mono ${
                            isIncome ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {isIncome ? '+' : '-'}
                          {formatMoney(amount)}
                        </span>
                      </div>
                    )
                  })}
              </div>
              <div className="p-3 border-t border-white/5 bg-white/[0.02]">
                <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs h-8 text-muted-foreground hover:text-white"
                  >
                    Посмотреть все операции →
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
