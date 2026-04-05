'use client'

import { useEffect, useMemo, useState, useCallback, useRef, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Save,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Filter,
  X,
  Eye,
  EyeOff,
  Info,
  Settings,
  Moon,
  Sun,
  Building2,
  Trash2,
  Search,
} from 'lucide-react'

// =====================
// TYPES
// =====================
type ShiftType = 'day' | 'night'

type RuleRow = {
  id: number
  company_code: string
  shift_type: ShiftType
  base_per_shift: number | null
  senior_operator_bonus: number | null
  senior_cashier_bonus: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
}

type CompanyRow = {
  id: string
  name: string
  code: string | null
}

type RuleHistoryRow = {
  id: string
  actor_user_id: string | null
  actor_email: string | null
  entity_type: string
  entity_id: string
  action: 'create' | 'update' | 'delete'
  payload: Record<string, unknown> | null
  created_at: string
}

type SalaryRulesResponse = {
  ok: boolean
  data?: {
    rules: RuleRow[]
    companies: CompanyRow[]
    history: RuleHistoryRow[]
  }
  error?: string
}

// =====================
// CONSTANTS
// =====================
const SHIFT_LABELS: Record<ShiftType, { label: string; icon: any; color: string }> = {
  day: { 
    label: 'Дневная смена', 
    icon: Sun, 
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' 
  },
  night: { 
    label: 'Ночная смена', 
    icon: Moon, 
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' 
  },
}

const COMPANY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  arena: { 
    bg: 'bg-emerald-500/10', 
    border: 'border-emerald-500/20', 
    text: 'text-emerald-400' 
  },
  ramen: { 
    bg: 'bg-amber-500/10', 
    border: 'border-amber-500/20', 
    text: 'text-amber-400' 
  },
  extra: { 
    bg: 'bg-violet-500/10', 
    border: 'border-violet-500/20', 
    text: 'text-violet-400' 
  },
}

