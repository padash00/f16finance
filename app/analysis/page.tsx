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
  Info,
  BookOpen,
  HelpCircle,
  Search
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
  Bar,
  BarChart,    
  Legend
} from 'recharts'

// --- ТИПЫ ДАННЫХ ---
type DataPoint = { 
    date: string; 
    income: number; 
    expense: number;
    dayOfWeek: number; 
}

type Anomaly = {
    date: string;
    type: 'income_high' | 'income_low' | 'expense_high';
    amount: number;
    avgForDay: number; 
}

// Хелпер: форматирование денег
const formatMoney = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const fullDayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

export default function AIAnalysisPage() {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  // 1. ЗАГРУЗКА ДАННЫХ
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      const d = new Date()
      d.setDate(d.getDate() - 90) // Берем 90 дней
      const fromDate = d.toISOString().slice(0, 10)

      const [incRes, expRes] = await Promise.all([
        supabase.from('incomes').select('date, cash_amount, kaspi_amount, card_amount').gte('date', fromDate).order('date'),
        supabase.from('expenses').select('date, cash_amount, kaspi_amount').gte('date', fromDate).order('date')
      ])

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

      const chartData = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
      setHistory(chartData)
      setLoading(false)
    }
    loadData()
  }, [])

  // 🧠 AI ЯДРО
  const analysis = useMemo(() => {
     if (history.length < 3) return null // Снизим порог до 3 дней, чтобы график быстрее появлялся

     // 1. ОБУЧЕНИЕ (Сезонность по дням недели)
     const dayStats = Array(7).fill(0).map(() => ({ totalIncome: 0, totalExpense: 0, count: 0 }))
     let overallIncomeSum = 0;
     let overallExpenseSum = 0;
     let overallCount = 0;
     
     history.forEach(d => {
         const day = d.dayOfWeek
         dayStats[day].totalIncome += d.income
         dayStats[day].totalExpense += d.expense
         dayStats[day].count += 1

         overallIncomeSum += d.income;
         overallExpenseSum += d.expense;
         overallCount++;
     })

     // Считаем "Глобальное среднее" на случай, если данных за конкретный день нет
     const globalAvgIncome = overallCount > 0 ? overallIncomeSum / overallCount : 0;
     const globalAvgExpense = overallCount > 0 ? overallExpenseSum / overallCount : 0;

     const dayAverages = dayStats.map(d => ({
         // ⭐️ FIX: Если данных за этот день недели нет, берем глобальное среднее, а не 0
         income: d.count > 0 ? d.totalIncome / d.count : globalAvgIncome,
         expense: d.count > 0 ? d.totalExpense / d.count : globalAvgExpense,
         count: d.count,
         isEstimated: d.count === 0 // Флаг, что данные приблизительные
     }))

     // Оценка уверенности ИИ
     const totalDataPoints = history.length;
     // Если дней мало, уверенность низкая. 30 дней = 100% уверенности (для малого бизнеса)
     const confidenceScore = Math.min(100, Math.round((totalDataPoints / 30) * 100)); 

     // 2. ПРОГНОЗ
     const forecastData = []
     let totalForecastIncome = 0
     let totalForecastExpense = 0
     
     const lastDateStr = history[history.length - 1].date
     const lastDate = new Date(lastDateStr)

     for(let i = 1; i <= 30; i++) {
         const nextDate = new Date(lastDate)
         nextDate.setDate(lastDate.getDate() + i)
         const dayOfWeek = nextDate.getDay()
         
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

     // 3. ПОИСК АНОМАЛИЙ
     const anomalies: Anomaly[] = []
     history.slice(-30).forEach(d => {
         const avg = dayAverages[d.dayOfWeek]
         // Ищем аномалии только если данных достаточно и среднее не искусственное
         if (!avg.isEstimated) {
             if (d.income < avg.income * 0.5 && avg.income > 5000) {
                 anomalies.push({ date: d.date, type: 'income_low', amount: d.income, avgForDay: avg.income })
             }
             if (d.expense > avg.expense * 3 && d.expense > 10000) {
                 anomalies.push({ date: d.date, type: 'expense_high', amount: d.expense, avgForDay: avg.expense })
             }
         }
     })

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
         anomalies: anomalies.reverse().slice(0, 5),
         confidenceScore,
         totalDataPoints
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
                        <h1 className="text-3xl font-bold text-foreground">AI Советник</h1>
                        <p className="text-muted-foreground text-sm">Глубокая аналитика и объяснение прогнозов</p>
                    </div>
                </div>
            </div>

            {loading && <div className="p-12 text-center text-muted-foreground animate-pulse">Анализируем историю операций...</div>}

            {!loading && analysis && (
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                    
                    {/* ЛЕВАЯ КОЛОНКА (ОСНОВНАЯ) */}
                    <div className="xl:col-span-3 space-y-8">
                        
                        {/* 🔮 ГРАФИК ПРОГНОЗА */}
                        <Card className="p-6 border border-purple-500/20 bg-card relative overflow-hidden">
                            <div className="mb-6 relative z-10 flex justify-between items-start">
                                <div>
                                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                        <CalendarDays className="w-5 h-5 text-purple-400" />
                                        Прогноз на 30 дней
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        Ожидаемая прибыль: <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span>
                                    </p>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Уверенность ИИ</span>
                                    <div className="flex items-center gap-2 justify-end">
                                        <div className="h-2 w-20 bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-purple-500" style={{width: `${analysis.confidenceScore}%`}} />
                                        </div>
                                        <span className="text-xs font-bold text-purple-300">{analysis.confidenceScore}%</span>
                                    </div>
                                </div>
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
                                        <XAxis dataKey="dayName" stroke="#666" fontSize={10} interval={0} />
                                        <YAxis stroke="#666" fontSize={10} tickFormatter={v => `${v/1000}k`} />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                                            formatter={(val: number, name: string, props: any) => [
                                                formatMoney(val), 
                                                props.payload.type === 'forecast' ? 'Прогноз 🔮' : 'Факт ✅'
                                            ]}
                                        />
                                        <ReferenceLine x={history[history.length - 1].date} stroke="#666" strokeDasharray="3 3" label="СЕГОДНЯ" />
                                        <Area type="monotone" dataKey="income" name="Доход" stroke="#8b5cf6" strokeWidth={3} fill="url(#forecastGradient)" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>

                        {/* 📊 ПРОФИЛЬ НЕДЕЛИ */}
                        <Card className="p-6 border-border bg-card neon-glow">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-blue-400"/>
                                    Матрица вашей недели
                                </h3>
                            </div>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysis.dayAverages.map((d, i) => ({ ...d, name: dayNames[i] }))}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                        <XAxis dataKey="name" stroke="#666" fontSize={12} />
                                        <Tooltip 
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                                            formatter={(val: number) => [formatMoney(val), 'Среднее']}
                                        />
                                        <Bar 
                                            dataKey="income" 
                                            fill="#3b82f6" 
                                            radius={[4, 4, 0, 0]} 
                                            fillOpacity={(d:any) => d.isEstimated ? 0.3 : 1} // Бледный цвет, если данные примерные
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    </div>

                    {/* ПРАВАЯ КОЛОНКА (ОБУЧЕНИЕ И ИНФО) */}
                    <div className="xl:col-span-1 space-y-6">
                        
                        {/* КАРТОЧКА 1: КАК ЭТО РАБОТАЕТ */}
                        <Card className="p-5 border border-blue-500/20 bg-blue-900/5">
                            <h3 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2">
                                <HelpCircle className="w-4 h-4" />
                                Как работает этот алгоритм?
                            </h3>
                            <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                                <p>
                                    <strong className="text-blue-200">1. Сезонность:</strong> Мы не просто берем среднее. ИИ знает, что в пятницу выручка выше, чем в понедельник.
                                </p>
                                <p>
                                    <strong className="text-blue-200">2. Обучение:</strong> Алгоритм изучил <strong>{analysis.totalDataPoints} дней</strong> вашей истории, чтобы понять привычки клиентов.
                                </p>
                                <p>
                                    <strong className="text-blue-200">3. Экстраполяция:</strong> Прогноз строится путем наложения вашей "типичной недели" на календарь следующего месяца.
                                </p>
                            </div>
                        </Card>

                        {/* КАРТОЧКА 2: АНОМАЛИИ */}
                        <Card className="p-5 border border-border bg-card neon-glow">
                            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                <Search className="w-4 h-4 text-yellow-400"/>
                                Детектор Аномалий
                            </h3>
                            {analysis.anomalies.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-4">
                                    Отклонений не найдено. Бизнес работает как часы.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {analysis.anomalies.map((a, idx) => (
                                        <div key={idx} className="p-2 bg-white/5 rounded border border-white/5 text-xs">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-foreground">{new Date(a.date).toLocaleDateString('ru-RU')}</span>
                                                <span className={a.type === 'income_low' ? 'text-red-400' : 'text-yellow-400'}>
                                                    {a.type === 'income_low' ? '📉 Низкий доход' : '⚠️ Высокий расход'}
                                                </span>
                                            </div>
                                            <p className="text-muted-foreground">
                                                Было: <span className="text-foreground">{formatMoney(a.amount)}</span> (Норма: {formatMoney(a.avgForDay)})
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        {/* КАРТОЧКА 3: СЛОВАРЬ */}
                        <Card className="p-5 border border-border bg-card">
                            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                <BookOpen className="w-4 h-4 text-muted-foreground"/>
                                Словарь терминов
                            </h3>
                            <ul className="space-y-2 text-xs text-muted-foreground">
                                <li><span className="text-foreground font-semibold">Маржа:</span> Какой % от выручки вы реально кладете в карман после расходов.</li>
                                <li><span className="text-foreground font-semibold">ROI (Эффективность):</span> Сколько тенге дохода приносит каждый потраченный 1 тенге.</li>
                                <li><span className="text-foreground font-semibold">Run Rate:</span> Прогноз годовой выручки, если дела пойдут так же, как сейчас.</li>
                            </ul>
                        </Card>

                    </div>

                </div>
            )}
            
            {!loading && !analysis && (
                <div className="text-center py-20 text-muted-foreground">
                    <Info className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Недостаточно данных для анализа.</p>
                </div>
            )}

        </div>
      </main>
    </div>
  )
}
