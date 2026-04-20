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
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена'
  if (status === 'approved_partial') return 'Частично'
  if (status === 'rejected') return 'Отклонена'
  return 'Новая'
}

export default function InventoryRequestPage({
  config,
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
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
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

  const cartTotal = cart.reduce((s, c) => s + c.qty, 0)
  const pendingCount = (context?.requests || []).filter((r) => r.status === 'new').length
  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

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

        {/* LEFT: searchable item catalog */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-white/10">
          {/* Search */}
          <div className="shrink-0 border-b border-white/10 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
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
                className="h-8 pl-7 text-xs"
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="m-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
            ) : filteredItems.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
                <Search className="h-6 w-6 opacity-30" />
                <p className="text-xs">{search ? 'Ничего не найдено' : 'Каталог пуст'}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {filteredItems.map((item) => {
                  const inCart = cart.find((c) => c.item_id === item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart(item.id)}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-xs transition hover:bg-white/[0.04] ${inCart ? 'bg-blue-500/[0.06]' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${inCart ? 'text-blue-300' : 'text-foreground'}`}>{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.barcode || '—'}
                          {' · '}склад: <span className="text-foreground">{item.warehouse_qty ?? 0}</span> {item.unit || 'шт'}
                        </p>
                      </div>
                      <div className={`ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${inCart ? 'bg-blue-500/30 text-blue-300' : 'bg-white/[0.06] text-muted-foreground hover:bg-blue-500/20 hover:text-blue-300'}`}>
                        {inCart ? <span className="text-[10px] font-bold">{inCart.qty}</span> : <Plus className="h-3.5 w-3.5" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: cart + history */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden">

          {/* Cart */}
          <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden border-b border-white/10" style={{ minHeight: cart.length === 0 ? 'auto' : undefined }}>
            <div className="shrink-0 border-b border-white/10 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Заявка
                  {cartTotal > 0 && <Badge variant="secondary" className="text-[10px]">{cart.length} поз.</Badge>}
                </div>
                {cart.length > 0 && (
                  <button type="button" onClick={() => setCart([])} className="text-[10px] text-muted-foreground hover:text-rose-400 transition">
                    Очистить
                  </button>
                )}
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted-foreground">
                <ShoppingCart className="h-5 w-5 opacity-20" />
                <p className="text-[11px]">Нажмите на товар слева</p>
              </div>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.05]">
                  {cart.map((c) => (
                    <div key={c.item_id} className="px-3 py-2 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium leading-tight truncate">{c.name}</p>
                        <button type="button" onClick={() => removeFromCart(c.item_id)} className="shrink-0 text-muted-foreground hover:text-rose-400 transition mt-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCartQty(c.item_id, c.qty - 1)} className="flex h-6 w-6 items-center justify-center rounded border border-white/10 hover:bg-white/[0.06]">
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            value={c.qty}
                            onChange={(e) => setCartQty(c.item_id, Number(e.target.value) || 0)}
                            className="h-6 w-12 rounded border border-input bg-background px-1 text-center text-xs outline-none focus:border-blue-400/50"
                            min={0}
                          />
                          <button type="button" onClick={() => setCartQty(c.item_id, c.qty + 1)} className="flex h-6 w-6 items-center justify-center rounded border border-white/10 hover:bg-white/[0.06]">
                            <Plus className="h-3 w-3" />
                          </button>
                          <span className="text-[10px] text-muted-foreground">{c.unit}</span>
                        </div>
                      </div>
                      <input
                        value={c.comment}
                        onChange={(e) => setCartComment(c.item_id, e.target.value)}
                        placeholder="Комментарий (опц.)"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-[10px] outline-none focus:border-blue-400/50"
                      />
                    </div>
                  ))}
                </div>

                <div className="shrink-0 space-y-2 border-t border-white/10 p-3">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Комментарий к заявке</Label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Что нужно и почему..."
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-400/50"
                    />
                  </div>
                  <Button type="submit" className="h-10 w-full gap-2 font-semibold" disabled={saving || loading}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                    Отправить заявку · {cart.length} поз.
                  </Button>
                </div>
              </>
            )}
          </form>

          {/* History */}
          <div className="shrink-0 border-b border-white/10 px-3 py-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>История заявок</span>
              {pendingCount > 0 && <Badge variant="secondary" className="text-[10px]">{pendingCount} новых</Badge>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
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
                    <p className="text-[10px] text-muted-foreground">{formatDate(request.created_at)}</p>
                    <Badge variant={requestStatusVariant(request.status)} className="text-[10px] shrink-0">
                      {requestStatusLabel(request.status)}
                    </Badge>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {(request.items || []).slice(0, 4).map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="truncate">{item.item?.name || 'Товар'}</span>
                        <span className="ml-2 shrink-0 font-mono">
                          {item.requested_qty}{item.approved_qty !== null ? ` → ${item.approved_qty}` : ''}
                        </span>
                      </div>
                    ))}
                    {(request.items?.length || 0) > 4 && (
                      <p className="text-[10px] text-muted-foreground">+{(request.items?.length || 0) - 4} ещё</p>
                    )}
                  </div>
                  {request.decision_comment && (
                    <p className="mt-1.5 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-muted-foreground">{request.decision_comment}</p>
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
