'use client'

import { useEffect, useMemo, useState, useCallback, useDeferredValue, useRef } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import type { KeyboardEvent } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Download,
  Sun,
  Moon,
  Banknote,
  CreditCard,
  Smartphone,
  Search,
  X,
  UserCircle2,
  Trophy,
  MapPin,
  TrendingUp,
  TrendingDown,
  Check,
  Pencil,
  Wallet,
  Globe,
  Sparkles,
  Calendar,
  ChevronDown,
  Brain,
  Activity,
  AlertTriangle,
  Target,
  Zap,
  Clock,
  LineChart,
  BarChart2,
  ArrowRight,
  MinusIcon,
  Filter,
  Building2,
  Users,
  CreditCard as CardIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useIncome } from '@/hooks/use-income'
import { useCompanies } from '@/hooks/use-companies'
import { useOperators } from '@/hooks/use-operators'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
  Bar,
  BarChart,
  Cell,
  PieChart as RePieChart,
  Pie,
} from 'recharts'

import type { Company, DateRangePreset, SessionRoleInfo } from '@/lib/core/types'

// --- Типы ---
type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift | null
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type ShiftFilter = 'all' | Shift
type PayFilter = 'all' | 'cash' | 'kaspi' | 'online' | 'card'
type OperatorFilter = 'all' | 'none' | string

type ChartPoint = {
  date: string
  cash: number
  kaspi: number
  online: number
  card: number
  total: number
  formattedDate?: string
  movingAvg?: number
}

type PaymentData = {
  name: string
  value: number
  color: string
  percentage: number
}

// --- Утилиты дат ---
const DateUtils = {
  toISODateLocal: (d: Date): string => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },

  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },

  todayISO: (): string => DateUtils.toISODateLocal(new Date()),

  addDaysISO: (iso: string, diff: number): string => {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },

  formatDate: (iso: string, format: 'short' | 'full' = 'short'): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    
    if (format === 'short') {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },

  getRelativeDay: (iso: string): string => {
    const today = DateUtils.fromISO(DateUtils.todayISO())
    const date = DateUtils.fromISO(iso)
    const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Сегодня'
    if (diffDays === 1) return 'Вчера'
    if (diffDays < 7) return `${diffDays} дня назад`
    return DateUtils.formatDate(iso)
  },

  getDatesInRange: (from: string, to: string): string[] => {
    const dates: string[] = []
    let current = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    
    while (current <= end) {
      dates.push(DateUtils.toISODateLocal(current))
      current.setDate(current.getDate() + 1)
    }
    return dates
  }
}

// --- Форматтеры ---
const Formatters = {
  money: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + ' тыс ₸'
    return v.toLocaleString('ru-RU') + ' ₸'
  },

  moneyDetailed: (v: number): string => 
    v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸',

  tooltip: {
    contentStyle: {
      backgroundColor: '#1e1e2f',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: 12,
      padding: '12px 16px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#a0a0c0', fontSize: 12 },
  } as const
}

const COLORS = {
  cash: '#f59e0b',
  kaspi: '#2563eb',
  card: '#7c3aed',
  online: '#ec4899',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
}

// --- AI Аналитика ---
class IncomeAnalytics {
  static detectTrend(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 3) return 'stable'
    const first = data[0]
    const last = data[data.length - 1]
    const change = ((last - first) / (first || 1)) * 100
    
    if (change > 5) return 'up'
    if (change < -5) return 'down'
    return 'stable'
  }

  static predictNextPeriod(data: ChartPoint[]): { value: number; confidence: number } {
    if (data.length < 7) return { value: 0, confidence: 0 }
    
    const totals = data.map(d => d.total).filter(v => v > 0)
    if (totals.length < 3) return { value: 0, confidence: 0 }
    
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const variance = totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length
    const stdDev = Math.sqrt(variance)
    
    const confidence = Math.max(0, Math.min(100, 100 - (stdDev / avg) * 100))
    
    return {
      value: Math.round(avg * 30),
      confidence: Math.round(confidence * 100) / 100
    }
  }

  static findAnomalies(data: ChartPoint[]): Array<{ date: string; amount: number; type: 'spike' | 'drop' }> {
    const totals = data.map(d => d.total).filter(v => v > 0)
    if (totals.length < 5) return []
    
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const stdDev = Math.sqrt(totals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totals.length)
    
    return data
      .filter(d => d.total > avg + stdDev * 2 || d.total < avg - stdDev * 2)
      .map(d => {
        const type: 'spike' | 'drop' = d.total > avg ? 'spike' : 'drop'
        return {
          date: d.date,
          amount: d.total,
          type,
        }
      })
      .slice(0, 3)
  }
}

// --- Вспомогательные функции ---
const isExtraCompany = (c?: Company | null) => {
  const code = String(c?.code ?? '').toLowerCase().trim()
  const name = String(c?.name ?? '').toLowerCase().trim()
  return code === 'extra' || name.includes('extra')
}

const stripExtraSuffix = (s: string) => s.replace(/\s*•\s*(PS5|VR)\s*$/i, '').trim()

const parseMoneyInput = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

async function logIncomeEvent(event: {
  entityType?: 'income' | 'income-export'
  entityId: string
  action: string
  payload?: Record<string, unknown>
}) {
  await fetch('/api/admin/audit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entityType: event.entityType || 'income',
      entityId: event.entityId,
      action: event.action,
      payload: event.payload || null,
    }),
  }).catch(() => null)
}

