import { useEffect, useMemo, useState } from 'react'
import {
  CreditCard,
  Loader2,
  LogOut,
  Minus,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBasket,
  Store,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import {
  InventoryEmptyState,
  InventoryHeroPanel,
  InventoryMetric,
  InventoryNotice,
  InventorySectionCard,
} from '@/components/inventory-terminal-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import * as api from '@/lib/api'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatDate, formatMoney, localRef } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointInventoryReturnContext,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToSale?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

type ReturnLine = {
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

export default function InventoryReturnsPage({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToSale,
  onSwitchToScanner,
  onSwitchToRequest,
  onOpenCabinet,
}: Props) {
  const runtimeShift = useMemo(() => resolveRuntimeShift(), [])
  const [context, setContext] = useState<PointInventoryReturnContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSaleId, setSelectedSaleId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [comment, setComment] = useState('')
  const [cart, setCart] = useState<ReturnLine[]>([])

  async function load(preserveSaleId?: string) {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventoryReturns(config, session)
      setContext(data)
      const nextSaleId =
        preserveSaleId && data.sales.some((sale) => sale.id === preserveSaleId)
          ? preserveSaleId
          : data.sales[0]?.id || ''
      setSelectedSaleId(nextSaleId)
      setCart([])
    } catch (err: any) {
      setContext(null)
      setError(err?.message || 'Не удалось загрузить возвраты точки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const selectedSale = useMemo(
    () => (context?.sales || []).find((sale) => sale.id === selectedSaleId) || null,
    [context?.sales, selectedSaleId],
  )

  const saleItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    const items = Array.isArray(selectedSale?.items) ? selectedSale.items : []
    if (!query) return items
    return items.filter((line) => {
      const name = String(line.item?.name || '').toLowerCase()
      const barcode = String(line.item?.barcode || '').toLowerCase()
      return name.includes(query) || barcode.includes(query)
    })
  }, [search, selectedSale])

  const cartDetailed = useMemo(() => {
    const saleItemsById = new Map(
      (Array.isArray(selectedSale?.items) ? selectedSale.items : []).map((line) => [line.id, line]),
    )
    return cart
      .map((line) => {
        const saleLine = saleItemsById.get(line.item_id)
        if (!saleLine) return null
        return {
          ...line,
          saleLine,
          total: roundMoney(line.quantity * line.unit_price),
        }
      })
      .filter((line): line is NonNullable<typeof line> => !!line)
  }, [cart, selectedSale])

  const cartTotal = useMemo(
    () => cartDetailed.reduce((sum, line) => sum + line.total, 0),
    [cartDetailed],
  )

  function getReturnableQty(saleLineId: string) {
    const saleLine = (selectedSale?.items || []).find((line) => line.id === saleLineId)
    return roundQty(Number(saleLine?.returnable_qty || 0))
  }

  function addToCart(saleLineId: string) {
    const saleLine = (selectedSale?.items || []).find((line) => line.id === saleLineId)
    if (!saleLine) return
    const maxQty = getReturnableQty(saleLineId)
    if (maxQty <= 0) {
      toastError('По этой позиции уже нечего возвращать')
      return
    }

    setCart((current) => {
      const existing = current.find((line) => line.item_id === saleLineId)
      if (!existing) {
        return [
          ...current,
          {
            item_id: saleLineId,
            quantity: Math.min(1, maxQty),
            unit_price: Number(saleLine.unit_price || 0),
          },
        ]
      }

      const nextQty = Math.min(maxQty, roundQty(existing.quantity + 1))
      return current.map((line) => (line.item_id === saleLineId ? { ...line, quantity: nextQty } : line))
    })
  }

  function changeQty(saleLineId: string, nextQty: number) {
    const maxQty = getReturnableQty(saleLineId)
    if (nextQty <= 0) {
      setCart((current) => current.filter((line) => line.item_id !== saleLineId))
      return
    }

    setCart((current) =>
      current.map((line) =>
        line.item_id === saleLineId
          ? { ...line, quantity: Math.min(maxQty, roundQty(nextQty)) }
          : line,
      ),
    )
  }

  function buildRefundAmounts() {
    if (!selectedSale || cartTotal <= 0) {
      return {
        paymentMethod: 'cash' as const,
        cashAmount: 0,
        kaspiAmount: 0,
        kaspiBeforeMidnightAmount: 0,
        kaspiAfterMidnightAmount: 0,
      }
    }

    const saleTotal = Number(selectedSale.total_amount || 0)
    const paymentMethod = selectedSale.payment_method

    if (paymentMethod === 'cash') {
      return {
        paymentMethod,
        cashAmount: roundMoney(cartTotal),
        kaspiAmount: 0,
        kaspiBeforeMidnightAmount: 0,
        kaspiAfterMidnightAmount: 0,
      }
    }

    if (paymentMethod === 'kaspi') {
      const kaspiAmount = roundMoney(cartTotal)
      const beforeRatio =
        saleTotal > 0 && Number(selectedSale.kaspi_amount || 0) > 0
          ? Number(selectedSale.kaspi_before_midnight_amount || 0) / Number(selectedSale.kaspi_amount || 0)
          : 0
      const kaspiBeforeMidnightAmount = roundMoney(kaspiAmount * beforeRatio)
      const kaspiAfterMidnightAmount = roundMoney(kaspiAmount - kaspiBeforeMidnightAmount)
      return {
        paymentMethod,
        cashAmount: 0,
        kaspiAmount,
        kaspiBeforeMidnightAmount,
        kaspiAfterMidnightAmount,
      }
    }

    const cashRatio = saleTotal > 0 ? Number(selectedSale.cash_amount || 0) / saleTotal : 0
    const cashAmount = roundMoney(cartTotal * cashRatio)
    const kaspiAmount = roundMoney(cartTotal - cashAmount)
    const beforeRatio =
      Number(selectedSale.kaspi_amount || 0) > 0
        ? Number(selectedSale.kaspi_before_midnight_amount || 0) / Number(selectedSale.kaspi_amount || 0)
        : 0
    const kaspiBeforeMidnightAmount = roundMoney(kaspiAmount * beforeRatio)
    const kaspiAfterMidnightAmount = roundMoney(kaspiAmount - kaspiBeforeMidnightAmount)

    return {
      paymentMethod,
      cashAmount,
      kaspiAmount,
      kaspiBeforeMidnightAmount,
      kaspiAfterMidnightAmount,
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedSale) {
      toastError('Сначала выберите продажу')
      return
    }
    if (cartDetailed.length === 0) {
      toastError('Добавьте хотя бы одну проданную позицию в возврат')
      return
    }

    const refund = buildRefundAmounts()

    setSaving(true)
    try {
      await api.createPointInventoryReturn(config, session, {
        sale_id: selectedSale.id,
        return_date: runtimeShift.date,
        shift: runtimeShift.shift,
        payment_method: refund.paymentMethod,
        cash_amount: refund.cashAmount,
        kaspi_amount: refund.kaspiAmount,
        kaspi_before_midnight_amount: refund.kaspiBeforeMidnightAmount,
        kaspi_after_midnight_amount: refund.kaspiAfterMidnightAmount,
        comment: comment.trim() || null,
        local_ref: localRef(),
        items: cartDetailed.map((line) => ({
          item_id: String(line.saleLine.item?.id || ''),
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
      })
      toastSuccess('Возврат сохранён по выбранному чеку продажи')
      setComment('')
      await load(selectedSale.id)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось провести возврат')
    } finally {
      setSaving(false)
    }
  }

  const operatorName = session.operator.full_name || session.operator.name || session.operator.username
  const refund = buildRefundAmounts()
  const salesCount = useMemo(() => (context?.sales || []).length, [context?.sales])
  const returnsCount = useMemo(() => (context?.returns || []).length, [context?.returns])
  const selectedSaleReturnableQty = useMemo(
    () => saleItems.reduce((sum, line) => sum + Number(line.returnable_qty || 0), 0),
    [saleItems],
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="h-9 shrink-0 drag-region bg-card" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-5 pb-3 no-drag">
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
            active="return"
            showSale={!!onSwitchToSale}
            showReturn
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onReturn={() => undefined}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
            onCabinet={onOpenCabinet}
          />
          <Button variant="ghost" size="sm" onClick={() => void load(selectedSaleId)} disabled={loading} className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[360px_minmax(0,1fr)_400px]">
          <div className="space-y-5">
            <InventoryHeroPanel
              icon={RotateCcw}
              accent="amber"
              title="Возврат по чеку"
              description="Возврат идёт только по реально проданным позициям. Товар возвращается на витрину, а сумма автоматически вычитается из смены."
            >
              <div className="grid gap-3 md:grid-cols-3">
                <InventoryMetric label="Продаж доступно" value={salesCount} hint="Чеки для возврата" accent="blue" />
                <InventoryMetric label="Можно вернуть" value={selectedSaleReturnableQty} hint="Штук по выбранному чеку" accent="amber" />
                <InventoryMetric label="Возвратов за смену" value={returnsCount} hint="Уже оформленные возвраты" accent="violet" />
              </div>
            </InventoryHeroPanel>

            <InventorySectionCard
              icon={ShoppingBasket}
              title="Недавние продажи"
              description="Выберите чек, по которому реально есть что вернуть."
            >
                {error ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    {error}
                  </div>
                ) : null}

                {loading ? (
                  <div className="flex h-56 items-center justify-center text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Загружаем продажи...
                  </div>
                ) : (context?.sales || []).length === 0 ? (
                  <InventoryEmptyState title="Продаж пока нет" description="Сначала должна появиться хотя бы одна продажа, которую можно вернуть." compact />
                ) : (
                  (context?.sales || []).map((sale) => {
                    const saleItems = Array.isArray(sale.items) ? sale.items : []
                    const remainingQty = saleItems.reduce(
                      (sum, line) => sum + Number(line.returnable_qty || 0),
                      0,
                    )
                    const isSelected = sale.id === selectedSaleId
                    return (
                      <button
                        key={sale.id}
                        type="button"
                        onClick={() => {
                          setSelectedSaleId(sale.id)
                          setCart([])
                          setSearch('')
                        }}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          isSelected
                            ? 'border-amber-400/50 bg-amber-500/10'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isSelected ? 'warning' : 'secondary'}>
                                {paymentBadge(sale.payment_method)}
                              </Badge>
                              <Badge variant="outline">{formatShiftLabel(sale.shift)}</Badge>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {formatDate(sale.sale_date)} ·{' '}
                              {new Date(sale.sold_at).toLocaleTimeString('ru-RU', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <p className="text-lg font-semibold">{formatMoney(sale.total_amount)}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Позиций: {saleItems.length}</span>
                          <span>Можно вернуть: {roundQty(remainingQty)}</span>
                        </div>
                      </button>
                    )
                  })
                )}
            </InventorySectionCard>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Store className="h-4 w-4" />
                  Проданные позиции
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Поиск по названию или штрихкоду"
                    className="pl-10"
                    disabled={!selectedSale}
                  />
                </div>

                {!selectedSale ? (
                  <InventoryEmptyState
                    title="Сначала выберите чек"
                    description="Слева выберите продажу, после этого здесь откроются только реально проданные позиции."
                  />
                ) : saleItems.length === 0 ? (
                  <InventoryEmptyState
                    title="По чеку нечего возвращать"
                    description="Все позиции уже возвращены или в продаже не осталось строк для возврата."
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {saleItems.map((line) => {
                      const returnableQty = roundQty(Number(line.returnable_qty || 0))
                      const soldQty = roundQty(Number(line.quantity || 0))
                      const returnedQty = roundQty(Number(line.returned_qty || 0))
                      const disabled = returnableQty <= 0
                      return (
                        <button
                          key={line.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => addToCart(line.id)}
                          className={`rounded-2xl border p-4 text-left transition ${
                            disabled
                              ? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60'
                              : 'border-white/10 bg-white/[0.03] hover:border-amber-400/40 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {line.item?.name || 'Товар'}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {line.item?.barcode || 'Без штрихкода'}
                              </p>
                            </div>
                            <Badge variant={disabled ? 'secondary' : 'outline'}>
                              {returnableQty} шт
                            </Badge>
                          </div>

                          <div className="mt-4 flex items-center justify-between">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Продано: {soldQty} · Уже вернули: {returnedQty}
                              </p>
                              <p className="mt-1 text-lg font-semibold text-foreground">
                                {formatMoney(Number(line.unit_price || 0))}
                              </p>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                              <Package className="h-5 w-5" />
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Последние возвраты
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(context?.returns || []).length === 0 ? (
                  <InventoryEmptyState title="Возвратов пока нет" description="Оформленные возвраты появятся здесь для быстрого контроля." compact />
                ) : (
                  (context?.returns || []).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="warning">{paymentBadge(item.payment_method)}</Badge>
                            <Badge variant="outline">{formatShiftLabel(item.shift)}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formatDate(item.return_date)} ·{' '}
                            {new Date(item.returned_at).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <p className="text-lg font-semibold">{formatMoney(item.total_amount)}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <InventorySectionCard
              icon={CreditCard}
              title="Оформление возврата"
              description="Возврат идёт только из выбранного чека и сразу уменьшает выручку смены."
              sticky
            >
                <InventoryNotice tone="amber">
                  Возврат уменьшает выручку текущей смены и привязывается к выбранному чеку продажи.
                </InventoryNotice>

                <div className="grid grid-cols-2 gap-2">
                  <InventoryMetric label="Наличными" value={formatMoney(refund.cashAmount)} accent="amber" />
                  <InventoryMetric label="Kaspi" value={formatMoney(refund.kaspiAmount)} accent="blue" />
                </div>

                {selectedSale ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Выбранный чек
                        </p>
                        <p className="mt-1 font-semibold">
                          {formatDate(selectedSale.sale_date)} · {paymentBadge(selectedSale.payment_method)}
                        </p>
                      </div>
                      <Badge variant="outline">{formatMoney(selectedSale.total_amount)}</Badge>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {cartDetailed.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                      Выберите проданные позиции, чтобы оформить возврат.
                    </div>
                  ) : (
                    cartDetailed.map((line) => {
                      const maxQty = getReturnableQty(line.item_id)
                      return (
                        <div key={line.item_id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{line.saleLine.item?.name || 'Товар'}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatMoney(line.unit_price)} за шт · максимум к возврату {maxQty}
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => changeQty(line.item_id, line.quantity + 1)}
                                disabled={line.quantity >= maxQty}
                              >
                                <Package className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              На витрину вернётся: {line.quantity} шт
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Способ возврата</span>
                    <span>{paymentBadge(refund.paymentMethod)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-muted-foreground">
                    <span>Наличными</span>
                    <span>{formatMoney(refund.cashAmount)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-muted-foreground">
                    <span>Kaspi</span>
                    <span>{formatMoney(refund.kaspiAmount)}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    placeholder="Причина возврата, отмена заказа, ошибка по товару"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-amber-400/50"
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
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Итог возврата</p>
                        <p className="mt-1 text-3xl font-semibold text-foreground">{formatMoney(cartTotal)}</p>
                      </div>
                      <Badge variant="warning">{paymentBadge(refund.paymentMethod)}</Badge>
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="w-full" disabled={saving || cartDetailed.length === 0 || !selectedSale}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Провести возврат
                  </Button>
                </form>
            </InventorySectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}
