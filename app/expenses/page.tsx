'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { Plus, Filter, Download, Search, Banknote, Smartphone, TrendingUp, Tag, Wallet } from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

// --- Типы ---
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
  code?: string
}

type PayFilter = 'all' | 'cash' | 'kaspi'
type DateRangePreset = 'today' | 'week' | 'month' | 'all'

// --- Хелперы ---
const todayISO = () => { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}` }
const addDaysISO = (iso: string, diff: number) => { const d = new Date(iso); d.setDate(d.getDate() + diff); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}` }
const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')
const formatDate = (value: string) => { if (!value) return ''; const d = new Date(value); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

export default function ExpensesPage() {
  // Данные
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // 1. Загрузка (Один раз)
  useEffect(() => {
    const fetchInit = async () => {
        const { data } = await supabase.from('companies').select('id, name, code').order('name');
        if (data) setCompanies(data);
    }
    fetchInit();
  }, []);

  // 2. Загрузка данных при смене фильтров
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      let query = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .order('date', { ascending: false })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)
      if (companyFilter !== 'all') query = query.eq('company_id', companyFilter)
      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter)
      if (payFilter === 'cash') query = query.gt('cash_amount', 0)
      if (payFilter === 'kaspi') query = query.gt('kaspi_amount', 0)

      const { data, error } = await query

      if (error) {
        console.error('Error loading expenses:', error)
        setError('Ошибка загрузки данных')
      } else {
        setRows((data || []) as ExpenseRow[])
      }
      setLoading(false)
    }
    loadData()
  }, [dateFrom, dateTo, companyFilter, categoryFilter, payFilter])

  // 3. Локальная фильтрация (Поиск)
  const filteredRows = useMemo(() => {
      if (!searchTerm) return rows;
      const lower = searchTerm.toLowerCase();
      return rows.filter(r => 
         (r.comment && r.comment.toLowerCase().includes(lower)) || 
         (r.category && r.category.toLowerCase().includes(lower))
      );
  }, [rows, searchTerm]);

  const companyName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? '—'

  // Список категорий (динамически из загруженных строк)
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  // ⭐️ УМНЫЕ ИТОГИ + АНАЛИТИКА ⭐️
  const analytics = useMemo(() => {
    const extraCompany = companies.find(c => c.code === 'extra' || c.name === 'F16 Extra');
    const extraCompanyId = extraCompany ? extraCompany.id : 'unknown';

    let cash = 0, kaspi = 0;
    const catMap: Record<string, number> = {};

    for (const r of filteredRows) {
       // Исключаем Extra, если выбран фильтр "Все"
       if (companyFilter === 'all' && r.company_id === extraCompanyId) continue;

       const rowTotal = (r.cash_amount || 0) + (r.kaspi_amount || 0);
       cash += (r.cash_amount || 0);
       kaspi += (r.kaspi_amount || 0);

       // Считаем топ категорию
       const cat = r.category || 'Без категории';
       catMap[cat] = (catMap[cat] || 0) + rowTotal;
    }

    // Находим категорию с макс. расходом
    let topCategory = '—';
    let topAmount = 0;
    Object.entries(catMap).forEach(([cat, amount]) => {
        if (amount > topAmount) {
            topAmount = amount;
            topCategory = cat;
        }
    });

    return { 
        cash, 
        kaspi, 
        total: cash + kaspi, 
        topCategory,
        topAmount
    }
  }, [filteredRows, companies, companyFilter])

  // Пресеты дат
  const setPreset = (preset: DateRangePreset) => {
      const today = todayISO();
      if (preset === 'today') { setDateFrom(today); setDateTo(today); }
      if (preset === 'week') { setDateFrom(addDaysISO(today, -6)); setDateTo(today); }
      if (preset === 'month') { setDateFrom(addDaysISO(today, -29)); setDateTo(today); }
      if (preset === 'all') { setDateFrom(''); setDateTo(''); }
  }

  const downloadCSV = () => {
    const headers = ['Дата', 'Компания', 'Категория', 'Cash', 'Kaspi', 'Итого', 'Комментарий'];
    const csvContent = [headers.join(','), ...filteredRows.map(r => {
        const total = (r.cash_amount||0) + (r.kaspi_amount||0);
        return [r.date, companyName(r.company_id), r.category, r.cash_amount, r.kaspi_amount, total, `"${r.comment || ''}"`].join(',')
    })].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `expenses_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          
          {/* Шапка */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-foreground">Журнал Расходов</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Контроль затрат и анализ категорий
              </p>
            </div>
            <div className="flex gap-2">
                 <Button variant="outline" size="sm" onClick={downloadCSV} disabled={filteredRows.length === 0} className="gap-2 text-xs">
                    <Download className="w-4 h-4" /> Экспорт
                 </Button>
                <Link href="/expenses/add">
                    <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2 text-xs">
                        <Plus className="w-4 h-4" /> Добавить
                    </Button>
                </Link>
            </div>
          </div>

          {/* 📊 KPI КАРТОЧКИ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Banknote className="w-4 h-4 text-red-400" /> <span className="text-xs">Наличные</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{formatMoney(analytics.cash)} ₸</div>
              </Card>
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Smartphone className="w-4 h-4 text-red-400" /> <span className="text-xs">Kaspi</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{formatMoney(analytics.kaspi)} ₸</div>
              </Card>
              {/* 🧠 УМНЫЙ KPI: Топ категория */}
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center border-l-4 border-l-red-500/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Tag className="w-4 h-4 text-yellow-400" /> <span className="text-xs">Топ категория</span>
                  </div>
                  <div className="text-sm font-bold text-foreground truncate" title={analytics.topCategory}>{analytics.topCategory}</div>
                  <div className="text-xs text-muted-foreground">{formatMoney(analytics.topAmount)} ₸</div>
              </Card>
              <Card className="p-4 border border-red-500/30 bg-red-500/5 neon-glow flex flex-col justify-center">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Всего расход</div>
                  <div className="text-2xl font-bold text-red-400">{formatMoney(analytics.total)} ₸</div>
                  {companyFilter === 'all' && <div className="text-[9px] text-muted-foreground opacity-60">(без Extra)</div>}
              </Card>
          </div>

          {/* 🎛️ ФИЛЬТРЫ */}
          <Card className="p-4 border-border bg-card neon-glow">
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
               
               {/* Даты */}
               <div className="flex flex-col gap-2 w-full lg:w-auto">
                   <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Период</label>
                   <div className="flex flex-wrap items-center gap-2">
                       <div className="flex items-center bg-input/50 rounded-md border border-border/50 p-1">
                           <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-xs px-2 py-1 text-foreground outline-none cursor-pointer" />
                           <span className="text-muted-foreground text-xs px-1">→</span>
                           <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-xs px-2 py-1 text-foreground outline-none cursor-pointer" />
                       </div>
                       <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                           <button onClick={() => setPreset('today')} className="px-3 py-1 text-[10px] hover:bg-white/10 rounded transition-colors">Сегодня</button>
                           <button onClick={() => setPreset('week')} className="px-3 py-1 text-[10px] hover:bg-white/10 rounded transition-colors">Неделя</button>
                           <button onClick={() => setPreset('month')} className="px-3 py-1 text-[10px] hover:bg-white/10 rounded transition-colors">30 дн.</button>
                           <button onClick={() => setPreset('all')} className="px-3 py-1 text-[10px] hover:bg-white/10 rounded transition-colors">Всё</button>
                       </div>
                   </div>
               </div>

               {/* Дропдауны */}
               <div className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Компания</label>
                       <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[130px]">
                          <option value="all">Все компании</option>
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                       </select>
                   </div>

                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Категория</label>
                       <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[130px]">
                          <option value="all">Все категории</option>
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                       </select>
                   </div>

                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Оплата</label>
                       <select value={payFilter} onChange={(e) => setPayFilter(e.target.value as PayFilter)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground">
                          <option value="all">Любая</option>
                          <option value="cash">Нал</option>
                          <option value="kaspi">Kaspi</option>
                       </select>
                   </div>

                   <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                       <label className="text-[10px] text-muted-foreground">Поиск</label>
                       <div className="relative">
                           <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                           <input 
                             type="text" 
                             placeholder="Зарплата, аренда..." 
                             value={searchTerm}
                             onChange={(e) => setSearchTerm(e.target.value)}
                             className="w-full h-9 pl-8 pr-2 bg-input border border-border rounded text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-accent transition-colors"
                           />
                       </div>
                   </div>
               </div>
            </div>
          </Card>

          {/* 📋 ТАБЛИЦА */}
          <Card className="border-border bg-card neon-glow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-left">Компания</th>
                    <th className="px-4 py-3 text-left">Категория</th>
                    <th className="px-4 py-3 text-right text-red-400/70">Нал</th>
                    <th className="px-4 py-3 text-right text-red-400/70">Kaspi</th>
                    <th className="px-4 py-3 text-right text-foreground">Итого</th>
                    <th className="px-4 py-3 text-left">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {loading && (
                    <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground animate-pulse">Загрузка...</td></tr>
                  )}

                  {!loading && filteredRows.map((row, idx) => {
                    const total = (row.cash_amount || 0) + (row.kaspi_amount || 0)
                    const isExtra = companies.find(c => c.id === row.company_id)?.code === 'extra';

                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-border/40 hover:bg-white/5 transition-colors ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50' : ''}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          {companyName(row.company_id)}
                          {isExtra && <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/30">EXTRA</span>}
                        </td>
                        <td className="px-4 py-3">
                           <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-foreground/80 border border-white/10">
                             {row.category || 'Общее'}
                           </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-red-400' : 'text-muted-foreground/20'}`}>
                          {row.cash_amount ? formatMoney(row.cash_amount) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-red-400' : 'text-muted-foreground/20'}`}>
                          {row.kaspi_amount ? formatMoney(row.kaspi_amount) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-red-500 font-mono bg-red-500/5">
                          {formatMoney(total)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                          {row.comment || '—'}
                        </td>
                      </tr>
                    )
                  })}

                  {!loading && !error && filteredRows.length === 0 && (
                    <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                                <Wallet className="w-8 h-8 opacity-20" />
                                <p>Расходов не найдено</p>
                            </div>
                        </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}