// --- Главный компонент ---
export default function IncomePage() {
  // Фильтры (объявляем до хуков — они передаются в useIncome)
  const [dateFrom, setDateFrom] = useState(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm)
  
  // Дополнительные настройки
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [hideExtraRows, setHideExtraRows] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'feed'>('overview')

  // Показ/скрытие фильтров
  const [showFilters, setShowFilters] = useState(false)

  // Inline edit
  const [editingOnlineId, setEditingOnlineId] = useState<string | null>(null)
  const [onlineDraft, setOnlineDraft] = useState<string>('')
  const [savingOnlineId, setSavingOnlineId] = useState<string | null>(null)
  const skipBlurSaveRef = useRef(false)
  const [sessionRole, setSessionRole] = useState<SessionRoleInfo | null>(null)
  const [editingIncome, setEditingIncome] = useState<IncomeRow | null>(null)
  const [editIncomeDate, setEditIncomeDate] = useState('')
  const [editIncomeOperatorId, setEditIncomeOperatorId] = useState<string>('none')
  const [editCashDraft, setEditCashDraft] = useState('')
  const [editKaspiDraft, setEditKaspiDraft] = useState('')
  const [editKaspiBeforeMidnightDraft, setEditKaspiBeforeMidnightDraft] = useState('')
  const [editOnlineDraft, setEditOnlineDraft] = useState('')
  const [editCardDraft, setEditCardDraft] = useState('')
  const [editCommentDraft, setEditCommentDraft] = useState('')
  const [savingIncomeEdit, setSavingIncomeEdit] = useState(false)
  const [deletingIncomeId, setDeletingIncomeId] = useState<string | null>(null)

  // Справочники и данные — через хуки, без прямых Supabase-запросов
  const { companies } = useCompanies()
  const { operators } = useOperators({ activeOnly: true })
  const {
    rows: serverRows,
    loading,
  } = useIncome({
    from: dateFrom,
    to: dateTo,
    companyId: companyFilter !== 'all' ? companyFilter : undefined,
    shift: shiftFilter !== 'all' ? shiftFilter : undefined,
    operatorId: operatorFilter !== 'all' && operatorFilter !== 'none' ? operatorFilter : undefined,
    operatorNull: operatorFilter === 'none',
    payFilter: payFilter !== 'all' ? payFilter : undefined,
  })

  // Локальная копия для оптимистичных обновлений (inline edit, delete)
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(serverRows)
  }, [serverRows])

  useEffect(() => {
    const loadSessionRole = async () => {
      const response = await fetch('/api/auth/session-role', { cache: 'no-store' }).catch(() => null)
      const json = await response?.json().catch(() => null)
      if (response?.ok) {
        setSessionRole({
          isSuperAdmin: json?.isSuperAdmin,
          staffRole: json?.staffRole,
        })
      }
    }
    loadSessionRole()
  }, [])

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    companies.forEach(c => map.set(c.id, c))
    return map
  }, [companies])

  const operatorMap = useMemo(() => {
    const map = new Map<string, Operator>()
    operators.forEach(o => map.set(o.id, o))
    return map
  }, [operators])

  const companyName = useCallback((id: string) => companyMap.get(id)?.name ?? '—', [companyMap])
  
  const operatorName = useCallback((id: string | null) => {
    if (!id) return 'Без оператора'
    const op = operatorMap.get(id)
    return op?.short_name || op?.name || 'Без оператора'
  }, [operatorMap])

  const extraCompanyId = useMemo(() => {
    const extra = companies.find(c => isExtraCompany(c))
    return extra?.id ?? null
  }, [companies])

  const isExtraRow = useCallback((r: IncomeRow) => !!extraCompanyId && r.company_id === extraCompanyId, [extraCompanyId])
  const canCreateIncome =
    !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner' || sessionRole?.staffRole === 'manager'
  const canManageIncome = !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner'


  // Фильтрация и агрегация
  const filteredRows = useMemo(() => {
    let base = rows
    if (hideExtraRows && extraCompanyId) {
      base = base.filter(r => r.company_id !== extraCompanyId)
    }

    const q = deferredSearch.trim().toLowerCase()
    if (!q) return base

    return base.filter(r => {
      const comment = r.comment?.toLowerCase() ?? ''
      const zone = r.zone?.toLowerCase() ?? ''
      const op = operatorName(r.operator_id).toLowerCase()
      const comp = companyName(r.company_id).toLowerCase()
      return comment.includes(q) || zone.includes(q) || op.includes(q) || comp.includes(q)
    })
  }, [rows, deferredSearch, operatorName, companyName, hideExtraRows, extraCompanyId])

  // Группировка Extra
  const displayRows = useMemo(() => {
    if (!extraCompanyId) return filteredRows

    const out: IncomeRow[] = []
    const aggs = new Map<string, { row: IncomeRow; comments: Set<string> }>()

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
          kaspi_before_midnight: null,
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

  // Для операций и ручного редактирования показываем реальные строки,
  // чтобы Extra можно было менять так же, как Arena и Ramen.
  const operationRows = useMemo(() => filteredRows, [filteredRows])

  // Аналитика
  const analytics = useMemo(() => {
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)
    const chartMap = new Map<string, ChartPoint>()
    
    dates.forEach(date => {
      chartMap.set(date, {
        date,
        cash: 0,
        kaspi: 0,
        online: 0,
        card: 0,
        total: 0,
        formattedDate: DateUtils.formatDate(date)
      })
    })

    let totalCash = 0, totalKaspi = 0, totalOnline = 0, totalCard = 0
    let dayTotal = 0, nightTotal = 0
    const byOperator: Record<string, number> = {}
    const byZone: Record<string, number> = {}

    displayRows.forEach(r => {
      if (!includeExtraInTotals && isExtraRow(r)) return

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)
      const rowTotal = cash + kaspi + online + card

      totalCash += cash
      totalKaspi += kaspi
      totalOnline += online
      totalCard += card

      if (r.shift === 'day') dayTotal += rowTotal
      else nightTotal += rowTotal

      const opKey = operatorName(r.operator_id)
      byOperator[opKey] = (byOperator[opKey] || 0) + rowTotal

      const z = (r.zone || '—').trim() || '—'
      byZone[z] = (byZone[z] || 0) + rowTotal

      const point = chartMap.get(r.date)
      if (point) {
        point.cash += cash
        point.kaspi += kaspi
        point.online += online
        point.card += card
        point.total += rowTotal
      }
    })

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    
    // Скользящее среднее
    chartData.forEach((point, i) => {
      const start = Math.max(0, i - 6)
      const window = chartData.slice(start, i + 1)
      const avg = window.reduce((sum, p) => sum + p.total, 0) / window.length
      point.movingAvg = avg
    })

    const total = totalCash + totalKaspi + totalOnline + totalCard
    const prediction = IncomeAnalytics.predictNextPeriod(chartData)
    const anomalies = IncomeAnalytics.findAnomalies(chartData)
    const trend = IncomeAnalytics.detectTrend(chartData.map(d => d.total).filter(v => v > 0))

    const topOperator = Object.entries(byOperator).sort((a, b) => b[1] - a[1])[0] || ['—', 0]
    const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    const paymentData: PaymentData[] = [
      { name: 'Наличные', value: totalCash, color: COLORS.cash, percentage: total ? (totalCash / total) * 100 : 0 },
      { name: 'Kaspi POS', value: totalKaspi, color: COLORS.kaspi, percentage: total ? (totalKaspi / total) * 100 : 0 },
      { name: 'Карта', value: totalCard, color: COLORS.card, percentage: total ? (totalCard / total) * 100 : 0 },
      { name: 'Online', value: totalOnline, color: COLORS.online, percentage: total ? (totalOnline / total) * 100 : 0 },
    ].filter(p => p.value > 0)

    return {
      total,
      cash: totalCash,
      kaspi: totalKaspi,
      online: totalOnline,
      card: totalCard,
      dayTotal,
      nightTotal,
      chartData,
      prediction,
      anomalies,
      trend,
      topOperator,
      topZone,
      paymentData,
      avgCheck: displayRows.length ? total / displayRows.length : 0,
    }
  }, [displayRows, dateFrom, dateTo, includeExtraInTotals, isExtraRow, operatorName])

  // Сохранение Online
  const saveOnlineAmount = useCallback(async (row: IncomeRow, nextValue: number | null) => {
    if (String(row.id).startsWith('extra-')) return
    setSavingOnlineId(row.id)
    const current = rows.find(x => x.id === row.id)
    const prev = current?.online_amount ?? null

    if (prev === (nextValue ?? null)) {
      setSavingOnlineId(null)
      return
    }

    setRows(curr => curr.map(x => x.id === row.id ? { ...x, online_amount: nextValue } : x))
    const response = await fetch('/api/admin/incomes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateOnlineAmount',
        incomeId: row.id,
        online_amount: nextValue,
      }),
    })
    const json = await response.json().catch(() => null)

    if (!response.ok) {
      setRows(curr => curr.map(x => x.id === row.id ? { ...x, online_amount: prev } : x))
      setError(json?.error || 'Не удалось сохранить Online')
      await logIncomeEvent({
        entityId: row.id,
        action: 'update-online-failed',
        payload: { previous: prev, next: nextValue, message: json?.error || `Ошибка запроса (${response.status})` },
      })
    } else {
      await logIncomeEvent({
        entityId: row.id,
        action: 'update-online',
        payload: { previous: prev, next: nextValue, date: row.date, company_id: row.company_id },
      })
    }
    setSavingOnlineId(null)
  }, [rows])

  const openIncomeEditor = useCallback((row: IncomeRow) => {
    setEditingIncome(row)
    setEditIncomeDate(row.date)
    setEditIncomeOperatorId(row.operator_id || 'none')
    setEditCashDraft(String(row.cash_amount ?? 0))
    setEditKaspiDraft(String(row.kaspi_amount ?? 0))
    setEditKaspiBeforeMidnightDraft(row.kaspi_before_midnight != null ? String(row.kaspi_before_midnight) : '')
    setEditOnlineDraft(String(row.online_amount ?? 0))
    setEditCardDraft(String(row.card_amount ?? 0))
    setEditCommentDraft(row.comment || '')
  }, [])

  const closeIncomeEditor = useCallback(() => {
    setEditingIncome(null)
    setEditIncomeDate('')
    setEditIncomeOperatorId('none')
    setEditCashDraft('')
    setEditKaspiDraft('')
    setEditKaspiBeforeMidnightDraft('')
    setEditOnlineDraft('')
    setEditCardDraft('')
    setEditCommentDraft('')
  }, [])

  const saveIncomeEdit = useCallback(async () => {
    if (!editingIncome) return

    setSavingIncomeEdit(true)
    try {
      const kaspiBeforeMidnight = editingIncome?.shift === 'night' && editKaspiBeforeMidnightDraft.trim() !== ''
        ? (parseMoneyInput(editKaspiBeforeMidnightDraft) ?? null)
        : null
      const payload = {
        date: editIncomeDate,
        operator_id: editIncomeOperatorId === 'none' ? null : editIncomeOperatorId,
        cash_amount: parseMoneyInput(editCashDraft) ?? 0,
        kaspi_amount: parseMoneyInput(editKaspiDraft) ?? 0,
        kaspi_before_midnight: kaspiBeforeMidnight,
        online_amount: parseMoneyInput(editOnlineDraft) ?? 0,
        card_amount: parseMoneyInput(editCardDraft) ?? 0,
        comment: editCommentDraft.trim() || null,
      }

      const response = await fetch('/api/admin/incomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateIncome',
          incomeId: editingIncome.id,
          payload,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setRows((curr) => curr.map((item) => (item.id === editingIncome.id ? { ...item, ...json.data } : item)))
      closeIncomeEditor()
    } catch (err: any) {
      setError(err?.message || 'Не удалось обновить доход')
    } finally {
      setSavingIncomeEdit(false)
    }
  }, [
    closeIncomeEditor,
    editCardDraft,
    editCashDraft,
    editCommentDraft,
    editIncomeDate,
    editIncomeOperatorId,
    editKaspiDraft,
    editKaspiBeforeMidnightDraft,
    editOnlineDraft,
    editingIncome,
  ])

  const deleteIncome = useCallback(async (row: IncomeRow) => {
    if (!confirm('Удалить эту запись дохода?')) return

    setDeletingIncomeId(row.id)
    try {
      const response = await fetch('/api/admin/incomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteIncome',
          incomeId: row.id,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)

      setRows((curr) => curr.filter((item) => item.id !== row.id))
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить доход')
    } finally {
      setDeletingIncomeId(null)
    }
  }, [])

  // Пресеты дат
  const setPreset = (preset: DateRangePreset) => {
    const today = DateUtils.todayISO()
    setActivePreset(preset)

    switch (preset) {
      case 'today':
        setDateFrom(today)
        setDateTo(today)
        break
      case 'week':
        setDateFrom(DateUtils.addDaysISO(today, -6))
        setDateTo(today)
        break
      case 'month':
        setDateFrom(DateUtils.addDaysISO(today, -29))
        setDateTo(today)
        break
      case 'all':
        setDateFrom('')
        setDateTo('')
        break
    }
    setIsCalendarOpen(false)
  }

  // Сброс всех фильтров
  const resetFilters = () => {
    setDateFrom(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
    setDateTo(DateUtils.todayISO())
    setActivePreset('month')
    setCompanyFilter('all')
    setOperatorFilter('all')
    setShiftFilter('all')
    setPayFilter('all')
    setSearchTerm('')
    setIncludeExtraInTotals(false)
    setHideExtraRows(false)
  }

  // Экспорт Excel
  const downloadCSV = async () => {
    const wb = createWorkbook()
    const period = dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : DateUtils.todayISO()
    const incRows = displayRows.map(r => ({
      date: r.date,
      company: companyName(r.company_id),
      operator: operatorName(r.operator_id),
      shift: r.shift || '',
      zone: r.zone || '',
      cash: r.cash_amount || 0,
      kaspi: r.kaspi_amount || 0,
      online: r.online_amount || 0,
      card: r.card_amount || 0,
      total: (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0),
      comment: r.comment || '',
    }))
    buildStyledSheet(wb, 'Доходы', 'Доходы', `Период: ${period} | Строк: ${incRows.length}`, [
      { header: 'Дата', key: 'date', width: 12, type: 'text' },
      { header: 'Компания', key: 'company', width: 20, type: 'text' },
      { header: 'Оператор', key: 'operator', width: 20, type: 'text' },
      { header: 'Смена', key: 'shift', width: 10, type: 'text' },
      { header: 'Зона', key: 'zone', width: 10, type: 'text' },
      { header: 'Cash', key: 'cash', width: 14, type: 'money' },
      { header: 'Kaspi POS', key: 'kaspi', width: 14, type: 'money' },
      { header: 'Kaspi Online', key: 'online', width: 14, type: 'money' },
      { header: 'Card', key: 'card', width: 14, type: 'money' },
      { header: 'Итого', key: 'total', width: 16, type: 'money' },
      { header: 'Комментарий', key: 'comment', width: 22, type: 'text' },
    ], incRows)
    await downloadWorkbook(wb, `incomes_${DateUtils.todayISO()}.xlsx`)
    logIncomeEvent({
      entityType: 'income-export',
      entityId: `export:${DateUtils.todayISO()}`,
      action: 'download-xlsx',
      payload: {
        rows: displayRows.length,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        company_filter: companyFilter,
        operator_filter: operatorFilter,
        pay_filter: payFilter,
      },
    })
  }

  const periodLabel = dateFrom && dateTo 
    ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}`
    : 'Весь период'

  // Количество активных фильтров
  const activeFiltersCount = [
    companyFilter !== 'all',
    operatorFilter !== 'all',
    shiftFilter !== 'all',
    payFilter !== 'all',
    searchTerm !== ''
  ].filter(Boolean).length

  if (loading) {
    return (
      <>
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-6" />
              <Wallet className="w-8 h-8 text-purple-400 absolute top-4 left-1/2 transform -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаем финансовые данные...</p>
          </div>
      </>
    )
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          {/* Шапка */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-purple-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Журнал доходов
                    </h1>
                    <p className="text-sm text-gray-400">Умная аналитика и прогнозирование</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Кнопка фильтров */}
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
                      activeFiltersCount > 0
                        ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                        : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-purple-500/50'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Фильтры
                    {activeFiltersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-purple-500 text-white text-xs rounded-full">
                        {activeFiltersCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-purple-500/50 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-purple-400" />
                    <span className="text-gray-300 text-sm">{periodLabel}</span>
                    <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {extraCompanyId && (
                    <button
                      onClick={() => setIncludeExtraInTotals(!includeExtraInTotals)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                        includeExtraInTotals
                          ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                          : 'bg-gray-800/50 border-gray-700 text-gray-400'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-yellow-400' : 'bg-gray-500'}`} />
                      Extra
                    </button>
                  )}

                  <Button variant="outline" size="sm" onClick={downloadCSV} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                    <Download className="w-4 h-4 mr-1" /> Экспорт
                  </Button>

                  {canCreateIncome ? (
                    <Link href="/income/add">
                      <Button size="sm" className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25">
                        <Plus className="w-4 h-4 mr-1" /> Добавить
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>

              {/* Календарь */}
              {isCalendarOpen && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                          activePreset === p
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Все время'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">С</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">По</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-purple-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Панель фильтров */}
              {showFilters && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <Filter className="w-4 h-4 text-purple-400" />
                      Фильтры данных
                    </h3>
                    <div className="flex items-center gap-2">
                      {activeFiltersCount > 0 && (
                        <button
                          onClick={resetFilters}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                          <X className="w-3 h-3" />
                          Сбросить все
                        </button>
                      )}
                      <button
                        onClick={() => setShowFilters(false)}
                        className="text-gray-400 hover:text-white"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Фильтр компании */}
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Компания
                      </label>
                      <select
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-sm"
                      >
                        <option value="all">Все компании</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Фильтр оператора */}
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Оператор
                      </label>
                      <select
                        value={operatorFilter}
                        onChange={(e) => setOperatorFilter(e.target.value as OperatorFilter)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-sm"
                      >
                        <option value="all">Все операторы</option>
                        <option value="none">Без оператора</option>
                        {operators.map(o => (
                          <option key={o.id} value={o.id}>{o.short_name || o.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Фильтр смены */}
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Смена
                      </label>
                      <select
                        value={shiftFilter}
                        onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-sm"
                      >
                        <option value="all">Все смены</option>
                        <option value="day">День (утро)</option>
                        <option value="night">Ночь</option>
                      </select>
                    </div>

                    {/* Фильтр способа оплаты */}
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <CardIcon className="w-3 h-3" />
                        Способ оплаты
                      </label>
                      <select
                        value={payFilter}
                        onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-sm"
                      >
                        <option value="all">Любая оплата</option>
                        <option value="cash">Наличные 💵</option>
                        <option value="kaspi">Kaspi POS 📱</option>
                        <option value="online">Kaspi Online 🌐</option>
                        <option value="card">Карта 💳</option>
                      </select>
                    </div>
                  </div>

                  {/* Поиск и дополнительные опции */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-800">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Search className="w-3 h-3" />
                        Поиск по комментарию, зоне, оператору
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Введите текст для поиска..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full bg-gray-800 text-white pl-10 pr-4 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none text-sm"
                        />
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                        {searchTerm && (
                          <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {extraCompanyId && (
                      <div className="flex items-end">
                        <button
                          onClick={() => setHideExtraRows(!hideExtraRows)}
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors w-full md:w-auto ${
                            hideExtraRows
                              ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300'
                          }`}
                        >
                          {hideExtraRows ? <Check className="w-4 h-4" /> : <div className="w-4 h-4 border border-gray-500 rounded" />}
                          Скрыть строки Extra из таблицы
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Активные фильтры */}
                  {activeFiltersCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-800">
                      <span className="text-xs text-gray-500">Активные фильтры:</span>
                      {companyFilter !== 'all' && (
                        <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-lg flex items-center gap-1">
                          Компания: {companyName(companyFilter)}
                          <button onClick={() => setCompanyFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {operatorFilter !== 'all' && (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-lg flex items-center gap-1">
                          Оператор: {operatorFilter === 'none' ? 'Без оператора' : operatorName(operatorFilter)}
                          <button onClick={() => setOperatorFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {shiftFilter !== 'all' && (
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-lg flex items-center gap-1">
                          Смена: {shiftFilter === 'day' ? 'День' : 'Ночь'}
                          <button onClick={() => setShiftFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {payFilter !== 'all' && (
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-lg flex items-center gap-1">
                          Оплата: {payFilter === 'cash' ? 'Наличные' : payFilter === 'kaspi' ? 'Kaspi POS' : payFilter === 'online' ? 'Online' : 'Карта'}
                          <button onClick={() => setPayFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {searchTerm && (
                        <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded-lg flex items-center gap-1">
                          Поиск: "{searchTerm}"
                          <button onClick={() => setSearchTerm('')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Date presets — always visible */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  activePreset === p
                    ? 'bg-purple-500 text-white shadow-sm shadow-purple-500/30'
                    : 'bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : p === 'month' ? '30 дней' : 'Все время'}
              </button>
            ))}
            {activePreset !== 'today' && activePreset !== 'week' && activePreset !== 'month' && activePreset !== 'all' && (
              <span className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700/50 rounded-lg">
                {dateFrom && dateTo ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}` : 'Весь период'}
              </span>
            )}
          </div>

          {/* Табы навигации */}
          <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
            <TabButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<LineChart className="w-4 h-4" />} label="Аналитика" />
            <TabButton active={activeTab === 'feed'} onClick={() => setActiveTab('feed')} icon={<Clock className="w-4 h-4" />} label="Операции" />
          </div>

          {/* Контент табов */}
            {activeTab === 'overview' && (
              <OverviewTab 
                analytics={analytics} 
                displayRows={operationRows}
                companyName={companyName}
                operatorName={operatorName}
                isExtraRow={isExtraRow}
              canManageIncome={canManageIncome}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsTab 
              analytics={analytics}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

            {activeTab === 'feed' && (
              <FeedTab 
                displayRows={operationRows}
                companyName={companyName}
                operatorName={operatorName}
                isExtraRow={isExtraRow}
              canManageIncome={canManageIncome}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
              openIncomeEditor={openIncomeEditor}
              deleteIncome={deleteIncome}
              deletingIncomeId={deletingIncomeId}
            />
          )}

          {editingIncome && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
              <Card className="w-full max-w-2xl border-white/10 bg-gray-900 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Редактирование дохода</h3>
                    <p className="text-sm text-gray-400">Эту операцию может выполнить только владелец или супер-админ</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={closeIncomeEditor}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Дата</span>
                    <input
                      type="date"
                      value={editIncomeDate}
                      onChange={(e) => setEditIncomeDate(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Оператор</span>
                    <select
                      value={editIncomeOperatorId}
                      onChange={(e) => setEditIncomeOperatorId(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40"
                    >
                      <option value="none">Без оператора</option>
                      {operators.map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.short_name || operator.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Наличные</span>
                    <input value={editCashDraft} onChange={(e) => setEditCashDraft(e.target.value)} className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Kaspi POS</span>
                    <input value={editKaspiDraft} onChange={(e) => setEditKaspiDraft(e.target.value)} className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40" />
                  </label>

                  {editingIncome?.shift === 'night' && (
                    <label className="space-y-2 text-sm text-gray-300 md:col-span-2">
                      <span className="flex items-center gap-2">
                        Kaspi до 00:00
                        <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300">только для ночных смен</span>
                      </span>
                      <input
                        value={editKaspiBeforeMidnightDraft}
                        onChange={(e) => setEditKaspiBeforeMidnightDraft(e.target.value)}
                        placeholder="Из кабинета Kaspi for Business — сколько Kaspi пришло до полуночи"
                        className="w-full rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-white outline-none focus:border-blue-500/40"
                      />
                      <p className="text-xs text-slate-400">Нужно для точного суточного расчёта в ОПиУ. Если не знаете — оставьте пустым.</p>
                    </label>
                  )}

                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Online</span>
                    <input value={editOnlineDraft} onChange={(e) => setEditOnlineDraft(e.target.value)} className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-gray-300">
                    <span>Карта</span>
                    <input value={editCardDraft} onChange={(e) => setEditCardDraft(e.target.value)} className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-gray-300 md:col-span-2">
                    <span>Комментарий</span>
                    <textarea
                      rows={3}
                      value={editCommentDraft}
                      onChange={(e) => setEditCommentDraft(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-white outline-none focus:border-purple-500/40"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={closeIncomeEditor}>Отмена</Button>
                  <Button onClick={saveIncomeEdit} disabled={savingIncomeEdit}>
                    {savingIncomeEdit ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
    </>
  )
}

// --- Компоненты табов ---

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function OverviewTab({ 
  analytics, 
  displayRows,
  companyName,
  operatorName,
  isExtraRow,
  canManageIncome,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  const trendIcon = analytics.trend === 'up' ? <TrendingUp className="w-4 h-4 text-green-400" /> : 
                   analytics.trend === 'down' ? <TrendingDown className="w-4 h-4 text-red-400" /> : 
                   <MinusIcon className="w-4 h-4 text-gray-400" />

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Общий доход"
          value={analytics.total}
          icon={<Wallet className="w-5 h-5" />}
          color="from-purple-500 to-indigo-500"
          trend={analytics.trend}
        />
        <MetricCard
          label="Наличные"
          value={analytics.cash}
          icon={<Banknote className="w-5 h-5" />}
          color="from-amber-500 to-orange-500"
          percentage={analytics.total ? (analytics.cash / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Kaspi + Карта"
          value={analytics.kaspi + analytics.card}
          icon={<CreditCard className="w-5 h-5" />}
          color="from-blue-500 to-cyan-500"
          percentage={analytics.total ? ((analytics.kaspi + analytics.card) / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Online"
          value={analytics.online}
          icon={<Globe className="w-5 h-5" />}
          color="from-pink-500 to-rose-500"
          percentage={analytics.total ? (analytics.online / analytics.total) * 100 : 0}
        />
      </div>

      {/* График и структура */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-xl">
                <LineChart className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Динамика доходов</h3>
                <p className="text-xs text-gray-500">По дням с скользящим средним</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className={`text-xs ${analytics.trend === 'up' ? 'text-green-400' : analytics.trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
                {analytics.trend === 'up' ? 'Рост' : analytics.trend === 'down' ? 'Снижение' : 'Стабильно'}
              </span>
            </div>
          </div>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.chartData}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" vertical={false} />
                <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip {...Formatters.tooltip} formatter={(val: number) => [Formatters.moneyDetailed(val), '']} />
                <Area type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
                <Line type="monotone" dataKey="movingAvg" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Среднее (7 дней)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <BarChart2 className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Структура оплат</h3>
          </div>
          
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={analytics.paymentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {analytics.paymentData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [Formatters.moneyDetailed(val), '']} contentStyle={Formatters.tooltip.contentStyle} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2">
            {analytics.paymentData.map((p: any) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-gray-400">{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(p.value)}</span>
                  <span className="text-gray-500">({p.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AI Прогноз и Топы */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-0 bg-gradient-to-br from-blue-900/30 via-gray-900 to-purple-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">AI Прогноз</h3>
          </div>
          
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1">Ожидается в следующем месяце</p>
            <p className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              {Formatters.moneyDetailed(analytics.prediction.value)}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Достоверность</span>
                <span className={analytics.prediction.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>
                  {analytics.prediction.confidence}%
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 rounded-full transition-all" style={{ width: `${analytics.prediction.confidence}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ оператор</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1">{analytics.topOperator[0]}</div>
          <div className="text-2xl font-bold text-amber-400">{Formatters.moneyDetailed(analytics.topOperator[1])}</div>
          <p className="text-xs text-gray-500 mt-2">Лучший результат за период</p>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-xl">
              <MapPin className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ зона</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1">{analytics.topZone[0]}</div>
          <div className="text-2xl font-bold text-blue-400">{Formatters.moneyDetailed(analytics.topZone[1])}</div>
          <p className="text-xs text-gray-500 mt-2">Самая прибыльная локация</p>
        </Card>
      </div>

      {/* Последние операции */}
      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <Clock className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Последние операции</h3>
          </div>
        </div>
        
        <div className="space-y-2">
          {displayRows.slice(0, 5).map((row: IncomeRow) => (
            <IncomeRowCompact 
              key={row.id} 
              row={row}
              companyName={companyName(row.company_id)}
              operatorName={operatorName(row.operator_id)}
              isExtra={isExtraRow(row)}
              canManageIncome={canManageIncome}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function MetricCard({ label, value, icon, color, trend, percentage }: any) {
  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm hover:bg-gray-800/80 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color} bg-opacity-20`}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold text-white mb-1">{Formatters.moneyDetailed(value)}</div>
      {percentage !== undefined && (
        <div className="text-xs text-gray-500">{percentage.toFixed(1)}% от общего</div>
      )}
      {trend && (
        <div className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
          {trend === 'up' ? '↗ Рост' : trend === 'down' ? '↘ Снижение' : '→ Стабильно'}
        </div>
      )}
    </Card>
  )
}

function IncomeRowCompact({ 
  row, 
  companyName, 
  operatorName, 
  isExtra,
  canManageIncome,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef
}: any) {
  const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
  
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl transition-all ${
      isExtra ? 'bg-yellow-500/5 border border-yellow-500/20' : 'hover:bg-gray-700/30'
    }`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-2 h-2 rounded-full ${row.shift === 'day' ? 'bg-amber-400' : 'bg-blue-400'}`} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white truncate flex items-center gap-2">
            {companyName}
            {isExtra && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">EXTRA</span>}
          </span>
          <span className="text-xs text-gray-500 truncate">{operatorName} • {row.zone || '—'}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        {row.cash_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</span>}
        {row.kaspi_amount > 0 && <span className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</span>}
        {row.card_amount > 0 && <span className="text-purple-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</span>}
        
        {/* Online с inline редактированием */}
        {String(row.id).startsWith('extra-') ? (
          <span className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</span>
        ) : !canManageIncome ? (
          <span className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</span>
        ) : editingOnlineId === row.id ? (
          <div className="flex items-center gap-1">
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
              className="w-20 h-6 text-right px-1 rounded border border-pink-500 bg-gray-900 text-white text-xs outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingOnlineId(row.id)
              setOnlineDraft(String(row.online_amount ?? ''))
            }}
            className={`font-mono hover:bg-pink-500/10 rounded px-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-gray-600'}`}
          >
            {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+'}
          </button>
        )}

        <span className="text-sm font-bold text-white font-mono min-w-[80px] text-right">{Formatters.moneyDetailed(total)}</span>
      </div>
    </div>
  )
}

function AnalyticsTab({ analytics, dateFrom, dateTo }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">По способам оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.paymentData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip formatter={(val: number) => Formatters.moneyDetailed(val)} contentStyle={Formatters.tooltip.contentStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {analytics.paymentData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Распределение по сменам</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400 flex items-center gap-2"><Sun className="w-4 h-4 text-amber-400" /> День</span>
                <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.dayTotal)}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${analytics.total ? (analytics.dayTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400 flex items-center gap-2"><Moon className="w-4 h-4 text-blue-400" /> Ночь</span>
                <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.nightTotal)}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${analytics.total ? (analytics.nightTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t border-gray-700">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Средний чек</span>
              <span className="text-white font-medium">{Formatters.moneyDetailed(analytics.avgCheck)}</span>
            </div>
          </div>
        </Card>
      </div>

      {analytics.anomalies.length > 0 && (
        <Card className="p-6 border-0 bg-yellow-500/10 border-yellow-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Обнаружены аномалии</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.anomalies.map((a: any, i: number) => (
              <div key={i} className="p-3 bg-gray-800/50 rounded-xl">
                <div className="text-xs text-gray-400 mb-1">{DateUtils.formatDate(a.date)}</div>
                <div className={`text-sm font-medium ${a.type === 'spike' ? 'text-green-400' : 'text-red-400'}`}>
                  {a.type === 'spike' ? '↗ Всплеск' : '↘ Падение'}: {Formatters.moneyDetailed(a.amount)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function FeedTab({ 
  displayRows,
  companyName,
  operatorName,
  isExtraRow,
  canManageIncome,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef,
  openIncomeEditor,
  deleteIncome,
  deletingIncomeId,
}: any) {
  return (
    <Card className="p-0 border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Все операции ({displayRows.length})</h3>
      </div>
      <div className="divide-y divide-gray-800">
        {displayRows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Нет операций по выбранным фильтрам</p>
          </div>
        ) : (
          displayRows.map((row: IncomeRow) => (
            <IncomeRowFull 
              key={row.id} 
              row={row}
              companyName={companyName(row.company_id)}
              operatorName={operatorName(row.operator_id)}
              isExtra={isExtraRow(row)}
              canManageIncome={canManageIncome}
              editingOnlineId={editingOnlineId}
              setEditingOnlineId={setEditingOnlineId}
              onlineDraft={onlineDraft}
              setOnlineDraft={setOnlineDraft}
              savingOnlineId={savingOnlineId}
              saveOnlineAmount={saveOnlineAmount}
              skipBlurSaveRef={skipBlurSaveRef}
              openIncomeEditor={openIncomeEditor}
              deleteIncome={deleteIncome}
              deletingIncomeId={deletingIncomeId}
            />
          ))
        )}
      </div>
    </Card>
  )
}

function IncomeRowFull({ 
  row, 
  companyName, 
  operatorName, 
  isExtra,
  canManageIncome,
  editingOnlineId,
  setEditingOnlineId,
  onlineDraft,
  setOnlineDraft,
  savingOnlineId,
  saveOnlineAmount,
  skipBlurSaveRef,
  openIncomeEditor,
  deleteIncome,
  deletingIncomeId,
}: any) {
  const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
  
  return (
    <div className={`p-4 hover:bg-gray-700/30 transition-colors ${isExtra ? 'bg-yellow-500/5' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${row.shift === 'day' ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}>
            {row.shift === 'day' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{companyName}</span>
              {isExtra && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">EXTRA</span>}
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
              <UserCircle2 className="w-3 h-3" />
              {operatorName}
              <span className="text-gray-600">•</span>
              {row.zone || '—'}
              <span className="text-gray-600">•</span>
              {DateUtils.formatDate(row.date, 'full')}
            </div>
          </div>
        </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm">
            {row.cash_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Нал</div>
                <div className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</div>
              </div>
            )}
            {row.kaspi_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Kaspi</div>
                <div className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</div>
              </div>
            )}
            {row.card_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">Карта</div>
                <div className="text-purple-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</div>
              </div>
            )}
            
            {/* Online с inline редактированием */}
            <div className="text-right">
              <div className="text-[10px] text-gray-500">Online</div>
              {String(row.id).startsWith('extra-') ? (
                <div className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</div>
              ) : !canManageIncome ? (
                <div className="text-pink-400 font-mono">{row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '—'}</div>
              ) : editingOnlineId === row.id ? (
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
                  className="w-24 h-7 text-right px-2 rounded border border-pink-500 bg-gray-900 text-white text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingOnlineId(row.id)
                    setOnlineDraft(String(row.online_amount ?? ''))
                  }}
                  className={`font-mono hover:bg-pink-500/10 rounded px-2 py-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-gray-600'}`}
                >
                  {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+ добавить'}
                </button>
              )}
            </div>
          </div>

            <div className="text-right min-w-[100px]">
              <div className="text-[10px] text-gray-500">Итого</div>
              <div className="text-lg font-bold text-white font-mono">{Formatters.moneyDetailed(total)}</div>
            </div>

            {canManageIncome && !String(row.id).startsWith('extra-') ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm" onClick={() => openIncomeEditor(row)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => deleteIncome(row)}
                  disabled={deletingIncomeId === row.id}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      {row.comment && (
        <div className="mt-2 text-xs text-gray-500 pl-12">{row.comment}</div>
      )}
    </div>
  )
}
