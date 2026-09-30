'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Briefcase,
  Download,
  History,
  Loader2,
  Pencil,
  Search,
  Send,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X as XIcon,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Skeleton, TableSkeleton } from '@/components/skeleton'
import { AppModal } from '@/components/ui/app-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { NativeSelect } from '@/components/ui/native-select'
import { SortableTh } from '@/components/ui/sortable-th'
import { toast } from '@/hooks/use-toast'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useTableSort } from '@/lib/client/use-table-sort'
import type { SortColumns } from '@/lib/core/table-sort'
import { cn } from '@/lib/utils'

import Avatar from './Avatar'
import CareerTimeline from './CareerTimeline'
import EmployeePanel, { type HrEmployee as PanelEmployee } from './EmployeePanel'
import HireModal from './HireModal'
import HrAnalytics from './HrAnalytics'
import PositionsOverview from './PositionsOverview'
import { InlineRoleDropdown, RowMenu } from './RowMenu'

// ─── Типы и справочники ──────────────────────────────────────────────

type DismissalType = 'voluntary' | 'mutual_agreement' | 'cause' | 'contract_end' | 'other'

const DISMISSAL_TYPE_LABELS: Record<DismissalType, string> = {
  voluntary: 'По собственному желанию',
  mutual_agreement: 'По соглашению сторон',
  cause: 'По статье',
  contract_end: 'Истёк срок договора',
  other: 'Другое',
}

type HrEmployee = {
  kind: 'staff' | 'operator'
  id: string
  full_name: string
  short_name: string | null
  position: string | null
  role: string | null
  phone: string | null
  email: string | null
  telegram_chat_id?: string | null
  photo_url?: string | null
  hire_date?: string | null
  has_login?: boolean
  last_login?: string | null
  is_active: boolean
  is_admin_staff?: boolean
  is_hybrid?: boolean
  company_ids?: string[]
  dismissed_at: string | null
  dismissal_date: string | null
  dismissal_type: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  dismissed_by_name: string | null
  monthly_salary: number | null
}

type HistoryEntry = {
  id: string
  action: string
  payload: any
  created_at: string
  actor_name: string | null
}

type Tab = 'active' | 'dismissed' | 'positions' | 'career' | 'analytics'
type KindFilter = 'all' | 'operator' | 'staff'
type ActiveSortKey = 'name' | 'role' | 'salary' | 'login'
type DismissedSortKey = 'name' | 'role' | 'dismissed'

const ACTION_LABEL: Record<string, string> = {
  dismiss: 'Уволен',
  restore: 'Восстановлен',
  create: 'Создан',
  update: 'Изменён',
  archive: 'В архив',
  activate: 'Активирован',
  deactivate: 'Деактивирован',
}

// ─── Помощники ───────────────────────────────────────────────────────

