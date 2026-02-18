'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  BarChart2,
  Brain,
  AlertTriangle,
  CheckCircle2,
  Activity,
  CalendarDays,
  DollarSign,
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts'

// =========================
// TYPES (по твоей БД)
// =========================
type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  shift: string | null
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
  operator_id: string | null
  operator_name: string | null
  created_at: string | null
  created_by: string | null
  is_virtual: boolean | null
}

type ExpenseRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  operator_id: string | null
  created_at: string | null
}

type RangeType = 'today' | 'week' | 'month30' | 'currentMonth' | 'custom'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
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

type FeedItem = {
  id: string
  date: string
  company_id: string
  kind: 'income' | 'expense'
  title: string
  amount: number
}

// =========================
// DATE HELPERS (локально)
// =========================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const formatRuDate = (iso: string) => {
  if (!iso) return ''
  const d = fromISO(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const getCurrentMonthBounds = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const firstDay = new Date(y, m, 1)
  const lastDay = new Date(y, m + 1, 0)
  return { start: toISODateLocal(firstDay), end: toISODateLocal(lastDay) }
}

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = fromISO(dateFrom)
  const dTo = fromISO(dateTo)
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

// =========================
// MATH / FORMAT
// =========================
const getPercentageChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0
  if (current === 0) return -100
  return ((current - previous) / previous) * 100
}

const fmtPctLabel = (val: number) => {
  if (!Number.isFinite(val)) return '—'
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}

const tooltipStyles = {
  contentStyle: {
    backgroundColor: '#111',
    border: '1px solid #333',
    borderRadius: 8,
  },
  itemStyle: { color: '#fff' },
} as const

