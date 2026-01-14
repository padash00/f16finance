'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from 'lucide-react'
import type { ElementType } from 'react'
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
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
}

// =====================
// CONSTS
// =====================
const PIE_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444', '#06b6d4', '#f97316']

const groupLabelMap: Record<GroupMode, string> = {
  day: 'по дням',
  week: 'по неделям',
  month: 'по месяцам',
  year: 'по годам',
}

// =====================
// DATE HELPERS (локально, без UTC-подлянок)
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

// ISO week key (правильные недели)
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
// MONEY / NUMBER FORMAT
// =====================
const formatCompact = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return `${Math.round(n)}`
}

// =====================
// COMPONENT
// =====================
export default function ReportsPage() {
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -6))
  const [dateTo, setDateTo] = useState(todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)

  // “Показать дубли” (чтобы не просто пугать цифрой)
  const [showDuplicates, setShowDuplicates] = useState(false)

  // UX-фишка: выбранная категория (для подсветки/сводки), totals НЕ ломаем
  const [focusCategory, setFocusCategory] = useState<string | null>(null)

  // защита от гонок запросов
  const reqIdRef = useRef(0)

  // formatters
  const moneyFmt = useMemo(
    () => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }),
    [],
  )
  const formatMoney = useCallback((v: number) => moneyFmt.format(v), [moneyFmt])

  // company maps
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

  // аккуратная защита от dateFrom > dateTo
  useEffect(() => {
    if (dateFrom <= dateTo) return
    // swap
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  // 1) load companies once
  useEffect(() => {
    const loadCompanies = async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id,name,code')
        .order('name')
      if (error) {
        console.error('Companies load error', error)
        setError('Не удалось загрузить список компаний')
        return
      }
      setCompanies((data || []) as Company[])
    }
    loadCompanies()
  }, [])

  // presets
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

  // 2) load incomes/expenses for current + previous in one request range
  useEffect(() => {
    if (!companies.length) return

    const loadRange = async () => {
      const myReqId = ++reqIdRef.current

      setLoading(true)
      setError(null)

      const { prevFrom } = calculatePrevPeriod(dateFrom, dateTo)
      const rangeFrom = prevFrom
      const rangeTo = dateTo

      let incomeQ = supabase
        .from('incomes')
        .select('id,date,company_id,shift,zone,cash_amount,kaspi_amount,card_amount')
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
        // если все, но Extra НЕ учитывать — режем на сервере (если знаем id)
        if (!includeExtraInTotals && extraCompanyId) {
          incomeQ = incomeQ.neq('company_id', extraCompanyId)
          expenseQ = expenseQ.neq('company_id', extraCompanyId)
        }
      }

      const [{ data: inc, error: incErr }, { data: exp, error: expErr }] = await Promise.all([
        incomeQ,
        expenseQ,
      ])

      // stale response guard
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
  }, [companies, dateFrom, dateTo, companyFilter, includeExtraInTotals, extraCompanyId])

  // =====================
  // PROCESSING
  // =====================
  const processed = useMemo(() => {
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)

    const baseTotals: FinancialTotals = {
      incomeCash: 0,
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
    const incomeByCompanyMap = new Map<
      string,
      { companyId: string; name: string; value: number }
    >()

    const chartDataMap = new Map<string, TimeAggregation>()

    // дубль-детектор + примеры
    const signatureCount = new Map<string, number>()
    const signatureExample = new Map<
      string,
      { date: string; companyId: string; shift: string; cash: number; kaspi: number; card: number }
    >()

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

    // INCOMES
    for (const r of incomes) {
      const range = getRange(r.date)
      if (!range) continue
      if (maybeSkipExtra(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const nonCash = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
      const total = cash + nonCash
      if (total <= 0) continue

      const tgt = range === 'current' ? totalsCur : totalsPrev
      tgt.incomeCash += cash
      tgt.incomeNonCash += nonCash
      tgt.totalIncome += total

      if (range === 'current') {
        const { key, label, sortISO } = getKey(r.date)
        const bucket =
          chartDataMap.get(key) || ({
            label,
            sortISO,
            income: 0,
            expense: 0,
            profit: 0,
            incomeCash: 0,
            incomeNonCash: 0,
            expenseCash: 0,
            expenseKaspi: 0,
          } as TimeAggregation)

        bucket.income += total
        bucket.incomeCash += cash
        bucket.incomeNonCash += nonCash
        chartDataMap.set(key, bucket)

        const name = companyName(r.company_id) || 'Неизвестно'
        const cur = incomeByCompanyMap.get(r.company_id)
        if (!cur) incomeByCompanyMap.set(r.company_id, { companyId: r.company_id, name, value: total })
        else cur.value += total

        const sig = `${r.date}|${r.company_id}|${r.shift}|${cash}|${Number(r.kaspi_amount || 0)}|${Number(r.card_amount || 0)}`
        signatureCount.set(sig, (signatureCount.get(sig) || 0) + 1)
        if (!signatureExample.has(sig)) {
          signatureExample.set(sig, {
            date: r.date,
            companyId: r.company_id,
            shift: r.shift,
            cash,
            kaspi: Number(r.kaspi_amount || 0),
            card: Number(r.card_amount || 0),
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
        const category = r.category || 'Без категории'
        expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) || 0) + total)

        const { key, label, sortISO } = getKey(r.date)
        const bucket =
          chartDataMap.get(key) || ({
            label,
            sortISO,
            income: 0,
            expense: 0,
            profit: 0,
            incomeCash: 0,
            incomeNonCash: 0,
            expenseCash: 0,
            expenseKaspi: 0,
          } as TimeAggregation)

        bucket.expense += total
        bucket.expenseCash += cash
        bucket.expenseKaspi += kaspi
        chartDataMap.set(key, bucket)
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
    }

    // duplicates
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
        text: `${ex.date} • ${cname} • ${ex.shift} • нал ${ex.cash} • kaspi ${ex.kaspi} • карта ${ex.card}`,
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

  // ТОП периодов по прибыли/расходам (управленческий кайф без доп. БД)
  const topProfitPeriods = useMemo(() => {
    const arr = [...chartData]
    arr.sort((a, b) => b.profit - a.profit)
    return arr.slice(0, 5)
  }, [chartData])

  const topExpensePeriods = useMemo(() => {
    const arr = [...chartData]
    arr.sort((a, b) => b.expense - a.expense)
    return arr.slice(0, 5)
  }, [chartData])

  // Forecast (показываем только когда выбран “Тек. месяц” — иначе это гадание на кофейной гуще)
  const forecast = useMemo(() => {
    if (datePreset !== 'currentMonth') return null

    const dTo = fromISO(dateTo)
    const y = dTo.getFullYear()
    const m = dTo.getMonth()
    const dim = daysInMonth(y, m)

    const dayOfMonth = dTo.getDate()
    const remaining = Math.max(0, dim - dayOfMonth)

    // считаем “дневной темп” по текущему периоду (dateFrom..dateTo)
    const daysRange =
      Math.floor((fromISO(dateTo).getTime() - fromISO(dateFrom).getTime()) / 86400000) + 1

    if (daysRange <= 0) return null

    const avgIncome = totals.totalIncome / daysRange
    const avgProfit = totals.profit / daysRange

    return {
      remainingDays: remaining,
      forecastIncome: Math.round(totals.totalIncome + avgIncome * remaining),
      forecastProfit: Math.round(totals.profit + avgProfit * remaining),
    }
  }, [datePreset, dateFrom, dateTo, totals.totalIncome, totals.profit])

  const resetFilters = () => {
    setDatePreset('last7')
    applyPreset('last7')
    setCompanyFilter('all')
    setGroupMode('day')
    setIncludeExtraInTotals(false)
    setFocusCategory(null)
    setShowDuplicates(false)
  }

  // Tooltip styles
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

  // Custom tooltip for composed chart (показывает разбивку)
  const ComposedTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: any[]
    label?: string
  }) => {
    if (!active || !payload || !payload.length) return null
    const p = payload[0]?.payload as TimeAggregation | undefined
    if (!p) return null

    return (
      <div
        style={{
          background: '#09090b',
          border: '1px solid #3f3f46',
          borderRadius: 10,
          padding: 12,
          color: '#fff',
          minWidth: 240,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{label}</div>

        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
          Доход: <b>{formatMoney(p.income)} ₸</b>
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 10 }}>
          <span style={{ opacity: 0.85 }}>
            нал {formatMoney(p.incomeCash)} • безнал {formatMoney(p.incomeNonCash)}
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

    const formatValue = (value: number) =>
      moneyFmt.format(value) + (unit ? ` ${unit}` : '')

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

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          Загрузка отчётов...
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-8">
          {/* HEADER */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-foreground">Отчёты</h1>
              <p className="text-muted-foreground mt-2">Выручка, расходы и прибыль по выбранному периоду</p>
            </div>
          </div>

          {/* DUPLICATES */}
          {processed.duplicateHits > 0 && (
            <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm">
              ⚠️ Найдены возможные дубликаты доходов: <b>{processed.duplicateHits}</b>.{' '}
              <button
                className="underline underline-offset-4 hover:opacity-80 ml-1"
                onClick={() => setShowDuplicates((v) => !v)}
              >
                {showDuplicates ? 'Скрыть' : 'Показать'}
              </button>

              {showDuplicates && (
                <div className="mt-3 space-y-1 text-[12px] text-yellow-200/90">
                  {processed.duplicateList.length ? (
                    processed.duplicateList.map((x, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="font-bold">×{x.count}</span>
                        <span className="opacity-90">{x.text}</span>
                      </div>
                    ))
                  ) : (
                    <div>Примеров нет (но это редкий зверь).</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* FILTERS */}
          <Card className="p-6 border-border bg-card neon-glow space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Фильтры</h3>
              </div>
              <Button size="sm" variant="outline" onClick={resetFilters}>
                Сбросить
              </Button>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 justify-between">
              {/* dates */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Период
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center bg-input/50 rounded-md border border-border/50 px-2 py-1">
                    <CalendarDays className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => {
                        setDateFrom(e.target.value)
                        setDatePreset('custom')
                      }}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                    <span className="text-muted-foreground text-xs px-1">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => {
                        setDateTo(e.target.value)
                        setDatePreset('custom')
                      }}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1 bg-input/30 rounded-md border border-border/30 p-0.5">
                    {(['today', 'yesterday', 'last7', 'last30', 'currentMonth', 'prevMonth'] as DatePreset[]).map(
                      (p) => (
                        <button
                          key={p}
                          onClick={() => handlePresetChange(p)}
                          className={`px-2 py-1 text-[10px] rounded transition-colors ${
                            datePreset === p
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-white/10 text-muted-foreground'
                          }`}
                        >
                          {p === 'today' && 'Сегодня'}
                          {p === 'yesterday' && 'Вчера'}
                          {p === 'last7' && '7 дн.'}
                          {p === 'last30' && '30 дн.'}
                          {p === 'currentMonth' && 'Тек. месяц'}
                          {p === 'prevMonth' && 'Прош. месяц'}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>

              {/* company + group */}
              <div className="flex flex-col lg:items-end gap-2">
                <div className="flex flex-wrap gap-2 justify-between lg:justify-end">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground">Компания</span>
                    <select
                      value={companyFilter}
                      onChange={(e) => setCompanyFilter(e.target.value)}
                      className="bg-input border border-border rounded px-3 py-2 text-xs text-foreground min-w-[180px]"
                    >
                      <option value="all">Все компании</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground">Группировка</span>
                    <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                      {(['day', 'week', 'month', 'year'] as GroupMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setGroupMode(mode)}
                          className={`px-3 py-1 text-[10px] rounded transition-colors ${
                            groupMode === mode
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-white/10 text-muted-foreground'
                          }`}
                        >
                          {mode === 'day' && 'Дни'}
                          {mode === 'week' && 'Нед.'}
                          {mode === 'month' && 'Мес.'}
                          {mode === 'year' && 'Год'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {companyFilter === 'all' && (
                  <button
                    type="button"
                    onClick={() => setIncludeExtraInTotals((v) => !v)}
                    className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
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
                    Учитывать F16 Extra в итогах
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* TOTALS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4 border-border bg-card neon-glow">
              <p className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wide">Выручка</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Наличные</p>
                  <p className="text-xl font-bold text-green-400">{formatMoney(totals.incomeCash)} ₸</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Kaspi + Карта</p>
                  <p className="text-xl font-bold text-green-400">{formatMoney(totals.incomeNonCash)} ₸</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border/60">
                <p className="text-[10px] text-muted-foreground mb-1">ВСЕГО ВЫРУЧКА</p>
                <p className="text-2xl font-bold text-green-400">{formatMoney(totals.totalIncome)} ₸</p>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card neon-glow">
              <p className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wide">Расходы</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Наличные</p>
                  <p className="text-xl font-bold text-red-400">{formatMoney(totals.expenseCash)} ₸</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Kaspi (безнал)</p>
                  <p className="text-xl font-bold text-red-400">{formatMoney(totals.expenseKaspi)} ₸</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border/60">
                <p className="text-[10px] text-muted-foreground mb-1">ВСЕГО РАСХОДЫ</p>
                <p className="text-2xl font-bold text-red-400">{formatMoney(totals.totalExpense)} ₸</p>
              </div>
            </Card>

            <Card className="p-4 border-border bg-card neon-glow border-accent/60">
              <p className="text-xs font-semibold text-accent mb-2 uppercase tracking-wide">Остатки и прибыль</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Остаток (нал)</p>
                  <p className={`text-xl font-bold ${totals.remainingCash >= 0 ? 'text-sky-400' : 'text-red-500'}`}>
                    {formatMoney(totals.remainingCash)} ₸
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Остаток (Kaspi/Card)</p>
                  <p className={`text-xl font-bold ${totals.remainingKaspi >= 0 ? 'text-sky-400' : 'text-red-500'}`}>
                    {formatMoney(totals.remainingKaspi)} ₸
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border/60">
                <p className="text-[10px] text-muted-foreground mb-1">ЧИСТАЯ ПРИБЫЛЬ</p>
                <p className={`text-2xl font-bold ${totals.profit >= 0 ? 'text-yellow-400' : 'text-red-500'}`}>
                  {formatMoney(totals.profit)} ₸
                </p>
              </div>
            </Card>
          </div>

          {/* INTEL ANALYSIS */}
          <Card className="p-6 border-border bg-card neon-glow">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent" />
                Интеллектуальный анализ
              </h2>

              {forecast && forecast.remainingDays > 0 && (
                <div className="text-xs text-muted-foreground">
                  Прогноз до конца месяца (ещё {forecast.remainingDays} дн.):{' '}
                  <span className="text-foreground font-semibold">
                    выручка ~ {formatMoney(forecast.forecastIncome)} ₸
                  </span>{' '}
                  •{' '}
                  <span className="text-foreground font-semibold">
                    прибыль ~ {formatMoney(forecast.forecastProfit)} ₸
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <TrendCard
                title="Динамика общей выручки"
                current={totals.totalIncome}
                previous={totalsPrev.totalIncome}
                Icon={TrendingUp}
              />
              <TrendCard
                title="Динамика общих расходов"
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

          {/* MANAGEMENT: TOP PERIODS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-semibold text-foreground mb-4">
                Топ-5 периодов по прибыли ({groupLabelMap[groupMode]})
              </h3>
              <div className="space-y-2">
                {topProfitPeriods.map((p) => (
                  <div
                    key={p.label}
                    className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
                  >
                    <div className="text-xs text-muted-foreground">{p.label}</div>
                    <div className={`text-sm font-bold ${p.profit >= 0 ? 'text-yellow-400' : 'text-red-500'}`}>
                      {formatMoney(p.profit)} ₸
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-semibold text-foreground mb-4">
                Топ-5 периодов по расходам ({groupLabelMap[groupMode]})
              </h3>
              <div className="space-y-2">
                {topExpensePeriods.map((p) => (
                  <div
                    key={p.label}
                    className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
                  >
                    <div className="text-xs text-muted-foreground">{p.label}</div>
                    <div className="text-sm font-bold text-red-400">{formatMoney(p.expense)} ₸</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* STRUCTURE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 border-border bg-card neon-glow flex flex-col">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                  Топ-10 категорий расходов (кликни категорию)
                </h3>

                {focusCategory && (
                  <button
                    className="text-[11px] text-muted-foreground underline underline-offset-4 hover:opacity-80"
                    onClick={() => setFocusCategory(null)}
                  >
                    Сбросить категорию
                  </button>
                )}
              </div>

              {focusCategory && (
                <div className="mb-3 text-xs text-muted-foreground">
                  Выбрано: <span className="text-foreground font-semibold">{focusCategory}</span>{' '}
                  • сумма:{' '}
                  <span className="text-foreground font-semibold">
                    {formatMoney(processed.expenseByCategoryMap.get(focusCategory) || 0)} ₸
                  </span>
                </div>
              )}

              <div className="h-80">
                {expenseByCategoryData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">Нет данных</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={expenseByCategoryData}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                      <XAxis
                        type="number"
                        stroke="#ccc"
                        tickFormatter={(v) => formatCompact(Number(v))}
                      />
                      <YAxis type="category" dataKey="name" stroke="#ccc" width={140} />
                      <Tooltip
                        {...tooltipStyles}
                        formatter={(value: any) => [`${moneyFmt.format(Number(value))} ₸`, 'Сумма']}
                      />
                      <Bar
                        dataKey="amount"
                        fill="#ef4444"
                        radius={[0, 4, 4, 0]}
                        onClick={(d: any) => {
                          const name = d?.payload?.name
                          if (!name) return
                          setFocusCategory((cur) => (cur === name ? null : name))
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="p-6 border-border bg-card neon-glow flex flex-col">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-blue-400" />
                Структура выручки по компаниям (клик — фильтр)
              </h3>

              <div className="h-80">
                {incomeByCompanyData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">Нет данных</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={incomeByCompanyData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={120}
                        paddingAngle={5}
                        dataKey="value"
                        onClick={(d: any) => {
                          const id = d?.payload?.companyId
                          if (!id) return
                          setCompanyFilter(id)
                        }}
                      >
                        {incomeByCompanyData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.fill}
                            stroke="rgba(0,0,0,0.2)"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>

                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#09090b',
                          borderColor: '#3f3f46',
                          borderRadius: 8,
                          color: '#fff',
                        }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value: number) => [`${formatMoney(value)} ₸`, 'Выручка']}
                      />

                      <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {companyFilter !== 'all' && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Фильтр по компании включён.{' '}
                  <button
                    className="underline underline-offset-4 hover:opacity-80"
                    onClick={() => setCompanyFilter('all')}
                  >
                    Сбросить
                  </button>
                </div>
              )}
            </Card>
          </div>

          {/* TIME CHART */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Динамика: доход / расход / прибыль ({groupLabelMap[groupMode]})
            </h3>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                  <XAxis dataKey="label" stroke="#ccc" />
                  <YAxis stroke="#ccc" tickFormatter={(v) => formatCompact(Number(v))} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />

                  <Tooltip content={<ComposedTooltip />} />
                  <Legend
                    wrapperStyle={{ color: '#fff', fontSize: 12 }}
                    formatter={(value) =>
                      value === 'income' ? 'Доход' : value === 'expense' ? 'Расход' : 'Прибыль'
                    }
                  />

                  <Bar dataKey="income" name="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" name="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="profit" name="profit" stroke="#eab308" strokeWidth={3} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 text-[11px] text-muted-foreground">
              Да, я специально добавил линию “0”. Она честнее, чем некоторые отчёты.
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
