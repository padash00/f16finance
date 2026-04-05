import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  LogOut,
  Minus,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  ReceiptText,
  Search,
  ShoppingBasket,
  Star,
  Tag,
  UserCircle2,
  X,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import * as api from '@/lib/api'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatDate, formatMoney, localRef, parseMoney } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  Customer,
  LoyaltyConfig,
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
  onSwitchToReturn?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

type CartLine = {
  item_id: string
  quantity: number
  unit_price: number
}

type ReceiptLine = {
  item_id: string
  name: string
  quantity: number
  unit_price: number
  total: number
  unit: string | null
}

type SaleReceiptPreview = {
  saleId: string | null
  saleDate: string
  saleTime: string
  shift: 'day' | 'night'
  paymentMethod: 'cash' | 'kaspi' | 'mixed'
  cashAmount: number
  kaspiAmount: number
  totalAmount: number
  subtotal: number
  discountAmount: number
  loyaltyDiscountAmount: number
  comment: string | null
  customer: Customer | null
  companyName: string
  locationName: string
  operatorName: string
  lines: ReceiptLine[]
}

function paymentBadge(paymentMethod: string) {
  if (paymentMethod === 'cash') return 'Наличные'
  if (paymentMethod === 'kaspi') return 'Kaspi'
  return 'Смешанная'
}

