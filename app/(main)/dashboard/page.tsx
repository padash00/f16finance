'use client'

/**
 * Главный дашборд: «как идут дела и что требует внимания».
 *
 * Цифры считает сервер (`/api/admin/reports/bundle`, rows=0) — тем же расчётом,
 * что /reports. Раньше страница тянула сырые доходы и расходы и складывала их
 * сама: доходы обрезались на 1000 строк (квартал и год выходили неполными),
 * «структура доходов» складывала два периода (доли больше 100%), а прогноз был
 * своей регрессией с достоверностью 5% и спорил с отчётами. Глубокий разбор
 * периода — на /reports, сюда ведёт ссылка.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Cake,
  CalendarClock,
  ClipboardList,
  Gauge,
  History,
  LayoutDashboard,
  Package,
  Receipt,
  Sparkles,
  Store,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { CardSkeleton, StatGridSkeleton } from '@/components/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { useApiCache } from '@/lib/client/use-api-cache'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import type { ExpenseArticle } from '@/lib/reports/expense-groups'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { computeMonthEndForecast, type ForecastHints } from '@/lib/reports/forecast-hybrid'
import type { ReportBundleAggregate } from '@/lib/reports/from-api-aggregate'

import { COLORS, DateUtils, Formatters, type CategoryData, type ChartPoint } from './chart-types'

/**
 * Графики грузятся отдельно и после первой отрисовки: библиотека весит 382 КБ.
 * `ssr: false` обязателен — графики меряют ширину контейнера, на сервере её нет.
 */
const chartFallback = (height: string) => (
  <div className={`${height} animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/50`} />
)

const ChartCard = dynamic(() => import('./charts').then((m) => m.ChartCard), {
  ssr: false,
  loading: () => chartFallback('h-96'),
})

const CategoryPie = dynamic(() => import('./charts').then((m) => m.CategoryPie), {
  ssr: false,
  loading: () => chartFallback('h-72'),
})

// ==================== TYPES ====================

type Company = { id: string; name: string; code?: string | null }

type RangeType = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

type Metric = 'income' | 'expense' | 'profit'

type BundleData = {
  asOf: string
  aggregate: ReportBundleAggregate
  expenseByGroup?: ExpenseArticle[]
  forecastHints: ForecastHints | null
}

type Totals = ReportBundleAggregate['totalsCur']

type IncomeFeedRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
}

type ExpenseFeedRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type NotificationGroup = {
  id: string
  count: number
  href: string
  items?: Array<{ id: string; title: string; subtitle?: string | null }>
}

type KpiPlan = {
  period_kind: string
  metric: string
  period_start: string
  period_end: string
  target_amount: number
  fact_value: number
  achievement_pct: number
}

type OnShiftPoint = {
  open: { operatorName: string; shiftType: string; openedAt: string } | null
  scheduled: Array<{ date: string; shiftType: string; operatorName: string }>
}

type Anomaly = { type: 'spike' | 'drop'; date: string; description: string; severity: 'low' | 'medium' | 'high' }

type FeedItem = { id: string; date: string; kind: 'income' | 'expense'; title: string; subtitle: string; amount: number }

type PointSummary = {
  id: string
  name: string
  income: number
  expense: number
  profit: number
  margin: number | null
  prevIncome: number
  prevProfit: number
  daily: number[]
}

type ScoreStatus = 'excellent' | 'good' | 'warning' | 'critical'

type ScoreResult = {
  score: number
  status: ScoreStatus
  parts: Array<{ label: string; detail: string; points: number }>
}

// ==================== LOGIC ====================

