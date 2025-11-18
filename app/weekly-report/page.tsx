'use client'

import { useEffect, useState, useMemo } from 'react'
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
  ChevronRight
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell
} from 'recharts'

// --- Типы ---
type Company = { id: string; name: string; code: string | null }

type Totals = {
  incomeCash: number
  incomeKaspi: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  extraTotal: number
  statsByCompany: Record<string, { cash: number; kaspi: number }>
  expenseCategories: { name: string; value: number }[]
}

// --- Хелперы ---
const getTodayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Получаем понедельник и воскресенье для любой даты
const getWeekBounds = (dateISO: string) => {
  const d = new Date(dateISO + 'T00:00:00')
  const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay() // 1=Пн ... 7=Вс
  
  const monday = new Date(d)
  monday.setDate(d.getDate() - (dayOfWeek - 1))
  
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const fmt = (x: Date) => {
    const y = x.getFullYear()
    const m = String(x.getMonth() + 1).padStart(2, '0')
    const dd = String(x.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  return { start: fmt(monday), end: fmt(sunday) }
}

const formatKzt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

// Красивый формат даты для заголовка (18 ноя — 24 ноя)
const formatRangeTitle = (start: string, end: string) => {
    const d1 = new Date(start);
    const d2 = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${d1.toLocaleDateString('ru-RU', opts)} — ${d2.toLocaleDateString('ru-RU', opts)}`;
}

export default function WeeklyReportPage() {
  const today = getTodayISO()
  
  // Инициализация дат
  const [startDate, setStartDate] = useState(getWeekBounds(today).start)
  const [endDate, setEndDate] = useState(getWeekBounds(today).end)

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals | null>(null)

  // --- НАВИГАЦИЯ ПО НЕДЕЛЯМ ---
  
  // Переключить на текущую неделю
  const handleCurrentWeek = () => {
      const { start, end } = getWeekBounds(today);
      setStartDate(start);
      setEndDate(end);
  }

  // Сдвиг недели (+/- 7 дней)
  const shiftWeek = (direction: -1 | 1) => {
      const d = new Date(startDate + 'T00:00:00');
      d.setDate(d.getDate() + (direction * 7));
      
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const { start, end } = getWeekBounds(iso);
      setStartDate(start);
      setEndDate(end);
  }

  // 1. Загрузка данных
  useEffect(() => {
    const load = async () => {
      setLoading(true)

      const { data: comps } = await supabase.from('companies').select('id, name, code').order('name')
      setCompanies(comps || [])

      const [incRes, expRes] = await Promise.all([
        supabase.from('incomes').select('*').gte('date', startDate).lte('date', endDate),
        supabase.from('expenses').select('*').gte('date', startDate).lte('date', endDate)
      ])

      const incomes = incRes.data || []
      const expenses = expRes.data || []

      let iCash = 0, iKaspi = 0, eCash = 0, eKaspi = 0, extra = 0
      const companyStats: Record<string, { cash: number; kaspi: number }> = {}
      const catMap = new Map<string, number>()

      comps?.forEach(c => companyStats[c.id] = { cash: 0, kaspi: 0 })

      for (const r of incomes) {
         const c = comps?.find(x => x.id === r.company_id)
         const isExtra = c?.code === 'extra'
         const cash = Number(r.cash_amount || 0)
         const kaspi = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0)

         if (isExtra) { extra += (cash + kaspi); continue }

         iCash += cash; iKaspi += kaspi
         if (companyStats[r.company_id]) {
             companyStats[r.company_id].cash += cash
             companyStats[r.company_id].kaspi += kaspi
         }
      }

      for (const r of expenses) {
         const c = comps?.find(x => x.id === r.company_id)
         const isExtra = c?.code === 'extra'
         const cash = Number(r.cash_amount || 0)
         const kaspi = Number(r.kaspi_amount || 0)
         const total = cash + kaspi

         if (isExtra) continue

         eCash += cash; eKaspi += kaspi
         const catName = r.category || 'Без категории'
         catMap.set(catName, (catMap.get(catName) || 0) + total)
      }

      const expenseCategories = Array.from(catMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)

      setTotals({
          incomeCash: iCash, incomeKaspi: iKaspi, incomeTotal: iCash + iKaspi,
          expenseCash: eCash, expenseKaspi: eKaspi, expenseTotal: eCash + eKaspi,
          profit: (iCash + iKaspi) - (eCash + eKaspi),
          extraTotal: extra,
          statsByCompany: companyStats,
          expenseCategories
      })
      setLoading(false)
    }
    load()
  }, [startDate, endDate])

  const activeCompanies = useMemo(() => companies.filter(c => c.code !== 'extra'), [companies])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          
          {/* Заголовок + УМНАЯ НАВИГАЦИЯ */}
          <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
             <div>
                <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                   <CalendarDays className="w-8 h-8 text-accent" /> Недельный отчёт
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                   Финансовая сводка (Понедельник — Воскресенье)
                </p>
             </div>

             {/* 🚀 НОВАЯ ПАНЕЛЬ НАВИГАЦИИ */}
             <Card className="p-1.5 flex items-center gap-2 border-border bg-card neon-glow">
                 <Button 
                    variant="ghost" size="icon" 
                    onClick={() => shiftWeek(-1)}
                    className="hover:bg-white/10 w-8 h-8"
                 >
                    <ChevronLeft className="w-5 h-5" />
                 </Button>

                 <div className="px-2 text-center min-w-[140px]">
                    <span className="text-sm font-bold text-foreground block">
                        {formatRangeTitle(startDate, endDate)}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {startDate === getWeekBounds(today).start ? 'Текущая неделя' : 'Архив'}
                    </span>
                 </div>

                 <Button 
                    variant="ghost" size="icon" 
                    onClick={() => shiftWeek(1)}
                    className="hover:bg-white/10 w-8 h-8"
                 >
                    <ChevronRight className="w-5 h-5" />
                 </Button>

                 {startDate !== getWeekBounds(today).start && (
                     <Button 
                        size="sm" variant="secondary" 
                        className="ml-2 text-xs h-7 bg-accent text-accent-foreground hover:bg-accent/80" 
                        onClick={handleCurrentWeek}
                     >
                        Вернуться
                     </Button>
                 )}
             </Card>
          </div>

          {loading && <div className="text-center py-12 text-muted-foreground animate-pulse">Считаем финансы...</div>}

          {!loading && totals && (
             <>
                {/* 📊 ГЛАВНЫЕ ЦИФРЫ (СВЕРХУ) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* ДОХОДЫ */}
                    <Card className="p-5 border-border bg-card neon-glow relative overflow-hidden group">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Общий Доход</p>
                                <h2 className="text-3xl font-bold text-green-400 mt-1">{formatKzt(totals.incomeTotal)}</h2>
                            </div>
                            <div className="p-2 bg-green-500/10 rounded-full">
                                <TrendingUp className="w-6 h-6 text-green-500" />
                            </div>
                        </div>
                        <div className="space-y-3">
                             <div className="flex justify-between text-xs">
                                 <span className="flex items-center gap-1 text-muted-foreground"><Wallet className="w-3 h-3"/> Наличные</span>
                                 <span className="font-mono text-foreground">{formatKzt(totals.incomeCash)}</span>
                             </div>
                             <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                                 <div className="h-full bg-green-500" style={{ width: `${(totals.incomeCash / totals.incomeTotal) * 100}%` }} />
                                 <div className="h-full bg-blue-500" style={{ width: `${(totals.incomeKaspi / totals.incomeTotal) * 100}%` }} />
                             </div>
                             <div className="flex justify-between text-xs">
                                 <span className="flex items-center gap-1 text-muted-foreground"><CreditCard className="w-3 h-3"/> Kaspi / QR</span>
                                 <span className="font-mono text-foreground">{formatKzt(totals.incomeKaspi)}</span>
                             </div>
                        </div>
                    </Card>

                    {/* РАСХОДЫ */}
                    <Card className="p-5 border-border bg-card neon-glow relative overflow-hidden group">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Общий Расход</p>
                                <h2 className="text-3xl font-bold text-red-400 mt-1">{formatKzt(totals.expenseTotal)}</h2>
                            </div>
                            <div className="p-2 bg-red-500/10 rounded-full">
                                <TrendingDown className="w-6 h-6 text-red-500" />
                            </div>
                        </div>
                         <div className="space-y-3">
                             <div className="flex justify-between text-xs">
                                 <span className="flex items-center gap-1 text-muted-foreground"><Wallet className="w-3 h-3"/> Наличные</span>
                                 <span className="font-mono text-foreground">{formatKzt(totals.expenseCash)}</span>
                             </div>
                             <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                                 <div className="h-full bg-red-500" style={{ width: `${(totals.expenseCash / totals.expenseTotal) * 100}%` }} />
                                 <div className="h-full bg-orange-500" style={{ width: `${(totals.expenseKaspi / totals.expenseTotal) * 100}%` }} />
                             </div>
                             <div className="flex justify-between text-xs">
                                 <span className="flex items-center gap-1 text-muted-foreground"><CreditCard className="w-3 h-3"/> Kaspi</span>
                                 <span className="font-mono text-foreground">{formatKzt(totals.expenseKaspi)}</span>
                             </div>
                        </div>
                    </Card>

                    {/* ПРИБЫЛЬ */}
                    <Card className="p-5 border border-accent/50 bg-accent/5 neon-glow flex flex-col justify-between">
                        <div>
                            <p className="text-xs text-accent/80 uppercase tracking-wider font-bold">Чистая Прибыль</p>
                            <h2 className="text-4xl font-bold text-yellow-400 mt-2">{formatKzt(totals.profit)}</h2>
                        </div>
                        <div className="mt-4 pt-4 border-t border-accent/20">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">F16 Extra (не включено)</span>
                                <span className="text-sm font-bold text-purple-400">{formatKzt(totals.extraTotal)}</span>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* 📊 ДЕТАЛЬНЫЙ РАЗБОР */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    
                    {/* ТАБЛИЦА ПО КОМПАНИЯМ */}
                    <Card className="lg:col-span-2 p-6 border-border bg-card neon-glow">
                        <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                             Разбивка по точкам
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase">
                                        <th className="px-4 py-3 text-left">Точка</th>
                                        <th className="px-4 py-3 text-right text-green-500">Нал</th>
                                        <th className="px-4 py-3 text-right text-blue-500">Kaspi</th>
                                        <th className="px-4 py-3 text-right text-foreground">Всего</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeCompanies.map(c => {
                                        const stats = totals.statsByCompany[c.id]
                                        const total = stats.cash + stats.kaspi
                                        return (
                                            <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="px-4 py-3 font-medium">{c.name}</td>
                                                <td className="px-4 py-3 text-right opacity-80">{formatKzt(stats.cash)}</td>
                                                <td className="px-4 py-3 text-right opacity-80">{formatKzt(stats.kaspi)}</td>
                                                <td className="px-4 py-3 text-right font-bold">{formatKzt(total)}</td>
                                            </tr>
                                        )
                                    })}
                                    <tr className="bg-yellow-500/5">
                                        <td className="px-4 py-3 font-medium text-yellow-500">F16 Extra</td>
                                        <td className="px-4 py-3 text-right text-muted-foreground text-xs" colSpan={2}>отдельный учет</td>
                                        <td className="px-4 py-3 text-right font-bold text-yellow-500">{formatKzt(totals.extraTotal)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {/* ГРАФИК: КУДА УШЛИ ДЕНЬГИ */}
                    <Card className="lg:col-span-1 p-6 border-border bg-card neon-glow">
                         <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                             <PieChart className="w-4 h-4 text-red-400"/> Куда ушли деньги?
                        </h3>
                        {totals.expenseCategories.length === 0 ? (
                            <div className="h-64 flex items-center justify-center text-muted-foreground text-xs">Нет расходов</div>
                        ) : (
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={totals.expenseCategories} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                        <XAxis type="number" hide />
                                        <YAxis type="category" dataKey="name" width={80} tick={{fill: '#888', fontSize: 10}} />
                                        <Tooltip 
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                                            formatter={(val: number) => [formatKzt(val), 'Сумма']}
                                        />
                                        <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20}>
                                            {totals.expenseCategories.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : '#ef444480'} />
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