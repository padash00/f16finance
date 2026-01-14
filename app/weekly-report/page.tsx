'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

// =====================
// TYPES
// =====================
type Company = { id: string; name: string; code: string | null }

type IncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type Totals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeNonCash: number
  incomeTotal: number

  expenseCash: number
  expenseKaspi: number
  expenseTotal: number

  profit: number

  // extra (за выбранную неделю)
  extraTotal: number

  // по компаниям (без extra)
  statsByCompany: Record<string, { cash: number; nonCash: number; total: number }>

  // топ расходов (за неделю)
  expenseCategories: { name: string; value: number }[]

  // прошл. неделя (для сравнения)
  prev: {
    incomeTotal: number
    expenseTotal: number
    profit: number
  }

  change: {
    income: string
    expense: string
    profit: string
  }

  metrics: {
    expenseRate: number // % расходов от выручки
    cashShare: number // % налички в выручке
    netCash: number // incomeCash - expenseCash
    netNonCash: number // incomeNonCash - expenseKaspi
    topExpenseName: string | null
    topExpenseShare: number
  }
}

// =====================
// DATE HELPERS (локально, без UTC-сдвигов)
// =====================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const getTodayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

// Пн—Вс для выбранной даты (локально)
const getWeekBounds = (dateISO: string) => {
  const d = fromISO(dateISO)
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay() // 1..7

  const monday = new Date(d)
  monday.setDate(d.getDate() - (dayOfWeek - 1))

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return { start: toISODateLocal(monday), end: toISODateLocal(sunday) }
}

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

