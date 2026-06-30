import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardList,
  Loader2,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  onSwitchToReturn?: () => void
  onSwitchToScanner?: () => void
  onOpenCabinet?: () => void
}

type CartItem = {
  item_id: string
  name: string
  barcode: string
  unit: string
  warehouse_qty: number
  qty: number
  comment: string
}

function requestStatusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' {
  if (status === 'approved_full') return 'success'
  if (status === 'approved_partial') return 'warning'
  if (status === 'issued') return 'warning'
  if (status === 'received') return 'success'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена'
  if (status === 'approved_partial') return 'Частично'
  if (status === 'issued') return 'Отправлена'
  if (status === 'received') return 'Получена'
  if (status === 'rejected') return 'Отклонена'
  return 'Новая'
}

export default function InventoryRequestPage({
  config,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToSale,
  onSwitchToReturn,
  onSwitchToScanner,
  onOpenCabinet,
}: Props) {
  const [context, setContext] = useState<PointInventoryRequestContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventoryRequests(config, session)
      setContext(data)
    } catch (err: any) {
      setContext(null)
      setError(err?.message || 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // ── Filtered item list ─────────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = (context?.items || []).filter((item) => Number(item.warehouse_qty || 0) > 0)
    if (!q) return all
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.barcode || '').toLowerCase().includes(q),
    )
  }, [context?.items, search])

  // ── Cart helpers ───────────────────────────────────────────────────────────

  function addToCart(itemId: string) {
    const item = (context?.items || []).find((i) => i.id === itemId)
    if (!item) return
    setCart((prev) => {
      const existing = prev.find((c) => c.item_id === itemId)
      if (existing) {
        return prev.map((c) => c.item_id === itemId ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, {
        item_id: item.id,
        name: item.name,
        barcode: item.barcode || '',
        unit: item.unit || 'шт',
        warehouse_qty: Number(item.warehouse_qty || 0),
        qty: 1,
        comment: '',
      }]
    })
  }

  function handleSearchEnter() {
    const q = search.trim()
    if (!q) return
    const all = (context?.items || []).filter((item) => Number(item.warehouse_qty || 0) > 0)
    const exactBarcode = all.find((item) => String(item.barcode || '').trim() === q)
    if (exactBarcode) {
      addToCart(exactBarcode.id)
      setSearch('')
      return
    }
    const query = q.toLowerCase()
    const oneMatch = all.filter((item) => {
      const name = String(item.name || '').toLowerCase()
      const barcode = String(item.barcode || '').toLowerCase()
      return name.includes(query) || barcode.includes(query)
    })
    if (oneMatch.length === 1) {
      addToCart(oneMatch[0].id)
      setSearch('')
    }
  }

  function setCartQty(itemId: string, qty: number) {
    const n = Math.max(0, qty)
    if (n === 0) {
      setCart((prev) => prev.filter((c) => c.item_id !== itemId))
    } else {
      setCart((prev) => prev.map((c) => c.item_id === itemId ? { ...c, qty: n } : c))
    }
  }

  function setCartComment(itemId: string, comment: string) {
    setCart((prev) => prev.map((c) => c.item_id === itemId ? { ...c, comment } : c))
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => prev.filter((c) => c.item_id !== itemId))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const items = cart
      .filter((c) => c.qty > 0)
      .map((c) => ({ item_id: c.item_id, requested_qty: c.qty, comment: c.comment.trim() || null }))

    if (items.length === 0) {
      toastError('Добавьте хотя бы один товар в заявку')
      return
    }

    setSaving(true)
    try {
      await api.createPointInventoryRequest(config, session, {
        comment: comment.trim() || null,
        items,
      })
      toastSuccess('Заявка отправлена на склад')
      setCart([])
      setComment('')
      setSearch('')
      await load()
    } catch (err: any) {
      toastError(err?.message || 'Не удалось отправить заявку')
    } finally {
      setSaving(false)
    }
  }

  async function handleReceive(requestId: string) {
    setReceivingId(requestId)
    try {
      await api.receivePointInventoryRequest(config, session, requestId)
      toastSuccess('Товар принят на витрину')
      await load()
    } catch (err: any) {
      toastError(err?.message || 'Не удалось подтвердить получение')
    } finally {
      setReceivingId(null)
    }
  }

  const cartTotal = cart.reduce((s, c) => s + c.qty, 0)
  const pendingCount = (context?.requests || []).filter((r) => r.status === 'new').length
  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      <div className="h-9 shrink-0 drag-region bg-card/80 backdrop-blur" />
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 backdrop-blur-xl px-4 pb-2.5 no-drag">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/30">
            <ClipboardList className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Заявки на склад</p>
            <p className="text-[11px] text-muted-foreground">{session.company.name} · {operatorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <WorkModeSwitch
            active="request"
            showSale={!!onSwitchToSale}
            showReturn={!!onSwitchToReturn}
            showScanner={!!onSwitchToScanner}
            showRequest
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onReturn={onSwitchToReturn}
            onScanner={onSwitchToScanner}
            onCabinet={onOpenCabinet}
          />
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="h-9 w-9 p-0 text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-9 w-9 p-0 text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 gap-3 overflow-hidden p-3">

        {/* LEFT: searchable item catalog */}
        <Card className="flex flex-1 flex-col overflow-hidden p-0">
          {/* Search */}
          <div className="shrink-0 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSearchEnter()
                  }
                }}
                placeholder="Поиск товара по названию или штрихкоду..."
                className="h-12 pl-10 pr-10 text-sm"
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</div>
            ) : filteredItems.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Search className="h-8 w-8 opacity-30" />
                <p className="text-sm">{search ? 'Ничего не найдено' : 'Каталог пуст'}</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredItems.map((item) => {
                  const inCart = cart.find((c) => c.item_id === item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart(item.id)}
                      className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted ${inCart ? 'bg-primary/[0.07]' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-medium ${inCart ? 'text-primary' : 'text-foreground'}`}>{item.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.barcode || '—'}
                          {' · '}склад: <span className="font-medium text-foreground">{item.warehouse_qty ?? 0}</span> {item.unit || 'шт'}
                        </p>
                      </div>
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${inCart ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        {inCart ? <span className="text-sm font-bold">{inCart.qty}</span> : <Plus className="h-5 w-5" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Card>

        {/* RIGHT: cart + history */}
        <div className="flex w-96 shrink-0 flex-col gap-3 overflow-hidden">

          {/* Cart */}
          <Card className="flex flex-col overflow-hidden p-0" style={{ minHeight: cart.length === 0 ? 'auto' : undefined }}>
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                    Заявка
                    {cartTotal > 0 && <Badge variant="default" className="text-[10px]">{cart.length} поз.</Badge>}
                  </div>
                  {cart.length > 0 && (
                    <button type="button" onClick={() => setCart([])} className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive-foreground">
                      <Trash2 className="h-3.5 w-3.5" />
                      Очистить
                    </button>
                  )}
                </div>
              </div>

              {cart.length === 0 ? (
                <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ShoppingCart className="h-7 w-7 opacity-20" />
                  <p className="text-sm">Нажмите на товар слева</p>
                </div>
              ) : (
                <>
                  <div className="max-h-72 overflow-y-auto divide-y divide-border">
                    {cart.map((c) => (
                      <div key={c.item_id} className="px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight truncate">{c.name}</p>
                          <button type="button" onClick={() => removeFromCart(c.item_id)} className="shrink-0 text-muted-foreground transition hover:text-destructive-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setCartQty(c.item_id, c.qty - 1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-foreground transition hover:bg-accent active:scale-95">
                              <Minus className="h-4 w-4" />
                            </button>
                            <input
                              type="number"
                              value={c.qty}
                              onChange={(e) => setCartQty(c.item_id, Number(e.target.value) || 0)}
                              className="h-11 w-14 rounded-lg border border-border bg-background text-foreground px-1 text-center text-base font-semibold outline-none focus:border-primary"
                              min={0}
                            />
                            <button type="button" onClick={() => setCartQty(c.item_id, c.qty + 1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-foreground transition hover:bg-accent active:scale-95">
                              <Plus className="h-4 w-4" />
                            </button>
                            <span className="ml-1 text-xs text-muted-foreground">{c.unit}</span>
                          </div>
                        </div>
                        <input
                          value={c.comment}
                          onChange={(e) => setCartComment(c.item_id, e.target.value)}
                          placeholder="Комментарий (опц.)"
                          className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-xs outline-none focus:border-primary"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="shrink-0 space-y-3 border-t border-border bg-muted/40 p-4">
                    <div>
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Комментарий к заявке</Label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Что нужно и почему..."
                        rows={2}
                        className="mt-1.5 w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    </div>
                    <Button type="submit" className="h-14 w-full gap-2 text-base font-semibold" disabled={saving || loading}>
                      {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <ClipboardList className="h-5 w-5" />}
                      Отправить заявку · {cart.length} поз.
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Card>

          {/* History */}
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <div className="shrink-0 border-b border-border px-4 py-3">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>История заявок</span>
                {pendingCount > 0 && <Badge variant="warning" className="text-[10px]">{pendingCount} новых</Badge>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {loading ? (
                <div className="flex h-20 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (context?.requests || []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">История пустая</p>
              ) : (
                (context?.requests || []).map((request) => (
                  <div key={request.id} className="rounded-xl border border-border bg-muted/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{formatDate(request.created_at)}</p>
                      <Badge variant={requestStatusVariant(request.status)} className="shrink-0 text-[11px]">
                        {requestStatusLabel(request.status)}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(request.items || []).slice(0, 4).map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-xs">
                          <span className="truncate text-muted-foreground">{item.item?.name || 'Товар'}</span>
                          <span className="ml-2 shrink-0 font-mono font-medium text-foreground">
                            {item.requested_qty}{item.approved_qty !== null ? ` → ${item.approved_qty}` : ''}
                          </span>
                        </div>
                      ))}
                      {(request.items?.length || 0) > 4 && (
                        <p className="text-xs text-muted-foreground">+{(request.items?.length || 0) - 4} ещё</p>
                      )}
                    </div>
                    {request.decision_comment && (
                      <p className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{request.decision_comment}</p>
                    )}
                    {request.status === 'issued' && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3 h-12 w-full gap-2 text-sm font-semibold"
                        disabled={receivingId === request.id}
                        onClick={() => void handleReceive(request.id)}
                      >
                        {receivingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Получил товар
                      </Button>
                    )}
                    {request.status === 'received' && request.received_at && (
                      <p className="mt-2 text-xs font-medium text-primary">Принято: {formatDate(request.received_at)}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
