'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  RefreshCw,
  CalendarDays,
  ArrowLeft,
  TrendingDown,
  TrendingUp,
  Wallet,
  PieChart as PieIcon,
  Search,
  ArrowUpRight
} from 'lucide-react'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend
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

type Company = { id: string; name: string; code?: string | null }
type TimeRange = 'week' | 'month' | 'year' | 'all'

// ================== CONFIG ==================
const COLORS = ['#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#6366f1']
const MAX_ROWS = 5000

// ================== HELPERS ==================
const toISO = (d: Date) => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
}
const parseDate = (iso: string) => new Date(`${iso}T12:00:00`)
const formatMoney = (v: number) => Math.round(v).toLocaleString('ru-RU')

const getDateRange = (range: TimeRange) => {
    const today = new Date()
    const tIso = toISO(today)
    let from = new Date()
    
    if (range === 'week') from.setDate(today.getDate() - 7)
    if (range === 'month') from.setDate(today.getDate() - 30)
    if (range === 'year') from.setFullYear(today.getFullYear(), 0, 1)
    if (range === 'all') from = new Date('2023-01-01')

    return { from: toISO(from), to: tIso }
}

export default function ExpensesDashboard() {
  // Data
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [range, setRange] = useState<TimeRange>('month')
  const [companyId, setCompanyId] = useState<string>('all')
  
  // ================== LOAD ==================
  useEffect(() => {
    supabase.from('companies').select('id, name, code').order('name').then(({data}) => {
        if(data) setCompanies(data)
    })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { from, to } = getDateRange(range)
    
    let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .limit(MAX_ROWS)

    if (companyId !== 'all') q = q.eq('company_id', companyId)

    const { data } = await q
    if (data) setRows(data as ExpenseRow[])
    setLoading(false)
  }, [range, companyId])

  useEffect(() => { loadData() }, [loadData])

  // ================== ANALYTICS ==================
  const stats = useMemo(() => {
    const extraId = companies.find(c => c.code === 'extra' || c.name.includes('Extra'))?.id
    // Фильтруем Extra если выбрано "Все компании", чтобы не портить статистику
    const cleanRows = (companyId === 'all' && extraId) 
        ? rows.filter(r => r.company_id !== extraId) 
        : rows

    let total = 0
    let cash = 0
    let kaspi = 0
    
    const catMap: Record<string, number> = {}
    const dateMap: Record<string, number> = {}
    
    // Для списка топ транзакций
    const transactions = cleanRows.map(r => ({
        ...r,
        sum: (r.cash_amount||0) + (r.kaspi_amount||0)
    })).sort((a,b) => b.sum - a.sum)

    cleanRows.forEach(r => {
        const sum = (r.cash_amount || 0) + (r.kaspi_amount || 0)
        total += sum
        cash += (r.cash_amount || 0)
        kaspi += (r.kaspi_amount || 0)

        const cat = r.category || 'Без категории'
        catMap[cat] = (catMap[cat] || 0) + sum

        // Группировка по дням для графика
        dateMap[r.date] = (dateMap[r.date] || 0) + sum
    })

    // График (массив)
    const chartData = Object.entries(dateMap)
        .sort((a,b) => a[0].localeCompare(b[0]))
        .map(([date, val]) => ({
            date: parseDate(date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
            value: val
        }))

    // Категории (массив для Pie)
    const catData = Object.entries(catMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a,b) => b.value - a.value)

    return { total, cash, kaspi, chartData, catData, topTransactions: transactions.slice(0, 5) }
  }, [rows, companies, companyId])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8 space-y-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                 <Link href="/expenses" className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-1 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Назад к журналу
                 </Link>
                 <h1 className="text-3xl font-bold tracking-tight">Дашборд расходов</h1>
            </div>

            {/* FILTERS */}
            <div className="flex flex-wrap gap-2 items-center bg-card p-1 rounded-lg border border-border/50">
                <select 
                    value={companyId} 
                    onChange={e => setCompanyId(e.target.value)}
                    className="bg-transparent text-sm h-8 px-2 outline-none border-r border-border/50 mr-2 min-w-[120px]"
                >
                    <option value="all">Все компании</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                {['week', 'month', 'year', 'all'].map((r) => (
                    <button
                        key={r}
                        onClick={() => setRange(r as TimeRange)}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${
                            range === r ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-secondary'
                        }`}
                    >
                        {r === 'week' && 'Неделя'}
                        {r === 'month' && 'Месяц'}
                        {r === 'year' && 'Год'}
                        {r === 'all' && 'Всё время'}
                    </button>
                ))}
                
                <Button variant="ghost" size="icon" className="h-8 w-8 ml-1" onClick={loadData}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
                </Button>
            </div>
        </div>

        {/* --- BIG NUMBERS (KPI) --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6 border-l-4 border-l-red-500 bg-gradient-to-br from-card to-background shadow-sm">
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Всего расходов</p>
                        <h2 className="text-3xl font-bold mt-2">{formatMoney(stats.total)} <span className="text-lg text-muted-foreground font-normal">₸</span></h2>
                    </div>
                    <div className="p-3 bg-red-500/10 rounded-full">
                        <Wallet className="w-6 h-6 text-red-500" />
                    </div>
                </div>
            </Card>

            <Card className="p-6 bg-card/60">
                 <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-foreground" />
                    <p className="text-xs font-medium text-muted-foreground uppercase">Наличные</p>
                 </div>
                 <div className="text-xl font-bold">{formatMoney(stats.cash)} ₸</div>
            </Card>

            <Card className="p-6 bg-card/60">
                 <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground uppercase">Kaspi</p>
                 </div>
                 <div className="text-xl font-bold">{formatMoney(stats.kaspi)} ₸</div>
            </Card>
        </div>

        {/* --- MAIN CHART (AREA) --- */}
        <Card className="p-6 border-border shadow-sm">
            <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Динамика затрат</h3>
            </div>
            <div className="h-[300px] w-full">
                {stats.chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                            <XAxis dataKey="date" tick={{fontSize: 12, fill: '#888'}} axisLine={false} tickLine={false} tickMargin={10} minTickGap={30} />
                            <YAxis hide />
                            <Tooltip 
                                contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                                formatter={(val: number) => [formatMoney(val) + ' ₸', 'Сумма']}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="value" 
                                stroke="hsl(var(--primary))" 
                                strokeWidth={3} 
                                fillOpacity={1} 
                                fill="url(#colorVal)" 
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">Нет данных за этот период</div>
                )}
            </div>
        </Card>

        {/* --- BOTTOM ROW: CATEGORIES & TOP TRANSACTIONS --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 1. CATEGORIES (DONUT + LIST) */}
            <Card className="p-6 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                    <PieIcon className="w-5 h-5 text-muted-foreground" />
                    <h3 className="font-semibold">Куда уходят деньги?</h3>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    {/* Donut */}
                    <div className="w-[180px] h-[180px] relative">
                         <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.catData}
                                    innerRadius={55}
                                    outerRadius={80}
                                    paddingAngle={2}
                                    dataKey="value"
                                >
                                    {stats.catData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(val:number) => formatMoney(val) + ' ₸'} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-xs font-bold text-muted-foreground">{stats.catData.length} кат.</span>
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 w-full space-y-3 max-h-[240px] overflow-y-auto pr-2 custom-scrollbar">
                        {stats.catData.map((c, i) => (
                            <div key={c.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                    <span className="truncate max-w-[120px] text-muted-foreground">{c.name}</span>
                                </div>
                                <div className="font-medium">{formatMoney(c.value)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>

            {/* 2. TOP TRANSACTIONS (LIST) */}
            <Card className="p-6 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                    <ArrowUpRight className="w-5 h-5 text-red-500" />
                    <h3 className="font-semibold">Топ 5 крупных трат</h3>
                </div>

                <div className="space-y-4">
                    {stats.topTransactions.map((t) => (
                        <div key={t.id} className="flex items-center justify-between pb-3 border-b border-border/40 last:border-0 last:pb-0">
                            <div className="flex flex-col gap-0.5 overflow-hidden">
                                <span className="font-medium truncate">{t.comment || 'Без комментария'}</span>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{parseDate(t.date).toLocaleDateString('ru-RU')}</span>
                                    <span>•</span>
                                    <span className="bg-secondary px-1.5 py-0.5 rounded text-[10px]">{t.category || 'Прочее'}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-bold text-red-400">-{formatMoney(t.sum)} ₸</div>
                                <div className="text-[10px] text-muted-foreground">{t.cash_amount ? 'Нал' : 'Kaspi'}</div>
                            </div>
                        </div>
                    ))}
                    {stats.topTransactions.length === 0 && (
                        <div className="text-center text-muted-foreground text-sm py-10">Нет записей</div>
                    )}
                </div>
            </Card>
        </div>

      </main>
    </div>
  )
}
