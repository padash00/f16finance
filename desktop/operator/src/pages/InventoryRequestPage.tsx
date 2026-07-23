/**
 * Заявка кассы на склад (v2.10).
 *
 * Две вкладки (как на «Продаже»): «Заявка» — двухпанельная сборка заявки
 * (слева каталог склада с поиском, справа закреплённая панель позиций),
 * «История заявок» — карточки последних заявок точки со статусами и действиями
 * (отмена своей новой заявки, подтверждение получения выданной).
 *
 * Количество жёстко ограничено остатком склада (warehouse_qty); серверный кап
 * «Недостаточно на складе» всё равно обрабатывается — каталог мог устареть.
 *
 * Черновик заявки (позиции + комментарий) автосохраняется per-кассир
 * (lib/request-draft): при смене кассира черновик молча обнуляется.
 * Офлайн: сетевые ошибки отправки уводят заявку в очередь (queueInventoryRequest).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
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
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import * as api from '@/lib/api'
import * as offline from '@/lib/offline'
import { clearDraft, getDraft, setDraft, type RequestDraftItem } from '@/lib/request-draft'
import { toastError, toastSuccess } from '@/lib/toast'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointInventoryRequestContext,
  PointInventoryRequestRow,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToSale?: () => void
  onSwitchToReturn?: () => void
  onSwitchToHistory?: () => void
  onSwitchToScanner?: () => void
  onSwitchToArena?: () => void
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

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: 'Новая', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  approved_full: { label: 'Одобрена', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  approved_partial: { label: 'Одобрена частично', cls: 'bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300' },
  issued: { label: 'Выдана', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  received: { label: 'Получена', cls: 'bg-slate-200/70 text-emerald-800 dark:bg-slate-500/15 dark:text-emerald-300/90' },
  rejected: { label: 'Отклонена', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  disputed: { label: 'Спор', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
}

function statusMeta(status: string) {
  return STATUS_META[status] || { label: status, cls: 'bg-muted text-muted-foreground' }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isNetworkError(err: unknown): boolean {
  const message = (err as { message?: string } | null)?.message || ''
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Превышено время ожидания') ||
    message.includes('fetch failed') ||
    !navigator.onLine
  )
}

export default function InventoryRequestPage({
  config,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToSale,
  onSwitchToReturn,
  onSwitchToHistory,
  onSwitchToScanner,
  onSwitchToArena,
  onOpenCabinet,
}: Props) {
  const operatorId = session.operator.operator_id

  const [context, setContext] = useState<PointInventoryRequestContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [viewMode, setViewMode] = useState<'create' | 'history'>('create')
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PointInventoryRequestRow | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Черновик per-кассир ────────────────────────────────────────────────────
  // Позиции черновика восстанавливаем только после загрузки каталога (нужны
  // актуальные warehouse_qty для капа); комментарий — сразу при маунте.
  const draftItemsRef = useRef<RequestDraftItem[]>([])
  const hydratedRef = useRef(false)

  useEffect(() => {
    // getDraft молча удаляет черновик ДРУГОГО оператора (смена кассира)
    const draft = getDraft(operatorId)
    if (draft) {
      draftItemsRef.current = draft.items
      if (draft.comment) setComment(draft.comment)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Автосохранение черновика (после первичного восстановления)
  useEffect(() => {
    if (!hydratedRef.current) return
    setDraft(operatorId, {
      comment,
      items: cart.map((c) => ({ item_id: c.item_id, qty: c.qty, comment: c.comment })),
    })
  }, [cart, comment, operatorId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventoryRequests(config, session)
      setContext(data)

      const itemMap = new Map((data.items || []).map((i) => [i.id, i]))
      if (!hydratedRef.current) {
        hydratedRef.current = true
        const restored: CartItem[] = []
        for (const d of draftItemsRef.current) {
          const item = itemMap.get(d.item_id)
          if (!item) continue
          const max = Number(item.warehouse_qty || 0)
          const qty = Math.min(d.qty, max)
          if (qty <= 0) continue
          restored.push({
            item_id: item.id,
            name: item.name,
            barcode: item.barcode || '',
            unit: item.unit || 'шт',
            warehouse_qty: max,
            qty,
            comment: d.comment || '',
          })
        }
        draftItemsRef.current = []
        if (restored.length > 0) setCart(restored)
      } else {
        // Каталог обновился — синхронизируем остатки склада в корзине и клампим
        setCart((prev) =>
          prev
            .map((c) => {
              const max = Number(itemMap.get(c.item_id)?.warehouse_qty || 0)
              return { ...c, warehouse_qty: max, qty: Math.min(c.qty, max) }
            })
            .filter((c) => c.qty > 0),
        )
      }
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

  // ── Cart helpers (жёсткий кап по warehouse_qty) ────────────────────────────

  function addToCart(itemId: string) {
    const item = (context?.items || []).find((i) => i.id === itemId)
    if (!item) return
    const max = Number(item.warehouse_qty || 0)
    if (max <= 0) return
    setCart((prev) => {
      const existing = prev.find((c) => c.item_id === itemId)
      if (existing) {
        if (existing.qty >= max) {
          toastError(`«${item.name}»: на складе только ${max} ${item.unit || 'шт'}`)
          return prev
        }
        return prev.map((c) => c.item_id === itemId ? { ...c, qty: Math.min(c.qty + 1, max) } : c)
      }
      return [...prev, {
        item_id: item.id,
        name: item.name,
        barcode: item.barcode || '',
        unit: item.unit || 'шт',
        warehouse_qty: max,
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
    setCart((prev) => {
      const line = prev.find((c) => c.item_id === itemId)
      if (!line) return prev
      // Дробные единицы (кг/л) допустимы — клампим без округления вниз,
      // но режем хвост до 3 знаков (как сервер в normalizeMoney)
      const clamped = Math.round(Math.min(Math.max(0, qty), line.warehouse_qty) * 1000) / 1000
      if (clamped === 0) return prev.filter((c) => c.item_id !== itemId)
      return prev.map((c) => c.item_id === itemId ? { ...c, qty: clamped } : c)
    })
  }

  function setCartComment(itemId: string, value: string) {
    setCart((prev) => prev.map((c) => c.item_id === itemId ? { ...c, comment: value } : c))
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => prev.filter((c) => c.item_id !== itemId))
  }

  function clearForm() {
    setCart([])
    setComment('')
    setSearch('')
    clearDraft()
  }

  // ── Submit (онлайн → сервер, сетевая ошибка → офлайн-очередь) ─────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const items = cart
      .filter((c) => c.qty > 0)
      .map((c) => ({ item_id: c.item_id, requested_qty: c.qty, comment: c.comment.trim() || null }))

    if (items.length === 0) {
      toastError('Добавьте хотя бы один товар в заявку')
      return
    }

    const payload = { comment: comment.trim() || null, items }

    setSaving(true)
    try {
      await api.createPointInventoryRequest(config, session, payload)
      toastSuccess('Заявка отправлена на склад')
      clearForm()
      await load()
      setViewMode('history')
    } catch (err: any) {
      if (isNetworkError(err)) {
        try {
          await offline.queueInventoryRequest(payload, session, session.company.id)
          toastSuccess('Нет интернета — заявка в очереди, отправится сама')
          clearForm()
        } catch (queueErr: any) {
          toastError('Не удалось сохранить даже локально: ' + (queueErr?.message || 'unknown'))
        }
      } else {
        toastError(err?.message || 'Не удалось отправить заявку')
        // Сервер отказал по остаткам — каталог устарел, обновляем и клампим корзину
        if (String(err?.message || '').includes('Недостаточно на складе')) {
          void load()
        }
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Действия в истории ─────────────────────────────────────────────────────

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

  async function handleCancelConfirmed() {
    const target = cancelTarget
    if (!target) return
    setCancelTarget(null)
    setCancelingId(target.id)
    try {
      await api.cancelPointInventoryRequest(config, session, target.id)
      toastSuccess('Заявка отменена')
      await load()
    } catch (err: any) {
      toastError(err?.message || 'Не удалось отменить заявку')
      // 409: заявку уже рассмотрел склад — обновляем историю, чтобы показать статус
      void load()
    } finally {
      setCancelingId(null)
    }
  }

  const requests = context?.requests || []
  const cartCount = cart.length
  const hasDraftNow = cart.length > 0 || comment.trim().length > 0
  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      {/* Декоративные акценты — как на экране смены */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-500/10" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl dark:bg-blue-500/10" />
      <div className="h-9 shrink-0 drag-region bg-card/80 backdrop-blur" />

      {/* Шапка */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 pb-2.5 backdrop-blur-xl no-drag">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/30">
            <ClipboardList className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Заявки на склад</p>
            <p className="truncate text-[11px] text-muted-foreground">{session.company.name} · {operatorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <WorkModeSwitch
            active="request"
            showSale={!!onSwitchToSale}
            showReturn={!!onSwitchToReturn}
            showHistory={!!onSwitchToHistory}
            showScanner={!!onSwitchToScanner}
            showRequest
            showArena={!!onSwitchToArena}
            requestBadge={hasDraftNow}
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onReturn={onSwitchToReturn}
            onHistory={onSwitchToHistory}
            onScanner={onSwitchToScanner}
            onArena={onSwitchToArena}
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

      {/* Вкладки: Заявка / История заявок */}
      <nav className="relative z-10 flex shrink-0 items-center gap-1 border-b border-border bg-card/80 px-3 backdrop-blur-xl sm:px-4">
        {(['create', 'history'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`relative px-4 py-2.5 text-sm font-medium transition ${
              viewMode === mode ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {mode === 'create'
              ? `Заявка${cartCount > 0 ? ` (${cartCount})` : ''}`
              : `История заявок${requests.length > 0 ? ` (${requests.length})` : ''}`}
            {viewMode === mode && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary shadow shadow-primary/30" />
            )}
          </button>
        ))}
      </nav>

      {/* Основной контент */}
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden lg:flex-row">
        {viewMode === 'history' ? (
          <section className="flex-1 overflow-auto p-3 sm:p-4">
            {loading && requests.length === 0 ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <ClipboardList className="h-12 w-12 opacity-30" />
                <p className="text-sm">Заявок ещё нет</p>
                <p className="text-xs">Соберите заявку на вкладке «Заявка» — она появится здесь</p>
              </div>
            ) : (
              <div className="mx-auto grid w-full max-w-5xl gap-2.5 sm:grid-cols-2">
                {requests.map((request) => {
                  const meta = statusMeta(request.status)
                  return (
                    <div key={request.id} className="flex flex-col rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{formatDateTime(request.created_at)}</p>
                          <p className="text-xs text-muted-foreground">#{request.id.slice(-6)}</p>
                        </div>
                        <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-2.5 space-y-1">
                        {(request.items || []).map((item) => {
                          const changed = item.approved_qty !== null && Number(item.approved_qty) !== Number(item.requested_qty)
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate text-muted-foreground">{item.item?.name || 'Товар'}</span>
                              <span className="shrink-0 font-mono font-medium">
                                × {item.requested_qty}
                                {changed ? (
                                  <span className="text-amber-600 dark:text-amber-400"> → {item.approved_qty}</span>
                                ) : null}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {request.comment && (
                        <p className="mt-2 text-xs text-muted-foreground">Комментарий: {request.comment}</p>
                      )}
                      {request.decision_comment && (
                        <p className="mt-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                          Склад: {request.decision_comment}
                        </p>
                      )}

                      <div className="mt-auto pt-2">
                        {request.status === 'new' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10 w-full gap-2 border-rose-300/60 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            disabled={cancelingId === request.id}
                            onClick={() => setCancelTarget(request)}
                          >
                            {cancelingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                            Отменить заявку
                          </Button>
                        )}
                        {request.status === 'issued' && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-11 w-full gap-2 text-sm font-semibold"
                            disabled={receivingId === request.id}
                            onClick={() => void handleReceive(request.id)}
                          >
                            {receivingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Получил товар
                          </Button>
                        )}
                        {request.status === 'received' && request.received_at && (
                          <p className="text-xs font-medium text-primary">Принято: {formatDateTime(request.received_at)}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Левая зона: поиск + каталог склада */}
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border bg-card p-3 sm:p-4">
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

              <div className="flex-1 overflow-y-auto bg-card/60">
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
                      const max = Number(item.warehouse_qty || 0)
                      const atMax = !!inCart && inCart.qty >= max
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
                              {' · '}склад: <span className="font-medium text-foreground">{max}</span> {item.unit || 'шт'}
                              {atMax ? <span className="ml-1.5 font-medium text-amber-600 dark:text-amber-400">макс {max}</span> : null}
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
            </section>

            {/* Правая зона: закреплённая панель заявки.
                На узком окне уходит вниз (border-t), кнопка отправки всегда видна. */}
            <aside className="flex max-h-[45vh] shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-96 lg:border-l lg:border-t-0 xl:w-[420px]">
              <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <ShoppingCart className="h-4 w-4 text-primary" />
                      Заявка
                      {cartCount > 0 && <Badge variant="default" className="text-[10px]">{cartCount} поз.</Badge>}
                    </div>
                    {hasDraftNow && (
                      <button type="button" onClick={clearForm} className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                        Очистить
                      </button>
                    )}
                  </div>
                </div>

                {cart.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                    <ShoppingCart className="h-7 w-7 opacity-20" />
                    <p className="text-sm">Нажмите на товар слева</p>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                    {cart.map((c) => (
                      <div key={c.item_id} className="space-y-2 px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium leading-tight">{c.name}</p>
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
                              className="h-11 w-14 rounded-lg border border-border bg-background px-1 text-center text-base font-semibold text-foreground outline-none focus:border-primary"
                              min={0}
                              max={c.warehouse_qty}
                            />
                            <button
                              type="button"
                              onClick={() => setCartQty(c.item_id, c.qty + 1)}
                              disabled={c.qty >= c.warehouse_qty}
                              className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-muted text-foreground transition hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <span className="ml-1 text-xs text-muted-foreground">{c.unit}</span>
                          </div>
                          <span className={`ml-auto shrink-0 text-xs ${c.qty >= c.warehouse_qty ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                            макс {c.warehouse_qty}
                          </span>
                        </div>
                        <input
                          value={c.comment}
                          onChange={(e) => setCartComment(c.item_id, e.target.value)}
                          placeholder="Комментарий (опц.)"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Низ панели: комментарий + отправка — всегда видимы */}
                <div className="shrink-0 space-y-3 border-t border-border bg-muted/40 p-4">
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Комментарий к заявке</Label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Что нужно и почему..."
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <Button type="submit" className="h-14 w-full gap-2 text-base font-semibold" disabled={saving || loading || cart.length === 0}>
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <ClipboardList className="h-5 w-5" />}
                    {cartCount > 0 ? `Отправить заявку · ${cartCount} поз.` : 'Отправить заявку'}
                  </Button>
                </div>
              </form>
            </aside>
          </>
        )}
      </main>

      {/* Подтверждение отмены заявки */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div>
              <h2 className="text-lg font-semibold">Отменить заявку?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Заявка от {formatDateTime(cancelTarget.created_at)} ({(cancelTarget.items || []).length} поз.) будет отменена.
                Отменить можно только пока склад её не рассмотрел.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setCancelTarget(null)}>
                Назад
              </Button>
              <Button
                type="button"
                className="h-11 gap-2 bg-rose-600 text-white hover:bg-rose-500"
                onClick={() => void handleCancelConfirmed()}
              >
                <Ban className="h-4 w-4" />
                Отменить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
