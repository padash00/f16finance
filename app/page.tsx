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
  Zap,
  Clock,
  BarChart2,
  Brain,
  AlertTriangle,
  CheckCircle2,
  Activity,
  CalendarDays,
  DollarSign,
  ArrowRight,
  LineChart,
  Wallet,
  CreditCard,
  Smartphone,
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  ComposedChart,
} from 'recharts'

// ==================== ТИПЫ ====================

type Company = { 
  id: string
  name: string
  code?: string | null 
}

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

type RangeType = 'today' | 'week' | 'month' | 'quarter' | 'year'

type Totals = {
  income: {
    cash: number
    kaspi: number
    card: number
    online: number
    total: number
  }
  expense: {
    cash: number
    kaspi: number
    total: number
  }
  profit: number
  transactions: number
}

type ChartData = {
  date: string
  income: number
  expense: number
  profit: number
}

type Insight = {
  message: string
  type: 'success' | 'warning' | 'danger' | 'info'
}

// ==================== УТИЛИТЫ ====================

const DateUtils = {
  today: () => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  },

  format: (date: string) => {
    const d = new Date(date)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  },

  getRange: (type: RangeType) => {
    const today = new Date()
    const end = today.toISOString().split('T')[0]
    let start: string

    switch (type) {
      case 'today':
        start = end
        break
      case 'week':
        start = new Date(today.setDate(today.getDate() - 6)).toISOString().split('T')[0]
        break
      case 'month':
        start = new Date(today.setDate(today.getDate() - 29)).toISOString().split('T')[0]
        break
      case 'quarter':
        start = new Date(today.setMonth(today.getMonth() - 3)).toISOString().split('T')[0]
        break
      case 'year':
        start = new Date(today.setFullYear(today.getFullYear() - 1)).toISOString().split('T')[0]
        break
      default:
        start = end
    }

    return { start, end }
  },

  getPrevPeriod: (start: string, end: string) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const days = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    
    const prevEnd = new Date(startDate)
    prevEnd.setDate(prevEnd.getDate() - 1)
    
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - days + 1)
    
    return {
      start: prevStart.toISOString().split('T')[0],
      end: prevEnd.toISOString().split('T')[0]
    }
  },

  getDatesInRange: (start: string, end: string) => {
    const dates: string[] = []
    const current = new Date(start)
    const last = new Date(end)
    
    while (current <= last) {
      dates.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }
    return dates
  }
}

