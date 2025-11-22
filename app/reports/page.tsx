'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Filter, TrendingUp, TrendingDown, Percent, PieChart as PieIcon } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
  ResponsiveContainer,
  LineChart,
  Line,
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
} from 'recharts'

// --- Типы данных ---
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

type Aggregation = {
  income: number
  expense: number
  profit: number
}

type TimeAggregation = Aggregation & {
  label: string
}

type FinancialTotals = {
  incomeCash: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
  // Остатки и общий баланс
  remainingCash: number
  remainingKaspi: number
  totalBalance: number
}

type MonthlyTrendData = {
  label: string
  income: number
  expense: number
  profit: number
  year: string
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

const formatDate = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = new Date(dateFrom + 'T00:00:00')
  const dTo = new Date(dateTo + 'T00:00:00')
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1
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

const getWeekKey = (isoDate: string) => {
  const d = new Date(isoDate + 'T00:00:00')
  const year = d.getFullYear()
  const oneJan = new Date(year, 0, 1)
  const dayOfYear = Math.floor((d.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const week = Math.ceil(dayOfYear / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

const getMonthKey = (isoDate: string) => isoDate.slice(0, 7)
const getYearKey = (isoDate: string) => isoDate.slice(0, 4)

const groupLabelMap: Record<GroupMode, string> = {
  day: 'по дням',
  week: 'по неделям',
  month: 'по месяцам',
  year: 'по годам',
}

export default function ReportsPage() {
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => {
    const today = todayISO()
    return addDaysISO(today, -6)
  })
  const [dateTo, setDateTo] = useState(todayISO())
  const [datePreset, setDatePreset] = useState<DatePreset>('last7')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true)
      setError(null)

      const [
        { data: incomeData, error: incomeErr },
        { data: expenseData, error: expenseErr },
        { data: companyData, error: compErr },
      ] = await Promise.all([
        supabase
          .from('incomes')
          .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, card_amount'),
        supabase
          .from('expenses')
          .select('id, date, company_id, category, cash_amount, kaspi_amount'),
        supabase.from('companies').select('id, name, code').order('name'),
      ])

      if (incomeErr || expenseErr || compErr) {
        console.error('Error loading reports data:', { incomeErr, expenseErr, compErr })
        setError('Не удалось загрузить данные для отчётов')
        setLoading(false)
        return
      }

      setIncomes((incomeData || []) as IncomeRow[])
      setExpenses((expenseData || []) as ExpenseRow[])
      setCompanies((companyData || []) as Company[])
      setLoading(false)
    }

    loadAll()
  }, [])

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? '—'

  const companyCodeById = (id: string | null | undefined) => {
    if (!id) return null
    const c = companies.find((x) => x.id === id)
    return (c?.code || '').toLowerCase()
  }

  // Применение пресета дат
  const applyPreset = (preset: DatePreset) => {
    const today = todayISO()
    const todayDate = new Date(today + 'T00:00:00')

    let from = dateFrom
    let to = dateTo

    switch (preset) {
      case 'today': {
        from = today
        to = today
        break
      }
      case 'yesterday': {
        const y = addDaysISO(today, -1)
        from = y
        to = y
        break
      }
      case 'last7': {
        from = addDaysISO(today, -6)
        to = today
        break
      }
      case 'prevWeek': {
        const d = todayDate
        const day = d.getDay() // 0 = воскресенье, 1 = понедельник ...
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
      case 'last30': {
        from = addDaysISO(today, -29)
        to = today
        break
      }
      case 'currentMonth': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth()
        const start = new Date(y, m, 1)
        const end = new Date(y, m + 1, 0)
        from = formatDate(start)
        to = formatDate(end)
        break
      }
      case 'prevMonth': {
        const y = todayDate.getFullYear()
        const m = todayDate.getMonth() - 1
        const start = new Date(y, m, 1)
        const end = new Date(y, m + 1, 0)
        from = formatDate(start)
        to = formatDate(end)
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
        // Пользователь сам выбирает даты
        return
    }

    setDateFrom(from)
    setDateTo(to)
  }

  const handlePresetChange = (value: DatePreset) => {
    setDatePreset(value)
    if (value !== 'custom') {
      applyPreset(value)
    }
  }

  const processedData = useMemo(() => {
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

    const financialTotals: FinancialTotals = { ...baseTotals }
    const financialTotalsPrev: FinancialTotals = { ...baseTotals }

    const expenseByCategoryMap = new Map<string, number>()
    const incomeByCompanyMap = new Map<string, number>()
    const totalsByCompanyMap = new Map<string, Aggregation>()
    const chartDataMap = new Map<string, TimeAggregation>()
    const shiftAgg: { day: number; night: number } = { day: 0, night: 0 }

    const getKey = (iso: string): { key: string; label: string } => {
      if (groupMode === 'day') return { key: iso, label: iso }
      if (groupMode === 'week') {
        const wk = getWeekKey(iso)
        return { key: wk, label: wk }
      }
      if (groupMode === 'month') {
        const mk = getMonthKey(iso)
        return { key: mk, label: mk }
      }
      const y = getYearKey(iso)
      return { key: y, label: y }
    }

    for (const c of companies) {
      totalsByCompanyMap.set(c.id, { income: 0, expense: 0, profit: 0 })
    }

    const getRange = (date: string) => {
      if (date >= dateFrom && date <= dateTo) return 'current'
      if (date >= prevFrom && date <= prevTo) return 'previous'
      return null
    }

    // ДОХОДЫ
    for (const r of incomes) {
      const range = getRange(r.date)
      if (!range) continue

      let filterPass = true
      if (companyFilter !== 'all') {
        if (r.company_id !== companyFilter) filterPass = false
      } else {
        const code = companyCodeById(r.company_id)
        if (code === 'extra') filterPass = false
      }
      if (!filterPass) continue

      const cash = Number(r.cash_amount || 0)
      const nonCash = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)
      const total = cash + nonCash
      if (total <= 0) continue

      const target = range === 'current' ? financialTotals : financialTotalsPrev
      target.incomeCash += cash
      target.incomeNonCash += nonCash
      target.totalIncome += total

      if (range === 'current') {
        if (r.shift === 'day') shiftAgg.day += total
        if (r.shift === 'night') shiftAgg.night += total

        const companyTotals = totalsByCompanyMap.get(r.company_id)
        if (companyTotals) companyTotals.income += total

        const { key, label } = getKey(r.date)
        const chartBucket =
          chartDataMap.get(key) || { income: 0, expense: 0, profit: 0, label }
        chartBucket.income += total
        chartDataMap.set(key, chartBucket)

        const cName = companyName(r.company_id) || 'Неизвестно'
        const curCompTotal = incomeByCompanyMap.get(cName) || 0
        incomeByCompanyMap.set(cName, curCompTotal + total)
      }
    }

    // РАСХОДЫ
    for (const r of expenses) {
      const range = getRange(r.date)
      if (!range) continue

      let filterPass = true
      if (companyFilter !== 'all') {
        if (r.company_id !== companyFilter) filterPass = false
      } else {
        const code = companyCodeById(r.company_id)
        if (code === 'extra') filterPass = false
      }
      if (!filterPass) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const target = range === 'current' ? financialTotals : financialTotalsPrev
      target.expenseCash += cash
      target.expenseKaspi += kaspi
      target.totalExpense += total

      if (range === 'current') {
        const categoryKey = r.category || 'Без категории'
        const currentCategoryTotal = expenseByCategoryMap.get(categoryKey) || 0
        expenseByCategoryMap.set(categoryKey, currentCategoryTotal + total)

        const companyTotals = totalsByCompanyMap.get(r.company_id)
        if (companyTotals) companyTotals.expense += total

        const { key, label } = getKey(r.date)
        const chartBucket =
          chartDataMap.get(key) || { income: 0, expense: 0, profit: 0, label }
        chartBucket.expense += total
        chartDataMap.set(key, chartBucket)
      }
    }

    // Финальные расчёты
    const finalizeTotals = (t: FinancialTotals) => {
      t.profit = t.totalIncome - t.totalExpense
      t.remainingCash = t.incomeCash - t.expenseCash
      t.remainingKaspi = t.incomeNonCash - t.expenseKaspi
      t.totalBalance = t.profit
      return t
    }

    finalizeTotals(financialTotals)
    finalizeTotals(financialTotalsPrev)

    for (const [id, agg] of totalsByCompanyMap.entries()) {
      agg.profit = agg.income - agg.expense
      totalsByCompanyMap.set(id, agg)
    }
    for (const [key, agg] of chartDataMap.entries()) {
      agg.profit = agg.income - agg.expense
      chartDataMap.set(key, agg)
    }

    return {
      financialTotals,
      financialTotalsPrev,
      expenseByCategoryMap,
      incomeByCompanyMap,
      totalsByCompanyMap,
      chartDataMap,
      shiftAgg,
    }
  }, [incomes, expenses, dateFrom, dateTo, companyFilter, companies, groupMode])

  const monthlyTrends = useMemo(() => {
    const monthlyMap = new Map<string, MonthlyTrendData>()

    const getMonthBucket = (isoDate: string) => {
      const key = isoDate.slice(0, 7)
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, {
          label: key,
          income: 0,
          expense: 0,
          profit: 0,
          year: isoDate.slice(0, 4),
        })
      }
      return monthlyMap.get(key)!
    }

    for (const r of incomes) {
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0)
      if (total <= 0) continue
      getMonthBucket(r.date).income += total
    }
    for (const r of expenses) {
      const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (total <= 0) continue
      getMonthBucket(r.date).expense += total
    }

    return Array.from(monthlyMap.values())
      .map((data) => {
        data.profit = data.income - data.expense
        return data
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [incomes, expenses])

  const totals = useMemo(() => processedData.financialTotals, [processedData])
  const totalsPrev = useMemo(
    () => processedData.financialTotalsPrev,
    [processedData],
  )

  const totalsByCompany = useMemo(() => {
    return Array.from(processedData.totalsByCompanyMap.entries())
      .map(([companyId, v]) => ({
        companyId,
        name: companyName(companyId),
        income: v.income,
        expense: v.expense,
        profit: v.profit,
      }))
      .filter((row) => row.income > 0 || row.expense > 0)
  }, [processedData, companyName])

  const chartData = useMemo(() => {
    return Array.from(processedData.chartDataMap.values())
      .map((v) => ({ ...v, label: v.label || '' }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [processedData])

  const expenseByCategoryData = useMemo(() => {
    return Array.from(processedData.expenseByCategoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
  }, [processedData])

  const incomeByCompanyData = useMemo(() => {
    const COLORS = ['#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444']
    return Array.from(processedData.incomeByCompanyMap.entries())
      .map(([name, value], index) => ({
        name,
        value,
        fill: COLORS[index % COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [processedData])

  const formatMoney = (v: number) =>
    v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

  const resetFilters = () => {
    setDatePreset('last7')
    applyPreset('last7')
    setCompanyFilter('all')
    setGroupMode('day')
  }

  const tooltipStyles = {
    contentStyle: {
      backgroundColor: '#09090b',
      borderColor: '#3f3f46',
      borderRadius: 8,
      color: '#fff',
    },
    labelStyle: { color: '#ffffff', fontWeight: 600 },
    itemStyle: { color: '#ffffff' },
  } as const

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
    Icon: React.ElementType
    unit?: string
    isExpense?: boolean
  }) => {
    const change = getPercentageChange(current, previous)
    const positiveTrend = isExpense ? current <= previous : current >= previous
    const trendClass =
      change === '—'
        ? 'text-muted-foreground'
        : positiveTrend
          ? 'text-green-400'
          : 'text-red-400'
    const TrendIcon = change === '—' ? Icon : positiveTrend ? TrendingUp : TrendingDown
    const formatValue = (value: number) =>
      value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ' + unit

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
              ? `(${
                  unit === '%'
                    ? previous.toFixed(1) + unit
                    : formatValue(previous)
                } в пред. период)`
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
        <main className="flex-1 flex items-center justify-center text-red-400">
          {error}
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-foreground">Отчёты</h1>
              <p className="text-muted-foreground mt-2">
                Доходы, расходы и прибыль по выбранному периоду
              </p>
            </div>
          </div>

          {/* Фильтры */}
          <Card className="p-6 border-border bg-card neon-glow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Фильтры</h3>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={datePreset}
                  onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
                  className="bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
                >
                  <option value="today">Сегодня</option>
                  <option value="yesterday">Вчера</option>
                  <option value="last7">Последние 7 дней</option>
                  <option value="prevWeek">Прошлая неделя</option>
                  <option value="last30">Последние 30 дней</option>
                  <option value="currentMonth">Текущий месяц</option>
                  <option value="prevMonth">Прошлый месяц</option>
                  <option value="currentYear">Текущий год</option>
                  <option value="prevYear">Прошлый год</option>
                  <option value="custom">Выбрать период</option>
                </select>
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  Сбросить
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setDatePreset('custom')
                }}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setDatePreset('custom')
                }}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              />
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              >
                <option value="all">Все компании</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              >
                <option value="day">По дням</option>
                <option value="week">По неделям</option>
                <option value="month">По месяцам</option>
                <option value="year">По годам</option>
              </select>
            </div>
          </Card>

          {/* Итоги + Остатки */}
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-7 gap-4">
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Доход (Нал)</p>
              <p className="text-xl font-bold text-green-400">
                {formatMoney(totals.incomeCash)} ₸
              </p>
            </Card>
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">
                Доход (Kaspi/Card)
              </p>
              <p className="text-xl font-bold text-green-400">
                {formatMoney(totals.incomeNonCash)} ₸
              </p>
            </Card>
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Расход (Нал)</p>
              <p className="text-xl font-bold text-red-400">
                {formatMoney(totals.expenseCash)} ₸
              </p>
            </Card>
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Расход (Kaspi)</p>
              <p className="text-xl font-bold text-red-400">
                {formatMoney(totals.expenseKaspi)} ₸
              </p>
            </Card>

            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Остаток (Нал)</p>
              <p
                className={`text-xl font-bold ${
                  totals.remainingCash >= 0 ? 'text-sky-400' : 'text-red-500'
                }`}
              >
                {formatMoney(totals.remainingCash)} ₸
              </p>
            </Card>
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">
                Остаток (Kaspi/Card)
              </p>
              <p
                className={`text-xl font-bold ${
                  totals.remainingKaspi >= 0 ? 'text-sky-400' : 'text-red-500'
                }`}
              >
                {formatMoney(totals.remainingKaspi)} ₸
              </p>
            </Card>

            <Card className="p-3 border-border bg-card neon-glow border-accent/60">
              <p className="text-[10px] text-muted-foreground mb-1">Чистая Прибыль</p>
              <p
                className={`text-xl font-bold ${
                  totals.profit >= 0 ? 'text-yellow-400' : 'text-red-500'
                }`}
              >
                {formatMoney(totals.profit)} ₸
              </p>
            </Card>
          </div>

          {/* Интеллектуальный анализ */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" />
              Интеллектуальный анализ
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TrendCard
                title="Динамика Общего Дохода"
                current={totals.totalIncome}
                previous={totalsPrev.totalIncome}
                Icon={TrendingUp}
              />
              <TrendCard
                title="Динамика Общего Расхода"
                current={totals.totalExpense}
                previous={totalsPrev.totalExpense}
                Icon={TrendingDown}
                isExpense={true}
              />
              <TrendCard
                title="Рентабельность"
                current={
                  totals.totalIncome > 0
                    ? (totals.profit / totals.totalIncome) * 100
                    : 0
                }
                previous={
                  totalsPrev.totalIncome > 0
                    ? (totalsPrev.profit / totalsPrev.totalIncome) * 100
                    : 0
                }
                Icon={Percent}
                unit="%"
              />
            </div>
          </Card>

          {/* Структура выручки и расходов */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 border-border bg-card neon-glow flex flex-col">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                Топ-10 расходов
              </h3>
              <div className="h-80">
                {expenseByCategoryData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={expenseByCategoryData}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                      <XAxis type="number" stroke="#ccc" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke="#ccc"
                        width={80}
                      />
                      <Tooltip
                        {...tooltipStyles}
                        formatter={(value: any) => [
                          `${Number(value).toLocaleString('ru-RU')} ₸`,
                          'Сумма',
                        ]}
                      />
                      <Bar dataKey="amount" fill="#ef4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="p-6 border-border bg-card neon-glow flex flex-col">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-blue-400" />
                Структура выручки (по Точкам)
              </h3>
              <div className="h-80">
                {incomeByCompanyData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
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
                        formatter={(value: number) => [
                          `${formatMoney(value)}`,
                          'Выручка',
                        ]}
                      />
                      <Legend
                        layout="vertical"
                        verticalAlign="middle"
                        align="right"
                        iconType="circle"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* График по времени */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Доход / Расход / Прибыль по времени ({groupLabelMap[groupMode]})
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                  <XAxis dataKey="label" stroke="#ccc" />
                  <YAxis stroke="#ccc" />
                  <Tooltip
                    {...tooltipStyles}
                    formatter={(value: any) => [
                      `${Number(value).toLocaleString('ru-RU')} ₸`,
                      '',
                    ]}
                  />
                  <Legend wrapperStyle={{ color: '#fff' }} />
                  <Line
                    dataKey="income"
                    name="Доход"
                    stroke="#22c55e"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                  <Line
                    dataKey="expense"
                    name="Расход"
                    stroke="#ef4444"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                  <Line
                    dataKey="profit"
                    name="Прибыль"
                    stroke="#eab308"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