// =====================
// UTILITY FUNCTIONS
// =====================
const formatMoney = (v: number | null) => {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

const formatMoneyCompact = (v: number | null) => {
  if (v === null || v === undefined) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M ₸'
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + 'k ₸'
  return v + ' ₸'
}

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

const parseIntSafe = (v: string | number | null): number | null => {
  if (v === null || v === undefined) return null
  const s = typeof v === 'number' ? String(v) : v
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return null
  return Math.round(num)
}

type EditableRuleField = Exclude<keyof RuleRow, 'id'>

const ruleKey = (company_code: string, shift_type: ShiftType) =>
  `${company_code}__${shift_type}`

const getCompanyStyle = (code: string) => {
  return COMPANY_COLORS[code.toLowerCase()] || { 
    bg: 'bg-gray-500/10', 
    border: 'border-gray-500/20', 
    text: 'text-gray-400' 
  }
}

const getActionLabel = (action: RuleHistoryRow['action']) => {
  if (action === 'create') return 'Создано правило'
  if (action === 'delete') return 'Удалено правило'
  return 'Обновлено правило'
}

const getActionStyle = (action: RuleHistoryRow['action']) => {
  if (action === 'create') return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
  if (action === 'delete') return 'border-red-500/20 bg-red-500/5 text-red-300'
  return 'border-violet-500/20 bg-violet-500/5 text-violet-300'
}

const formatShiftText = (value: unknown) => {
  return String(value || '').toLowerCase() === 'night' ? 'Ночная смена' : 'Дневная смена'
}

const toRuleSummary = (payload: Record<string, unknown> | null | undefined) => {
  if (!payload) return []

  const items = [
    ['Оклад', formatMoney(parseIntSafe(payload.base_per_shift as string | number | null))],
    ['Старший оператор', formatMoney(parseIntSafe(payload.senior_operator_bonus as string | number | null))],
    ['Старший кассир', formatMoney(parseIntSafe(payload.senior_cashier_bonus as string | number | null))],
    ['Порог 1', formatMoney(parseIntSafe(payload.threshold1_turnover as string | number | null))],
    ['Бонус 1', formatMoney(parseIntSafe(payload.threshold1_bonus as string | number | null))],
    ['Порог 2', formatMoney(parseIntSafe(payload.threshold2_turnover as string | number | null))],
    ['Бонус 2', formatMoney(parseIntSafe(payload.threshold2_bonus as string | number | null))],
  ] as Array<[string, string]>

  return items
}

const buildHistoryHighlights = (entry: RuleHistoryRow) => {
  const payload = entry.payload || {}
  if (entry.action === 'update') {
    const previous = (payload.previous as Record<string, unknown> | undefined) || {}
    const next = (payload.next as Record<string, unknown> | undefined) || {}
    const fields: Array<[string, keyof RuleRow]> = [
      ['Оклад', 'base_per_shift'],
      ['Старший оператор', 'senior_operator_bonus'],
      ['Старший кассир', 'senior_cashier_bonus'],
      ['Порог 1', 'threshold1_turnover'],
      ['Бонус 1', 'threshold1_bonus'],
      ['Порог 2', 'threshold2_turnover'],
      ['Бонус 2', 'threshold2_bonus'],
    ]

    return fields
      .filter(([, field]) => previous[field] !== next[field])
      .slice(0, 4)
      .map(([label, field]) => ({
        label,
        before: formatMoney(parseIntSafe(previous[field] as string | number | null)),
        after: formatMoney(parseIntSafe(next[field] as string | number | null)),
      }))
  }

  const source =
    entry.action === 'delete'
      ? ((payload.previous as Record<string, unknown> | undefined) || payload)
      : ((payload.next as Record<string, unknown> | undefined) || payload)

  return toRuleSummary(source).slice(0, 4).map(([label, value]) => ({
    label,
    before: entry.action === 'delete' ? value : '—',
    after: entry.action === 'delete' ? 'Удалено' : value,
  }))
}

// =====================
// LOADING COMPONENT
// =====================
function SalaryRulesLoading() {
  return (
    <>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Settings className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка правил расчёта зарплаты...</p>
        </div>
    </>
  )
}

// =====================
// MAIN COMPONENT
// =====================
function SalaryRulesContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // State
  const [rules, setRules] = useState<RuleRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [history, setHistory] = useState<RuleHistoryRow[]>([])

  // UI states
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
  const [showInactive, setShowInactive] = useState(false)
  const [filterCompany, setFilterCompany] = useState<string>('all')
  const [filterShift, setFilterShift] = useState<ShiftType | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // URL sync
  const didInitFromUrl = useRef(false)

  // Load data
  const loadAll = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/salary-rules', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as SalaryRulesResponse | null
      if (!response.ok || !json?.ok || !json.data) {
        setError(json?.error || 'Ошибка загрузки данных')
        return
      }

      setRules((json.data.rules || []) as RuleRow[])
      setCompanies((json.data.companies || []) as CompanyRow[])
      setHistory((json.data.history || []) as RuleHistoryRow[])
      setDirtyIds(new Set())
    } catch (err) {
      setError('Не удалось загрузить данные')
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // URL sync
  useEffect(() => {
    if (didInitFromUrl.current || loading) return

    const sp = searchParams
    const pShowInactive = sp.get('showInactive') === '1'
    const pCompany = sp.get('company')
    const pShift = sp.get('shift') as ShiftType | 'all' | null
    const pSearch = sp.get('q')

    setShowInactive(pShowInactive)
    if (pCompany) setFilterCompany(pCompany)
    if (pShift && (pShift === 'all' || pShift === 'day' || pShift === 'night')) {
      setFilterShift(pShift)
    }
    if (pSearch) setSearchTerm(pSearch)

    didInitFromUrl.current = true
  }, [searchParams, loading])

  useEffect(() => {
    if (!didInitFromUrl.current) return

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('showInactive', showInactive ? '1' : '0')
      params.set('company', filterCompany)
      params.set('shift', filterShift)
      if (searchTerm) params.set('q', searchTerm)

      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [showInactive, filterCompany, filterShift, searchTerm, pathname, router])

  // Computed values
  const companyOptions = useMemo(() => {
    const list = (companies || []).filter((c) => c.code)
    if (list.length === 0) {
      return [
        { id: 'x1', name: 'F16 Arena', code: 'arena' },
        { id: 'x2', name: 'F16 Ramen', code: 'ramen' },
        { id: 'x3', name: 'F16 Extra', code: 'extra' },
      ] as CompanyRow[]
    }
    return list
  }, [companies])

  const existingKeys = useMemo(() => {
    const set = new Set<string>()
    for (const r of rules) set.add(ruleKey(r.company_code, r.shift_type))
    return set
  }, [rules])

  const filteredRules = useMemo(() => {
    return rules.filter(rule => {
      // Filter by active status
      if (!showInactive && !rule.is_active) return false

      // Filter by company
      if (filterCompany !== 'all' && rule.company_code !== filterCompany) return false

      // Filter by shift
      if (filterShift !== 'all' && rule.shift_type !== filterShift) return false

      // Search in company name
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const company = companyOptions.find(c => c.code === rule.company_code)?.name.toLowerCase() || ''
        return company.includes(term)
      }

      return true
    })
  }, [rules, showInactive, filterCompany, filterShift, searchTerm, companyOptions])

  const quickTabs = useMemo(() => {
    return companyOptions.filter((company) => company.code)
  }, [companyOptions])

  const stats = useMemo(() => {
    const active = rules.filter(r => r.is_active).length
    const dayShifts = rules.filter(r => r.shift_type === 'day').length
    const nightShifts = rules.filter(r => r.shift_type === 'night').length
    const avgBase = Math.round(rules.reduce((sum, r) => sum + (r.base_per_shift || 0), 0) / rules.length) || 0

    return {
      total: rules.length,
      active,
      inactive: rules.length - active,
      dayShifts,
      nightShifts,
      avgBase,
    }
  }, [rules])

  const filteredHistory = useMemo(() => {
    return history.filter((entry) => {
      const payload = entry.payload || {}
      if (filterCompany !== 'all' && String(payload.company_code || '').toLowerCase() !== filterCompany.toLowerCase()) {
        return false
      }
      if (filterShift !== 'all' && String(payload.shift_type || '').toLowerCase() !== filterShift) {
        return false
      }
      return true
    })
  }, [history, filterCompany, filterShift])

  // Handlers
  const markDirty = (id: number) => {
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setSuccessMsg(null)
  }

  const handleFieldChange = <K extends EditableRuleField>(
    id: number,
    field: K,
    value: RuleRow[K],
  ) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } as RuleRow : r))
    )
    markDirty(id)
  }

  const handleNumberChange = (
    id: number,
    field:
      | 'base_per_shift'
      | 'senior_operator_bonus'
      | 'senior_cashier_bonus'
      | 'threshold1_turnover'
      | 'threshold1_bonus'
      | 'threshold2_turnover'
      | 'threshold2_bonus',
    value: string,
  ) => {
    const num = parseIntSafe(value)
    handleFieldChange(id, field, num)
  }

  const buildPayload = (row: RuleRow) => ({
    company_code: row.company_code.trim(),
    shift_type: row.shift_type,
    base_per_shift: parseIntSafe(row.base_per_shift ?? 0),
    senior_operator_bonus: parseIntSafe(row.senior_operator_bonus ?? 0),
    senior_cashier_bonus: parseIntSafe(row.senior_cashier_bonus ?? 0),
    threshold1_turnover: parseIntSafe(row.threshold1_turnover),
    threshold1_bonus: parseIntSafe(row.threshold1_bonus),
    threshold2_turnover: parseIntSafe(row.threshold2_turnover),
    threshold2_bonus: parseIntSafe(row.threshold2_bonus),
    is_active: row.is_active,
  })

  const handleSaveRow = async (row: RuleRow) => {
    setError(null)
    setSuccessMsg(null)
    setSavingId(row.id)

    try {
      const payload = buildPayload(row)

      // Check for duplicates
      const key = ruleKey(payload.company_code, payload.shift_type)
      const same = rules.filter(
        (x) => ruleKey(x.company_code, x.shift_type) === key && x.id !== row.id
      )
      if (same.length > 0) {
        throw new Error(
          `Дубликат: уже есть правило для "${payload.company_code}" + "${payload.shift_type}"`
        )
      }

      const response = await fetch('/api/admin/salary-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateRule',
          ruleId: row.id,
          payload,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Ошибка сохранения правила')
      }

      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })

      setSuccessMsg('Правило сохранено')
      await loadAll(true)
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка сохранения правила')
    } finally {
      setSavingId(null)
    }
  }

  const handleSaveAll = async () => {
    setError(null)
    setSuccessMsg(null)
    setSavingAll(true)

    try {
      const dirty = rules.filter((r) => dirtyIds.has(r.id))
      if (dirty.length === 0) {
        setSuccessMsg('Нечего сохранять')
        return
      }

      for (const row of dirty) {
        const payload = buildPayload(row)
        const key = ruleKey(payload.company_code, payload.shift_type)
        const same = rules.filter(
          (x) => ruleKey(x.company_code, x.shift_type) === key && x.id !== row.id
        )
        if (same.length > 0) {
          throw new Error(
            `Дубликат: уже есть правило для "${payload.company_code}" + "${payload.shift_type}"`
          )
        }

        const response = await fetch('/api/admin/salary-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'updateRule',
            ruleId: row.id,
            payload,
          }),
        })
        const json = await response.json().catch(() => null)
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Ошибка сохранения')
        }
      }

      setSuccessMsg('Все изменения сохранены')
      await loadAll(true)
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSavingAll(false)
    }
  }

  const handleAddRule = async () => {
    setError(null)
    setSuccessMsg(null)
    setAdding(true)

    try {
      const defaultCompany = (companyOptions[0]?.code || 'arena') as string

      // Find available shift
      const dayKey = ruleKey(defaultCompany, 'day')
      const nightKey = ruleKey(defaultCompany, 'night')
      const shift_type: ShiftType = !existingKeys.has(dayKey)
        ? 'day'
        : !existingKeys.has(nightKey)
          ? 'night'
          : 'day'

      if (existingKeys.has(ruleKey(defaultCompany, shift_type))) {
        throw new Error(
          `Уже есть правила для day и night у "${defaultCompany}". Выберите другую компанию.`
        )
      }

      const response = await fetch('/api/admin/salary-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createRule',
          payload: {
            company_code: defaultCompany,
            shift_type,
            base_per_shift: 8000,
            senior_operator_bonus: 1500,
            senior_cashier_bonus: 1500,
            threshold1_turnover: 130000,
            threshold1_bonus: 2000,
            threshold2_turnover: 160000,
            threshold2_bonus: 2000,
            is_active: true,
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Ошибка при создании правила')

      setRules((prev) => [...prev, json.data as RuleRow])
      setSuccessMsg('Новое правило добавлено')
      await loadAll(true)
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка при создании правила')
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteRule = async (id: number) => {
    if (!confirm('Удалить правило? Это действие нельзя отменить.')) return

    setError(null)
    setSuccessMsg(null)
    setDeletingId(id)

    try {
      const response = await fetch('/api/admin/salary-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteRule',
          ruleId: id,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Ошибка при удалении')
      }

      setSuccessMsg('Правило удалено')
      await loadAll(true)
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка при удалении')
    } finally {
      setDeletingId(null)
    }
  }

  const resetFilters = () => {
    setFilterCompany('all')
    setFilterShift('all')
    setShowInactive(false)
    setSearchTerm('')
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          <AdminPageHeader
            backHref="/salary"
            title="Правила расчёта зарплаты"
            description="Настройка окладов и бонусов для операторов"
            accent="violet"
            icon={<Settings className="h-5 w-5" aria-hidden />}
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-white/5 hover:bg-white/10 ${refreshing ? '[&_svg]:animate-spin' : ''}`}
                  onClick={() => void loadAll(true)}
                  title="Обновить"
                  aria-label="Обновить"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSaveAll()}
                  disabled={savingAll || dirtyIds.size === 0}
                  className="gap-2 rounded-xl border-white/10 bg-white/5 hover:bg-white/10"
                >
                  <Save className="h-4 w-4" />
                  {savingAll ? 'Сохранение...' : `Сохранить (${dirtyIds.size})`}
                </Button>

                <Button
                  size="sm"
                  className="gap-2 rounded-xl bg-violet-600 text-white hover:bg-violet-500"
                  onClick={() => void handleAddRule()}
                  disabled={adding}
                >
                  <Plus className="h-4 w-4" />
                  {adding ? 'Создание...' : 'Добавить правило'}
                </Button>
              </>
            }
            toolbar={
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                Правила привязаны к точкам и типам смен
              </p>
            }
          />

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <p className="text-xs text-gray-500">Всего правил</p>
              <p className="text-2xl font-bold text-white">{stats.total}</p>
            </Card>
            <Card className="p-4 bg-emerald-500/5 border-emerald-500/20">
              <p className="text-xs text-emerald-400">Активные</p>
              <p className="text-2xl font-bold text-emerald-400">{stats.active}</p>
            </Card>
            <Card className="p-4 bg-gray-500/5 border-gray-500/20">
              <p className="text-xs text-gray-400">Неактивные</p>
              <p className="text-2xl font-bold text-gray-400">{stats.inactive}</p>
            </Card>
            <Card className="p-4 bg-amber-500/5 border-amber-500/20">
              <p className="text-xs text-amber-400">Дневные</p>
              <p className="text-2xl font-bold text-amber-400">{stats.dayShifts}</p>
            </Card>
            <Card className="p-4 bg-indigo-500/5 border-indigo-500/20">
              <p className="text-xs text-indigo-400">Ночные</p>
              <p className="text-2xl font-bold text-indigo-400">{stats.nightShifts}</p>
            </Card>
          </div>

          {/* Info Card */}
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
            <Card className="p-4 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border-white/5">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-white font-medium">Базовый оклад</span>{' '}
                    <span className="text-gray-400">— фиксированная сумма за смену.</span>
                  </p>
                  <p>
                    <span className="text-white font-medium">Пороговые бонусы</span>{' '}
                    <span className="text-gray-400">
                      — если выручка ≥ порога, добавляется бонус.
                    </span>
                  </p>
                  <p>
                    <span className="text-white font-medium">Старшие роли</span>{' '}
                    <span className="text-gray-400">
                      — отдельная надбавка за старшего оператора и старшего кассира.
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Итог за смену = оклад + бонусы по выручке + надбавка по роли
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Быстрый обзор</p>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <span className="text-sm text-gray-400">Средний оклад</span>
                  <span className="text-base font-semibold text-white">{formatMoney(stats.avgBase)}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <span className="text-sm text-gray-400">Последнее изменение</span>
                  <span className="text-sm text-white">
                    {filteredHistory[0] ? formatDateTime(filteredHistory[0].created_at) : 'Пока нет'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <span className="text-sm text-gray-400">История по фильтру</span>
                  <span className="text-base font-semibold text-white">{filteredHistory.length}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Messages */}
          {error && (
            <Card className="p-4 border border-red-500/30 bg-red-500/10">
              <div className="flex items-center gap-2 text-red-300">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            </Card>
          )}

          {successMsg && (
            <Card className="p-4 border border-emerald-500/30 bg-emerald-500/10">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm">{successMsg}</span>
              </div>
            </Card>
          )}

          {/* Filters */}
          <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setFilterCompany('all')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterCompany === 'all'
                    ? 'bg-white text-gray-950'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                Все точки
              </button>
              {quickTabs.map((company) => {
                const code = company.code || ''
                const style = getCompanyStyle(code)
                const active = filterCompany === code
                return (
                  <button
                    key={company.id}
                    onClick={() => setFilterCompany(code)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? `${style.bg} ${style.border} ${style.text}`
                        : 'border-white/10 bg-white/[0.03] text-gray-400 hover:text-white'
                    }`}
                  >
                    {company.name}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-gray-500" />

              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="px-3 py-1.5 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все компании</option>
                {companyOptions.map(c => (
                  <option key={c.id} value={c.code || ''}>{c.name}</option>
                ))}
              </select>

              <select
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value as ShiftType | 'all')}
                className="px-3 py-1.5 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все смены</option>
                <option value="day">Дневные</option>
                <option value="night">Ночные</option>
              </select>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                />
                <span className="text-xs text-gray-400">Показывать неактивные</span>
              </label>

              <div className="flex-1" />

              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск по компании..."
                  className="pl-8 pr-7 py-1.5 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50"
                />
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {(filterCompany !== 'all' || filterShift !== 'all' || showInactive || searchTerm) && (
                <button
                  onClick={resetFilters}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  Сбросить
                </button>
              )}
            </div>
          </Card>

          {/* Rules Table */}
          <Card className="overflow-hidden border-white/5 bg-gray-900/40 p-0 backdrop-blur-xl">
            <AdminTableViewport maxHeight="min(70vh, 40rem)" className="rounded-none border-0 bg-transparent">
              <table className="w-full text-sm">
                <thead className={adminTableStickyTheadClass}>
                  <tr className="border-b border-white/5">
                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Компания</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Смена</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Оклад</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-cyan-400">Старший оператор</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-pink-400">Старший кассир</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Порог 1</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Бонус 1</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Порог 2</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Бонус 2</th>
                    <th className="py-3 px-4 text-center text-xs font-medium text-gray-400">Статус</th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Действия</th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-500">
                        Загрузка правил...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredRules.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-500">
                        {rules.length === 0
                          ? 'Правил ещё нет. Нажмите "Добавить правило"'
                          : 'Нет правил, соответствующих фильтрам'}
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    filteredRules.map((r) => {
                      const isDirty = dirtyIds.has(r.id)
                      const dup = rules.filter(
                        (x) =>
                          x.id !== r.id &&
                          ruleKey(x.company_code, x.shift_type) === ruleKey(r.company_code, r.shift_type)
                      ).length > 0
                      const companyStyle = getCompanyStyle(r.company_code)
                      const shiftStyle = SHIFT_LABELS[r.shift_type]

                      return (
                        <tr
                          key={r.id}
                          className={`border-t border-white/5 hover:bg-white/5 transition-colors ${
                            !r.is_active ? 'opacity-60' : ''
                          }`}
                        >
                          {/* Company */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${companyStyle.bg}`} />
                              <select
                                value={r.company_code}
                                onChange={(e) => handleFieldChange(r.id, 'company_code', e.target.value)}
                                className={`px-2 py-1 bg-gray-800/50 border rounded-lg text-xs ${
                                  dup ? 'border-red-500/50' : 'border-white/10'
                                }`}
                              >
                                {companyOptions.map((c) => (
                                  <option key={c.id} value={c.code || ''}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {dup && (
                              <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Дубликат
                              </div>
                            )}
                          </td>

                          {/* Shift */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <shiftStyle.icon className={`w-4 h-4 ${shiftStyle.color.split(' ')[0]}`} />
                              <select
                                value={r.shift_type}
                                onChange={(e) => handleFieldChange(r.id, 'shift_type', e.target.value as ShiftType)}
                                className="px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs"
                              >
                                <option value="day">День</option>
                                <option value="night">Ночь</option>
                              </select>
                            </div>
                          </td>

                          {/* Base per shift */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex flex-col items-end">
                              <input
                                type="number"
                                value={r.base_per_shift ?? ''}
                                onChange={(e) => handleNumberChange(r.id, 'base_per_shift', e.target.value)}
                                className="w-24 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                                placeholder="8000"
                              />
                              <span className="text-[10px] text-gray-500 mt-1">
                                {formatMoneyCompact(r.base_per_shift)}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.senior_operator_bonus ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'senior_operator_bonus', e.target.value)}
                              className="w-24 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="1500"
                            />
                          </td>

                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.senior_cashier_bonus ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'senior_cashier_bonus', e.target.value)}
                              className="w-24 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="1500"
                            />
                          </td>

                          {/* Threshold 1 */}
                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.threshold1_turnover ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'threshold1_turnover', e.target.value)}
                              className="w-24 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="130000"
                            />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.threshold1_bonus ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'threshold1_bonus', e.target.value)}
                              className="w-20 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="2000"
                            />
                          </td>

                          {/* Threshold 2 */}
                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.threshold2_turnover ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'threshold2_turnover', e.target.value)}
                              className="w-24 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="160000"
                            />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <input
                              type="number"
                              value={r.threshold2_bonus ?? ''}
                              onChange={(e) => handleNumberChange(r.id, 'threshold2_bonus', e.target.value)}
                              className="w-20 px-2 py-1 bg-gray-800/50 border border-white/10 rounded-lg text-xs text-right"
                              placeholder="2000"
                            />
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleFieldChange(r.id, 'is_active', !r.is_active)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] ${
                                r.is_active
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}
                            >
                              {r.is_active ? (
                                <>
                                  <Eye className="w-3 h-3" />
                                  Активно
                                </>
                              ) : (
                                <>
                                  <EyeOff className="w-3 h-3" />
                                  Неактивно
                                </>
                              )}
                            </button>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isDirty && (
                                <Button
                                  size="xs"
                                  className="h-7 px-2 bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 border-0"
                                  onClick={() => handleSaveRow(r)}
                                  disabled={savingId === r.id || dup}
                                >
                                  <Save className="w-3 h-3 mr-1" />
                                  {savingId === r.id ? '...' : 'Сохранить'}
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleDeleteRule(r.id)}
                                disabled={deletingId === r.id}
                                title="Удалить"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </AdminTableViewport>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">История изменений</h2>
                  <p className="text-sm text-gray-400">
                    Красивый журнал по изменениям правил без технических полей базы.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300">
                  {filteredHistory.length} событий
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {filteredHistory.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-gray-500">
                    По текущим фильтрам пока нет истории изменений.
                  </div>
                )}

                {filteredHistory.slice(0, 10).map((entry) => {
                  const payload = entry.payload || {}
                  const subject =
                    entry.action === 'update'
                      ? ((payload.next as Record<string, unknown> | undefined) || {})
                      : entry.action === 'delete'
                        ? ((payload.previous as Record<string, unknown> | undefined) || {})
                        : ((payload.next as Record<string, unknown> | undefined) || payload)
                  const companyCode = String(subject.company_code || '')
                  const companyName =
                    companyOptions.find((company) => company.code === companyCode)?.name || companyCode || 'Точка'
                  const highlights = buildHistoryHighlights(entry)

                  return (
                    <div
                      key={entry.id}
                      className={`rounded-3xl border p-4 ${getActionStyle(entry.action)}`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{getActionLabel(entry.action)}</p>
                          <p className="mt-1 text-sm text-gray-300">
                            {companyName} · {formatShiftText(subject.shift_type)}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {entry.actor_email || 'Система'} · {formatDateTime(entry.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {highlights.slice(0, 2).map((item) => (
                            <div
                              key={`${entry.id}-${item.label}`}
                              className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200"
                            >
                              <span className="text-gray-400">{item.label}:</span>{' '}
                              <span className="font-medium">{item.before}</span>
                              <span className="mx-1 text-gray-500">→</span>
                              <span className="font-medium text-white">{item.after}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {highlights.length > 2 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {highlights.slice(2).map((item) => (
                            <div
                              key={`${entry.id}-${item.label}-extra`}
                              className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200"
                            >
                              <span className="text-gray-400">{item.label}:</span>{' '}
                              <span className="font-medium">{item.before}</span>
                              <span className="mx-1 text-gray-500">→</span>
                              <span className="font-medium text-white">{item.after}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <h2 className="text-lg font-semibold text-white">Как использовать раздел</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                  <p className="font-medium text-white">1. Сначала выбери точку</p>
                  <p className="mt-1 text-gray-400">
                    Через быстрые вкладки сверху можно быстро перейти на F16 Arena, Ramen или Extra.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                  <p className="font-medium text-white">2. Настрой базу и бонусы</p>
                  <p className="mt-1 text-gray-400">
                    Для каждой смены отдельно задаются оклад, пороги выручки и надбавки для старших ролей.
                  </p>
                </div>
                <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                  <p className="font-medium text-white">3. Смотри историю</p>
                  <p className="mt-1 text-gray-400">
                    Ниже хранится понятный журнал: кто менял правило, на какой точке и что именно изменилось.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Bottom info */}
          <div className="flex justify-between items-center text-xs text-gray-500">
            <div>
              Показано {filteredRules.length} из {rules.length} правил
              {dirtyIds.size > 0 && (
                <span className="ml-2 text-amber-400">({dirtyIds.size} несохранённых)</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Arena
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Ramen
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                Extra
              </span>
            </div>
          </div>
        </div>
    </>
  )
}

// =====================
// EXPORT with Suspense
// =====================
export default function SalaryRulesPage() {
  return (
    <Suspense fallback={<SalaryRulesLoading />}>
      <SalaryRulesContent />
    </Suspense>
  )
}
