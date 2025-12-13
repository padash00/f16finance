'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  RefreshCw,
  Download,
  CalendarDays,
  Banknote,
  Smartphone,
  Tag,
  Filter,
  ArrowLeft,
  BarChart3,
  PieChart as PieIcon,
  TrendingUp,
  AlertCircle,
  Search,
  LayoutGrid
} from 'lucide-react'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  ReferenceLine
} from 'recharts'

// ================== TYPES ==================
type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type PayFilter = 'all' | 'cash' | 'kaspi'
type DateRangePreset = 'today' | 'week' | 'month' | 'year' | 'all'
type GroupBy = 'day' | 'week' | 'month'

// ================== CONFIG ==================
const PAGE_SIZE = 500
const MAX_ROWS_HARD_LIMIT = 5000 // Увеличим лимит для хорошего анализа
const COLORS = ['#2563eb', '#db2777', '#ea580c', '#16a34a', '#9333ea', '#eab308', '#06b6d4', '#64748b']

// ================== DATE HELPERS ==================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)
const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const d = parseISODateSafe(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const getStartOfYear = () => toISODateLocal(new Date(new Date().getFullYear(), 0, 1))

const formatMoney = (v: number | null | undefined) => Math.round(v ?? 0).toLocaleString('ru-RU')

const formatDateLabel = (iso: string, groupBy: GroupBy) => {
    const d = parseISODateSafe(iso)
    if (groupBy === 'month') return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    if (groupBy === 'week') return `Нед. ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// ================== COMPONENTS ==================

// Простая тепловая карта (Grid Heatmap)
const Heatmap = ({ data, maxVal }: { data: { date: string; value: number }[], maxVal: number }) => {
    if (!data.length) return <div className="text-muted-foreground text-sm">Нет данных</div>
    
    // Генерируем сетку последних 60 дней (или из данных)
    return (
        <div className="flex flex-wrap gap-1">
            {data.map((item) => {
                const opacity = item.value > 0 ? 0.2 + (item.value / maxVal) * 0.8 : 0.1
                const colorClass = item.value > 0 ? `bg-red-500` : `bg-secondary`
                return (
                    <div 
                        key={item.date} 
                        className={`w-3 h-3 rounded-sm ${colorClass} transition-all hover:scale-125 cursor-pointer`}
                        style={{ opacity: item.value > 0 ? opacity : 1 }}
                        title={`${item.date}: ${formatMoney(item.value)}`}
                    />
                )
            })}
        </div>
    )
}

export default function ExpensesAnalysisPage() {
  // ================== STATE ==================
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState(getStartOfYear())
  const [dateTo, setDateTo] = useState(todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('year')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('month')
  const [searchTerm, setSearchTerm] = useState('')

  // ================== INIT ==================
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies').select('id, name, code').order('name')
      if (data) setCompanies(data as Company[])
    }
    fetchCompanies()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const companyName = useCallback((id: string) => companyMap.get(id)?.name ?? '—', [companyMap])
  const extraCompanyId = useMemo(() => companies.find(c => c.code === 'extra' || c.name.includes('Extra'))?.id, [companies])

  // ================== DATA LOADING ==================
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
        let q = supabase
            .from('expenses')
            .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('date', { ascending: true })
            .limit(MAX_ROWS_HARD_LIMIT)

        if (companyFilter !== 'all') q = q.eq('company_id', companyFilter)
        if (categoryFilter !== 'all') q = q.eq('category', categoryFilter)
        if (searchTerm.length > 2) q = q.ilike('comment', `%${searchTerm}%`)

        const { data, error } = await q
        if (error) throw error
        setRows(data as ExpenseRow[])
    } catch (e: any) {
        console.error(e)
        setError('Ошибка загрузки данных')
    } finally {
        setLoading(false)
    }
  }, [dateFrom, dateTo, companyFilter, categoryFilter, searchTerm])

  useEffect(() => { loadData() }, [loadData])

  // ================== SMART ANALYTICS ENGINE ==================
  const analytics = useMemo(() => {
    // 1. Фильтрация
    const cleanRows = rows.filter(r => r.company_id !== extraCompanyId) // Исключаем Extra по дефолту для точности
    
    let totalSum = 0
    const byCategory: Record<string, number> = {}
    const byDate: Record<string, Record<string, number>> = {} // date -> { total: 0, cat1: 100, cat2: 200 }
    const dailyTotals: { date: string, value: number }[] = []
    
    // Группировка для графиков
    cleanRows.forEach(r => {
        const sum = (r.cash_amount || 0) + (r.kaspi_amount || 0)
        totalSum += sum

        // Категории
        const cat = r.category || 'Прочее'
        byCategory[cat] = (byCategory[cat] || 0) + sum

        // Временная шкала (Stacked Data)
        let key = r.date
        if (groupBy === 'month') key = r.date.slice(0, 7) // YYYY-MM
        else if (groupBy === 'week') {
            const d = parseISODateSafe(r.date)
            const day = d.getDay() || 7
            d.setDate(d.getDate() - day + 1)
            key = toISODateLocal(d)
        }

        if (!byDate[key]) byDate[key] = { date: key, total: 0 }
        byDate[key].total += sum
        byDate[key][cat] = (byDate[key][cat] || 0) + sum

        // Heatmap data (всегда по дням)
        if (groupBy === 'day') {
           // если группировка по дням, используем уже агрегированные данные графика
        }
    })
    
    // Преобразуем для Heatmap (отдельный проход для чистоты, если group != day)
    const heatmapMap: Record<string, number> = {}
    cleanRows.forEach(r => {
         const sum = (r.cash_amount || 0) + (r.kaspi_amount || 0)
         heatmapMap[r.date] = (heatmapMap[r.date] || 0) + sum
    })
    const heatmapData = Object.entries(heatmapMap).map(([date, value]) => ({ date, value })).sort((a,b) => a.date.localeCompare(b.date))
    const maxDailySpend = Math.max(...heatmapData.map(d => d.value), 0)

    // Преобразуем для Stacked Chart
    const timelineData = Object.values(byDate)
        .sort((a, b) => (a.date as string).localeCompare(b.date as string))
        .map(item => ({
            ...item,
            label: formatDateLabel(item.date as string, groupBy)
        }))

    // Топ категорий (ABC)
    const sortedCats = Object.entries(byCategory)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)

    const categoriesList = sortedCats.map(c => c.name)

    // "Умные" метрики
    const avgSpend = timelineData.length ? totalSum / timelineData.length : 0
    const topSpenderDay = heatmapData.length ? heatmapData.reduce((prev, current) => (prev.value > current.value) ? prev : current) : null

    return {
        totalSum,
        timelineData,
        heatmapData,
        maxDailySpend,
        sortedCats,
        categoriesList,
        avgSpend,
        topSpenderDay,
        cleanRowCount: cleanRows.length
    }
  }, [rows, extraCompanyId, groupBy])

  // ================== HANDLERS ==================
  const setPreset = (p: DateRangePreset) => {
    setActivePreset(p)
    const t = todayISO()
    if (p === 'today') { setDateFrom(t); setDateTo(t); setGroupBy('day') }
    if (p === 'week') { setDateFrom(addDaysISO(t, -6)); setDateTo(t); setGroupBy('day') }
    if (p === 'month') { setDateFrom(addDaysISO(t, -29)); setDateTo(t); setGroupBy('week') }
    if (p === 'year') { setDateFrom(getStartOfYear()); setDateTo(t); setGroupBy('month') }
    if (p === 'all') { setDateFrom('2023-01-01'); setDateTo(t); setGroupBy('month') }
  }

  // Цвета для категорий в графике (циклически)
  const getCatColor = (index: number) => COLORS[index % COLORS.length]

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8 space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Link href="/expenses" className="hover:text-primary"><ArrowLeft className="w-4 h-4" /></Link>
                    <span className="text-sm">Аналитика финансов</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight">Умный анализ расходов</h1>
            </div>
            <div className="flex gap-2">
                 <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Обновить
                 </Button>
                 {/* Кнопка экспорта (можно добавить логику CSV как раньше) */}
                 <Button variant="ghost" size="sm"><Download className="w-4 h-4" /></Button>
            </div>
        </div>

        {/* Controls */}
        <Card className="p-4 bg-card neon-glow border-border/60">
            <div className="flex flex-col xl:flex-row gap-6 justify-between">
                
                {/* Time Controls */}
                <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Период анализа</label>
                    <div className="flex flex-wrap gap-2 items-center">
                        <div className="flex items-center bg-secondary/50 rounded-md p-1 border border-border/50">
                             <CalendarDays className="w-4 h-4 text-muted-foreground ml-2 mr-2" />
                             <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-transparent text-sm w-28 outline-none" />
                             <span className="text-muted-foreground mx-1">-</span>
                             <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-transparent text-sm w-28 outline-none" />
                        </div>
                        <div className="flex bg-secondary/30 rounded-md p-1 gap-1">
                            {['week', 'month', 'year', 'all'].map((p) => (
                                <button 
                                    key={p} 
                                    onClick={() => setPreset(p as DateRangePreset)}
                                    className={`px-3 py-1 text-xs rounded-sm transition-all ${activePreset === p ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-background text-muted-foreground'}`}
                                >
                                    {p === 'week' && '7 дн'}
                                    {p === 'month' && '30 дн'}
                                    {p === 'year' && 'Год'}
                                    {p === 'all' && 'Всё'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Group & Filter Controls */}
                <div className="space-y-2 flex-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Параметры</label>
                    <div className="flex flex-wrap gap-3">
                         <div className="flex flex-col">
                            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="h-9 bg-input border border-border rounded px-3 text-xs w-32">
                                <option value="day">По дням</option>
                                <option value="week">По неделям</option>
                                <option value="month">По месяцам</option>
                            </select>
                         </div>
                         <div className="flex flex-col">
                            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="h-9 bg-input border border-border rounded px-3 text-xs w-40">
                                <option value="all">Все компании</option>
                                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                         </div>
                         <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <input 
                                placeholder="Поиск по комментарию..." 
                                value={searchTerm} 
                                onChange={e => setSearchTerm(e.target.value)} 
                                className="w-full h-9 pl-9 pr-4 bg-input border border-border rounded text-xs placeholder:text-muted-foreground/50" 
                            />
                         </div>
                    </div>
                </div>
            </div>
        </Card>

        {/* --- KPI BLOCK --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-5 border-l-4 border-l-primary bg-card/50">
                <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Всего расходов</div>
                <div className="text-2xl font-bold tracking-tight">{formatMoney(analytics.totalSum)} ₸</div>
                <div className="text-[10px] text-muted-foreground mt-2">за выбранный период</div>
            </Card>

            <Card className="p-5 border-l-4 border-l-orange-500 bg-card/50">
                <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Средний расход</div>
                <div className="text-2xl font-bold tracking-tight">{formatMoney(analytics.avgSpend)} ₸</div>
                <div className="text-[10px] text-muted-foreground mt-2">в {groupBy === 'day' ? 'день' : groupBy === 'week' ? 'неделю' : 'месяц'}</div>
            </Card>

            <Card className="p-5 border-l-4 border-l-pink-500 bg-card/50">
                <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Топ категория</div>
                <div className="text-xl font-bold tracking-tight truncate">{analytics.sortedCats[0]?.name || '—'}</div>
                <div className="text-[10px] text-muted-foreground mt-2">
                    {formatMoney(analytics.sortedCats[0]?.value)} ₸ ({((analytics.sortedCats[0]?.value / analytics.totalSum)*100).toFixed(1)}%)
                </div>
            </Card>

            <Card className="p-5 border-l-4 border-l-red-600 bg-card/50 relative overflow-hidden">
                <div className="text-xs text-muted-foreground uppercase font-bold mb-1">Пик расходов</div>
                <div className="text-xl font-bold tracking-tight">{analytics.topSpenderDay ? formatMoney(analytics.topSpenderDay.value) : 0} ₸</div>
                <div className="text-[10px] text-muted-foreground mt-2">
                   Дата: {analytics.topSpenderDay ? formatDateLabel(analytics.topSpenderDay.date, 'day') : '—'}
                </div>
                <AlertCircle className="absolute right-4 top-4 w-8 h-8 text-red-500/20" />
            </Card>
        </div>

        {/* --- CHARTS TABS --- */}
        <Tabs defaultValue="structure" className="w-full space-y-4">
            <TabsList className="bg-secondary/40">
                <TabsTrigger value="structure" className="gap-2"><LayoutGrid className="w-4 h-4"/> Структура (Stacked)</TabsTrigger>
                <TabsTrigger value="heatmap" className="gap-2"><CalendarDays className="w-4 h-4"/> Тепловая карта</TabsTrigger>
                <TabsTrigger value="categories" className="gap-2"><PieIcon className="w-4 h-4"/> Рейтинг категорий</TabsTrigger>
            </TabsList>

            {/* TAB 1: STACKED BAR CHART (Главный анализ) */}
            <TabsContent value="structure">
                <Card className="p-6 border-border">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-primary" />
                                Динамика по категориям
                            </h3>
                            <p className="text-sm text-muted-foreground">Показывает, из чего состояли расходы в каждый период</p>
                        </div>
                        {/* Легенда */}
                        <div className="flex flex-wrap gap-2 max-w-md justify-end">
                            {analytics.categoriesList.slice(0, 6).map((cat, i) => (
                                <div key={cat} className="flex items-center gap-1 text-[10px]">
                                    <span className="w-2 h-2 rounded-full" style={{backgroundColor: getCatColor(i)}} />
                                    {cat}
                                </div>
                            ))}
                            {analytics.categoriesList.length > 6 && <span className="text-[10px] text-muted-foreground">...и др.</span>}
                        </div>
                    </div>
                    
                    <div className="h-[400px] w-full">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analytics.timelineData} margin={{top: 20, right: 0, left: 0, bottom: 0}}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                <XAxis dataKey="label" tick={{fontSize: 11}} axisLine={false} tickLine={false} />
                                <YAxis tick={{fontSize: 11}} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                                <Tooltip 
                                    cursor={{fill: 'hsl(var(--muted)/0.2)'}}
                                    contentStyle={{backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px'}}
                                    formatter={(val: number) => formatMoney(val) + ' ₸'}
                                />
                                {analytics.categoriesList.map((cat, index) => (
                                    <Bar 
                                        key={cat} 
                                        dataKey={cat} 
                                        stackId="a" 
                                        fill={getCatColor(index)} 
                                        radius={[0,0,0,0]} // Прямоугольные для стека
                                    />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </TabsContent>

            {/* TAB 2: HEATMAP */}
            <TabsContent value="heatmap">
                <Card className="p-6 border-border">
                    <h3 className="text-lg font-semibold mb-2">Интенсивность расходов</h3>
                    <p className="text-sm text-muted-foreground mb-6">Чем краснее ячейка, тем больше денег было потрачено в этот день.</p>
                    
                    <div className="space-y-2">
                         <Heatmap data={analytics.heatmapData} maxVal={analytics.maxDailySpend} />
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Меньше</span>
                        <div className="flex gap-1">
                             <div className="w-3 h-3 bg-secondary rounded-sm"></div>
                             <div className="w-3 h-3 bg-red-500 opacity-20 rounded-sm"></div>
                             <div className="w-3 h-3 bg-red-500 opacity-50 rounded-sm"></div>
                             <div className="w-3 h-3 bg-red-500 opacity-100 rounded-sm"></div>
                        </div>
                        <span>Больше</span>
                    </div>
                </Card>
            </TabsContent>

            {/* TAB 3: CATEGORIES PARETO */}
            <TabsContent value="categories">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="p-6 border-border">
                         <h3 className="text-lg font-semibold mb-4">Топ затратных категорий</h3>
                         <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={analytics.sortedCats}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%" cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={2}
                                    >
                                        {analytics.sortedCats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={getCatColor(index)} stroke="hsl(var(--background))" strokeWidth={2} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(val:number) => formatMoney(val) + ' ₸'} />
                                    <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                         </div>
                    </Card>

                    <Card className="p-6 border-border overflow-auto h-[380px]">
                        <table className="w-full text-sm text-left">
                            <thead className="text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="pb-2 pl-2">Категория</th>
                                    <th className="pb-2 text-right">Сумма</th>
                                    <th className="pb-2 text-right">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analytics.sortedCats.map((c, i) => (
                                    <tr key={c.name} className="border-b border-border/40 hover:bg-secondary/20">
                                        <td className="py-2 pl-2 flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{backgroundColor: getCatColor(i)}} />
                                            {c.name}
                                        </td>
                                        <td className="py-2 text-right font-medium">{formatMoney(c.value)}</td>
                                        <td className="py-2 text-right text-muted-foreground">
                                            {((c.value / analytics.totalSum) * 100).toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                </div>
            </TabsContent>
        </Tabs>

      </main>
    </div>
  )
}
