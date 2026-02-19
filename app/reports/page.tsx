'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType } from 'react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

import {
  Filter,
  TrendingUp,
  TrendingDown,
  Percent,
  PieChart as PieIcon,
  CalendarDays,
  Wifi,
  CreditCard,
  Brain,
  Sparkles,
  AlertTriangle,
  Target,
  Zap,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  Bot,
  Clock,
  Download,
  Share2,
  Bell,
  CheckCircle2,
  XCircle,
  Minus,
  Wallet,
} from 'lucide-react'

import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
} from 'recharts'

// =====================
// TYPES
// =====================
type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night'
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type GroupMode = 'day' | 'week' | 'month' | 'year'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
  remainingCash: number
  remainingKaspi: number
  totalBalance: number
}

type DatePreset =
  | 'custom'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'prevWeek'
  | 'last30'
  | 'currentMonth'
  | 'prevMonth'
  | 'currentYear'
  | 'prevYear'

type TimeAggregation = {
  label: string
  sortISO: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
}

type AIInsight = {
  type: 'warning' | 'success' | 'info' | 'opportunity'
  title: string
  description: string
  metric?: string
  trend?: 'up' | 'down' | 'neutral'
  action?: string
}

type Anomaly = {
  type: 'income_spike' | 'expense_spike' | 'low_profit' | 'duplicate'
  date: string
  description: string
  severity: 'high' | 'medium' | 'low'
  value: number
}

// =====================
// CONSTS
// =====================
const PIE_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#eab308',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#f97316',
]

const groupLabelMap: Record<GroupMode, string> = {
  day: 'по дням',
  week: 'по неделям',
  month: 'по месяцам',
  year: 'по годам',
}

// =====================
// DATE HELPERS
// =====================
const pad2 = (n: number) => String(n).padStart(2, '0')

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

const formatDate = (d: Date) => toISODateLocal(d)

