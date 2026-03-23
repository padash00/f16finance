import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  Loader2,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  UserCircle2,
  Warehouse,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import {
  InventoryActionChip,
  InventoryEmptyState,
  InventoryHeroPanel,
  InventoryMetric,
  InventoryNotice,
  InventorySectionCard,
} from '@/components/inventory-terminal-ui'
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
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-card pl-5 pr-[140px] drag-region">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">{operatorName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
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

          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-4">
            <InventoryHeroPanel
              icon={ClipboardList}
              accent="blue"
              title="Заявка на склад"
              description="Кассир быстро собирает запрос для своей точки, а руководитель дальше видит его в очереди согласования."
            >
              <div className="grid gap-3 md:grid-cols-3">
                <InventoryMetric label="Новых заявок" value={pendingCount} hint="Ждут решения на сайте" accent="violet" />
                <InventoryMetric label="В черновике" value={draftItems.length} hint={`${draftRequestedQty} единиц в текущей заявке`} accent="blue" />
                <InventoryMetric label="SKU на складе" value={(context?.items || []).length} hint={context?.sourceLocation?.name || 'Центральный склад'} accent="emerald" />
              </div>
            </InventoryHeroPanel>

            <InventorySectionCard
              icon={ClipboardList}
              title="Заявка на склад"
              description="Соберите запрос по товарам, чтобы руководитель сразу увидел потребность точки."
            >
                <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-emerald-400" />
                    <span className="text-muted-foreground">Склад:</span>
                    <span className="font-medium text-foreground">{context?.sourceLocation?.name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-blue-400" />
                    <span className="text-muted-foreground">Витрина:</span>
                    <span className="font-medium text-foreground">{context?.targetLocation?.name || session.company.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-400" />
                    <span className="text-muted-foreground">Новых заявок:</span>
                    <span className="font-medium text-foreground">{pendingCount}</span>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {error}
                  </div>
                ) : null}

                <InventoryNotice tone="blue">
                  Сначала добавляйте только то, что реально заканчивается на витрине. Так склад быстрее согласует заявку.
                </InventoryNotice>

                <form onSubmit={handleCreateRequest} className="space-y-3">
                  <div className="space-y-3">
                    {lines.map((line, index) => (
                      <div key={index} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Товар</Label>
                          <Select
                            value={line.item_id || `__empty__${index}`}
                            onValueChange={(value) =>
                              setLines((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
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

                        {line.item_id ? (
                          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted-foreground">
                            На складе сейчас:{' '}
                            <span className="font-medium text-foreground">
                              {context?.items.find((item) => item.id === line.item_id)?.warehouse_qty ?? 0}
                            </span>
                          </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Количество</Label>
                            <Input
                              value={line.requested_qty}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, requested_qty: event.target.value } : item,
                                  ),
                                )
                              }
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Комментарий</Label>
                            <Input
                              value={line.comment}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, comment: event.target.value } : item,
                                  ),
                                )
                              }
                              placeholder="Например, закончился в витрине"
                            />
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Убрать позицию
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button type="button" variant="outline" className="w-full" onClick={() => setLines((current) => [...current, emptyLine()])}>
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить позицию
                  </Button>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Комментарий к заявке</Label>
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Что нужно точке и почему"
                      rows={3}
                      className="flex min-h-[88px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    />
                  </div>

                  <Button type="submit" disabled={saving || loading} className="w-full">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                    Отправить заявку
                  </Button>
                </form>
            </InventorySectionCard>
          </div>

          <div className="space-y-4">
            <InventorySectionCard
              title="Сигналы по складу"
              description="Быстрое пополнение по товарам, которые чаще всего просят на точке."
            >
                {loading ? (
                  <div className="flex h-24 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : urgentItems.length === 0 ? (
                  <InventoryEmptyState title="Каталог пуст" description="Товары склада появятся здесь, когда каталог и остатки будут загружены." compact />
                ) : (
                  <div className="grid gap-2">
                    {urgentItems.map((item) => (
                      <InventoryActionChip
                        key={item.id}
                        icon={Plus}
                        label={item.name}
                        hint={`${item.barcode} · на складе ${item.warehouse_qty}`}
                        onClick={() => addUrgentItem(item.id)}
                      />
                    ))}
                  </div>
                )}
            </InventorySectionCard>

            <InventorySectionCard
              title="Последние заявки"
              description="История отправленных запросов по этой точке."
            >
                {loading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (context?.requests || []).length === 0 ? (
                  <InventoryEmptyState title="История пока пустая" description="Как только точка отправит первую заявку, она появится здесь." compact />
                ) : (
                  (context?.requests || []).map((request) => (
                    <div key={request.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Заявка от {formatDate(request.created_at)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {request.items?.length || 0} позиций
                          </p>
                        </div>
                        <Badge variant={requestStatusVariant(request.status)}>
                          {requestStatusLabel(request.status)}
                        </Badge>
                      </div>

                      {request.comment ? (
                        <p className="mt-3 text-sm text-muted-foreground">{request.comment}</p>
                      ) : null}

                      <div className="mt-4 space-y-2">
                        {(request.items || []).map((item) => (
                          <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm">
                            <div>
                              <div className="font-medium">{item.item?.name || 'Товар'}</div>
                              <div className="text-xs text-muted-foreground">{item.item?.barcode || '—'}</div>
                            </div>
                            <div className="text-right">
                              <div>Нужно: <span className="font-semibold">{item.requested_qty}</span></div>
                              {item.approved_qty !== null ? (
                                <div className="text-xs text-muted-foreground">Одобрено: {item.approved_qty}</div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>

                      {request.decision_comment ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted-foreground">
                          Решение: {request.decision_comment}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
            </InventorySectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}