function formatShiftLabel(shift: 'day' | 'night') {
  return shift === 'night' ? 'Ночь' : 'День'
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildReceiptHtml(preview: SaleReceiptPreview) {
  const linesHtml = preview.lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.name)}</td>
          <td style="text-align:center;">${line.quantity}</td>
          <td style="text-align:right;">${escapeHtml(formatMoney(line.unit_price))}</td>
          <td style="text-align:right;">${escapeHtml(formatMoney(line.total))}</td>
        </tr>
      `,
    )
    .join('')

  const customerBlock = preview.customer
    ? `<div style="margin-top:8px;font-size:12px;">Клиент: ${escapeHtml(preview.customer.name)}${preview.customer.phone ? ` (${escapeHtml(preview.customer.phone)})` : ''}</div>`
    : ''

  const commentBlock = preview.comment
    ? `<div style="margin-top:8px;font-size:12px;">Комментарий: ${escapeHtml(preview.comment)}</div>`
    : ''

  const discountRows = [
    preview.discountAmount > 0
      ? `<div style="display:flex;justify-content:space-between;"><span>Скидка</span><strong>- ${escapeHtml(formatMoney(preview.discountAmount))}</strong></div>`
      : '',
    preview.loyaltyDiscountAmount > 0
      ? `<div style="display:flex;justify-content:space-between;"><span>Бонусы</span><strong>- ${escapeHtml(formatMoney(preview.loyaltyDiscountAmount))}</strong></div>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Чек ${escapeHtml(preview.saleId?.slice(-6) || '')}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 16px; color: #111827; }
      .wrap { max-width: 360px; margin: 0 auto; }
      .center { text-align: center; }
      .muted { color: #6b7280; font-size: 12px; }
      .line { border-top: 1px dashed #9ca3af; margin: 10px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      td { padding: 2px 0; vertical-align: top; }
      .summary { font-size: 13px; }
      .total { font-size: 16px; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="center">
        <div style="font-weight:700;font-size:18px;">ORDA POINT</div>
        <div class="muted">${escapeHtml(preview.companyName)} · ${escapeHtml(preview.locationName)}</div>
        <div class="muted">${escapeHtml(preview.saleDate)} ${escapeHtml(preview.saleTime)} · ${escapeHtml(formatShiftLabel(preview.shift))}</div>
        <div class="muted">Чек #${escapeHtml(preview.saleId?.slice(-6) || 'новый')}</div>
      </div>
      <div class="line"></div>
      <table>
        <thead>
          <tr class="muted">
            <td>Товар</td>
            <td style="text-align:center;">Кол.</td>
            <td style="text-align:right;">Цена</td>
            <td style="text-align:right;">Сумма</td>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
      </table>
      <div class="line"></div>
      <div class="summary" style="display:flex;justify-content:space-between;"><span>Подытог</span><strong>${escapeHtml(formatMoney(preview.subtotal))}</strong></div>
      ${discountRows}
      <div class="line"></div>
      <div class="total" style="display:flex;justify-content:space-between;"><span>Итого</span><span>${escapeHtml(formatMoney(preview.totalAmount))}</span></div>
      <div class="summary" style="display:flex;justify-content:space-between;margin-top:6px;"><span>${escapeHtml(paymentBadge(preview.paymentMethod))}</span><strong>${escapeHtml(formatMoney(preview.totalAmount))}</strong></div>
      ${preview.paymentMethod === 'mixed' ? `<div class="muted" style="margin-top:4px;">Наличные: ${escapeHtml(formatMoney(preview.cashAmount))} · Kaspi: ${escapeHtml(formatMoney(preview.kaspiAmount))}</div>` : ''}
      ${customerBlock}
      ${commentBlock}
      <div class="muted" style="margin-top:10px;">Оператор: ${escapeHtml(preview.operatorName)}</div>
      <div class="center muted" style="margin-top:12px;">Спасибо за покупку</div>
    </div>
    <script>
      window.onload = () => { window.print(); };
    </script>
  </body>
</html>`
}

function printReceipt(preview: SaleReceiptPreview) {
  const printWindow = window.open('', '_blank', 'width=420,height=720')
  if (!printWindow) {
    toastError('Не удалось открыть окно печати чека')
    return
  }

  printWindow.document.open()
  printWindow.document.write(buildReceiptHtml(preview))
  printWindow.document.close()
}

export default function InventorySalesPage({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToReturn,
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
  const [catalogView, setCatalogView] = useState<'all' | 'low' | 'cart'>('all')
  const [comment, setComment] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [receiptPreview, setReceiptPreview] = useState<SaleReceiptPreview | null>(null)

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | null>(null)
  const [customerSearching, setCustomerSearching] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [loyaltyPointsToSpend, setLoyaltyPointsToSpend] = useState(0)
  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Extras panel
  const [showExtras, setShowExtras] = useState(false)

  // Discount
  const [showDiscountPanel, setShowDiscountPanel] = useState(false)
  const [manualDiscountPercent, setManualDiscountPercent] = useState('')
  const [promoCodeInput, setPromoCodeInput] = useState('')
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null)
  const [promoDiscountPercent, setPromoDiscountPercent] = useState(0)
  const [promoValidating, setPromoValidating] = useState(false)

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

  // Customer search with debounce
  useEffect(() => {
    if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current)
    if (!customerSearch.trim() || customerSearch.trim().length < 2) {
      setCustomerResults([])
      setShowCustomerDropdown(false)
      return
    }
    customerSearchTimeout.current = setTimeout(async () => {
      setCustomerSearching(true)
      try {
        const result = await api.searchCustomers(config, customerSearch.trim())
        setCustomerResults(result.customers)
        setLoyaltyConfig(result.loyalty_config)
        setShowCustomerDropdown(result.customers.length > 0)
      } catch {
        setCustomerResults([])
      } finally {
        setCustomerSearching(false)
      }
    }, 500)
    return () => {
      if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current)
    }
  }, [customerSearch, config])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = context?.items || []
    const cartIds = new Set(cart.map((line) => line.item_id))
    const scoped =
      catalogView === 'low'
        ? list.filter((item) => Number(item.display_qty || 0) > 0 && Number(item.display_qty || 0) <= 3)
        : catalogView === 'cart'
          ? list.filter((item) => cartIds.has(item.id))
          : list
    if (!query) return scoped
    return scoped.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.barcode.toLowerCase().includes(query) ||
        item.category?.name?.toLowerCase().includes(query),
    )
  }, [catalogView, cart, context?.items, search])

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

  const availableItemsCount = useMemo(
    () => (context?.items || []).filter((item) => Number(item.display_qty || 0) > 0).length,
    [context?.items],
  )
  const lowStockItemsCount = useMemo(
    () => (context?.items || []).filter((item) => Number(item.display_qty || 0) > 0 && Number(item.display_qty || 0) <= 3).length,
    [context?.items],
  )
  const cartUnits = useMemo(
    () => cartDetailed.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [cartDetailed],
  )

  // Discount calculations
  const effectiveDiscountPercent = useMemo(() => {
    const manual = parseFloat(manualDiscountPercent) || 0
    return Math.min(99, Math.max(0, manual > 0 ? manual : promoDiscountPercent))
  }, [manualDiscountPercent, promoDiscountPercent])

  const discountAmount = useMemo(() => {
    if (effectiveDiscountPercent <= 0) return 0
    return Math.round((cartTotal * effectiveDiscountPercent) / 100 * 100) / 100
  }, [cartTotal, effectiveDiscountPercent])

  const afterDiscountTotal = useMemo(() => Math.max(0, cartTotal - discountAmount), [cartTotal, discountAmount])

  const loyaltyDiscountAmount = useMemo(() => {
    if (!selectedCustomer || !loyaltyConfig || loyaltyPointsToSpend <= 0) return 0
    const tengePerPoint = loyaltyConfig.tenge_per_point || 1
    const maxPercent = loyaltyConfig.max_redeem_percent || 50
    const maxByPercent = Math.floor(afterDiscountTotal * maxPercent / 100)
    const maxByPoints = Math.floor(loyaltyPointsToSpend * tengePerPoint)
    return Math.min(maxByPoints, maxByPercent, afterDiscountTotal)
  }, [selectedCustomer, loyaltyConfig, loyaltyPointsToSpend, afterDiscountTotal])

  const finalTotal = useMemo(() => Math.max(0, afterDiscountTotal - loyaltyDiscountAmount), [afterDiscountTotal, loyaltyDiscountAmount])

  const maxRedeemablePoints = useMemo(() => {
    if (!selectedCustomer || !loyaltyConfig) return 0
    const maxPercent = loyaltyConfig.max_redeem_percent || 50
    const tengePerPoint = loyaltyConfig.tenge_per_point || 1
    const maxTenge = Math.floor(afterDiscountTotal * maxPercent / 100)
    const pointsByTenge = Math.ceil(maxTenge / tengePerPoint)
    return Math.min(selectedCustomer.loyalty_points, pointsByTenge)
  }, [selectedCustomer, loyaltyConfig, afterDiscountTotal])

  function findAvailableQty(itemId: string) {
    return context?.items.find((item) => item.id === itemId)?.display_qty || 0
  }

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerSearch(customer.name + (customer.phone ? ` (${customer.phone})` : ''))
    setShowCustomerDropdown(false)
    setLoyaltyPointsToSpend(0)
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setCustomerSearch('')
    setCustomerResults([])
    setShowCustomerDropdown(false)
    setLoyaltyPointsToSpend(0)
  }

  async function applyPromoCode() {
    if (!promoCodeInput.trim()) return
    setPromoValidating(true)
    try {
      const result = await api.validatePromoCode(config, promoCodeInput.trim(), cartTotal)
      setAppliedPromoCode(promoCodeInput.trim())
      if (result.type === 'percent') {
        setPromoDiscountPercent(result.value)
        setManualDiscountPercent('')
      } else if (result.type === 'fixed') {
        setPromoDiscountPercent(0)
        // Use fixed amount as manual percent approximation
        const pct = cartTotal > 0 ? (result.value / cartTotal) * 100 : 0
        setManualDiscountPercent(String(Math.round(pct * 10) / 10))
      }
      toastSuccess(`Промокод «${promoCodeInput.trim()}» применён`)
    } catch (err: any) {
      toastError(err?.message || 'Промокод недействителен')
    } finally {
      setPromoValidating(false)
    }
  }

  function resetSaleForm() {
    setCart([])
    setComment('')
    setCatalogView('all')
    setMixedCash('')
    setPaymentMethod('cash')
    clearCustomer()
    setManualDiscountPercent('')
    setPromoCodeInput('')
    setAppliedPromoCode(null)
    setPromoDiscountPercent(0)
    setShowDiscountPanel(false)
    setLoyaltyPointsToSpend(0)
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
        ? finalTotal
        : paymentMethod === 'mixed'
          ? Math.min(finalTotal, Math.max(0, parseMoney(mixedCash)))
          : 0
    const kaspiAmount = paymentMethod === 'kaspi' ? finalTotal : paymentMethod === 'mixed' ? finalTotal - cashAmount : 0

    if (paymentMethod === 'mixed' && (cashAmount <= 0 || kaspiAmount <= 0)) {
      toastError('Для смешанной оплаты укажите часть наличными, а остальное уйдёт в Kaspi')
      return
    }

    setSaving(true)
    try {
      const isNightAfterMidnight = runtimeShift.shift === 'night' && runtimeShift.afterMidnightNight
      const saleResult = await api.createPointInventorySale(config, session, {
        sale_date: runtimeShift.date,
        shift: runtimeShift.shift,
        payment_method: paymentMethod,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        kaspi_before_midnight_amount: runtimeShift.shift === 'night' && isNightAfterMidnight ? 0 : kaspiAmount,
        kaspi_after_midnight_amount: runtimeShift.shift === 'night' && isNightAfterMidnight ? kaspiAmount : 0,
        customer_id: selectedCustomer?.id || null,
        loyalty_points_spent: loyaltyPointsToSpend,
        discount_amount: discountAmount,
        loyalty_discount_amount: loyaltyDiscountAmount,
        comment: comment.trim() || null,
        local_ref: localRef(),
        items: cartDetailed.map((line) => ({
          item_id: line.item_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
      } as any)

      setReceiptPreview({
        saleId: saleResult.sale_id,
        saleDate: formatDate(runtimeShift.date),
        saleTime: saleResult.sold_at
          ? new Date(saleResult.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        shift: runtimeShift.shift,
        paymentMethod,
        cashAmount,
        kaspiAmount,
        totalAmount: finalTotal,
        subtotal: cartTotal,
        discountAmount,
        loyaltyDiscountAmount,
        comment: comment.trim() || null,
        customer: selectedCustomer,
        companyName: session.company.name,
        locationName: context?.location?.name || 'Витрина точки',
        operatorName,
        lines: cartDetailed.map((line) => ({
          item_id: line.item_id,
          name: line.item?.name || 'Товар',
          quantity: line.quantity,
          unit_price: line.unit_price,
          total: line.total,
          unit: line.item?.unit || null,
        })),
      })

      toastSuccess('Продажа сохранена и добавлена в сменный контур')
      resetSaleForm()
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
            active="sale"
            showSale
            showReturn={!!onSwitchToReturn}
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            onShift={onSwitchToShift}
            onSale={() => undefined}
            onReturn={onSwitchToReturn}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
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
        {/* LEFT: product catalog */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-white/10">
          {/* Status bar */}
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-card px-4 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{context?.location?.name || 'Витрина'}</span>
            <span>·</span>
            <span>{formatShiftLabel(runtimeShift.shift)}</span>
            <span>·</span>
            <span>{availableItemsCount} SKU</span>
            {lowStockItemsCount > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-400">{lowStockItemsCount} мало</span>
              </>
            )}
            {cartUnits > 0 && (
              <>
                <span>·</span>
                <span className="text-emerald-400">{cartUnits} в корзине</span>
              </>
            )}
          </div>

          {/* Search + filter */}
          <div className="shrink-0 space-y-2 border-b border-white/10 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию, штрихкоду или категории"
                className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:border-emerald-400/50"
              />
            </div>
            <div className="flex gap-1.5">
              {[
                { key: 'all' as const, label: 'Все' },
                { key: 'low' as const, label: 'Мало' },
                { key: 'cart' as const, label: 'В корзине' },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setCatalogView(option.key)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    catalogView === option.key
                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {error ? (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>
            ) : loading ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Загружаем витрину...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Нет товаров</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
                {filteredItems.map((item) => {
                  const disabled = item.display_qty <= 0
                  const inCart = cart.some((l) => l.item_id === item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart(item)}
                      disabled={disabled}
                      className={`rounded-2xl border p-3 text-left transition hover:border-emerald-400/40 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50 ${
                        inCart ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold leading-tight text-foreground">{item.name}</p>
                        <Badge variant={disabled ? 'secondary' : 'success'} className="shrink-0 text-[10px]">
                          {item.display_qty}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-base font-semibold text-foreground">{formatMoney(item.sale_price)}</p>
                        <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${inCart ? 'bg-emerald-500/30 text-emerald-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          <Plus className="h-4 w-4" />
                        </div>
                      </div>
                      {item.display_qty > 0 && item.display_qty <= 3 && (
                        <Badge variant="warning" className="mt-1.5 text-[10px]">Мало</Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: cart + checkout */}
        <div className="flex w-[300px] shrink-0 flex-col overflow-hidden">
          {/* Cart header */}
          <div className="shrink-0 border-b border-white/10 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Корзина{cartDetailed.length > 0 ? ` (${cartDetailed.length})` : ''}
              </p>
              {cartDetailed.length > 0 && (
                <button type="button" onClick={resetSaleForm} className="text-xs text-muted-foreground transition hover:text-foreground">
                  Очистить
                </button>
              )}
            </div>
          </div>

          {/* Cart items */}
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {cartDetailed.length === 0 ? (
              <div className="flex h-24 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Добавьте товары из каталога
              </div>
            ) : (
              cartDetailed.map((line) => (
                <div key={line.item_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-medium leading-tight">{line.item?.name}</p>
                    <p className="shrink-0 text-xs font-semibold">{formatMoney(line.total)}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => changeQty(line.item_id, line.quantity - 1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="min-w-[2rem] text-center text-xs font-semibold">{line.quantity}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => changeQty(line.item_id, line.quantity + 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{formatMoney(line.unit_price)} / {line.item?.unit || 'шт'}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Extras (collapsible) */}
          <div className="shrink-0 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowExtras(!showExtras)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <span>Дополнительно</span>
              <div className="flex items-center gap-2">
                {selectedCustomer && <span className="text-emerald-400 truncate max-w-[80px]">{selectedCustomer.name}</span>}
                {effectiveDiscountPercent > 0 && <span className="text-blue-400">-{effectiveDiscountPercent}%</span>}
                <span>{showExtras ? '▲' : '▼'}</span>
              </div>
            </button>

            {showExtras && (
              <div className="max-h-64 space-y-2 overflow-y-auto border-t border-white/10 p-3">
                {/* Customer search */}
                <div className="relative">
                  <UserCircle2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value)
                      if (selectedCustomer) clearCustomer()
                    }}
                    placeholder="Клиент (телефон или карта)"
                    className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-8 text-xs outline-none focus:border-emerald-400/50"
                  />
                  {(customerSearch || selectedCustomer) && (
                    <button type="button" onClick={clearCustomer} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {customerSearching && (
                    <Loader2 className="absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>

                {showCustomerDropdown && !selectedCustomer && (
                  <div className="rounded-lg border border-white/10 bg-card shadow-lg">
                    {customerResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => selectCustomer(customer)}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-white/[0.05] first:rounded-t-lg last:rounded-b-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-muted-foreground">{customer.phone || customer.card_number || '—'}</p>
                          </div>
                          <p className="text-amber-400 font-semibold">{customer.loyalty_points} б.</p>
                        </div>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setShowCustomerDropdown(false); setCustomerResults([]) }}
                      className="w-full rounded-b-lg px-3 py-2 text-center text-xs text-muted-foreground hover:bg-white/[0.05]"
                    >
                      Без клиента
                    </button>
                  </div>
                )}

                {selectedCustomer && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{selectedCustomer.name}</p>
                      <p className="shrink-0 text-xs font-bold text-amber-400">{selectedCustomer.loyalty_points} б.</p>
                    </div>
                    {loyaltyConfig?.is_active && selectedCustomer.loyalty_points >= (loyaltyConfig.min_points_to_redeem || 100) && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Star className="h-3 w-3 shrink-0 text-amber-400" />
                        <input
                          type="number"
                          value={loyaltyPointsToSpend || ''}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, maxRedeemablePoints))
                            setLoyaltyPointsToSpend(val)
                          }}
                          placeholder={`Баллы (макс. ${maxRedeemablePoints})`}
                          className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:border-amber-400/50"
                          min="0"
                          max={maxRedeemablePoints}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Discount */}
                <button
                  type="button"
                  onClick={() => setShowDiscountPanel(!showDiscountPanel)}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs hover:bg-white/[0.05]"
                >
                  <Tag className="h-3.5 w-3.5 text-blue-400" />
                  <span className="flex-1 text-left">Скидка</span>
                  {effectiveDiscountPercent > 0 && (
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                      -{effectiveDiscountPercent}%
                    </span>
                  )}
                </button>

                {showDiscountPanel && (
                  <div className="space-y-2 rounded-lg border border-white/10 bg-card p-2.5">
                    <div className="flex items-center gap-2">
                      <Percent className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <input
                        type="number"
                        value={manualDiscountPercent}
                        onChange={(e) => {
                          setManualDiscountPercent(e.target.value)
                          setAppliedPromoCode(null)
                          setPromoDiscountPercent(0)
                        }}
                        placeholder="Скидка вручную, %"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-blue-400/50"
                        min="0"
                        max="99"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={promoCodeInput}
                        onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                        placeholder="Промокод"
                        className="flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:border-blue-400/50"
                      />
                      <button
                        type="button"
                        onClick={() => void applyPromoCode()}
                        disabled={promoValidating || !promoCodeInput.trim()}
                        className="rounded border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-300 disabled:opacity-50 hover:bg-blue-500/20"
                      >
                        {promoValidating ? '...' : 'OK'}
                      </button>
                    </div>
                    {appliedPromoCode && (
                      <p className="text-[10px] text-emerald-400">✓ «{appliedPromoCode}» применён</p>
                    )}
                  </div>
                )}

                {/* Comment */}
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="Комментарий к продаже"
                  className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-emerald-400/50"
                />
              </div>
            )}
          </div>

          {/* Checkout form */}
          <form onSubmit={handleSubmit} className="shrink-0 space-y-2.5 border-t border-white/10 p-3">
            {/* Payment method */}
            <div className="grid grid-cols-3 gap-1.5">
              {(['cash', 'kaspi', 'mixed'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-xl border px-2 py-2 text-center text-xs font-medium transition ${
                    paymentMethod === method
                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                      : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {paymentBadge(method)}
                </button>
              ))}
            </div>

            {paymentMethod === 'mixed' && (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground">Наличными</p>
                  <Input value={mixedCash} onChange={(e) => setMixedCash(e.target.value)} placeholder="0" className="h-8 text-xs" />
                </div>
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground">Kaspi</p>
                  <Input value={String(Math.max(0, finalTotal - Math.max(0, parseMoney(mixedCash))))} readOnly className="h-8 text-xs" />
                </div>
              </div>
            )}

            {/* Total */}
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              {(discountAmount > 0 || loyaltyDiscountAmount > 0) && (
                <div className="mb-2 space-y-1 border-b border-white/10 pb-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Подытог</span><span>{formatMoney(cartTotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex items-center justify-between text-xs text-blue-300">
                      <span>Скидка -{effectiveDiscountPercent}%</span><span>-{formatMoney(discountAmount)}</span>
                    </div>
                  )}
                  {loyaltyDiscountAmount > 0 && (
                    <div className="flex items-center justify-between text-xs text-amber-300">
                      <span>Баллами</span><span>-{formatMoney(loyaltyDiscountAmount)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Итого</p>
                  <p className="text-2xl font-bold text-foreground">{formatMoney(finalTotal)}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{cartDetailed.length} поз.</p>
                  <p>{cartDetailed.reduce((sum, l) => sum + l.quantity, 0)} шт.</p>
                </div>
              </div>
            </div>

            <Button type="submit" size="lg" className="h-12 w-full text-base font-semibold" disabled={saving || cartDetailed.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBasket className="h-5 w-5" />}
              Провести продажу
            </Button>
          </form>
        </div>
      </div>

      {receiptPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-xl border-white/10 bg-slate-950/95 shadow-2xl">
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ReceiptText className="h-4 w-4 text-emerald-300" />
                    Сформированный чек
                  </CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {receiptPreview.companyName} · {receiptPreview.locationName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {receiptPreview.saleDate} · {receiptPreview.saleTime} · {formatShiftLabel(receiptPreview.shift)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setReceiptPreview(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Чек</span>
                  <span className="font-semibold">#{receiptPreview.saleId?.slice(-6) || 'новый'}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Оплата</span>
                  <span>{paymentBadge(receiptPreview.paymentMethod)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Оператор</span>
                  <span>{receiptPreview.operatorName}</span>
                </div>
              </div>

              <div className="max-h-72 space-y-2 overflow-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                {receiptPreview.lines.map((line) => (
                  <div key={line.item_id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{line.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity} {line.unit || 'шт'} × {formatMoney(line.unit_price)}
                        </p>
                      </div>
                      <p className="font-semibold">{formatMoney(line.total)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Подытог</span>
                  <span>{formatMoney(receiptPreview.subtotal)}</span>
                </div>
                {receiptPreview.discountAmount > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-sm text-blue-300">
                    <span>Скидка</span>
                    <span>-{formatMoney(receiptPreview.discountAmount)}</span>
                  </div>
                ) : null}
                {receiptPreview.loyaltyDiscountAmount > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-sm text-amber-300">
                    <span>Бонусы</span>
                    <span>-{formatMoney(receiptPreview.loyaltyDiscountAmount)}</span>
                  </div>
                ) : null}
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Итого</p>
                    <p className="mt-1 text-3xl font-semibold text-foreground">{formatMoney(receiptPreview.totalAmount)}</p>
                  </div>
                  <Badge variant="secondary">{paymentBadge(receiptPreview.paymentMethod)}</Badge>
                </div>
                {receiptPreview.paymentMethod === 'mixed' ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Наличные: {formatMoney(receiptPreview.cashAmount)} · Kaspi: {formatMoney(receiptPreview.kaspiAmount)}
                  </p>
                ) : null}
                {receiptPreview.customer ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Клиент: {receiptPreview.customer.name}
                    {receiptPreview.customer.phone ? ` (${receiptPreview.customer.phone})` : ''}
                  </p>
                ) : null}
                {receiptPreview.comment ? (
                  <p className="mt-2 text-xs text-muted-foreground">Комментарий: {receiptPreview.comment}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button className="flex-1 min-w-[180px]" onClick={() => printReceipt(receiptPreview)}>
                  <Printer className="h-4 w-4" />
                  Печать чека
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 min-w-[180px]"
                  onClick={() => setReceiptPreview(null)}
                >
                  Закрыть
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
