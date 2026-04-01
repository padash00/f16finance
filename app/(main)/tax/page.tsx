'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Calculator,
  CalendarDays,
  TrendingDown,
  TrendingUp,
  Landmark,
  AlertCircle,
  Wallet,
  CreditCard,
  Store,
  Gamepad2,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts'

// --- Типы ---
type IncomeRow = {
  id: string
  date: string
  company_id: string
  cash_amount: number
  kaspi_amount: number
  card_amount: number
}

type Company = {
  id: string
  name: string
  code: string
}

type MonthlyTaxData = {
    month: string; // YYYY-MM
    monthName: string;
    taxableIncome: number; // Белая выручка
    ignoredIncome: number; // Серая выручка (Арена Нал + Extra)
    taxAmount: number;     // 3%
}

// --- Хелперы ---
const formatMoney = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const getSixMonthsAgo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    d.setDate(1); // С первого числа
    return d.toISOString().slice(0, 10);
}

const getToday = () => new Date().toISOString().slice(0, 10);

export default function TaxPage() {
  const [dateFrom, setDateFrom] = useState(getSixMonthsAgo())
  const [dateTo, setDateTo] = useState(getToday())
  
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  // ЗАГРУЗКА ДАННЫХ
  useEffect(() => {
    const load = async () => {
        setLoading(true)
        const [companiesRes, incomesRes] = await Promise.all([
          fetch('/api/admin/companies'),
          fetch(`/api/admin/incomes?from=${dateFrom}&to=${dateTo}`),
        ])

        const companiesJson = await companiesRes.json().catch(() => null)
        const incomesJson = await incomesRes.json().catch(() => null)

        setCompanies(companiesRes.ok ? (companiesJson?.data || []) : [])
        setIncomes(incomesRes.ok ? (incomesJson?.data || []) : [])
        setLoading(false);
    }
    load();
  }, [dateFrom, dateTo])

  // --- 🧮 ГЛАВНАЯ ЛОГИКА РАСЧЕТА НАЛОГА ---
  const calculation = useMemo(() => {
      let totalTaxable = 0; // База для налога
      let totalIgnored = 0; // То, что не облагаем
      let totalTax = 0;     // Сам налог (3%)

      const monthlyStats = new Map<string, MonthlyTaxData>();

      // Находим ID компаний
      const arenaId = companies.find(c => c.code === 'arena')?.id;
      const ramenId = companies.find(c => c.code === 'ramen')?.id;
      const extraId = companies.find(c => c.code === 'extra')?.id;

      // Инициализация по месяцам (чтобы график был красивый)
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
          const key = d.toISOString().slice(0, 7); // 2025-11
          const monthName = d.toLocaleString('ru-RU', { month: 'short', year: '2-digit' });
          if (!monthlyStats.has(key)) {
              monthlyStats.set(key, { month: key, monthName, taxableIncome: 0, ignoredIncome: 0, taxAmount: 0 });
          }
      }

      incomes.forEach(row => {
          let rowTaxable = 0;
          let rowIgnored = 0;

          const cash = row.cash_amount || 0;
          const kaspi = (row.kaspi_amount || 0) + (row.card_amount || 0); // Считаем карту как каспи

          // ЛОГИКА ПОЛЬЗОВАТЕЛЯ:
          if (row.company_id === arenaId) {
              // АРЕНА: Каспи -> Налог, Нал -> Игнор
              rowTaxable += kaspi;
              rowIgnored += cash;
          } else if (row.company_id === ramenId) {
              // РАМЕН: Всё -> Налог
              rowTaxable += (cash + kaspi);
          } else {
              // EXTRA и прочие: Всё -> Игнор
              rowIgnored += (cash + kaspi);
          }

          // Общие итоги
          totalTaxable += rowTaxable;
          totalIgnored += rowIgnored;

          // Помесячные итоги
          const key = row.date.slice(0, 7);
          const stat = monthlyStats.get(key);
          if (stat) {
              stat.taxableIncome += rowTaxable;
              stat.ignoredIncome += rowIgnored;
              stat.taxAmount += (rowTaxable * 0.03);
          }
      });

      totalTax = totalTaxable * 0.03; // 3%

      // Превращаем Map в массив для графика
      const chartData = Array.from(monthlyStats.values()).sort((a, b) => a.month.localeCompare(b.month));

      return { totalTaxable, totalIgnored, totalTax, chartData };
  }, [incomes, companies]); // Пересчитываем при изменении данных

  return (
    <>
        <div className="app-page max-w-7xl space-y-8">
          
          {/* Заголовок и Даты */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <Landmark className="w-8 h-8 text-yellow-500" /> 
                Налоговый калькулятор (3%)
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Расчет обязательств: Арена (только Kaspi) + Рамен (Всё)
              </p>
            </div>
            
            <Card className="p-1 flex items-center gap-2 bg-card/50 border-border">
                 <div className="flex items-center px-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground mr-2" />
                    <input 
                        type="date" 
                        value={dateFrom} 
                        onChange={e => setDateFrom(e.target.value)}
                        className="bg-transparent text-sm w-24 outline-none text-foreground"
                    />
                    <span className="text-muted-foreground mx-1">—</span>
                    <input 
                        type="date" 
                        value={dateTo} 
                        onChange={e => setDateTo(e.target.value)}
                        className="bg-transparent text-sm w-24 outline-none text-foreground"
                    />
                 </div>
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    className="h-7 text-xs"
                    onClick={() => { setDateFrom(getSixMonthsAgo()); setDateTo(getToday()); }}
                 >
                    6 месяцев
                 </Button>
            </Card>
          </div>

          {/* 💰 КАРТОЧКИ ИТОГОВ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* 1. К ОПЛАТЕ */}
              <Card className="p-6 border border-yellow-500/50 bg-yellow-500/10 neon-glow relative overflow-hidden">
                  <div className="relative z-10">
                      <div className="flex items-center gap-2 text-yellow-200 mb-2">
                          <Calculator className="w-5 h-5" />
                          <span className="font-bold uppercase tracking-wider text-xs">Налог к оплате (3%)</span>
                      </div>
                      <div className="text-4xl font-bold text-yellow-400">
                          {formatMoney(calculation.totalTax)}
                      </div>
                      <p className="text-xs text-yellow-200/60 mt-2">
                          Сумма, которую нужно отложить
                      </p>
                  </div>
                  <div className="absolute -right-4 -bottom-4 opacity-10">
                      <Landmark className="w-32 h-32" />
                  </div>
              </Card>

              {/* 2. НАЛОГОВАЯ БАЗА */}
              <Card className="p-6 border-border bg-card neon-glow">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <Store className="w-4 h-4 text-green-400" />
                      <span className="font-bold uppercase tracking-wider text-xs">Белая выручка (База)</span>
                  </div>
                  <div className="text-2xl font-bold text-foreground">
                      {formatMoney(calculation.totalTaxable)}
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground space-y-1">
                      <p className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Kaspi Арены</p>
                      <p className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Нал + Kaspi Рамена</p>
                  </div>
              </Card>

              {/* 3. НЕОБЛАГАЕМОЕ */}
              <Card className="p-6 border-border bg-card neon-glow opacity-80">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                      <AlertCircle className="w-4 h-4 text-gray-400" />
                      <span className="font-bold uppercase tracking-wider text-xs">Не учитывается (Серое)</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-400">
                      {formatMoney(calculation.totalIgnored)}
                  </div>
                   <div className="mt-3 text-xs text-muted-foreground space-y-1">
                      <p className="flex items-center gap-1"><XCircle className="w-3 h-3 text-gray-400" /> Нал Арены</p>
                      <p className="flex items-center gap-1"><XCircle className="w-3 h-3 text-gray-400" /> F16 Extra (всё)</p>
                  </div>
              </Card>
          </div>

          {/* 📊 ГРАФИК ПО МЕСЯЦАМ */}
          <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-bold text-foreground mb-6">Динамика налоговой базы и налога</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={calculation.chartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                        <XAxis dataKey="monthName" stroke="#666" fontSize={12} />
                        <YAxis stroke="#666" fontSize={12} tickFormatter={v => `${v/1000}k`} />
                        <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                            formatter={(val: number, name: string) => [formatMoney(val), name]}
                        />
                        <Legend />
                        <Bar dataKey="taxableIncome" name="База (Выручка)" fill="#22c55e" stackId="a" radius={[0,0,4,4]} />
                        <Bar dataKey="taxAmount" name="Налог (3%)" fill="#eab308" radius={[4,4,0,0]} />
                    </BarChart>
                </ResponsiveContainer>
              </div>
          </Card>

          {/* ТАБЛИЦА ДЕТАЛИЗАЦИИ */}
          <Card className="p-6 border-border bg-card neon-glow">
              <h3 className="text-sm font-bold text-foreground mb-4">Детализация по месяцам</h3>
              <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                      <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                              <th className="px-4 py-3 text-left">Месяц</th>
                              <th className="px-4 py-3 text-right text-green-500">Облагаемая база</th>
                              <th className="px-4 py-3 text-right text-yellow-500 font-bold">Налог (3%)</th>
                              <th className="px-4 py-3 text-right text-gray-500">Не учтено</th>
                          </tr>
                      </thead>
                      <tbody>
                          {calculation.chartData.map(row => (
                              <tr key={row.month} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="px-4 py-3 font-medium">{row.monthName}</td>
                                  <td className="px-4 py-3 text-right">{formatMoney(row.taxableIncome)}</td>
                                  <td className="px-4 py-3 text-right font-bold text-yellow-400">{formatMoney(row.taxAmount)}</td>
                                  <td className="px-4 py-3 text-right text-muted-foreground">{formatMoney(row.ignoredIncome)}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </Card>

        </div>
    </>
  )
}
