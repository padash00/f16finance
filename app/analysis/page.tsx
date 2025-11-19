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
  Search,
  History
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
    dayName: string;
    type?: 'fact' | 'forecast';
}

type Anomaly = {
    date: string;
    type: 'income_high' | 'income_low' | 'expense_high';
    amount: number;
    avgForDay: number; 
}

const formatMoney = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const formatDateRu = (dateStr: string) => new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

const getLocalTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Функция для генерации всех дат в диапазоне
const generateDateRange = (startDate: Date, daysCount: number) => {
    const dates = [];
    for (let i = 0; i < daysCount; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

export default function AIAnalysisPage() {
  const [history, setHistory] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  // 1. ЗАГРУЗКА ДАННЫХ
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      
      // 🎯 ЖЕСТКОЕ НАЧАЛО: 1 Ноября 2025
      const startDate = new Date('2025-11-01');
      const today = new Date();
      
      // Считаем сколько дней прошло с 1 ноября до сегодня
      const diffTime = Math.abs(today.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
      
      const fromDateStr = startDate.toISOString().slice(0, 10);
      const allDates = generateDateRange(startDate, diffDays); 

      const [incRes, expRes] = await Promise.all([
        supabase.from('incomes').select('date, cash_amount, kaspi_amount, card_amount').gte('date', fromDateStr).order('date'),
        supabase.from('expenses').select('date, cash_amount, kaspi_amount').gte('date', fromDateStr).order('date')
      ])

      const dbMap = new Map<string, { income: number, expense: number }>();

      incRes.data?.forEach((r: any) => {
          const val = (r.cash_amount||0) + (r.kaspi_amount||0) + (r.card_amount||0);
          const cur = dbMap.get(r.date) || { income: 0, expense: 0 };
          cur.income += val;
          dbMap.set(r.date, cur);
      });

      expRes.data?.forEach((r: any) => {
          const val = (r.cash_amount||0) + (r.kaspi_amount||0);
          const cur = dbMap.get(r.date) || { income: 0, expense: 0 };
          cur.expense += val;
          dbMap.set(r.date, cur);
      });

      const fullHistory: DataPoint[] = allDates.map(date => {
          const data = dbMap.get(date) || { income: 0, expense: 0 };
          const dObj = new Date(date);
          const dayOfWeek = dObj.getDay();
          return {
              date,
              income: data.income,
              expense: data.expense,
              dayOfWeek,
              dayName: dayNames[dayOfWeek]
          };
      });

      setHistory(fullHistory);
      setLoading(false);
    }
    loadData();
  }, [])

  // 🧠 ПРОДВИНУТЫЙ AI АНАЛИЗ
  const analysis = useMemo(() => {
     if (history.length < 1) return null;
     
     const todayStr = getLocalTodayStr();
     const past = history.filter(d => d.date < todayStr);
     
     const dataToAnalyze = past.length > 0 ? past : history;
     const weeks = Math.max(1, Math.floor(dataToAnalyze.length / 7));
     
     const dayStats = Array(7).fill(null).map(() => ({income: [] as number[], expense: [] as number[]}));
     
     dataToAnalyze.forEach(d => {
        dayStats[d.dayOfWeek].income.push(d.income);
        dayStats[d.dayOfWeek].expense.push(d.expense);
     });

     const median = (arr: number[]) => {
         if (arr.length === 0) return 0;
         const sorted = [...arr].sort((a,b) => a - b);
         const mid = Math.floor(sorted.length / 2);
         return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
     };
     
     const mad = (arr: number[], med: number) => {
         if (arr.length === 0) return 0;
         return arr.reduce((s, v) => s + Math.abs(v - med), 0) / arr.length;
     };

     // 1. Типичный день
     const dayAverages = dayStats.map((d) => {
        const inc = d.income;
        const exp = d.expense;
        const medInc = median(inc);
        const medExp = median(exp);
        const madInc = mad(inc, medInc); 
        
        return {
          income: medInc,
          expense: medExp,
          sigma: madInc * 1.4826, 
          count: inc.length,
          isEstimated: inc.length < 2
        };
     });

     // 2. Тренд (последние 30 дней)
     const activeDays = dataToAnalyze.filter(d => d.income > 0);
     const recent = activeDays.slice(-30); 
     const x = recent.map((_, i) => i);
     const y = recent.map(d => d.income);
     const n = x.length;
     
     let slope = 0;
     let intercept = 0;

     if (n > 1) {
        const sx = x.reduce((a,b) => a+b, 0);
        const sy = y.reduce((a,b) => a+b, 0);
        const sxy = x.reduce((s,v,i) => s + v * y[i], 0);
        const sxx = x.reduce((s,v) => s + v*v, 0);
        slope = (n*sxy - sx*sy)/(n*sxx - sx*sx);
        intercept = (sy - slope*sx)/n;
     }

     // 3. Прогноз
     const forecast: DataPoint[] = [];
     let totalInc = 0, totalExp = 0;
     const lastDate = new Date(history[history.length-1].date);

     for (let i = 1; i <= 30; i++) {
        const date = new Date(lastDate);
        date.setDate(lastDate.getDate() + i);
        const dow = date.getDay();
        
        const baseValue = dayAverages[dow].income;
        const trendEffect = slope * i; 
        const predictedIncome = Math.max(0, baseValue + trendEffect); 
        const predictedExpense = dayAverages[dow].expense; 

        forecast.push({
          date: date.toISOString().slice(0,10),
          income: predictedIncome,
          expense: predictedExpense,
          dayOfWeek: dow,
          dayName: dayNames[dow],
          type: 'forecast'
        });
        
        totalInc += predictedIncome;
        totalExp += predictedExpense;
     }

     // 4. Аномалии
     const anomalies: Anomaly[] = dataToAnalyze.filter(d => {
        const avg = dayAverages[d.dayOfWeek];
        if (!avg || avg.income === 0) return false;
        
        const zIncome = avg.sigma > 0 ? Math.abs(d.income - avg.income) / avg.sigma : 0;
        const isHighExpense = d.expense > avg.expense * 3 && d.expense > 10000;
        
        if (zIncome > 3 || isHighExpense) return true;
        return false;
     }).map(d => {
        const avg = dayAverages[d.dayOfWeek];
        let type: Anomaly['type'] = 'income_low';
        if (d.expense > avg.expense * 3 && d.expense > 10000) type = 'expense_high';
        else if (d.income > avg.income) type = 'income_high';
        
        return {
            date: d.date,
            type,
            amount: type === 'expense_high' ? d.expense : d.income,
            avgForDay: type === 'expense_high' ? avg.expense : avg.income
        }
     }).reverse().slice(0,5);

     const confidence = Math.min(100, Math.round((weeks / 4) * 100));
     
     const dataRangeStart = history[0].date;
     const dataRangeEnd = history[history.length - 1].date;
     const lastFactDate = history[history.length - 1].date;

     // ГРАФИК: Теперь берем ВСЮ историю (с 1 ноября), а не slice(-45)
     const chartData = [...history.map(d => ({ ...d, type: 'fact' } as DataPoint)), ...forecast];

     return {
         dayAverages, 
         forecastData: forecast, 
         chartData, 
         totalForecastIncome: totalInc,
         totalForecastProfit: totalInc - totalExp,
         anomalies,
         confidenceScore: confidence,
         totalDataPoints: dataToAnalyze.length,
         dataRangeStart,
         dataRangeEnd,
         lastFactDate,
         trend: slope 
     }
  }, [history])

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
            
            <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-500/20 rounded-full">
                        <BrainCircuit className="w-8 h-8 text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">AI Советник Pro</h1>
                        <p className="text-muted-foreground text-sm">Статистический анализ (с 1 ноября)</p>
                    </div>
                </div>
            </div>

            {loading && <div className="p-12 text-center text-muted-foreground animate-pulse">Считаем математическую модель...</div>}

            {!loading && analysis && (
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                    
                    <div className="xl:col-span-3 space-y-8">
                        
                        {/* 🔮 ГРАФИК ПРОГНОЗА */}
                        <Card className="p-6 border border-purple-500/20 bg-card relative overflow-hidden">
                            <div className="mb-6 relative z-10 flex flex-col sm:flex-row justify-between items-start gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                        <CalendarDays className="w-5 h-5 text-purple-400" />
                                        Прогноз на 30 дней
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Ожидаемая прибыль: <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span>
                                    </p>
                                    
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <div className="text-[11px] text-blue-300 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20 w-fit">
                                            <History className="w-3 h-3 inline mr-1" />
                                            Анализ с 01 ноя по {formatDateRu(analysis.dataRangeEnd)}
                                        </div>
                                        <div className={`text-[11px] px-2 py-1 rounded border w-fit ${analysis.trend > 0 ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                                            <TrendingUp className={`w-3 h-3 inline mr-1 ${analysis.trend < 0 ? 'rotate-180' : ''}`} />
                                            Тренд: {analysis.trend > 0 ? '+' : ''}{analysis.trend.toFixed(0)} ₸/день
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="text-right">
                                    <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Достоверность</span>
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
                                        <XAxis 
                                            dataKey="date" 
                                            stroke="#666" 
                                            fontSize={10} 
                                            tickFormatter={(val) => {
                                                const d = new Date(val);
                                                return `${dayNames[d.getDay()]} ${d.getDate()}`;
                                            }}
                                            interval="preserveStartEnd"
                                        />
                                        <YAxis stroke="#666" fontSize={10} tickFormatter={v => `${v/1000}k`} />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                                            formatter={(val: number, name: string, props: any) => [
                                                formatMoney(val), 
                                                props.payload.type === 'forecast' ? 'Прогноз (Медиана + Тренд)' : 'Факт'
                                            ]}
                                            labelFormatter={(label) => {
                                                const d = new Date(label);
                                                return formatDateRu(label) + ` (${dayNames[d.getDay()]})`;
                                            }}
                                        />
                                        <ReferenceLine x={analysis.lastFactDate} stroke="#666" strokeDasharray="3 3" label="СЕГОДНЯ" />
                                        
                                        <Area 
                                            type="monotone" 
                                            dataKey="income" 
                                            name="Доход"
                                            stroke="#8b5cf6" 
                                            strokeWidth={3} 
                                            fill="url(#forecastGradient)" 
                                        />
                                        <Line 
                                            type="monotone"
                                            dataKey="expense"
                                            name="Расход"
                                            stroke="#ef4444"
                                            strokeWidth={2}
                                            dot={false}
                                            strokeOpacity={0.5}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>

                        {/* 📊 ПРОФИЛЬ НЕДЕЛИ (С РАСХОДАМИ) */}
                        <Card className="p-6 border-border bg-card neon-glow">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-blue-400"/>
                                    Ваша типичная неделя (Медиана)
                                </h3>
                                <div className="flex gap-4 text-xs">
                                    <div className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full"></div> Доход</div>
                                    <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-full"></div> Расход</div>
                                </div>
                            </div>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysis.dayAverages.map((d, i) => ({ ...d, name: dayNames[i] }))}>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                        <XAxis dataKey="name" stroke="#666" fontSize={12} />
                                        <Tooltip 
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                                            formatter={(val: number, name: string) => [
                                                formatMoney(val), 
                                                name === 'income' ? 'Типичный Доход' : 'Типичный Расход'
                                            ]}
                                        />
                                        <Bar 
                                            dataKey="income" 
                                            fill="#3b82f6" 
                                            radius={[4, 4, 0, 0]} 
                                        />
                                        <Bar 
                                            dataKey="expense" 
                                            fill="#ef4444" 
                                            radius={[4, 4, 0, 0]} 
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    </div>

                    {/* ПРАВАЯ КОЛОНКА */}
                    <div className="xl:col-span-1 space-y-6">
                        <Card className="p-5 border border-blue-500/20 bg-blue-900/5">
                            <h3 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2">
                                <HelpCircle className="w-4 h-4" />
                                Новый алгоритм
                            </h3>
                            <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                                <p><strong className="text-blue-200">1. Медиана:</strong> Мы отбрасываем случайные "взрывы" продаж и "пустые" дни, чтобы найти реальную норму.</p>
                                <p><strong className="text-blue-200">2. Тренд:</strong> Мы видим, что вы растете на {analysis.trend.toFixed(0)} ₸ в день, и учитываем это в будущем.</p>
                                <p><strong className="text-blue-200">3. Учет расходов:</strong> Теперь прогноз учитывает и регулярные траты.</p>
                            </div>
                        </Card>

                        <Card className="p-5 border border-border bg-card neon-glow">
                            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                <Search className="w-4 h-4 text-yellow-400"/>
                                Умный детектор (Z-Score)
                            </h3>
                            {analysis.anomalies.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-4">
                                    Выбросов не найдено (Нормальное отклонение).
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {analysis.anomalies.map((a, idx) => (
                                        <div key={idx} className="p-2 bg-white/5 rounded border border-white/5 text-xs">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-foreground">{formatDateRu(a.date)}</span>
                                                <span className={a.type === 'income_low' ? 'text-red-400' : a.type === 'expense_high' ? 'text-red-400' : 'text-green-400'}>
                                                    {a.type === 'income_low' ? '📉 Мало выручки' : a.type === 'expense_high' ? '⚠️ Много расхода' : '🚀 Рекорд выручки'}
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
                    </div>
                </div>
            )}
            
            {!loading && !analysis && (
                <div className="text-center py-20 text-muted-foreground">
                    <Info className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Недостаточно данных. Внесите хотя бы одну операцию.</p>
                </div>
            )}

        </div>
      </main>
    </div>
  )
}
