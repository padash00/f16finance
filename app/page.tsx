'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import {
  Banknote,
  CreditCard,
  Smartphone,
  TrendingUp,
  CalendarDays,
  UserCircle2,
  Trophy,
  MapPin,
  Sun,
  Moon,
  Brain,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

// --- Типы ---
type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type DateRangePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all'

// --- Даты без UTC-косяков ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)

const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const base = iso ? parseISODateSafe(iso) : parseISODateSafe(todayISO())
  base.setDate(base.getDate() + diff)
  return toISODateLocal(base)
}

const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')

const formatDate = (value: string) => {
  if (!value) return ''
  const d = parseISODateSafe(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatIsoToRu = (iso: string | '') => {
  if (!iso) return '…'
  const d = parseISODateSafe(iso)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Надёжно определяем Extra
const isExtraCompany = (c?: Company | null) => {
  const code = String(c?.code ?? '').toLowerCase().trim()
  const name = String(c?.name ?? '').toLowerCase().trim()
  return code === 'extra' || name.includes('extra')
}

// AI Insight типы
type AIInsight = {
  type: 'positive' | 'negative' | 'neutral' | 'warning' | 'tip'
  title: string
  description: string
  metric?: string
  change?: number
}

export default function DashboardPage() {
  const LIMIT = 2000

  // Данные
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [hitLimit, setHitLimit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // AI Insights
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([])
  const [aiLoading, setAiLoading] = useState(false)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(addDaysISO(todayISO(), -29))
  const [dateTo, setDateTo] = useState(todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')

  // Рефы для загрузки
  useEffect(() => {
    const fetchRefs = async () => {
      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
        supabase
          .from('operators')
          .select('id, name, short_name, is_active')
          .eq('is_active', true)
          .order('name'),
      ])
      if (!compRes.error && compRes.data) setCompanies(compRes.data)
      if (!opRes.error && opRes.data) setOperators(opRes.data)
    }
    fetchRefs()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const operatorMap = useMemo(() => {
    const map = new Map<string, Operator>()
    for (const o of operators) map.set(o.id, o)
    return map
  }, [operators])

  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => isExtraCompany(c))
    return extra?.id ?? null
  }, [companies])

  const isExtraRow = useCallback((r: IncomeRow) => !!extraCompanyId && r.company_id === extraCompanyId, [extraCompanyId])

  // Загрузка доходов (с LIMIT 2000 как на странице доходов)
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)
      setHitLimit(false)

      const t0 = performance.now()

      let query = supabase
        .from('incomes')
        .select(
          'id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment',
        )
        .order('date', { ascending: false })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)

      query = query.limit(LIMIT)

      const { data, error } = await query

      const t1 = performance.now()
      console.log(`dashboard incomes query time: ${(t1 - t0).toFixed(0)} ms, rows: ${data?.length ?? 0}`)

      if (error) {
        console.error('Error loading incomes:', error)
        setError('Ошибка при загрузке данных')
        setRows([])
      } else {
        const list = (data || []) as IncomeRow[]
        setRows(list)
        setHitLimit(list.length >= LIMIT)
      }

      setLoading(false)
    }

    loadData()
  }, [dateFrom, dateTo])

  // Генерация AI Insights
  useEffect(() => {
    const generateInsights = () => {
      setAiLoading(true)
      
      const insights: AIInsight[] = []
      
      // Анализ тренда
      const dailyData = useDailyData()
      if (dailyData.length >= 2) {
        const firstWeek = dailyData.slice(0, Math.min(7, Math.floor(dailyData.length / 2)))
        const secondWeek = dailyData.slice(Math.floor(dailyData.length / 2))
        
        const firstAvg = firstWeek.reduce((s, d) => s + d.total, 0) / firstWeek.length
        const secondAvg = secondWeek.reduce((s, d) => s + d.total, 0) / secondWeek.length
        
        const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0
        
        if (change > 15) {
          insights.push({
            type: 'positive',
            title: 'Рост выручки',
            description: `Выручка выросла на ${change.toFixed(1)}% по сравнению с предыдущим периодом`,
            metric: `+${change.toFixed(1)}%`,
            change,
          })
        } else if (change < -15) {
          insights.push({
            type: 'negative',
            title: 'Снижение выручки',
            description: `Выручка снизилась на ${Math.abs(change).toFixed(1)}% — стоит проанализировать причины`,
            metric: `${change.toFixed(1)}%`,
            change,
          })
        }
      }

      // Анализ по способам оплаты
      const { cash, kaspi, online, card, total } = analytics
      if (total > 0) {
        const kaspiShare = (kaspi / total) * 100
        const cashShare = (cash / total) * 100
        
        if (kaspiShare > 50) {
          insights.push({
            type: 'neutral',
            title: 'Kaspi доминирует',
            description: `${kaspiShare.toFixed(0)}% платежей через Kaspi POS — убедитесь, что терминал работает стабильно`,
          })
        }
        
        if (cashShare < 10 && cashShare > 0) {
          insights.push({
            type: 'tip',
            title: 'Мало наличных',
            description: 'Наличные составляют менее 10% — возможно, стоит проверить работу кассы',
          })
        }
      }

      // Анализ по сменам
      if (analytics.dayTotal > 0 || analytics.nightTotal > 0) {
        const dayShare = analytics.dayTotal / (analytics.dayTotal + analytics.nightTotal)
        if (dayShare > 0.7) {
          insights.push({
            type: 'neutral',
            title: 'Дневная нагрузка',
            description: 'Более 70% выручки приходится на дневную смену — ночная смена недогружена',
          })
        }
      }

      // Топ оператор
      if (analytics.topOperatorAmount > 0) {
        const avgPerOperator = analytics.total / Object.keys(analytics.byOperator).length
        if (analytics.topOperatorAmount > avgPerOperator * 1.5) {
          insights.push({
            type: 'positive',
            title: 'Звезда команды',
            description: `${analytics.topOperatorName} показывает результат на ${((analytics.topOperatorAmount / avgPerOperator - 1) * 100).toFixed(0)}% выше среднего`,
          })
        }
      }

      // Предупреждение о лимите
      if (hitLimit) {
        insights.push({
          type: 'warning',
          title: 'Данные обрезаны',
          description: `Показаны только первые ${LIMIT} записей. Для полного анализа уточните период`,
        })
      }

      setAiInsights(insights)
      setAiLoading(false)
    }

    if (!loading && rows.length > 0) {
      generateInsights()
    }
  }, [rows, loading, hitLimit])

  // Аналитика (Extra всегда включён)
  const analytics = useMemo(() => {
    let cash = 0
    let kaspi = 0
    let online = 0
    let card = 0
    let dayTotal = 0
    let nightTotal = 0

    const byOperator: Record<string, number> = {}
    const byZone: Record<string, number> = {}
    const byCompany: Record<string, number> = {}
    const byDate: Record<string, number> = {}

    for (const r of rows) {
      const rowCash = Number(r.cash_amount || 0)
      const rowKaspi = Number(r.kaspi_amount || 0)
      const rowOnline = Number(r.online_amount || 0)
      const rowCard = Number(r.card_amount || 0)
      const rowTotal = rowCash + rowKaspi + rowOnline + rowCard

      cash += rowCash
      kaspi += rowKaspi
      online += rowOnline
      card += rowCard

      if (r.shift === 'day') dayTotal += rowTotal
      else nightTotal += rowTotal

      const opKey = operatorMap.get(r.operator_id ?? '')?.short_name || operatorMap.get(r.operator_id ?? '')?.name || 'Без оператора'
      byOperator[opKey] = (byOperator[opKey] || 0) + rowTotal

      const z = (r.zone || '—').trim() || '—'
      byZone[z] = (byZone[z] || 0) + rowTotal

      const compName = companyMap.get(r.company_id)?.name || '—'
      byCompany[compName] = (byCompany[compName] || 0) + rowTotal

      byDate[r.date] = (byDate[r.date] || 0) + rowTotal
    }

    const total = cash + kaspi + online + card
    const avg = rows.length ? Math.round(total / rows.length) : 0

    const topOperator = Object.entries(byOperator).sort((a, b) => b[1] - a[1])[0] || ['—', 0]
    const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    return {
      cash,
      kaspi,
      online,
      card,
      total,
      avg,
      dayTotal,
      nightTotal,
      byOperator,
      byZone,
      byCompany,
      byDate,
      topOperatorName: topOperator[0],
      topOperatorAmount: topOperator[1],
      topZoneName: topZone[0],
      topZoneAmount: topZone[1],
    }
  }, [rows, companyMap, operatorMap])

  // Данные для графиков
  const useDailyData = () => {
    return useMemo(() => {
      const dates = Object.keys(analytics.byDate).sort()
      return dates.map(date => ({
        date: formatDate(date),
        fullDate: date,
        total: analytics.byDate[date],
      }))
    }, [analytics.byDate])
  }

  const dailyData = useDailyData()

  const paymentMethodData = useMemo(() => [
    { name: 'Наличные', value: analytics.cash, color: '#22c55e' },
    { name: 'Kaspi POS', value: analytics.kaspi, color: '#3b82f6' },
    { name: 'Kaspi Online', value: analytics.online, color: '#06b6d4' },
    { name: 'Карта', value: analytics.card, color: '#a855f7' },
  ], [analytics])

  const shiftData = useMemo(() => [
    { name: 'День', value: analytics.dayTotal, icon: '☀️' },
    { name: 'Ночь', value: analytics.nightTotal, icon: '🌙' },
  ], [analytics])

  const operatorData = useMemo(() => {
    return Object.entries(analytics.byOperator)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }))
  }, [analytics.byOperator])

  const companyData = useMemo(() => {
    return Object.entries(analytics.byCompany)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }))
  }, [analytics.byCompany])

  // Пресеты дат
  const setPreset = (preset: DateRangePreset) => {
    const today = todayISO()
    setActivePreset(preset)

    if (preset === 'today') {
      setDateFrom(today)
      setDateTo(today)
    }
    if (preset === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    }
    if (preset === 'month') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    }
    if (preset === 'quarter') {
      setDateFrom(addDaysISO(today, -89))
      setDateTo(today)
    }
    if (preset === 'year') {
      setDateFrom(addDaysISO(today, -364))
      setDateTo(today)
    }
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  const periodLabel = dateFrom || dateTo ? `${formatIsoToRu(dateFrom)} — ${formatIsoToRu(dateTo)}` : 'Весь период'

  const getInsightIcon = (type: AIInsight['type']) => {
    switch (type) {
      case 'positive': return <TrendingUp className="w-5 h-5 text-green-500" />
      case 'negative': return <TrendingUp className="w-5 h-5 text-red-500 rotate-180" />
      case 'warning': return <AlertCircle className="w-5 h-5 text-yellow-500" />
      case 'tip': return <Brain className="w-5 h-5 text-purple-500" />
      default: return <Brain className="w-5 h-5 text-blue-500" />
    }
  }

  const getInsightBorder = (type: AIInsight['type']) => {
    switch (type) {
      case 'positive': return 'border-green-500/30 bg-green-500/5'
      case 'negative': return 'border-red-500/30 bg-red-500/5'
      case 'warning': return 'border-yellow-500/30 bg-yellow-500/5'
      case 'tip': return 'border-purple-500/30 bg-purple-500/5'
      default: return 'border-blue-500/30 bg-blue-500/5'
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Шапка */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Дашборд</h1>
              <p className="text-muted-foreground mt-1 text-sm">AI-аналитика и ключевые метрики</p>
            </div>

            <div className="flex gap-2">
              <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                {(['today', 'week', 'month', 'quarter', 'year'] as DateRangePreset[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`px-3 py-1.5 text-[11px] rounded transition-colors ${
                      activePreset === p ? 'bg-accent text-accent-foreground' : 'hover:bg-white/10 text-muted-foreground'
                    }`}
                  >
                    {p === 'today' && 'Сегодня'}
                    {p === 'week' && 'Неделя'}
                    {p === 'month' && 'Месяц'}
                    {p === 'quarter' && 'Квартал'}
                    {p === 'year' && 'Год'}
                  </button>
                ))}
              </div>

              <Link href="/income">
                <Button variant="outline" size="sm" className="gap-2 text-xs">
                  <TrendingUp className="w-4 h-4" /> Журнал
                </Button>
              </Link>
            </div>
          </div>

          {/* AI Insights */}
          <Card className="p-4 border-border bg-card/70 neon-glow">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold">AI Аналитика</h2>
              {aiLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            
            {aiInsights.length === 0 && !aiLoading ? (
              <p className="text-sm text-muted-foreground">Недостаточно данных для анализа</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {aiInsights.map((insight, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${getInsightBorder(insight.type)} transition-all hover:scale-[1.02]`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{getInsightIcon(insight.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-sm">{insight.title}</h3>
                          {insight.metric && (
                            <span className={`text-xs font-bold ${insight.change && insight.change > 0 ? 'text-green-500' : insight.change && insight.change < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {insight.metric}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="p-4 border-border bg-card/70 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Banknote className="w-4 h-4 text-green-500" />
                <span className="text-xs uppercase tracking-wide">Наличные</span>
              </div>
              <div className="text-xl font-bold text-foreground">{formatMoney(analytics.cash)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {analytics.total > 0 ? ((analytics.cash / analytics.total) * 100).toFixed(0) : 0}% от общего
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/70 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Smartphone className="w-4 h-4 text-blue-500" />
                <span className="text-xs uppercase tracking-wide">Kaspi POS</span>
              </div>
              <div className="text-xl font-bold text-foreground">{formatMoney(analytics.kaspi)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {analytics.total > 0 ? ((analytics.kaspi / analytics.total) * 100).toFixed(0) : 0}% от общего
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/70 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span className="text-xs uppercase tracking-wide">Kaspi Online</span>
              </div>
              <div className="text-xl font-bold text-foreground">{formatMoney(analytics.online)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {analytics.total > 0 ? ((analytics.online / analytics.total) * 100).toFixed(0) : 0}% от общего
              </div>
            </Card>

            <Card className="p-4 border-border bg-card/70 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CreditCard className="w-4 h-4 text-purple-500" />
                <span className="text-xs uppercase tracking-wide">Карта</span>
              </div>
              <div className="text-xl font-bold text-foreground">{formatMoney(analytics.card)} ₸</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {analytics.total > 0 ? ((analytics.card / analytics.total) * 100).toFixed(0) : 0}% от общего
              </div>
            </Card>

            <Card className="p-4 border border-accent/60 bg-accent/10 flex flex-col justify-center relative overflow-hidden">
              <div className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wider">Всего за период</div>
              <div className="text-2xl font-bold text-accent">{formatMoney(analytics.total)} ₸</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {rows.length} записей • Средний чек: {formatMoney(analytics.avg)} ₸
              </div>
            </Card>
          </div>

          {/* Графики */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Динамика по дням */}
            <Card className="p-4 border-border bg-card/70">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                Динамика по дням
              </h3>
              <div className="h-64">
                {dailyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(v: number) => [`${formatMoney(v)} ₸`, 'Выручка']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke="hsl(var(--accent))" 
                        strokeWidth={2}
                        dot={{ fill: 'hsl(var(--accent))', strokeWidth: 0, r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Нет данных за выбранный период
                  </div>
                )}
              </div>
            </Card>

            {/* Распределение по способам оплаты */}
            <Card className="p-4 border-border bg-card/70">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
                Способы оплаты
              </h3>
              <div className="h-64 flex items-center">
                {analytics.total > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentMethodData.filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {paymentMethodData.filter(d => d.value > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(v: number, n: string) => [`${formatMoney(v)} ₸ (${((v / analytics.total) * 100).toFixed(0)}%)`, n]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full text-center text-muted-foreground text-sm">
                    Нет данных
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {paymentMethodData.filter(d => d.value > 0).map((item) => (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-muted-foreground">{item.name}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Топ операторов */}
            <Card className="p-4 border-border bg-card/70">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <UserCircle2 className="w-4 h-4 text-muted-foreground" />
                Топ операторов
              </h3>
              <div className="h-64">
                {operatorData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={operatorData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis 
                        type="number"
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <YAxis 
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        width={100}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(v: number) => [`${formatMoney(v)} ₸`, 'Выручка']}
                      />
                      <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Нет данных
                  </div>
                )}
              </div>
            </Card>

            {/* Сравнение смен */}
            <Card className="p-4 border-border bg-card/70">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Sun className="w-4 h-4 text-yellow-400" />
                День vs Ночь
              </h3>
              <div className="h-64">
                {analytics.dayTotal > 0 || analytics.nightTotal > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shiftData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(v: number) => [`${formatMoney(v)} ₸`, 'Выручка']}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        <Cell fill="#fbbf24" />
                        <Cell fill="#6366f1" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Нет данных
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-muted-foreground">
                    День: {formatMoney(analytics.dayTotal)} ₸ ({analytics.dayTotal + analytics.nightTotal > 0 ? ((analytics.dayTotal / (analytics.dayTotal + analytics.nightTotal)) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs text-muted-foreground">
                    Ночь: {formatMoney(analytics.nightTotal)} ₸ ({analytics.dayTotal + analytics.nightTotal > 0 ? ((analytics.nightTotal / (analytics.dayTotal + analytics.nightTotal)) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* Компании */}
          <Card className="p-4 border-border bg-card/70">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-muted-foreground" />
              Выручка по компаниям
            </h3>
            <div className="h-48">
              {companyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={companyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(v: number) => [`${formatMoney(v)} ₸`, 'Выручка']}
                    />
                    <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Нет данных
                </div>
              )}
            </div>
          </Card>

          {/* Период и предупреждение */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              <span className="uppercase tracking-wide">Период:</span>
              <span className="font-mono">{periodLabel}</span>
            </div>
            {hitLimit && (
              <div className="text-yellow-500/90">
                ⚠️ Показаны первые {LIMIT} записей. Для полного анализа уточните период.
              </div>
            )}
          </div>

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 rounded text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
