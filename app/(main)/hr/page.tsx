'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, AlertCircle, CheckSquare, ChevronDown, ChevronRight, Download, ExternalLink, LayoutGrid, List, Loader2, MoreVertical, Pencil, Search, Square, TrendingUp, UserMinus, UserCheck, UserPlus, Users, WifiOff, X as XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import HireModal from './HireModal'
import EmployeePanel, { type HrEmployee as PanelEmployee } from './EmployeePanel'
import CareerTimeline from './CareerTimeline'
import PositionsOverview from './PositionsOverview'
import HrAnalytics from './HrAnalytics'
import Avatar from './Avatar'
import { RowMenu, InlineRoleDropdown } from './RowMenu'

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const ms = Date.now() - d.getTime()
  const min = Math.floor(ms / 60000)
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
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

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
  dismissed_at: string | null
  dismissal_date: string | null
  dismissal_type: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  dismissed_by_name: string | null
  monthly_salary: number | null
}

type SortKey = 'name' | 'role' | 'hire_date' | 'salary'
type ViewMode = 'cards' | 'table'
type ChipFilter = 'all' | 'no_login' | 'hybrid' | 'today_birthday'

type HistoryEntry = {
  id: string
  action: string
  payload: any
  created_at: string
  actor_name: string | null
}

type Tab = 'active' | 'dismissed' | 'career' | 'positions' | 'analytics'
type KindFilter = 'all' | 'staff' | 'operator'
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })

const ACTION_LABEL: Record<string, string> = {
  dismiss: 'Уволен',
  restore: 'Восстановлен',
  create: 'Создан',
  update: 'Изменён',
  archive: 'В архив',
  activate: 'Активирован',
  deactivate: 'Деактивирован',
}

