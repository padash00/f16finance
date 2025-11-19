'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Filter, TrendingUp, TrendingDown, Percent, Calendar } from 'lucide-react'
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
  PieChart, // 👈 Добавлено
  Pie,      // 👈 Добавлено
  Cell      // 👈 Добавлено
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
type Aggregation = { income: number; expense: number; profit: number }

type FinancialTotals = {
  incomeCash: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  totalIncome: number
  totalExpense: number
  profit: number
}

// 🎯 НОВЫЙ ТИП для помесячных трендов
type MonthlyTrendData = {
    label: string; // YYYY-MM
    income: number;
    expense: number;
    profit: number;
    year: string;
};
// --------------------

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

const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
    const dFrom = new Date(dateFrom + 'T00:00:00');
    const dTo = new Date(dateTo + 'T00:00:00');
    
    const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    
    const prevTo = addDaysISO(dateFrom, -1);
    const prevFrom = addDaysISO(prevTo, -(durationDays - 1));
    
    return { prevFrom, prevTo, durationDays };
};

const getPercentageChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+100%' : '—';
    if (current === 0) return '-100%';
    const change = ((current - previous) / previous) * 100;
    return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
};

const getWeekKey = (isoDate: string) => {
  const d = new Date(isoDate + 'T00:00:00')
  const year = d.getFullYear()
  const oneJan = new Date(year, 0, 1)
  const dayOfYear =
    Math.floor((d.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000)) + 1
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

// ⚠️ Начало компонента
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
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('day')

  // ... (useEffect loadAll без изменений) ...
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
          .select(
            'id, date, company_id, shift, zone, cash_amount, kaspi_amount, card_amount'
          ),
        supabase
          .from('expenses')
          .select('id, date, company_id, category, cash_amount, kaspi_amount'),
        supabase.from('companies').select('id, name, code').order('name'),
      ])

      if (incomeErr || expenseErr || compErr) {
        console.error('Error loading reports data:', {
          incomeErr,
          expenseErr,
          compErr,
        })
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
  // ------------------------------------

  const companyName = (id: string) =>
    companies.find((c) => c.id === id)?.name ?? '—'

  const companyCodeById = (id: string | null | undefined) => {
    if (!id) return null
    const c = companies.find((x) => x.id === id)
    return (c?.code || '').toLowerCase()
  }

  // 🚀 ОДИН ПРОХОД: Фильтрация и детальная агрегация для ТЕКУЩЕГО и ПРЕДЫДУЩЕГО периода
  const processedData = useMemo(() => {
    
    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo);

    const financialTotals: FinancialTotals = {
      incomeCash: 0, incomeNonCash: 0, expenseCash: 0, expenseKaspi: 0, profit: 0, 
      totalIncome: 0, totalExpense: 0,
    }
    const financialTotalsPrev: FinancialTotals = {
      incomeCash: 0, incomeNonCash: 0, expenseCash: 0, expenseKaspi: 0, profit: 0,
      totalIncome: 0, totalExpense: 0,
    }
    
    const expenseByCategoryMap = new Map<string, number>()
    // 👇 НОВОЕ: Карта доходов по зонам
    const incomeByZoneMap = new Map<string, number>()
    
    const totalsByCompanyMap = new Map<string, Aggregation>()
    const chartDataMap = new Map<string, Aggregation>()
    const shiftAgg: { day: number, night: number } = { day: 0, night: 0 }

    const getKey = (iso: string) => {
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
        if (date >= dateFrom && date <= dateTo) return 'current';
        if (date >= prevFrom && date <= prevTo) return 'previous';
        return null;
    }

    // --- ОБРАБОТКА ДОХОДОВ ---
    for (const r of incomes) {
        const range = getRange(r.date);
        if (!range) continue;
        
        let filterPass = true;
        if (companyFilter !== 'all') {
            if (r.company_id !== companyFilter) filterPass = false;
        } else {
            const code = companyCodeById(r.company_id);
            if (code === 'extra') filterPass = false; 
        }
        if (!filterPass) continue;

        const cash = Number(r.cash_amount || 0);
        const nonCash = Number(r.kaspi_amount || 0) + Number(r.card_amount || 0);
        const total = cash + nonCash;
        if (total <= 0) continue;

        const target = range === 'current' ? financialTotals : financialTotalsPrev;
        target.incomeCash += cash;
        target.incomeNonCash += nonCash;
        target.totalIncome += total;

        if (range === 'current') {
            if (r.shift === 'day') shiftAgg.day += total;
            if (r.shift === 'night') shiftAgg.night += total;

            const companyTotals = totalsByCompanyMap.get(r.company_id);
            if (companyTotals) companyTotals.income += total; 
            
            const { key } = getKey(r.date);
            const chartBucket = chartDataMap.get(key) || { income: 0, expense: 0, profit: 0, label: key };
            chartBucket.income += total;
            chartDataMap.set(key, chartBucket);

            // 👇 ЛОГИКА ЗОН
            const zoneRaw = r.zone || 'pc';
            let displayZone = zoneRaw;
            
            // Красивые названия
            if (zoneRaw === 'ramen') displayZone = 'Кухня/Бар';
            else if (zoneRaw === 'ps5') displayZone = 'PlayStation 5';
            else if (zoneRaw === 'vr') displayZone = 'VR Zone';
            else if (zoneRaw === 'pc') displayZone = 'Общий зал (PC)';
            else if (zoneRaw === 'vip') displayZone = 'VIP Комната';
            
            const curZoneTotal = incomeByZoneMap.get(displayZone) || 0;
            incomeByZoneMap.set(displayZone, curZoneTotal + total);
        }
    }

    // --- ОБРАБОТКА РАСХОДОВ ---
    for (const r of expenses) {
        const range = getRange(r.date);
        if (!range) continue;

        let filterPass = true;
        if (companyFilter !== 'all') {
            if (r.company_id !== companyFilter) filterPass = false;
        } else {
            const code = companyCodeById(r.company_id);
            if (code === 'extra') filterPass = false; 
        }
        if (!filterPass) continue;

        const cash = Number(r.cash_amount || 0);
        const kaspi = Number(r.kaspi_amount || 0);
        const total = cash + kaspi;
        if (total <= 0) continue;

        const target = range === 'current' ? financialTotals : financialTotalsPrev;
        target.expenseCash += cash;
        target.expenseKaspi += kaspi;
        target.totalExpense += total;

        if (range === 'current') {
            const currentCategoryTotal = expenseByCategoryMap.get(r.category || 'Без категории') || 0;
            expenseByCategoryMap.set(r.category || 'Без категории', currentCategoryTotal + total);
            
            const companyTotals = totalsByCompanyMap.get(r.company_id);
            if (companyTotals) companyTotals.expense += total;
            
            const { key } = getKey(r.date);
            const chartBucket = chartDataMap.get(key) || { income: 0, expense: 0, profit: 0, label: key };
            chartBucket.expense += total;
            chartDataMap.set(key, chartBucket);
        }
    }

    // Финальные расчеты прибыли
    financialTotals.profit = financialTotals.totalIncome - financialTotals.totalExpense;
    financialTotalsPrev.profit = financialTotalsPrev.totalIncome - financialTotalsPrev.totalExpense;
    
    // Обновляем прибыль по компаниям и графику
    for (const [id, agg] of totalsByCompanyMap.entries()) {
        agg.profit = agg.income - agg.expense
        totalsByCompanyMap.set(id, agg);
    }
    for (const [key, agg] of chartDataMap.entries()) {
        agg.profit = agg.income - agg.expense
        chartDataMap.set(key, agg);
    }

    return {
      financialTotals, 
      financialTotalsPrev, 
      expenseByCategoryMap, 
      incomeByZoneMap, // 👈 Возвращаем карту зон
      totalsByCompanyMap, 
      chartDataMap, 
      shiftAgg,
    }
  }, [incomes, expenses, dateFrom, dateTo, companyFilter, companies, groupMode])

  // 🎯 НОВЫЙ useMemo: Агрегация по месяцам за весь период
  const monthlyTrends = useMemo(() => {
    const monthlyMap = new Map<string, MonthlyTrendData>();
    
    const getMonthBucket = (isoDate: string) => {
        const key = isoDate.slice(0, 7); // YYYY-MM
        if (!monthlyMap.has(key)) {
            monthlyMap.set(key, { label: key, income: 0, expense: 0, profit: 0, year: isoDate.slice(0, 4) });
        }
        return monthlyMap.get(key)!;
    };

    // 1. Process Income
    for (const r of incomes) {
        // Здесь не применяем фильтры по компании/дате, так как нужна вся история
        const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0);
        if (total <= 0) continue;
        const bucket = getMonthBucket(r.date);
        bucket.income += total;
    }

    // 2. Process Expense
    for (const r of expenses) {
        // Здесь не применяем фильтры по компании/дате
        const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0);
        if (total <= 0) continue;
        const bucket = getMonthBucket(r.date);
        bucket.expense += total;
    }

    // 3. Calculate Profit and structure output
    const result = Array.from(monthlyMap.values()).map(data => {
        data.profit = data.income - data.expense;
        return data;
    });

    // Сортировка по дате (ГГГГ-ММ) для корректного отображения на графике
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [incomes, expenses]);

  // 💡 ВТОРОЙ ЭТАП: Форматирование агрегированных данных (быстрый)
  const totals = useMemo(() => processedData.financialTotals, [processedData])
  const totalsPrev = useMemo(() => processedData.financialTotalsPrev, [processedData])

  const totalsByCompany = useMemo(() => {
    return Array.from(processedData.totalsByCompanyMap.entries())
      .map(([companyId, v]) => ({
        companyId,
        name: companyName(companyId),
        income: v.income,
        expense: v.expense,
        profit: v.profit,
      }))
      .filter(row => row.income > 0 || row.expense > 0)
  }, [processedData, companyName])

  const chartData = useMemo(() => {
    return Array.from(processedData.chartDataMap.values())
      .map(v => ({...v, label: (v as any).label || ''})) 
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [processedData])

  const shiftData = useMemo(() => {
    const res: { shift: 'Day' | 'Night', income: number }[] = []
    if (processedData.shiftAgg.day > 0) res.push({ shift: 'Day', income: processedData.shiftAgg.day })
    if (processedData.shiftAgg.night > 0) res.push({ shift: 'Night', income: processedData.shiftAgg.night })
    return res
  }, [processedData])

  const expenseByCategoryData = useMemo(() => {
    return Array.from(processedData.expenseByCategoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount) 
      .slice(0, 10)
  }, [processedData])

  // 👇 Подготовка данных для Pie Chart (Зоны)
  const incomeByZoneData = useMemo(() => {
    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];
    return Array.from(processedData.incomeByZoneMap.entries())
      .map(([name, value], index) => ({ 
          name, 
          value, 
          fill: COLORS[index % COLORS.length] 
      }))
      .sort((a, b) => b.value - a.value);
  }, [processedData])
  
  // -------------------------------------------------------------
  
  const formatMoney = (v: number) =>
    v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

  const quickRange = (type: 'today' | 'week' | 'month') => {
    const today = todayISO()
    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    } else {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    }
  }

  const resetFilters = () => {
    quickRange('week')
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
    labelStyle: {
      color: '#ffffff',
      fontWeight: 600,
    },
    itemStyle: {
      color: '#ffffff',
    },
  } as const

  // Вспомогательный компонент для карточки динамики
  const TrendCard = ({ title, current, previous, Icon, unit = '₸', isExpense = false }: { title: string, current: number, previous: number, Icon: React.ElementType, unit?: string, isExpense?: boolean }) => {
    const change = getPercentageChange(current, previous);
    const positiveTrend = isExpense ? current <= previous : current >= previous;
    const trendClass = change === '—' ? 'text-muted-foreground' : (positiveTrend ? 'text-green-400' : 'text-red-400');
    const TrendIcon = change === '—' ? Icon : (positiveTrend ? TrendingUp : TrendingDown);

    const formatValue = (value: number) => 
        value.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ' + unit;

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
            {change !== '—' ? `(${unit === '%' ? previous.toFixed(1) + unit : formatValue(previous)} в пред. период)` : ''}
          </span>
        </div>
      </Card>
    );
  };

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
                <h3 className="text-sm font-semibold text-foreground">
                  Фильтры
                </h3>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => quickRange('today')}>Сегодня</Button>
                <Button size="sm" variant="outline" onClick={() => quickRange('week')}>Неделя</Button>
                <Button size="sm" variant="outline" onClick={() => quickRange('month')}>30 дней</Button>
                <Button size="sm" variant="outline" onClick={resetFilters}>Сбросить</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Дата от</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Дата до</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Компания</label>
                <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground">
                  <option value="all">Все компании</option>
                  {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-2">Группировка</label>
                <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground">
                  <option value="day">По дням</option>
                  <option value="week">По неделям</option>
                  <option value="month">По месяцам</option>
                  <option value="year">По годам</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Итоги - РАЗБИВКА ФИНАНСОВ */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Доход (Нал)</p>
              <p className="text-xl font-bold text-green-400">
                {formatMoney(totals.incomeCash)} ₸
              </p>
            </Card>
            <Card className="p-3 border-border bg-card neon-glow">
              <p className="text-[10px] text-muted-foreground mb-1">Доход (Kaspi/Card)</p>
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

          {/* 🚀 БЛОК: ИНТЕЛЛЕКТУАЛЬНЫЙ АНАЛИЗ (Сравнение периодов) */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent"/>
                Интеллектуальный анализ (Сравнение с пред. периодом)
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
                    title="Рентабельность (Прибыль/Доход)" 
                    current={totals.totalIncome > 0 ? (totals.profit / totals.totalIncome) * 100 : 0} 
                    previous={totalsPrev.totalIncome > 0 ? (totalsPrev.profit / totalsPrev.totalIncome) * 100 : 0} 
                    Icon={Percent}
                    unit="%"
                />
            </div>
          </Card>
          {/* КОНЕЦ БЛОКА СРАВНЕНИЯ ПЕРИОДОВ */}
          
          {/* 📊 НОВЫЙ БЛОК: ЕЖЕМЕСЯЧНАЯ ДИНАМИКА */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-yellow-400"/>
                Ежемесячная динамика (Общий анализ за весь период)
            </h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка данных...</p>
            ) : monthlyTrends.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет данных для анализа.
              </p>
            ) : (
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrends}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                    <XAxis dataKey="label" stroke="#ccc" />
                    <YAxis stroke="#ccc" />
                    <Tooltip
                      {...tooltipStyles}
                      formatter={(value: any, name: any) => [
                        `${Number(value).toLocaleString('ru-RU')} ₸`,
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ color: '#fff' }} />
                    <Bar
                      dataKey="income"
                      name="Доход"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                      opacity={0.8}
                    />
                    <Bar
                      dataKey="expense"
                      name="Расход"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                      opacity={0.8}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      name="Прибыль"
                      stroke="#eab308"
                      strokeWidth={2}
                      dot={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          {/* КОНЕЦ БЛОКА ЕЖЕМЕСЯЧНОЙ ДИНАМИКИ */}


          {error && (
            <Card className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {error}
            </Card>
          )}

          {/* График по времени */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Доход / Расход / Прибыль по времени
            </h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка данных...</p>
            ) : chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет данных за выбранный период
              </p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555"/>
                    <XAxis dataKey="label" stroke="#ccc" />
                    <YAxis stroke="#ccc" />
                    <Tooltip {...tooltipStyles} formatter={(value: any, name: any) => [`${Number(value).toLocaleString('ru-RU')} ₸`, name]}/>
                    <Legend wrapperStyle={{ color: '#fff' }} />
                    <Line dataKey="income" name="Доход" stroke="#22c55e" strokeWidth={3} dot={{ r: 4, fill: '#22c55e', strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }}/>
                    <Line dataKey="expense" name="Расход" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: '#ef4444', strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }}/>
                    <Line dataKey="profit" name="Прибыль" stroke="#eab308" strokeWidth={3} dot={{ r: 4, fill: '#eab308', strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Таблица по периодам */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Таблица по периодам ({groupLabelMap[groupMode]})
            </h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка данных...</p>
            ) : chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных за выбранный период</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground">Период</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Доход</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Расход</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Прибыль</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row, idx) => (
                      <tr key={row.label} className={`border-b border-border/40 ${idx % 2 === 0 ? 'bg-background/40' : 'bg-card/40'}`}>
                        <td className="px-4 py-2">{row.label}</td>
                        <td className="px-4 py-2 text-right">{formatMoney(row.income)}</td>
                        <td className="px-4 py-2 text-right">{formatMoney(row.expense)}</td>
                        <td className={`px-4 py-2 text-right ${row.profit >= 0 ? 'text-accent' : 'text-red-400'}`}>{formatMoney(row.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 🔥 НОВАЯ СЕКЦИЯ: СТРУКТУРА (Расходы vs Доходы) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* График расходов */}
            <Card className="p-6 border-border bg-card neon-glow">
                <h3 className="text-sm font-semibold text-foreground mb-4">Топ-10 расходов</h3>
                {loading ? (
                <p className="text-sm text-muted-foreground">Загрузка...</p>
                ) : expenseByCategoryData.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных по расходам</p>
                ) : (
                <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={expenseByCategoryData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555" />
                        <XAxis type="number" stroke="#ccc" />
                        <YAxis type="category" dataKey="name" stroke="#ccc" width={80} /> 
                        <Tooltip {...tooltipStyles} formatter={(value: any) => [`${Number(value).toLocaleString('ru-RU')} ₸`, 'Сумма']} labelFormatter={(label) => `Категория: ${label}`}/>
                        <Bar dataKey="amount" name="Сумма расхода" fill="#ef4444" radius={[0, 4, 4, 0]}/>
                    </BarChart>
                    </ResponsiveContainer>
                </div>
                )}
            </Card>

            {/* 🍩 НОВЫЙ ГРАФИК: ИСТОЧНИКИ ДОХОДА (ЗОНЫ) */}
            <Card className="p-6 border-border bg-card neon-glow">
                <h3 className="text-sm font-semibold text-foreground mb-4">Источники выручки (Зоны)</h3>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Загрузка...</p>
                ) : incomeByZoneData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет данных</p>
                ) : (
                  <div className="h-80 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={incomeByZoneData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {incomeByZoneData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} stroke="rgba(0,0,0,0.5)" />
                          ))}
                        </Pie>
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                            formatter={(value: any) => [`${Number(value).toLocaleString('ru-RU')} ₸`, 'Выручка']} 
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
            </Card>

          </div>
          {/* КОНЕЦ СЕКЦИИ СТРУКТУРЫ */}


          {/* График по компаниям (BarChart) */}
          <Card className="p-6 border-border bg-card neon-glow">
            <h3 className="text-sm font-semibold text-foreground mb-4">Доход / Расход / Прибыль по компаниям</h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка данных...</p>
            ) : totalsByCompany.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={totalsByCompany}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555"/>
                    <XAxis dataKey="name" stroke="#ccc" />
                    <YAxis stroke="#ccc" />
                    <Tooltip {...tooltipStyles} formatter={(value: any, name: any) => [`${Number(value).toLocaleString('ru-RU')} ₸`, name]}/>
                    <Legend wrapperStyle={{ color: '#fff' }} />
                    <Bar dataKey="income" name="Доход" fill="#22c55e" radius={[4, 4, 0, 0]}/>
                    <Bar dataKey="expense" name="Расход" fill="#ef4444" radius={[4, 4, 0, 0]}/>
                    <Bar dataKey="profit" name="Прибыль" fill="#eab308" radius={[4, 4, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* График по сменам */}
          <Card className="p-6 border-border bg-card neon-glow mb-8">
            <h3 className="text-sm font-semibold text-foreground mb-4">Доход по сменам (Day / Night)</h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Загрузка данных...</p>
            ) : shiftData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shiftData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#555"/>
                    <XAxis dataKey="shift" stroke="#ccc" />
                    <YAxis stroke="#ccc" />
                    <Tooltip {...tooltipStyles} formatter={(value: any, name: any) => [`${Number(value).toLocaleString('ru-RU')} ₸`, name]}/>
                    <Legend wrapperStyle={{ color: '#fff' }} />
                    <Bar dataKey="income" name="Доход" fill="#3b82f6" radius={[4, 4, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}
