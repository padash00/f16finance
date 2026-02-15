'use client'

import { useEffect, useMemo, useState, useCallback, useDeferredValue } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import {
  Plus,
  Download,
  Sun,
  Moon,
  Banknote,
  CreditCard,
  Smartphone,
  Search,
  Filter,
  X,
  CalendarDays,
  UserCircle2,
  Trophy,
  MapPin,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

// --- Типы ---
type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null // ✅ NEW
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code?: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type ShiftFilter = 'all' | Shift
type PayFilter = 'all' | 'cash' | 'kaspi' | 'online' | 'card' // ✅ NEW
type DateRangePreset = 'today' | 'week' | 'month' | 'all'
type OperatorFilter = 'all' | 'none' | string

// --- Даты без UTC-косяков ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)

const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const base = iso ? parseISODateSafe(iso) : parseISODateSafe(todayISO())
  base.setDate(base.getDate() + diff)
  return toISODateLocal(base)
}

const formatMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU')

const formatDate = (value: string) => {
  if (!value) return ''
  const d = parseISODateSafe(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatIsoToRu = (iso: string | '') => {
  if (!iso) return '…'
  const d = parseISODateSafe(iso)
  if (Number.isNaN(d.getTime())) return '…'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const escapeCSV = (v: any, sep = ';') => {
  const s = String(v ?? '')
  const needs = s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')
  const safe = s.replace(/"/g, '""')
  return needs ? `"${safe}"` : safe
}

// Надёжно определяем Extra (чтобы не зависеть от точного совпадения)
const isExtraCompany = (c?: Company | null) => {
  const code = String(c?.code ?? '').toLowerCase().trim()
  const name = String(c?.name ?? '').toLowerCase().trim()
  return code === 'extra' || name.includes('extra')
}

// Снимаем хвостики " • PS5/VR" чтобы комментарий в агрегированной строке был нормальный
const stripExtraSuffix = (s: string) => s.replace(/\s*•\s*(PS5|VR)\s*$/i, '').trim()

export default function IncomePage() {
  const LIMIT = 2000

  // Данные
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [hitLimit, setHitLimit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Фильтры
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('today')

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm)

  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [hideExtraRows, setHideExtraRows] = useState(false)

  // 1) Рефы
  useEffect(() => {
    const fetchRefs = async () => {
      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
        supabase
          .from('operators')
          .select('id, name, short_name, is_active')
          .eq('is_active', true)
          .order('name'),
      ])
      if (!compRes.error && compRes.data) setCompanies(compRes.data)
      if (!opRes.error && opRes.data) setOperators(opRes.data)
    }
    fetchRefs()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const operatorMap = useMemo(() => {
    const map = new Map<string, Operator>()
    for (const o of operators) map.set(o.id, o)
    return map
  }, [operators])

  const companyName = useCallback((companyId: string) => companyMap.get(companyId)?.name ?? '—', [companyMap])

  const operatorName = useCallback(
    (operatorId: string | null) => {
      if (!operatorId) return 'Без оператора'
      const op = operatorMap.get(operatorId)
      if (!op) return 'Без оператора'
      return op.short_name || op.name
    },
    [operatorMap],
  )

  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => isExtraCompany(c))
    return extra?.id ?? null
  }, [companies])

  const isExtraRow = useCallback((r: IncomeRow) => !!extraCompanyId && r.company_id === extraCompanyId, [extraCompanyId])

  // 2) Загрузка доходов
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)
      setHitLimit(false)

      const t0 = performance.now()

      let query = supabase
        .from('incomes')
        .select(
          'id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment',
        )
        .order('date', { ascending: false })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)
      if (companyFilter !== 'all') query = query.eq('company_id', companyFilter)
      if (shiftFilter !== 'all') query = query.eq('shift', shiftFilter)

      if (operatorFilter === 'none') query = query.is('operator_id', null)
      else if (operatorFilter !== 'all') query = query.eq('operator_id', operatorFilter)

      if (payFilter === 'cash') query = query.gt('cash_amount', 0)
      if (payFilter === 'kaspi') query = query.gt('kaspi_amount', 0)
      if (payFilter === 'online') query = query.gt('online_amount', 0) // ✅ NEW
      if (payFilter === 'card') query = query.gt('card_amount', 0)

      query = query.limit(LIMIT)

      const { data, error } = await query

      const t1 = performance.now()
      console.log(`incomes query time: ${(t1 - t0).toFixed(0)} ms, rows: ${data?.length ?? 0}`)

      if (error) {
        console.error('Error loading incomes:', error)
        setError('Ошибка при загрузке данных')
        setRows([])
      } else {
        const list = (data || []) as IncomeRow[]
        setRows(list)
        setHitLimit(list.length >= LIMIT)
      }

      setLoading(false)
    }

    loadData()
  }, [dateFrom, dateTo, companyFilter, shiftFilter, payFilter, operatorFilter])

  // 3) Локальные фильтры (поиск + скрыть Extra)
  const filteredRows = useMemo(() => {
    let base = rows

    if (hideExtraRows && extraCompanyId) {
      base = base.filter((r) => r.company_id !== extraCompanyId)
    }

    const q = deferredSearch.trim().toLowerCase()
    if (!q) return base

    return base.filter((r) => {
      const comment = r.comment?.toLowerCase() ?? ''
      const zone = r.zone?.toLowerCase() ?? ''
      const op = operatorName(r.operator_id).toLowerCase()
      const comp = companyName(r.company_id).toLowerCase()
      return comment.includes(q) || zone.includes(q) || op.includes(q) || comp.includes(q)
    })
  }, [rows, deferredSearch, operatorName, companyName, hideExtraRows, extraCompanyId])

  // 4) ГРУППИРУЕМ Extra в ОДНУ строку (PS5+VR), не трогая БД
  const displayRows = useMemo(() => {
    if (!extraCompanyId) return filteredRows

    const out: IncomeRow[] = []
    const aggs = new Map<
      string,
      {
        row: IncomeRow
        comments: Set<string>
      }
    >()

    for (const r of filteredRows) {
      if (r.company_id !== extraCompanyId) {
        out.push(r)
        continue
      }

      const key = `${r.date}|${r.shift}|${r.operator_id ?? 'none'}|${r.company_id}`

      const cleanComment = stripExtraSuffix(r.comment ?? '')
      const cmt = cleanComment.length ? cleanComment : ''

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0) // ✅ NEW
      const card = Number(r.card_amount || 0)

      const existing = aggs.get(key)
      if (!existing) {
        const newRow: IncomeRow = {
          id: `extra-${key}`,
          date: r.date,
          company_id: r.company_id,
          operator_id: r.operator_id,
          shift: r.shift,
          zone: 'Extra',
          cash_amount: cash,
          kaspi_amount: kaspi,
          online_amount: online, // ✅ NEW
          card_amount: card,
          comment: cmt || null,
        }

        const comments = new Set<string>()
        if (cmt) comments.add(cmt)

        aggs.set(key, { row: newRow, comments })
        out.push(newRow)
      } else {
        existing.row.cash_amount = Number(existing.row.cash_amount || 0) + cash
        existing.row.kaspi_amount = Number(existing.row.kaspi_amount || 0) + kaspi
        existing.row.online_amount = Number(existing.row.online_amount || 0) + online // ✅ NEW
        existing.row.card_amount = Number(existing.row.card_amount || 0) + card

        if (cmt) existing.comments.add(cmt)

        const merged = Array.from(existing.comments).filter(Boolean)
        existing.row.comment = merged.length ? merged.join(' | ') : null
      }
    }

    return out
  }, [filteredRows, extraCompanyId])

  // Итоги + аналитика
  const analytics = useMemo(() => {
    let cash = 0
    let kaspi = 0
    let online = 0
    let card = 0
    let dayTotal = 0
    let nightTotal = 0

    const byOperator: Record<string, number> = {}
    const byZone: Record<string, number> = {}

    for (const r of displayRows) {
      if (companyFilter === 'all' && !includeExtraInTotals && isExtraRow(r)) continue

      const rowCash = Number(r.cash_amount || 0)
      const rowKaspi = Number(r.kaspi_amount || 0)
      const rowOnline = Number(r.online_amount || 0) // ✅ NEW
      const rowCard = Number(r.card_amount || 0)
      const rowTotal = rowCash + rowKaspi + rowOnline + rowCard

      cash += rowCash
      kaspi += rowKaspi
      online += rowOnline
      card += rowCard

      if (r.shift === 'day') dayTotal += rowTotal
      else nightTotal += rowTotal

      const opKey = operatorName(r.operator_id)
      byOperator[opKey] = (byOperator[opKey] || 0) + rowTotal

      const z = (r.zone || '—').trim() || '—'
      byZone[z] = (byZone[z] || 0) + rowTotal
    }

    const total = cash + kaspi + online + card
    const avg = displayRows.length ? Math.round(total / displayRows.length) : 0

    const topOperator = Object.entries(byOperator).sort((a, b) => b[1] - a[1])[0] || ['—', 0]
    const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    return {
      cash,
      kaspi,
      online,
      card,
      total,
      avg,
      dayTotal,
      nightTotal,
      topOperatorName: topOperator[0],
      topOperatorAmount: topOperator[1],
      topZoneName: topZone[0],
      topZoneAmount: topZone[1],
    }
  }, [displayRows, companyFilter, includeExtraInTotals, isExtraRow, operatorName])

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

  const resetFilters = () => {
    const t = todayISO()
    setDateFrom(t)
    setDateTo(t)
    setActivePreset('today')
    setCompanyFilter('all')
    setOperatorFilter('all')
    setShiftFilter('all')
    setPayFilter('all')
    setSearchTerm('')
    setIncludeExtraInTotals(false)
    setHideExtraRows(false)
  }

  // Экспорт (то, что видно в таблице)
  const downloadCSV = () => {
    const SEP = ';'

    const headers = [
      'Дата',
      'Компания',
      'Оператор',
      'Смена',
      'Зона',
      'Cash',
      'Kaspi POS',
      'Kaspi Online',
      'Card',
      'Итого',
      'Комментарий',
    ]

    const exportRows = displayRows.filter((r) => {
      if (companyFilter === 'all' && !includeExtraInTotals && isExtraRow(r)) return false
      return true
    })

    const csvContent = [
      headers.join(SEP),
      ...exportRows.map((r) => {
        const total = (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0)
        return [
          escapeCSV(r.date, SEP),
          escapeCSV(companyName(r.company_id), SEP),
          escapeCSV(operatorName(r.operator_id), SEP),
          escapeCSV(r.shift, SEP),
          escapeCSV(r.zone ?? '', SEP),
          escapeCSV(r.cash_amount ?? 0, SEP),
          escapeCSV(r.kaspi_amount ?? 0, SEP),
          escapeCSV(r.online_amount ?? 0, SEP),
          escapeCSV(r.card_amount ?? 0, SEP),
          escapeCSV(total, SEP),
          escapeCSV(r.comment ?? '', SEP),
        ].join(SEP)
      }),
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `incomes_${toISODateLocal(new Date())}.csv`
    link.click()
  }

  const periodLabel = dateFrom || dateTo ? `${formatIsoToRu(dateFrom)} — ${formatIsoToRu(dateTo)}` : 'Весь период'

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Шапка */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Журнал доходов</h1>
              <p className="text-muted-foreground mt-1 text-sm">История операций и анализ по фильтрам</p>
            </div>

            <div className="flex gap-2">
              <Link href="/income/analytics">
                <Button variant="outline" size="sm" className="gap-2 text-xs border-accent/30 hover:bg-accent/5">
                  <TrendingUp className="w-4 h-4" /> Аналитика
                </Button>
              </Link>

              <Button variant="outline" size="sm" onClick={resetFilters} className="gap-2 text-xs" title="Сбросить фильтры">
                <X className="w-4 h-4" /> Сброс
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={downloadCSV}
                disabled={displayRows.length === 0}
                className="gap-2 text-xs"
              >
                <Download className="w-4 h-4" /> Экспорт
              </Button>

              <Link href="/income/add">
                <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2 text-xs">
                  <Plus className="w-4 h-4" /> Добавить
                </Button>
              </Link>
            </div>
          </div>

          {/* KPI */}
          <Card className="p-4 border-border bg-card/70 neon-glow space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Banknote className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">Наличные</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.cash)} ₸</div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Smartphone className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">Kaspi POS</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.kaspi)} ₸</div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Smartphone className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">Kaspi Online</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.online)} ₸</div>
              </Card>

              <Card className="p-4 border-border bg-background/40 flex flex-col justify-center">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CreditCard className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wide">Карта</span>
                </div>
                <div className="text-xl font-bold text-foreground">{formatMoney(analytics.card)} ₸</div>
              </Card>

              <Card className="p-4 border border-accent/60 bg-accent/10 flex flex-col justify-center relative overflow-hidden">
                <div className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wider">Всего по фильтру</div>
                <div className="text-2xl font-bold text-accent">{formatMoney(analytics.total)} ₸</div>

                <div className="mt-1 text-[10px] text-muted-foreground flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                      includeExtraInTotals ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted-foreground'
                    } cursor-pointer select-none`}
                    onClick={() => setIncludeExtraInTotals((v) => !v)}
                    title="Влияет на итоги/экспорт"
                  >
                    <span className={`h-2 w-2 rounded-full ${includeExtraInTotals ? 'bg-accent' : 'bg-muted-foreground/40'}`} />
                    Extra в итогах
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                      hideExtraRows ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10' : 'border-border text-muted-foreground'
                    } cursor-pointer select-none`}
                    onClick={() => setHideExtraRows((v) => !v)}
                    title="Скрывает строки Extra"
                  >
                    <span className={`h-2 w-2 rounded-full ${hideExtraRows ? 'bg-yellow-500' : 'bg-muted-foreground/40'}`} />
                    Скрыть Extra
                  </span>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                <span className="uppercase tracking-wide">Период:</span>
                <span className="font-mono">{periodLabel}</span>
              </div>
              <div>
                Записей: <span className="font-semibold">{displayRows.length}</span>
                {analytics.total > 0 && (
                  <>
                    {' '}
                    • Средний чек: <span className="font-semibold">{formatMoney(analytics.avg)} ₸</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Trophy className="w-4 h-4" />
                  Топ оператор
                </div>
                <div className="text-xs">
                  <span className="text-foreground font-semibold">{analytics.topOperatorName}</span>{' '}
                  <span className="text-muted-foreground">•</span>{' '}
                  <span className="text-accent font-bold">{formatMoney(analytics.topOperatorAmount)} ₸</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="w-4 h-4" />
                  Топ зона
                </div>
                <div className="text-xs">
                  <span className="text-foreground font-semibold">{analytics.topZoneName}</span>{' '}
                  <span className="text-muted-foreground">•</span>{' '}
                  <span className="text-accent font-bold">{formatMoney(analytics.topZoneAmount)} ₸</span>
                </div>
              </div>
            </div>

            {hitLimit && (
              <div className="text-[11px] text-yellow-500/90 pt-1">
                Показаны первые {LIMIT} строк (ограничение). Для “Всё за год” лучше добавить пагинацию/серверную агрегацию.
              </div>
            )}
          </Card>

          {/* Фильтры */}
          <Card className="p-4 border-border bg-card neon-glow">
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-end">
              {/* Даты */}
              <div className="flex flex-col gap-2 w-full lg:w-auto">
                <label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Период</label>
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
                          activePreset === p ? 'bg-accent text-accent-foreground' : 'hover:bg-white/10 text-muted-foreground'
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

              {/* Остальные фильтры */}
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
                  <label className="text-[10px] text-muted-foreground">Оператор</label>
                  <select
                    value={operatorFilter}
                    onChange={(e) => setOperatorFilter(e.target.value as OperatorFilter)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground min-w-[150px]"
                  >
                    <option value="all">Все</option>
                    <option value="none">Без оператора</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.short_name || o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Смена</label>
                  <select
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)}
                    className="h-9 bg-input border border-border rounded px-2 text-xs text-foreground"
                  >
                    <option value="all">Все</option>
                    <option value="day">День ☀️</option>
                    <option value="night">Ночь 🌙</option>
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
                    <option value="kaspi">Kaspi POS</option>
                    <option value="online">Kaspi Online</option>
                    <option value="card">Карта</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <label className="text-[10px] text-muted-foreground">Поиск</label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Комментарий / зона / оператор / компания..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full h-9 pl-8 pr-6 bg-input border border-border rounded text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-accent transition-colors"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                        type="button"
                      >
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

          {/* Таблица */}
          <Card className="border-border bg-card neon-glow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-border bg-secondary/40 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-left">Компания</th>
                    <th className="px-4 py-3 text-left">Оператор</th>
                    <th className="px-4 py-3 text-center">Смена</th>
                    <th className="px-4 py-3 text-left">Зона</th>
                    <th className="px-4 py-3 text-right text-green-500">Нал</th>
                    <th className="px-4 py-3 text-right text-blue-500">Kaspi POS</th>
                    <th className="px-4 py-3 text-right text-cyan-400">Online</th>
                    <th className="px-4 py-3 text-right text-purple-500">Карта</th>
                    <th className="px-4 py-3 text-right text-foreground">Всего</th>
                    <th className="px-4 py-3 text-left">Комментарий</th>
                  </tr>
                </thead>

                <tbody className="text-sm">
                  {loading && (
                    <tr>
                      <td colSpan={11} className="px-6 py-10 text-center text-muted-foreground animate-pulse">
                        Загрузка данных...
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    displayRows.map((row, idx) => {
                      const total =
                        (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
                      const company = companyMap.get(row.company_id)
                      const isExtra = isExtraCompany(company)

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-border/40 hover:bg-white/5 transition-colors ${
                            idx % 2 === 0 ? 'bg-card/40' : ''
                          } ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50' : ''}`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">{formatDate(row.date)}</td>

                          <td className="px-4 py-3 font-medium whitespace-nowrap">
                            {company?.name ?? '—'}
                            {isExtra && (
                              <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/30">
                                EXTRA
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <UserCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                              {operatorName(row.operator_id)}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-center">
                            {row.shift === 'day' ? (
                              <Sun className="w-4 h-4 text-yellow-400 inline" />
                            ) : (
                              <Moon className="w-4 h-4 text-blue-400 inline" />
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs text-muted-foreground">{row.zone || '—'}</td>

                          <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                            {row.cash_amount ? formatMoney(row.cash_amount) : '—'}
                          </td>

                          <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                            {row.kaspi_amount ? formatMoney(row.kaspi_amount) : '—'}
                          </td>

                          <td
                            className={`px-4 py-3 text-right font-mono ${
                              row.online_amount ? 'text-foreground' : 'text-muted-foreground/20'
                            }`}
                          >
                            {row.online_amount ? formatMoney(row.online_amount) : '—'}
                          </td>

                          <td className={`px-4 py-3 text-right font-mono ${row.card_amount ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                            {row.card_amount ? formatMoney(row.card_amount) : '—'}
                          </td>

                          <td className="px-4 py-3 text-right font-bold text-accent font-mono bg-accent/5">{formatMoney(total)}</td>

                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate">{row.comment || '—'}</td>
                        </tr>
                      )
                    })}

                  {!loading && !error && displayRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-muted-foreground">
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
