'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDebouncedValue, useUrlState } from '@/lib/hooks/use-url-state'
import { isAbortError } from '@/lib/is-abort-error'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  item?: { id: string; name: string; barcode: string } | null
}

type StaffRef = { id: string; full_name: string | null; role: string | null } | null

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
  received_qty_confirmed: number | null
  created_by_staff?: StaffRef
  approved_by_staff?: StaffRef
  issued_by_staff?: StaffRef
  received_by_staff?: StaffRef
  company?: { id: string; name: string; code: string | null } | null
  source_location?: InventoryLocation | null
  target_location?: InventoryLocation | null
  items?: InventoryRequestItem[]
}

type InventoryResponse = {
  ok: boolean
  data?: { requests: InventoryRequest[] }
  error?: string
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
      item: firstOrSelf(item?.item),
    })),
  }
}

function actorLabel(staff: StaffRef | undefined, fallbackId: string | null | undefined) {
  if (staff?.full_name) return staff.full_name
  if (fallbackId) return `ID ${fallbackId.slice(0, 8)}`
  return '—'
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
  if (status === 'approved_full') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'approved_partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (status === 'issued') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
  if (status === 'received') return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (status === 'disputed') return 'border-orange-500/30 bg-orange-500/10 text-orange-200'
  return 'border-violet-500/30 bg-violet-500/10 text-violet-200'
}

function RequestStatusBadge({ status }: { status: string }) {
  const label = requestStatusLabel(status)
  const cls = requestStatusClass(status)
  const icon =
    status === 'approved_full' || status === 'approved_partial' ? (
      <CheckCircle2 className="h-3 w-3" />
    ) : status === 'issued' || status === 'received' ? (
      <PackageCheck className="h-3 w-3" />
    ) : status === 'rejected' ? (
      <XCircle className="h-3 w-3" />
    ) : (
      <AlertCircle className="h-3 w-3" />
    )
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      {icon}
      {label}
    </span>
  )
}

function requestTimeline(request: InventoryRequest) {
  return [
    {
      key: 'created',
      label: 'Создана',
      at: request.created_at,
      by: actorLabel(request.created_by_staff, request.created_by),
    },
    {
      key: 'approved',
      label: 'Одобрена',
      at: request.approved_at,
      by: actorLabel(request.approved_by_staff, request.approved_by),
    },
    {
      key: 'issued',
      label: 'Выдана',
      at: request.issued_at,
      by: actorLabel(request.issued_by_staff, request.issued_by),
    },
    {
      key: 'received',
      label: 'Получена',
      at: request.received_at,
      by: actorLabel(request.received_by_staff, null),
    },
  ]
}

