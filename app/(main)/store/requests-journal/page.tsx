'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDebouncedValue, useUrlState } from '@/lib/hooks/use-url-state'

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

export default function StoreRequestsJournalPage() {
  const [requests, setRequests] = useState<InventoryRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useUrlState({
    q: '',
    status: 'all',
    actor: '',
    from: '',
    to: '',
  })
  const [searchInput, setSearchInput] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as InventoryResponse | null
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить журнал заявок')
      }
      const normalizedRequests = asArray(json.data.requests).map(normalizeRequest).filter((r) => r.id)
      setRequests(normalizedRequests)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить журнал заявок')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-5 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
            <History className="h-3.5 w-3.5" />
            Магазин / Журнал заявок
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Журнал заявок</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Полная история заявок со всеми переходами: кто создал, кто одобрил, кто выдал и кто принял товар — с
              датой каждого действия и комментариями.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={load} disabled={loading} className="rounded-2xl">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} className="rounded-2xl">
            Экспорт CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card className="border-slate-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Всего</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.total}</p>
        </Card>
        <Card className="border-violet-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Новые</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.newCount}</p>
        </Card>
        <Card className="border-emerald-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Одобрены</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.approved}</p>
        </Card>
        <Card className="border-cyan-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Выданы</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.issued}</p>
        </Card>
        <Card className="border-blue-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Получены</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.received}</p>
        </Card>
        <Card className="border-red-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Отклонены</p>
          <p className="mt-2 text-2xl font-semibold text-white">{stats.rejected}</p>
        </Card>
      </div>

      <Card className="border-white/10 bg-slate-950/70 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_0.7fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Поиск: точка, товар, комментарий"
              className="pl-10"
            />
          </div>
          <Select value={filters.status} onValueChange={(value) => setFilters({ status: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
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
            placeholder="Кто создавал/одобрял/выдавал"
          />
          <Input type="date" value={filters.from} onChange={(event) => setFilters({ from: event.target.value })} placeholder="От" />
          <Input type="date" value={filters.to} onChange={(event) => setFilters({ to: event.target.value })} placeholder="До" />
          <Button
            variant="outline"
            onClick={() => {
              setSearchInput('')
              setFilters({ status: 'all', actor: '', from: '', to: '', q: '' })
            }}
          >
            Сбросить
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <Card className="border-white/10 bg-slate-950/70 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <ClipboardList className="h-4 w-4 text-blue-300" />
          История заявок · {filtered.length} из {requests.length}
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем журнал...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
              По этим фильтрам ничего не найдено.
            </div>
          ) : (
            filtered.map((request) => (
              <div key={request.id} className="rounded-2xl border border-white/6 bg-slate-900/70 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {request.company?.name ||
                          request.target_location?.company?.name ||
                          request.target_location?.name ||
                          'Точка'}
                      </span>
                      <RequestStatusBadge status={request.status} />
                      <span className="text-xs text-slate-500">ID {request.id.slice(0, 8)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>Источник: {request.source_location?.name || '—'}</span>
                      <span>Витрина: {request.target_location?.name || '—'}</span>
                      <span>Позиций: {asArray(request.items).length}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[1.4fr_1fr]">
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">Журнал заявки</p>
                    <div className="space-y-2">
                      {requestTimeline(request).map((step) => (
                        <div
                          key={step.key}
                          className="grid grid-cols-[80px_1fr_auto] items-center gap-3 text-xs"
                        >
                          <span className="text-slate-500">{step.label}</span>
                          <span className="truncate text-slate-200">{step.by}</span>
                          <span className="text-slate-400">{formatDateTime(step.at)}</span>
                        </div>
                      ))}
                      {request.received_qty_confirmed != null ? (
                        <div className="grid grid-cols-[80px_1fr_auto] items-center gap-3 text-xs">
                          <span className="text-slate-500">Принято</span>
                          <span className="text-slate-400">Подтверждено количество</span>
                          <span className="text-slate-200">{formatQty(request.received_qty_confirmed)}</span>
                        </div>
                      ) : null}
                    </div>
                    {request.comment ? (
                      <div className="mt-3 border-t border-white/5 pt-2 text-xs text-slate-300">
                        <span className="text-slate-500">Комментарий заявки: </span>
                        {request.comment}
                      </div>
                    ) : null}
                    {request.decision_comment ? (
                      <div className="mt-2 text-xs text-slate-300">
                        <span className="text-slate-500">Комментарий решения: </span>
                        {request.decision_comment}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">Позиции</p>
                    <div className="space-y-1.5">
                      {asArray(request.items).length === 0 ? (
                        <p className="text-xs text-slate-500">Нет позиций</p>
                      ) : (
                        asArray(request.items).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-slate-200">{item.item?.name || 'Товар'}</span>
                            <span className="shrink-0 text-slate-400">
                              {formatQty(Number(item.requested_qty || 0))} →{' '}
                              <span className="text-slate-200">{formatQty(Number(item.approved_qty || 0))}</span>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
