import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import * as api from '@/lib/api'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatDate } from '@/lib/utils'
import type { AppConfig, BootstrapData, OperatorSession, PointInventoryRequestContext } from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToSale?: () => void
  onSwitchToScanner?: () => void
  onOpenCabinet?: () => void
}

type RequestLine = {
  item_id: string
  requested_qty: string
  comment: string
}

const emptyLine = (): RequestLine => ({
  item_id: '',
  requested_qty: '',
  comment: '',
})

function parseQty(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.round((numeric + Number.EPSILON) * 1000) / 1000)
}

function requestStatusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' {
  if (status === 'approved_full') return 'success'
  if (status === 'approved_partial') return 'warning'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена полностью'
  if (status === 'approved_partial') return 'Одобрена частично'
  if (status === 'rejected') return 'Отклонена'
  return 'Новая'
}

export default function InventoryRequestPage({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToSale,
  onSwitchToScanner,
  onOpenCabinet,
}: Props) {
  const [context, setContext] = useState<PointInventoryRequestContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<RequestLine[]>([emptyLine()])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventoryRequests(config, session)
      setContext(data)
    } catch (err: any) {
      setContext(null)
      setError(err?.message || 'Не удалось загрузить заявки на склад')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const pendingCount = useMemo(
    () => (context?.requests || []).filter((item) => item.status === 'new').length,
    [context?.requests],
  )
  const draftItems = useMemo(
    () =>
      lines
        .map((line) => ({
          item_id: line.item_id,
          requested_qty: parseQty(line.requested_qty),
        }))
        .filter((line) => line.item_id && line.requested_qty > 0),
    [lines],
  )
  const draftRequestedQty = useMemo(
    () => draftItems.reduce((sum, line) => sum + Number(line.requested_qty || 0), 0),
    [draftItems],
  )
  const urgentItems = useMemo(
    () =>
      [...(context?.items || [])]
        .sort((a, b) => Number(a.warehouse_qty || 0) - Number(b.warehouse_qty || 0))
        .slice(0, 6),
    [context?.items],
  )

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault()
    const items = lines
      .map((line) => ({
        item_id: line.item_id,
        requested_qty: parseQty(line.requested_qty),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.requested_qty > 0)

    if (items.length === 0) {
      toastError('Добавьте хотя бы одну позицию в заявку')
      return
    }

    setSaving(true)
    try {
      await api.createPointInventoryRequest(config, session, {
        comment: comment.trim() || null,
        items,
      })
      toastSuccess('Заявка отправлена на склад')
      setComment('')
      setLines([emptyLine()])
      await load()
    } catch (err: any) {
      toastError(err?.message || 'Не удалось отправить заявку')
    } finally {
      setSaving(false)
    }
  }

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  function addUrgentItem(itemId: string) {
    setLines((current) => {
      const existingIndex = current.findIndex((line) => line.item_id === itemId)
      if (existingIndex >= 0) {
        return current.map((line, index) =>
          index === existingIndex
            ? { ...line, requested_qty: String(Math.max(1, parseQty(line.requested_qty) + 1)) }
            : line,
        )
      }

      const firstEmptyIndex = current.findIndex((line) => !line.item_id && !line.requested_qty && !line.comment)
      if (firstEmptyIndex >= 0) {
        return current.map((line, index) =>
          index === firstEmptyIndex ? { ...line, item_id: itemId, requested_qty: '1' } : line,
        )
      }

      return [...current, { item_id: itemId, requested_qty: '1', comment: '' }]
    })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-card px-4 pb-2 no-drag">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <span className="text-xs font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{session.company.name}</p>
            <p className="text-[10px] text-muted-foreground">{operatorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <WorkModeSwitch
            active="request"
            showSale={!!onSwitchToSale}
            showScanner={!!onSwitchToScanner}
            showRequest
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onScanner={onSwitchToScanner}
            onCabinet={onOpenCabinet}
          />
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="h-7 w-7 p-0 text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-7 w-7 p-0 text-muted-foreground">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: request form */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-white/10">
          <div className="shrink-0 border-b border-white/10 px-4 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Заявка на склад
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {context?.sourceLocation?.name && <span>Склад: <span className="text-foreground">{context.sourceLocation.name}</span></span>}
                {pendingCount > 0 && <Badge variant="secondary" className="text-[10px]">{pendingCount} новых</Badge>}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
            )}

            <form onSubmit={handleCreateRequest} className="space-y-3">
              <div className="space-y-2.5">
                {lines.map((line, index) => (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2.5">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Товар</Label>
                      <Select
                        value={line.item_id || `__empty__${index}`}
                        onValueChange={(value) =>
                          setLines((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={`__empty__${index}`}>Выберите товар</SelectItem>
                          {(context?.items || []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} · {item.barcode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {line.item_id && (
                      <p className="text-[10px] text-muted-foreground">
                        На складе: <span className="font-medium text-foreground">{context?.items.find((i) => i.id === line.item_id)?.warehouse_qty ?? 0}</span>
                      </p>
                    )}

                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Кол-во</Label>
                        <Input
                          value={line.requested_qty}
                          onChange={(e) => setLines((c) => c.map((item, i) => i === index ? { ...item, requested_qty: e.target.value } : item))}
                          placeholder="0"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Комментарий</Label>
                        <Input
                          value={line.comment}
                          onChange={(e) => setLines((c) => c.map((item, i) => i === index ? { ...item, comment: e.target.value } : item))}
                          placeholder="Закончился на витрине"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground transition hover:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                        Убрать
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={() => setLines((c) => [...c, emptyLine()])}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Добавить позицию
              </Button>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Комментарий к заявке</Label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Что нужно точке и почему"
                  rows={2}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-blue-400/50"
                />
              </div>

              <Button type="submit" size="lg" className="h-12 w-full text-base font-semibold" disabled={saving || loading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-5 w-5" />}
                Отправить заявку
              </Button>
            </form>
          </div>
        </div>

        {/* RIGHT: urgent items + history */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden">
          {/* Urgent items (quick add) */}
          <div className="shrink-0 border-b border-white/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Быстрое добавление</p>
          </div>
          <div className="shrink-0 border-b border-white/10 p-2">
            {loading ? (
              <div className="flex h-12 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : urgentItems.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">Каталог пуст</p>
            ) : (
              <div className="space-y-1">
                {urgentItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addUrgentItem(item.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left text-xs transition hover:border-blue-400/40 hover:bg-white/[0.05]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">На складе: {item.warehouse_qty}</p>
                    </div>
                    <div className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/15 text-blue-300">
                      <Plus className="h-3.5 w-3.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          <div className="shrink-0 border-b border-white/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">История заявок</p>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (context?.requests || []).length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">История пустая</p>
            ) : (
              (context?.requests || []).map((request) => (
                <div key={request.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold">{formatDate(request.created_at)}</p>
                    <Badge variant={requestStatusVariant(request.status)} className="text-[10px]">
                      {requestStatusLabel(request.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{request.items?.length || 0} позиций</p>
                  {request.comment && (
                    <p className="mt-1 text-[10px] text-muted-foreground">{request.comment}</p>
                  )}
                  <div className="mt-2 space-y-1">
                    {(request.items || []).slice(0, 3).map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="truncate">{item.item?.name || 'Товар'}</span>
                        <span className="ml-2 shrink-0">
                          {item.requested_qty}{item.approved_qty !== null ? ` → ${item.approved_qty}` : ''}
                        </span>
                      </div>
                    ))}
                    {(request.items?.length || 0) > 3 && (
                      <p className="text-[10px] text-muted-foreground">+{(request.items?.length || 0) - 3} ещё</p>
                    )}
                  </div>
                  {request.decision_comment && (
                    <p className="mt-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-muted-foreground">
                      {request.decision_comment}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