const empKey = (e: { kind: string; id: string }) => `${e.kind}-${e.id}`
const isDismissed = (e: HrEmployee) => !!e.dismissed_at || !e.is_active
const money = (v: number) => `${v.toLocaleString('ru-RU')} ₸`
const todayISO = () => new Date().toISOString().slice(0, 10)

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} дн назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function csvCell(v: string | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function kindLabel(e: HrEmployee) {
  if (e.is_hybrid) return 'Оператор + админ'
  return e.kind === 'operator' ? 'Оператор' : 'Администрация'
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

// ─── Страница ────────────────────────────────────────────────────────

export default function HrPage() {
  const { can } = useCapabilities()
  const canDismiss = can('hr.dismiss')
  const canRestore = can('hr.restore')
  const canViewHistory = can('hr.view_history')
  const canExport = can('hr.export')
  const canHire = can('staff.create') || can('operators.create')
  const canEdit = can('staff.edit') || can('operators.edit')

  const [items, setItems] = useState<HrEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<Array<{ name: string; label: string | null }>>([])
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([])

  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [noLoginOnly, setNoLoginOnly] = useState(false)

  const [hireOpen, setHireOpen] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState<PanelEmployee | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Увольнение одного сотрудника
  const [dismissTarget, setDismissTarget] = useState<HrEmployee | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [dismissDate, setDismissDate] = useState(todayISO)
  const [dismissType, setDismissType] = useState<DismissalType>('voluntary')
  const [pairedRecord, setPairedRecord] = useState<{ kind: 'staff' | 'operator'; id: string; name: string } | null>(null)
  const [pairedLoading, setPairedLoading] = useState(false)
  const [cascadeDismiss, setCascadeDismiss] = useState(true)

  // Массовое увольнение
  const [bulkDismissOpen, setBulkDismissOpen] = useState(false)
  const [bulkDismissReason, setBulkDismissReason] = useState('')

  // История действий — отдельным окном
  const [historyFor, setHistoryFor] = useState<HrEmployee | null>(null)
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryEntry[]>>({})
  const [historyLoading, setHistoryLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/hr', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить список')
      setItems(json.data || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    fetch('/api/admin/positions')
      .then((r) => r.json())
      .then((d) => setPositions((d.data || []).map((p: any) => ({ name: p.name, label: p.label || p.name }))))
      .catch(() => {})
    fetch('/api/admin/companies')
      .then((r) => r.json())
      .then((d) => setCompanies((d.data || []).map((c: any) => ({ id: String(c.id), name: String(c.name) }))))
      .catch(() => {})
  }, [])

  const companyName = useMemo(() => {
    const map = new Map(companies.map((c) => [c.id, c.name]))
    return (id: string) => map.get(id) || '—'
  }, [companies])

  // ─── Сводка ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const active = items.filter((e) => !isDismissed(e))
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    return {
      active: active.length,
      operators: active.filter((e) => e.kind === 'operator').length,
      staff: active.filter((e) => e.kind === 'staff').length,
      noLogin: active.filter((e) => e.has_login === false).length,
      payroll: active.reduce((s, e) => s + (e.monthly_salary || 0), 0),
      dismissed: items.length - active.length,
      dismissedMonth: items.filter((e) => isDismissed(e) && (e.dismissal_date || e.dismissed_at || '').slice(0, 10) >= monthAgo).length,
    }
  }, [items])

  // Должности, которые реально встречаются, — для фильтра
  const roleOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of items) if (e.role) set.add(e.role)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [items])

  // ─── Фильтрация ──────────────────────────────────────────────────
  const peopleTab = tab === 'active' || tab === 'dismissed'
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((e) => {
      if (tab === 'active' && isDismissed(e)) return false
      if (tab === 'dismissed' && !isDismissed(e)) return false
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      // Точка привязана только к операторам; администрация к точке не относится
      if (companyFilter !== 'all' && !(e.company_ids || []).includes(companyFilter)) return false
      if (roleFilter !== 'all' && e.role !== roleFilter) return false
      if (noLoginOnly && e.has_login !== false) return false
      if (q) {
        const hay = `${e.full_name} ${e.short_name || ''} ${e.role || ''} ${e.position || ''} ${e.phone || ''} ${e.email || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, tab, search, kindFilter, companyFilter, roleFilter, noLoginOnly])

  const activeColumns = useMemo<SortColumns<HrEmployee, ActiveSortKey>>(
    () => ({
      name: { get: (e) => e.full_name || null },
      role: { get: (e) => e.role || null },
      salary: { get: (e) => e.monthly_salary || null, defaultDir: 'desc' },
      login: { get: (e) => e.last_login || null, defaultDir: 'desc' },
    }),
    [],
  )
  const dismissedColumns = useMemo<SortColumns<HrEmployee, DismissedSortKey>>(
    () => ({
      name: { get: (e) => e.full_name || null },
      role: { get: (e) => e.role || null },
      dismissed: { get: (e) => e.dismissal_date || e.dismissed_at || null, defaultDir: 'desc' },
    }),
    [],
  )
  const activeSort = useTableSort<HrEmployee, ActiveSortKey>({
    storageKey: 'hr.activeSort',
    columns: activeColumns,
    initial: { key: 'name', dir: 'asc' },
    rows: tab === 'active' ? filtered : [],
  })
  const dismissedSort = useTableSort<HrEmployee, DismissedSortKey>({
    storageKey: 'hr.dismissedSort',
    columns: dismissedColumns,
    initial: { key: 'dismissed', dir: 'desc' },
    rows: tab === 'dismissed' ? filtered : [],
  })
  const rows = tab === 'dismissed' ? dismissedSort.sortedRows : activeSort.sortedRows

  // Выделение сбрасываем при смене вкладки и фильтров: иначе действие
  // применилось бы к невидимым сейчас людям
  useEffect(() => {
    setSelectedIds(new Set())
  }, [tab, kindFilter, companyFilter, roleFilter, noLoginOnly])

  const resetFilters = () => {
    setSearch('')
    setKindFilter('all')
    setCompanyFilter('all')
    setRoleFilter('all')
    setNoLoginOnly(false)
  }
  const hasFilters = !!search || kindFilter !== 'all' || companyFilter !== 'all' || roleFilter !== 'all' || noLoginOnly

  const employeeLabel = (kind: string, id: string) => items.find((e) => e.kind === kind && e.id === id)?.full_name || id
  const parseKey = (key: string) => {
    const idx = key.indexOf('-')
    return { kind: key.slice(0, idx), id: key.slice(idx + 1) } // id может содержать дефисы
  }

  const toggleSelected = (key: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const allSelected = rows.length > 0 && rows.every((e) => selectedIds.has(empKey(e)))
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(rows.map(empKey)))

  const openProfile = (e: HrEmployee) => {
    if (isDismissed(e) || !canEdit) return
    setSelectedEmp(e as unknown as PanelEmployee)
  }

  // ─── Действия ────────────────────────────────────────────────────
  const changeRoleInline = async (emp: HrEmployee, newRole: string) => {
    try {
      const res = await fetch('/api/admin/hr/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: emp.kind, id: emp.id, action: 'changeRole', payload: { role: newRole } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Ошибка запроса (${res.status})`)
      await load()
      toast({ title: 'Должность изменена' })
    } catch (e: any) {
      toast({ title: 'Не удалось сменить должность', description: e?.message, variant: 'destructive' })
    }
  }

  const bulkChangeRole = async (newRole: string) => {
    if (selectedIds.size === 0 || bulkBusy) return
    const total = selectedIds.size
    const ok = await confirmDialog({
      title: `Сменить должность на «${newRole}»?`,
      description: `Новая должность будет назначена ${total} ${plural(total, 'сотруднику', 'сотрудникам', 'сотрудникам')}.`,
      confirmLabel: 'Сменить',
    })
    if (!ok) return
    setBulkBusy(true)
    // Считаем отказы по каждому запросу, чтобы не рапортовать об успехе, когда сервер отказал
    const failures: string[] = []
    try {
      for (const key of selectedIds) {
        const { kind, id } = parseKey(key)
        try {
          const res = await fetch('/api/admin/hr/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, id, action: 'changeRole', payload: { role: newRole } }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
        } catch (e: any) {
          failures.push(`${employeeLabel(kind, id)}: ${e?.message || 'ошибка'}`)
        }
      }
      setSelectedIds(new Set())
      await load()
      const okCount = total - failures.length
      toast(
        failures.length
          ? { title: `Должность сменена у ${okCount} из ${total}`, description: failures.slice(0, 3).join('; '), variant: 'destructive' }
          : { title: `Должность сменена у ${okCount} ${plural(okCount, 'сотрудника', 'сотрудников', 'сотрудников')}` },
      )
    } finally {
      setBulkBusy(false)
    }
  }

  async function openDismiss(emp: HrEmployee) {
    setDismissTarget(emp)
    setDismissReason('')
    setDismissDate(todayISO())
    setDismissType('voluntary')
    setPairedRecord(null)
    setCascadeDismiss(true)
    setPairedLoading(true)
    try {
      const res = await fetch(`/api/admin/hr/paired?kind=${encodeURIComponent(emp.kind)}&id=${encodeURIComponent(emp.id)}`, {
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.paired) setPairedRecord(json.paired)
    } catch {
      // предупреждение о парной записи необязательное
    } finally {
      setPairedLoading(false)
    }
  }

  async function confirmDismiss() {
    if (!dismissTarget || busyId) return
    if (dismissReason.trim().length < 5) {
      toast({ title: 'Причина обязательна', description: 'Минимум 5 символов.', variant: 'destructive' })
      return
    }
    setBusyId(dismissTarget.id)
    try {
      const res = await fetch('/api/admin/hr/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: dismissTarget.kind,
          id: dismissTarget.id,
          reason: dismissReason.trim(),
          dismissal_date: dismissDate,
          dismissal_type: dismissType,
          cascade_paired: !!pairedRecord && cascadeDismiss,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось уволить')
      toast({ title: `${dismissTarget.full_name} уволен` })
      setHistoryCache((s) => {
        const copy = { ...s }
        delete copy[empKey(dismissTarget)]
        return copy
      })
      setDismissTarget(null)
      await load()
    } catch (e: any) {
      toast({ title: 'Не удалось уволить', description: e?.message, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const bulkDismiss = async () => {
    if (bulkBusy) return
    const reason = bulkDismissReason.trim()
    if (reason.length < 5) {
      toast({ title: 'Причина обязательна', description: 'Минимум 5 символов.', variant: 'destructive' })
      return
    }
    setBulkBusy(true)
    const failures: string[] = []
    const total = selectedIds.size
    try {
      for (const key of selectedIds) {
        const { kind, id } = parseKey(key)
        try {
          const res = await fetch('/api/admin/hr/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, id, reason, dismissal_date: todayISO(), dismissal_type: 'voluntary' }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        } catch (e: any) {
          failures.push(`${employeeLabel(kind, id)}: ${e?.message || 'ошибка'}`)
        }
      }
      setSelectedIds(new Set())
      setBulkDismissOpen(false)
      setBulkDismissReason('')
      await load()
      const okCount = total - failures.length
      toast(
        failures.length
          ? { title: `Уволено ${okCount} из ${total}`, description: failures.slice(0, 3).join('; '), variant: 'destructive' }
          : { title: `Уволено ${okCount} ${plural(okCount, 'сотрудник', 'сотрудника', 'сотрудников')}` },
      )
    } finally {
      setBulkBusy(false)
    }
  }

  async function restore(emp: HrEmployee) {
    const ok = await confirmDialog({
      title: `Восстановить ${emp.full_name}?`,
      description: 'Сотрудник снова станет активным.',
      confirmLabel: 'Восстановить',
    })
    if (!ok) return
    setBusyId(emp.id)
    try {
      const res = await fetch('/api/admin/hr/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: emp.kind, id: emp.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось восстановить')
      await load()
      toast({ title: `${emp.full_name} восстановлен` })
    } catch (e: any) {
      toast({ title: 'Не удалось восстановить', description: e?.message, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function openHistory(emp: HrEmployee) {
    setHistoryFor(emp)
    const key = empKey(emp)
    if (historyCache[key]) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/admin/hr/history?kind=${emp.kind}&id=${encodeURIComponent(emp.id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить историю')
      setHistoryCache((s) => ({ ...s, [key]: json.data || [] }))
    } catch (e: any) {
      toast({ title: 'Не удалось загрузить историю', description: e?.message, variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }

  const exportCSV = () => {
    const list = selectedIds.size > 0 ? rows.filter((e) => selectedIds.has(empKey(e))) : rows
    const header = ['Тип', 'ФИО', 'Краткое имя', 'Должность', 'Точки', 'Телефон', 'Email', 'Оклад', 'Активен', 'Уволен_дата', 'Причина']
    const csv = [
      header.join(';'),
      ...list.map((e) =>
        [
          kindLabel(e),
          csvCell(e.full_name),
          csvCell(e.short_name),
          csvCell(e.role || e.position),
          csvCell((e.company_ids || []).map(companyName).join(', ')),
          csvCell(e.phone),
          csvCell(e.email),
          e.monthly_salary != null ? String(e.monthly_salary) : '',
          isDismissed(e) ? 'нет' : 'да',
          e.dismissal_date || e.dismissed_at?.slice(0, 10) || '',
          csvCell(e.dismissal_reason),
        ].join(';'),
      ),
    ].join('\n')
    // BOM — чтобы Excel на Windows открыл кириллицу
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kadry-${todayISO()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const menuFor = (emp: HrEmployee) => {
    const dismissed = isDismissed(emp)
    return [
      { label: 'Открыть профиль', icon: Pencil, onClick: () => openProfile(emp), hidden: dismissed || !canEdit },
      { label: 'История действий', icon: History, onClick: () => void openHistory(emp), hidden: !canViewHistory },
      { label: 'Восстановить', icon: UserCheck, tone: 'success' as const, onClick: () => void restore(emp), hidden: !dismissed || !canRestore },
      { label: 'Уволить', icon: UserMinus, tone: 'danger' as const, onClick: () => void openDismiss(emp), hidden: dismissed || !canDismiss },
    ]
  }

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'active', label: 'Сотрудники', count: summary.active },
    { key: 'dismissed', label: 'Уволенные', count: summary.dismissed },
    { key: 'positions', label: 'Должности' },
    { key: 'career', label: 'Карьера' },
    { key: 'analytics', label: 'Аналитика' },
  ]

  // ─── Разметка ────────────────────────────────────────────────────
  return (
    <div className="app-page-wide space-y-5 pb-24">
      <AdminPageHeader
        title="Кадры"
        description="Сотрудники всех точек: операторы и администрация"
        icon={<Users className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          <div className="flex items-center gap-2">
            {canExport && peopleTab && (
              <Button variant="outline" size="sm" onClick={exportCSV} disabled={rows.length === 0}>
                <Download className="mr-1.5 h-4 w-4" />
                Экспорт{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
            )}
            {canHire && (
              <Button
                data-tour="hr-hire"
                size="sm"
                onClick={() => setHireOpen(true)}
                className="bg-amber-500 text-white shadow-lg shadow-amber-500/20 hover:bg-amber-400"
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                Нанять
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="В штате" value={summary.active} hint={`${summary.operators} опер. · ${summary.staff} адм.`} loading={loading && !items.length} />
        <SummaryTile label="ФОТ в месяц" value={money(summary.payroll)} hint="по окладам администрации" loading={loading && !items.length} />
        <SummaryTile
          label="Без входа в систему"
          value={summary.noLogin}
          hint={summary.noLogin > 0 ? 'нажмите, чтобы показать' : 'у всех есть логин'}
          tone={summary.noLogin > 0 ? 'warn' : 'default'}
          onClick={summary.noLogin > 0 ? () => { setTab('active'); setNoLoginOnly(true) } : undefined}
          loading={loading && !items.length}
        />
        <SummaryTile label="Уволено за 30 дней" value={summary.dismissedMonth} hint={`всего в архиве ${summary.dismissed}`} loading={loading && !items.length} />
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key ? 'border-amber-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs', tab === t.key ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-surface-muted text-muted-foreground')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'positions' ? (
        <PositionsOverview />
      ) : tab === 'career' ? (
        <CareerTimeline />
      ) : tab === 'analytics' ? (
        <HrAnalytics />
      ) : (
        <>
          {/* Фильтры — одна строка */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Имя, телефон, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <NativeSelect value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="sm:w-44">
                <option value="all">Все точки</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
              <NativeSelect value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)} className="sm:w-44">
                <option value="all">Все сотрудники</option>
                <option value="operator">Операторы</option>
                <option value="staff">Администрация</option>
              </NativeSelect>
              <NativeSelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="sm:w-44">
                <option value="all">Все должности</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </NativeSelect>
              {tab === 'active' && (
                <button
                  type="button"
                  onClick={() => setNoLoginOnly((v) => !v)}
                  className={cn(
                    'h-9 rounded-md border px-3 text-sm transition-colors',
                    noLoginOnly
                      ? 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-300'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                >
                  Без логина
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground lg:ml-auto">
              {hasFilters && (
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 hover:text-foreground">
                  <XIcon className="h-3.5 w-3.5" /> Сбросить
                </button>
              )}
              {!loading && (
                <span>
                  {rows.length} {plural(rows.length, 'человек', 'человека', 'человек')}
                </span>
              )}
            </div>
          </div>
          {companyFilter !== 'all' && kindFilter !== 'operator' && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Администрация к точкам не привязана — при выборе точки в списке только её операторы.
            </p>
          )}

          {/* Список */}
          {loading && items.length === 0 ? (
            <Card className="p-4">
              <TableSkeleton rows={8} cols={6} />
            </Card>
          ) : rows.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                {hasFilters ? 'Под фильтр никто не подходит' : tab === 'active' ? 'Сотрудников пока нет' : 'Уволенных нет'}
              </div>
              {hasFilters ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>Сбросить фильтры</Button>
              ) : tab === 'active' && canHire ? (
                <Button size="sm" onClick={() => setHireOpen(true)}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> Нанять первого
                </Button>
              ) : null}
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {/* Таблица — от md */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground [&_th]:px-4 [&_th]:py-3 [&_th]:font-medium">
                    <tr>
                      <th className="w-10">
                        <Checkbox checked={allSelected} onChange={toggleAll} label="Выделить всех" />
                      </th>
                      {tab === 'active' ? (
                        <>
                          <SortableTh label="Сотрудник" sortKey="name" sort={activeSort.sort} onSort={activeSort.toggle} />
                          <SortableTh label="Должность" sortKey="role" sort={activeSort.sort} onSort={activeSort.toggle} />
                          <th className="text-left">Точки</th>
                          <th className="text-left">Контакты</th>
                          <SortableTh label="Оклад" sortKey="salary" sort={activeSort.sort} onSort={activeSort.toggle} align="right" />
                          <SortableTh label="Вход" sortKey="login" sort={activeSort.sort} onSort={activeSort.toggle} />
                        </>
                      ) : (
                        <>
                          <SortableTh label="Сотрудник" sortKey="name" sort={dismissedSort.sort} onSort={dismissedSort.toggle} />
                          <SortableTh label="Должность" sortKey="role" sort={dismissedSort.sort} onSort={dismissedSort.toggle} />
                          <SortableTh label="Уволен" sortKey="dismissed" sort={dismissedSort.sort} onSort={dismissedSort.toggle} />
                          <th className="text-left">Причина</th>
                        </>
                      )}
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((emp) => {
                      const key = empKey(emp)
                      const selected = selectedIds.has(key)
                      const clickable = !isDismissed(emp) && canEdit
                      return (
                        <tr
                          key={key}
                          onClick={() => openProfile(emp)}
                          className={cn(
                            'transition-colors [&_td]:px-4 [&_td]:py-3 [&_td]:align-middle',
                            clickable && 'cursor-pointer',
                            selected ? 'bg-amber-500/[0.06]' : 'hover:bg-surface-hover/60',
                          )}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selected} onChange={() => toggleSelected(key)} label={`Выделить ${emp.full_name}`} />
                          </td>
                          <td>
                            <PersonCell emp={emp} />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {tab === 'active' && canEdit && emp.role ? (
                              <InlineRoleDropdown current={emp.role} positions={positions} onChange={(r) => void changeRoleInline(emp, r)} />
                            ) : (
                              <span className="text-body">{emp.role || '—'}</span>
                            )}
                          </td>
                          {tab === 'active' ? (
                            <>
                              <td>
                                <CompanyChips ids={emp.company_ids} name={companyName} />
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <Contacts emp={emp} />
                              </td>
                              <td className="whitespace-nowrap text-right tabular-nums text-body">
                                {emp.monthly_salary ? money(emp.monthly_salary) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="whitespace-nowrap">
                                <LoginCell emp={emp} />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="whitespace-nowrap">
                                <div className="text-body">{shortDate(emp.dismissal_date || emp.dismissed_at || '')}</div>
                                {emp.dismissal_type && (
                                  <div className="text-xs text-muted-foreground">
                                    {DISMISSAL_TYPE_LABELS[emp.dismissal_type as DismissalType] || emp.dismissal_type}
                                  </div>
                                )}
                              </td>
                              <td className="max-w-md">
                                <div className="line-clamp-2 text-body" title={emp.dismissal_reason || ''}>{emp.dismissal_reason || '—'}</div>
                                {emp.dismissed_by_name && <div className="text-xs text-muted-foreground">оформил: {emp.dismissed_by_name}</div>}
                              </td>
                            </>
                          )}
                          <td onClick={(e) => e.stopPropagation()} className="text-right">
                            <RowMenu busy={busyId === emp.id} actions={menuFor(emp)} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Карточки — на телефоне */}
              <div className="divide-y divide-border md:hidden">
                {rows.map((emp) => {
                  const key = empKey(emp)
                  const selected = selectedIds.has(key)
                  return (
                    <div
                      key={key}
                      onClick={() => openProfile(emp)}
                      className={cn('flex items-start gap-3 p-4', selected && 'bg-amber-500/[0.06]')}
                    >
                      <div onClick={(e) => e.stopPropagation()} className="pt-2">
                        <Checkbox checked={selected} onChange={() => toggleSelected(key)} label={`Выделить ${emp.full_name}`} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <PersonCell emp={emp} />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {emp.role && <span className="text-body">{emp.role}</span>}
                          {tab === 'active' ? (
                            <>
                              {emp.monthly_salary ? <span className="tabular-nums">{money(emp.monthly_salary)}</span> : null}
                              <LoginCell emp={emp} />
                            </>
                          ) : (
                            <span>уволен {shortDate(emp.dismissal_date || emp.dismissed_at || '')}</span>
                          )}
                        </div>
                        {tab === 'active' ? (
                          <CompanyChips ids={emp.company_ids} name={companyName} />
                        ) : emp.dismissal_reason ? (
                          <div className="text-xs italic text-muted-foreground">«{emp.dismissal_reason}»</div>
                        ) : null}
                        <div onClick={(e) => e.stopPropagation()}>
                          <Contacts emp={emp} />
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <RowMenu busy={busyId === emp.id} actions={menuFor(emp)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Панель массовых действий */}
      {peopleTab && selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-popover p-2 pl-4 shadow-2xl">
            <span className="text-sm font-medium text-foreground">
              Выбрано: {selectedIds.size}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {tab === 'active' && canEdit && positions.length > 0 && (
                <NativeSelect
                  defaultValue=""
                  disabled={bulkBusy}
                  onChange={(e) => {
                    const v = e.target.value
                    e.target.value = ''
                    if (v) void bulkChangeRole(v)
                  }}
                  className="h-8 w-auto text-sm"
                >
                  <option value="" disabled>
                    Сменить должность…
                  </option>
                  {positions.map((p) => (
                    <option key={p.name} value={p.name}>{p.label || p.name}</option>
                  ))}
                </NativeSelect>
              )}
              {canExport && (
                <Button size="sm" variant="outline" onClick={exportCSV}>
                  <Download className="mr-1 h-3.5 w-3.5" /> CSV
                </Button>
              )}
              {tab === 'active' && canDismiss && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkBusy}
                  onClick={() => {
                    setBulkDismissReason('')
                    setBulkDismissOpen(true)
                  }}
                >
                  {bulkBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserMinus className="mr-1 h-3.5 w-3.5" />}
                  Уволить
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} aria-label="Снять выделение">
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <HireModal open={hireOpen} onClose={() => setHireOpen(false)} onCreated={() => load()} />

      {/* Увольнение одного сотрудника */}
      <AppModal
        open={!!dismissTarget}
        onClose={() => { if (!busyId) setDismissTarget(null) }}
        title="Уволить сотрудника"
        description={dismissTarget ? `${dismissTarget.full_name} · ${kindLabel(dismissTarget).toLowerCase()}` : undefined}
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDismissTarget(null)} disabled={!!busyId}>Отмена</Button>
            <Button variant="destructive" onClick={() => void confirmDismiss()} disabled={!!dismissTarget && busyId === dismissTarget.id}>
              {dismissTarget && busyId === dismissTarget.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserMinus className="mr-2 h-4 w-4" />}
              Уволить
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-foreground">Дата увольнения</span>
              <DatePicker value={dismissDate} onChange={setDismissDate} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-foreground">Основание</span>
              <NativeSelect value={dismissType} onChange={(e) => setDismissType(e.target.value as DismissalType)} className="h-[46px] rounded-xl">
                {(Object.keys(DISMISSAL_TYPE_LABELS) as DismissalType[]).map((t) => (
                  <option key={t} value={t}>{DISMISSAL_TYPE_LABELS[t]}</option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-foreground">Причина</span>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Минимум 5 символов"
              rows={3}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring dark:bg-input/30"
            />
          </label>
          {pairedLoading ? (
            <div className="text-xs text-muted-foreground">Проверяем вторую запись сотрудника…</div>
          ) : pairedRecord ? (
            <label className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-amber-500"
                checked={cascadeDismiss}
                onChange={(e) => setCascadeDismiss(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">
                  Уволить и вторую запись «{pairedRecord.name}» ({pairedRecord.kind === 'operator' ? 'оператор' : 'администрация'})
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Иначе она останется активной, и человек продолжит числиться в структуре и зарплате.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </AppModal>

      {/* Массовое увольнение */}
      <AppModal
        open={bulkDismissOpen}
        onClose={() => { if (!bulkBusy) { setBulkDismissOpen(false); setBulkDismissReason('') } }}
        title={`Уволить ${selectedIds.size} ${plural(selectedIds.size, 'сотрудника', 'сотрудников', 'сотрудников')}?`}
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setBulkDismissOpen(false); setBulkDismissReason('') }} disabled={bulkBusy}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void bulkDismiss()} disabled={bulkBusy}>
              {bulkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserMinus className="mr-2 h-4 w-4" />}
              Уволить
            </Button>
          </div>
        }
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-foreground">Причина</span>
          <textarea
            value={bulkDismissReason}
            onChange={(e) => setBulkDismissReason(e.target.value)}
            placeholder="Минимум 5 символов"
            rows={3}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring dark:bg-input/30"
          />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Причина запишется всем выбранным, дата увольнения — сегодняшняя, основание — по собственному желанию.
        </p>
      </AppModal>

      {/* История действий */}
      <AppModal
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title="История действий"
        description={historyFor?.full_name}
        icon={<History className="h-5 w-5" />}
        maxWidth="max-w-lg"
      >
        {historyLoading && historyFor && !historyCache[empKey(historyFor)] ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : historyFor && (historyCache[empKey(historyFor)] || []).length > 0 ? (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {(historyCache[empKey(historyFor)] || []).map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-amber-500" />
                <div className="text-sm font-medium text-foreground">{ACTION_LABEL[h.action] || h.action}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(h.created_at).toLocaleString('ru-RU')}
                  {h.actor_name ? ` · ${h.actor_name}` : ''}
                </div>
                {h.action === 'dismiss' && h.payload?.reason && (
                  <div className="mt-1 text-xs italic text-muted-foreground">
                    {DISMISSAL_TYPE_LABELS[h.payload?.dismissal_type as DismissalType]
                      ? `${DISMISSAL_TYPE_LABELS[h.payload.dismissal_type as DismissalType]}: `
                      : ''}
                    «{h.payload.reason}»
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-sm text-muted-foreground">Записей нет</div>
        )}
      </AppModal>

      <EmployeePanel employee={selectedEmp} onClose={() => setSelectedEmp(null)} onUpdated={() => load()} />
    </div>
  )
}

// ─── Мелкие компоненты ───────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  hint,
  tone = 'default',
  onClick,
  loading,
  className,
}: {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'warn'
  onClick?: () => void
  loading?: boolean
  className?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-border bg-card px-4 py-3 text-left',
        onClick && 'transition-colors hover:border-orange-500/40',
        tone === 'warn' && 'border-orange-500/30',
        className,
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <div className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone === 'warn' ? 'text-orange-600 dark:text-orange-300' : 'text-foreground')}>
          {value}
        </div>
      )}
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </Tag>
  )
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-border accent-amber-500"
    />
  )
}

function PersonCell({ emp }: { emp: HrEmployee }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar
        name={emp.full_name || '?'}
        photoUrl={emp.photo_url}
        status={emp.kind === 'operator' && emp.has_login === false ? 'no-login' : null}
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{emp.full_name || '—'}</div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {emp.is_hybrid ? <Briefcase className="h-3 w-3 shrink-0 text-amber-500" /> : null}
          <span>{kindLabel(emp)}</span>
          {emp.short_name && emp.short_name !== emp.full_name && <span>· {emp.short_name}</span>}
        </div>
      </div>
    </div>
  )
}

function CompanyChips({ ids, name }: { ids?: string[]; name: (id: string) => string }) {
  if (!ids || ids.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {ids.slice(0, 3).map((id) => (
        <span key={id} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-body">
          {name(id)}
        </span>
      ))}
      {ids.length > 3 && <span className="px-1 text-xs text-muted-foreground">+{ids.length - 3}</span>}
    </div>
  )
}

function Contacts({ emp }: { emp: HrEmployee }) {
  if (!emp.phone && !emp.email && !emp.telegram_chat_id) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {emp.phone && (
        <a href={`tel:${emp.phone}`} className="whitespace-nowrap text-body hover:text-amber-600 dark:hover:text-amber-300">
          {emp.phone}
        </a>
      )}
      {emp.telegram_chat_id && (
        <a
          href={`tg://user?id=${emp.telegram_chat_id}`}
          title="Написать в Telegram"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-sky-500"
        >
          <Send className="h-3 w-3" /> TG
        </a>
      )}
      {emp.email && !emp.phone && <span className="max-w-[180px] truncate text-muted-foreground">{emp.email}</span>}
    </div>
  )
}

function LoginCell({ emp }: { emp: HrEmployee }) {
  if (emp.has_login === false) {
    return <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-xs text-orange-600 dark:text-orange-300">нет логина</span>
  }
  if (!emp.last_login) return <span className="text-xs text-muted-foreground">не входил</span>
  return (
    <span className="text-xs text-muted-foreground" title={new Date(emp.last_login).toLocaleString('ru-RU')}>
      {formatRelative(emp.last_login)}
    </span>
  )
}