const monthEndISO = (from: string) => {
  const d = DateUtils.fromISO(from)
  return DateUtils.toISODateLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «к прошлой субботе» / «к прошлому понедельнику» — по дню недели сегодня */
function sameWeekdayLabel(iso: string) {
  const forms = [
    'к прошлому воскресенью',
    'к прошлому понедельнику',
    'к прошлому вторнику',
    'к прошлой среде',
    'к прошлому четвергу',
    'к прошлой пятнице',
    'к прошлой субботе',
  ]
  return forms[DateUtils.fromISO(iso).getDay()]
}

const shiftLabel = (shiftType: string) => (shiftType === 'night' ? 'ночь' : shiftType === 'day' ? 'день' : 'смена')

function detectAnomalies(points: ChartPoint[], threshold = 2.5): Anomaly[] {
  const vals = points.map((p) => p.income ?? 0).filter((v) => v > 0)
  if (vals.length < 6) return []
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / vals.length
  const std = Math.sqrt(variance) || 1

  const out: Anomaly[] = []
  for (const p of points) {
    const income = p.income ?? 0
    if (income <= 0) continue
    const z = Math.abs((income - mean) / std)
    if (z > threshold) {
      const type = income > mean ? 'spike' : 'drop'
      out.push({
        type,
        date: p.date,
        severity: z > 4 ? 'high' : z > 3 ? 'medium' : 'low',
        description: `${type === 'spike' ? 'Всплеск' : 'Падение'} дохода: ${Formatters.moneyDetailed(income)}`,
      })
    }
  }
  return out.slice(0, 3)
}

/**
 * Оценка периода 0–100. Это формула, а не «ИИ», поэтому показываем, из чего
 * она сложилась: база 50 и баллы за маржу, динамику прибыли и доход на 1 ₸ расхода.
 */
function scorePeriod(current: Totals, previous: Totals): ScoreResult {
  const margin = current.totalIncome ? (current.profit / current.totalIncome) * 100 : 0
  let marginPoints = 0
  if (margin > 30) marginPoints = 20
  else if (margin > 20) marginPoints = 15
  else if (margin > 10) marginPoints = 10
  else if (margin > 5) marginPoints = 5
  else if (margin < 0) marginPoints = -20

  const growth = previous.profit ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100 : 0
  let growthPoints = 0
  if (growth > 20) growthPoints = 20
  else if (growth > 10) growthPoints = 15
  else if (growth > 0) growthPoints = 10
  else if (growth < -10) growthPoints = -15

  const perExpense = current.totalExpense ? current.totalIncome / current.totalExpense : current.totalIncome ? 10 : 0
  let efficiencyPoints = 0
  if (perExpense > 2) efficiencyPoints = 15
  else if (perExpense > 1.5) efficiencyPoints = 10
  else if (perExpense > 1.2) efficiencyPoints = 5
  else if (perExpense < 0.8) efficiencyPoints = -10

  const score = Math.max(0, Math.min(100, 50 + marginPoints + growthPoints + efficiencyPoints))
  const status: ScoreStatus = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'warning' : 'critical'

  return {
    score,
    status,
    parts: [
      { label: 'Маржа', detail: `${margin.toFixed(1)}%`, points: marginPoints },
      {
        label: 'Прибыль к прошлому периоду',
        detail: previous.profit ? `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%` : 'нет базы',
        points: growthPoints,
      },
      { label: 'Доход на 1 ₸ расхода', detail: `${perExpense.toFixed(2)} ₸`, points: efficiencyPoints },
    ],
  }
}

const STATUS_LABEL: Record<ScoreStatus, string> = {
  excellent: 'Отлично',
  good: 'Нормально',
  warning: 'Внимание',
  critical: 'Плохо',
}

const STATUS_TONE: Record<ScoreStatus, string> = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  good: 'text-amber-600 dark:text-amber-400',
  warning: 'text-orange-600 dark:text-orange-400',
  critical: 'text-rose-600 dark:text-rose-400',
}

const STATUS_ADVICE: Record<ScoreStatus, string> = {
  excellent: 'Прибыль и динамика в хорошей зоне.',
  good: 'Результат нормальный — стоит посмотреть крупные статьи расходов.',
  warning: 'Маржа или динамика проседают — проверьте расходы и выручку по точкам.',
  critical: 'Период убыточный или резко хуже прошлого — нужен разбор расходов.',
}

