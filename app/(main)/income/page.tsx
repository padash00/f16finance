'use client'

import { useEffect, useMemo, useState, useCallback, useDeferredValue, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import type { KeyboardEvent } from 'react'
import { Card } from '@/components/ui/card'
import { CardSkeleton, TableSkeleton, StatGridSkeleton } from '@/components/skeleton'
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
  Loader2,
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
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'
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

  monthStartISO: (): string => {
    const d = new Date()
    return DateUtils.toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1))
  },

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
  const cashLabels = useCashlessLabels()
  // Фильтры (объявляем до хуков — они передаются в useIncome)
  const [dateFrom, setDateFrom] = useState(DateUtils.monthStartISO())
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const f = sp.get('from')
    const t = sp.get('to')
    const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (f && isISO(f)) setDateFrom(f)
    if (t && isISO(t)) setDateTo(t)
  }, [])
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
  useModalEscape(!!editingIncome, () => setEditingIncome(null))
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
  useEffect(() => {
    if (typeof window === 'undefined' || companies.length === 0) return
    const c = new URLSearchParams(window.location.search).get('company_id')
    if (c && companies.some((co) => co.id === c)) setCompanyFilter(c)
  }, [companies])
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
    fetchAll: true, // грузить ВСЕ страницы (иначе db-max-rows режет до 1000 и ранние даты пропадают)
  })

  // Локальная копия для оптимистичных обновлений (inline edit, delete)
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(serverRows)
  }, [serverRows])

  // Модалка добавления дохода (iframe на /income-embed/add — как у расхода)
  const router = useRouter()
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false)
  const [incomeModalLoading, setIncomeModalLoading] = useState(false)

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if ((event.data as any)?.type !== 'income-wizard-created') return
      setShowAddIncomeModal(false)
      setIncomeModalLoading(false)
      router.refresh() // перечитать серверные данные — новый доход появится в списке
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [router])

  useEffect(() => {
    if (!showAddIncomeModal) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { setShowAddIncomeModal(false); setIncomeModalLoading(false) }
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [showAddIncomeModal])

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

  // Гибкие права через capabilities — управляются из /access.
  // Если право не дано — кнопки скрываются (вариант A: hidden, не disabled).
  const { can } = useCapabilities()
  const canCreateIncome = can('income.create')
  const canEditIncome = can('income.edit')
  const canDeleteIncome = can('income.delete')
  const canExportIncome = can('income.export')
  const canManageIncome = canEditIncome || canDeleteIncome // legacy — для обратной совместимости


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
      { name: cashLabels.pos, value: totalKaspi, color: COLORS.kaspi, percentage: total ? (totalKaspi / total) * 100 : 0 },
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
        setDateFrom(DateUtils.monthStartISO())
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
    setDateFrom(DateUtils.monthStartISO())
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

  // Экспорт — премиум PDF-дашборд
  const downloadCSV = async () => {
    const period = dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : DateUtils.todayISO()
    const generated = new Date().toLocaleString('ru-RU')
    const nf = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
    const meta = { title: 'Доходы', period, generated, brandNote: 'дашборд доходов' }
    const rowAll = (r: IncomeRow) => (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0)

    if (displayRows.length === 0) {
      await downloadReportPdf('premium', {
        meta,
        kpis: [{ label: 'Общий доход', value: '—' }, { label: 'Наличные', value: '—' }, { label: 'Безналичный', value: '—' }, { label: 'Средний день', value: '—' }],
        empty: {
          columns: [
            { label: 'Дата' }, { label: 'Компания' }, { label: 'Оператор' }, { label: 'Смена' }, { label: 'Зона' },
            { label: 'Нал', align: 'right' }, { label: 'Безнал', align: 'right' }, { label: 'Онлайн', align: 'right' },
            { label: 'Карта', align: 'right' }, { label: 'Итого', align: 'right' }, { label: 'Комментарий' },
          ],
          message: 'Нет данных за выбранный период',
          hint: 'Выберите период или добавьте доходы, чтобы сформировать отчёт.',
        },
      }, `Dohody_${DateUtils.todayISO()}`)
      return
    }

    const total = displayRows.reduce((s, r) => s + rowAll(r), 0)
    const cashTotal = displayRows.reduce((s, r) => s + (r.cash_amount || 0), 0)
    const cashless = total - cashTotal
    const cashPct = total > 0 ? Math.round((cashTotal / total) * 100) : 0
    const cashlessPct = total > 0 ? 100 - cashPct : 0

    const compMap = new Map<string, number>()
    for (const r of displayRows) compMap.set(companyName(r.company_id), (compMap.get(companyName(r.company_id)) || 0) + rowAll(r))
    const comps = Array.from(compMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    const maxComp = comps[0]?.value || 1

    const dayMap = new Map<string, { date: string; count: number; cash: number; cashless: number; total: number; rows: IncomeRow[] }>()
    for (const r of displayRows) {
      const d = String(r.date || '').slice(0, 10)
      let g = dayMap.get(d)
      if (!g) { g = { date: d, count: 0, cash: 0, cashless: 0, total: 0, rows: [] }; dayMap.set(d, g) }
      g.count += 1; g.cash += r.cash_amount || 0; g.cashless += rowAll(r) - (r.cash_amount || 0); g.total += rowAll(r); g.rows.push(r)
    }
    const days = Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date))
    const activeDays = days.length
    const avgDay = activeDays > 0 ? Math.round(total / activeDays) : 0
    const maxDay = days.reduce((m, d) => (d.total > m.total ? d : m), days[0])
    const top3 = [...days].sort((a, b) => b.total - a.total).slice(0, 3)
    const daysAsc = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const maxDT = Math.max(1, ...days.map((d) => d.total))

    await downloadReportPdf('premium', {
      meta,
      kpis: [
        { label: 'Общий доход', value: `${nf(total)} тг`, sub: `${displayRows.length} строк · ${activeDays} дней`, badge: 'итог' },
        { label: 'Наличные', value: `${nf(cashTotal)} тг`, sub: `${cashPct}% от суммы` },
        { label: 'Безналичный', value: `${nf(cashless)} тг`, sub: `${cashlessPct}% от суммы` },
        { label: 'Средний день', value: `${nf(avgDay)} тг`, sub: maxDay ? `Пик: ${maxDay.date}` : '' },
      ],
      sections: [
        { type: 'bars', title: 'Доходы по компаниям', hint: 'топ по сумме', items: comps.slice(0, 6).map((c) => ({ label: c.name, amount: c.value, ratio: c.value / maxComp })) },
        { type: 'split', title: 'Оплата: cash / безнал', parts: [{ label: 'Нал', pct: cashPct, amount: cashTotal, color: '#16a34a' }, { label: 'Безнал', pct: cashlessPct, amount: cashless, color: '#3b82f6' }], accent: { title: 'Акцент для руководителя', text: maxDay ? `Пиковый день: ${maxDay.date} — ${nf(maxDay.total)} тг` : '' } },
        { type: 'minichart', title: 'Динамика по дням', hint: 'активные даты периода', bars: daysAsc.map((d) => ({ ratio: d.total / maxDT, peak: maxDay && d.date === maxDay.date })), footer: `Топ-3 дня: ${top3.map((d) => `${d.date}: ${nf(d.total)}`).join('   ')}` },
        { type: 'previewTable', title: 'Сводка по дням', hint: 'preview · полная ниже', columns: [{ key: 'date', label: 'Дата' }, { key: 'count', label: 'Строк', align: 'right' }, { key: 'cash', label: 'Нал', align: 'right' }, { key: 'cashless', label: 'Безнал', align: 'right' }, { key: 'total', label: 'Итого', align: 'right' }], rows: days.slice(0, 3).map((d) => ({ date: d.date, count: d.count, cash: d.cash, cashless: d.cashless, total: d.total })), moreNote: days.length > 3 ? `+ ещё ${days.length - 3} дней в детализации` : '' },
      ],
      detail: {
        title: 'Детализация по дням',
        subtitle: 'группы по дате, потом строки доходов',
        columns: [
          { key: 'date', label: 'Дата', w: '8%' }, { key: 'company', label: 'Компания', w: '11%' }, { key: 'operator', label: 'Оператор', w: '11%' },
          { key: 'shift', label: 'Смена', w: '6%' }, { key: 'zone', label: 'Зона', w: '7%' },
          { key: 'cash', label: 'Нал', align: 'right', w: '8%' }, { key: 'kaspi', label: 'Безнал', align: 'right', w: '8%' },
          { key: 'online', label: 'Онлайн', align: 'right', w: '7%' }, { key: 'card', label: 'Карта', align: 'right', w: '7%' },
          { key: 'total', label: 'Итого', align: 'right', w: '8%' }, { key: 'comment', label: 'Комментарий', w: '11%' },
        ],
        groups: days.map((d) => ({
          label: d.date,
          meta: `${d.count} строк · cash ${nf(d.cash)} · безнал ${nf(d.cashless)}`,
          total: d.total,
          rows: d.rows.map((r) => ({
            date: String(r.date || '').slice(0, 10), company: companyName(r.company_id), operator: operatorName(r.operator_id),
            shift: r.shift === 'night' ? 'Ночь' : r.shift === 'day' ? 'День' : (r.shift || '—'), zone: r.zone || '—',
            cash: r.cash_amount || 0, kaspi: r.kaspi_amount || 0, online: r.online_amount || 0, card: r.card_amount || 0,
            total: rowAll(r), comment: r.comment || '',
          })),
        })),
      },
    }, `Dohody_${DateUtils.todayISO()}`)
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

  // Полный лоадер только при первой загрузке. При смене фильтра контент остаётся.
  if (loading && serverRows.length === 0) {
    return (
      <div className="app-page-wide space-y-4">
        <CardSkeleton rows={3} className="border-amber-500/20" />
        <StatGridSkeleton count={4} />
        <CardSkeleton rows={2} />
        <TableSkeleton rows={8} cols={6} />
      </div>
    )
  }

  return (
    <>
        <div className="app-page-wide space-y-6">
          {/* Шапка */}
          <AdminPageHeader
            title="Доходы"
            description="Умная аналитика и прогнозирование"
            icon={<Brain className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={(
              <>
                  {/* Кнопка фильтров */}
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
                      activeFiltersCount > 0
                        ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                        : 'bg-white dark:bg-slate-800/50 border-border text-body hover:border-amber-500/50'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Фильтры
                    {activeFiltersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-amber-500 text-white text-xs rounded-full">
                        {activeFiltersCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800/50 rounded-xl border border-border hover:border-amber-500/50 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-amber-400" />
                    <span className="text-body text-sm">{periodLabel}</span>
                    <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {extraCompanyId && (
                    <button
                      onClick={() => setIncludeExtraInTotals(!includeExtraInTotals)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                        includeExtraInTotals
                          ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                          : 'bg-white dark:bg-slate-800/50 border-border text-muted-foreground'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${includeExtraInTotals ? 'bg-yellow-400' : 'bg-slate-500'}`} />
                      Extra
                    </button>
                  )}

                  {canExportIncome && (
                    <Button variant="outline" size="sm" onClick={downloadCSV} className="border-border bg-white dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-body">
                      <Download className="w-4 h-4 mr-1" /> Экспорт
                    </Button>
                  )}

                  {canCreateIncome ? (
                    <Button
                      size="sm"
                      onClick={() => { setIncomeModalLoading(true); setShowAddIncomeModal(true) }}
                      className="bg-gradient-to-r from-amber-600 to-amber-600 hover:from-amber-500 hover:to-amber-500 text-white shadow-lg shadow-amber-500/25"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Добавить
                    </Button>
                  ) : null}
              </>
            )}
            toolbar={(
              <>
              {/* Календарь */}
              {isCalendarOpen && (
                <div className="mt-4 p-4 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-amber-500/20 rounded-2xl">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                          activePreset === p
                            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                            : 'bg-card text-muted-foreground hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Все время'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs text-slate-500 uppercase mb-1 block">С</label>
                      <DatePicker
                        value={dateFrom}
                        onChange={(v) => { setDateFrom(v); setActivePreset('custom' as any) }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase mb-1 block">По</label>
                      <DatePicker
                        value={dateTo}
                        onChange={(v) => { setDateTo(v); setActivePreset('custom' as any) }}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Панель фильтров */}
              {showFilters && (
                <div className="mt-4 p-4 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-amber-500/20 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Filter className="w-4 h-4 text-amber-400" />
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
                        className="text-muted-foreground hover:text-slate-900 dark:hover:text-white"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Фильтр компании */}
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Компания
                      </label>
                      <select
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        className="w-full bg-card text-foreground px-3 py-2.5 rounded-lg border border-border focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none text-sm"
                      >
                        <option value="all">Все компании</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Фильтр оператора */}
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Оператор
                      </label>
                      <select
                        value={operatorFilter}
                        onChange={(e) => setOperatorFilter(e.target.value as OperatorFilter)}
                        className="w-full bg-card text-foreground px-3 py-2.5 rounded-lg border border-border focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none text-sm"
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
                      <label className="text-xs text-slate-500 uppercase flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Смена
                      </label>
                      <select
                        value={shiftFilter}
                        onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)}
                        className="w-full bg-card text-foreground px-3 py-2.5 rounded-lg border border-border focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none text-sm"
                      >
                        <option value="all">Все смены</option>
                        <option value="day">День (утро)</option>
                        <option value="night">Ночь</option>
                      </select>
                    </div>

                    {/* Фильтр способа оплаты */}
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase flex items-center gap-1">
                        <CardIcon className="w-3 h-3" />
                        Способ оплаты
                      </label>
                      <select
                        value={payFilter}
                        onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                        className="w-full bg-card text-foreground px-3 py-2.5 rounded-lg border border-border focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none text-sm"
                      >
                        <option value="all">Любая оплата</option>
                        <option value="cash">Наличные 💵</option>
                        <option value="kaspi">{cashLabels.pos} 📱</option>
                        <option value="online">{cashLabels.online} 🌐</option>
                        <option value="card">Карта 💳</option>
                      </select>
                    </div>
                  </div>

                  {/* Поиск и дополнительные опции */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 uppercase flex items-center gap-1">
                        <Search className="w-3 h-3" />
                        Поиск по комментарию, зоне, оператору
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Введите текст для поиска..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full bg-card text-foreground pl-10 pr-4 py-2.5 rounded-lg border border-border focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none text-sm"
                        />
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                        {searchTerm && (
                          <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
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
                              : 'bg-card border-border text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300'
                          }`}
                        >
                          {hideExtraRows ? <Check className="w-4 h-4" /> : <div className="w-4 h-4 border border-slate-500 rounded" />}
                          Скрыть строки Extra из таблицы
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Активные фильтры */}
                  {activeFiltersCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <span className="text-xs text-slate-500">Активные фильтры:</span>
                      {companyFilter !== 'all' && (
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-lg flex items-center gap-1">
                          Компания: {companyName(companyFilter)}
                          <button onClick={() => setCompanyFilter('all')} className="hover:text-amber-700 dark:hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {operatorFilter !== 'all' && (
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-lg flex items-center gap-1">
                          Оператор: {operatorFilter === 'none' ? 'Без оператора' : operatorName(operatorFilter)}
                          <button onClick={() => setOperatorFilter('all')} className="hover:text-amber-700 dark:hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {shiftFilter !== 'all' && (
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-lg flex items-center gap-1">
                          Смена: {shiftFilter === 'day' ? 'День' : 'Ночь'}
                          <button onClick={() => setShiftFilter('all')} className="hover:text-amber-700 dark:hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {payFilter !== 'all' && (
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-lg flex items-center gap-1">
                          Оплата: {payFilter === 'cash' ? 'Наличные' : payFilter === 'kaspi' ? cashLabels.pos : payFilter === 'online' ? 'Online' : 'Карта'}
                          <button onClick={() => setPayFilter('all')} className="hover:text-green-700 dark:hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {searchTerm && (
                        <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-body text-xs rounded-lg flex items-center gap-1">
                          Поиск: "{searchTerm}"
                          <button onClick={() => setSearchTerm('')} className="hover:text-slate-900 dark:hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Date presets — always visible */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      activePreset === p
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                        : 'bg-white dark:bg-slate-800/50 border border-border text-muted-foreground hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : p === 'month' ? 'Месяц' : 'Все время'}
                  </button>
                ))}
                {activePreset !== 'today' && activePreset !== 'week' && activePreset !== 'month' && activePreset !== 'all' && (
                  <span className="px-3 py-1.5 text-xs text-muted-foreground border border-slate-200 dark:border-slate-700/50 rounded-lg">
                    {dateFrom && dateTo ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}` : 'Весь период'}
                  </span>
                )}
              </div>
              </>
            )}
          />

          {/* Табы навигации */}
          <div className="flex flex-wrap gap-2 p-1 bg-white dark:bg-slate-800/50 rounded-xl w-fit max-w-full border border-border">
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

          {editingIncome && typeof window !== 'undefined' && createPortal(
            <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/70 p-4 py-8 backdrop-blur-sm overflow-y-auto"
              onClick={(e) => { if (e.target === e.currentTarget) closeIncomeEditor() }}>
              <Card className="w-full max-w-2xl border-border bg-card p-5 my-auto">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Редактирование дохода</h3>
                    <p className="text-sm text-muted-foreground">Эту операцию может выполнить только владелец или супер-админ</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={closeIncomeEditor}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-body">
                    <span>Дата</span>
                    <DatePicker
                      value={editIncomeDate}
                      onChange={setEditIncomeDate}
                      className="w-full"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-body">
                    <span>Оператор</span>
                    <select
                      value={editIncomeOperatorId}
                      onChange={(e) => setEditIncomeOperatorId(e.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40"
                    >
                      <option value="none">Без оператора</option>
                      {operators.map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.short_name || operator.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-body">
                    <span>Наличные</span>
                    <input value={editCashDraft} onChange={(e) => setEditCashDraft(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-body">
                    <span>{cashLabels.pos}</span>
                    <input value={editKaspiDraft} onChange={(e) => setEditKaspiDraft(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40" />
                  </label>

                  {editingIncome?.shift === 'night' && (
                    <label className="space-y-2 text-sm text-body md:col-span-2">
                      <span className="flex items-center gap-2">
                        {cashLabels.providerName} до 00:00
                        <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300">только для ночных смен</span>
                      </span>
                      <input
                        value={editKaspiBeforeMidnightDraft}
                        onChange={(e) => setEditKaspiBeforeMidnightDraft(e.target.value)}
                        placeholder={`Из кабинета ${cashLabels.providerName} — сколько ${cashLabels.providerName} пришло до полуночи`}
                        className="w-full rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-foreground outline-none focus:border-blue-500/40"
                      />
                      <p className="text-xs text-muted-foreground">Нужно для точного суточного расчёта в ОПиУ. Если не знаете — оставьте пустым.</p>
                    </label>
                  )}

                  <label className="space-y-2 text-sm text-body">
                    <span>Онлайн</span>
                    <input value={editOnlineDraft} onChange={(e) => setEditOnlineDraft(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-body">
                    <span>Карта</span>
                    <input value={editCardDraft} onChange={(e) => setEditCardDraft(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40" />
                  </label>

                  <label className="space-y-2 text-sm text-body md:col-span-2">
                    <span>Комментарий</span>
                    <textarea
                      rows={3}
                      value={editCommentDraft}
                      onChange={(e) => setEditCommentDraft(e.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground outline-none focus:border-amber-500/40"
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
            </div>,
            document.body
          )}

          {showAddIncomeModal && typeof window !== 'undefined' && createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
              onClick={() => { setShowAddIncomeModal(false); setIncomeModalLoading(false) }}
            >
              <div
                className="w-full max-w-[1280px] h-[92vh] rounded-2xl border border-border bg-card overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-12 border-b border-border flex items-center justify-between px-3">
                  <div className="text-sm text-foreground">Добавление дохода</div>
                  <button
                    onClick={() => { setShowAddIncomeModal(false); setIncomeModalLoading(false) }}
                    className="rounded-md p-1.5 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-surface-hover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="relative h-[calc(92vh-48px)]">
                  {incomeModalLoading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 dark:bg-slate-950/90">
                      <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Открываю форму дохода...
                      </div>
                    </div>
                  ) : null}
                  <iframe
                    src="/income-embed/add?embedded=1"
                    className="w-full h-full bg-card"
                    title="Добавление дохода"
                    onLoad={() => setIncomeModalLoading(false)}
                  />
                </div>
              </div>
            </div>,
            document.body
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
          ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
          : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function OverviewTab(props: any) {
  const cashLabels = useCashlessLabels()
  const {
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
    skipBlurSaveRef,
  } = props
  const trendIcon = analytics.trend === 'up' ? <TrendingUp className="w-4 h-4 text-green-400" /> :
                   analytics.trend === 'down' ? <TrendingDown className="w-4 h-4 text-red-400" /> : 
                   <MinusIcon className="w-4 h-4 text-muted-foreground" />

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <MetricCard
          label="Общий доход"
          value={analytics.total}
          icon={<Wallet className="w-5 h-5" />}
          color="from-amber-500 to-amber-500"
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
          label={`${cashLabels.providerName} + Карта`}
          value={analytics.kaspi + analytics.card}
          icon={<CreditCard className="w-5 h-5" />}
          color="from-amber-500 to-amber-500"
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
        <Card className="lg:col-span-2 p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-xl">
                <LineChart className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Динамика доходов</h3>
                <p className="text-xs text-slate-500">По дням с скользящим средним</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className={`text-xs ${analytics.trend === 'up' ? 'text-green-400' : analytics.trend === 'down' ? 'text-red-400' : 'text-muted-foreground'}`}>
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
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" vertical={false} />
                <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip {...Formatters.tooltip} formatter={(val: number) => [Formatters.moneyDetailed(val), '']} />
                <Area type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
                <Line type="monotone" dataKey="movingAvg" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Среднее (7 дней)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <BarChart2 className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Структура оплат</h3>
          </div>
          
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={analytics.paymentData}
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="88%"
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
                  <span className="text-muted-foreground">{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{Formatters.moneyDetailed(p.value)}</span>
                  <span className="text-slate-500">({p.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AI Прогноз и Топы */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-0 bg-gradient-to-br from-amber-50 via-white to-amber-50 dark:from-amber-900/30 dark:via-slate-900 dark:to-amber-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">AI Прогноз</h3>
          </div>

          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1">Ожидается в следующем месяце</p>
            <p className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-amber-400 bg-clip-text text-transparent">
              {Formatters.moneyDetailed(analytics.prediction.value)}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Достоверность</span>
                <span className={analytics.prediction.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}>
                  {analytics.prediction.confidence}%
                </span>
              </div>
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-amber-400 rounded-full transition-all" style={{ width: `${analytics.prediction.confidence}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Топ оператор</h3>
          </div>
          <div className="text-lg font-bold text-foreground mb-1">{analytics.topOperator[0]}</div>
          <div className="text-2xl font-bold text-amber-400">{Formatters.moneyDetailed(analytics.topOperator[1])}</div>
          <p className="text-xs text-slate-500 mt-2">Лучший результат за период</p>
        </Card>

        <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <MapPin className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Топ зона</h3>
          </div>
          <div className="text-lg font-bold text-foreground mb-1">{analytics.topZone[0]}</div>
          <div className="text-2xl font-bold text-amber-400">{Formatters.moneyDetailed(analytics.topZone[1])}</div>
          <p className="text-xs text-slate-500 mt-2">Самая прибыльная локация</p>
        </Card>
      </div>

      {/* Последние операции */}
      <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <Clock className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Последние операции</h3>
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
    <Card className="p-3 sm:p-4 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color} bg-opacity-20`}>
          {icon}
        </div>
      </div>
      <div className="text-lg sm:text-xl font-bold text-foreground mb-1">{Formatters.moneyDetailed(value)}</div>
      {percentage !== undefined && (
        <div className="text-xs text-slate-500">{percentage.toFixed(1)}% от общего</div>
      )}
      {trend && (
        <div className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-muted-foreground'}`}>
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
      isExtra ? 'bg-yellow-500/5 border border-yellow-500/20' : 'hover:bg-slate-100 dark:hover:bg-slate-700/30'
    }`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-2 h-2 rounded-full ${row.shift === 'day' ? 'bg-amber-400' : 'bg-blue-400'}`} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate flex items-center gap-2">
            {companyName}
            {isExtra && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">ДОП</span>}
          </span>
          <span className="text-xs text-slate-500 truncate">{operatorName} • {row.zone || '—'}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 text-xs">
        {row.cash_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</span>}
        {row.kaspi_amount > 0 && <span className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</span>}
        {row.card_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</span>}
        
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
              className="w-20 h-6 text-right px-1 rounded border border-pink-500 bg-card text-foreground text-xs outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingOnlineId(row.id)
              setOnlineDraft(String(row.online_amount ?? ''))
            }}
            className={`font-mono hover:bg-pink-500/10 rounded px-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-slate-600'}`}
          >
            {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+'}
          </button>
        )}

        <span className="text-sm font-bold text-foreground font-mono min-w-[80px] text-right">{Formatters.moneyDetailed(total)}</span>
      </div>
    </div>
  )
}

function AnalyticsTab({ analytics, dateFrom, dateTo }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">По способам оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.paymentData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} stroke="#94a3b8" />
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

        <Card className="p-6 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Распределение по сменам</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground flex items-center gap-2"><Sun className="w-4 h-4 text-amber-400" /> День</span>
                <span className="text-foreground font-medium">{Formatters.moneyDetailed(analytics.dayTotal)}</span>
              </div>
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${analytics.total ? (analytics.dayTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground flex items-center gap-2"><Moon className="w-4 h-4 text-blue-400" /> Ночь</span>
                <span className="text-foreground font-medium">{Formatters.moneyDetailed(analytics.nightTotal)}</span>
              </div>
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${analytics.total ? (analytics.nightTotal / analytics.total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t border-border">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Средний чек</span>
              <span className="text-foreground font-medium">{Formatters.moneyDetailed(analytics.avgCheck)}</span>
            </div>
          </div>
        </Card>
      </div>

      {analytics.anomalies.length > 0 && (
        <Card className="p-6 border-0 bg-yellow-500/10 border-yellow-500/20 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold text-foreground">Обнаружены аномалии</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.anomalies.map((a: any, i: number) => (
              <div key={i} className="p-3 bg-white dark:bg-slate-800/50 rounded-xl">
                <div className="text-xs text-muted-foreground mb-1">{DateUtils.formatDate(a.date)}</div>
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
    <Card className="p-0 border-0 bg-white dark:bg-slate-800/50 backdrop-blur-sm overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Все операции ({displayRows.length})</h3>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {displayRows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
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
  const cashLabels = useCashlessLabels()
  const total = (row.cash_amount || 0) + (row.kaspi_amount || 0) + (row.online_amount || 0) + (row.card_amount || 0)
  const { can } = useCapabilities()
  const canEditIncome = can('income.edit')
  const canDeleteIncome = can('income.delete')

  return (
    <div className={`p-4 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors ${isExtra ? 'bg-yellow-500/5' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${row.shift === 'day' ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}>
            {row.shift === 'day' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{companyName}</span>
              {isExtra && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">ДОП</span>}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
              <UserCircle2 className="w-3 h-3" />
              {operatorName}
              <span className="text-slate-600">•</span>
              {row.zone || '—'}
              <span className="text-slate-600">•</span>
              {DateUtils.formatDate(row.date, 'full')}
            </div>
          </div>
        </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
            {row.cash_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Нал</div>
                <div className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</div>
              </div>
            )}
            {row.kaspi_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-slate-500">{cashLabels.providerName}</div>
                <div className="text-blue-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</div>
              </div>
            )}
            {row.card_amount > 0 && (
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Карта</div>
                <div className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.card_amount)}</div>
              </div>
            )}
            
            {/* Online с inline редактированием */}
            <div className="text-right">
              <div className="text-[10px] text-slate-500">Онлайн</div>
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
                  className="w-24 h-7 text-right px-2 rounded border border-pink-500 bg-card text-foreground text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingOnlineId(row.id)
                    setOnlineDraft(String(row.online_amount ?? ''))
                  }}
                  className={`font-mono hover:bg-pink-500/10 rounded px-2 py-1 transition-colors ${row.online_amount ? 'text-pink-400' : 'text-slate-600'}`}
                >
                  {row.online_amount ? Formatters.moneyDetailed(row.online_amount) : '+ добавить'}
                </button>
              )}
            </div>
          </div>

            <div className="text-right min-w-[100px]">
              <div className="text-[10px] text-slate-500">Итого</div>
              <div className="text-lg font-bold text-foreground font-mono">{Formatters.moneyDetailed(total)}</div>
            </div>

            {canManageIncome && !String(row.id).startsWith('extra-') ? (
              <div className="flex items-center gap-2">
                {canEditIncome && (
                  <Button variant="outline" size="icon-sm" onClick={() => openIncomeEditor(row)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canDeleteIncome && (
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    onClick={() => deleteIncome(row)}
                    disabled={deletingIncomeId === row.id}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      {row.comment && (
        <div className="mt-2 text-xs text-slate-500 pl-12">{row.comment}</div>
      )}
    </div>
  )
}