export default function HrPage() {
  const { can } = useCapabilities()
  const canDismiss = can('hr.dismiss')
  const canRestore = can('hr.restore')
  const canViewHistory = can('hr.view_history')
  const canHire = can('staff.create') || can('operators.create')
  const canEdit = can('staff.edit') || can('operators.edit')
  const [hireOpen, setHireOpen] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState<PanelEmployee | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [chipFilter, setChipFilter] = useState<ChipFilter>('all')
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [positions, setPositions] = useState<Array<{ name: string; label: string | null }>>([])
  const [editingRoleKey, setEditingRoleKey] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<'none' | 'role' | 'kind'>('none')
  const [items, setItems] = useState<HrEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('active')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dismissTarget, setDismissTarget] = useState<HrEmployee | null>(null)
  useModalEscape(!!dismissTarget, () => setDismissTarget(null))
  const [dismissReason, setDismissReason] = useState('')
  const [dismissDate, setDismissDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dismissType, setDismissType] = useState<DismissalType>('voluntary')
  const [pairedRecord, setPairedRecord] = useState<{ kind: 'staff' | 'operator'; id: string; name: string; role?: string | null } | null>(null)
  const [pairedLoading, setPairedLoading] = useState(false)
  const [cascadeDismiss, setCascadeDismiss] = useState(true)
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [historyData, setHistoryData] = useState<Record<string, HistoryEntry[]>>({})
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({})

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

  useEffect(() => { load() }, [])

  // Загрузка справочника должностей для inline-смены роли
  useEffect(() => {
    fetch('/api/admin/positions').then((r) => r.json()).then((d) => {
      setPositions((d.data || []).map((p: any) => ({ name: p.name, label: p.label || p.name })))
    }).catch(() => {})
  }, [])

  const counts = useMemo(() => {
    let active = 0, dismissed = 0
    for (const it of items) {
      // «Уволенные» = либо явно уволены, либо просто is_active=false
      // (старые архивные записи без dismissed_at)
      if (it.dismissed_at || !it.is_active) dismissed++
      else active++
    }
    return { active, dismissed }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = items.filter((it) => {
      const inactive = !it.is_active || !!it.dismissed_at
      if (tab === 'active' && inactive) return false
      if (tab === 'dismissed' && !inactive) return false
      if (kindFilter !== 'all' && it.kind !== kindFilter) return false
      // Smart-чипы
      if (chipFilter === 'no_login' && it.has_login !== false) return false
      if (chipFilter === 'hybrid' && !it.is_hybrid) return false
      if (q) {
        const hay = `${it.full_name} ${it.short_name || ''} ${it.position || ''} ${it.role || ''} ${it.phone || ''} ${it.email || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // Сортировка
    const sorted = [...list].sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      switch (sortKey) {
        case 'name': av = a.full_name || ''; bv = b.full_name || ''; break
        case 'role': av = a.role || ''; bv = b.role || ''; break
        case 'hire_date': av = a.hire_date || ''; bv = b.hire_date || ''; break
        case 'salary': av = a.monthly_salary || 0; bv = b.monthly_salary || 0; break
      }
      if (av < bv) return sortAsc ? -1 : 1
      if (av > bv) return sortAsc ? 1 : -1
      return 0
    })
    return sorted
  }, [items, tab, kindFilter, search, chipFilter, sortKey, sortAsc])

  // Группировка списка
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', items: filtered }]
    const map = new Map<string, HrEmployee[]>()
    for (const e of filtered) {
      const key =
        groupBy === 'role'
          ? (e.role || 'Без должности')
          : groupBy === 'kind'
            ? (e.is_hybrid ? 'Hybrid' : e.kind === 'operator' ? 'Операторы' : 'Админ-сотрудники')
            : 'all'
      const arr = map.get(key) || []
      arr.push(e)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, items]) => ({ key: k, label: k, items }))
  }, [filtered, groupBy])

  // Кол-во noLogin / hybrid для чипов (по текущей видимой вкладке)
  const chipCounts = useMemo(() => {
    let noLogin = 0
    let hybrid = 0
    const inActiveTab = items.filter((it) => {
      const inactive = !it.is_active || !!it.dismissed_at
      if (tab === 'active' && inactive) return false
      if (tab === 'dismissed' && !inactive) return false
      return true
    })
    for (const it of inActiveTab) {
      if (it.has_login === false) noLogin++
      if (it.is_hybrid) hybrid++
    }
    return { noLogin, hybrid, total: inActiveTab.length }
  }, [items, tab])

  // Inline-смена роли
  const changeRoleInline = async (emp: HrEmployee, newRole: string) => {
    setEditingRoleKey(null)
    try {
      const res = await fetch('/api/admin/hr/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: emp.kind, id: emp.id, action: 'changeRole', payload: { role: newRole } }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Ошибка')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка смены роли')
    }
  }

  // Bulk-смена роли
  const bulkChangeRole = async (newRole: string) => {
    if (selectedIds.size === 0) return
    if (!confirm(`Сменить должность на "${newRole}" для ${selectedIds.size} сотрудников?`)) return
    setBulkBusy(true)
    setError(null)
    try {
      for (const key of selectedIds) {
        const idx = key.indexOf('-')
        const kind = key.slice(0, idx)
        const id = key.slice(idx + 1)
        await fetch('/api/admin/hr/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id, action: 'changeRole', payload: { role: newRole } }),
        })
      }
      clearSelection()
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка bulk-смены роли')
    } finally {
      setBulkBusy(false)
    }
  }

  async function openDismiss(emp: HrEmployee) {
    setDismissTarget(emp)
    setDismissReason('')
    setDismissDate(new Date().toISOString().slice(0, 10))
    setDismissType('voluntary')
    setPairedRecord(null)
    setCascadeDismiss(true)
    setPairedLoading(true)
    try {
      const res = await fetch(
        `/api/admin/hr/paired?kind=${encodeURIComponent(emp.kind)}&id=${encodeURIComponent(emp.id)}`,
        { cache: 'no-store' },
      )
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.paired) {
        setPairedRecord(json.paired)
      }
    } catch {
      // молча: предупреждение про парную запись опционально
    } finally {
      setPairedLoading(false)
    }
  }

  async function confirmDismiss() {
    if (!dismissTarget) return
    if (dismissReason.trim().length < 5) {
      setError('Причина обязательна (≥ 5 символов)')
      return
    }
    setBusyId(dismissTarget.id)
    setError(null)
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
      setDismissTarget(null)
      setDismissReason('')
      setPairedRecord(null)
      setCascadeDismiss(true)
      setHistoryData((s) => {
        const copy = { ...s }
        delete copy[`${dismissTarget.kind}-${dismissTarget.id}`]
        return copy
      })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleHistory(emp: HrEmployee) {
    const key = `${emp.kind}-${emp.id}`
    const isOpen = historyOpen[key]
    if (isOpen) {
      setHistoryOpen((s) => ({ ...s, [key]: false }))
      return
    }
    setHistoryOpen((s) => ({ ...s, [key]: true }))
    if (historyData[key]) return
    setHistoryLoading((s) => ({ ...s, [key]: true }))
    try {
      const res = await fetch(`/api/admin/hr/history?kind=${emp.kind}&id=${encodeURIComponent(emp.id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить историю')
      setHistoryData((s) => ({ ...s, [key]: json.data || [] }))
    } catch (e: any) {
      setError(e?.message || 'Ошибка истории')
    } finally {
      setHistoryLoading((s) => ({ ...s, [key]: false }))
    }
  }

  async function restore(emp: HrEmployee) {
    if (!window.confirm(`Восстановить ${emp.full_name}? Сотрудник снова станет активным.`)) return
    setBusyId(emp.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/hr/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: emp.kind, id: emp.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось восстановить')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  // ─── Bulk selection ─────────────────────────────────────────
  const toggleSelected = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())
  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((e) => `${e.kind}-${e.id}`)))
  }

  // Сбрасываем выделение при смене таба/фильтра
  useEffect(() => {
    setSelectedIds(new Set())
  }, [tab, kindFilter])

  const bulkDismiss = async () => {
    const reason = window.prompt('Причина увольнения (≥ 5 символов):')
    if (!reason || reason.trim().length < 5) return
    if (!confirm(`Уволить ${selectedIds.size} ${selectedIds.size === 1 ? 'сотрудника' : 'сотрудников'}?`)) return
    setBulkBusy(true)
    setError(null)
    try {
      for (const key of selectedIds) {
        const [kind, id] = key.split('-', 2)
        // безопасный split: id может содержать дефисы
        const realId = key.slice(kind.length + 1)
        await fetch('/api/admin/hr/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            id: realId,
            reason: reason.trim(),
            dismissal_date: new Date().toISOString().slice(0, 10),
            dismissal_type: 'voluntary',
          }),
        })
      }
      clearSelection()
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка bulk-увольнения')
    } finally {
      setBulkBusy(false)
    }
  }

  const exportCSV = () => {
    const rows = (selectedIds.size > 0
      ? filtered.filter((e) => selectedIds.has(`${e.kind}-${e.id}`))
      : filtered) as HrEmployee[]
    const header = ['Тип', 'ФИО', 'Краткое имя', 'Должность', 'Телефон', 'Email', 'Оклад', 'Активен', 'Уволен_дата', 'Причина']
    const csv = [
      header.join(';'),
      ...rows.map((e) =>
        [
          e.kind === 'operator' ? 'Оператор' : 'Админ',
          csvCell(e.full_name),
          csvCell(e.short_name),
          csvCell(e.role || e.position),
          csvCell(e.phone),
          csvCell(e.email),
          e.monthly_salary != null ? String(e.monthly_salary) : '',
          e.is_active ? 'да' : 'нет',
          e.dismissal_date || e.dismissed_at?.slice(0, 10) || '',
          csvCell(e.dismissal_reason),
        ].join(';'),
      ),
    ].join('\n')
    // BOM для Excel'а на Windows
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Кадры"
        description="Активные и уволенные сотрудники: операторы и администрация"
        icon={<Users className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          canHire ? (
            <Button
              onClick={() => setHireOpen(true)}
              className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-500/20 h-10 sm:h-auto sm:px-5"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              Нанять
            </Button>
          ) : null
        }
        toolbar={
          <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:max-w-md">
            <Card className="px-3 py-2 border-emerald-500/25 bg-emerald-500/10">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300/90">Активные</div>
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-200">{counts.active}</div>
            </Card>
            <Card className="px-3 py-2 border-red-500/25 bg-red-500/10">
              <div className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-300/90">Уволенные</div>
              <div className="text-lg font-bold text-red-700 dark:text-red-200">{counts.dismissed}</div>
            </Card>
          </div>
        }
      />

      <HireModal open={hireOpen} onClose={() => setHireOpen(false)} onCreated={() => load()} />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <Card className="p-4 bg-white dark:bg-slate-900/70 border-slate-200 dark:border-slate-800">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTab('active')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'active'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              Активные · <span className="font-bold">{counts.active}</span>
            </button>
            <button
              onClick={() => setTab('dismissed')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'dismissed'
                  ? 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              Уволенные · <span className="font-bold">{counts.dismissed}</span>
            </button>
            <button
              onClick={() => setTab('career')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'career'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              Карьера
            </button>
            <button
              onClick={() => setTab('positions')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'positions'
                  ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              Должности
            </button>
            <button
              onClick={() => setTab('analytics')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'analytics'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              Аналитика
            </button>
          </div>

          <div className="xl:ml-auto flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm w-full sm:w-[240px]"
            >
              <option value="all">Все типы</option>
              <option value="operator">Только операторы</option>
              <option value="staff">Только админ-сотрудники</option>
            </select>
            <div className="relative w-full sm:w-[320px]">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Поиск по имени, телефону, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm w-full"
              />
            </div>
          </div>
        </div>
      </Card>

      {tab === 'career' ? (
        <CareerTimeline />
      ) : tab === 'positions' ? (
        <PositionsOverview />
      ) : tab === 'analytics' ? (
        <HrAnalytics />
      ) : (
        <>
        {/* Smart-чипы + view + sort */}
        {(tab === 'active' || tab === 'dismissed') && (
          <div className="p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-row flex-wrap items-center gap-2">
            <Chip active={chipFilter === 'all'} onClick={() => setChipFilter('all')} count={chipCounts.total}>Все</Chip>
            {chipCounts.noLogin > 0 && (
              <Chip active={chipFilter === 'no_login'} onClick={() => setChipFilter('no_login')} count={chipCounts.noLogin} tone="orange">Без логина</Chip>
            )}
            {chipCounts.hybrid > 0 && (
              <Chip active={chipFilter === 'hybrid'} onClick={() => setChipFilter('hybrid')} count={chipCounts.hybrid} tone="purple">Hybrid</Chip>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {/* Группировка */}
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'none' | 'role' | 'kind')}
                className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="none">Без группировки</option>
                <option value="role">По должности</option>
                <option value="kind">По типу</option>
              </select>
              {/* Sort */}
              <select
                value={`${sortKey}|${sortAsc ? 'a' : 'd'}`}
                onChange={(e) => {
                  const [k, dir] = e.target.value.split('|') as [SortKey, 'a' | 'd']
                  setSortKey(k)
                  setSortAsc(dir === 'a')
                }}
                className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
              >
                <option value="name|a">ФИО ↑</option>
                <option value="name|d">ФИО ↓</option>
                <option value="role|a">Должность ↑</option>
                <option value="role|d">Должность ↓</option>
                <option value="hire_date|d">Новые сначала</option>
                <option value="hire_date|a">Старые сначала</option>
                <option value="salary|d">Оклад ↓</option>
                <option value="salary|a">Оклад ↑</option>
              </select>
              {/* View toggle */}
              <div className="flex border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 ${viewMode === 'cards' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  title="Карточки"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 ${viewMode === 'table' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  title="Таблица"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk-action bar и экспорт */}
        {(tab === 'active' || tab === 'dismissed') && filtered.length > 0 && (
          <div className="p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-row flex-wrap items-center gap-2">
            <button
              onClick={selectedIds.size === filtered.length ? clearSelection : selectAllVisible}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              {selectedIds.size === filtered.length && filtered.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {selectedIds.size > 0 ? `Выделено: ${selectedIds.size}` : 'Выделить всех'}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <XIcon className="w-3 h-3" /> Снять
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {selectedIds.size > 0 && tab === 'active' && canEdit && positions.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) bulkChangeRole(e.target.value); e.target.value = '' }}
                  disabled={bulkBusy}
                  defaultValue=""
                  className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
                >
                  <option value="" disabled>Сменить должность…</option>
                  {positions.map((p) => <option key={p.name} value={p.name}>{p.label || p.name}</option>)}
                </select>
              )}
              {selectedIds.size > 0 && tab === 'active' && canDismiss && (
                <Button size="sm" variant="destructive" onClick={bulkDismiss} disabled={bulkBusy}>
                  {bulkBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserMinus className="w-3 h-3 mr-1" />}
                  Уволить {selectedIds.size}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportCSV} className="border-slate-200 dark:border-slate-700">
                <Download className="w-3 h-3 mr-1" />
                Экспорт CSV{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
            </div>
          </div>
        )}
      {/* Quick stats для табов active/dismissed */}
      {tab === 'active' && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-1">
          {(() => {
            const totalSalary = filtered.reduce((s, e) => s + (e.monthly_salary || 0), 0)
            const withSalary = filtered.filter((e) => (e.monthly_salary || 0) > 0).length
            const avgSalary = withSalary > 0 ? Math.round(totalSalary / withSalary) : 0
            const noLoginCount = filtered.filter((e) => e.has_login === false).length
            const hybridCount = filtered.filter((e) => e.is_hybrid).length
            return (
              <>
                <MiniStat label="Всего" value={filtered.length} tone="indigo" />
                <MiniStat label="ФОТ" value={`${totalSalary.toLocaleString('ru-RU')} ₸`} tone="emerald" />
                <MiniStat label="Средний оклад" value={`${avgSalary.toLocaleString('ru-RU')} ₸`} tone="blue" />
                <MiniStat label="Без логина" value={noLoginCount} tone={noLoginCount > 0 ? 'orange' : 'gray'} />
              </>
            )
          })()}
        </div>
      )}
      <div className="flex items-center justify-between px-1">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {tab === 'active' ? 'Список активных сотрудников' : 'Список уволенных сотрудников'}
        </div>
        {!loading && filtered.length > 0 ? (
          <div className="text-xs text-slate-500">
            Найдено: <span className="text-slate-700 dark:text-slate-300 font-semibold">{filtered.length}</span>
          </div>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <Card className="py-12 text-center text-muted-foreground bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
          Загрузка...
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
          {tab === 'active' ? 'Активных сотрудников не найдено' : 'Уволенных сотрудников нет'}
        </Card>
      ) : viewMode === 'table' ? (
        <Card className="bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800/40 text-[11px] uppercase tracking-wider text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Сотрудник</th>
                  <th className="text-left px-3 py-2">Тип</th>
                  <th className="text-left px-3 py-2">Должность</th>
                  <th className="text-left px-3 py-2">Контакты</th>
                  <th className="text-right px-3 py-2">Оклад</th>
                  <th className="text-center px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => {
                  const empKey = `${emp.kind}-${emp.id}`
                  const isSelected = selectedIds.has(empKey)
                  const dismissed = !!emp.dismissed_at || !emp.is_active
                  return (
                    <tr
                      key={empKey}
                      className={`border-t border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition ${isSelected ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <button onClick={() => toggleSelected(empKey)}>
                          {isSelected ? <CheckSquare className="w-4 h-4 text-amber-400" /> : <Square className="w-4 h-4 text-slate-600" />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={emp.full_name || '?'}
                            photoUrl={emp.photo_url}
                            size="sm"
                            status={emp.kind === 'operator' ? (emp.has_login === false ? 'no-login' : null) : null}
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-white truncate max-w-[200px]">{emp.full_name || '—'}</div>
                            {emp.short_name && <div className="text-[10px] text-slate-500 truncate">{emp.short_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                          emp.is_hybrid ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                          : emp.kind === 'operator' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10'
                          : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                        }`}>
                          {emp.is_hybrid ? 'Hybrid' : emp.kind === 'operator' ? 'Operator' : 'Admin'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 text-xs">{emp.role || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {emp.phone && <div className="text-slate-700 dark:text-slate-300">{emp.phone}</div>}
                        {emp.email && <div className="text-slate-500 truncate max-w-[200px]">{emp.email}</div>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-700 dark:text-slate-300 font-mono">
                        {emp.monthly_salary != null ? emp.monthly_salary.toLocaleString('ru-RU') : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-end gap-1">
                          {!dismissed && canEdit && (
                            <button
                              onClick={() => setSelectedEmp(emp as unknown as PanelEmployee)}
                              className="p-1.5 rounded hover:bg-amber-500/10 text-amber-600 dark:text-amber-300"
                              title="Профиль"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {dismissed && canRestore && (
                            <button
                              onClick={() => restore(emp)}
                              className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                              title="Восстановить"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!dismissed && canDismiss && (
                            <button
                              onClick={() => openDismiss(emp)}
                              className="p-1.5 rounded hover:bg-red-500/10 text-red-400"
                              title="Уволить"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.key}>
              {group.label && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{group.label}</h3>
                  <span className="text-xs text-slate-600">·</span>
                  <span className="text-xs text-slate-500">{group.items.length}</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800 ml-2" />
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {group.items.map((emp) => {
            const busy = busyId === emp.id
            // dismissed = либо явно уволен, либо просто архивный (is_active=false)
            const dismissed = !!emp.dismissed_at || !emp.is_active
            const empKey = `${emp.kind}-${emp.id}`
            const isSelected = selectedIds.has(empKey)
            return (
              <Card
                key={empKey}
                className={`p-5 flex items-start justify-between gap-4 border shadow-sm transition ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/50'
                    : dismissed
                      ? 'bg-red-500/5 border-red-500/25'
                      : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-amber-500/40 hover:bg-slate-50 dark:hover:bg-slate-900/80'
                }`}
              >
                <button
                  onClick={() => toggleSelected(empKey)}
                  className="mt-0.5 shrink-0 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title={isSelected ? 'Снять выделение' : 'Выделить'}
                >
                  {isSelected ? <CheckSquare className="w-4 h-4 text-amber-400" /> : <Square className="w-4 h-4" />}
                </button>
                <Avatar
                  name={emp.full_name || '?'}
                  photoUrl={emp.photo_url}
                  status={emp.kind === 'operator' ? (emp.has_login === false ? 'no-login' : null) : null}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{emp.full_name || '—'}</span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                      (emp as any).is_hybrid
                        ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                        : emp.kind === 'operator'
                          ? 'border-blue-500/40 text-blue-400 bg-blue-500/10'
                          : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                    }`}>
                      {(emp as any).is_hybrid ? 'Hybrid' : emp.kind === 'operator' ? 'Оператор' : 'Админ'}
                    </span>
                    {emp.role && !dismissed && canEdit ? (
                      <>
                        <span className="text-slate-600">·</span>
                        <InlineRoleDropdown
                          current={emp.role}
                          positions={positions}
                          onChange={(newRole) => changeRoleInline(emp, newRole)}
                        />
                      </>
                    ) : emp.role ? (
                      <span className="text-[10px] uppercase text-muted-foreground">· {emp.role}</span>
                    ) : null}
                    {emp.position && (
                      <span className="text-[10px] uppercase text-muted-foreground">· {emp.position}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {emp.phone && (
                      <a href={`tel:${emp.phone}`} className="hover:text-amber-600 dark:hover:text-amber-300 transition-colors">📞 {emp.phone}</a>
                    )}
                    {emp.email && (
                      <a href={`mailto:${emp.email}`} className="hover:text-amber-600 dark:hover:text-amber-300 transition-colors truncate">✉ {emp.email}</a>
                    )}
                    {emp.telegram_chat_id && (
                      <a href={`tg://user?id=${emp.telegram_chat_id}`} className="hover:text-amber-600 dark:hover:text-amber-300 transition-colors">📨 Telegram</a>
                    )}
                    {emp.monthly_salary != null && emp.monthly_salary > 0 && (
                      <span>💰 {emp.monthly_salary.toLocaleString('ru-RU')} ₸/мес</span>
                    )}
                    {emp.last_login && (
                      <span className="text-slate-500" title={emp.last_login}>
                        🕒 {formatRelative(emp.last_login)}
                      </span>
                    )}
                  </div>
                  {dismissed && (
                    <div className="mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs">
                      <div className="text-red-700 dark:text-red-300 font-medium flex flex-wrap gap-x-2">
                        <span>Уволен: {shortDate(emp.dismissal_date || emp.dismissed_at!)}</span>
                        {emp.dismissed_by_name && <span>· кем: {emp.dismissed_by_name}</span>}
                        {emp.dismissal_type && (
                          <span className="px-1.5 py-0.5 rounded border border-red-500/40 text-[10px] uppercase">
                            {DISMISSAL_TYPE_LABELS[emp.dismissal_type as DismissalType] || emp.dismissal_type}
                          </span>
                        )}
                      </div>
                      {emp.dismissal_reason && (
                        <div className="text-muted-foreground italic mt-1">«{emp.dismissal_reason}»</div>
                      )}
                    </div>
                  )}

                  {canViewHistory && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleHistory(emp)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500 transition"
                      >
                        {historyOpen[`${emp.kind}-${emp.id}`] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        История действий
                      </button>
                    </div>
                  )}

                  {canViewHistory && historyOpen[`${emp.kind}-${emp.id}`] && (
                    <div className="mt-2 pl-2 border-l border-slate-200 dark:border-slate-700 text-xs space-y-1">
                      {historyLoading[`${emp.kind}-${emp.id}`] ? (
                        <div className="text-slate-500 italic">Загрузка истории…</div>
                      ) : (historyData[`${emp.kind}-${emp.id}`] || []).length === 0 ? (
                        <div className="text-slate-500 italic">Нет записей</div>
                      ) : (
                        (historyData[`${emp.kind}-${emp.id}`] || []).map((h) => (
                          <div key={h.id} className="text-slate-500 dark:text-slate-400">
                            <span className="text-slate-700 dark:text-slate-300">{ACTION_LABEL[h.action] || h.action}</span>
                            <span className="text-slate-500"> · {new Date(h.created_at).toLocaleString('ru-RU')}</span>
                            {h.actor_name && <span className="text-slate-500"> · {h.actor_name}</span>}
                            {h.action === 'dismiss' && h.payload?.reason && (
                              <div className="italic text-slate-500 ml-2">
                                {h.payload?.dismissal_type && DISMISSAL_TYPE_LABELS[h.payload.dismissal_type as DismissalType] && (
                                  <>[{DISMISSAL_TYPE_LABELS[h.payload.dismissal_type as DismissalType]}] </>
                                )}
                                «{h.payload.reason}»
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  <RowMenu
                    busy={busy}
                    actions={[
                      {
                        label: 'Открыть профиль',
                        icon: Pencil,
                        onClick: () => setSelectedEmp(emp as unknown as PanelEmployee),
                        hidden: dismissed || !canEdit,
                      },
                      {
                        label: 'Восстановить',
                        icon: UserCheck,
                        tone: 'success',
                        onClick: () => restore(emp),
                        hidden: !dismissed || !canRestore,
                      },
                      {
                        label: 'Уволить',
                        icon: UserMinus,
                        tone: 'danger',
                        onClick: () => openDismiss(emp),
                        hidden: dismissed || !canDismiss,
                      },
                    ]}
                  />
                </div>
              </Card>
            )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {dismissTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDismissTarget(null)}>
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 text-slate-900 dark:text-white">Уволить сотрудника</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {dismissTarget.full_name} ({dismissTarget.kind === 'operator' ? 'оператор' : 'админ'})
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-900 dark:text-white">Дата увольнения</label>
                <input
                  type="date"
                  value={dismissDate}
                  onChange={(e) => setDismissDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-900 dark:text-white">Тип</label>
                <select
                  value={dismissType}
                  onChange={(e) => setDismissType(e.target.value as DismissalType)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {(Object.keys(DISMISSAL_TYPE_LABELS) as DismissalType[]).map((t) => (
                    <option key={t} value={t}>{DISMISSAL_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="block text-sm font-medium mb-1 text-slate-900 dark:text-white">Причина увольнения</label>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Укажите причину (минимум 5 символов)"
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm mb-4"
            />
            {pairedLoading ? (
              <div className="mb-4 text-xs text-slate-500">Проверяем парную запись…</div>
            ) : pairedRecord ? (
              <label className="mb-4 flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-100">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-amber-400"
                  checked={cascadeDismiss}
                  onChange={(e) => setCascadeDismiss(e.target.checked)}
                />
                <span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    У сотрудника также есть запись «{pairedRecord.name}»
                    {' '}({pairedRecord.kind === 'operator' ? 'оператор' : 'админ'}).
                  </span>
                  <span className="block text-xs text-amber-700 dark:text-amber-200/80 mt-0.5">
                    Уволить и её одной операцией. Это безопасно: иначе парная запись останется
                    активной и сотрудник продолжит висеть в /structure и /salary.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDismissTarget(null)}>Отмена</Button>
              <Button variant="destructive" onClick={confirmDismiss} disabled={busyId === dismissTarget.id}>
                {busyId === dismissTarget.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserMinus className="w-4 h-4 mr-2" />}
                Уволить
              </Button>
            </div>
          </div>
        </div>
      )}

      <EmployeePanel
        employee={selectedEmp}
        onClose={() => setSelectedEmp(null)}
        onUpdated={() => load()}
      />
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone = 'indigo',
}: {
  label: string
  value: number | string
  tone?: 'indigo' | 'emerald' | 'blue' | 'orange' | 'gray'
}) {
  const toneMap = {
    indigo: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    orange: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    gray: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400',
  }
  return (
    <div className={`px-3 py-2 rounded-lg border ${toneMap[tone]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-90">{label}</div>
      <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5 truncate">{value}</div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  count,
  tone = 'indigo',
  children,
}: {
  active?: boolean
  onClick?: () => void
  count?: number
  tone?: 'indigo' | 'orange' | 'purple'
  children: React.ReactNode
}) {
  const toneMap = {
    indigo: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10',
    orange: 'border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-500/10',
    purple: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10',
  }
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
        active ? toneMap[tone] + ' ring-1 ring-current/20' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500'
      }`}
    >
      <span>{children}</span>
      {count != null && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-amber-500/20 dark:bg-white/10' : 'bg-slate-100 dark:bg-slate-800'}`}>
          {count}
        </span>
      )}
    </button>
  )
}