/** Цвет изменения: рост хорош для дохода и прибыли и плох для расхода */
function changeTone(current: number, previous: number, goodWhenUp: boolean) {
  const change = Formatters.percentChange(current, previous)
  if (change.text === '—') return { text: change.text, className: 'text-muted-foreground' }
  const good = change.positive === goodWhenUp
  return { text: change.text, className: good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400' }
}

// ==================== PAGE ====================

export default function DashboardPage() {
  const cashLabels = useCashlessLabels()
  const today = DateUtils.todayISO()
  const sameDayLastWeek = DateUtils.addDaysISO(today, -7)
  const [dateFrom, setDateFrom] = useState(() => DateUtils.monthStartISO())
  const [dateTo, setDateTo] = useState(() => DateUtils.todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('month')
  const [metric, setMetric] = useState<Metric>('profit')
  const [showMovingAvg, setShowMovingAvg] = useState(true)
  const [includeExtra, setIncludeExtra] = useState(false)

  const extra = includeExtra ? '1' : '0'
  const isCurrentMonth = rangeType === 'month'
  const monthEnd = monthEndISO(dateFrom)
  const bundleUrl = (from: string, to: string) =>
    `/api/admin/reports/bundle?from=${from}&to=${to}&group=day&include_extra=${extra}&rows=0&as_of=${today}`

  // ---------- data ----------
  const main = useApiCache<BundleData>(bundleUrl(dateFrom, dateTo))
  // Прогноз на конец месяца считается по полному месяцу — тем же расчётом, что /reports
  const monthBundle = useApiCache<BundleData>(bundleUrl(dateFrom, monthEnd), { enabled: isCurrentMonth })
  const todayBundle = useApiCache<BundleData>(bundleUrl(today, today))
  const lastWeekBundle = useApiCache<BundleData>(bundleUrl(sameDayLastWeek, sameDayLastWeek))
  const companiesRes = useApiCache<Company[]>('/api/admin/companies')
  const onShift = useApiCache<{ today: string; points: Record<string, OnShiftPoint> }>(`/api/admin/dashboard/on-shift?date=${today}`)
  // Лента: последние операции, а не тысячи строк периода
  const incomesFeed = useApiCache<IncomeFeedRow[]>(`/api/admin/incomes?from=${dateFrom}&to=${dateTo}&page_size=10`)
  const expensesFeed = useApiCache<ExpenseFeedRow[]>(`/api/admin/expenses?from=${dateFrom}&to=${dateTo}&page_size=10&page=0`)
  const notifications = useApiCache<{ groups?: NotificationGroup[] }>('/api/admin/notifications')
  const overdue = useApiCache<{ overdue?: number }>('/api/admin/tasks?overdue_count=1')
  const plansRes = useApiCache<{ plans?: KpiPlan[] }>(`/api/admin/kpi-plans?year=${today.slice(0, 4)}`, {
    enabled: isCurrentMonth,
  })

  // Живое обновление: новая строка дохода или расхода — перечитываем цифры и ленту.
  // Клиент Supabase подключается лениво, после первой отрисовки (212 КБ).
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    refreshRef.current = () => {
      void main.refresh()
      void monthBundle.refresh()
      void todayBundle.refresh()
      void incomesFeed.refresh()
      void expensesFeed.refresh()
    }
  })
  useEffect(() => {
    let channel: any = null
    let client: any = null
    let cancelled = false
    let timer: number | null = null
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => refreshRef.current(), 2000)
    }
    const connect = async () => {
      try {
        const { supabase } = await import('@/lib/supabaseClient')
        if (cancelled) return
        client = supabase
        channel = supabase
          .channel('dashboard-realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'incomes' }, schedule)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, schedule)
          .subscribe()
      } catch {
        // Не подключились — данные обновятся при следующем заходе.
      }
    }
    const idle = (window as any).requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 1200))
    const handle = idle(() => void connect(), { timeout: 4000 })
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(handle)
      if (channel && client) client.removeChannel(channel)
    }
  }, [])

  // ---------- companies ----------
  const companies = useMemo(() => (Array.isArray(companiesRes.data) ? companiesRes.data : []), [companiesRes.data])
  const hasExtraCompany = companies.some(isExtraCompany)
  const extraIds = useMemo(() => new Set(companies.filter(isExtraCompany).map((c) => c.id)), [companies])
  const agg = main.data?.aggregate
  const companyName = useMemo(() => {
    const byId = new Map(companies.map((c) => [c.id, c.name] as const))
    return (id: string) => byId.get(id) || agg?.incomeByCompany?.[id]?.name || '—'
  }, [companies, agg])

  // ---------- quick ranges ----------
  const setQuickRange = (type: RangeType) => {
    const t = DateUtils.todayISO()
    if (type === 'today') {
      setDateFrom(t)
      setDateTo(t)
    } else if (type === 'week') {
      setDateFrom(DateUtils.addDaysISO(t, -6))
      setDateTo(t)
    } else if (type === 'month') {
      setDateFrom(DateUtils.monthStartISO())
      setDateTo(t)
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
  }

  // ---------- derived ----------
  const forecast = useMemo(() => {
    const month = monthBundle.data?.aggregate
    if (!isCurrentMonth || !month) return null
    return computeMonthEndForecast({
      dateFrom,
      dateTo: monthEnd,
      asOf: today,
      mtdIncome: month.totalsCur.totalIncome,
      mtdExpense: month.totalsCur.totalExpense,
      hints: monthBundle.data?.forecastHints ?? null,
    })
  }, [isCurrentMonth, monthBundle.data, dateFrom, monthEnd, today])

  const chartData = useMemo((): ChartPoint[] => {
    if (!agg) return []
    const points: ChartPoint[] = DateUtils.rangeDates(dateFrom, dateTo).map((date) => {
      const income = Number(agg.dailyIncome[date] || 0)
      const expense = Number(agg.dailyExpense[date] || 0)
      return { date, label: DateUtils.formatShort(date), income, expense, profit: income - expense, movingAvg: 0 }
    })
    for (let i = 0; i < points.length; i++) {
      const window = points.slice(Math.max(0, i - 6), i + 1)
      points[i].movingAvg = window.reduce((s, p) => s + (p.profit ?? 0), 0) / window.length
    }

    // Пунктир прогноза до конца месяца: остаток прогноза, разложенный по оставшимся дням
    const month = monthBundle.data?.aggregate
    if (forecast && month && forecast.remainingDays > 0 && points.length) {
      const incomePerDay = (forecast.forecastIncome - month.totalsCur.totalIncome) / forecast.remainingDays
      const expensePerDay = (forecast.forecastExpense - month.totalsCur.totalExpense) / forecast.remainingDays
      const last = points[points.length - 1]
      last.forecastIncome = last.income ?? 0
      last.forecastExpense = last.expense ?? 0
      last.forecastProfit = last.profit ?? 0
      for (const date of DateUtils.rangeDates(DateUtils.addDaysISO(dateTo, 1), monthEnd)) {
        points.push({
          date,
          label: DateUtils.formatShort(date),
          income: null,
          expense: null,
          profit: null,
          movingAvg: null,
          forecastIncome: incomePerDay,
          forecastExpense: expensePerDay,
          forecastProfit: incomePerDay - expensePerDay,
        })
      }
    }
    return points
  }, [agg, dateFrom, dateTo, forecast, monthBundle.data, monthEnd])

  const actualDays = useMemo(() => chartData.filter((p) => p.income !== null), [chartData])
  const anomalies = useMemo(() => detectAnomalies(actualDays), [actualDays])

  const expenseByArticle = useMemo((): CategoryData[] => {
    const total = agg?.totalsCur.totalExpense || 0
    return (main.data?.expenseByGroup || [])
      .filter((a) => a.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map((a, idx) => ({
        name: a.label,
        value: a.amount,
        percentage: total ? (a.amount / total) * 100 : 0,
        color: COLORS.chart[idx % COLORS.chart.length],
      }))
  }, [agg, main.data])

  const points = useMemo((): PointSummary[] => {
    if (!agg) return []
    const dates = DateUtils.rangeDates(dateFrom, dateTo)
    return Object.entries(agg.companyStats)
      .map(([id, s]) => {
        const prev = agg.companyStatsPrev?.[id]
        const days = agg.companyDaily?.[id] || {}
        return {
          id,
          name: companyName(id),
          income: s.income,
          expense: s.expense,
          profit: s.profit,
          margin: s.income > 0 ? (s.profit / s.income) * 100 : null,
          prevIncome: prev?.income || 0,
          prevProfit: prev?.profit || 0,
          daily: dates.map((date) => days[date]?.income || 0),
        }
      })
      .filter((p) => p.income > 0 || p.expense > 0)
      .sort((a, b) => b.income - a.income || b.expense - a.expense)
  }, [agg, dateFrom, dateTo, companyName])

  const feed = useMemo((): FeedItem[] => {
    const skip = (companyId: string, date: string) =>
      (!includeExtra && extraIds.has(companyId)) || date < dateFrom || date > dateTo
    const items: FeedItem[] = []
    for (const r of Array.isArray(incomesFeed.data) ? incomesFeed.data : []) {
      if (skip(r.company_id, r.date)) continue
      const amount =
        Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
      if (amount <= 0) continue
      const shift = r.shift === 'night' ? 'ночная смена' : r.shift === 'day' ? 'дневная смена' : null
      items.push({
        id: `inc-${r.id}`,
        date: r.date,
        kind: 'income',
        title: companyName(r.company_id),
        subtitle: [shift, r.zone].filter(Boolean).join(' · ') || 'доход',
        amount,
      })
    }
    for (const r of Array.isArray(expensesFeed.data) ? expensesFeed.data : []) {
      if (skip(r.company_id, r.date)) continue
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (amount <= 0) continue
      items.push({
        id: `exp-${r.id}`,
        date: r.date,
        kind: 'expense',
        title: (r.category || 'Расход').trim(),
        subtitle: companyName(r.company_id),
        amount,
      })
    }
    return items.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount).slice(0, 10)
  }, [incomesFeed.data, expensesFeed.data, includeExtra, extraIds, dateFrom, dateTo, companyName])

  // Только то, где нужно действие: пустых счётчиков вроде «Операторы: 15» здесь нет
  const attention = useMemo(() => {
    const groups = notifications.data?.groups || []
    const group = (id: string) => groups.find((g) => g.id === id)
    const out: Array<{ key: string; icon: ReactNode; text: string; href: string; tone: 'rose' | 'amber' | 'slate' }> = []

    const overdueCount = Number(overdue.data?.overdue || 0)
    if (overdueCount > 0) {
      out.push({
        key: 'tasks',
        icon: <CalendarClock className="h-3.5 w-3.5" />,
        text: `${overdueCount} ${plural(overdueCount, 'просроченная задача', 'просроченные задачи', 'просроченных задач')}`,
        href: '/tasks',
        tone: 'rose',
      })
    }
    const requests = group('requests')
    if (requests?.count) {
      out.push({
        key: 'requests',
        icon: <ClipboardList className="h-3.5 w-3.5" />,
        text: `${requests.count} ${plural(requests.count, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} решения`,
        href: requests.href,
        tone: 'amber',
      })
    }
    const lowStock = group('low-stock')
    if (lowStock?.count) {
      out.push({
        key: 'low-stock',
        icon: <Package className="h-3.5 w-3.5" />,
        text: `${lowStock.count} ${plural(lowStock.count, 'товар заканчивается', 'товара заканчиваются', 'товаров заканчиваются')}`,
        href: lowStock.href,
        tone: 'rose',
      })
    }
    const debts = group('debts')
    if (debts?.count) {
      // Уведомления отдают не больше 50 долгов — ровно 50 значит «50 и больше»
      out.push({
        key: 'debts',
        icon: <Receipt className="h-3.5 w-3.5" />,
        text:
          debts.count >= 50
            ? '50+ активных долгов'
            : `${debts.count} ${plural(debts.count, 'активный долг', 'активных долга', 'активных долгов')}`,
        href: debts.href,
        tone: 'amber',
      })
    }
    const birthdays = group('birthdays')
    const firstBirthday = birthdays?.items?.[0]
    if (birthdays?.count && firstBirthday) {
      const when = firstBirthday.subtitle ? ` — ${firstBirthday.subtitle.toLowerCase()}` : ''
      const more = birthdays.count > 1 ? ` и ещё ${birthdays.count - 1}` : ''
      out.push({
        key: 'birthdays',
        icon: <Cake className="h-3.5 w-3.5" />,
        text: `День рождения: ${firstBirthday.title}${when}${more}`,
        href: birthdays.href,
        tone: 'slate',
      })
    }
    return out
  }, [notifications.data, overdue.data])

  const plans = useMemo(() => {
    const list = plansRes.data?.plans || []
    const pick = (metricName: string) =>
      list.find((p) => p.period_kind === 'month' && p.metric === metricName && p.period_start <= today && p.period_end >= today)
    return { revenue: pick('revenue'), profit: pick('profit') }
  }, [plansRes.data, today])

  // ---------- states ----------
  if (main.loading && !main.data) {
    return (
      <div className="app-page-wide space-y-4">
        <StatGridSkeleton count={4} />
        <CardSkeleton rows={4} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      </div>
    )
  }

  if (!agg) {
    return (
      <div className="app-page-wide">
        <Card className="mx-auto max-w-md items-center gap-3 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-rose-500" />
          <h2 className="text-lg font-semibold text-foreground">Не удалось загрузить дашборд</h2>
          <p className="text-sm text-muted-foreground">{main.error || 'Попробуйте ещё раз'}</p>
          <Button variant="outline" className="rounded-xl" onClick={() => void main.refresh()}>
            Повторить
          </Button>
        </Card>
      </div>
    )
  }

  const current = agg.totalsCur
  const previous = agg.totalsPrev
  const score = scorePeriod(current, previous)
  const margin = current.totalIncome ? (current.profit / current.totalIncome) * 100 : 0
  const reportsHref = `/reports?from=${dateFrom}&to=${dateTo}&preset=custom`
  const feedDenied = !!incomesFeed.error && !!expensesFeed.error
  const incomePoints = points.filter((p) => p.income > 0)
  const expenseOnlyPoints = points.filter((p) => p.income <= 0)

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Дашборд"
        description="Как идут дела и что требует внимания"
        icon={<LayoutDashboard className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link href={reportsHref}>
              Подробнее в отчётах
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['today', 'Сегодня'],
                ['week', 'Неделя'],
                ['month', 'Месяц'],
                ['quarter', 'Квартал'],
                ['year', 'Год'],
              ] as const
            ).map(([type, label]) => (
              <Button
                key={type}
                size="sm"
                variant={rangeType === type ? 'default' : 'outline'}
                className="rounded-xl"
                onClick={() => setQuickRange(type)}
              >
                {label}
              </Button>
            ))}
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-2 py-1 dark:bg-white/[0.04]">
              <DatePicker
                value={dateFrom}
                onChange={(v) => {
                  setDateFrom(v)
                  setRangeType('custom')
                }}
              />
              <span className="text-faint">—</span>
              <DatePicker
                value={dateTo}
                min={dateFrom}
                align="end"
                onChange={(v) => {
                  setDateTo(v)
                  setRangeType('custom')
                }}
              />
            </div>
            {hasExtraCompany && (
              <Button
                size="sm"
                variant="outline"
                className={`rounded-xl ${includeExtra ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' : ''}`}
                onClick={() => setIncludeExtra((v) => !v)}
              >
                {includeExtra ? 'Extra в итогах' : 'Extra не в итогах'}
              </Button>
            )}
          </div>
        }
      />

      {attention.length > 0 && (
        <Card className="flex-row flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Требует внимания
          </span>
          {attention.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-surface-muted ${
                item.tone === 'rose'
                  ? 'border-rose-500/30 text-rose-700 dark:text-rose-300'
                  : item.tone === 'amber'
                    ? 'border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'border-border text-body'
              }`}
            >
              {item.icon}
              {item.text}
            </Link>
          ))}
        </Card>
      )}

      {rangeType !== 'today' && todayBundle.data?.aggregate && (
        <TodayCard
          date={today}
          totals={todayBundle.data.aggregate.totalsCur}
          lastWeek={lastWeekBundle.data?.aggregate?.totalsCur ?? null}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <ScoreCard result={score} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:col-span-3">
          <MetricCard
            label="Доход"
            value={current.totalIncome}
            previousValue={previous.totalIncome}
            goodWhenUp
            icon={<TrendingUp className="h-4 w-4" />}
            iconTone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            selected={metric === 'income'}
            onClick={() => setMetric('income')}
            plan={isCurrentMonth ? plans.revenue : undefined}
            forecast={forecast?.forecastIncome ?? null}
          />
          <MetricCard
            label="Расход"
            value={current.totalExpense}
            previousValue={previous.totalExpense}
            goodWhenUp={false}
            icon={<TrendingDown className="h-4 w-4" />}
            iconTone="bg-rose-500/15 text-rose-600 dark:text-rose-400"
            selected={metric === 'expense'}
            onClick={() => setMetric('expense')}
            forecast={forecast?.forecastExpense ?? null}
          />
          <MetricCard
            label="Прибыль"
            value={current.profit}
            previousValue={previous.profit}
            goodWhenUp
            sub={current.totalIncome ? `маржа ${margin.toFixed(1)}%` : undefined}
            icon={<Target className="h-4 w-4" />}
            iconTone="bg-amber-500/15 text-amber-600 dark:text-amber-400"
            selected={metric === 'profit'}
            onClick={() => setMetric('profit')}
            plan={isCurrentMonth ? plans.profit : undefined}
            forecast={forecast?.forecastProfit ?? null}
          />
        </div>
      </div>

      <ChartCard
        data={chartData}
        metric={metric}
        showMovingAvg={showMovingAvg}
        onToggleMovingAvg={() => setShowMovingAvg((v) => !v)}
      />

      {incomePoints.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Store className="h-4 w-4 text-amber-500" />
            Точки
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {incomePoints.map((point) => (
              <PointCard key={point.id} point={point} shift={onShift.data?.points?.[point.id] ?? null} today={today} />
            ))}
          </div>
          {expenseOnlyPoints.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Только расходы:{' '}
              {expenseOnlyPoints.map((p, idx) => (
                <span key={p.id}>
                  {idx > 0 && ' · '}
                  {p.name} <span className="tabular-nums text-rose-600 dark:text-rose-400">−{Formatters.moneyDetailed(p.expense)}</span>
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CashCard totals={current} cashlessLabel={cashLabels.providerName} />
        <ChangesCard articles={main.data?.expenseByGroup || []} days={actualDays} />
        <CategoryPie
          title="Расходы по статьям"
          data={expenseByArticle}
          total={current.totalExpense}
          icon={<TrendingDown className="h-4 w-4" />}
        />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${anomalies.length ? 'lg:grid-cols-3' : ''}`}>
        <div className={anomalies.length ? 'lg:col-span-2' : ''}>
          <FeedCard feed={feed} denied={feedDenied} href={`/income?from=${dateFrom}&to=${dateTo}`} wide={!anomalies.length} />
        </div>
        {anomalies.length > 0 && <AnomaliesCard anomalies={anomalies} />}
      </div>
    </div>
  )
}

