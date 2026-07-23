import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  LogOut,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import ScreenBackdrop, { screenBgClass } from '@/components/ScreenBackdrop'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import {
  buildReceiptHtmlForPreview,
  printReceiptFromIframe,
  type SaleReceiptPreview,
} from '@/lib/receipt-html'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatDate, formatMoney, localRef } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointInventoryReturnContext,
  PointReceiptSettings,
} from '@/types'

interface Props {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift: () => void
  onSwitchToSale?: () => void
  onSwitchToHistory?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onSwitchToArena?: () => void
  onOpenCabinet?: () => void
}

type ReturnLine = {
  item_id: string
  quantity: number
  unit_price: number
}

function paymentBadge(paymentMethod: string) {
  if (paymentMethod === 'cash') return 'Наличные'
  if (paymentMethod === 'kaspi') return 'Безналичный'
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
  onSwitchToHistory,
  onSwitchToScanner,
  onSwitchToRequest,
  onSwitchToArena,
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
  const [receiptSettings, setReceiptSettings] = useState<PointReceiptSettings | null>(null)
  const [lastReceipt, setLastReceipt] = useState<SaleReceiptPreview | null>(null)
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings = await api.getPointReceiptSettings(config, session.company.id)
      if (!cancelled) setReceiptSettings(settings)
    })()
    return () => {
      cancelled = true
    }
  }, [config, session.company.id])

  async function load(preserveSaleId?: string) {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventoryReturns(config, session)
      setContext(data)
      const shiftSales = data.sales || []
      const nextSaleId =
        preserveSaleId && shiftSales.some((sale) => sale.id === preserveSaleId)
          ? preserveSaleId
          : shiftSales[0]?.id || ''
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

  const currentShiftSales = useMemo(() => {
    const sales = context?.sales || []
    return [...sales].sort((a, b) => {
      const aCurrent = a.sale_date === runtimeShift.date && a.shift === runtimeShift.shift ? 1 : 0
      const bCurrent = b.sale_date === runtimeShift.date && b.shift === runtimeShift.shift ? 1 : 0
      if (aCurrent !== bCurrent) return bCurrent - aCurrent
      return String(b.sold_at || '').localeCompare(String(a.sold_at || ''))
    })
  }, [context?.sales, runtimeShift])

  const selectedSale = useMemo(
    () => currentShiftSales.find((sale) => sale.id === selectedSaleId) || null,
    [currentShiftSales, selectedSaleId],
  )

  const saleItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    const items = Array.isArray(selectedSale?.items) ? selectedSale.items : []
    if (!query) return items
    return items.filter((line) => {
      const name = String(line.item?.name || (line as any).universal_name || '').toLowerCase()
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
      const returnRef = localRef()
      const result = await api.createPointInventoryReturn(config, session, {
        sale_id: selectedSale.id,
        return_date: runtimeShift.date,
        shift: runtimeShift.shift,
        payment_method: refund.paymentMethod,
        cash_amount: refund.cashAmount,
        kaspi_amount: refund.kaspiAmount,
        kaspi_before_midnight_amount: refund.kaspiBeforeMidnightAmount,
        kaspi_after_midnight_amount: refund.kaspiAfterMidnightAmount,
        comment: comment.trim() || null,
        local_ref: returnRef,
        items: cartDetailed.map((line) => ({
          // Универсальная позиция чека: item_id = null + universal_name
          item_id: line.saleLine.item?.id ? String(line.saleLine.item.id) : null,
          universal_name: line.saleLine.item?.id ? null : (line.saleLine as any).universal_name || null,
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
      })

      // Preview чека возврата согласно приказу №626 — отдельный фискальный чек
      // «возврат прихода» со ссылкой на оригинальный чек.
      const nowTs = new Date()
      const originalSoldAt = selectedSale.sold_at ? new Date(selectedSale.sold_at) : null
      const returnPreview: SaleReceiptPreview = {
        saleId: (result as any)?.return_id || returnRef,
        saleDate: nowTs.toLocaleDateString('ru-RU'),
        saleTime: nowTs.toLocaleTimeString('ru-RU'),
        shift: runtimeShift.shift,
        paymentMethod: refund.paymentMethod,
        cashAmount: refund.cashAmount,
        kaspiAmount: refund.kaspiAmount,
        totalAmount: refund.cashAmount + refund.kaspiAmount,
        subtotal: refund.cashAmount + refund.kaspiAmount,
        discountAmount: 0,
        loyaltyDiscountAmount: 0,
        customer: null,
        comment: comment.trim() || null,
        operatorName,
        companyName: session.company?.name || '',
        locationName: (context as any)?.location?.name || '',
        receiptSettings,
        isReturn: true,
        originalSaleId: selectedSale.id,
        originalSaleDate: originalSoldAt ? originalSoldAt.toLocaleDateString('ru-RU') : null,
        originalSaleTime: originalSoldAt ? originalSoldAt.toLocaleTimeString('ru-RU') : null,
        refundReason: comment.trim() || null,
        lines: cartDetailed.map((line) => ({
          name: line.saleLine.item?.name || (line.saleLine as any).universal_name || 'Товар',
          quantity: line.quantity,
          unit_price: line.unit_price,
          total: line.quantity * line.unit_price,
          unit: (line.saleLine.item as { unit?: string | null } | null)?.unit || null,
        })),
      }
      setLastReceipt(returnPreview)

      toastSuccess('Возврат оформлен — чек ниже')
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
  const salesCount = useMemo(() => currentShiftSales.length, [currentShiftSales])

  return (
    <div className={`relative flex h-screen flex-col overflow-hidden ${screenBgClass} text-foreground`}>
      <ScreenBackdrop accent="rose" />
      <div className="h-9 shrink-0 drag-region bg-card/80 backdrop-blur" />
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 backdrop-blur-xl px-4 pb-2 no-drag">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary shadow-md shadow-primary/30">
            <span className="text-[9px] font-bold tracking-tight text-primary-foreground">OP</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{session.company.name}</p>
            <p className="text-[10px] text-muted-foreground">{operatorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <WorkModeSwitch
            active="return"
            showSale={!!onSwitchToSale}
            showReturn
            showHistory={!!onSwitchToHistory}
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            showArena={!!onSwitchToArena}
            onShift={onSwitchToShift}
            onSale={onSwitchToSale}
            onReturn={() => undefined}
            onHistory={onSwitchToHistory}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
            onArena={onSwitchToArena}
            onCabinet={onOpenCabinet}
          />
          <Button variant="ghost" size="sm" onClick={() => void load(selectedSaleId)} disabled={loading} className="h-9 w-9 p-0 text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-9 w-9 p-0 text-muted-foreground">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: sales list */}
        <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Чеки{salesCount > 0 ? ` (${salesCount})` : ''}
            </p>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">{error}</div>
            )}
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : currentShiftSales.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Нет продаж для возврата</p>
            ) : (
              currentShiftSales.map((sale) => {
                const saleItemsList = Array.isArray(sale.items) ? sale.items : []
                const remainingQty = saleItemsList.reduce((sum, line) => sum + Number(line.returnable_qty || 0), 0)
                const isSelected = sale.id === selectedSaleId
                return (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => {
                      if (cart.length > 0 && !window.confirm('В корзине есть товары для возврата. Переключить продажу и очистить корзину?')) return
                      setSelectedSaleId(sale.id); setCart([]); setSearch('')
                    }}
                    className={`w-full rounded-xl border p-2.5 text-left transition ${
                      isSelected
                        ? 'border-destructive/50 bg-destructive/10 ring-1 ring-destructive/30'
                        : 'border-border bg-card hover:border-destructive/30 hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <Badge variant={isSelected ? 'destructive' : 'secondary'} className="text-[10px]">
                        {paymentBadge(sale.payment_method)}
                      </Badge>
                      <p className="text-xs font-semibold">{formatMoney(sale.total_amount)}</p>
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {formatDate(sale.sale_date)} · {new Date(sale.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Вернуть: {roundQty(remainingQty)}</p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* MIDDLE: sale items */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
          <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Позиции чека</p>
              {selectedSale && (
                <Badge variant="secondary" className="text-[10px]">{formatMoney(selectedSale.total_amount)}</Badge>
              )}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию"
                disabled={!selectedSale}
                className="w-full rounded-lg border border-input bg-muted text-foreground py-2 pl-8 pr-3 text-xs outline-none focus:border-ring disabled:opacity-50"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!selectedSale ? (
              <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground px-4">
                Выберите чек слева
              </div>
            ) : saleItems.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground px-4">
                По чеку нечего возвращать
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                {saleItems.map((line) => {
                  const returnableQty = roundQty(Number(line.returnable_qty || 0))
                  const soldQty = roundQty(Number(line.quantity || 0))
                  const disabled = returnableQty <= 0
                  return (
                    <button
                      key={line.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => addToCart(line.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        disabled
                          ? 'cursor-not-allowed border-border bg-muted opacity-50'
                          : 'border-border bg-card hover:border-destructive/40 hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <p className="truncate text-xs font-semibold leading-tight text-foreground">{line.item?.name || (line as any).universal_name || 'Товар'}</p>
                        <Badge variant={disabled ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
                          {returnableQty}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground">{formatMoney(Number(line.unit_price || 0))}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Продано: {soldQty}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: return cart + form */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Возврат{cartDetailed.length > 0 ? ` (${cartDetailed.length})` : ''}
              </p>
              {cartDetailed.length > 0 && (
                <button type="button" onClick={() => setCart([])} className="text-xs text-destructive transition hover:opacity-80">
                  Очистить
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {cartDetailed.length === 0 ? (
              <div className="flex h-20 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Выберите позиции из чека
              </div>
            ) : (
              cartDetailed.map((line) => {
                const maxQty = getReturnableQty(line.item_id)
                return (
                  <div key={line.item_id} className="rounded-xl border border-destructive/20 bg-card p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-medium leading-tight">{line.saleLine.item?.name || (line.saleLine as any).universal_name || 'Товар'}</p>
                      <p className="shrink-0 text-xs font-semibold text-destructive">{formatMoney(line.total)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeQty(line.item_id, line.quantity - 1)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="min-w-[2rem] text-center text-sm font-semibold">{line.quantity}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeQty(line.item_id, line.quantity + 1)} disabled={line.quantity >= maxQty}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">макс. {maxQty}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 space-y-2.5 border-t border-border p-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Причина возврата"
              className="w-full rounded-lg border border-input bg-muted text-foreground px-2.5 py-2 text-xs outline-none focus:border-ring"
            />

            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <div className="space-y-1 text-xs text-muted-foreground">
                {refund.cashAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Наличными</span><span>{formatMoney(refund.cashAmount)}</span>
                  </div>
                )}
                {refund.kaspiAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Безналичный</span><span>{formatMoney(refund.kaspiAmount)}</span>
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">К возврату</p>
                  <p className="text-3xl font-bold text-destructive">{formatMoney(cartTotal)}</p>
                </div>
                <Badge variant="destructive">{paymentBadge(refund.paymentMethod)}</Badge>
              </div>
            </div>

            <Button type="submit" variant="destructive" size="lg" className="h-12 w-full text-base font-semibold" disabled={saving || cartDetailed.length === 0 || !selectedSale}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
              Провести возврат
            </Button>
          </form>
        </div>
      </div>

      {/* Чек возврата (preview + печать) */}
      {lastReceipt ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3 sm:p-4"
          onClick={() => setLastReceipt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive text-destructive-foreground">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-semibold text-destructive">Возврат оформлен</p>
                  <p className="text-xs text-destructive/80">
                    Возврат к чеку #{lastReceipt.originalSaleId?.slice(-6) || '—'} · {formatMoney(lastReceipt.totalAmount)} ₸
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => printReceiptFromIframe(receiptIframeRef.current)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Печать
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLastReceipt(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-muted">
              <iframe
                ref={receiptIframeRef}
                title="Чек возврата"
                srcDoc={buildReceiptHtmlForPreview(lastReceipt)}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
