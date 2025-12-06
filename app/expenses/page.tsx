'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import {
  Plus,
  Filter,
  Download,
  Search,
  Banknote,
  Smartphone,
  Tag,
  Wallet,
  CalendarDays,
} from 'lucide-react'
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
const todayISO = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const addDaysISO = (iso: string, diff: number) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')

const formatDate = (value: string) => {
  if (!value) return ''
  const d = new Date(value)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatIsoToRu = (iso: string | '') => {
  if (!iso) return '…'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function ExpensesPage() {
  // Данные
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('today')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)

  // 1. Загрузка компаний
  useEffect(() => {
    const fetchInit = async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, name, code')
        .order('name')
      if (data) setCompanies(data)
    }
    fetchInit()
  }, [])

  // Мапа компаний
  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const companyName = useCallback(
    (companyId: string) => companyMap.get(companyId)?.name ?? '—',
    [companyMap]
  )

  // ID Extra
  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => c.code === 'extra' || c.name === 'F16 Extra')
    return extra?.id ?? null
  }, [companies])

  // 2. Загрузка расходов при смене фильтров
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      const t0 = performance.now()

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

      // защита от "Всё за 5 лет" — режем до 1000 строк
      query = query.limit(1000)

      const { data, error } = await query

      const t1 = performance.now()
      console.log(
        `expenses query time: ${(t1 - t0).toFixed(0)} ms, rows: ${data?.length ?? 0}`
      )

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

  // 3. Локальная фильтрация (поиск)
  const filteredRows = useMemo(() => {
    if (!searchTerm) return rows
    const lower = searchTerm.toLowerCase()
    return rows.filter(
      (r) =>
        (r.comment && r.comment.toLowerCase().includes(lower)) ||
        (r.category && r.category.toLowerCase().includes(lower))
    )
  }, [rows, searchTerm])

  // Список категорий
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  // ⭐ УМНЫЕ ИТОГИ + АНАЛИТИКА ⭐
  const analytics = useMemo(() => {
    let cash = 0
    let kaspi = 0
    const catMap: Record<string, number> = {}

    for (const r of filteredRows) {
      if (
        companyFilter === 'all' &&
        !includeExtraInTotals &&
        extraCompanyId &&
        r.company_id === extraCompanyId
      ) {
        continue
      }

      const rowTotal = (r.cash_amount || 0) + (r.kaspi_amount || 0)
      cash += r.cash_amount || 0
      kaspi += r.kaspi_amount || 0

      const cat = r.category || 'Без категории'
      catMap[cat] = (catMap[cat] || 0) + rowTotal
    }

    let topCategory = '—'
    let topAmount = 0
    Object.entries(catMap).forEach(([cat, amount]) => {
      if (amount > topAmount) {
        topAmount = amount
        topCategory = cat
      }
    })

    return {
      cash,
      kaspi,
      total: cash + kaspi,
      topCategory,
      topAmount,
    }
  }, [filteredRows, companyFilter, includeExtraInTotals, extraCompanyId])

  // Пресеты дат
  const setPreset = (preset: DateRangePreset) => {
    const today = todayISO()
    setActivePreset(preset)

    if (preset === 'today') {
      setDateFrom(today)
      setDateTo(today)
    }
    if (preset === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
    }
    if (preset === 'month') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
    }
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
    }
  }

  const handleDateFromChange = (value: string) => {
    setDateFrom(value)
    setActivePreset(null)
  }

  const handleDateToChange = (value: string) => {
    setDateTo(value)
    setActivePreset(null)
  }

  // Период в читаемом виде
  const periodLabel =
    dateFrom || dateTo
      ? `${formatIsoToRu(dateFrom)} — ${formatIsoToRu(dateTo)}`
      : 'Весь период'

  // === ЭКСПОРТ ДЛЯ EXCEL (разделитель ;) ===
  const downloadCSV = () => {
    const SEP = ';'
    const headers = [
      'Дата',
      'Компания',
      'Категория',
      'Cash',
      'Kaspi',
      'Итого',
      'Комментарий',
    ]

    const csvContent = [
      headers.join(SEP),
      ...filteredRows.map((r) => {
        const total = (r.cash_amount || 0) + (r.kaspi_amount || 0)
        const safeComment = (r.comment || '').replace(/"/g, '""')

        return [
          r.date,
          companyName(r.company_id),
          r.category ?? '',
          r.cash_amount ?? 0,
          r.kaspi_amount ?? 0,
          total,
          `"${safeComment}"`,
        ].join(SEP)
      }),
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `expenses_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Шапка */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-foreground">Журнал расходов</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Контроль затрат и анализ категорий
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadCSV}
                disabled={filteredRows.length === 0}
                className="gap-2 text-xs"
              >
                <Download className="w-4 h-4" /> Экспорт
              </Button>
              <Link href="/expenses/add">
                <Button
                  size="sm"
                  className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2 text-xs"
                >
                  <Plus className="w-4 h-4" /> Добавить
                </Button>
              </Link>
            </div>
          </div>

          {/* KPI блок */}
          <Card className="p-4 border-border bg-card/70 neon-glow space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Banknote className="w-4 h-4 text-red-400" />
                  <span className="text-xs uppercase tracking-wide">Наличные</span>
                </div>
                <div className="text-xl font-bold text-foreground">
                  {formatMoney(analytics.cash)} ₸
                </div>
              </Card>
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Smartphone className="w-4 h-4 text-red-400" />
                  <span className="text-xs uppercase tracking-wide">Kaspi</span>
                </div>
                <div className="text-xl font-bold text-foreground">
                  {formatMoney(analytics.kaspi)} ₸
                </div>
              </Card>
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center border-l-4 border-l-red-500/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tag className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs uppercase tracking-wide">Топ категория</span>
                </div>
                <div
                  className="text-sm font-bold text-foreground truncate"
                  title={analytics.topCategory}
                >
                  {analytics.topCategory}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMoney(analytics.topAmount)} ₸
                </div>
              </Card>
              <Card className="p-4 border border-red-500/40 bg-red-500/10 flex flex-col justify-center relative overflow-hidden">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                  Всего расход
                </div>
                <div className="text-2xl font-bold text-red-400">
                  {formatMoney(analytics.total)} ₸
                </div>
                {companyFilter === 'all' && (
                  <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                        includeExtraInTotals
                          ? 'border-red-400 text-red-400 bg-red-500/10'
                          : 'border-border text-muted-foreground'
                      } cursor-pointer select-none`}
                      onClick={() => setIncludeExtraInTotals((v) => !v)}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          includeExtraInTotals ? 'bg-red-400' : 'bg-muted-foreground/40'
                        }`}
                      />
                      Extra в итогах
                    </span>
                  </div>
                )}
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                <span className="uppercase tracking-wide">Период:</span>
                <span className="font-mono">{periodLabel}</span>
              </div>
              <div>
                Записей: <span className="font-semibold">{filteredRows.length}</span>
              </div>
            </div>
          </Card>

          {/* Фильтры */}
          <Card className="p-4 border-border bg-card neon-glow">
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
              {/* Даты */}
              <div className="flex flex-col gap-2 w-full lg:w-auto">
                <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                  Период
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center bg-input/50 rounded-md border border-border/50 px-2 py-1">
                    <CalendarDays className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => handleDateFromChange(e.target.value)}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                    <span className="text-muted-foreground text-xs px-1">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => handleDateToChange(e.target.value)}
                      className="bg-transparent text-xs px-1 py-1 text-foreground outline-none cursor-pointer"
                    />
                  </div>
                  <div className="flex bg-input/30 rounded-md border border-border/30 p-0.5">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-3 py-1 text-[10px] rounded transition-colors ${
                          activePreset === p
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-white/10 text-muted-foreground'
                        }`}
                      >
                        {p === 'today' && 'Сегодня'}
                        {p === 'week' && 'Неделя'}
                        {p === 'month' && '30 дн.'}
                        {p === 'all' && 'Всё'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Дропдауны и поиск */}
              <div className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Компания</label>
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[130px]"
                  >
                    <option value="all">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Категория</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[130px]"
                  >
                    <option value="all">Все категории</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Оплата</label>
                  <select
                    value={payFilter}
                    onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground"
                  >
                    <option value="all">Любая</option>
                    <option value="cash">Нал</option>
                    <option value="kaspi">Kaspi</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 flex-1 min-w-[170px]">
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

          {error && (
            <div className="border border-destructive/60 bg-destructive/10 text-destructive px-4 py-3 rounded text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          {/* Таблица */}
          <Card className="border-border bg-card neon-glow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-border bg-secondary/40 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
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
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-10 text-center text-muted-foreground animate-pulse"
                      >
                        Загрузка...
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    filteredRows.map((row, idx) => {
                      const total =
                        (row.cash_amount || 0) + (row.kaspi_amount || 0)
                      const company = companyMap.get(row.company_id)
                      const isExtra =
                        company?.code === 'extra' || company?.name === 'F16 Extra'

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-border/40 hover:bg-white/5 transition-colors ${
                            idx % 2 === 0 ? 'bg-card/40' : ''
                          } ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50' : ''}`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                            {formatDate(row.date)}
                          </td>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">
                            {company?.name ?? '—'}
                            {isExtra && (
                              <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/30">
                                EXTRA
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-foreground/80 border border-white/10">
                              {row.category || 'Общее'}
                            </span>
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono ${
                              row.cash_amount
                                ? 'text-red-400'
                                : 'text-muted-foreground/20'
                            }`}
                          >
                            {row.cash_amount ? formatMoney(row.cash_amount) : '—'}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono ${
                              row.kaspi_amount
                                ? 'text-red-400'
                                : 'text-muted-foreground/20'
                            }`}
                          >
                            {row.kaspi_amount ? formatMoney(row.kaspi_amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-red-500 font-mono bg-red-500/5">
                            {formatMoney(total)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate">
                            {row.comment || '—'}
                          </td>
                        </tr>
                      )
                    })}

                  {!loading && !error && filteredRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-12 text-center text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Filter className="w-8 h-8 opacity-20" />
                          <p>Расходов не найдено. Попробуйте изменить фильтры.</p>
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