// ==================== UI ====================

function TodayCard({ date, totals, lastWeek }: { date: string; totals: Totals; lastWeek: Totals | null }) {
  const title = DateUtils.fromISO(date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  const compareLabel = sameWeekdayLabel(date)
  const tiles = [
    { label: 'Выручка', value: totals.totalIncome, prev: lastWeek?.totalIncome ?? 0, goodWhenUp: true, tone: 'border-emerald-500/20 bg-emerald-500/[0.06]' },
    { label: 'Расходы', value: totals.totalExpense, prev: lastWeek?.totalExpense ?? 0, goodWhenUp: false, tone: 'border-rose-500/20 bg-rose-500/[0.06]' },
    { label: 'Прибыль', value: totals.profit, prev: lastWeek?.profit ?? 0, goodWhenUp: true, tone: 'border-amber-500/20 bg-amber-500/[0.06]' },
  ]

  return (
    <Card className="gap-0 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">Сегодня</h2>
        <span className="text-sm capitalize text-muted-foreground">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground">сравнение {compareLabel}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => {
          const change = lastWeek ? changeTone(tile.value, tile.prev, tile.goodWhenUp) : null
          return (
            <div key={tile.label} className={`rounded-xl border p-3 ${tile.tone}`}>
              <div className="text-xs text-muted-foreground">{tile.label}</div>
              <div
                className={`mt-1 text-xl font-bold tabular-nums ${tile.label === 'Прибыль' && tile.value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}
              >
                {Formatters.moneyDetailed(tile.value)}
              </div>
              {change && (
                <div className="mt-0.5 text-xs">
                  <span className={change.className}>{change.text}</span>
                  <span className="text-muted-foreground"> · было {Formatters.moneyDetailed(tile.prev)}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function ScoreCard({ result }: { result: ScoreResult }) {
  return (
    <Card className="gap-0 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 dark:from-amber-500/[0.07] dark:via-transparent dark:to-transparent">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <Gauge className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium text-foreground">Оценка периода</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums text-foreground">{result.score}</span>
        <span className="text-xs text-muted-foreground">из 100</span>
        <span className={`ml-auto text-sm font-semibold ${STATUS_TONE[result.status]}`}>{STATUS_LABEL[result.status]}</span>
      </div>

      {/* Из чего сложилась оценка — чтобы число не было «чёрным ящиком» */}
      <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
        <li className="flex justify-between gap-2 text-muted-foreground">
          <span>База</span>
          <span className="tabular-nums">50</span>
        </li>
        {result.parts.map((part) => (
          <li key={part.label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {part.label} <span className="text-foreground">{part.detail}</span>
            </span>
            <span
              className={`shrink-0 font-semibold tabular-nums ${part.points > 0 ? 'text-emerald-600 dark:text-emerald-400' : part.points < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}
            >
              {part.points > 0 ? '+' : ''}
              {part.points}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-body">{STATUS_ADVICE[result.status]}</p>
    </Card>
  )
}

function MetricCard(props: {
  label: string
  value: number
  previousValue: number
  /** Рост — это хорошо (доход, прибыль) или плохо (расход) */
  goodWhenUp: boolean
  sub?: string
  icon: ReactNode
  iconTone: string
  selected: boolean
  onClick: () => void
  plan?: KpiPlan
  forecast: number | null
}) {
  const change = changeTone(props.value, props.previousValue, props.goodWhenUp)
  const pct = props.plan ? Math.max(0, Number(props.plan.achievement_pct || 0)) : 0

  return (
    <Card
      onClick={props.onClick}
      className={`cursor-pointer gap-0 p-5 transition-shadow ${props.selected ? 'ring-2 ring-amber-500' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{props.label}</span>
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${props.iconTone}`}>{props.icon}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-foreground">{Formatters.moneyDetailed(props.value)}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
        <span className={change.className}>{change.text}</span>
        <span className="text-muted-foreground">к прошлому периоду</span>
        {props.sub && <span className="text-muted-foreground">· {props.sub}</span>}
      </div>

      {props.plan && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">План месяца</span>
            <span className="font-semibold tabular-nums text-foreground">{Math.round(pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {Formatters.moneyDetailed(props.plan.fact_value)} из {Formatters.moneyDetailed(props.plan.target_amount)}
          </div>
        </div>
      )}

      {props.forecast !== null && (
        <div className="mt-2 text-xs text-muted-foreground">
          прогноз к концу месяца: <span className="font-medium tabular-nums text-foreground">{Formatters.moneyDetailed(props.forecast)}</span>
        </div>
      )}
    </Card>
  )
}

/** Мини-график без библиотеки: ломаная по дневной выручке точки */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className="h-10 rounded-md bg-slate-100 dark:bg-white/[0.04]" />
  }
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const step = 100 / (values.length - 1)
  const coords = values.map((v, i) => `${(i * step).toFixed(2)},${(38 - ((v - min) / span) * 34).toFixed(2)}`)
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <polygon points={`0,40 ${coords.join(' ')} 100,40`} className="fill-emerald-500/10" />
      <polyline points={coords.join(' ')} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="stroke-emerald-500" />
    </svg>
  )
}

function PointCard({ point, shift, today }: { point: PointSummary; shift: OnShiftPoint | null; today: string }) {
  const incomeChange = changeTone(point.income, point.prevIncome, true)
  const todaySchedule = shift?.scheduled.filter((s) => s.date === today) ?? []
  const tomorrowSchedule = shift?.scheduled.filter((s) => s.date !== today) ?? []
  const names = (list: OnShiftPoint['scheduled']) => list.map((s) => `${s.operatorName} (${shiftLabel(s.shiftType)})`).join(', ')

  return (
    <Card className="gap-0 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-base font-semibold text-foreground">{point.name}</h3>
        <span className={`shrink-0 text-xs font-medium ${incomeChange.className}`}>{incomeChange.text}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{Formatters.moneyDetailed(point.income)}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>
          прибыль{' '}
          <span className={`font-medium tabular-nums ${point.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {Formatters.moneyDetailed(point.profit)}
          </span>
        </span>
        {point.margin !== null && <span>маржа {point.margin.toFixed(1)}%</span>}
      </div>

      <div className="mt-3">
        <Sparkline values={point.daily} />
      </div>

      {/* Кто на смене: открытая кассовая смена или график. «Смена не открыта» не пишем —
          на точках без кассовых смен этого не знаем */}
      <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
        {shift?.open ? (
          <div className="flex items-center gap-1.5 text-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate">
              Сейчас на смене: <b>{shift.open.operatorName}</b>
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              с {new Date(shift.open.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ) : null}
        {todaySchedule.length > 0 && (
          <div className="flex items-start gap-1.5 text-muted-foreground">
            <UserRound className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Сегодня по графику: <span className="text-foreground">{names(todaySchedule)}</span>
            </span>
          </div>
        )}
        {tomorrowSchedule.length > 0 && (
          <div className="flex items-start gap-1.5 text-muted-foreground">
            <UserRound className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Завтра: <span className="text-foreground">{names(tomorrowSchedule)}</span>
            </span>
          </div>
        )}
        {!shift?.open && todaySchedule.length === 0 && tomorrowSchedule.length === 0 && (
          <div className="text-muted-foreground">Смен по графику на сегодня и завтра нет</div>
        )}
      </div>
    </Card>
  )
}

function CashCard({ totals, cashlessLabel }: { totals: Totals; cashlessLabel: string }) {
  const rows = [
    { label: 'Наличные', value: totals.incomeCash, color: 'bg-amber-500' },
    { label: cashlessLabel, value: totals.incomeKaspi, color: 'bg-blue-500' },
    { label: 'Карта', value: totals.incomeCard, color: 'bg-violet-500' },
    { label: 'Онлайн', value: totals.incomeOnline, color: 'bg-pink-500' },
  ].filter((row, idx) => idx === 0 || row.value > 0)

  return (
    <Card className="gap-0 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Banknote className="h-4 w-4 text-amber-500" />
        Нал и безнал
      </h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const share = totals.totalIncome ? (row.value / totals.totalIncome) * 100 : 0
          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-body">{row.label}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {Formatters.moneyDetailed(row.value)} <span className="text-xs text-muted-foreground">{share.toFixed(0)}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div className={`h-full rounded-full ${row.color}`} style={{ width: `${share}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Сальдо за период: пришло минус ушло, без остатка на начало */}
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
        {[
          { label: 'Наличные', income: totals.incomeCash, expense: totals.expenseCash, balance: totals.remainingCash },
          { label: 'Безнал', income: totals.incomeNonCash, expense: totals.expenseKaspi, balance: totals.remainingKaspi },
        ].map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {row.label}: +{Formatters.moneyDetailed(row.income)} / −{Formatters.moneyDetailed(row.expense)}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${row.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {Formatters.moneyDetailed(row.balance)}
            </span>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Сальдо за период, без остатка на начало</p>
      </div>
    </Card>
  )
}

function ChangesCard({ articles, days }: { articles: ExpenseArticle[]; days: ChartPoint[] }) {
  // Статьи расходов, которые сдвинулись сильнее всего (в тенге) к прошлому периоду
  const movers = articles
    .map((a) => ({ label: a.label, delta: a.amount - a.prevAmount, prev: a.prevAmount }))
    .filter((m) => Math.abs(m.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)

  const withData = days.filter((d) => (d.income ?? 0) > 0 || (d.expense ?? 0) > 0)
  const best = withData.length >= 2 ? withData.reduce((a, b) => ((b.profit ?? 0) > (a.profit ?? 0) ? b : a)) : null
  const worst = withData.length >= 2 ? withData.reduce((a, b) => ((b.profit ?? 0) < (a.profit ?? 0) ? b : a)) : null

  return (
    <Card className="gap-0 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-amber-500" />
        Что изменилось
      </h3>

      {movers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Расходы по статьям без заметных изменений.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {movers.map((m) => (
            <li key={m.label} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-body">{m.label}</span>
              <span className={`shrink-0 tabular-nums font-medium ${m.delta > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {m.delta > 0 ? '+' : '−'}
                {Formatters.moneyDetailed(Math.abs(m.delta))}
                <span className="ml-1 text-xs text-muted-foreground">
                  {m.prev > 0 ? `${m.delta > 0 ? '+' : ''}${((m.delta / m.prev) * 100).toFixed(0)}%` : 'новая'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Расходы к прошлому периоду</p>

      {best && worst && best.date !== worst.date && (
        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="h-3 w-3 text-emerald-500" />
              Лучший день — {DateUtils.formatShort(best.date)}
            </span>
            <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{Formatters.moneyDetailed(best.profit ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-rose-500" />
              Худший день — {DateUtils.formatShort(worst.date)}
            </span>
            <span className={`font-semibold tabular-nums ${(worst.profit ?? 0) >= 0 ? 'text-foreground' : 'text-rose-600 dark:text-rose-400'}`}>
              {Formatters.moneyDetailed(worst.profit ?? 0)}
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomaliesCard({ anomalies }: { anomalies: Anomaly[] }) {
  const tone: Record<Anomaly['severity'], string> = {
    low: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    medium: 'border-orange-500/25 bg-orange-500/10 text-orange-800 dark:text-orange-200',
    high: 'border-rose-500/25 bg-rose-500/10 text-rose-800 dark:text-rose-200',
  }
  const severityLabel: Record<Anomaly['severity'], string> = { low: 'заметно', medium: 'сильно', high: 'очень сильно' }

  return (
    <Card className="gap-0 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-foreground">Аномалии</h3>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{anomalies.length}</span>
      </div>
      <div className="max-h-72 space-y-2 overflow-auto">
        {anomalies.map((a) => (
          <div key={`${a.date}-${a.type}`} className={`rounded-xl border p-3 ${tone[a.severity]}`}>
            <div className="mb-1 flex items-center justify-between text-xs font-medium">
              <span>
                {a.type === 'spike' ? 'Всплеск' : 'Падение'} · {severityLabel[a.severity]}
              </span>
              <span className="opacity-80">{DateUtils.formatShort(a.date)}</span>
            </div>
            <p className="text-xs">{a.description}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function FeedCard({ feed, denied, href, wide }: { feed: FeedItem[]; denied: boolean; href: string; wide: boolean }) {
  return (
    <Card className="h-full gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Receipt className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-foreground">Последние операции</h3>
        <Button asChild variant="ghost" size="xs" className="ml-auto rounded-xl text-muted-foreground">
          <Link href={href}>
            Все операции
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <div className="p-2">
        {denied ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Нет доступа к операциям</div>
        ) : !feed.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Операций за период нет</div>
        ) : (
          <div className={`grid gap-x-4 gap-y-0.5 ${wide ? 'md:grid-cols-2' : ''}`}>
            {feed.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-surface-muted">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.subtitle} · {DateUtils.formatShort(item.date)}
                  </div>
                </div>
                <div
                  className={`ml-2 whitespace-nowrap text-sm font-semibold tabular-nums ${item.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
                >
                  {item.kind === 'income' ? '+' : '−'}
                  {Formatters.moneyDetailed(item.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
