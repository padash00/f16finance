'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, ClipboardList, History, Loader2, MoreHorizontal, PackageCheck, RefreshCw, Search, XCircle } from 'lucide-react'
import { useCapabilities } from '@/lib/client/use-capabilities'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StorePanelSkeleton } from '@/components/store/store-panel-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue, useUrlState } from '@/lib/hooks/use-url-state'
import { isAbortError } from '@/lib/is-abort-error'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type InventoryRequestItem = {
  id: string
  requested_qty: number
  approved_qty: number | null
  comment: string | null
  available_qty?: number
  enough_for_requested?: boolean
  item?: { id: string; name: string; barcode: string } | null
}

type InventoryRequest = {
  id: string
  status: string
  comment: string | null
  decision_comment: string | null
  created_at: string
  approved_at: string | null
  issued_at: string | null
  received_at: string | null
  created_by: string | null
  approved_by: string | null
  issued_by: string | null
  received_by: string | null
  received_qty_confirmed: number | null
  created_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  approved_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  issued_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  received_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  company?: { id: string; name: string; code: string | null } | null
  source_location?: InventoryLocation | null
  target_location?: InventoryLocation | null
  items?: InventoryRequestItem[]
}

type InventoryResponse = {
  ok: boolean
  data?: {
    requests: InventoryRequest[]
  }
  error?: string
}

type DecisionDraft = {
  decisionComment: string
  quantities: Record<string, string>
}

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) || null
  return value ?? null
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizeRequest(raw: any): InventoryRequest {
  return {
    id: String(raw?.id || ''),
    status: String(raw?.status || 'new'),
    comment: raw?.comment || null,
    decision_comment: raw?.decision_comment || null,
    created_at: raw?.created_at || null,
    approved_at: raw?.approved_at || null,
    issued_at: raw?.issued_at || null,
    received_at: raw?.received_at || null,
    created_by: raw?.created_by ? String(raw.created_by) : null,
    approved_by: raw?.approved_by ? String(raw.approved_by) : null,
    issued_by: raw?.issued_by ? String(raw.issued_by) : null,
    received_by: raw?.received_by ? String(raw.received_by) : null,
    received_qty_confirmed: raw?.received_qty_confirmed == null ? null : Number(raw.received_qty_confirmed || 0),
    created_by_staff: firstOrSelf(raw?.created_by_staff),
    approved_by_staff: firstOrSelf(raw?.approved_by_staff),
    issued_by_staff: firstOrSelf(raw?.issued_by_staff),
    received_by_staff: firstOrSelf(raw?.received_by_staff),
    company: firstOrSelf(raw?.company),
    source_location: firstOrSelf(raw?.source_location),
    target_location: firstOrSelf(raw?.target_location),
    items: asArray(raw?.items).map((item: any) => ({
      id: String(item?.id || ''),
      requested_qty: Number(item?.requested_qty || 0),
      approved_qty: item?.approved_qty == null ? null : Number(item.approved_qty || 0),
      comment: item?.comment || null,
      available_qty: item?.available_qty == null ? undefined : Number(item.available_qty || 0),
      enough_for_requested: typeof item?.enough_for_requested === 'boolean' ? item.enough_for_requested : undefined,
      item: firstOrSelf(item?.item),
    })),
  }
}

function actorLabel(
  staff: { full_name: string | null; role: string | null } | null | undefined,
  fallbackId: string | null | undefined,
) {
  if (staff?.full_name) return staff.full_name
  if (fallbackId) return `ID ${fallbackId.slice(0, 8)}`
  return '—'
}

function requestTimeline(request: InventoryRequest) {
  return [
    { key: 'created', label: 'Создана', at: request.created_at, by: actorLabel(request.created_by_staff, request.created_by) },
    { key: 'approved', label: 'Одобрена', at: request.approved_at, by: actorLabel(request.approved_by_staff, request.approved_by) },
    { key: 'issued', label: 'Выдана', at: request.issued_at, by: actorLabel(request.issued_by_staff, request.issued_by) },
    { key: 'received', label: 'Получена', at: request.received_at, by: actorLabel(request.received_by_staff, request.received_by) },
  ]
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена полностью'
  if (status === 'approved_partial') return 'Одобрена частично'
  if (status === 'issued') return 'Выдана'
  if (status === 'received') return 'Получена'
  if (status === 'rejected') return 'Отклонена'
  if (status === 'disputed') return 'Спор'
  return 'Новая'
}

