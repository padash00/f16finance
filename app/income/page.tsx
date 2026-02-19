'use client'

import { useEffect, useMemo, useState, useCallback, useDeferredValue, useRef } from 'react'
import type { KeyboardEvent } from 'react'
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
  Check,
  Pencil,
  Wallet,
  Globe,
  Sparkles,
  Calendar,
  ChevronDown,
  ArrowRight,
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
  online_amount: number | null
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
type PayFilter = 'all' | 'cash' | 'kaspi' | 'online' | 'card'
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

const formatMoneyDetailed = (v: number | null | undefined) => 
  (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const formatDate = (value: string) => {
  if (!value) return ''
  const d = parseISODateSafe(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatDateShort = (value: string) => {
  if (!value) return ''
  const d = parseISODateSafe(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
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

// Надёжно определяем Extra
const isExtraCompany = (c?: Company | null) => {
  const code = String(c?.code ?? '').toLowerCase().trim()
  const name = String(c?.name ?? '').toLowerCase().trim()
  return code === 'extra' || name.includes('extra')
}

// Снимаем хвостики " • PS5/VR"
const stripExtraSuffix = (s: string) => s.replace(/\s*•\s*(PS5|VR)\s*$/i, '').trim()

// Парсер: возвращает null только для пустой строки
const parseMoneyInput = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

// Цвета для способов оплаты
const PAYMENT_COLORS = {
  cash: '#f59e0b',
  kaspi: '#2563eb',
  card: '#7c3aed',
  online: '#ec4899',
}

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
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm)

  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [hideExtraRows, setHideExtraRows] = useState(false)

  // Inline edit: Online
  const [editingOnlineId, setEditingOnlineId] = useState<string | null>(null)
  const [onlineDraft, setOnlineDraft] = useState<string>('')
  const [savingOnlineId, setSavingOnlineId] = useState<string | null>(null)
  
  const skipBlurSaveRef = useRef(false)

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
      if (payFilter === 'online') query = query.gt('online_amount', 0)
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
      const online = Number(r.online_amount || 0)
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
          online_amount: online,
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
        existing.row.online_amount = Number(existing.row.online_amount || 0) + online
        existing.row.card_amount = Number(existing.row.card_amount || 0) + card

        if (cmt) existing.comments.add(cmt)

        const merged = Array.from(existing.comments).filter(Boolean)
        existing.row.comment = merged.length ? merged.join(' | ') : null
      }
    }

    return out
  }, [filteredRows, extraCompanyId])

  // ✅ ИСПРАВЛЕННОЕ сохранение Online в Supabase
  const saveOnlineAmount = useCallback(async (row: IncomeRow, nextValue: number | null) => {
    if (String(row.id).startsWith('extra-')) return

    setSavingOnlineId(row.id)

    const current = rows.find((x) => x.id === row.id)
    const prev = current?.online_amount ?? null

    if (prev === (nextValue ?? null)) {
      setSavingOnlineId(null)
      return
    }

    setRows((curr) => curr.map((x) => (x.id === row.id ? { ...x, online_amount: nextValue } : x)))

    const { error } = await supabase.from('incomes').update({ online_amount: nextValue }).eq('id', row.id)

    if (error) {
      console.error('Update online_amount error:', error)
      setRows((curr) => curr.map((x) => (x.id === row.id ? { ...x, online_amount: prev } : x)))
      setError('Не удалось сохранить Online. Проверьте соединение/права.')
    }

    setSavingOnlineId(null)
  }, [rows])

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
    const byPayment: Record<string, number> = {
      cash: 0,
      kaspi: 0,
      online: 0,
      card: 0,
    }

    for (const r of displayRows) {
      if (companyFilter === 'all' && !includeExtraInTotals && isExtraRow(r)) continue

      const rowCash = Number(r.cash_amount || 0)
      const rowKaspi = Number(r.kaspi_amount || 0)
      const rowOnline = Number(r.online_amount || 0)
      const rowCard = Number(r.card_amount || 0)
      const rowTotal = rowCash + rowKaspi + rowOnline + rowCard

      cash += rowCash
      kaspi += rowKaspi
      online += rowOnline
      card += rowCard

      byPayment.cash += rowCash
      byPayment.kaspi += rowKaspi
      byPayment.online += rowOnline
      byPayment.card += rowCard

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
      byPayment,
      onlineShare: total > 0 ? (online / total) * 100 : 0,
      cashlessShare: total > 0 ? ((kaspi + card + online) / total) * 100 : 0,
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
    setIsCalendarOpen(false)
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

  // Экспорт
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

  const periodLabel = dateFrom || dateTo ? `${formatDateShort(dateFrom)} — ${formatDateShort(dateTo)}` : 'Весь период'

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
          {/* Шапка */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/20 rounded-xl">
                  <Wallet className="w-8 h-8 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Журнал доходов
                  </h1>
                  <p className="text-gray-400 text-sm mt-1">История операций и аналитика</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href="/income/analytics">
                  <Button variant="outline" size="sm" className="gap-2 border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                    <TrendingUp className="w-4 h-4" /> Аналитика
                  </Button>
                </Link>

                <Button variant="outline" size="sm" onClick={resetFilters} className="gap-2 border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                  <X className="w-4 h-4" /> Сброс
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadCSV}
                  disabled={displayRows.length === 0}
                  className="gap-2 border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
                >
                  <Download className="w-4 h-4" /> Экспорт
                </Button>

                <Link href="/income/add">
                  <Button size="sm" className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25 gap-2">
                    <Plus className="w-4 h-4" /> Добавить
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Banknote className="w-4 h-4 text-amber-500" />
                <span className="text-xs uppercase tracking-wide">Наличные</span>
              </div>
              <div className="text-xl font-bold text-white">{formatMoneyDetailed(analytics.cash)} ₸</div>
            </Card>

            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Smartphone className="w-4 h-4 text-blue-500" />
                <span className="text-xs uppercase tracking-wide">Kaspi POS</span>
              </div>
              <div className="text-xl font-bold text-white">{formatMoneyDetailed(analytics.kaspi)} ₸</div>
            </Card>

            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Globe className="w-4 h-4 text-pink-500" />
                <span className="text-xs uppercase tracking-wide">Kaspi Online</span>
              </div>
              <div className="text-xl font-bold text-white">{formatMoneyDetailed(analytics.online)} ₸</div>
            </Card>

            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <CreditCard className="w-4 h-4 text-purple-500" />
                <span className="text-xs uppercase tracking-wide">Карта</span>
              </div>
              <div className="text-xl font-bold text-white">{formatMoneyDetailed(analytics.card)} ₸</div>
            </Card>

            <Card className="p-4 border-0 bg-gradient-to-br from-purple-900/30 to-indigo-900/30 backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase text-purple-300 tracking-wide">Всего по фильтру</span>
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
                {formatMoneyDetailed(analytics.total)} ₸
              </div>
              
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setIncludeExtraInTotals((v) => !v)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                    includeExtraInTotals 
                      ? 'bg-purple-500/20 border-purple-500/30 text-purple-300' 
                      : 'bg-gray-800 border-gray-700 text-gray-500'
                  }`}
                >
                  Extra в итогах
                </button>
                <button
                  onClick={() => setHideExtraRows((v) => !v)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                    hideExtraRows 
                      ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300' 
                      : 'bg-gray-800 border-gray-700 text-gray-500'
                  }`}
                >
                  Скрыть Extra
                </button>
              </div>
            </Card>
          </div>

          {/* Дополнительная аналитика */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Trophy className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <div className="text-xs text-gray-500">Топ оператор</div>
                  <div className="text-sm font-semibold text-white">{analytics.topOperatorName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-amber-400">{formatMoneyDetailed(analytics.topOperatorAmount)}</div>
              </div>
            </Card>

            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <MapPin className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-xs text-gray-500">Топ зона</div>
                  <div className="text-sm font-semibold text-white">{analytics.topZoneName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-blue-400">{formatMoneyDetailed(analytics.topZoneAmount)}</div>
              </div>
            </Card>

            <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">Структура оплат</span>
                <span className="text-xs text-purple-400">Online: {analytics.onlineShare.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                <div className="h-full bg-amber-500" style={{ width: `${analytics.cash > 0 ? (analytics.cash / analytics.total) * 100 : 0}%` }} />
                <div className="h-full bg-blue-500" style={{ width: `${analytics.kaspi > 0 ? (analytics.kaspi / analytics.total) * 100 : 0}%` }} />
                <div className="h-full bg-pink-500" style={{ width: `${analytics.online > 0 ? (analytics.online / analytics.total) * 100 : 0}%` }} />
                <div className="h-full bg-purple-500" style={{ width: `${analytics.card > 0 ? (analytics.card / analytics.total) * 100 : 0}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[10px] text-gray-500">
                <span className="text-amber-500">Нал</span>
                <span className="text-blue-500">Kaspi</span>
                <span className="text-pink-500">Online</span>
                <span className="text-purple-500">Карта</span>
              </div>
            </Card>
          </div>

          {/* Фильтры */}
          <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
            <div className="flex flex-col lg:flex-row gap-4 lg:items-end justify-between">
              {/* Период с календарем */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase tracking-wider">Период</label>
                <div className="relative">
                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:border-purple-500/50 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-purple-400" />
                    <span>{periodLabel}</span>
                    <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isCalendarOpen && (
                    <div className="absolute top-full left-0 mt-2 z-50 w-80 p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl shadow-2xl">
                      <div className="flex flex-wrap gap-2 mb-4">
                        {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => setPreset(p)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                              activePreset === p
                                ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700'
                            }`}
                          >
                            {p === 'today' && 'Сегодня'}
                            {p === 'week' && 'Неделя'}
                            {p === 'month' && '30 дн.'}
                            {p === 'all' && 'Всё'}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">С</label>
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => handleDateFromChange(e.target.value)}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">По</label>
                          <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => handleDateToChange(e.target.value)}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-xs"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end mt-3">
                        <Button 
                          size="sm" 
                          onClick={() => setIsCalendarOpen(false)}
                          className="bg-purple-500 hover:bg-purple-600 text-white"
                        >
                          Применить
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Остальные фильтры */}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase">Компания</label>
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="h-9 bg-gray-900 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none min-w-[130px]"
                  >
                    <option value="all">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase">Оператор</label>
                  <select
                    value={operatorFilter}
                    onChange={(e) => setOperatorFilter(e.target.value as OperatorFilter)}
                    className="h-9 bg-gray-900 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none min-w-[150px]"
                  >
                    <option value="all">Все</option>
                    <option value="none">Без оператора</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id}>{o.short_name || o.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase">Смена</label>
                  <select
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)}
                    className="h-9 bg-gray-900 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none"
                  >
                    <option value="all">Все</option>
                    <option value="day">День ☀️</option>
                    <option value="night">Ночь 🌙</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase">Оплата</label>
                  <select
                    value={payFilter}
                    onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                    className="h-9 bg-gray-900 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none"
                  >
                    <option value="all">Любая</option>
                    <option value="cash">Наличные</option>
                    <option value="kaspi">Kaspi POS</option>
                    <option value="online">Kaspi Online</option>
                    <option value="card">Карта</option>
                  </select>
                </div>

                <div className="space-y-1 flex-1 min-w-[200px]">
                  <label className="text-[10px] text-gray-500 uppercase">Поиск</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Комментарий, зона, оператор..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full h-9 pl-10 pr-8 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 placeholder:text-gray-600 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {hitLimit && (
              <div className="mt-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Показаны первые {LIMIT} строк. Для больших периодов используйте фильтры.
              </div>
            )}
          </Card>

          {error && (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Таблица */}
          <Card className="border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-900/50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-left">Компания</th>
                    <th className="px-4 py-3 text-left">Оператор</th>
                    <th className="px-4 py-3 text-center">Смена</th>
                    <th className="px-4 py-3 text-left">Зона</th>
                    <th className="px-4 py-3 text-right text-amber-500">Нал</th>
                    <th className="px-4 py-3 text-right text-blue-500">Kaspi</th>
                    <th className="px-4 py-3 text-right text-pink-500">Online</th>
                    <th className="px-4 py-3 text-right text-purple-500">Карта</th>
                    <th className="px-4 py-3 text-right text-white">Всего</th>
                    <th className="px-4 py-3 text-left">Комментарий</th>
                  </tr>
                </thead>

                <tbody className="text-sm">
                  {loading && (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <div className="relative inline-block">
                          <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500/30 border-t-purple-500" />
                          <Wallet className="w-6 h-6 text-purple-400 absolute top-3 left-3" />
                        </div>
                        <p className="text-gray-400 mt-4">Загрузка данных...</p>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    displayRows.map((row, idx) => {
                      const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
                      const company = companyMap.get(row.company_id)
                      const isExtra = isExtraCompany(company)

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-gray-800/50 hover:bg-white/5 transition-colors ${
                            idx % 2 === 0 ? 'bg-transparent' : 'bg-gray-900/20'
                          } ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/30' : ''}`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-gray-400 font-mono text-xs">
                            {formatDate(row.date)}
                          </td>

                          <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-300">
                            {company?.name ?? '—'}
                            {isExtra && (
                              <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">
                                EXTRA
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 text-gray-400">
                              <UserCircle2 className="w-3.5 h-3.5" />
                              {operatorName(row.operator_id)}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-center">
                            {row.shift === 'day' ? (
                              <Sun className="w-4 h-4 text-amber-400 inline" />
                            ) : (
                              <Moon className="w-4 h-4 text-blue-400 inline" />
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs text-gray-500">{row.zone || '—'}</td>

                          <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-amber-400' : 'text-gray-700'}`}>
                            {row.cash_amount ? formatMoneyDetailed(row.cash_amount) : '—'}
                          </td>

                          <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-blue-400' : 'text-gray-700'}`}>
                            {row.kaspi_amount ? formatMoneyDetailed(row.kaspi_amount) : '—'}
                          </td>

                          {/* ONLINE: Inline-редактирование */}
                          <td className="px-4 py-3 text-right font-mono">
                            {String(row.id).startsWith('extra-') ? (
                              <span className={row.online_amount === null ? 'text-gray-700' : 'text-pink-400'}>
                                {row.online_amount === null ? '—' : formatMoneyDetailed(row.online_amount)}
                              </span>
                            ) : editingOnlineId === row.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  autoFocus
                                  inputMode="numeric"
                                  value={onlineDraft}
                                  onChange={(e) => setOnlineDraft(e.target.value)}
                                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === 'Escape') {
                                      skipBlurSaveRef.current = true
                                      setEditingOnlineId(null)
                                      setOnlineDraft('')
                                      return
                                    }
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const val = parseMoneyInput(onlineDraft)
                                      setEditingOnlineId(null)
                                      setOnlineDraft('')
                                      saveOnlineAmount(row, val)
                                    }
                                  }}
                                  onBlur={() => {
                                    if (skipBlurSaveRef.current) {
                                      skipBlurSaveRef.current = false
                                      return
                                    }
                                    const val = parseMoneyInput(onlineDraft)
                                    setEditingOnlineId(null)
                                    setOnlineDraft('')
                                    saveOnlineAmount(row, val)
                                  }}
                                  className="w-[90px] h-7 text-right px-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
                                />
                                <button
                                  type="button"
                                  disabled={savingOnlineId === row.id}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    skipBlurSaveRef.current = true
                                  }}
                                  onClick={() => {
                                    const val = parseMoneyInput(onlineDraft)
                                    setEditingOnlineId(null)
                                    setOnlineDraft('')
                                    saveOnlineAmount(row, val)
                                  }}
                                  className="p-1 text-green-400 hover:bg-green-500/10 rounded transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    skipBlurSaveRef.current = true
                                  }}
                                  onClick={() => {
                                    setEditingOnlineId(null)
                                    setOnlineDraft('')
                                  }}
                                  className="p-1 text-gray-500 hover:bg-gray-800 rounded transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={`w-full text-right inline-flex items-center justify-end gap-1 group/btn ${
                                  savingOnlineId === row.id
                                    ? 'text-gray-500 animate-pulse'
                                    : row.online_amount === null
                                      ? 'text-gray-700'
                                      : 'text-pink-400'
                                } hover:bg-pink-500/10 rounded-lg px-2 py-1 -mx-2 transition-colors`}
                                onClick={() => {
                                  setEditingOnlineId(row.id)
                                  setOnlineDraft(String(row.online_amount ?? ''))
                                  skipBlurSaveRef.current = false
                                }}
                                disabled={savingOnlineId === row.id}
                              >
                                <span className="font-mono">
                                  {row.online_amount === null ? '—' : formatMoneyDetailed(row.online_amount)}
                                </span>
                                <Pencil className="w-3 h-3 opacity-0 group-hover/btn:opacity-50 text-gray-500 transition-opacity" />
                              </button>
                            )}
                          </td>

                          <td className={`px-4 py-3 text-right font-mono ${row.card_amount ? 'text-purple-400' : 'text-gray-700'}`}>
                            {row.card_amount ? formatMoneyDetailed(row.card_amount) : '—'}
                          </td>

                          <td className="px-4 py-3 text-right font-bold text-white font-mono bg-purple-500/10">
                            {formatMoneyDetailed(total)}
                                                      </td>

                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={row.comment || ''}>
                            {row.comment || '—'}
                          </td>
                        </tr>
                      )
                    })}

                  {!loading && displayRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="p-4 bg-gray-800/50 rounded-full">
                            <Search className="w-8 h-8 text-gray-600" />
                          </div>
                          <div className="text-gray-500">
                            <p className="font-medium">Ничего не найдено</p>
                            <p className="text-sm mt-1">Попробуйте изменить фильтры или период</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={resetFilters}
                            className="mt-2 border-gray-700 text-gray-400 hover:text-white"
                          >
                            Сбросить фильтры
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {!loading && displayRows.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-700 bg-gray-900/30 flex items-center justify-between text-xs text-gray-500">
                <span>
                  Показано {displayRows.length} из {rows.length} записей
                </span>
                <span>
                  {formatMoneyDetailed(analytics.total)} ₸ всего
                </span>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}
                         
