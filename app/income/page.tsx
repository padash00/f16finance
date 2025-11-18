'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { Plus, Download, Sun, Moon, Banknote, CreditCard, Smartphone, Search, Filter, X, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

// --- Типы ---
type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night'
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string
}

type ShiftFilter = 'all' | 'day' | 'night'
type PayFilter = 'all' | 'cash' | 'kaspi' | 'card'
type DateRangePreset = 'today' | 'week' | 'month' | 'all'

// --- Хелперы ---
const todayISO = () => { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}` }
const addDaysISO = (iso: string, diff: number) => { const d = new Date(iso); d.setDate(d.getDate() + diff); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}` }
const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')
const formatDate = (value: string) => { if (!value) return ''; const d = new Date(value); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

export default function IncomePage() {
  // Данные
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('') 

  // 1. Загрузка Списка Компаний (Один раз при старте)
  useEffect(() => {
    const fetchCompanies = async () => {
        const { data, error } = await supabase.from('companies').select('id, name, code').order('name', { ascending: true });
        if (!error && data) setCompanies(data);
    };
    fetchCompanies();
  }, []);

  // 2. Загрузка Данных (Строк) при изменении фильтров
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      let query = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, card_amount, comment')
        .order('date', { ascending: false })

      // Применяем фильтры к запросу БД
      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)
      if (companyFilter !== 'all') query = query.eq('company_id', companyFilter)
      if (shiftFilter !== 'all') query = query.eq('shift', shiftFilter)
      
      if (payFilter === 'cash') query = query.gt('cash_amount', 0)
      if (payFilter === 'kaspi') query = query.gt('kaspi_amount', 0)
      if (payFilter === 'card') query = query.gt('card_amount', 0)

      const { data, error } = await query

      if (error) {
        console.error('Error loading incomes:', error)
        setError('Ошибка при загрузке данных')
      } else {
        setRows((data || []) as IncomeRow[])
      }
      setLoading(false)
    }

    loadData()
  }, [dateFrom, dateTo, companyFilter, shiftFilter, payFilter]) // Зависимости перезапуска

  // 3. Локальный поиск по комментарию
  const filteredRows = useMemo(() => {
      if (!searchTerm) return rows;
      const lowerTerm = searchTerm.toLowerCase();
      return rows.filter(r => 
        (r.comment && r.comment.toLowerCase().includes(lowerTerm)) ||
        (r.zone && r.zone.toLowerCase().includes(lowerTerm))
      );
  }, [rows, searchTerm]);

  const companyName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? '—'

  // ⭐️ УМНЫЙ ПОДСЧЕТ ИТОГОВ ⭐️
  const totals = useMemo(() => {
    // Находим ID компании Extra
    const extraCompany = companies.find(c => c.code === 'extra' || c.name === 'F16 Extra');
    const extraCompanyId = extraCompany ? extraCompany.id : 'unknown';

    let cash = 0, kaspi = 0, card = 0;

    for (const r of filteredRows) {
      // ЛОГИКА:
      // Если фильтр компаний = "Все" -> пропускаем Extra из общей суммы.
      // Если фильтр компаний = "Конкретная ID" (даже если это Extra) -> считаем её.
      
      if (companyFilter === 'all' && r.company_id === extraCompanyId) {
        continue; // Не включаем Extra в общий итог
      }

      cash += Number(r.cash_amount || 0)
      kaspi += Number(r.kaspi_amount || 0)
      card += Number(r.card_amount || 0)
    }

    return { cash, kaspi, card, total: cash + kaspi + card }
  }, [filteredRows, companies, companyFilter])

  // Установка быстрых дат
  const setPreset = (preset: DateRangePreset) => {
      const today = todayISO();
      if (preset === 'today') { setDateFrom(today); setDateTo(today); }
      if (preset === 'week') { setDateFrom(addDaysISO(today, -6)); setDateTo(today); }
      if (preset === 'month') { setDateFrom(addDaysISO(today, -29)); setDateTo(today); }
      if (preset === 'all') { setDateFrom(''); setDateTo(''); }
  }

  // Экспорт CSV
  const downloadCSV = () => {
    const headers = ['Дата', 'Компания', 'Смена', 'Зона', 'Cash', 'Kaspi', 'Card', 'Итого', 'Комментарий'];
    const csvContent = [headers.join(','), ...filteredRows.map(r => {
        const total = (r.cash_amount||0) + (r.kaspi_amount||0) + (r.card_amount||0);
        return [
            r.date, companyName(r.company_id), r.shift, r.zone,
            r.cash_amount, r.kaspi_amount, r.card_amount, total, `"${r.comment || ''}"`
        ].join(',')
    })].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `incomes_${new Date().toISOString().slice(0,10)}.csv`;
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
              <h1 className="text-3xl font-bold text-foreground">Журнал Доходов</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                История операций и управление записями
              </p>
            </div>
            <div className="flex gap-2">
                 <Button variant="outline" size="sm" onClick={downloadCSV} disabled={filteredRows.length === 0} className="gap-2 text-xs">
                    <Download className="w-4 h-4" /> Экспорт
                 </Button>
                <Link href="/income/add">
                    <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2 text-xs">
                        <Plus className="w-4 h-4" /> Добавить
                    </Button>
                </Link>
            </div>
          </div>

          {/* 📊 KPI БЛОК (ДИНАМИЧЕСКИЙ) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Banknote className="w-4 h-4 text-green-500" /> <span className="text-xs">Наличные</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{formatMoney(totals.cash)} ₸</div>
              </Card>
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Smartphone className="w-4 h-4 text-blue-500" /> <span className="text-xs">Kaspi</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{formatMoney(totals.kaspi)} ₸</div>
              </Card>
              <Card className="p-4 border-border bg-card/50 neon-glow flex flex-col justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <CreditCard className="w-4 h-4 text-purple-500" /> <span className="text-xs">Карта</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{formatMoney(totals.card)} ₸</div>
              </Card>
              <Card className="p-4 border border-accent/50 bg-accent/10 neon-glow flex flex-col justify-center relative overflow-hidden">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Всего по фильтру</div>
                  <div className="text-2xl font-bold text-accent">{formatMoney(totals.total)} ₸</div>
                  {companyFilter === 'all' && <div className="text-[9px] text-muted-foreground absolute bottom-2 right-3 opacity-60">(без Extra)</div>}
              </Card>
          </div>

          {/* 🎛️ ПАНЕЛЬ ФИЛЬТРОВ */}
          <Card className="p-4 border-border bg-card neon-glow">
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
               
               {/* Левая часть: Даты и Пресеты */}
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

               {/* Правая часть: Дропдауны и Поиск */}
               <div className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Компания</label>
                       <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[130px]">
                          <option value="all">Все компании</option>
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                       </select>
                   </div>

                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Смена</label>
                       <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground">
                          <option value="all">Все</option>
                          <option value="day">День ☀️</option>
                          <option value="night">Ночь 🌙</option>
                       </select>
                   </div>

                   <div className="flex flex-col gap-1">
                       <label className="text-[10px] text-muted-foreground">Оплата</label>
                       <select value={payFilter} onChange={(e) => setPayFilter(e.target.value as PayFilter)} className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground">
                          <option value="all">Любая</option>
                          <option value="cash">Нал</option>
                          <option value="kaspi">Kaspi</option>
                          <option value="card">Карта</option>
                       </select>
                   </div>

                   <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                       <label className="text-[10px] text-muted-foreground">Поиск</label>
                       <div className="relative">
                           <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                           <input 
                             type="text" 
                             placeholder="Комментарий..." 
                             value={searchTerm}
                             onChange={(e) => setSearchTerm(e.target.value)}
                             className="w-full h-9 pl-8 pr-2 bg-input border border-border rounded text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-accent transition-colors"
                           />
                           {searchTerm && (
                             <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                                <X className="w-3 h-3" />
                             </button>
                           )}
                       </div>
                   </div>
               </div>
            </div>
          </Card>

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 rounded text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          {/* 📋 ТАБЛИЦА ДАННЫХ */}
          <Card className="border-border bg-card neon-glow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-left">Компания</th>
                    <th className="px-4 py-3 text-center">Смена</th>
                    <th className="px-4 py-3 text-left">Зона</th>
                    <th className="px-4 py-3 text-right text-green-500">Нал</th>
                    <th className="px-4 py-3 text-right text-blue-500">Kaspi</th>
                    <th className="px-4 py-3 text-right text-purple-500">Карта</th>
                    <th className="px-4 py-3 text-right text-foreground">Всего</th>
                    <th className="px-4 py-3 text-left">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {loading && (
                    <tr><td colSpan={9} className="px-6 py-10 text-center text-muted-foreground animate-pulse">Загрузка данных...</td></tr>
                  )}

                  {!loading && filteredRows.map((row, idx) => {
                    const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.card_amount || 0)
                    // Визуально помечаем Extra, но НЕ скрываем
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
                        <td className="px-4 py-3 text-center">
                           {row.shift === 'day' 
                            ? <Sun className="w-4 h-4 text-yellow-400 inline" /> 
                            : <Moon className="w-4 h-4 text-blue-400 inline" />}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {row.zone || '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {row.cash_amount ? formatMoney(row.cash_amount) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {row.kaspi_amount ? formatMoney(row.kaspi_amount) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${row.card_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {row.card_amount ? formatMoney(row.card_amount) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-accent font-mono bg-accent/5">
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
                        <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                                <Filter className="w-8 h-8 opacity-20" />
                                <p>Записи не найдены. Попробуйте изменить фильтры.</p>
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