const Format = {
  money: (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KZT',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  },

  shortMoney: (value: number) => {
    if (value >= 1_000_000) {
      return (value / 1_000_000).toFixed(1) + ' млн ₸'
    }
    if (value >= 1_000) {
      return (value / 1_000).toFixed(1) + ' тыс ₸'
    }
    return value + ' ₸'
  },

  percent: (value: number) => {
    return (value > 0 ? '+' : '') + value.toFixed(1) + '%'
  },

  number: (value: number) => {
    return new Intl.NumberFormat('ru-RU').format(value)
  }
}

// ==================== ОСНОВНОЙ КОМПОНЕНТ ====================

export default function DashboardPage() {
  const [period, setPeriod] = useState<RangeType>('month')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])

  const range = DateUtils.getRange(period)
  const prevRange = DateUtils.getPrevPeriod(range.start, range.end)

  // Загрузка данных
  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const [companiesRes, incomesRes, expensesRes] = await Promise.all([
          supabase.from('companies').select('id, name, code'),
          supabase
            .from('incomes')
            .select('id, date, company_id, cash_amount, kaspi_amount, card_amount, online_amount, comment')
            .gte('date', prevRange.start)
            .lte('date', range.end),
          supabase
            .from('expenses')
            .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
            .gte('date', prevRange.start)
            .lte('date', range.end),
        ])

        if (!mounted) return

        if (companiesRes.error) throw companiesRes.error
        if (incomesRes.error) throw incomesRes.error
        if (expensesRes.error) throw expensesRes.error

        setCompanies(companiesRes.data || [])
        setIncomes(incomesRes.data || [])
        setExpenses(expensesRes.data || [])
      } catch (err) {
        console.error(err)
        setError('Ошибка при загрузке данных')
      } finally {
        setLoading(false)
      }
    }

    loadData()
    return () => { mounted = false }
  }, [range.start, range.end, prevRange.start])

  // Компании
  const companyMap = useMemo(() => {
    const map: Record<string, Company> = {}
    companies.forEach(c => map[c.id] = c)
    return map
  }, [companies])

  const isExtra = (companyId: string) => {
    return (companyMap[companyId]?.code || '').toLowerCase() === 'extra'
  }

  // Фильтрация
  const filterData = <T extends { company_id: string }>(items: T[]) => {
    return items.filter(item => includeExtra || !isExtra(item.company_id))
  }

  const filteredIncomes = useMemo(() => filterData(incomes), [incomes, includeExtra])
  const filteredExpenses = useMemo(() => filterData(expenses), [expenses, includeExtra])

  // Аналитика
  const analytics = useMemo(() => {
    const current: Totals = {
      income: { cash: 0, kaspi: 0, card: 0, online: 0, total: 0 },
      expense: { cash: 0, kaspi: 0, total: 0 },
      profit: 0,
      transactions: 0,
    }

    const previous: Totals = {
      income: { cash: 0, kaspi: 0, card: 0, online: 0, total: 0 },
      expense: { cash: 0, kaspi: 0, total: 0 },
      profit: 0,
      transactions: 0,
    }

    const chartMap = new Map<string, ChartData>()
    const dates = DateUtils.getDatesInRange(range.start, range.end)
    dates.forEach(date => {
      chartMap.set(date, { date, income: 0, expense: 0, profit: 0 })
    })

    // Доходы
    filteredIncomes.forEach(row => {
      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const card = Number(row.card_amount || 0)
      const online = Number(row.online_amount || 0)
      const total = cash + kaspi + card + online

      if (total === 0) return

      if (row.date >= range.start && row.date <= range.end) {
        current.income.cash += cash
        current.income.kaspi += kaspi
        current.income.card += card
        current.income.online += online
        current.income.total += total
        current.transactions++

        const point = chartMap.get(row.date)
        if (point) point.income += total
      } else if (row.date >= prevRange.start && row.date <= prevRange.end) {
        previous.income.cash += cash
        previous.income.kaspi += kaspi
        previous.income.card += card
        previous.income.online += online
        previous.income.total += total
        previous.transactions++
      }
    })

    // Расходы
    filteredExpenses.forEach(row => {
      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const total = cash + kaspi

      if (total === 0) return

      if (row.date >= range.start && row.date <= range.end) {
        current.expense.cash += cash
        current.expense.kaspi += kaspi
        current.expense.total += total
        current.transactions++

        const point = chartMap.get(row.date)
        if (point) point.expense += total
      } else if (row.date >= prevRange.start && row.date <= prevRange.end) {
        previous.expense.cash += cash
        previous.expense.kaspi += kaspi
        previous.expense.total += total
        previous.transactions++
      }
    })

    current.profit = current.income.total - current.expense.total
    previous.profit = previous.income.total - previous.expense.total

    chartMap.forEach(point => {
      point.profit = point.income - point.expense
    })

    const chartData = Array.from(chartMap.values()).sort((a, b) => 
      a.date.localeCompare(b.date)
    )

    // Инсайты
    const insights: Insight[] = []

    if (current.profit > previous.profit * 1.2) {
      insights.push({ message: 'Прибыль выросла более чем на 20%', type: 'success' })
    } else if (current.profit < previous.profit * 0.8) {
      insights.push({ message: 'Прибыль упала более чем на 20%', type: 'danger' })
    }

    const margin = current.income.total ? (current.profit / current.income.total) * 100 : 0
    if (margin > 30) {
      insights.push({ message: 'Высокая маржинальность', type: 'success' })
    } else if (margin < 10) {
      insights.push({ message: 'Низкая маржинальность', type: 'warning' })
    }

    if (current.expense.total > current.income.total * 0.9) {
      insights.push({ message: 'Расходы превышают 90% доходов', type: 'danger' })
    }

    const onlineShare = current.income.total ? (current.income.online / current.income.total) * 100 : 0
    if (onlineShare > 30) {
      insights.push({ message: 'Высокая доля онлайн-продаж', type: 'info' })
    }

    return {
      current,
      previous,
      chartData,
      insights,
      margin,
    }
  }, [filteredIncomes, filteredExpenses, range, prevRange])

  const { current, previous, chartData, insights, margin } = analytics

  // Изменения в процентах
  const changes = {
    income: previous.income.total ? ((current.income.total - previous.income.total) / previous.income.total) * 100 : 0,
    expense: previous.expense.total ? ((current.expense.total - previous.expense.total) / previous.expense.total) * 100 : 0,
    profit: previous.profit ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100 : 0,
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600 mx-auto mb-4" />
            <p className="text-gray-500">Загрузка данных...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">Ошибка</h2>
            <p className="text-gray-500 mb-4">{error}</p>
            <Button onClick={() => window.location.reload()}>
              Обновить
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {/* Хедер */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Дашборд</h1>
              <p className="text-sm text-gray-500 mt-1">
                {DateUtils.format(range.start)} — {DateUtils.format(range.end)}
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Периоды */}
              <div className="flex gap-1 p-1 bg-white rounded-lg border border-gray-200">
                {(['today', 'week', 'month', 'quarter', 'year'] as RangeType[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      period === p
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {p === 'today' && 'День'}
                    {p === 'week' && 'Неделя'}
                    {p === 'month' && 'Месяц'}
                    {p === 'quarter' && 'Квартал'}
                    {p === 'year' && 'Год'}
                  </button>
                ))}
              </div>

              {/* Extra */}
              {companies.some(c => c.code === 'extra') && (
                <button
                  onClick={() => setIncludeExtra(!includeExtra)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    includeExtra
                      ? 'bg-orange-50 border-orange-200 text-orange-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Extra {includeExtra ? '✓' : ''}
                </button>
              )}
            </div>
          </div>

          {/* Инсайты */}
          {insights.length > 0 && (
            <div className="mb-6">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-5 h-5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Анализ</span>
                </div>
                <div className="space-y-2">
                  {insights.map((insight, i) => (
                    <div
                      key={i}
                      className={`text-sm px-3 py-2 rounded-md ${
                        insight.type === 'success' ? 'bg-green-50 text-green-700' :
                        insight.type === 'warning' ? 'bg-yellow-50 text-yellow-700' :
                        insight.type === 'danger' ? 'bg-red-50 text-red-700' :
                        'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {insight.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Основные метрики */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Доход */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-600">Доход</span>
                </div>
                <span className={`text-xs font-medium ${
                  changes.income > 0 ? 'text-green-600' : changes.income < 0 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {Format.percent(changes.income)}
                </span>
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-3">
                {Format.shortMoney(current.income.total)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Наличные</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.income.cash)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Kaspi</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.income.kaspi)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Карта</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.income.card)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Online</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.income.online)}</div>
                </div>
              </div>
            </Card>

            {/* Расход */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-600">Расход</span>
                </div>
                <span className={`text-xs font-medium ${
                  changes.expense > 0 ? 'text-red-600' : changes.expense < 0 ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {Format.percent(changes.expense)}
                </span>
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-3">
                {Format.shortMoney(current.expense.total)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Наличные</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.expense.cash)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Kaspi</span>
                  <div className="font-medium text-gray-900">{Format.shortMoney(current.expense.kaspi)}</div>
                </div>
              </div>
            </Card>

            {/* Прибыль */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-600">Прибыль</span>
                </div>
                <span className={`text-xs font-medium ${
                  changes.profit > 0 ? 'text-green-600' : changes.profit < 0 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {Format.percent(changes.profit)}
                </span>
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-3">
                {Format.shortMoney(current.profit)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Маржа</span>
                  <div className="font-medium text-gray-900">{margin.toFixed(1)}%</div>
                </div>
                <div>
                  <span className="text-gray-500">Транзакций</span>
                  <div className="font-medium text-gray-900">{Format.number(current.transactions)}</div>
                </div>
              </div>
            </Card>
          </div>

          {/* График */}
          <Card className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <LineChart className="w-5 h-5 text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700">Динамика</h3>
            </div>
            
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-500">
                Нет данных за период
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => DateUtils.format(v)}
                      stroke="#9ca3af"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      fontSize={12}
                      tickLine={false}
                      tickFormatter={(v) => Format.shortMoney(v)}
                    />
                    <Tooltip
                      formatter={(v: number) => [Format.money(v)]}
                      labelFormatter={(v) => DateUtils.format(v)}
                    />
                    
                    <Area
                      type="monotone"
                      dataKey="income"
                      name="Доход"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#incomeGradient)"
                    />
                    <Area
                      type="monotone"
                      dataKey="expense"
                      name="Расход"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#expenseGradient)"
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      name="Прибыль"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Детали */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Доходы по типам */}
            <Card className="p-5">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Способы оплаты</h3>
              <div className="space-y-3">
                <PaymentRow
                  label="Наличные"
                  amount={current.income.cash}
                  icon={<Wallet className="w-4 h-4" />}
                  color="text-gray-900"
                />
                <PaymentRow
                  label="Kaspi"
                  amount={current.income.kaspi}
                  icon={<Smartphone className="w-4 h-4" />}
                  color="text-blue-600"
                />
                <PaymentRow
                  label="Карта"
                  amount={current.income.card}
                  icon={<CreditCard className="w-4 h-4" />}
                  color="text-purple-600"
                />
                <PaymentRow
                  label="Online"
                  amount={current.income.online}
                  icon={<DollarSign className="w-4 h-4" />}
                  color="text-green-600"
                />
              </div>
            </Card>

            {/* Последние операции */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700">Последние операции</h3>
                <Link href={`/income?from=${range.start}&to=${range.end}`}>
                  <Button variant="ghost" size="sm" className="text-xs">
                    Все <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>

              <div className="space-y-2 max-h-64 overflow-auto">
                {[...filteredIncomes, ...filteredExpenses]
                  .filter(item => item.date >= range.start && item.date <= range.end)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 5)
                  .map((item) => {
                    const isIncome = 'cash_amount' in item && 'card_amount' in item
                    const company = companyMap[item.company_id]?.name || '—'
                    const amount = isIncome
                      ? Number(item.cash_amount || 0) + Number(item.kaspi_amount || 0) + 
                        Number(item.card_amount || 0) + Number((item as IncomeRow).online_amount || 0)
                      : Number(item.cash_amount || 0) + Number(item.kaspi_amount || 0)

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${
                            isIncome ? 'bg-green-500' : 'bg-red-500'
                          }`} />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {isIncome ? (item as IncomeRow).comment || 'Продажа' : (item as ExpenseRow).category || 'Расход'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {company} • {DateUtils.format(item.date)}
                            </div>
                          </div>
                        </div>
                        <div className={`text-sm font-medium ${
                          isIncome ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {isIncome ? '+' : '-'}{Format.shortMoney(amount)}
                        </div>
                      </div>
                    )
                  })}

                {filteredIncomes.length === 0 && filteredExpenses.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">
                    Нет операций
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

// ==================== КОМПОНЕНТЫ ====================

function PaymentRow({ label, amount, icon, color }: {
  label: string
  amount: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-medium text-gray-900">
        {Format.shortMoney(amount)}
      </span>
    </div>
  )
}