function requestStatusClass(status: string) {
  if (status === 'approved_full') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'approved_partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  if (status === 'issued') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  if (status === 'received') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200'
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200'
  if (status === 'disputed') return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-200'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
}

function RequestStatusBadge({ status }: { status: string }) {
  const label = requestStatusLabel(status)
  const cls = requestStatusClass(status)
  const icon = status === 'approved_full' ? <CheckCircle2 className="h-3 w-3" />
    : status === 'approved_partial' ? <CheckCircle2 className="h-3 w-3" />
    : status === 'issued' ? <PackageCheck className="h-3 w-3" />
    : status === 'received' ? <PackageCheck className="h-3 w-3" />
    : status === 'rejected' ? <XCircle className="h-3 w-3" />
    : <AlertCircle className="h-3 w-3" />
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  )
}

function createDecisionDraft(request: InventoryRequest): DecisionDraft {
  return {
    decisionComment: '',
    quantities: Object.fromEntries(asArray(request.items).map((item) => [item.id, formatQty(Number(item.requested_qty || 0))])),
  }
}

function requestItemsCount(request: InventoryRequest) {
  return asArray(request.items).reduce((sum, item) => sum + Number(item.requested_qty || 0), 0)
}

function StoreRequestsPageContent({ embedded = false }: { embedded?: boolean }) {
  const { can } = useCapabilities()
  const canApprove = can('store-requests.approve')
  const canBulkApprove = can('store-requests.bulk_approve')
  const canReject = can('store-requests.reject')
  const canBulkReject = can('store-requests.bulk_reject')
  const canIssue = can('store-requests.issue')
  const canReceive = can('store-requests.receive')
  const canUndecide = can('store-requests.undecide')

  const [requests, setRequests] = useState<InventoryRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [filters, setFilters] = useUrlState({
    q: '',
    status: 'all',
    actor: '',
    from: '',
    to: '',
  })
  const [searchInput, setSearchInput] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkSaving, setBulkSaving] = useState(false)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as InventoryResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить заявки магазина')
      }
      const normalizedRequests = asArray(json.data.requests).map(normalizeRequest).filter((request) => request.id)
      setRequests(normalizedRequests)
      setSelectedIds((prev) => prev.filter((id) => normalizedRequests.some((request) => request.id === id)))
      setDecisionDrafts((prev) => {
        const next = { ...prev }
        for (const request of normalizedRequests) {
          if (!next[request.id]) next[request.id] = createDecisionDraft(request)
        }
        return next
      })
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      setError(err?.message || 'Не удалось загрузить заявки магазина')
    } finally {
      if (!signal?.aborted) {
        if (soft) setRefreshing(false)
        else setLoading(false)
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    setSearchInput(filters.q)
  }, [filters.q])

  useEffect(() => {
    setFilters({ q: debouncedSearch })
  }, [debouncedSearch, setFilters])

  const filteredRequests = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return requests.filter((request) => {
      if (filters.status !== 'all' && request.status !== filters.status) return false

      const createdAt = request.created_at ? new Date(request.created_at) : null
      if (filters.from) {
        const from = new Date(`${filters.from}T00:00:00`)
        if (createdAt && createdAt < from) return false
      }
      if (filters.to) {
        const to = new Date(`${filters.to}T23:59:59`)
        if (createdAt && createdAt > to) return false
      }

      const actorQ = filters.actor.trim().toLowerCase()
      if (actorQ) {
        const actorText = [
          actorLabel(request.created_by_staff, request.created_by),
          actorLabel(request.approved_by_staff, request.approved_by),
          actorLabel(request.issued_by_staff, request.issued_by),
          actorLabel(request.received_by_staff, request.received_by),
        ].join(' ').toLowerCase()
        if (!actorText.includes(actorQ)) return false
      }

      if (!q) return true
      const haystack = [
        request.company?.name,
        request.source_location?.name,
        request.target_location?.name,
        request.comment,
        ...asArray(request.items).flatMap((item) => [item.item?.name, item.item?.barcode, item.comment]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [requests, filters])

  const pendingRequests = filteredRequests.filter((request) => request.status === 'new' || request.status === 'disputed')
  const readyToIssueRequests = filteredRequests.filter((request) =>
    ['approved_full', 'approved_partial'].includes(request.status),
  )
  const issuedAwaitingReceiveRequests = filteredRequests.filter((request) => request.status === 'issued')
  const historyRequests = filteredRequests.filter((request) => ['received', 'rejected'].includes(request.status))

  const stats = useMemo(() => {
    const totalRequested = pendingRequests.reduce((sum, request) => sum + requestItemsCount(request), 0)
    const totalApproved = filteredRequests.reduce(
      (sum, request) => sum + asArray(request.items).reduce((acc, item) => acc + Number(item.approved_qty || 0), 0),
      0,
    )
    return {
      pending: pendingRequests.length,
      toIssue: readyToIssueRequests.length,
      issued: issuedAwaitingReceiveRequests.length,
      history: historyRequests.length,
      totalRequested,
      totalApproved,
    }
  }, [filteredRequests])

  const updateDraft = (requestId: string, patch: Partial<DecisionDraft>) => {
    setDecisionDrafts((prev) => ({
      ...prev,
      [requestId]: {
        ...(prev[requestId] || { decisionComment: '', quantities: {} }),
        ...patch,
      },
    }))
  }

  const updateDraftQty = (requestId: string, requestItemId: string, value: string) => {
    setDecisionDrafts((prev) => ({
      ...prev,
      [requestId]: {
        ...(prev[requestId] || { decisionComment: '', quantities: {} }),
        quantities: {
          ...(prev[requestId]?.quantities || {}),
          [requestItemId]: value,
        },
      },
    }))
  }

  const undecideRequest = async (requestId: string) => {
    const reason = window.prompt('Откатить одобрение заявки? Товар вернётся на склад. Укажите причину (опционально):')
    if (reason === null) return
    setSavingId(requestId)
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undecideRequest', requestId, reason: reason || null }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Ошибка')
      setSuccess('Решение откачено, заявка вернулась в статус «Новая».')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const transitionStatus = async (requestId: string, status: 'issued' | 'received') => {
    setSavingId(requestId)
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'transitionStatus', requestId, status }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Ошибка')
      setSuccess(status === 'issued' ? 'Заявка отмечена как выданная.' : 'Заявка отмечена как полученная.')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const submitDecision = async (request: InventoryRequest, approved: boolean, fullApprove: boolean) => {
    setSavingId(request.id)
    setError(null)
    setSuccess(null)
    try {
      const draft = decisionDrafts[request.id] || createDecisionDraft(request)
      const items = approved
        ? asArray(request.items).map((item) => ({
            request_item_id: item.id,
            approved_qty: Number(
              fullApprove ? item.requested_qty : String(draft.quantities[item.id] ?? item.requested_qty).replace(',', '.'),
            ),
          }))
        : []

      const response = await fetch('/api/admin/inventory/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'decideRequest',
          requestId: request.id,
          approved,
          decision_comment: draft.decisionComment || null,
          items,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Не удалось обработать заявку')
      }

      setSuccess(approved ? 'Решение по заявке сохранено.' : 'Заявка отклонена.')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось обработать заявку')
    } finally {
      setSavingId(null)
    }
  }

  const toggleSelected = (requestId: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? (prev.includes(requestId) ? prev : [...prev, requestId]) : prev.filter((id) => id !== requestId)))
  }

  const toggleSelectAllPending = (checked: boolean) => {
    const pendingIds = pendingRequests.map((request) => request.id)
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, ...pendingIds])) : prev.filter((id) => !pendingIds.includes(id))))
  }

  const runBulkAction = async (action: 'approve-full' | 'reject') => {
    if (!selectedIds.length) return
    setBulkSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/admin/inventory/requests/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: selectedIds, action }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось выполнить массовое действие')
      const succeeded = Array.isArray(json?.data?.succeeded) ? json.data.succeeded.length : 0
      const failed = Array.isArray(json?.data?.failed) ? json.data.failed.length : 0
      setSuccess(
        action === 'approve-full'
          ? `Одобрено ${succeeded} из ${selectedIds.length}${failed ? `, не удалось ${failed}` : ''}.`
          : `Отклонено ${succeeded} из ${selectedIds.length}${failed ? `, не удалось ${failed}` : ''}.`,
      )
      setSelectedIds([])
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить массовое действие')
    } finally {
      setBulkSaving(false)
    }
  }

  const exportRequestsCsv = () => {
    const rows = filteredRequests.map((request) => ({
      request_id: request.id,
      status: request.status,
      company: request.company?.name || '',
      created_at: request.created_at || '',
      approved_at: request.approved_at || '',
      issued_at: request.issued_at || '',
      received_at: request.received_at || '',
      created_by: actorLabel(request.created_by_staff, request.created_by),
      approved_by: actorLabel(request.approved_by_staff, request.approved_by),
      issued_by: actorLabel(request.issued_by_staff, request.issued_by),
      items_requested: asArray(request.items).reduce((sum, item) => sum + Number(item.requested_qty || 0), 0),
      items_approved: asArray(request.items).reduce((sum, item) => sum + Number(item.approved_qty || 0), 0),
    }))
    if (rows.length === 0) return
    const headers = Object.keys(rows[0])
    const csv = [headers.join(',')]
      .concat(rows.map((row) => headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `requests-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {/* Header */}
      {(() => {
        const hdrActions = (
          <>
            <Link href="/store/requests-journal">
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <History className="h-3.5 w-3.5" />
                Журнал
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="h-9 gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  Действия
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Заявки</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportRequestsCsv}>
                  <ClipboardList className="h-4 w-4" />
                  Экспорт CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSearchInput('')
                    setFilters({ status: 'all', actor: '', from: '', to: '', q: '' })
                  }}
                >
                  <XCircle className="h-4 w-4" />
                  Сбросить фильтры
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
        const hdrToolbar = (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-0 flex-1 sm:w-auto sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Поиск по точке, товару или комментарию"
                className="h-9 pl-9"
              />
            </div>
            <Select value={filters.status} onValueChange={(value) => setFilters({ status: value })}>
              <SelectTrigger className="h-9 w-full sm:w-[200px]"><SelectValue placeholder="Все статусы" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="new">Новая</SelectItem>
                <SelectItem value="approved_full">Одобрена полностью</SelectItem>
                <SelectItem value="approved_partial">Одобрена частично</SelectItem>
                <SelectItem value="issued">Выдана</SelectItem>
                <SelectItem value="received">Получена</SelectItem>
                <SelectItem value="rejected">Отклонена</SelectItem>
                <SelectItem value="disputed">Спор</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={filters.actor}
              onChange={(event) => setFilters({ actor: event.target.value })}
              placeholder="Кто создавал/одобрял"
              className="h-9 w-full sm:w-[220px]"
            />
            <DatePicker value={filters.from} onChange={(v) => setFilters({ from: v })} className="w-full sm:w-[150px]" />
            <DatePicker value={filters.to} onChange={(v) => setFilters({ to: v })} className="w-full sm:w-[150px]" />
          </div>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {hdrToolbar}
            <div className="flex flex-wrap items-center gap-2">{hdrActions}</div>
          </div>
        ) : (
          <AdminPageHeader
            title="Заявки точек"
            description="Решения по пополнению витрин со склада"
            icon={<ClipboardList className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={hdrActions}
            toolbar={hdrToolbar}
          />
        )
      })()}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">Новые заявки</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-200">{stats.pending}</p>}
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">Ждёт выдачи</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-200">{stats.toIssue}</p>}
          <p className="mt-1 text-[10px] text-amber-700/60 dark:text-amber-200/60">Одобрено, не отмечено «выдано»</p>
        </Card>
        <Card className="border-teal-500/20 bg-teal-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-teal-700 dark:text-teal-300/70">В пути</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-teal-700 dark:text-teal-200">{stats.issued}</p>}
          <p className="mt-1 text-[10px] text-teal-700/60 dark:text-teal-200/60">Выдано со склада</p>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">История</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-200">{stats.history}</p>}
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">Запрошено</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-200">{stats.totalRequested}</p>}
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-300/70">Одобрено</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-200">{stats.totalApproved}</p>}
          <p className="mt-1 text-[10px] text-emerald-700/60 dark:text-emerald-200/60">Ед. по одобренным количествам</p>
        </Card>
      </div>

      {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-200">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-200">{success}</div> : null}
      {refreshing ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Обновление списка…
        </div>
      ) : null}

      {stats.pending > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-200">{stats.pending} {stats.pending === 1 ? 'новая заявка ждёт' : 'новых заявки ждут'} решения</span>
        </div>
      )}

      {/* Pending queue */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-amber-500"
            checked={pendingRequests.length > 0 && pendingRequests.every((request) => selectedIds.includes(request.id))}
            onChange={(event) => toggleSelectAllPending(event.target.checked)}
          />
          <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          Очередь на решение
          <span className="text-xs text-muted-foreground">({pendingRequests.length})</span>
        </div>

        {loading && pendingRequests.length === 0 ? (
          <StorePanelSkeleton cards={3} />
        ) : pendingRequests.length === 0 ? (
          <Card className="border-border bg-card/70 p-6 text-sm text-muted-foreground">
            В очереди нет новых заявок. Здесь будут появляться запросы кассиров на пополнение витрин.
          </Card>
        ) : (
          pendingRequests.map((request) => {
            const draft = decisionDrafts[request.id] || createDecisionDraft(request)
            const requestTotal = (request.items || []).reduce((sum, item) => sum + Number(item.requested_qty || 0), 0)

            return (
              <Card key={request.id} className="overflow-hidden border-border bg-card/70">
                <div className="border-b border-slate-200 dark:border-white/5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-amber-500"
                      checked={selectedIds.includes(request.id)}
                      onChange={(event) => toggleSelected(request.id, event.target.checked)}
                    />
                    <span className="text-base font-semibold text-foreground">
                      {request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'}
                    </span>
                    <RequestStatusBadge status={request.status} />
                    <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{formatDateTime(request.created_at)}</span>
                      <span>Создал: {actorLabel(request.created_by_staff, request.created_by)}</span>
                      <span>Источник: {request.source_location?.name || 'Склад'}</span>
                      <span>Позиций: {requestTotal}</span>
                    </div>
                  </div>
                  {request.comment ? <p className="mt-2 text-sm text-muted-foreground">{request.comment}</p> : null}
                </div>

                <div className="space-y-3 overflow-x-auto px-4 py-3">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-2 font-normal">Товар</th>
                        <th className="w-28 py-2 px-2 font-normal">Штрихкод</th>
                        <th className="w-20 py-2 px-2 text-right font-normal">Запрос</th>
                        <th className="w-28 py-2 px-2 text-right font-normal">На складе</th>
                        <th className="w-28 py-2 px-2 text-right font-normal">Одобрить</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/[0.04]">
                      {asArray(request.items).map((item) => (
                        <tr key={item.id}>
                          <td className="min-w-0 max-w-0 py-2 pr-2 align-middle">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="truncate text-sm font-medium">{item.item?.name || 'Товар'}</p>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" className="max-w-md">
                                {item.item?.name || 'Товар'}
                                {item.comment ? <div className="mt-1 text-xs text-muted-foreground">{item.comment}</div> : null}
                              </TooltipContent>
                            </Tooltip>
                            {item.comment ? <p className="truncate text-[11px] text-muted-foreground">{item.comment}</p> : null}
                          </td>
                          <td className="w-28 py-2 px-2 align-middle">
                            <span className="font-mono text-[11px] text-muted-foreground">{item.item?.barcode || '—'}</span>
                          </td>
                          <td className="w-20 py-2 px-2 text-right align-middle">
                            <span className="text-sm font-semibold">{formatQty(Number(item.requested_qty || 0))}</span>
                          </td>
                          <td className="w-28 py-2 px-2 text-right align-middle">
                            <div className="flex flex-col items-end">
                              <span
                                className={`text-sm font-semibold ${
                                  item.enough_for_requested === false ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'
                                }`}
                              >
                                {formatQty(Number(item.available_qty || 0))}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  item.enough_for_requested === false ? 'text-red-500/80 dark:text-red-400/80' : 'text-emerald-500/80 dark:text-emerald-400/80'
                                }`}
                              >
                                {item.enough_for_requested === false ? 'Не хватает' : 'Хватает'}
                              </span>
                            </div>
                          </td>
                          <td className="w-28 py-2 px-2 text-right align-middle">
                            <Input
                              value={draft.quantities[item.id] ?? formatQty(Number(item.requested_qty || 0))}
                              onChange={(event) => updateDraftQty(request.id, item.id, event.target.value)}
                              className="h-8 text-right"
                              inputMode="decimal"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Textarea
                      value={draft.decisionComment}
                      onChange={(event) => updateDraft(request.id, { decisionComment: event.target.value })}
                      placeholder="Комментарий к решению (необязательно)"
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex items-start gap-2">
                      <Button
                        onClick={() => submitDecision(request, true, false)}
                        disabled={savingId === request.id}
                        className="gap-2"
                      >
                        {savingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                        Сохранить
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" disabled={savingId === request.id}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Доп. действия</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => submitDecision(request, true, true)}>
                            <CheckCircle2 className="h-4 w-4" />
                            Одобрить полностью
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => submitDecision(request, true, false)}>
                            <PackageCheck className="h-4 w-4" />
                            Одобрить по количествам
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => submitDecision(request, false, false)}>
                            <XCircle className="h-4 w-4" />
                            Отклонить заявку
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Одобрено — отметить выдачу со склада (статус «Выдана») */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <PackageCheck className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          Одобрено — отметьте выдачу со склада
          <span className="text-xs text-muted-foreground">({readyToIssueRequests.length})</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Когда товар реально отдали с подсобки на точку, нажмите «Отметить выданной» — заявка перейдёт в статус «Выдана».
        </p>
        {readyToIssueRequests.length === 0 ? (
          <Card className="border-border bg-card/70 p-4 text-sm text-muted-foreground">
            Нет заявок в ожидании выдачи. После одобрения они появятся здесь.
          </Card>
        ) : (
          readyToIssueRequests.map((request) => {
            const items = asArray(request.items)
            const requested = items.reduce((sum, i) => sum + Number(i.requested_qty || 0), 0)
            const approved = items.reduce((sum, i) => sum + Number(i.approved_qty || 0), 0)
            const pointName = request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'
            return (
              <Card key={request.id} className="overflow-hidden border-amber-500/20 bg-card/70">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-white/5 px-4 py-3">
                  <RequestStatusBadge status={request.status} />
                  <span className="text-base font-semibold text-foreground">{pointName}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatQty(approved)} ед. к выдаче · {items.length} поз.
                    </span>
                    {canUndecide && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
                        disabled={savingId === request.id}
                        onClick={() => void undecideRequest(request.id)}
                      >
                        Откатить
                      </Button>
                    )}
                    {canIssue && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 bg-amber-600/90 text-foreground hover:bg-amber-600"
                        disabled={savingId === request.id}
                        onClick={() => void transitionStatus(request.id, 'issued')}
                      >
                        {savingId === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                        Отметить выданной
                      </Button>
                    )}
                  </div>
                </div>
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  {request.source_location?.name || 'Склад'} → {request.target_location?.name || 'Витрина'}
                  {' · '}
                  запрошено {formatQty(requested)}
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Выдано — подтвердить получение на точке */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <PackageCheck className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          Выдано — отметьте получение на точке
          <span className="text-xs text-muted-foreground">({issuedAwaitingReceiveRequests.length})</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Когда витрина приняла товар, нажмите «Отметить полученной» — статус станет «Получена».
        </p>
        {issuedAwaitingReceiveRequests.length === 0 ? (
          <Card className="border-border bg-card/70 p-4 text-sm text-muted-foreground">
            Нет заявок в статусе «Выдана».
          </Card>
        ) : (
          issuedAwaitingReceiveRequests.map((request) => {
            const items = asArray(request.items)
            const approved = items.reduce((sum, i) => sum + Number(i.approved_qty || 0), 0)
            const pointName = request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'
            return (
              <Card key={request.id} className="overflow-hidden border-teal-500/20 bg-card/70">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-white/5 px-4 py-3">
                  <RequestStatusBadge status={request.status} />
                  <span className="text-base font-semibold text-foreground">{pointName}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Выдано {formatDateTime(request.issued_at)} · {formatQty(approved)} ед.
                    </span>
                    {canReceive && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 bg-teal-600/90 text-foreground hover:bg-teal-600"
                        disabled={savingId === request.id}
                        onClick={() => void transitionStatus(request.id, 'received')}
                      >
                        {savingId === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Отметить полученной
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-white/95 dark:bg-[#0f172a]/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="text-sm text-amber-700 dark:text-amber-100">
            Выбрано заявок: <span className="font-semibold">{selectedIds.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {canBulkApprove && (
              <Button size="sm" onClick={() => runBulkAction('approve-full')} disabled={bulkSaving} className="gap-2">
                {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Одобрить
              </Button>
            )}
            {canBulkReject && (
              <Button size="sm" variant="destructive" onClick={() => runBulkAction('reject')} disabled={bulkSaving} className="gap-2">
                <XCircle className="h-4 w-4" />
                Отклонить
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setSelectedIds([])} disabled={bulkSaving}>
              Снять выбор
            </Button>
          </div>
        </div>
      ) : null}
    </div>
    </TooltipProvider>
  )
}

export default function StoreRequestsPage({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <Suspense fallback={null}>
      <StoreRequestsPageContent embedded={embedded} />
    </Suspense>
  )
}