const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate()

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = fromISO(dateFrom)
  const dTo = fromISO(dateTo)
  const durationDays =
    Math.floor((dTo.getTime() - dFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

const getPercentageChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? '+100%' : '—'
  if (current === 0) return '-100%'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

const getISOWeekKey = (isoDate: string) => {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const isoYear = d.getFullYear()

  const week1 = new Date(isoYear, 0, 4)
  week1.setHours(0, 0, 0, 0)
  const week1Thursday = new Date(week1)
  week1Thursday.setDate(week1.getDate() + 3 - ((week1.getDay() + 6) % 7))

  const diffDays = Math.round((d.getTime() - week1Thursday.getTime()) / 86400000)
  const weekNo = 1 + Math.floor(diffDays / 7)

  return `${isoYear}-W${pad2(weekNo)}`
}

const getMonthKey = (isoDate: string) => isoDate.slice(0, 7)
const getYearKey = (isoDate: string) => isoDate.slice(0, 4)

const getISOWeekStartISO = (isoDate: string) => {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diffToMonday = (day + 6) % 7
  d.setDate(d.getDate() - diffToMonday)
  return toISODateLocal(d)
}

// =====================
// FORMATTERS
// =====================
const formatCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return `${Math.round(n)}`
}

const formatMoneyFull = (n: number) => 
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸'

// =====================
// COMPONENT
// =====================
export default function ReportsPage() {
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoaded, setCompaniesLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)

  const [showAIInsights, setShowAIInsights] = useState(true)
  const [selectedInsight, setSelectedInsight] = useState<number | null>(null)

  const reqIdRef = useRef(0)

  const moneyFmt = useMemo(
    () => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }),
    [],
  )
  const formatMoney = useCallback((v: number) => moneyFmt.format(v), [moneyFmt])

  const companyById = useMemo(() => {
    const m = new Map<string, { name: string; code: string }>()
    for (const c of companies) {
      m.set(c.id, { name: c.name, code: (c.code || '').toLowerCase() })
    }
    return m
  }, [companies])

  const extraCompanyId = useMemo(() => {
    for (const c of companies) {
      const code = (c.code || '').toLowerCase()
      if (code === 'extra') return c.id
      if (c.name === 'F16 Extra') return c.id
    }
    return null
  }, [companies])

  const companyName = useCallback(
    (id: string) => companyById.get(id)?.name ?? '—',
    [companyById],
  )
  const companyCode = useCallback(
    (id: string | null | undefined) => (id ? companyById.get(id)?.code ?? '' : ''),
    [companyById],
  )

  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  useEffect(() => {
    const loadCompanies = async () => {
      setError(null)
      const { data, error } = await supabase
        .from('companies')
        .select('id,name,code')
        .order('name')

      if (error) {
        console.error('Companies load error', error)
        setError('Не удалось загрузить список компаний')
        setCompanies([])
        setCompaniesLoaded(true)
        setLoading(false)
        return
      }

      setCompanies((data || []) as Company[])
      setCompaniesLoaded(true)
    }

    loadCompanies()
  }, [])

  const applyPreset = useCallback(
    (preset: DatePreset) => {
      const today = todayISO()
      const todayDate = fromISO(today)

      let from = dateFrom
      let to = dateTo

      switch (preset) {
        case 'today':
          from = today
          to = today
          break
        case 'yesterday': {
          const y = addDaysISO(today, -1)
          from = y
          to = y
          break
        }
        case 'last7':
          from = addDaysISO(today, -6)
          to = today
          break
        case 'prevWeek': {
          const d = new Date(todayDate)
          const day = d.getDay()
          const diffToMonday = (day + 6) % 7
          const currentMonday = new Date(d)
          currentMonday.setDate(d.getDate() - diffToMonday)
          const prevMonday = new Date(currentMonday)
          prevMonday.setDate(currentMonday.getDate() - 7)
          const prevSunday = new Date(prevMonday)
          prevSunday.setDate(prevMonday.getDate() + 6)
          from = formatDate(prevMonday)
          to = formatDate(prevSunday)
          break
        }
        case 'last30':
          from = addDaysISO(today, -29)
          to = today
          break
        case 'currentMonth': {
          const y = todayDate.getFullYear()
          const m = todayDate.getMonth()
          from = formatDate(new Date(y, m, 1))
          to = formatDate(new Date(y, m + 1, 0))
          break
        }
        case 'prevMonth': {
          const y = todayDate.getFullYear()
          const m = todayDate.getMonth() - 1
          from = formatDate(new Date(y, m, 1))
          to = formatDate(new Date(y, m + 1, 0))
          break
        }
        case 'currentYear': {
          const y = todayDate.getFullYear()
          from = `${y}-01-01`
          to = `${y}-12-31`
          break
        }
        case 'prevYear': {
          const y = todayDate.getFullYear() - 1
          from = `${y}-01-01`
          to = `${y}-12-31`
          break
        }
        case 'custom':
          return
      }

      setDateFrom(from)
      setDateTo(to)
    },
    [dateFrom, dateTo],
  )

  const handlePresetChange = (value: DatePreset) => {
    setDatePreset(value)
    if (value !== 'custom') applyPreset(value)
  }

  useEffect(() => {
    if (!companiesLoaded) return

    if (companies.length === 0) {
      setIncomes([])
      setExpenses([])
      setLoading(false)
      return
    }

    const loadRange = async () => {
      const myReqId = ++reqIdRef.current

      setLoading(true)
      setError(null)

      const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)
      const rangeFrom = prevFrom
      const rangeTo = dateTo

      let incomeQ = supabase
        .from('incomes')
        .select(
          'id,date,company_id,shift,zone,cash_amount,kaspi_amount,online_amount,card_amount',
        )
        .gte('date', rangeFrom)
        .lte('date', rangeTo)

      let expenseQ = supabase
        .from('expenses')
        .select('id,date,company_id,category,cash_amount,kaspi_amount')
        .gte('date', rangeFrom)
        .lte('date', rangeTo)

      if (companyFilter !== 'all') {
        incomeQ = incomeQ.eq('company_id', companyFilter)
        expenseQ = expenseQ.eq('company_id', companyFilter)
      } else {
        if (!includeExtraInTotals && extraCompanyId) {
          incomeQ = incomeQ.neq('company_id', extraCompanyId)
          expenseQ = expenseQ.neq('company_id', extraCompanyId)
        }
      }

      const [{ data: inc, error: incErr }, { data: exp, error: expErr }] = await Promise.all([
        incomeQ,
        expenseQ,
      ])

      if (myReqId !== reqIdRef.current) return

      if (incErr || expErr) {
        console.error('Reports load error:', { incErr, expErr })
        setError('Не удалось загрузить данные для отчётов')
        setLoading(false)
        return
      }

      setIncomes((inc || []) as IncomeRow[])
      setExpenses((exp || []) as ExpenseRow[])
      setLoading(false)
    }

    loadRange()
  }, [
    companiesLoaded,
    companies,
    dateFrom,
    dateTo,
    companyFilter,
    includeExtraInTotals,
    extraCompanyId,
  ])

  // =====================
  // AI PROCESSING
  // =====================
  const processed = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const baseTotals: FinancialTotals = {
      incomeCash: 0,
      incomeKaspi: 0,
      incomeOnline: 0,
      incomeCard: 0,
      incomeNonCash: 0,
      expenseCash: 0,
      expenseKaspi: 0,
      totalIncome: 0,
      totalExpense: 0,
      profit: 0,
      remainingCash: 0,
      remainingKaspi: 0,
      totalBalance: 0,
    }

    const totalsCur: FinancialTotals = { ...baseTotals }
    const totalsPrev: FinancialTotals = { ...baseTotals }

    const expenseByCategoryMap = new Map<string, number>()
    const incomeByCompanyMap = new Map<string, { companyId: string; name: string; value: number }>()
    const chartDataMap = new Map<string, TimeAggregation>()

    const signatureCount = new Map<string, number>()
    const signatureExample = new Map<
      string,
      {
        date: string
        companyId: string
        shift: string
        cash: number
        kaspi: number
        online: number
        card: number
      }
    >()

    const anomalies: Anomaly[] = []
    const dailyIncome = new Map<string, number>()
    const dailyExpense = new Map<string, number>()

    const getRange = (iso: string) => {
      if (iso >= dateFrom && iso <= dateTo) return 'current'
      if (iso >= prevFrom && iso <= prevTo) return 'previous'
      return null
    }

    const getKey = (iso: string): { key: string; label: string; sortISO: string } => {
      if (groupMode === 'day') return { key: iso, label: iso, sortISO: iso }

      if (groupMode === 'week') {
        const wk = getISOWeekKey(iso)
        const start = getISOWeekStartISO(iso)
        return { key: wk, label: wk, sortISO: start }
      }

      if (groupMode === 'month') {
        const mk = getMonthKey(iso)
        return { key: mk, label: mk, sortISO: `${mk}-01` }
      }

      const y = getYearKey(iso)
      return { key: y, label: y, sortISO: `${y}-01-01` }
    }

    const maybeSkipExtra = (companyId: string) => {
      if (companyFilter !== 'all') return false
      if (includeExtraInTotals) return false
      const code = companyCode(companyId)
      return code === 'extra'
    }

    const ensureBucket = (key: string, label: string, sortISO: string) => {
      const b =
        chartDataMap.get(key) ||
        ({
          label,
          sortISO,
          income: 0,
          expense: 0,
          profit: 0,
          incomeCash: 0,
          incomeKaspi: 0,
          incomeOnline: 0,
          incomeCard: 0,
          incomeNonCash: 0,
          expenseCash: 0,
          expenseKaspi: 0,
        } as TimeAggregation)

      chartDataMap.set(key, b)
      return b
    }

    // INCOMES
    for (const r of incomes) {
      const range = getRange(r.date)
      if (!range) continue
      if (maybeSkipExtra(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)

      const nonCash = kaspi + online + card
      const total = cash + nonCash
      if (total <= 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.incomeCash += cash
      tgt.incomeKaspi += kaspi
      tgt.incomeOnline += online
      tgt.incomeCard += card
      tgt.incomeNonCash += nonCash
      tgt.totalIncome += total

      if (range === 'current') {
        dailyIncome.set(r.date, (dailyIncome.get(r.date) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)

        bucket.income += total
        bucket.incomeCash += cash
        bucket.incomeKaspi += kaspi
        bucket.incomeOnline += online
        bucket.incomeCard += card
        bucket.incomeNonCash += nonCash

        const name = companyName(r.company_id) || 'Неизвестно'
        const cur = incomeByCompanyMap.get(r.company_id)
        if (!cur) incomeByCompanyMap.set(r.company_id, { companyId: r.company_id, name, value: total })
        else cur.value += total

        const sig = `${r.date}|${r.company_id}|${r.shift}|${cash}|${kaspi}|${online}|${card}`
        signatureCount.set(sig, (signatureCount.get(sig) || 0) + 1)
        if (!signatureExample.has(sig)) {
          signatureExample.set(sig, {
            date: r.date,
            companyId: r.company_id,
            shift: r.shift,
            cash,
            kaspi,
            online,
            card,
          })
        }
      }
    }

    // EXPENSES
    for (const r of expenses) {
      const range = getRange(r.date)
      if (!range) continue
      if (maybeSkipExtra(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.expenseCash += cash
      tgt.expenseKaspi += kaspi
      tgt.totalExpense += total

      if (range === 'current') {
        dailyExpense.set(r.date, (dailyExpense.get(r.date) || 0) + total)

        const category = r.category || 'Без категории'
        expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket = ensureBucket(key, label, sortISO)

        bucket.expense += total
        bucket.expenseCash += cash
        bucket.expenseKaspi += kaspi
      }
    }

    // Detect anomalies
    const avgIncome = totalsCur.totalIncome / (dailyIncome.size || 1)
    const avgExpense = totalsCur.totalExpense / (dailyExpense.size || 1)

    for (const [date, amount] of dailyIncome) {
      if (amount > avgIncome * 2) {
        anomalies.push({
          type: 'income_spike',
          date,
          description: `Аномальный всплеск выручки: ${formatMoneyFull(amount)}`,
          severity: 'medium',
          value: amount,
        })
      }
    }

    for (const [date, amount] of dailyExpense) {
      if (amount > avgExpense * 2.5) {
        anomalies.push({
          type: 'expense_spike',
          date,
          description: `Аномальный расход: ${formatMoneyFull(amount)}`,
          severity: 'high',
          value: amount,
        })
      }
    }

    const finalizeTotals = (t: FinancialTotals) => {
      t.profit = t.totalIncome - t.totalExpense
      t.remainingCash = t.incomeCash - t.expenseCash
      t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
      t.totalBalance = t.profit
      return t
    }

    finalizeTotals(totalsCur)
    finalizeTotals(totalsPrev)

    for (const agg of chartDataMap.values()) {
      agg.profit = agg.income - agg.expense
      if (agg.profit < avgIncome * 0.1 && agg.income > 0) {
        anomalies.push({
          type: 'low_profit',
          date: agg.label,
          description: `Низкая маржинальность: ${((agg.profit / agg.income) * 100).toFixed(1)}%`,
          severity: 'medium',
          value: agg.profit,
        })
      }
    }

    let duplicateHits = 0
    const duplicateList: Array<{ count: number; text: string }> = []
    for (const [sig, n] of signatureCount.entries()) {
      if (n <= 1) continue
      duplicateHits += n - 1
      const ex = signatureExample.get(sig)
      if (!ex) continue
      const cname = companyName(ex.companyId)
      duplicateList.push({
        count: n,
        text: `${ex.date} • ${cname} • ${ex.shift} • нал ${ex.cash} • kaspi ${ex.kaspi} • online ${ex.online} • карта ${ex.card}`,
      })
      anomalies.push({
        type: 'duplicate',
        date: ex.date,
        description: `Дубликат записи (${n} раз)`,
        severity: 'low',
        value: ex.cash + ex.kaspi + ex.online + ex.card,
      })
    }
    duplicateList.sort((a, b) => b.count - a.count)

    return {
      totalsCur,
      totalsPrev,
      chartDataMap,
      expenseByCategoryMap,
      incomeByCompanyMap,
      duplicateHits,
      duplicateList: duplicateList.slice(0, 20),
      anomalies,
    }
  }, [
    incomes,
    expenses,
    dateFrom,
    dateTo,
    groupMode,
    companyFilter,
    includeExtraInTotals,
    companyName,
    companyCode,
  ])

  // =====================
  // AI INSIGHTS GENERATION
  // =====================
  const aiInsights = useMemo((): AIInsight[] => {
    const insights: AIInsight[] = []
    const { totalsCur, totalsPrev, anomalies, expenseByCategoryMap } = processed

    // Profitability insight
    const profitMargin = totalsCur.totalIncome > 0 ? (totalsCur.profit / totalsCur.totalIncome) * 100 : 0
    const prevMargin = totalsPrev.totalIncome > 0 ? (totalsPrev.profit / totalsPrev.totalIncome) * 100 : 0
    
    if (profitMargin < 15) {
      insights.push({
        type: 'warning',
        title: 'Низкая маржинальность',
        description: `Ваша маржа ${profitMargin.toFixed(1)}% — ниже рекомендуемых 20-25%. Проверьте расходы.`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: profitMargin > prevMargin ? 'up' : 'down',
        action: 'Оптимизировать расходы',
      })
    } else if (profitMargin > 35) {
      insights.push({
        type: 'success',
        title: 'Отличная маржинальность',
        description: `Маржа ${profitMargin.toFixed(1)}% — выше среднего. Отличная эффективность бизнеса.`,
        metric: `${profitMargin.toFixed(1)}%`,
        trend: 'up',
      })
    }

    // Cash flow insight
    const cashRatio = totalsCur.totalIncome > 0 ? totalsCur.incomeCash / totalsCur.totalIncome : 0
    if (cashRatio < 0.3) {
      insights.push({
        type: 'opportunity',
        title: 'Высокая доля безнала',
        description: `${((1 - cashRatio) * 100).toFixed(0)}% выручки — безнал. Рассмотрите скидки за наличные.`,
        metric: `${(cashRatio * 100).toFixed(0)}% нал`,
        trend: 'neutral',
        action: 'Стимулировать наличные',
      })
    }

    // Expense structure
    const topExpense = Array.from(expenseByCategoryMap.entries())
      .sort((a, b) => b[1] - a[1])[0]
    if (topExpense && totalsCur.totalExpense > 0) {
      const share = (topExpense[1] / totalsCur.totalExpense) * 100
      if (share > 40) {
        insights.push({
          type: 'warning',
          title: 'Концентрация расходов',
          description: `Категория "${topExpense[0]}" составляет ${share.toFixed(0)}% всех расходов. Риск нестабильности.`,
          metric: `${share.toFixed(0)}%`,
          trend: 'neutral',
          action: 'Диверсифицировать',
        })
      }
    }

    // Trend analysis
    const incomeChange = totalsPrev.totalIncome > 0 
      ? ((totalsCur.totalIncome - totalsPrev.totalIncome) / totalsPrev.totalIncome) * 100 
      : 0
    if (Math.abs(incomeChange) > 20) {
      insights.push({
        type: incomeChange > 0 ? 'success' : 'warning',
        title: incomeChange > 0 ? 'Резкий рост выручки' : 'Падение выручки',
        description: incomeChange > 0 
          ? `Выручка выросла на ${incomeChange.toFixed(1)}% vs прошлый период` 
          : `Выручка упала на ${Math.abs(incomeChange).toFixed(1)}% — требует внимания`,
        metric: `${incomeChange > 0 ? '+' : ''}${incomeChange.toFixed(1)}%`,
        trend: incomeChange > 0 ? 'up' : 'down',
        action: incomeChange > 0 ? 'Масштабировать' : 'Анализировать причины',
      })
    }

    // Anomalies
    const highSeverityAnomalies = anomalies.filter(a => a.severity === 'high')
    if (highSeverityAnomalies.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Обнаружены аномалии',
        description: `Найдено ${highSeverityAnomalies.length} критических отклонений требующих проверки`,
        metric: `${highSeverityAnomalies.length} шт`,
        trend: 'down',
        action: 'Проверить сейчас',
      })
    }

    return insights.slice(0, 5)
  }, [processed])

  const totals = processed.totalsCur
  const totalsPrev = processed.totalsPrev

  const chartData = useMemo(() => {
    return Array.from(processed.chartDataMap.values()).sort((a, b) =>
      a.sortISO.localeCompare(b.sortISO),
    )
  }, [processed.chartDataMap])

  const expenseByCategoryData = useMemo(() => {
    return Array.from(processed.expenseByCategoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
  }, [processed.expenseByCategoryMap])

  const incomeByCompanyData = useMemo(() => {
    return Array.from(processed.incomeByCompanyMap.values())
      .map((x, idx) => ({
        companyId: x.companyId,
        name: x.name,
        value: x.value,
        fill: PIE_COLORS[idx % PIE_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [processed.incomeByCompanyMap])

  // Forecast
  const forecast = useMemo(() => {
    if (datePreset !== 'currentMonth') return null

    const dTo = fromISO(dateTo)
    const y = dTo.getFullYear()
    const m = dTo.getMonth()
    const dim = daysInMonth(y, m)

    const dayOfMonth = dTo.getDate()
    const remaining = Math.max(0, dim - dayOfMonth)

    const daysRange =
      Math.floor((fromISO(dateTo).getTime() - fromISO(dateFrom).getTime()) / 86400000) + 1

    if (daysRange <= 0) return null

    const avgIncome = totals.totalIncome / daysRange
    const avgProfit = totals.profit / daysRange

    return {
      remainingDays: remaining,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remaining),
      forecastProfit: Math.round(totals.profit + avgProfit * remaining),
      confidence: Math.min(90, 60 + (daysRange / dim) * 30),
    }
  }, [datePreset, dateFrom, dateTo, totals.totalIncome, totals.profit])

  const resetFilters = () => {
    setDatePreset('last7')
    applyPreset('last7')
    setCompanyFilter('all')
    setGroupMode('day')
    setIncludeExtraInTotals(false)
  }

  const exportReport = () => {
    const data = {
      period: `${dateFrom} - ${dateTo}`,
      totals,
      chartData,
      generatedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${dateFrom}-${dateTo}.json`
    a.click()
  }

  const tooltipStyles = {
    contentStyle: {
      backgroundColor: '#09090b',
      borderColor: '#3f3f46',
      borderRadius: 8,
      color: '#fff',
    },
    labelStyle: { color: '#ffffff', fontWeight: 700 },
    itemStyle: { color: '#ffffff' },
  } as const

  const ComposedTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{ payload?: TimeAggregation }>
    label?: string
  }) => {
    if (!active || !payload || !payload.length) return null
    const p = payload[0]?.payload
    if (!p) return null

    return (
      <div
        style={{
          background: '#09090b',
          border: '1px solid #3f3f46',
          borderRadius: 10,
          padding: 12,
          color: '#fff',
          minWidth: 260,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{label}</div>

        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
          Доход: <b>{formatMoney(p.income)} ₸</b>
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 10 }}>
          <span style={{ opacity: 0.85 }}>
            нал {formatMoney(p.incomeCash)} • kaspi {formatMoney(p.incomeKaspi)} • online{' '}
            {formatMoney(p.incomeOnline)} • карта {formatMoney(p.incomeCard)}
          </span>
        </div>

        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
          Расход: <b>{formatMoney(p.expense)} ₸</b>
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 10 }}>
          <span style={{ opacity: 0.85 }}>
            нал {formatMoney(p.expenseCash)} • kaspi {formatMoney(p.expenseKaspi)}
          </span>
        </div>

        <div style={{ fontSize: 12 }}>
          Прибыль:{' '}
          <b style={{ color: p.profit >= 0 ? '#eab308' : '#ef4444' }}>
            {formatMoney(p.profit)} ₸
          </b>
        </div>
      </div>
    )
  }

  const TrendCard = ({
    title,
    current,
    previous,
    Icon,
    unit = '₸',
    isExpense = false,
  }: {
    title: string
    current: number
    previous: number
    Icon: ElementType
    unit?: string
    isExpense?: boolean
  }) => {
    const change = getPercentageChange(current, previous)
    const positiveTrend = isExpense ? current <= previous : current >= previous
    const trendClass =
      change === '—' ? 'text-muted-foreground' : positiveTrend ? 'text-green-400' : 'text-red-400'
    const TrendIcon = change === '—' ? Icon : positiveTrend ? TrendingUp : TrendingDown

    const formatValue = (value: number) => moneyFmt.format(value) + (unit ? ` ${unit}` : '')

    return (
      <Card className="p-4 border border-border bg-card neon-glow flex flex-col justify-between">
        <div className="flex justify-between items-start mb-1">
          <p className="text-xs text-muted-foreground">{title}</p>
          <TrendIcon className={`w-4 h-4 ${trendClass}`} />
        </div>

        <p className="text-2xl font-bold text-foreground mb-1">
          {unit === '%' ? current.toFixed(1) + unit : formatValue(current)}
        </p>

        <div className={`text-sm font-semibold ${trendClass}`}>
          {change}
          <span className="text-xs text-muted-foreground ml-1">
            {change !== '—'
              ? `(${unit === '%' ? previous.toFixed(1) + unit : formatValue(previous)} в пред. период)`
              : ''}
          </span>
        </div>
      </Card>
    )
  }

  const InsightCard = ({ insight, index }: { insight: AIInsight; index: number }) => {
    const colors = {
      warning: 'from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-400',
      success: 'from-emerald-500/20 to-green-500/20 border-emerald-500/30 text-emerald-400',
      info: 'from-blue-500/20 to-cyan-500/20 border-blue-500/30 text-blue-400',
      opportunity: 'from-purple-500/20 to-pink-500/20 border-purple-500/30 text-purple-400',
    }

    const icons = {
      warning: AlertTriangle,
      success: CheckCircle2,
      info: Lightbulb,
      opportunity: Zap,
    }

    const Icon = icons[insight.type]

    return (
      <div
        onClick={() => setSelectedInsight(selectedInsight === index ? null : index)}
        className={`relative overflow-hidden rounded-xl border p-4 cursor-pointer transition-all hover:scale-[1.02] ${
          selectedInsight === index ? 'ring-2 ring-white/20' : ''
        } bg-gradient-to-br ${colors[insight.type]}`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">{insight.title}</h4>
              {insight.metric && (
                <span className="text-lg font-bold">{insight.metric}</span>
              )}
            </div>
            <p className="text-xs mt-1 opacity-90">{insight.description}</p>
            {insight.action && selectedInsight === index && (
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="secondary" className="h-7 text-xs bg-white/20 hover:bg-white/30">
                  {insight.action}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 animate-pulse" />
            AI анализирует данные...
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-red-400">{error}</main>
      </div>
    )
  }

  if (companiesLoaded && companies.length === 0) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          Нет компаний в таблице <b className="mx-1 text-foreground">companies</b>. Создай хотя бы
          одну — и отчёты оживут.
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-8">
          {/* HEADER */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-4xl font-bold text-foreground">AI Отчёты</h1>
                  <p className="text-muted-foreground mt-1">
                    Умный анализ финансов с прогнозированием
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportReport} className="gap-2">
                <Download className="w-4 h-4" /> Экспорт
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Share2 className="w-4 h-4" /> Поделиться
              </Button>
            </div>
          </div>

          {/* AI INSIGHTS */}
          {showAIInsights && aiInsights.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <h2 className="text-lg font-semibold">AI Инсайты</h2>
                  <span className="text-xs text-muted-foreground">({aiInsights.length})</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowAIInsights(false)}>
                  Скрыть
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {aiInsights.map((insight, idx) => (
                  <InsightCard key={idx} insight={insight} index={idx} />
                ))}
              </div>
            </div>
          )}

          {!showAIInsights && (
            <Button variant="outline" onClick={() => setShowAIInsights(true)} className="gap-2">
              <Sparkles className="w-4 h-4" /> Показать AI инсайты
            </Button>
          )}

          {/* ANOMALIES */}
          {processed.anomalies.length > 0 && (
            <Card className="p-4 border-amber-500/30 bg-amber-500/10">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="font-semibold">Обнаружены аномалии ({processed.anomalies.length})</h3>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {processed.anomalies.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{a.description}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      a.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                      a.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {a.severity}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* DUPLICATES */}
          {processed.duplicateHits > 0 && (
            <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
              ⚠️ Найдены возможные дубликаты: <b>{processed.duplicateHits}</b>
              <div className="mt-2 space-y-1 text-[12px] text-yellow-200/90 max-h-32 overflow-y-auto">
                {processed.duplicateList.slice(0, 5).map((x, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="font-bold">×{x.count}</span>
                    <span className="opacity-90">{x.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FILTERS */}
          <Card className="p-6 border-border bg-card neon-glow space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Фильтры и период</h3>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  Сбросить
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Dates */}
              <div className="space-y-3">
                <span className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Период анализа
                </span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      'today',
                      'yesterday',
                      'last7',
                      'prevWeek',
                      'last30',
                      'currentMonth',
                      'prevMonth',
                    ] as DatePreset[]
                  ).map((p) => (
                    <button
                      key={p}
                      onClick={() => handlePresetChange(p)}
                      className={`px-3 py-1.5 text-[11px] rounded-lg transition-colors ${
                        datePreset === p
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-white/10 text-muted-foreground border border-border/50'
                      }`}
                    >
                      {p === 'today' && 'Сегодня'}
                      {p === 'yesterday' && 'Вчера'}
                      {p === 'last7' && '7 дн.'}
                      {p === 'prevWeek' && 'Прош. нед.'}
                      {p === 'last30' && '30 дн.'}
                      {p === 'currentMonth' && 'Тек. мес.'}
                      {p === 'prevMonth' && 'Прош. мес.'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="bg-input/50 border border-border/50 rounded px-2 py-1"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="bg-input/50 border border-border/50 rounded px-2 py-1"
                  />
                </div>
              </div>

              {/* Company & Group */}
              <div className="space-y-3">
                <span className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Детализация
                </span>
                <div className="flex gap-2">
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="bg-input border border-border rounded-lg px-3 py-2 text-sm flex-1"
                  >
                    <option value="all">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex bg-input/50 rounded-lg border border-border/50 p-1">
                    {(['day', 'week', 'month'] as GroupMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setGroupMode(mode)}
                        className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
                          groupMode === mode
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-white/10'
                        }`}
                      >
                        {mode === 'day' && 'Дни'}
                        {mode === 'week' && 'Недели'}
                        {mode === 'month' && 'Месяцы'}
                      </button>
                    ))}
                  </div>
                </div>
                {companyFilter === 'all' && (
                  <button
                    onClick={() => setIncludeExtraInTotals((v) => !v)}
                    className={`text-[11px] flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      includeExtraInTotals
                        ? 'border-red-400/50 text-red-400 bg-red-500/10'
                        : 'border-border text-muted-foreground hover:bg-white/5'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-red-400' : 'bg-muted-foreground'}`} />
                    Учитывать F16 Extra
                  </button>
                )}
              </div>

              {/* Forecast */}
              {forecast && (
                <div className="space-y-3">
                  <span className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                    AI Прогноз до конца месяца
                  </span>
                  <div className="p-3 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-muted-foreground">Осталось дней: {forecast.remainingDays}</span>
                      <span className="text-[10px] text-purple-400">Точность: {forecast.confidence.toFixed(0)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Прогноз выручки</div>
                        <div className="text-lg font-bold text-purple-400">{formatMoney(forecast.forecastIncome)} ₸</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Прогноз прибыли</div>
                        <div className="text-lg font-bold text-emerald-400">{formatMoney(forecast.forecastProfit)} ₸</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* TOTALS */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <Card className="p-5 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-green-400 uppercase">Выручка</span>
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
              <div className="text-3xl font-bold text-green-400 mb-2">
                {formatMoneyFull(totals.totalIncome)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-muted-foreground">
                  Нал: <span className="text-foreground">{formatMoneyFull(totals.incomeCash)}</span>
                </div>
                <div className="text-muted-foreground">
                  Безнал: <span className="text-foreground">{formatMoneyFull(totals.incomeNonCash)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-red-400 uppercase">Расходы</span>
                <TrendingDown className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-3xl font-bold text-red-400 mb-2">
                {formatMoneyFull(totals.totalExpense)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-muted-foreground">
                  Нал: <span className="text-foreground">{formatMoneyFull(totals.expenseCash)}</span>
                </div>
                <div className="text-muted-foreground">
                  Kaspi: <span className="text-foreground">{formatMoneyFull(totals.expenseKaspi)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-yellow-400 uppercase">Прибыль</span>
                <Target className="w-4 h-4 text-yellow-400" />
              </div>
              <div className={`text-3xl font-bold mb-2 ${totals.profit >= 0 ? 'text-yellow-400' : 'text-red-500'}`}>
                {formatMoneyFull(totals.profit)}
              </div>
              <div className="text-xs text-muted-foreground">
                Маржа: {' '}
                <span className={totals.totalIncome > 0 && (totals.profit / totals.totalIncome) > 0.2 ? 'text-green-400' : 'text-amber-400'}>
                  {totals.totalIncome > 0 ? ((totals.profit / totals.totalIncome) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </Card>

            <Card className="p-5 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-blue-400 uppercase">Остатки</span>
                <Wallet className="w-4 h-4 text-blue-400" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Наличные:</span>
                  <span className={totals.remainingCash >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {formatMoneyFull(totals.remainingCash)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Безнал:</span>
                  <span className={totals.remainingKaspi >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {formatMoneyFull(totals.remainingKaspi)}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* CHARTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Time Chart */}
            <Card className="p-6 border-border bg-card neon-glow lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-accent" />
                  Динамика доходов и расходов ({groupLabelMap[groupMode]})
                </h3>
                <div className="flex gap-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-green-500" /> Доход
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-red-500" /> Расход
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-1 bg-yellow-500" /> Прибыль
                  </span>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                    <XAxis dataKey="label" stroke="#ccc" fontSize={12} />
                    <YAxis stroke="#ccc" fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Tooltip content={<ComposedTooltip />} />
                    <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="profit" stroke="#eab308" strokeWidth={3} dot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Expense Categories */}
            <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-red-400" />
                Структура расходов
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseByCategoryData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={120} fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: '#09090b', border: '1px solid #3f3f46', borderRadius: 8 }}
                      formatter={(v: number) => [formatMoneyFull(v), 'Сумма']}
                    />
                    <Bar dataKey="amount" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Company Structure */}
            <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-blue-400" />
                Выручка по компаниям
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={incomeByCompanyData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {incomeByCompanyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#09090b', border: '1px solid #3f3f46', borderRadius: 8 }}
                      formatter={(v: number) => formatMoneyFull(v)}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* TREND ANALYSIS */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" />
              AI Анализ трендов
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TrendCard
                title="Динамика выручки"
                current={totals.totalIncome}
                previous={totalsPrev.totalIncome}
                Icon={TrendingUp}
              />
              <TrendCard
                title="Динамика расходов"
                current={totals.totalExpense}
                previous={totalsPrev.totalExpense}
                Icon={TrendingDown}
                isExpense
              />
              <TrendCard
                title="Рентабельность"
                current={totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0}
                previous={totalsPrev.totalIncome > 0 ? (totalsPrev.profit / totalsPrev.totalIncome) * 100 : 0}
                Icon={Percent}
                unit="%"
              />
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
