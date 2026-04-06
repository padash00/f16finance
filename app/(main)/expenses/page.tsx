'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import Link from 'next/link'
import { useCompanies } from '@/hooks/use-companies'
import { useExpenses, type ExpenseRow } from '@/hooks/use-expenses'
import { useOperators, type OperatorWithProfile } from '@/hooks/use-operators'
import { FloatingAssistant } from '@/components/ai/floating-assistant'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { PageSnapshot } from '@/lib/ai/types'
import {
  Plus,
  Filter,
  Download,
  Search,
  Banknote,
  Smartphone,
  Tag,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  BarChart3,
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Wallet,
  Building2,
  ArrowRight,
  MinusIcon,
  Clock,
  Activity,
  Target,
  Zap,
  Pencil,
  X,
  Paperclip,
  Upload,
  Loader2,
  Bookmark,
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  ComposedChart,
  Bar,
  BarChart,
  Cell,
  PieChart as RePieChart,
  Pie,
} from 'recharts'

import type { Company, DateRangePreset, SessionRoleInfo } from '@/lib/core/types'

// ================== TYPES ==================
type PayFilter = 'all' | 'cash' | 'kaspi'
type SortMode = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

type ChartPoint = {
  date: string
  cash: number
  kaspi: number
  total: number
  formattedDate?: string
  movingAvg?: number
}

type CategoryData = {
  name: string
  value: number
  color: string
  percentage: number
}

// ================== CONFIG ==================
const PAGE_SIZE = 200
const MAX_ROWS_HARD_LIMIT = 2000
const SEARCH_MIN_LEN = 2

const COLORS = {
  cash: '#ef4444',
  kaspi: '#f97316',
  chart: ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#3b82f6', '#10b981'],
}

// ================== DATE HELPERS ==================
const DateUtils = {
  toISODateLocal: (d: Date) => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  
  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },

  todayISO: () => DateUtils.toISODateLocal(new Date()),

  addDaysISO: (iso: string, diff: number) => {
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

// ================== FORMATTERS ==================
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
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: 12,
      padding: '12px 16px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
    },
    itemStyle: { color: '#fff' },
    labelStyle: { color: '#a0a0c0', fontSize: 12 },
  } as const
}

// ================== AI ANALYTICS ==================
class ExpenseAnalytics {
  static detectTrend(data: number[]): 'up' | 'down' | 'stable' {
    if (data.length < 3) return 'stable'
    const first = data[0]
    const last = data[data.length - 1]
    const change = ((last - first) / (first || 1)) * 100
    
    if (change > 5) return 'up'
    if (change < -5) return 'down'
    return 'stable'
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

  static predictNextMonth(data: ChartPoint[]): { value: number; confidence: number } {
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
}

// ================== UTIL ==================
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

const rowTotal = (r: ExpenseRow) => (r.cash_amount || 0) + (r.kaspi_amount || 0)

const parseMoneyInput = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d]/g, '')
  if (cleaned === '') return null
  const numeric = Number(cleaned)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, numeric)
}

const escapeCSV = (value: any) => {
  const s = value === null || value === undefined ? '' : String(value)
  const needsQuotes = s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')
  const escaped = s.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

async function logExpenseEvent(event: {
  entityType?: 'expense' | 'expense-export'
  entityId: string
  action: string
  payload?: Record<string, unknown>
}) {
  await fetch('/api/admin/audit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entityType: event.entityType || 'expense',
      entityId: event.entityId,
      action: event.action,
      payload: event.payload || null,
    }),
  }).catch(() => null)
}