export default function DashboardPage() {
  const moneyFmt = useMemo(() => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }), [])
  const formatMoney = useCallback((v: number) => moneyFmt.format(v), [moneyFmt])

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(() => todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('week')

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // защита от гонок запросов
  const reqIdRef = useRef(0)

  // если даты перевернули — чиним
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  const setQuickRange = useCallback((type: RangeType) => {
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
  }, [])

  // ======= ПАГИНАЦИЯ Supabase (чтобы реально тянуть “всё”) =======
  const fetchAllPaged = useCallback(
    async <T,>(
      table: 'incomes' | 'expenses',
      select: string,
      from: string,
      to: string,
      pageSize = 1000,
      hardCap = 20000,
    ): Promise<{ rows: T[]; err: any }> => {
      const all: T[] = []
      let fromIdx = 0

      while (all.length < hardCap) {
        const toIdx = fromIdx + pageSize - 1
        const q = supabase
          .from(table)
          .select(select)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: false })
          .range(fromIdx, toIdx)

        const { data, error } = await q
        if (error) return { rows: [], err: error }

        const chunk = (data || []) as T[]
        all.push(...chunk)

        if (chunk.length < pageSize) break
        fromIdx += pageSize
      }

      return { rows: all, err: null }
    },
    [],
  )

  // =========================
  // LOAD: companies + incomes + expenses
  // =========================
  useEffect(() => {
    const myReqId = ++reqIdRef.current
    let alive = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)

        const compPromise = supabase.from('companies').select('id,name,code').order('name')

        const incomesPromise = fetchAllPaged<IncomeRow>(
          'incomes',
          'id,date,company_id,shift,zone,cash_amount,kaspi_amount,online_amount,card_amount,comment,operator_id,operator_name,created_at,created_by,is_virtual',
          prevFrom,
          dateTo,
        )

        const expensesPromise = fetchAllPaged<ExpenseRow>(
          'expenses',
          'id,date,company_id,category,cash_amount,kaspi_amount,comment,created_at,operator_id',
          prevFrom,
          dateTo,
        )

        const [compRes, incRes, expRes] = await Promise.all([compPromise, incomesPromise, expensesPromise])

        if (!alive) return
        if (myReqId !== reqIdRef.current) return

        if (compRes.error || incRes.err || expRes.err) {
          console.error('Dashboard load error', {
            compErr: compRes.error,
            incomeErr: incRes.err,
            expenseErr: expRes.err,
          })
          setError('Ошибка загрузки данных')
          setLoading(false)
          return
        }

        setCompanies((compRes.data || []) as Company[])
        setIncomes(incRes.rows)
        setExpenses(expRes.rows)
        setLoading(false)
      } catch (e) {
        console.error('Dashboard load fatal', e)
        setError('Ошибка загрузки данных')
        setLoading(false)
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [dateFrom, dateTo, fetchAllPaged])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const companyName = useCallback((id: string) => companyById[id]?.name ?? '—', [companyById])

  // =========================
  // ANALYTICS
  // =========================
  const analytics = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const inCurrent = (date: string) => date >= dateFrom && date <= dateTo
    const inPrev = (date: string) => date >= prevFrom && date <= prevTo

    const makeTotals = (): FinancialTotals => ({
      incomeCash: 0,
      incomeKaspi: 0,
      incomeOnline: 0,
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

    // график: заполняем все дни
    const chartMap = new Map<string, ChartPoint>()
    {
      let d = fromISO(dateFrom)
      const end = fromISO(dateTo)
      while (d.getTime() <= end.getTime()) {
        const iso = toISODateLocal(d)
        chartMap.set(iso, { date: iso, income: 0, expense: 0, profit: 0 })
        d.setDate(d.getDate() + 1)
      }
    }

    for (const r of incomes) {
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)
      const total = cash + kaspi + online + card
      if (total <= 0) continue

      if (inCurrent(r.date)) {
        current.incomeTotal += total
        current.incomeCash += cash
        current.incomeKaspi += kaspi
        current.incomeOnline += online
        current.incomeCard += card
        const p = chartMap.get(r.date)
        if (p) p.income += total
      } else if (inPrev(r.date)) {
        previous.incomeTotal += total
        previous.incomeCash += cash
        previous.incomeKaspi += kaspi
        previous.incomeOnline += online
        previous.incomeCard += card
      }
    }

    for (const r of expenses) {
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      if (inCurrent(r.date)) {
        current.expenseTotal += total
        current.expenseCash += cash
        current.expenseKaspi += kaspi
        const p = chartMap.get(r.date)
        if (p) p.expense += total
      } else if (inPrev(r.date)) {
        previous.expenseTotal += total
        previous.expenseCash += cash
        previous.expenseKaspi += kaspi
      }
    }

    const finalize = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      // kaspi-side: kaspi + online + card - kaspi расход
      t.netKaspi = t.incomeKaspi + t.incomeOnline + t.incomeCard - t.expenseKaspi
      t.netTotal = t.profit
    }
    finalize(current)
    finalize(previous)

    for (const p of chartMap.values()) p.profit = p.income - p.expense

    const chartData: ChartPoint[] = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    const margin = current.incomeTotal > 0 ? (current.profit / current.incomeTotal) * 100 : 0
    const efficiency =
      current.expenseTotal > 0 ? current.incomeTotal / current.expenseTotal : current.incomeTotal > 0 ? 10 : 0

    const incomeChange = getPercentageChange(current.incomeTotal, previous.incomeTotal)
    const profitChange = getPercentageChange(current.profit, previous.profit)

    let score = 50
    score += Math.min(25, Math.max(-25, margin))
    score += incomeChange > 0 ? 6 : -6
    score += profitChange > 0 ? 10 : -10
    if (efficiency > 1.2) score += 6
    if (efficiency < 1.05 && current.incomeTotal > 0) score -= 8
    if (current.profit < 0) score -= 20
    score = Math.min(100, Math.max(0, Math.round(score)))

    let status: AIInsight['status'] = 'healthy'
    let summary = ''
    let recommendation = ''

    if (score >= 80) {
      status = 'excellent'
      summary = 'Отличные показатели: вы в плюсе и растёте.'
      recommendation = 'Закрепляйте лучшее: усиливайте топ-часы/зоны, слабое — оптимизируйте.'
    } else if (score >= 55) {
      status = 'healthy'
      summary = 'Устойчивая работа: прибыль есть, всё под контролем.'
      recommendation = 'Поднимайте маржу: пересмотрите цены/пакеты и подрежьте “тихие” расходы.'
    } else if (score >= 35) {
      status = 'warning'
      summary = 'Прибыль под давлением: расходы заметно съедают выручку.'
      recommendation = 'Ревизия затрат + фокус на прибыльные позиции. Остальное — на паузу.'
    } else {
      status = 'critical'
      summary = 'Риск убытков: вы слишком близко к минусу.'
      recommendation = 'Срочно: резать лишнее, проверить цены/скидки, усилить загрузку пиков.'
    }

    return {
      current,
      previous,
      chartData,
      insight: { score, status, summary, recommendation, margin, efficiency },
    }
  }, [incomes, expenses, dateFrom, dateTo])

  const { current, previous, chartData, insight } = analytics
  const incomeDelta = getPercentageChange(current.incomeTotal, previous.incomeTotal)
  const profitDelta = getPercentageChange(current.profit, previous.profit)

  const transactionsCount = useMemo(() => {
    const inc = incomes.filter((x) => {
      if (x.date < dateFrom || x.date > dateTo) return false
      const amount =
        Number(x.cash_amount || 0) +
        Number(x.kaspi_amount || 0) +
        Number(x.online_amount || 0) +
        Number(x.card_amount || 0)
      return amount > 0
    }).length

    const exp = expenses.filter((x) => {
      if (x.date < dateFrom || x.date > dateTo) return false
      const amount = Number(x.cash_amount || 0) + Number(x.kaspi_amount || 0)
      return amount > 0
    }).length

    return inc + exp
  }, [incomes, expenses, dateFrom, dateTo])

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []

    for (const r of incomes) {
      if (r.date < dateFrom || r.date > dateTo) continue
      const amount =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.online_amount || 0) +
        Number(r.card_amount || 0)
      if (amount <= 0) continue

      items.push({
        id: r.id,
        date: r.date,
        company_id: r.company_id,
        kind: 'income',
        title: r.comment || 'Доход',
        amount,
      })
    }

    for (const r of expenses) {
      if (r.date < dateFrom || r.date > dateTo) continue
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (amount <= 0) continue

      items.push({
        id: r.id,
        date: r.date,
        company_id: r.company_id,
        kind: 'expense',
        title: r.category || r.comment || 'Расход',
        amount,
      })
    }

    items.sort((a, b) => (b.date === a.date ? b.amount - a.amount : b.date.localeCompare(a.date)))
    return items.slice(0, 7)
  }, [incomes, expenses, dateFrom, dateTo])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          Загрузка дэшборда...
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-[#050505] text-foreground">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-red-400">
          {error}
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Header + Filters */}
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Brain className="w-8 h-8 text-purple-500" />
                AI Dashboard
              </h1>
              <p className="text-muted-foreground text-sm">Умная аналитика по выручке, расходам и прибыли</p>

              <div className="mt-2 text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                  Период: <span className="text-foreground">{formatRuDate(dateFrom)}</span> —{' '}
                  <span className="text-foreground">{formatRuDate(dateTo)}</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                  Компаний: <span className="text-foreground">{companies.length}</span> • Доходов:{' '}
                  <span className="text-foreground">{incomes.length}</span> • Расходов:{' '}
                  <span className="text-foreground">{expenses.length}</span>
                </span>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-2 w-full xl:w-auto">
              <div className="flex flex-col sm:flex-row items-center gap-2 w-full xl:w-auto">
                <div className="bg-card/50 border border-border/50 rounded-lg p-1 flex items-center gap-1 w-full sm:w-auto justify-center">
                  <button
                    onClick={() => setQuickRange('today')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      rangeType === 'today' ? 'bg-purple-600 text-white' : 'hover:bg-white/5 text-muted-foreground'
                    }`}
                  >
                    Сегодня
                  </button>
                  <button
                    onClick={() => setQuickRange('week')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      rangeType === 'week' ? 'bg-purple-600 text-white' : 'hover:bg-white/5 text-muted-foreground'
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
                      rangeType === 'month30' ? 'bg-purple-600 text-white' : 'hover:bg-white/5 text-muted-foreground'
                    }`}
                  >
                    30 дней
                  </button>
                </div>

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
          </div>

          {/* Block 1: AI Insight */}
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
                      Анализ периода
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

                  <h2 className="text-2xl font-semibold leading-tight max-w-xl">{insight.summary}</h2>

                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    Совет: {insight.recommendation}
                  </p>

                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span>
                      Маржа: <span className="text-foreground">{insight.margin.toFixed(1)}%</span>
                    </span>
                    <span>
                      Рост выручки:{' '}
                      <span className={incomeDelta >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {fmtPctLabel(incomeDelta)}
                      </span>
                    </span>
                    <span>
                      Рост прибыли:{' '}
                      <span className={profitDelta >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {fmtPctLabel(profitDelta)}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 min-w-[140px]">
                  <div className="text-right">
                    <div className="text-4xl font-bold">{insight.score}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Балл</div>
                  </div>
                  {insight.score >= 80 ? (
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  ) : insight.score >= 55 ? (
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
                    : insight.status === 'healthy'
                      ? 'bg-purple-600'
                      : insight.status === 'warning'
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                }`}
              />
            </Card>

            <div className="grid grid-cols-1 gap-4">
              <Card className="p-4 border border-border bg-card flex flex-col justify-center">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Чистая прибыль</p>
                    <p className="text-2xl font-bold text-white">{formatMoney(current.profit)} ₸</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Прошлый период: <span className="text-foreground">{formatMoney(previous.profit)} ₸</span>
                    </p>
                  </div>
                  <div className={`text-right ${profitDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div className="text-sm font-bold">{fmtPctLabel(profitDelta)}</div>
                  </div>
                </div>

                <div className="mt-3 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-500"
                    style={{ width: `${Math.min(100, Math.max(0, insight.margin))}%` }}
                  />
                </div>

                <p className="text-[10px] text-right mt-1 text-muted-foreground">Маржа: {insight.margin.toFixed(1)}%</p>
              </Card>

              <Card className="p-4 border border-border bg-card flex flex-col justify-center">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Коэф. эффективности</p>
                    <p className="text-2xl font-bold text-white">{insight.efficiency.toFixed(2)}x</p>
                  </div>
                  <Zap className="w-6 h-6 text-purple-500 opacity-50" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  На 1₸ затрат → <span className="text-foreground">{insight.efficiency.toFixed(2)}₸</span> выручки
                </p>
              </Card>
            </div>
          </div>

          {/* Block 2: Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors group">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Общий доход</span>
                <TrendingUp className="w-4 h-4 text-green-500 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xl font-bold text-green-400">{formatMoney(current.incomeTotal)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Нал: <span className="text-foreground">{formatMoney(current.incomeCash)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Прошлый: <span className="text-foreground">{formatMoney(previous.incomeTotal)} ₸</span>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors group">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Общий расход</span>
                <TrendingDown className="w-4 h-4 text-red-500 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xl font-bold text-red-400">{formatMoney(current.expenseTotal)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Нал: <span className="text-foreground">{formatMoney(current.expenseCash)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Прошлый: <span className="text-foreground">{formatMoney(previous.expenseTotal)} ₸</span>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Безнал (Kaspi+Online+Card)</span>
                <DollarSign className="w-4 h-4 text-blue-500 opacity-50" />
              </div>
              <div className="text-xl font-bold text-foreground">
                {formatMoney(current.incomeKaspi + current.incomeOnline + current.incomeCard)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {(
                  current.incomeTotal > 0
                    ? ((current.incomeKaspi + current.incomeOnline + current.incomeCard) / current.incomeTotal) * 100
                    : 0
                ).toFixed(0)}
                % от выручки
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Остаток нал</span>
                <BarChart2 className="w-4 h-4 text-emerald-500 opacity-50" />
              </div>
              <div className={`text-xl font-bold ${current.netCash >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatMoney(current.netCash)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Доход(нал) − Расход(нал)</div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Остаток Kaspi/Online/Card</span>
                <BarChart2 className="w-4 h-4 text-sky-500 opacity-50" />
              </div>
              <div className={`text-xl font-bold ${current.netKaspi >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
                {formatMoney(current.netKaspi)} ₸
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Безнал − Расход(Kaspi)</div>
            </Card>

            <Card className="p-4 border-border bg-card/50 hover:bg-card transition-colors">
              <div className="flex justify-between mb-2">
                <span className="text-xs text-muted-foreground">Операций</span>
                <BarChart2 className="w-4 h-4 text-gray-500 opacity-50" />
              </div>
              <div className="text-xl font-bold">{transactionsCount}</div>
              <div className="text-[10px] text-muted-foreground mt-1">Доход + расход за период</div>
            </Card>
          </div>

          {/* Block 3: Chart + Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 p-6 border-border bg-card">
              <h3 className="text-sm font-semibold text-foreground mb-6 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-500" />
                Дневная динамика (Доход / Расход / Прибыль)
              </h3>

              {chartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Нет данных</div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#444" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => String(v).slice(5)}
                      />
                      <YAxis
                        stroke="#666"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                      />
                      <Tooltip
                        {...tooltipStyles}
                        formatter={(val: number) => [`${formatMoney(Number(val))} ₸`, '']}
                        labelFormatter={(label: string) => formatRuDate(label)}
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
                      <Line type="monotone" dataKey="income" name="Доход" stroke="#22c55e" strokeWidth={2} dot={false} strokeOpacity={0.7} />
                      <Line type="monotone" dataKey="expense" name="Расход" stroke="#ef4444" strokeWidth={2} dot={false} strokeOpacity={0.7} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="mt-3 text-[11px] text-muted-foreground">
                Подсказка: если прибыль “пилит” вниз — смотри расходы, а не звёзды.
              </div>
            </Card>

            <Card className="lg:col-span-1 p-0 border-border bg-card overflow-hidden flex flex-col">
              <div className="p-4 border-b border-white/5 bg-white/5">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  Лента событий
                </h3>
                <p className="text-[11px] text-muted-foreground">Последние операции дохода и расхода</p>
              </div>

              <div className="flex-1 overflow-auto max-h-[320px] p-2 space-y-1">
                {feedItems.length === 0 ? (
                  <p className="text-xs text-center p-4 text-muted-foreground">Пусто</p>
                ) : (
                  feedItems.map((op) => (
                    <div
                      key={op.id}
                      className="group flex items-center justify-between p-3 hover:bg-white/5 rounded-lg transition-colors cursor-default"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            op.kind === 'income'
                              ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                              : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                          }`}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground/90">{op.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {companyName(op.company_id)} • {formatRuDate(op.date)}
                          </span>
                        </div>
                      </div>

                      <span className={`text-xs font-bold font-mono ${op.kind === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                        {op.kind === 'income' ? '+' : '-'}
                        {formatMoney(op.amount)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-white/5 bg-white/[0.02]">
                <Link href={`/income?from=${dateFrom}&to=${dateTo}`}>
                  <Button variant="ghost" size="sm" className="w-full text-xs h-8 text-muted-foreground hover:text-white">
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