function StoreRequestsJournalPageContent() {
  const [requests, setRequests] = useState<InventoryRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<InventoryRequest | null>(null)
  const [requestDetailsOpen, setRequestDetailsOpen] = useState(false)
  const [filters, setFilters] = useUrlState({
    q: '',
    status: 'all',
    actor: '',
    from: '',
    to: '',
  })
  const [searchInput, setSearchInput] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as InventoryResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить журнал заявок')
      }
      const normalizedRequests = asArray(json.data.requests).map(normalizeRequest).filter((r) => r.id)
      setRequests(normalizedRequests)
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      setError(err?.message || 'Не удалось загрузить журнал заявок')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (!requestDetailsOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [requestDetailsOpen])

  useEffect(() => {
    setSearchInput(filters.q)
  }, [filters.q])

  useEffect(() => {
    setFilters({ q: debouncedSearch })
  }, [debouncedSearch, setFilters])

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    const actorQ = filters.actor.trim().toLowerCase()
    return requests
      .filter((request) => {
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

        if (actorQ) {
          const actorText = [
            actorLabel(request.created_by_staff, request.created_by),
            actorLabel(request.approved_by_staff, request.approved_by),
            actorLabel(request.issued_by_staff, request.issued_by),
            actorLabel(request.received_by_staff, null),
          ]
            .join(' ')
            .toLowerCase()
          if (!actorText.includes(actorQ)) return false
        }

        if (!q) return true
        const haystack = [
          request.company?.name,
          request.source_location?.name,
          request.target_location?.name,
          request.comment,
          request.decision_comment,
          ...asArray(request.items).flatMap((item) => [item.item?.name, item.item?.barcode, item.comment]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
      .sort((left, right) => {
        const leftAt = new Date(left.created_at || 0).getTime()
        const rightAt = new Date(right.created_at || 0).getTime()
        return rightAt - leftAt
      })
  }, [requests, filters])

  const stats = useMemo(() => {
    const count = (status: string) => requests.filter((r) => r.status === status).length
    return {
      total: requests.length,
      newCount: count('new'),
      approved: count('approved_full') + count('approved_partial'),
      issued: count('issued'),
      received: count('received'),
      rejected: count('rejected'),
    }
  }, [requests])

  const exportCsv = () => {
    const rows = filtered.map((request) => ({
      request_id: request.id,
      status: request.status,
      company: request.company?.name || '',
      source: request.source_location?.name || '',
      target: request.target_location?.name || '',
      created_at: request.created_at || '',
      approved_at: request.approved_at || '',
      issued_at: request.issued_at || '',
      received_at: request.received_at || '',
      created_by: actorLabel(request.created_by_staff, request.created_by),
      approved_by: actorLabel(request.approved_by_staff, request.approved_by),
      issued_by: actorLabel(request.issued_by_staff, request.issued_by),
      received_by: actorLabel(request.received_by_staff, null),
      items_count: asArray(request.items).length,
      items_requested: asArray(request.items).reduce((sum, i) => sum + Number(i.requested_qty || 0), 0),
      items_approved: asArray(request.items).reduce((sum, i) => sum + Number(i.approved_qty || 0), 0),
      comment: request.comment || '',
      decision_comment: request.decision_comment || '',
    }))
    if (rows.length === 0) return
    const headers = Object.keys(rows[0])
    const csv = [headers.join(',')]
      .concat(rows.map((row) => headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `requests-journal-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
            <History className="h-5 w-5 text-blue-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Журнал заявок</h1>
            <p className="truncate text-xs text-muted-foreground">История: создана → одобрена → выдана → получена</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-9 gap-1.5">
            Экспорт CSV
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Всего</p>
          <p className="mt-1 text-xl font-semibold">{stats.total}</p>
        </Card>
        <Card className="border-violet-500/20 bg-violet-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-violet-300/70">Новые</p>
          <p className="mt-1 text-xl font-semibold text-violet-200">{stats.newCount}</p>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Одобрены</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{stats.approved}</p>
        </Card>
        <Card className="border-cyan-500/20 bg-cyan-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300/70">Выданы</p>
          <p className="mt-1 text-xl font-semibold text-cyan-200">{stats.issued}</p>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Получены</p>
          <p className="mt-1 text-xl font-semibold text-blue-200">{stats.received}</p>
        </Card>
        <Card className="border-red-500/20 bg-red-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-red-300/70">Отклонены</p>
          <p className="mt-1 text-xl font-semibold text-red-200">{stats.rejected}</p>
        </Card>
      </div>

      {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">{error}</div> : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Поиск: точка, товар, комментарий"
            className="h-9 pl-9"
          />
        </div>
        <Select value={filters.status} onValueChange={(value) => setFilters({ status: value })}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Все статусы" /></SelectTrigger>
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
          className="h-9 w-[220px]"
        />
        <Input type="date" value={filters.from} onChange={(event) => setFilters({ from: event.target.value })} className="h-9 w-[150px]" />
        <Input type="date" value={filters.to} onChange={(event) => setFilters({ to: event.target.value })} className="h-9 w-[150px]" />
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => {
            setSearchInput('')
            setFilters({ status: 'all', actor: '', from: '', to: '', q: '' })
          }}
        >
          Сбросить
        </Button>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            По этим фильтрам ничего не найдено
          </div>
        ) : (
          <div className="max-h-[calc(100vh-340px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-32 py-2.5 pl-4 pr-2 font-normal">Создана</th>
                  <th className="py-2.5 px-2 font-normal">Точка</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Статус</th>
                  <th className="w-32 py-2.5 px-2 font-normal">Создал</th>
                  <th className="w-32 py-2.5 px-2 font-normal">Одобрил</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-32 py-2.5 px-2 pr-2 text-right font-normal">Запрос → Одобр</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Просмотр</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((request) => {
                  const items = asArray(request.items)
                  const requested = items.reduce((sum, i) => sum + Number(i.requested_qty || 0), 0)
                  const approved = items.reduce((sum, i) => sum + Number(i.approved_qty || 0), 0)
                  const timeline = requestTimeline(request)
                  const pointName = request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'
                  return (
                    <tr key={request.id} className="transition hover:bg-white/[0.02]">
                      <td className="w-32 py-2.5 pl-4 pr-2 align-middle">
                        <span className="text-xs text-muted-foreground">{formatDateTime(request.created_at)}</span>
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="truncate text-sm font-medium">{pointName}</p>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            <div className="space-y-1 text-xs">
                              <div className="font-semibold">{pointName}</div>
                              <div className="text-muted-foreground">Источник: {request.source_location?.name || '—'}</div>
                              <div className="text-muted-foreground">Витрина: {request.target_location?.name || '—'}</div>
                              {request.comment ? <div className="mt-1 border-t border-white/10 pt-1">Заявка: {request.comment}</div> : null}
                              {request.decision_comment ? <div>Решение: {request.decision_comment}</div> : null}
                              <div className="mt-1 border-t border-white/10 pt-1 space-y-0.5">
                                {timeline.map((step) => (
                                  <div key={step.key} className="flex justify-between gap-3">
                                    <span className="text-muted-foreground">{step.label}:</span>
                                    <span>{step.by} · {formatDateTime(step.at)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {request.source_location?.name || '—'} → {request.target_location?.name || '—'}
                        </p>
                      </td>
                      <td className="w-36 py-2.5 px-2 align-middle">
                        <RequestStatusBadge status={request.status} />
                      </td>
                      <td className="min-w-0 w-32 py-2.5 px-2 align-middle">
                        <p className="truncate text-xs text-muted-foreground" title={actorLabel(request.created_by_staff, request.created_by)}>
                          {actorLabel(request.created_by_staff, request.created_by)}
                        </p>
                      </td>
                      <td className="min-w-0 w-32 py-2.5 px-2 align-middle">
                        <p className="truncate text-xs text-muted-foreground" title={actorLabel(request.approved_by_staff, request.approved_by)}>
                          {actorLabel(request.approved_by_staff, request.approved_by)}
                        </p>
                      </td>
                      <td className="w-20 py-2.5 px-2 text-right align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm font-semibold">{items.length}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="end" className="max-w-md">
                            {items.length === 0 ? 'Нет позиций' : (
                              <div className="space-y-1 text-xs">
                                {items.map((item) => (
                                  <div key={item.id} className="flex justify-between gap-3">
                                    <span>{item.item?.name || 'Товар'}</span>
                                    <span className="text-muted-foreground">
                                      {formatQty(Number(item.requested_qty || 0))} → {formatQty(Number(item.approved_qty || 0))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="w-32 py-2.5 px-2 pr-2 text-right align-middle">
                        <span className="text-xs text-muted-foreground">{formatQty(requested)}</span>
                        <span className="mx-1 text-xs text-muted-foreground">→</span>
                        <span className="text-sm font-semibold text-emerald-300">{formatQty(approved)}</span>
                      </td>
                      <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(request)
                            setRequestDetailsOpen(true)
                          }}
                        >
                          Открыть
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={requestDetailsOpen}
        onOpenChange={(open) => {
          setRequestDetailsOpen(open)
          if (!open) setSelectedRequest(null)
        }}
      >
        <DialogContent className="flex h-[85vh] !w-[92vw] !max-w-[92vw] sm:!max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-300" />
              Детали заявки
            </DialogTitle>
            <DialogDescription>
              {selectedRequest ? (
                <>
                  {formatDateTime(selectedRequest.created_at)} ·{' '}
                  {selectedRequest.company?.name
                    || selectedRequest.target_location?.company?.name
                    || selectedRequest.target_location?.name
                    || 'Точка'}{' '}
                  · <span className="text-foreground/90">№{String(selectedRequest.id).slice(0, 8)}…</span>
                </>
              ) : (
                'Заявка на пополнение витрины'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-5">
            {!selectedRequest ? (
              <p className="text-sm text-muted-foreground">Заявка не выбрана.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <RequestStatusBadge status={selectedRequest.status} />
                  {selectedRequest.received_qty_confirmed != null ? (
                    <span className="text-xs text-muted-foreground">
                      Подтверждено при получении: <span className="font-medium text-foreground">{formatQty(selectedRequest.received_qty_confirmed)}</span> ед.
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <div>
                    <span className="text-xs uppercase tracking-wider">Маршрут</span>
                    <p className="mt-0.5 text-foreground">
                      {selectedRequest.source_location?.name || 'Склад'} → {selectedRequest.target_location?.name || 'Витрина'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-wider">Создатель</span>
                    <p className="mt-0.5 text-foreground">{actorLabel(selectedRequest.created_by_staff, selectedRequest.created_by)}</p>
                  </div>
                </div>

                {selectedRequest.comment ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Комментарий к заявке</span>
                    <p className="mt-1 text-foreground">{selectedRequest.comment}</p>
                  </div>
                ) : null}
                {selectedRequest.decision_comment ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Решение / комментарий</span>
                    <p className="mt-1 text-foreground">{selectedRequest.decision_comment}</p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Хронология</p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {requestTimeline(selectedRequest).map((step) => (
                      <li key={step.key} className="flex flex-wrap justify-between gap-2">
                        <span className="text-muted-foreground">{step.label}</span>
                        <span className="text-right">
                          {formatDateTime(step.at)} · {step.by}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Состав заявки (что запрошено и одобрено)</p>
                  <div className="overflow-auto rounded-xl border border-white/10">
                    <table className="w-full min-w-[640px] table-fixed text-sm">
                      <thead className="bg-white/[0.03]">
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-normal">Товар</th>
                          <th className="w-32 px-3 py-2 font-normal">Штрихкод</th>
                          <th className="w-24 px-3 py-2 text-right font-normal">Запрос</th>
                          <th className="w-24 px-3 py-2 text-right font-normal">Одобр.</th>
                          <th className="px-3 py-2 font-normal">Комм. строки</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asArray(selectedRequest.items).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                              Нет позиций в заявке
                            </td>
                          </tr>
                        ) : (
                          asArray(selectedRequest.items).map((item) => (
                            <tr key={item.id} className="border-t border-white/[0.06]">
                              <td className="px-3 py-2" title={item.item?.name || 'Товар'}>
                                <span className="block truncate">{item.item?.name || 'Товар'}</span>
                              </td>
                              <td className="w-32 px-3 py-2 font-mono text-xs text-muted-foreground">{item.item?.barcode || '—'}</td>
                              <td className="w-24 px-3 py-2 text-right">{formatQty(Number(item.requested_qty || 0))}</td>
                              <td className="w-24 px-3 py-2 text-right text-emerald-300">
                                {item.approved_qty == null ? '—' : formatQty(Number(item.approved_qty))}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{item.comment || '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <p className="text-center text-xs text-muted-foreground">
        История заявок · {filtered.length} из {requests.length}
      </p>
    </div>
    </TooltipProvider>
  )
}

export default function StoreRequestsJournalPage() {
  return (
    <Suspense fallback={null}>
      <StoreRequestsJournalPageContent />
    </Suspense>
  )
}