// =====================
// COMPONENT
// =====================
export default function WeeklyReportPage() {
  const moneyFmt = useMemo(() => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }), [])
  const formatKzt = (v: number) => `${moneyFmt.format(Math.round(v))} ₸`

  // today + current week bounds (фиксируем на рендер, не дергаем каждую секунду)
  const todayISO = useMemo(() => getTodayISO(), [])
  const currentWeek = useMemo(() => getWeekBounds(todayISO), [todayISO])

  // выбранная неделя
  const [startDate, setStartDate] = useState(currentWeek.start)
  const [endDate, setEndDate] = useState(currentWeek.end)

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // улучшение: включать Extra в общий итог по желанию
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)

  // raw data (2 запроса, без 5 штук)
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([])
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([])

  // защита от гонок при быстром листании недель
  const reqIdRef = useRef(0)

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

  const isCurrentWeek = useMemo(() => startDate === currentWeek.start, [startDate, currentWeek.start])

  // запрет будущих недель (чтоб не листали в пустоту)
  const canGoNext = useMemo(() => {
    // следующая неделя стартует через +7 дней
    const nextStart = addDaysISO(startDate, 7)
    // разрешаем только если nextStart <= currentWeek.start (т.е. не в будущее)
    return nextStart <= currentWeek.start
  }, [startDate, currentWeek.start])

  // =====================
  // NAVIGATION
  // =====================
  const handleCurrentWeek = () => {
    setStartDate(currentWeek.start)
    setEndDate(currentWeek.end)
  }

  const shiftWeek = (direction: -1 | 1) => {
    if (direction === 1 && !canGoNext) return
    const nextStart = addDaysISO(startDate, direction * 7)
    const { start, end } = getWeekBounds(nextStart)
    setStartDate(start)
    setEndDate(end)
  }

  // =====================
  // LOAD COMPANIES (once)
  // =====================
  useEffect(() => {
    const loadCompanies = async () => {
      const { data, error } = await supabase.from('companies').select('id,name,code').order('name')
      if (error) {
        console.error(error)
        setError('Не удалось загрузить компании')
        return
      }
      setCompanies((data || []) as Company[])
    }
    loadCompanies()
  }, [])

  // =====================
  // LOAD DATA (2 queries total)
  // Берём диапазон: prevWeekStart .. endDate
  // =====================
  useEffect(() => {
    const load = async () => {
      if (!companies.length) return

      const myId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      const rangeFrom = addDaysISO(startDate, -7) // прошл. неделя старт
      const rangeTo = endDate

      const incomeQ = supabase
        .from('incomes')
        .select('date,company_id,cash_amount,kaspi_amount,card_amount')
        .gte('date', rangeFrom)
        .lte('date', rangeTo)

      const expenseQ = supabase
        .from('expenses')
        .select('date,company_id,category,cash_amount,kaspi_amount')
        .gte('date', rangeFrom)
        .lte('date', rangeTo)

      const [{ data: inc, error: incErr }, { data: exp, error: expErr }] = await Promise.all([
        incomeQ,
        expenseQ,
      ])

      // stale response guard
      if (myId !== reqIdRef.current) return

      if (incErr || expErr) {
        console.error({ incErr, expErr })
        setError('Не удалось загрузить данные недели')
        setLoading(false)
        return
      }

      setIncomeRows((inc || []) as IncomeRow[])
      setExpenseRows((exp || []) as ExpenseRow[])
      setLoading(false)
    }

    load()
  }, [companies.length, startDate, endDate])

  // =====================
  // PROCESS TOTALS
  // =====================
  const totals = useMemo<Totals | null>(() => {
    if (!companies.length) return null

    const prevStart = addDaysISO(startDate, -7)
    const prevEnd = addDaysISO(endDate, -7)

    // current totals (main)
    let iCash = 0
    let iKaspi = 0
    let iCard = 0
    let eCash = 0
    let eKaspi = 0

    // extra
    let extraTotal = 0

    // prev totals (main)
    let pIncome = 0
    let pExpense = 0

    // company stats (без extra)
    const statsByCompany: Record<string, { cash: number; nonCash: number; total: number }> = {}
    for (const c of activeCompanies) statsByCompany[c.id] = { cash: 0, nonCash: 0, total: 0 }

    // categories (текущая неделя)
    const catMap = new Map<string, number>()

    const isExtra = (companyId: string) => !!extraCompanyId && companyId === extraCompanyId
    const inCurrentWeek = (iso: string) => iso >= startDate && iso <= endDate
    const inPrevWeek = (iso: string) => iso >= prevStart && iso <= prevEnd

    // incomes
    for (const r of incomeRows) {
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const total = cash + kaspi + card
      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      // prev week aggregation (for comparisons)
      if (inPrevWeek(r.date)) {
        // по умолчанию extra НЕ сравниваем (как было у тебя), но если включили — тогда включаем
        if (!extra || includeExtraInTotals) pIncome += total
        continue
      }

      // current week aggregation
      if (!inCurrentWeek(r.date)) continue

      if (extra) {
        extraTotal += total
        if (!includeExtraInTotals) continue
        // если включили extra — он идёт в общий итог как обычная выручка (но без companyStats)
      }

      iCash += cash
      iKaspi += kaspi
      iCard += card

      // company stats только для “активных” компаний (без extra)
      const s = statsByCompany[r.company_id]
      if (s) {
        s.cash += cash
        s.nonCash += kaspi + card
        s.total += total
      }
    }

    // expenses
    for (const r of expenseRows) {
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const extra = isExtra(r.company_id)

      // prev week
      if (inPrevWeek(r.date)) {
        if (!extra || includeExtraInTotals) pExpense += total
        continue
      }

      // current week
      if (!inCurrentWeek(r.date)) continue

      // если extra выключен — расходы extra тоже не портят общую картину
      if (extra && !includeExtraInTotals) continue

      eCash += cash
      eKaspi += kaspi

      const catName = r.category || 'Без категории'
      catMap.set(catName, (catMap.get(catName) || 0) + total)
    }

    const incomeNonCash = iKaspi + iCard
    const incomeTotal = iCash + incomeNonCash
    const expenseTotal = eCash + eKaspi
    const profit = incomeTotal - expenseTotal

    const pProfit = pIncome - pExpense

    const expenseCategories = Array.from(catMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    const topExpense = expenseCategories[0] || null
    const expenseRate = incomeTotal > 0 ? (expenseTotal / incomeTotal) * 100 : 0
    const cashShare = incomeTotal > 0 ? (iCash / incomeTotal) * 100 : 0
    const netCash = iCash - eCash
    const netNonCash = incomeNonCash - eKaspi
    const topExpenseShare =
      expenseTotal > 0 && topExpense ? (topExpense.value / expenseTotal) * 100 : 0

    return {
      incomeCash: iCash,
      incomeKaspi: iKaspi,
      incomeCard: iCard,
      incomeNonCash,
      incomeTotal,

      expenseCash: eCash,
      expenseKaspi: eKaspi,
      expenseTotal,

      profit,

      extraTotal,
      statsByCompany,
      expenseCategories,

      prev: {
        incomeTotal: pIncome,
        expenseTotal: pExpense,
        profit: pProfit,
      },

      change: {
        income: pctChange(incomeTotal, pIncome),
        expense: pctChange(expenseTotal, pExpense),
        profit: pctChange(profit, pProfit),
      },

      metrics: {
        expenseRate,
        cashShare,
        netCash,
        netNonCash,
        topExpenseName: topExpense?.name ?? null,
        topExpenseShare,
      },
    }
  }, [
    companies.length,
    activeCompanies,
    extraCompanyId,
    includeExtraInTotals,
    startDate,
    endDate,
    incomeRows,
    expenseRows,
  ])

  // =====================
  // UI
  // =====================
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          {/* Header + nav */}
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

              <div className="px-2 text-center min-w-[170px]">
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
                disabled={!canGoNext}
                className="hover:bg-white/10 w-8 h-8 disabled:opacity-40 disabled:hover:bg-transparent"
                title={!canGoNext ? 'Будущие недели закрыты. Мы же не ванги.' : 'Следующая неделя'}
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
              {/* Toggle Extra */}
              {extraCompanyId && (
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setIncludeExtraInTotals((v) => !v)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
                      includeExtraInTotals
                        ? 'border-red-400 text-red-400 bg-red-500/10'
                        : 'border-border text-muted-foreground hover:bg-white/5'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        includeExtraInTotals ? 'bg-red-400' : 'bg-muted-foreground/50'
                      }`}
                    />
                    {includeExtraInTotals ? 'F16 Extra включён в итоги' : 'F16 Extra НЕ включать в итоги'}
                  </button>

                  {!includeExtraInTotals && totals.extraTotal > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Extra отдельно: <span className="text-foreground font-semibold">{formatKzt(totals.extraTotal)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Smart line */}
              <Card className="p-4 border-border bg-card neon-glow">
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Расходы/выручка:{' '}
                    <b className={totals.metrics.expenseRate > 80 ? 'text-red-300' : 'text-foreground'}>
                      {totals.metrics.expenseRate.toFixed(1)}%
                    </b>
                  </span>

                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Доля налички: <b className="text-foreground">{totals.metrics.cashShare.toFixed(1)}%</b>
                  </span>

                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Сальдо нал:{' '}
                    <b className={totals.metrics.netCash >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                      {formatKzt(totals.metrics.netCash)}
                    </b>
                  </span>

                  <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    Сальдо безнал:{' '}
                    <b className={totals.metrics.netNonCash >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                      {formatKzt(totals.metrics.netNonCash)}
                    </b>
                  </span>

                  {totals.metrics.topExpenseName && (
                    <span className="px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                      Топ расход: <b className="text-foreground">{totals.metrics.topExpenseName}</b>{' '}
                      <span className="text-muted-foreground">({totals.metrics.topExpenseShare.toFixed(1)}%)</span>
                    </span>
                  )}
                </div>
              </Card>

              {/* Main cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* INCOME */}
                <Card className="p-5 border-border bg-card neon-glow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        Общий доход
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
                      <span className="font-mono text-foreground">{formatKzt(totals.incomeCash)}</span>
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
                      <div
                        className="h-full bg-indigo-500"
                        style={{
                          width: `${totals.incomeTotal > 0 ? (totals.incomeCard / totals.incomeTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>

                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <CreditCard className="w-3 h-3" /> Безнал (Kaspi + Карта)
                      </span>
                      <span className="font-mono text-foreground">{formatKzt(totals.incomeNonCash)}</span>
                    </div>

                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Kaspi</span>
                      <span className="font-mono text-foreground">{formatKzt(totals.incomeKaspi)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Карта</span>
                      <span className="font-mono text-foreground">{formatKzt(totals.incomeCard)}</span>
                    </div>
                  </div>
                </Card>

                {/* EXPENSE */}
                <Card className="p-5 border-border bg-card neon-glow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        Общий расход
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
                      <span className="font-mono text-foreground">{formatKzt(totals.expenseCash)}</span>
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
                      <span className="font-mono text-foreground">{formatKzt(totals.expenseKaspi)}</span>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      * Если хочешь “расходы по карте” — добавим `card_amount` в expenses.
                    </div>
                  </div>
                </Card>

                {/* PROFIT */}
                <Card className="p-5 border border-accent/50 bg-accent/5 neon-glow flex flex-col justify-between">
                  <div>
                    <p className="text-xs text-accent/80 uppercase tracking-wider font-bold">Чистая прибыль</p>
                    <h2 className="text-4xl font-bold text-yellow-400 mt-2">{formatKzt(totals.profit)}</h2>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-3">
                      <span>Δ к прошлой неделе</span>
                      <span className="font-semibold text-foreground">{totals.change.profit}</span>
                    </div>
                  </div>

                  {extraCompanyId && (
                    <div className="mt-4 pt-4 border-t border-accent/20">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">
                          F16 Extra {includeExtraInTotals ? '(включено)' : '(не включено)'}
                        </span>
                        <span className="text-sm font-bold text-purple-400">{formatKzt(totals.extraTotal)}</span>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* Details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                {/* By company */}
                <Card className="lg:col-span-2 p-6 border-border bg-card neon-glow">
                  <h3 className="text-sm font-bold text-foreground mb-4">Разбивка по точкам</h3>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase">
                          <th className="px-4 py-3 text-left">Точка</th>
                          <th className="px-4 py-3 text-right text-green-500">Нал</th>
                          <th className="px-4 py-3 text-right text-blue-500">Безнал</th>
                          <th className="px-4 py-3 text-right text-foreground">Всего</th>
                          <th className="px-4 py-3 text-right text-muted-foreground">Доля</th>
                        </tr>
                      </thead>

                      <tbody>
                        {activeCompanies.map((c) => {
                          const s = totals.statsByCompany[c.id] || { cash: 0, nonCash: 0, total: 0 }
                          const share = totals.incomeTotal > 0 ? (s.total / totals.incomeTotal) * 100 : 0

                          return (
                            <tr
                              key={c.id}
                              className="border-b border-white/5 hover:bg-white/5 transition-colors"
                            >
                              <td className="px-4 py-3 font-medium">{c.name}</td>
                              <td className="px-4 py-3 text-right opacity-80">{formatKzt(s.cash)}</td>
                              <td className="px-4 py-3 text-right opacity-80">{formatKzt(s.nonCash)}</td>
                              <td className="px-4 py-3 text-right font-bold">{formatKzt(s.total)}</td>
                              <td className="px-4 py-3 text-right text-muted-foreground">
                                {share.toFixed(1)}%
                              </td>
                            </tr>
                          )
                        })}

                        {extraCompanyId && (
                          <tr className="bg-yellow-500/5">
                            <td className="px-4 py-3 font-medium text-yellow-500">F16 Extra</td>
                            <td className="px-4 py-3 text-right text-muted-foreground text-xs" colSpan={3}>
                              {includeExtraInTotals ? 'включено в итоги' : 'отдельный учёт'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-yellow-500">
                              {formatKzt(totals.extraTotal)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Expense chart */}
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
                            width={110}
                            tick={{ fill: '#888', fontSize: 10 }}
                          />
                          <Tooltip
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                            formatter={(val: any) => [formatKzt(Number(val)), 'Сумма']}
                          />
                          <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20}>
                            {totals.expenseCategories.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={index === 0 ? '#ef4444' : '#ef444480'}
                              />
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
