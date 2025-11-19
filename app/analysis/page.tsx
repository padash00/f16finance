'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import { 
  BrainCircuit, 
  TrendingUp, 
  CalendarDays, 
  AlertTriangle, 
  Target, 
  Sparkles,
  Info
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Bar
} from 'recharts'

// --- ТИПЫ ---
type DataPoint = { 
    date: string; 
    income: number; 
    expense: number;
    dayOfWeek: number; // 0 = Вс, 1 = Пн ...
}

type Anomaly = {
    date: string;
    type: 'income_high' | 'income_low' | 'expense_high';
    amount: number;
    avgForDay: number; // Среднее для этого дня недели
}

// Хелпер: форматирование денег
const formatMoney = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export default function AIAnalysisPage() {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  // 1. ЗАГРУЗКА ДАННЫХ (Берем историю за 90 дней для обучения)
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      const d = new Date()
      d.setDate(d.getDate() - 90)
      const fromDate = d.toISOString().slice(0, 10)

      const [incRes, expRes] = await Promise.all([
        supabase.from('incomes').select('date, cash_amount, kaspi_amount, card_amount').gte('date', fromDate).order('date'),
        supabase.from('expenses').select('date, cash_amount, kaspi_amount').gte('date', fromDate).order('date')
      ])

      // Агрегация по дням
      const map = new Map<string, DataPoint>()
      
      incRes.data?.forEach((r: any) => {
          const val = (r.cash_amount||0) + (r.kaspi_amount||0) + (r.card_amount||0)
          const cur = map.get(r.date) || { date: r.date, income: 0, expense: 0, dayOfWeek: new Date(r.date).getDay() }
          cur.income += val
          map.set(r.date, cur)
      })
      
      expRes.data?.forEach((r: any) => {
          const val = (r.cash_amount||0) + (r.kaspi_amount||0)
          const cur = map.get(r.date) || { date: r.date, income: 0, expense: 0, dayOfWeek: new Date(r.date).getDay() }
          cur.expense += val
          map.set(r.date, cur)
      })

      // Заполняем пробелы (дни без продаж должны быть нулями, а не пропусками)
      // Для упрощения берем только те дни, где была активность, но в идеале нужно заполнить все даты диапазона.
      const chartData = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))

      setHistory(chartData)
      setLoading(false)
    }
    loadData()
  }, [])

  // 🧠 AI ЯДРО: СЕЗОННЫЙ ПРОГНОЗ
  const analysis = useMemo(() => {
     if (history.length < 7) return null // Нужно хотя бы неделю данных

     // 1. ОБУЧЕНИЕ: Считаем среднее для каждого дня недели (Пн, Вт...)
     const dayStats = Array(7).fill(0).map(() => ({ totalIncome: 0, totalExpense: 0, count: 0 }))
     
     history.forEach(d => {
         const day = d.dayOfWeek
         dayStats[day].totalIncome += d.income
         dayStats[day].totalExpense += d.expense
         dayStats[day].count += 1
     })

     const dayAverages = dayStats.map(d => ({
         income: d.count > 0 ? d.totalIncome / d.count : 0,
         expense: d.count > 0 ? d.totalExpense / d.count : 0
     }))

     // 2. ПРОГНОЗ: Генерируем будущее на 30 дней вперед
     const forecastData = []
     let totalForecastIncome = 0
     let totalForecastExpense = 0
     
     const lastDateStr = history[history.length - 1].date
     const lastDate = new Date(lastDateStr)

     for(let i = 1; i <= 30; i++) {
         const nextDate = new Date(lastDate)
         nextDate.setDate(lastDate.getDate() + i)
         const dayOfWeek = nextDate.getDay()
         
         // Берем среднее для этого дня недели
         const predictedIncome = dayAverages[dayOfWeek].income
         const predictedExpense = dayAverages[dayOfWeek].expense

         forecastData.push({
             date: nextDate.toISOString().slice(0, 10),
             income: predictedIncome,
             expense: predictedExpense,
             dayName: dayNames[dayOfWeek],
             type: 'forecast'
         })

         totalForecastIncome += predictedIncome
         totalForecastExpense += predictedExpense
     }

     // 3. ПОИСК АНОМАЛИЙ (В прошлом)
     const anomalies: Anomaly[] = []
     history.slice(-30).forEach(d => {
         const avg = dayAverages[d.dayOfWeek]
         // Если доход на 50% ниже обычного для этого дня недели
         if (d.income < avg.income * 0.5 && avg.income > 5000) {
             anomalies.push({ date: d.date, type: 'income_low', amount: d.income, avgForDay: avg.income })
         }
         // Если расход в 3 раза выше обычного
         if (d.expense > avg.expense * 3 && d.expense > 10000) {
             anomalies.push({ date: d.date, type: 'expense_high', amount: d.expense, avgForDay: avg.expense })
         }
     })

     // Склеиваем историю (последние 14 дней) и прогноз для графика
     const chartData = [
         ...history.slice(-14).map(d => ({ ...d, dayName: dayNames[d.dayOfWeek], type: 'fact' })),
         ...forecastData
     ]

     return {
         dayAverages,
         forecastData,
         chartData,
         totalForecastIncome,
         totalForecastProfit: totalForecastIncome - totalForecastExpense,
         anomalies: anomalies.reverse().slice(0, 5) // Последние 5 аномалий
     }
  }, [history])

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
            
            {/* Заголовок */}
            <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-500/20 rounded-full">
                        <BrainCircuit className="w-8 h-8 text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">AI Аналитика</h1>
                        <p className="text-muted-foreground text-sm">Прогноз на основе дней недели (Сезонность)</p>
                    </div>
                </div>
                {analysis && (
                    <div className="bg-card border border-border px-4 py-2 rounded-xl flex items-center gap-4">
                         <div className="text-right">
                             <p className="text-[10px] text-muted-foreground uppercase font-bold">Прогноз прибыли (30 дн)</p>
                             <p className="text-xl font-bold text-green-400">{formatMoney(analysis.totalForecastProfit)}</p>
                         </div>
                         <Target className="w-8 h-8 text-purple-500/50" />
                    </div>
                )}
            </div>

            {loading && <div className="p-12 text-center text-muted-foreground animate-pulse">ИИ изучает ваши данные...</div>}

            {!loading && analysis && (
                <div className="space-y-8">
                    
                    {/* 🔮 ГРАФИК: ФАКТ + ПРОГНОЗ */}
                    <Card className="p-6 border border-purple-500/20 bg-card relative overflow-hidden">
                        <div className="mb-6">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <CalendarDays className="w-5 h-5 text-purple-400" />
                                Модель будущего месяца
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Алгоритм учитывает, что в выходные выручка обычно отличается от будней.
                            </p>
                        </div>

                        <div className="h-80 w-full relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={analysis.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                    <XAxis 
                                        dataKey="dayName" 
                                        stroke="#666" 
                                        fontSize={10} 
                                        interval={0} // Показать все дни
                                    />
                                    <YAxis stroke="#666" fontSize={10} tickFormatter={v => `${v/1000}k`} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                                        cursor={{ fill: 'white', opacity: 0.05 }}
                                        formatter={(val: number, name: string, props: any) => [
                                            formatMoney(val), 
                                            props.payload.type === 'forecast' ? 'Прогноз 🔮' : 'Факт ✅'
                                        ]}
                                        labelFormatter={(label, payload) => {
                                            if (payload && payload.length > 0) {
                                                return `${payload[0].payload.date} (${label})`
                                            }
                                            return label
                                        }}
                                    />
                                    
                                    {/* Разделитель Факта и Прогноза */}
                                    <ReferenceLine x={history[history.length - 1].date} stroke="#666" strokeDasharray="3 3" />

                                    <Area 
                                        type="monotone" 
                                        dataKey="income" 
                                        name="Доход"
                                        stroke="#8b5cf6" 
                                        strokeWidth={3}
                                        fill="url(#forecastGradient)"
                                    />
                                    {/* <Bar dataKey="expense" name="Расход" fill="#ef4444" opacity={0.3} barSize={10} /> */}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Легенда */}
                        <div className="flex justify-center gap-6 mt-4 text-xs">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                                <span className="text-muted-foreground">Линия дохода (Факт → Прогноз)</span>
                            </div>
                        </div>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        
                        {/* 📊 СРЕДНИЕ ПО ДНЯМ (Профиль недели) */}
                        <Card className="p-6 border-border bg-card neon-glow">
                            <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-blue-400"/>
                                Профиль вашей недели
                            </h3>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysis.dayAverages.map((d, i) => ({ ...d, name: dayNames[i] }))}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                        <XAxis dataKey="name" stroke="#666" fontSize={12} />
                                        <Tooltip 
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                                            formatter={(val: number) => [formatMoney(val), 'Средний доход']}
                                        />
                                        <Bar dataKey="income" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-2">
                                ИИ использует эти данные, чтобы предсказывать выручку на конкретный день.
                            </p>
                        </Card>

                        {/* ⚠️ ДЕТЕКТОР АНОМАЛИЙ */}
                        <Card className="p-6 border-border bg-card neon-glow">
                            <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-yellow-400"/>
                                Найденные аномалии (Последние 30 дней)
                            </h3>
                            
                            {analysis.anomalies.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
                                    <Sparkles className="w-8 h-8 text-green-500/50 mb-2" />
                                    <p className="text-sm">Аномалий не обнаружено.</p>
                                    <p className="text-xs opacity-50">Бизнес работает стабильно.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {analysis.anomalies.map((a, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-full ${a.type === 'income_low' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                    {a.type === 'income_low' ? <TrendingUp className="w-4 h-4 rotate-180" /> : <AlertTriangle className="w-4 h-4" />}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">
                                                        {new Date(a.date).toLocaleDateString('ru-RU')} ({dayNames[new Date(a.date).getDay()]})
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground">
                                                        {a.type === 'income_low' ? 'Просадка по выручке' : 'Аномально высокий расход'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-foreground">{formatMoney(a.amount)}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    Норма: ~{formatMoney(a.avgForDay)}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>

                </div>
            )}
            
            {!loading && !analysis && (
                <div className="text-center py-20 text-muted-foreground">
                    <Info className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Недостаточно данных для построения модели.</p>
                    <p className="text-sm mt-2">Продолжайте вести учет, и ИИ начнет давать советы через 7 дней.</p>
                </div>
            )}

        </div>
      </main>
    </div>
  )
}
