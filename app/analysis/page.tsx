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

// Получаем "сегодня" по местному времени
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
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 90); // 90 дней истории
      
      const fromDateStr = startDate.toISOString().slice(0, 10);
      const allDates = generateDateRange(startDate, 91); 

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

  // 🧠 ПРОДВИНУТЫЙ AI АНАЛИЗ (Медиана + Линейная регрессия + MAD)
  const analysis = useMemo(() => {
     if (history.length < 7) return null;
     
     const todayStr = getLocalTodayStr();
     // Берем только прошлое, игнорируем нули (дни простоя), чтобы не портить статистику
     const past = history.filter(d => d.date < todayStr && (d.income > 0 || d.expense > 0));
     
     if (past.length === 0) return null;

     const weeks = Math.floor(past.length / 7);
     const dayStats = Array(7).fill(null).map(() => ({income: [] as number[], expense: [] as number[]}));
     
     past.forEach(d => {
        dayStats[d.dayOfWeek].income.push(d.income);
        dayStats[d.dayOfWeek].expense.push(d.expense);
     });

     // --- СТАТИСТИЧЕСКИЕ ФУНКЦИИ ---
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

     // 1. Расчет "Типичного дня" (Медиана)
     const dayAverages = dayStats.map((d) => {
        const inc = d.income;
        const exp = d.expense;
        
        const medInc = median(inc);
        const medExp = median(exp);
        const madInc = mad(inc, medInc); // Отклонение
        
        return {
          income: medInc,
          expense: medExp,
          sigma: madInc * 1.4826, // Оценка стандартного отклонения через MAD
          count: inc.length
        };
     });

     // 2. Расчет Тренда (Линейная регрессия) за последние 30 активных дней
     const recent = past.slice(-30);
     const x = recent.map((_, i) => i);
     const y = recent.map(d => d.income);
     const n = x.length;
     
     const sx = x.reduce((a,b) => a+b, 0);
     const sy = y.reduce((a,b) => a+b, 0);
     const sxy = x.reduce((s,v,i) => s + v * y[i], 0);
     const sxx = x.reduce((s,v) => s + v*v, 0);
     
     // Наклон (рост в день) и пересечение
     const slope = n > 1 ? (n*sxy - sx*sy)/(n*sxx - sx*sx) : 0;
     const intercept = n > 0 ? (sy - slope*sx)/n : 0;

     // 3. Прогноз на 30 дней
     const forecast: DataPoint[] = [];
     let totalInc = 0, totalExp = 0;
     const lastDate = new Date(history[history.length-1].date);

     for (let i = 1; i <= 30; i++) {
        const date = new Date(lastDate);
        date.setDate(lastDate.getDate() + i);
        const dow = date.getDay();
        
        // Тренд: добавляем накопленный рост к базовой медиане дня недели
        const daysFromNow = past.length + i - 1;
        // Прогнозируемое значение по тренду (общее)
        const trendValue = intercept + slope * daysFromNow;
        // Базовое значение дня недели
        const baseValue = dayAverages[dow].income;
        
        // Комбинируем: (База + Тренд) / 2 или берем базу и добавляем дельту тренда. 
        // Для устойчивости возьмем медиану дня и добавим общий наклон (slope * i)
        // slope - это сколько тенге мы прибавляем в среднем каждый день
        
        const predictedIncome = Math.max(0, baseValue + (slope * i)); // Медиана + прирост за i дней
        const predictedExpense = dayAverages[dow].expense; // Расходы обычно менее подвержены тренду продаж

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

     // 4. Умные аномалии (Z-score по MAD)
     const anomalies: Anomaly[] = past.slice(-45).filter(d => {
        const avg = dayAverages[d.dayOfWeek];
        if (!avg || avg.count < 3 || avg.income === 0) return false;
        
        // Насколько сильно отклонились (в "сигмах")
        const z = avg.sigma > 0 ? Math.abs(d.income - avg.income) / avg.sigma : 0;
        return z > 3.0; // Сильное отклонение
     }).map(d => ({
        date: d.date,
        type: d.income < dayAverages[d.dayOfWeek].income ? 'income_low' : 'income_high',
        amount: d.income,
        avgForDay: dayAverages[d.dayOfWeek].income
     })).reverse().slice(0,5);

     const confidence = Math.min(100, Math.round((weeks / 4) * 100));
     
     const dataRangeStart = past.length > 0 ? past[0].date : '';
     const dataRangeEnd = past.length > 0 ? past[past.length - 1].date : '';
     const lastFactDate = history[history.length - 1].date;

     // ГРАФИК
     const chartData = [...history.slice(-45).map(d => ({ ...d, type: 'fact' } as DataPoint)), ...forecast];

     return {
         dayAverages, 
         forecastData: forecast, 
         chartData, 
         totalForecastIncome: totalInc,
         totalForecastProfit: totalInc - totalExp,
         anomalies,
         confidenceScore: confidence,
         totalDataPoints: past.length,
         dataRangeStart,
         dataRangeEnd,
         lastFactDate,
         trend: slope // Показываем скорость роста
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
                        <p className="text-muted-foreground text-sm">Статистический анализ (Медиана + Регрессия)</p>
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
                                        Прогноз на 30 дней (с учетом тренда)
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Ожидаемая прибыль: <span className="text-green-400 font-bold">{formatMoney(analysis.totalForecastProfit)}</span>
                                    </p>
                                    
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <div className="text-[11px] text-blue-300 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20 w-fit">
                                            <History className="w-3 h-3 inline mr-1" />
                                            База: {analysis.totalDataPoints} активных дней
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
                                        <Area type="monotone" dataKey="income" name="Доход" stroke="#8b5cf6" strokeWidth={3} fill="url(#forecastGradient)" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>

                        {/* 📊 ПРОФИЛЬ НЕДЕЛИ (Медианы) */}
                        <Card className="p-6 border-border bg-card neon-glow">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-blue-400"/>
                                    Ваша типичная неделя (Медиана)
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
                                            formatter={(val: number) => [formatMoney(val), 'Типичный доход']}
                                        />
                                        <Bar 
                                            dataKey="income" 
                                            fill="#3b82f6" 
                                            radius={[4, 4, 0, 0]} 
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-2">
                                Мы используем медиану вместо среднего, чтобы праздники и простои не искажали картину.
                            </p>
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
                                <p><strong className="text-blue-200">3. MAD:</strong> Умный поиск аномалий, устойчивый к ошибкам.</p>
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
                                                <span className={a.type === 'income_low' ? 'text-red-400' : 'text-yellow-400'}>
                                                    {a.type === 'income_low' ? '📉 Аномально мало' : '⚠️ Аномально много'}
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
                    <p>Недостаточно данных (нужно минимум 7 активных дней).</p>
                </div>
            )}

        </div>
      </main>
    </div>
  )
}