// ================== MAIN COMPONENT ==================
export default function ExpensesPage() {
  const [sessionRole, setSessionRole] = useState<SessionRoleInfo | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(DateUtils.todayISO())
  const [activePreset, setActivePreset] = useState<DateRangePreset>('month')
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const [companyFilter, setCompanyFilter] = useState<'all' | string>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const searchDebounced = useDebouncedValue(searchTerm.trim(), 350)
  const [includeExtraInTotals, setIncludeExtraInTotals] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('date_desc')
  const [showFilters, setShowFilters] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'list'>('overview')
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null)
  const [editExpenseDate, setEditExpenseDate] = useState('')
  const [editExpenseCompanyId, setEditExpenseCompanyId] = useState('')
  const [editExpenseOperatorId, setEditExpenseOperatorId] = useState('none')
  const [editExpenseCategory, setEditExpenseCategory] = useState('')
  const [editExpenseCashDraft, setEditExpenseCashDraft] = useState('')
  const [editExpenseKaspiDraft, setEditExpenseKaspiDraft] = useState('')
  const [editExpenseCommentDraft, setEditExpenseCommentDraft] = useState('')
  const [savingExpenseEdit, setSavingExpenseEdit] = useState(false)
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Expense templates
  const [templates, setTemplates] = useState<{id:string,name:string,category:string,amount:number,payment_type:string,company_id:string|null,comment:string|null}[]>([])
  const [templatesTableExists, setTemplatesTableExists] = useState(true)
  const [showAddTemplate, setShowAddTemplate] = useState(false)
  const [newTemplate, setNewTemplate] = useState({name:'',category:'',amount:'',payment_type:'cash'})

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

  useEffect(() => {
    fetch('/api/admin/expense-templates')
      .then(r => r.json())
      .then(d => { setTemplates(d.data ?? []); setTemplatesTableExists(d.tableExists !== false) })
      .catch(() => {})
  }, [])

  const [categoryBudgets, setCategoryBudgets] = useState<{id:string,name:string,monthly_budget:number}[]>([])
  const [allCategories, setAllCategories] = useState<{id:string,name:string}[]>([])
  useEffect(() => {
    fetch('/api/admin/expense-categories', { cache: 'no-store' })
      .then(r => r.json())
      .then((body) => {
        const categories = (body?.data || []) as Array<{id:string,name:string,monthly_budget?:number | null}>
        setCategoryBudgets(
          categories
            .filter((item) => Number(item.monthly_budget || 0) > 0)
            .map((item) => ({
              id: item.id,
              name: item.name,
              monthly_budget: Number(item.monthly_budget || 0),
            })),
        )
        setAllCategories(categories.map((item) => ({ id: item.id, name: item.name })))
      })
      .catch(() => {
        setCategoryBudgets([])
        setAllCategories([])
      })
  }, [])

  // Data hooks
  const { companies } = useCompanies()
  const { operators } = useOperators({ activeOnly: true })
  const { rows, setRows, loading, loadingMore, hasMore, loadMore } = useExpenses({
    from: dateFrom || undefined,
    to: dateTo || undefined,
    companyId: companyFilter !== 'all' ? companyFilter : undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    payFilter: payFilter !== 'all' ? payFilter : undefined,
    search: searchDebounced.length >= SEARCH_MIN_LEN ? searchDebounced : undefined,
    sort: sortMode,
    pageSize: 2000,
  })

  const companyMap = useMemo(() => {
    const map = new Map<string, Company>()
    for (const c of companies) map.set(c.id, c)
    return map
  }, [companies])

  const companyName = useCallback(
    (companyId: string) => companyMap.get(companyId)?.name ?? '—',
    [companyMap]
  )

  const operatorMap = useMemo(() => {
    const map = new Map<string, OperatorWithProfile>()
    for (const operator of operators) map.set(operator.id, operator)
    return map
  }, [operators])

  const operatorName = useCallback(
    (operatorId: string | null) => {
      if (!operatorId) return 'Без оператора'
      const operator = operatorMap.get(operatorId)
      return operator?.short_name || operator?.name || 'Без оператора'
    },
    [operatorMap]
  )

  const canCreateExpense =
    !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner' || sessionRole?.staffRole === 'manager'
  const canManageExpense = !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner'

  const extraCompanyId = useMemo(() => {
    const extra = companies.find((c) => c.code === 'extra' || c.name === 'F16 Extra')
    return extra?.id ?? null
  }, [companies])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  // Presets
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

  const resetFilters = () => {
    setDateFrom(DateUtils.addDaysISO(DateUtils.todayISO(), -29))
    setDateTo(DateUtils.todayISO())
    setActivePreset('month')
    setCompanyFilter('all')
    setCategoryFilter('all')
    setPayFilter('all')
    setSearchTerm('')
    setIncludeExtraInTotals(false)
  }

  const periodLabel = dateFrom && dateTo 
    ? `${DateUtils.formatDate(dateFrom)} — ${DateUtils.formatDate(dateTo)}`
    : 'Весь период'

  // Analytics
  const analytics = useMemo(() => {
    const dates = DateUtils.getDatesInRange(dateFrom, dateTo)
    const chartMap = new Map<string, ChartPoint>()
    
    dates.forEach(date => {
      chartMap.set(date, {
        date,
        cash: 0,
        kaspi: 0,
        total: 0,
        formattedDate: DateUtils.formatDate(date)
      })
    })

    let cash = 0
    let kaspi = 0
    const catMap: Record<string, number> = {}

    for (const r of rows) {
      if (companyFilter === 'all' && !includeExtraInTotals && extraCompanyId && r.company_id === extraCompanyId) {
        continue
      }

      const total = rowTotal(r)
      cash += r.cash_amount || 0
      kaspi += r.kaspi_amount || 0

      const cat = r.category || 'Без категории'
      catMap[cat] = (catMap[cat] || 0) + total

      const point = chartMap.get(r.date)
      if (point) {
        point.cash += r.cash_amount || 0
        point.kaspi += r.kaspi_amount || 0
        point.total += total
      }
    }

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    
    // Moving average
    chartData.forEach((point, i) => {
      const start = Math.max(0, i - 6)
      const window = chartData.slice(start, i + 1)
      point.movingAvg = window.reduce((sum, p) => sum + p.total, 0) / window.length
    })

    const total = cash + kaspi
    const trend = ExpenseAnalytics.detectTrend(chartData.map(d => d.total).filter(v => v > 0))
    const anomalies = ExpenseAnalytics.findAnomalies(chartData)
    const prediction = ExpenseAnalytics.predictNextMonth(chartData)

    const topCategory = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0] || ['—', 0]

    const categoryData: CategoryData[] = Object.entries(catMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], index) => ({
        name,
        value,
        percentage: total ? (value / total) * 100 : 0,
        color: COLORS.chart[index % COLORS.chart.length]
      }))

    return {
      cash,
      kaspi,
      total,
      chartData,
      trend,
      anomalies,
      prediction,
      topCategory,
      topAmount: topCategory[1],
      categoryData,
      avgExpense: rows.length ? total / rows.length : 0,
    }
  }, [rows, dateFrom, dateTo, companyFilter, includeExtraInTotals, extraCompanyId])

  const activeFiltersCount = [
    companyFilter !== 'all',
    categoryFilter !== 'all',
    payFilter !== 'all',
    searchTerm !== ''
  ].filter(Boolean).length

  const trendIcon = analytics.trend === 'up' ? <TrendingUp className="w-4 h-4 text-red-400" /> : 
                   analytics.trend === 'down' ? <TrendingDown className="w-4 h-4 text-green-400" /> : 
                   <MinusIcon className="w-4 h-4 text-gray-400" />

  const assistantSnapshot = useMemo<PageSnapshot>(() => {
    const money = (value: number) => `${Math.round(value || 0).toLocaleString('ru-RU')} ₸`
    const topCategoryName = Array.isArray(analytics.topCategory) ? analytics.topCategory[0] : '—'

    return {
      page: 'expenses',
      title: 'Срез данных по расходам',
      generatedAt: new Date().toISOString(),
      route: '/expenses',
      period: {
        from: dateFrom,
        to: dateTo,
        label: periodLabel,
      },
      summary: [
        `Расходы за период ${money(analytics.total)}`,
        `Тренд ${analytics.trend}`,
        `Топ-категория ${topCategoryName}`,
      ],
      sections: [
        {
          title: 'Сводка периода',
          metrics: [
            { label: 'Общий расход', value: money(analytics.total) },
            { label: 'Наличные', value: money(analytics.cash) },
            { label: 'Kaspi', value: money(analytics.kaspi) },
            { label: 'Средний расход', value: money(analytics.avgExpense) },
            { label: 'Период', value: periodLabel },
          ],
        },
        {
          title: 'Категории и аномалии',
          metrics: [
            {
              label: 'Топ-категории',
              value: analytics.categoryData.slice(0, 3).map((item) => `${item.name} ${money(item.value)}`).join(' | ') || 'Нет данных',
            },
            {
              label: 'Аномалии',
              value:
                analytics.anomalies
                  .slice(0, 3)
                  .map((item) => `${item.date}: ${money(item.amount)}`)
                  .join(' | ') || 'Сильных аномалий нет',
            },
            { label: 'Главная категория', value: `${topCategoryName} ${money(Number(analytics.topAmount || 0))}` },
          ],
        },
        {
          title: 'Тренд и прогноз',
          metrics: [
            { label: 'Тренд', value: analytics.trend },
            { label: 'Прогноз на 30 дней', value: money(analytics.prediction.value) },
            { label: 'Доверие прогноза', value: `${Math.round(analytics.prediction.confidence)}%` },
            { label: 'Компания', value: companyFilter === 'all' ? 'Все компании' : companyName(companyFilter) },
          ],
        },
      ],
    }
  }, [analytics, companyFilter, companyName, dateFrom, dateTo, periodLabel])

  // Export
  const downloadCSV = async () => {
    const wb = createWorkbook()
    const period = dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : DateUtils.todayISO()
    const expRows = rows.map(r => ({
      date: r.date,
      company: companyName(r.company_id),
      category: r.category ?? '',
      cash: r.cash_amount ?? 0,
      kaspi: r.kaspi_amount ?? 0,
      total: rowTotal(r),
      comment: r.comment ?? '',
    }))
    buildStyledSheet(wb, 'Расходы', 'Расходы', `Период: ${period} | Строк: ${expRows.length}`, [
      { header: 'Дата', key: 'date', width: 12, type: 'text' },
      { header: 'Компания', key: 'company', width: 22, type: 'text' },
      { header: 'Категория', key: 'category', width: 26, type: 'text' },
      { header: 'Cash', key: 'cash', width: 14, type: 'money' },
      { header: 'Kaspi', key: 'kaspi', width: 14, type: 'money' },
      { header: 'Итого', key: 'total', width: 15, type: 'money' },
      { header: 'Комментарий', key: 'comment', width: 24, type: 'text' },
    ], expRows)
    await downloadWorkbook(wb, `expenses_${DateUtils.todayISO()}.xlsx`)
    logExpenseEvent({
      entityType: 'expense-export',
      entityId: `export:${DateUtils.todayISO()}`,
      action: 'download-xlsx',
      payload: {
        rows: rows.length,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        company_filter: companyFilter,
        category_filter: categoryFilter,
        pay_filter: payFilter,
      },
    })
  }

  const openExpenseEditor = (row: ExpenseRow) => {
    setEditingExpense(row)
    setEditExpenseDate(row.date)
    setEditExpenseCompanyId(row.company_id)
    setEditExpenseOperatorId(row.operator_id || 'none')
    setEditExpenseCategory(row.category || '')
    setEditExpenseCashDraft(String(row.cash_amount ?? ''))
    setEditExpenseKaspiDraft(String(row.kaspi_amount ?? ''))
    setEditExpenseCommentDraft(row.comment || '')
  }

  const closeExpenseEditor = () => {
    if (savingExpenseEdit) return
    setEditingExpense(null)
    setEditExpenseDate('')
    setEditExpenseCompanyId('')
    setEditExpenseOperatorId('none')
    setEditExpenseCategory('')
    setEditExpenseCashDraft('')
    setEditExpenseKaspiDraft('')
    setEditExpenseCommentDraft('')
    setUploadError(null)
  }

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editingExpense) return
    setUploadingAttachment(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('expenseId', editingExpense.id)
    try {
      const res = await fetch('/api/admin/expenses/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ok) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === editingExpense.id ? { ...row, attachment_url: data.url } : row,
          ),
        )
        setEditingExpense((prev) => (prev ? { ...prev, attachment_url: data.url } : prev))
      } else {
        setUploadError(data.error || 'Ошибка загрузки')
      }
    } catch {
      setUploadError('Ошибка загрузки')
    }
    setUploadingAttachment(false)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const handleRemoveAttachment = async () => {
    if (!editingExpense) return
    try {
      const res = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removeAttachment',
          expenseId: editingExpense.id,
        }),
      })
      if (res.ok) {
        setRows((prev) =>
          prev.map((row) => (row.id === editingExpense.id ? { ...row, attachment_url: null } : row)),
        )
        setEditingExpense((prev) => (prev ? { ...prev, attachment_url: null } : prev))
      }
    } catch {
      // ignore
    }
  }

  const saveExpenseEdit = async () => {
    if (!editingExpense) return

    const cashAmount = parseMoneyInput(editExpenseCashDraft)
    const kaspiAmount = parseMoneyInput(editExpenseKaspiDraft)

    setSavingExpenseEdit(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateExpense',
          expenseId: editingExpense.id,
          payload: {
            date: editExpenseDate,
            company_id: editExpenseCompanyId,
            operator_id: editExpenseOperatorId === 'none' ? null : editExpenseOperatorId,
            category: editExpenseCategory,
            cash_amount: cashAmount,
            kaspi_amount: kaspiAmount,
            comment: editExpenseCommentDraft.trim() || null,
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || 'Не удалось обновить расход')

      setRows((prev) =>
        prev.map((row) =>
          row.id === editingExpense.id
            ? {
                ...row,
                date: editExpenseDate,
                company_id: editExpenseCompanyId,
                operator_id: editExpenseOperatorId === 'none' ? null : editExpenseOperatorId,
                category: editExpenseCategory,
                cash_amount: cashAmount,
                kaspi_amount: kaspiAmount,
                comment: editExpenseCommentDraft.trim() || null,
              }
            : row,
        ),
      )
      closeExpenseEditor()
    } catch (err: any) {
      setError(err?.message || 'Не удалось обновить расход')
    } finally {
      setSavingExpenseEdit(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!newTemplate.name || !newTemplate.category || !newTemplate.amount) return
    const res = await fetch('/api/admin/expense-templates', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({...newTemplate, amount: Number(newTemplate.amount)})
    })
    const data = await res.json()
    if (data.data) {
      setTemplates(prev => [...prev, data.data])
      setNewTemplate({name:'',category:'',amount:'',payment_type:'cash'})
      setShowAddTemplate(false)
    }
  }

  const applyTemplate = (t: {id:string,name:string,category:string,amount:number,payment_type:string,company_id:string|null,comment:string|null}) => {
    const params = new URLSearchParams()
    params.set('category', t.category)
    if (t.payment_type === 'kaspi') {
      params.set('kaspi_amount', String(t.amount))
    } else {
      params.set('cash_amount', String(t.amount))
    }
    if (t.comment) params.set('comment', t.comment)
    if (t.company_id) params.set('company_id', t.company_id)
    window.location.href = `/expenses/add?${params.toString()}`
  }

  const handleDeleteTemplate = async (id: string) => {
    await fetch(`/api/admin/expense-templates?id=${id}`, { method: 'DELETE' })
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const deleteExpense = async (row: ExpenseRow) => {
    if (!confirm(`Удалить расход от ${DateUtils.formatDate(row.date)}?`)) return

    setDeletingExpenseId(row.id)
    setError(null)

    try {
      const response = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteExpense',
          expenseId: row.id,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || 'Не удалось удалить расход')

      setRows((prev) => prev.filter((item) => item.id !== row.id))
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить расход')
    } finally {
      setDeletingExpenseId(null)
    }
  }

  if (loading && rows.length === 0) {
    return (
      <>
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-red-500/30 border-t-red-500 mx-auto mb-6" />
              <Wallet className="w-8 h-8 text-red-400 absolute top-4 left-1/2 transform -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Загружаем данные о расходах...</p>
          </div>
      </>
    )
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 p-6 border border-red-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-red-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-orange-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-red-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-red-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Журнал расходов
                    </h1>
                    <p className="text-sm text-gray-400">Умный контроль затрат и аналитика</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
                      activeFiltersCount > 0
                        ? 'bg-red-500/20 border-red-500/30 text-red-400'
                        : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-red-500/50'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Фильтры
                    {activeFiltersCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                        {activeFiltersCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-red-500/50 transition-colors"
                  >
                    <CalendarDays className="w-4 h-4 text-red-400" />
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

                  <Button variant="outline" size="sm" onClick={downloadCSV} disabled={rows.length === 0} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                    <Download className="w-4 h-4 mr-1" /> Экспорт
                  </Button>

                  <Link href="/expenses/analysis">
                    <Button variant="outline" size="sm" className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300">
                      <BarChart3 className="w-4 h-4 mr-1" /> Анализ
                    </Button>
                  </Link>

                  {canCreateExpense ? (
                    <Link href="/expenses/add">
                      <Button size="sm" className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white shadow-lg shadow-red-500/25">
                        <Plus className="w-4 h-4 mr-1" /> Добавить
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>

              {/* Calendar */}
              {isCalendarOpen && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-red-500/20 rounded-2xl">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(['today', 'week', 'month', 'all'] as DateRangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                          activePreset === p
                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
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
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-red-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">По</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setActivePreset('custom' as any) }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-red-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {/* Filters Panel */}
              {showFilters && (
                <div className="mt-4 p-4 bg-gray-900/95 backdrop-blur-xl border border-red-500/20 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <Filter className="w-4 h-4 text-red-400" />
                      Фильтры данных
                    </h3>
                    <div className="flex items-center gap-2">
                      {activeFiltersCount > 0 && (
                        <button
                          onClick={resetFilters}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Сбросить все
                        </button>
                      )}
                      <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Компания
                      </label>
                      <select
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Все компании</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        Категория
                      </label>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Все категории</option>
                        {categories.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <Smartphone className="w-3 h-3" />
                        Способ оплаты
                      </label>
                      <select
                        value={payFilter}
                        onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="all">Любая</option>
                        <option value="cash">Наличные 💵</option>
                        <option value="kaspi">Kaspi 📱</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        Сортировка
                      </label>
                      <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
                      >
                        <option value="date_desc">Дата ↓</option>
                        <option value="date_asc">Дата ↑</option>
                        <option value="amount_desc">Сумма ↓</option>
                        <option value="amount_asc">Сумма ↑</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="text-xs text-gray-500 uppercase flex items-center gap-1">
                      <Search className="w-3 h-3" />
                      Поиск по комментарию или категории
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Введите текст для поиска..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-800 text-white pl-10 pr-4 py-2.5 rounded-lg border border-gray-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none text-sm"
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
                    {searchTerm.trim().length > 0 && searchTerm.trim().length < SEARCH_MIN_LEN && (
                      <p className="text-xs text-gray-500">Введите минимум {SEARCH_MIN_LEN} символа</p>
                    )}
                  </div>

                  {activeFiltersCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-800">
                      <span className="text-xs text-gray-500">Активные фильтры:</span>
                      {companyFilter !== 'all' && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-lg flex items-center gap-1">
                          Компания: {companyName(companyFilter)}
                          <button onClick={() => setCompanyFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {categoryFilter !== 'all' && (
                        <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-lg flex items-center gap-1">
                          Категория: {categoryFilter}
                          <button onClick={() => setCategoryFilter('all')} className="hover:text-white"><X className="w-3 h-3" /></button>
                        </span>
                      )}
                      {payFilter !== 'all' && (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-lg flex items-center gap-1">
                          Оплата: {payFilter === 'cash' ? 'Наличные' : 'Kaspi'}
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
                    ? 'bg-red-500 text-white shadow-sm shadow-red-500/30'
                    : 'bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : p === 'month' ? '30 дней' : 'Все время'}
              </button>
            ))}
            {activePreset !== 'today' && activePreset !== 'week' && activePreset !== 'month' && activePreset !== 'all' && (
              <span className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700/50 rounded-lg">{periodLabel}</span>
            )}
          </div>

          {/* Templates */}
          {templatesTableExists && (
            <Card className="p-4 bg-gray-900/80 border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Шаблоны расходов</h3>
                </div>
                <button onClick={() => setShowAddTemplate(!showAddTemplate)} className="text-xs text-gray-500 hover:text-gray-300">
                  {showAddTemplate ? 'Скрыть' : '+ Добавить шаблон'}
                </button>
              </div>

              {templates.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {templates.map(t => (
                    <div key={t.id} className="flex items-center gap-1 group">
                      <button
                        onClick={() => applyTemplate(t)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-xs text-amber-300 transition-colors"
                      >
                        <Zap className="w-3 h-3" />
                        {t.name} — {t.amount.toLocaleString('ru-RU')} ₸
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-red-400 transition-all"
                        title="Удалить шаблон"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {templates.length === 0 && !showAddTemplate && (
                <p className="text-xs text-gray-600">Нет шаблонов. Добавьте часто используемые расходы.</p>
              )}

              {showAddTemplate && (
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-800">
                  <input placeholder="Название (Аренда)" value={newTemplate.name} onChange={e => setNewTemplate(p=>({...p,name:e.target.value}))}
                    className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 outline-none" />
                  <input placeholder="Категория" value={newTemplate.category} onChange={e => setNewTemplate(p=>({...p,category:e.target.value}))}
                    className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 outline-none" />
                  <input type="number" placeholder="Сумма" value={newTemplate.amount} onChange={e => setNewTemplate(p=>({...p,amount:e.target.value}))}
                    className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 outline-none" />
                  <select value={newTemplate.payment_type} onChange={e => setNewTemplate(p=>({...p,payment_type:e.target.value}))}
                    className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 outline-none">
                    <option value="cash">Наличные</option>
                    <option value="kaspi">Kaspi</option>
                  </select>
                  <button onClick={handleSaveTemplate} className="col-span-2 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/30 rounded-lg text-xs text-amber-300 transition-colors">
                    Сохранить шаблон
                  </button>
                </div>
              )}
            </Card>
          )}

          {/* Tabs */}
          <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
            <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
            <TabButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<BarChart3 className="w-4 h-4" />} label="Аналитика" />
            <TabButton active={activeTab === 'list'} onClick={() => setActiveTab('list')} icon={<Clock className="w-4 h-4" />} label="Список" />
          </div>

          <FloatingAssistant
            page="expenses"
            title="Расходы"
            snapshot={assistantSnapshot}
            suggestedPrompts={[
              'Какие расходы режем первыми?',
              'Где перерасход системный?',
              'План контроля на 30 дней',
            ]}
          />

          {/* Content */}
          {activeTab === 'overview' && (
            <OverviewTab analytics={analytics} trendIcon={trendIcon} rows={rows} companyName={companyName} extraCompanyId={extraCompanyId} categoryBudgets={categoryBudgets} dateFrom={dateFrom} dateTo={dateTo} />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsTab analytics={analytics} />
          )}

          {activeTab === 'list' && (
            <ListTab
              rows={rows}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              loadMore={loadMore}
              companyName={companyName}
              companyMap={companyMap}
              operatorName={operatorName}
              canManageExpense={canManageExpense}
              openExpenseEditor={openExpenseEditor}
              deleteExpense={deleteExpense}
              deletingExpenseId={deletingExpenseId}
              onPreview={setPreviewUrl}
            />
          )}
        </div>

      {editingExpense ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Редактирование расхода</h2>
                <p className="mt-1 text-sm text-slate-400">Изменения сохранятся сразу в базе и попадут в аудит.</p>
              </div>
              <button
                onClick={closeExpenseEditor}
                className="rounded-xl border border-white/10 p-2 text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Дата</label>
                <input
                  type="date"
                  value={editExpenseDate}
                  onChange={(e) => setEditExpenseDate(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Компания</label>
                <select
                  value={editExpenseCompanyId}
                  onChange={(e) => setEditExpenseCompanyId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50"
                >
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Оператор</label>
                <select
                  value={editExpenseOperatorId}
                  onChange={(e) => setEditExpenseOperatorId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50"
                >
                  <option value="none">Без оператора</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.short_name || operator.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Категория</label>
                <select
                  value={editExpenseCategory}
                  onChange={(e) => setEditExpenseCategory(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50 [color-scheme:dark]"
                >
                  <option value="">— Без категории —</option>
                  {allCategories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Наличные</label>
                <input
                  inputMode="numeric"
                  value={editExpenseCashDraft}
                  onChange={(e) => setEditExpenseCashDraft(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50"
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Kaspi</label>
                <input
                  inputMode="numeric"
                  value={editExpenseKaspiDraft}
                  onChange={(e) => setEditExpenseKaspiDraft(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-red-500/50"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Комментарий</label>
              <textarea
                value={editExpenseCommentDraft}
                onChange={(e) => setEditExpenseCommentDraft(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-red-500/50"
                placeholder="Комментарий к расходу"
              />
            </div>

            {/* Attachment section */}
            <div className="mt-3 border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-500 mb-2">Вложение (фото чека, накладной)</p>
              {editingExpense?.attachment_url ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => setPreviewUrl(editingExpense.attachment_url!)}
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    <Paperclip className="w-3.5 h-3.5" />
                    Посмотреть вложение
                  </button>
                  <button onClick={handleRemoveAttachment} className="text-xs text-red-400 hover:text-red-300">Удалить</button>
                </div>
              ) : (
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 hover:text-gray-200 w-fit">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Прикрепить файл</span>
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleAttachmentUpload} />
                </label>
              )}
              {uploadingAttachment && <p className="text-xs text-blue-400 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Загрузка...</p>}
              {uploadError && <p className="text-xs text-red-400 mt-1">{uploadError}</p>}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={closeExpenseEditor} disabled={savingExpenseEdit}>
                Отмена
              </Button>
              <Button onClick={saveExpenseEdit} disabled={savingExpenseEdit}>
                {savingExpenseEdit ? 'Сохраняю...' : 'Сохранить изменения'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Attachment preview modal */}
      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col rounded-2xl border border-white/10 bg-gray-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Paperclip className="w-4 h-4 text-blue-400" />
                Вложение
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                >
                  Открыть оригинал ↗
                </a>
                <button
                  onClick={() => setPreviewUrl(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-[300px] bg-black/30">
              {previewUrl.toLowerCase().includes('.pdf') || previewUrl.toLowerCase().includes('pdf') ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[60vh] rounded-lg border border-white/10"
                  title="PDF вложение"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Вложение"
                  className="max-w-full max-h-[60vh] object-contain rounded-lg"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                    const p = document.createElement('p')
                    p.className = 'text-gray-400 text-sm'
                    p.textContent = 'Не удалось загрузить изображение'
                    ;(e.target as HTMLImageElement).parentNode?.appendChild(p)
                  }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ================== SUB-COMPONENTS ==================

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function OverviewTab({ analytics, trendIcon, rows, companyName, extraCompanyId, categoryBudgets, dateFrom, dateTo }: any) {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Всего расходов"
          value={analytics.total}
          icon={<Wallet className="w-5 h-5" />}
          color="from-red-500 to-orange-500"
          trend={analytics.trend}
          trendIcon={trendIcon}
        />
        <MetricCard
          label="Наличные"
          value={analytics.cash}
          icon={<Banknote className="w-5 h-5" />}
          color="from-amber-500 to-yellow-500"
          percentage={analytics.total ? (analytics.cash / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Kaspi"
          value={analytics.kaspi}
          icon={<Smartphone className="w-5 h-5" />}
          color="from-orange-500 to-red-500"
          percentage={analytics.total ? (analytics.kaspi / analytics.total) * 100 : 0}
        />
        <MetricCard
          label="Средний чек"
          value={analytics.avgExpense}
          icon={<Target className="w-5 h-5" />}
          color="from-purple-500 to-pink-500"
        />
      </div>

      {/* Chart & Structure */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-xl">
                <BarChart3 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Динамика расходов</h3>
                <p className="text-xs text-gray-500">По дням с трендом</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className={`text-xs ${analytics.trend === 'up' ? 'text-red-400' : analytics.trend === 'down' ? 'text-green-400' : 'text-gray-400'}`}>
                {analytics.trend === 'up' ? 'Рост' : analytics.trend === 'down' ? 'Снижение' : 'Стабильно'}
              </span>
            </div>
          </div>
          
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.chartData}>
                <defs>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" vertical={false} />
                <XAxis dataKey="formattedDate" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip {...Formatters.tooltip} formatter={(val: number) => [Formatters.moneyDetailed(val), '']} />
                <Area type="monotone" dataKey="total" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExpense)" />
                <Line type="monotone" dataKey="movingAvg" stroke="#fbbf24" strokeWidth={2} dot={false} strokeDasharray="5 5" name="Среднее (7 дней)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-orange-500/20 rounded-xl">
              <Tag className="w-5 h-5 text-orange-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Структура по категориям</h3>
          </div>
          
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={analytics.categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {analytics.categoryData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [Formatters.moneyDetailed(val), '']} contentStyle={Formatters.tooltip.contentStyle} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-40 overflow-auto">
            {analytics.categoryData.map((cat: any) => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-gray-400 truncate max-w-[100px]">{cat.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(cat.value)}</span>
                  <span className="text-gray-500">({cat.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Budget Categories */}
      {categoryBudgets && categoryBudgets.length > 0 && (() => {
        const thisMonth = new Date().toISOString().slice(0, 7)
        const isCurrentMonth = (dateFrom && dateFrom.startsWith(thisMonth)) || (dateTo && dateTo.startsWith(thisMonth))
        if (!isCurrentMonth) return null
        const catTotals = new Map<string, number>()
        for (const row of rows) {
          if (!row.category) continue
          const t = (row.cash_amount || 0) + (row.kaspi_amount || 0)
          catTotals.set(row.category, (catTotals.get(row.category) || 0) + t)
        }
        const budgetItems = categoryBudgets.map((cb: any) => ({
          ...cb,
          spent: catTotals.get(cb.name) || 0,
          pct: Math.min(100, Math.round(((catTotals.get(cb.name) || 0) / cb.monthly_budget) * 100))
        })).filter((b: any) => b.monthly_budget > 0).sort((a: any, b: any) => b.pct - a.pct)

        return (
          <Card className="p-5 bg-gray-900/80 border-gray-800">
            <h3 className="text-sm font-semibold text-white mb-4">Бюджет категорий</h3>
            <div className="space-y-3">
              {budgetItems.map((item: any) => (
                <div key={item.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{item.name}</span>
                    <span className={item.pct >= 90 ? 'text-red-400' : item.pct >= 70 ? 'text-amber-400' : 'text-emerald-400'}>
                      {item.spent.toLocaleString('ru-RU')} / {item.monthly_budget.toLocaleString('ru-RU')} ₸ ({item.pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full">
                    <div className={`h-1.5 rounded-full transition-all ${item.pct >= 90 ? 'bg-red-500' : item.pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width: `${item.pct}%`}} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      })()}

      {/* AI Prediction & Top Category */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-0 bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-500/20 rounded-xl">
              <Sparkles className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">AI Прогноз</h3>
          </div>
          
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1">Ожидается в следующем месяце</p>
            <p className="text-2xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
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
                <div className="h-full bg-gradient-to-r from-red-400 to-orange-400 rounded-full transition-all" style={{ width: `${analytics.prediction.confidence}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-500/20 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Топ категория</h3>
          </div>
          <div className="text-lg font-bold text-white mb-1 truncate" title={analytics.topCategory[0]}>
            {analytics.topCategory[0]}
          </div>
          <div className="text-2xl font-bold text-yellow-400">{Formatters.moneyDetailed(analytics.topAmount)}</div>
          <p className="text-xs text-gray-500 mt-2">Больше всего расходов</p>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <Zap className="w-5 h-5 text-green-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Рекомендация AI</h3>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            {analytics.trend === 'up' 
              ? 'Расходы растут. Рекомендуется пересмотреть бюджет и оптимизировать затраты в категории ' + analytics.topCategory[0]
              : analytics.trend === 'down'
              ? 'Отличная динамика! Расходы снижаются. Продолжайте контролировать бюджет.'
              : 'Стабильная ситуация. Внимательно следите за крупными категориями расходов.'}
          </p>
        </Card>
      </div>

      {/* Recent Expenses */}
      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-xl">
              <Clock className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Последние расходы</h3>
          </div>
        </div>
        
        <div className="space-y-2">
          {rows.slice(0, 5).map((row: ExpenseRow) => (
            <ExpenseRowCompact 
              key={row.id} 
              row={row}
              companyName={companyName(row.company_id)}
              isExtra={extraCompanyId === row.company_id}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function AnalyticsTab({ analytics }: any) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Распределение по способам оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'Наличные', value: analytics.cash, color: '#f59e0b' },
                { name: 'Kaspi', value: analytics.kaspi, color: '#ef4444' }
              ]}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.money(v)} />
                <Tooltip formatter={(v: number) => Formatters.moneyDetailed(v)} contentStyle={Formatters.tooltip.contentStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  <Cell fill="#f59e0b" />
                  <Cell fill="#ef4444" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Топ категории расходов</h3>
          <div className="space-y-4">
            {analytics.categoryData.map((cat: any) => (
              <div key={cat.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">{cat.name}</span>
                  <span className="text-white font-medium">{Formatters.moneyDetailed(cat.value)}</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
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
                <div className={`text-sm font-medium ${a.type === 'spike' ? 'text-red-400' : 'text-green-400'}`}>
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

function ListTab({
  rows,
  loading,
  loadingMore,
  hasMore,
  loadMore,
  companyMap,
  operatorName,
  canManageExpense,
  openExpenseEditor,
  deleteExpense,
  deletingExpenseId,
  onPreview,
}: any) {
  return (
    <Card className="border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900/50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">Дата</th>
              <th className="px-4 py-3 text-left">Компания</th>
              <th className="px-4 py-3 text-left">Категория</th>
              <th className="px-4 py-3 text-right text-red-400">Нал</th>
              <th className="px-4 py-3 text-right text-red-400">Kaspi</th>
              <th className="px-4 py-3 text-right text-white">Итого</th>
              <th className="px-4 py-3 text-left">Комментарий</th>
              <th className="px-4 py-3 text-center w-8"></th>
              {canManageExpense ? <th className="px-4 py-3 text-right">Действия</th> : null}
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.map((row: ExpenseRow, idx: number) => {
              const total = rowTotal(row)
              const company = companyMap.get(row.company_id)
              const isExtra = company?.code === 'extra' || company?.name === 'F16 Extra'

              return (
                <tr
                  key={row.id}
                  className={`border-b border-gray-800/50 hover:bg-white/5 transition-colors ${
                    idx % 2 === 0 ? 'bg-transparent' : 'bg-gray-900/20'
                  } ${isExtra ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/30' : ''}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400 font-mono text-xs">
                    {DateUtils.formatDate(row.date)}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-300">
                    {company?.name ?? '—'}
                    {isExtra && (
                      <span className="ml-2 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">
                        EXTRA
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700">
                      {row.category || 'Общее'}
                    </span>
                    <div className="mt-1 text-[11px] text-gray-500">{operatorName(row.operator_id)}</div>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${row.cash_amount ? 'text-amber-400' : 'text-gray-700'}`}>
                    {row.cash_amount ? Formatters.moneyDetailed(row.cash_amount) : '—'}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${row.kaspi_amount ? 'text-red-400' : 'text-gray-700'}`}>
                    {row.kaspi_amount ? Formatters.moneyDetailed(row.kaspi_amount) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-500 font-mono bg-red-500/5">
                    {Formatters.moneyDetailed(total)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                    {row.comment || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.attachment_url ? (
                      <button onClick={() => onPreview(row.attachment_url)} title="Посмотреть вложение" className="inline-flex text-blue-400 hover:text-blue-300 transition-colors">
                        <Paperclip className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </td>
                  {canManageExpense ? (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon-sm" onClick={() => openExpenseEditor(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          onClick={() => deleteExpense(row)}
                          disabled={deletingExpenseId === row.id}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 && (
        <div className="p-12 text-center text-gray-500">
          <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Расходов не найдено. Попробуйте изменить фильтры.</p>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center p-4 border-t border-gray-800">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Загружаю...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ChevronDown className="w-4 h-4" /> Загрузить ещё
              </span>
            )}
          </Button>
        </div>
      )}
    </Card>
  )
}

// ================== HELPER COMPONENTS ==================

function MetricCard({ label, value, icon, color, trend, trendIcon, percentage }: any) {
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
        <div className={`text-xs flex items-center gap-1 ${trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-gray-400'}`}>
          {trendIcon}
          {trend === 'up' ? 'Рост расходов' : trend === 'down' ? 'Снижение' : 'Стабильно'}
        </div>
      )}
    </Card>
  )
}

function ExpenseRowCompact({ row, companyName, isExtra }: any) {
  const total = rowTotal(row)
  
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl transition-all ${
      isExtra ? 'bg-yellow-500/5 border border-yellow-500/20' : 'hover:bg-gray-700/30'
    }`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white truncate flex items-center gap-2">
            {companyName}
            {isExtra && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">EXTRA</span>}
          </span>
          <span className="text-xs text-gray-500 truncate">{row.category || 'Общее'} • {DateUtils.getRelativeDay(row.date)}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        {row.cash_amount > 0 && <span className="text-amber-400 font-mono">{Formatters.moneyDetailed(row.cash_amount)}</span>}
        {row.kaspi_amount > 0 && <span className="text-red-400 font-mono">{Formatters.moneyDetailed(row.kaspi_amount)}</span>}
        <span className="text-sm font-bold text-red-500 font-mono min-w-[80px] text-right">{Formatters.moneyDetailed(total)}</span>
      </div>
    </div>
  )
}
