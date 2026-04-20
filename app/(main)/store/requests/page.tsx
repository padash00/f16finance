'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ClipboardList, Loader2, MoreHorizontal, PackageCheck, RefreshCw, XCircle } from 'lucide-react'

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
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'

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
  created_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  approved_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  issued_by_staff?: { id: string; full_name: string | null; role: string | null } | null
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
    received_qty_confirmed: raw?.received_qty_confirmed == null ? null : Number(raw.received_qty_confirmed || 0),
    created_by_staff: firstOrSelf(raw?.created_by_staff),
    approved_by_staff: firstOrSelf(raw?.approved_by_staff),
    issued_by_staff: firstOrSelf(raw?.issued_by_staff),
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
    { key: 'received', label: 'Получена', at: request.received_at, by: '—' },
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

export default function StoreRequestsPage() {
  const [requests, setRequests] = useState<InventoryRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [actorFilter, setActorFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({})

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/inventory/requests', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as InventoryResponse | null
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить заявки магазина')
      }
      const normalizedRequests = asArray(json.data.requests).map(normalizeRequest).filter((request) => request.id)
      setRequests(normalizedRequests)
      setDecisionDrafts((prev) => {
        const next = { ...prev }
        for (const request of normalizedRequests) {
          if (!next[request.id]) next[request.id] = createDecisionDraft(request)
        }
        return next
      })
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить заявки магазина')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false

      const createdAt = request.created_at ? new Date(request.created_at) : null
      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`)
        if (createdAt && createdAt < from) return false
      }
      if (toDate) {
        const to = new Date(`${toDate}T23:59:59`)
        if (createdAt && createdAt > to) return false
      }

      const actorQ = actorFilter.trim().toLowerCase()
      if (actorQ) {
        const actorText = [
          actorLabel(request.created_by_staff, request.created_by),
          actorLabel(request.approved_by_staff, request.approved_by),
          actorLabel(request.issued_by_staff, request.issued_by),
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
  }, [requests, search, statusFilter, actorFilter, fromDate, toDate])

  const pendingRequests = filteredRequests.filter((request) => request.status === 'new' || request.status === 'disputed')
  const approvedRequests = filteredRequests.filter((request) =>
    ['approved_full', 'approved_partial', 'issued'].includes(request.status),
  )
  const historyRequests = filteredRequests.filter((request) => ['received', 'rejected'].includes(request.status))

  const stats = useMemo(() => {
    const totalRequested = pendingRequests.reduce((sum, request) => sum + requestItemsCount(request), 0)
    const totalApproved = approvedRequests.reduce(
      (sum, request) => sum + asArray(request.items).reduce((acc, item) => acc + Number(item.approved_qty || 0), 0),
      0,
    )
    return {
      pending: pendingRequests.length,
      approved: approvedRequests.length,
      history: historyRequests.length,
      totalRequested,
      totalApproved,
    }
  }, [approvedRequests, historyRequests.length, pendingRequests])

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
      await load()
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
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось обработать заявку')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-5 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-200">
            <ClipboardList className="h-3.5 w-3.5" />
            Магазин / Заявки
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Заявки точек</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Рабочий экран руководителя: новые заявки на пополнение витрин, быстрые решения по количеству и понятная
              история того, что уже согласовано или отклонено.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по точке, товару или комментарию"
            className="w-full sm:w-80"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MoreHorizontal className="mr-2 h-4 w-4" />
                Действия
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Управление заявками</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={load} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Обновить список
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSearch('')} disabled={!search.trim()}>
                <XCircle className="h-4 w-4" />
                Сбросить поиск
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card className="border-white/10 bg-slate-950/70 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none"
          >
            <option value="all">Все статусы</option>
            <option value="new">Новая</option>
            <option value="approved_full">Одобрена полностью</option>
            <option value="approved_partial">Одобрена частично</option>
            <option value="issued">Выдана</option>
            <option value="received">Получена</option>
            <option value="rejected">Отклонена</option>
            <option value="disputed">Спор</option>
          </select>
          <Input
            value={actorFilter}
            onChange={(event) => setActorFilter(event.target.value)}
            placeholder="Кто создавал/одобрял/выдавал"
          />
          <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStatusFilter('all')
              setActorFilter('')
              setFromDate('')
              setToDate('')
              setSearch('')
            }}
          >
            Сбросить фильтры
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      ) : null}

      {stats.pending > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-3">
          <AlertCircle className="h-5 w-5 text-violet-300 shrink-0" />
          <span className="text-sm font-semibold text-violet-200">{stats.pending} {stats.pending === 1 ? 'новая заявка ждёт' : 'новых заявки ждут'} решения</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="border-violet-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Новые заявки</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.pending}</p>
          <p className="mt-2 text-sm text-slate-400">Ждут решения руководителя или superadmin.</p>
        </Card>
        <Card className="border-cyan-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">К выдаче</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.approved}</p>
          <p className="mt-2 text-sm text-slate-400">Одобренные заявки, которые уже можно отрабатывать по складу.</p>
        </Card>
        <Card className="border-blue-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">История</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.history}</p>
          <p className="mt-2 text-sm text-slate-400">Полученные или отклоненные документы за последнее время.</p>
        </Card>
        <Card className="border-amber-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Запрошено</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.totalRequested}</p>
          <p className="mt-2 text-sm text-slate-400">Суммарное количество позиций в очереди на согласование.</p>
        </Card>
        <Card className="border-emerald-500/20 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Одобрено</p>
          <p className="mt-3 text-3xl font-semibold text-white">{stats.totalApproved}</p>
          <p className="mt-2 text-sm text-slate-400">Количество уже подтвержденных к выдаче единиц товара.</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <AlertCircle className="h-4 w-4 text-violet-300" />
            Очередь на решение
          </div>

          {loading ? (
            <Card className="border-white/10 bg-slate-950/70 p-6 text-sm text-slate-400">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка заявок...
              </div>
            </Card>
          ) : pendingRequests.length === 0 ? (
            <Card className="border-white/10 bg-slate-950/70 p-6 text-sm text-slate-400">
              В очереди нет новых заявок. Здесь будут появляться запросы кассиров на пополнение витрин.
            </Card>
          ) : (
            pendingRequests.map((request) => {
              const draft = decisionDrafts[request.id] || createDecisionDraft(request)
              const requestTotal = (request.items || []).reduce((sum, item) => sum + Number(item.requested_qty || 0), 0)

              return (
                <Card key={request.id} className="overflow-hidden border-white/10 bg-slate-950/70">
                  <div className="border-b border-white/5 px-5 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-white">
                            {request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'}
                          </span>
                          <RequestStatusBadge status={request.status} />
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                          <span>Создана: {formatDateTime(request.created_at)}</span>
                          <span>Источник: {request.source_location?.name || 'Склад'}</span>
                          <span>Витрина: {request.target_location?.name || '—'}</span>
                          <span>Позиций: {requestTotal}</span>
                        </div>
                        {request.comment ? <p className="text-sm text-slate-300">{request.comment}</p> : null}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 px-5 py-5">
                    <div className="space-y-3">
                        {asArray(request.items).map((item) => (
                          <div
                            key={item.id}
                          className="grid gap-3 rounded-2xl border border-white/6 bg-slate-900/70 p-4 md:grid-cols-[1.4fr_0.7fr_0.7fr]"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{item.item?.name || 'Товар'}</div>
                            <div className="mt-1 text-xs text-slate-500">{item.item?.barcode || 'Без штрихкода'}</div>
                            {item.comment ? <div className="mt-2 text-xs text-slate-400">{item.comment}</div> : null}
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Запрос</div>
                            <div className="mt-2 text-lg font-semibold text-white">{formatQty(Number(item.requested_qty || 0))}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Одобрить</div>
                            <Input
                              value={draft.quantities[item.id] ?? formatQty(Number(item.requested_qty || 0))}
                              onChange={(event) => updateDraftQty(request.id, item.id, event.target.value)}
                              className="mt-2"
                              inputMode="decimal"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                          Комментарий к решению
                        </label>
                        <Textarea
                          value={draft.decisionComment}
                          onChange={(event) => updateDraft(request.id, { decisionComment: event.target.value })}
                          placeholder="Например: выдать срочно, часть товара заменить, проверить остаток по конкретной позиции"
                          className="min-h-24"
                        />
                      </div>

                      <div className="rounded-2xl border border-white/6 bg-slate-900/70 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Решение по заявке</div>
                        <div className="mt-4 flex gap-2">
                          <Button
                            onClick={() => submitDecision(request, true, false)}
                            disabled={savingId === request.id}
                            className="flex-1 justify-start"
                          >
                            {savingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                            Сохранить решение
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
                  </div>
                </Card>
              )
            })
          )}
        </div>

        <div className="space-y-6">
          <Card className="border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <PackageCheck className="h-4 w-4 text-cyan-300" />
              Уже согласовано
            </div>
            <div className="mt-4 space-y-3">
              {approvedRequests.length === 0 ? (
                <p className="text-sm text-slate-400">Пока нет одобренных заявок.</p>
              ) : (
                approvedRequests.slice(0, 6).map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white/6 bg-slate-900/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {asArray(request.items).length || 0} позиций · {formatDateTime(request.approved_at || request.created_at)}
                        </div>
                      </div>
                      <RequestStatusBadge status={request.status} />
                    </div>
                    <div className="mt-3">
                      {['approved_full', 'approved_partial', 'issued'].includes(request.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className={`h-7 gap-1 text-xs ${request.status === 'issued'
                            ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
                            : 'border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10'
                            }`}
                          disabled={savingId === request.id}
                          onClick={() => transitionStatus(request.id, request.status === 'issued' ? 'received' : 'issued')}
                        >
                          {savingId === request.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : request.status === 'issued' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <PackageCheck className="h-3 w-3" />
                          )}
                          {request.status === 'issued' ? 'Отметить полученной' : 'Отметить выданной'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <ClipboardList className="h-4 w-4 text-blue-300" />
              История решений
            </div>
            <div className="mt-4 space-y-3">
              {historyRequests.length === 0 ? (
                <p className="text-sm text-slate-400">История появится после первых отклоненных или подтвержденных заявок.</p>
              ) : (
                historyRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white/6 bg-slate-900/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {request.company?.name || request.target_location?.company?.name || request.target_location?.name || 'Точка'}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{formatDateTime(request.approved_at || request.created_at)}</div>
                        {request.decision_comment ? (
                          <div className="mt-2 line-clamp-2 text-xs text-slate-500">{request.decision_comment}</div>
                        ) : null}
                      </div>
                      <RequestStatusBadge status={request.status} />
                    </div>
                    <div className="mt-3 grid gap-1 text-[11px] text-slate-400">
                      <div className="flex justify-between gap-3">
                        <span>Кто создал</span>
                        <span className="text-slate-300">{actorLabel(request.created_by_staff, request.created_by)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Кто одобрил</span>
                        <span className="text-slate-300">{actorLabel(request.approved_by_staff, request.approved_by)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Кто выдал</span>
                        <span className="text-slate-300">{actorLabel(request.issued_by_staff, request.issued_by)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Кто принял</span>
                        <span className="text-slate-300">—</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Когда выдали</span>
                        <span className="text-slate-300">{formatDateTime(request.issued_at)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Когда получили</span>
                        <span className="text-slate-300">{formatDateTime(request.received_at)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Подтверждено при получении</span>
                        <span className="text-slate-300">
                          {request.received_qty_confirmed == null ? '—' : formatQty(request.received_qty_confirmed)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/6 bg-black/20 p-2.5">
                      <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">Журнал заявки</p>
                      <div className="mb-2 space-y-1.5">
                        {requestTimeline(request).map((step) => (
                          <div key={step.key} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="text-slate-400">{step.label}</span>
                            <span className="text-slate-300">{formatDateTime(step.at)}</span>
                            <span className="max-w-[45%] truncate text-right text-slate-400">{step.by}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/6 bg-black/20 p-2.5">
                      {asArray(request.items).slice(0, 5).map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-[11px] text-slate-300">
                          <span className="truncate pr-2">{item.item?.name || 'Товар'}</span>
                          <span className="shrink-0 text-slate-400">
                            {formatQty(Number(item.requested_qty || 0))} → {formatQty(Number(item.approved_qty || 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Сводка по объему
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-slate-900/70 px-4 py-3">
                <span>Запрошено единиц</span>
                <span className="font-semibold text-white">{stats.totalRequested}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-slate-900/70 px-4 py-3">
                <span>Одобрено единиц</span>
                <span className="font-semibold text-white">{stats.totalApproved}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/6 bg-slate-900/70 px-4 py-3">
                <span>Потенциальный товарный поток</span>
                <span className="font-semibold text-white">{formatMoney(stats.totalApproved)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
