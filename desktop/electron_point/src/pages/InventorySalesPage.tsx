import { useEffect, useMemo, useState } from 'react'
import {
  CreditCard,
  Loader2,
  LogOut,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingBasket,
  Store,
  UserCircle2,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import * as api from '@/lib/api'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatDate, formatMoney, localRef, parseMoney } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointInventorySaleContext,
  PointInventorySaleItem,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

type CartLine = {
  item_id: string
  quantity: number
  unit_price: number
}

function paymentBadge(paymentMethod: string) {
  if (paymentMethod === 'cash') return 'Наличные'
  if (paymentMethod === 'kaspi') return 'Kaspi'
  return 'Смешанная'
}

function formatShiftLabel(shift: 'day' | 'night') {
  return shift === 'night' ? 'Ночь' : 'День'
}

export default function InventorySalesPage({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToScanner,
  onSwitchToRequest,
  onOpenCabinet,
}: Props) {
  const runtimeShift = useMemo(() => resolveRuntimeShift(), [])
  const [context, setContext] = useState<PointInventorySaleContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [comment, setComment] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventorySales(config, session)
      setContext(data)
    } catch (err: any) {
      setContext(null)
      setError(err?.message || 'Не удалось загрузить витрину точки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = context?.items || []
    if (!query) return list
    return list.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.barcode.toLowerCase().includes(query) ||
        item.category?.name?.toLowerCase().includes(query),
    )
  }, [context?.items, search])

  const cartDetailed = useMemo(() => {
    const itemsById = new Map((context?.items || []).map((item) => [item.id, item]))
    return cart
      .map((line) => ({
        ...line,
        item: itemsById.get(line.item_id) || null,
        total: Math.round((line.quantity * line.unit_price + Number.EPSILON) * 100) / 100,
      }))
      .filter((line) => line.item)
  }, [cart, context?.items])

  const cartTotal = useMemo(
    () => cartDetailed.reduce((sum, line) => sum + line.total, 0),
    [cartDetailed],
  )

  const saleCountToday = useMemo(() => (context?.sales || []).length, [context?.sales])

  function findAvailableQty(itemId: string) {
    return context?.items.find((item) => item.id === itemId)?.display_qty || 0
  }

  function addToCart(item: PointInventorySaleItem) {
    if (item.display_qty <= 0) {
      toastError('На витрине нет остатка по этому товару')
      return
    }

    setCart((current) => {
      const existing = current.find((line) => line.item_id === item.id)
      if (!existing) {
        return [
          ...current,
          {
            item_id: item.id,
            quantity: 1,
            unit_price: item.sale_price,
          },
        ]
      }

      if (existing.quantity + 1 > item.display_qty) {
        toastError('Нельзя продать больше остатка на витрине')
        return current
      }

      return current.map((line) =>
        line.item_id === item.id
          ? { ...line, quantity: Math.round((line.quantity + 1 + Number.EPSILON) * 1000) / 1000 }
          : line,
      )
    })
  }

  function changeQty(itemId: string, nextQty: number) {
    const available = findAvailableQty(itemId)
    if (nextQty <= 0) {
      setCart((current) => current.filter((line) => line.item_id !== itemId))
      return
    }

    if (nextQty > available) {
      toastError('Количество превышает остаток на витрине')
      return
    }

    setCart((current) =>
      current.map((line) => (line.item_id === itemId ? { ...line, quantity: nextQty } : line)),
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (cartDetailed.length === 0) {
      toastError('Добавьте хотя бы один товар в продажу')
      return
    }

    const cashAmount =
      paymentMethod === 'cash'
        ? cartTotal
        : paymentMethod === 'mixed'
          ? Math.min(cartTotal, Math.max(0, parseMoney(mixedCash)))
          : 0
    const kaspiAmount = paymentMethod === 'kaspi' ? cartTotal : paymentMethod === 'mixed' ? cartTotal - cashAmount : 0

    if (paymentMethod === 'mixed' && (cashAmount <= 0 || kaspiAmount <= 0)) {
      toastError('Для смешанной оплаты укажите часть наличными, а остальное уйдёт в Kaspi')
      return
    }

    setSaving(true)
    try {
      const isNightAfterMidnight = runtimeShift.shift === 'night' && runtimeShift.afterMidnightNight
      await api.createPointInventorySale(config, session, {
        sale_date: runtimeShift.date,
        shift: runtimeShift.shift,
        payment_method: paymentMethod,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        kaspi_before_midnight_amount: runtimeShift.shift === 'night' && isNightAfterMidnight ? 0 : kaspiAmount,
        kaspi_after_midnight_amount: runtimeShift.shift === 'night' && isNightAfterMidnight ? kaspiAmount : 0,
        comment: comment.trim() || null,
        local_ref: localRef(),
        items: cartDetailed.map((line) => ({
          item_id: line.item_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
      })
      toastSuccess('Продажа сохранена и добавлена в сменный контур')
      setCart([])
      setComment('')
      setMixedCash('')
      setPaymentMethod('cash')
      await load()
    } catch (err: any) {
      toastError(err?.message || 'Не удалось провести продажу')
    } finally {
      setSaving(false)
    }
  }

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="h-9 shrink-0 drag-region" />

      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-card px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{bootstrap.company.name}</p>
            <p className="text-xs text-muted-foreground">{operatorName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">
          <WorkModeSwitch
            active="sale"
            showSale
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            onShift={onSwitchToShift}
            onSale={() => undefined}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
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
        <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-5">
            <Card className="border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02]">
              <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <ShoppingBasket className="h-4 w-4 text-emerald-400" />
                    Продажи с витрины
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Каждая продажа сразу списывает товар с витрины и автоматически идёт в выручку смены.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <p className="text-xs text-muted-foreground">Текущая смена</p>
                  <p className="mt-1 font-semibold">{formatShiftLabel(runtimeShift.shift)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(runtimeShift.date)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <p className="text-xs text-muted-foreground">Локация</p>
                  <p className="mt-1 font-semibold">{context?.location?.name || 'Витрина точки'}</p>
                  <p className="text-xs text-muted-foreground">{saleCountToday} последних продаж</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <p className="text-xs text-muted-foreground">Режим Kaspi</p>
                  <p className="mt-1 font-semibold">
                    {runtimeShift.shift === 'night'
                      ? runtimeShift.afterMidnightNight
                        ? 'После 00:00'
                        : 'До 00:00'
                      : 'Дневная смена'}
                  </p>
                  <p className="text-xs text-muted-foreground">Для корректной суточной сверки</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Store className="h-4 w-4" />
                  Каталог витрины
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Поиск по названию, штрихкоду или категории"
                    className="pl-10"
                  />
                </div>

                {error ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    {error}
                  </div>
                ) : null}

                {loading ? (
                  <div className="flex h-56 items-center justify-center text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Загружаем витрину точки...
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {filteredItems.map((item) => {
                      const disabled = item.display_qty <= 0
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => addToCart(item)}
                          disabled={disabled}
                          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-emerald-400/40 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{item.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{item.barcode}</p>
                            </div>
                            <Badge variant={disabled ? 'secondary' : 'success'}>
                              {item.display_qty} {item.unit}
                            </Badge>
                          </div>
                          <div className="mt-4 flex items-center justify-between">
                            <div>
                              <p className="text-xs text-muted-foreground">{item.category?.name || 'Без категории'}</p>
                              <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(item.sale_price)}</p>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                              <Plus className="h-5 w-5" />
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="sticky top-0">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" />
                  Оформление продажи
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  Продажи из этого экрана автоматически попадут в выручку смены. В сменной форме их дублировать не нужно.
                </div>

                <div className="space-y-2">
                  {cartDetailed.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                      Выберите товары слева, чтобы собрать продажу.
                    </div>
                  ) : (
                    cartDetailed.map((line) => (
                      <div key={line.item_id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{line.item?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatMoney(line.unit_price)} за {line.item?.unit || 'шт'}
                            </p>
                          </div>
                          <p className="font-semibold">{formatMoney(line.total)}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeQty(line.item_id, line.quantity - 1)}>
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="min-w-[3rem] text-center text-sm font-semibold">{line.quantity}</span>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeQty(line.item_id, line.quantity + 1)}>
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Остаток после продажи: {Math.max(0, findAvailableQty(line.item_id) - line.quantity)} {line.item?.unit || 'шт'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'kaspi', 'mixed'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                        paymentMethod === method
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                          : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {paymentBadge(method)}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'mixed' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Наличными</Label>
                      <Input value={mixedCash} onChange={(event) => setMixedCash(event.target.value)} placeholder="0" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kaspi</Label>
                      <Input value={String(Math.max(0, cartTotal - Math.max(0, parseMoney(mixedCash))))} readOnly />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    placeholder="Например: продали через стойку, заказ в зал, спецкомментарий"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-emerald-400/50"
                  />
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Позиций</span>
                      <span>{cartDetailed.length}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                      <span>Штук</span>
                      <span>{cartDetailed.reduce((sum, line) => sum + line.quantity, 0)}</span>
                    </div>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Итог продажи</p>
                        <p className="mt-1 text-3xl font-semibold text-foreground">{formatMoney(cartTotal)}</p>
                      </div>
                      <Badge variant="secondary">{paymentBadge(paymentMethod)}</Badge>
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="w-full" disabled={saving || cartDetailed.length === 0}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBasket className="h-4 w-4" />}
                    Провести продажу
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Последние продажи
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(context?.sales || []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                    Пока продаж нет. Первая продажа появится здесь сразу после проведения.
                  </div>
                ) : (
                  (context?.sales || []).map((sale) => (
                    <div key={sale.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{paymentBadge(sale.payment_method)}</Badge>
                            <Badge variant="outline">{formatShiftLabel(sale.shift)}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formatDate(sale.sale_date)} · {new Date(sale.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <p className="text-lg font-semibold">{formatMoney(sale.total_amount)}</p>
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        {(sale.items || []).slice(0, 3).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3">
                            <span className="truncate">{item.item?.name || 'Товар'}</span>
                            <span>{item.quantity} × {formatMoney(item.unit_price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
