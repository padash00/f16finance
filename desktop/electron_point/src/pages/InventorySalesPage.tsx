import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CreditCard,
  Loader2,
  LogOut,
  Minus,
  Package,
  Percent,
  Plus,
  RefreshCw,
  Search,
  ShoppingBasket,
  Star,
  Store,
  Tag,
  UserCircle2,
  X,
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
  const [comment, setComment] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | null>(null)
  const [customerSearching, setCustomerSearching] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [loyaltyPointsToSpend, setLoyaltyPointsToSpend] = useState(0)
  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      const res = await fetch(`${config.apiUrl.replace(/\/$/, '')}/api/admin/discounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-point-device-token': config.deviceToken,
        },
        body: JSON.stringify({
          action: 'validatePromoCode',
          promo_code: promoCodeInput.trim(),
          order_amount: cartTotal,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toastError(json.error || 'Промокод недействителен')
        return
      }
      setAppliedPromoCode(promoCodeInput.trim())
      if (json.data.type === 'percent') {
        setPromoDiscountPercent(json.data.value)
        setManualDiscountPercent('')
      } else if (json.data.type === 'fixed') {
        setPromoDiscountPercent(0)
        setManualDiscountPercent('0')
        // Use fixed amount as manual percent approximation
        const pct = cartTotal > 0 ? (json.data.value / cartTotal) * 100 : 0
        setManualDiscountPercent(String(Math.round(pct * 10) / 10))
      }
      toastSuccess(`Промокод «${promoCodeInput.trim()}» применён`)
    } catch (err: any) {
      toastError(err?.message || 'Ошибка проверки промокода')
    } finally {
      setPromoValidating(false)
    }
  }

  function resetSaleForm() {
    setCart([])
    setComment('')
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
      } as any)

      // Record loyalty if customer selected
      if (selectedCustomer) {
        try {
          await api.recordSaleWithCustomer(config, {
            customer_id: selectedCustomer.id,
            sale_total_amount: cartTotal,
            loyalty_points_spent: loyaltyPointsToSpend,
          })
        } catch {
          // non-critical, don't fail the sale
        }
      }

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

                {/* Customer Section */}
                <div className="space-y-2">
                  <div className="relative">
                    <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value)
                        if (selectedCustomer) clearCustomer()
                      }}
                      placeholder="Клиент (телефон или карта)"
                      className="w-full rounded-xl border border-input bg-background py-2 pl-10 pr-9 text-sm outline-none transition focus:border-emerald-400/50"
                    />
                    {(customerSearch || selectedCustomer) && (
                      <button type="button" onClick={clearCustomer} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {customerSearching && (
                      <Loader2 className="absolute right-9 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {showCustomerDropdown && !selectedCustomer && (
                    <div className="rounded-xl border border-white/10 bg-card shadow-lg">
                      {customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => selectCustomer(customer)}
                          className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/[0.05] first:rounded-t-xl last:rounded-b-xl"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{customer.name}</p>
                              <p className="text-xs text-muted-foreground">{customer.phone || customer.card_number || '—'}</p>
                            </div>
                            <div className="text-right text-xs">
                              <p className="text-amber-400 font-semibold">{customer.loyalty_points} баллов</p>
                            </div>
                          </div>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => { setShowCustomerDropdown(false); setCustomerResults([]) }}
                        className="w-full px-3 py-2 text-center text-xs text-muted-foreground hover:bg-white/[0.05] rounded-b-xl"
                      >
                        Без клиента
                      </button>
                    </div>
                  )}

                  {selectedCustomer && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{selectedCustomer.name}</p>
                          <p className="text-xs text-muted-foreground">{selectedCustomer.phone || '—'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Баллы</p>
                          <p className="text-amber-400 font-bold text-sm">{selectedCustomer.loyalty_points}</p>
                        </div>
                      </div>

                      {loyaltyConfig?.is_active && selectedCustomer.loyalty_points >= (loyaltyConfig.min_points_to_redeem || 100) && (
                        <div className="mt-2 flex items-center gap-2">
                          <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <input
                            type="number"
                            value={loyaltyPointsToSpend || ''}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, maxRedeemablePoints))
                              setLoyaltyPointsToSpend(val)
                            }}
                            placeholder={`Баллами (макс. ${maxRedeemablePoints})`}
                            className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus:border-amber-400/50"
                            min="0"
                            max={maxRedeemablePoints}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Discount Section */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowDiscountPanel(!showDiscountPanel)}
                    className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm hover:bg-white/[0.05]"
                  >
                    <Tag className="h-4 w-4 text-blue-400" />
                    <span className="flex-1 text-left">Скидка</span>
                    {effectiveDiscountPercent > 0 && (
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300 font-medium">
                        -{effectiveDiscountPercent}%
                      </span>
                    )}
                  </button>

                  {showDiscountPanel && (
                    <div className="rounded-xl border border-white/10 bg-card p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Percent className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <input
                          type="number"
                          value={manualDiscountPercent}
                          onChange={(e) => {
                            setManualDiscountPercent(e.target.value)
                            setAppliedPromoCode(null)
                            setPromoDiscountPercent(0)
                          }}
                          placeholder="Скидка вручную, %"
                          className="w-full rounded-lg border border-input bg-background px-2 py-1 text-sm outline-none focus:border-blue-400/50"
                          min="0"
                          max="99"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={promoCodeInput}
                          onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                          placeholder="Промокод"
                          className="flex-1 rounded-lg border border-input bg-background px-2 py-1 text-sm font-mono outline-none focus:border-blue-400/50"
                        />
                        <button
                          type="button"
                          onClick={() => void applyPromoCode()}
                          disabled={promoValidating || !promoCodeInput.trim()}
                          className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300 disabled:opacity-50 hover:bg-blue-500/20"
                        >
                          {promoValidating ? '...' : 'Применить'}
                        </button>
                      </div>
                      {appliedPromoCode && (
                        <p className="text-xs text-emerald-400">✓ Промокод «{appliedPromoCode}» применён</p>
                      )}
                    </div>
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
                      <Input value={String(Math.max(0, finalTotal - Math.max(0, parseMoney(mixedCash))))} readOnly />
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
                    {(discountAmount > 0 || loyaltyDiscountAmount > 0) && (
                      <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>Подытог</span>
                          <span>{formatMoney(cartTotal)}</span>
                        </div>
                        {discountAmount > 0 && (
                          <div className="flex items-center justify-between text-sm text-blue-300">
                            <span>Скидка (-{effectiveDiscountPercent}%)</span>
                            <span>-{formatMoney(discountAmount)}</span>
                          </div>
                        )}
                        {loyaltyDiscountAmount > 0 && (
                          <div className="flex items-center justify-between text-sm text-amber-300">
                            <span>Баллами</span>
                            <span>-{formatMoney(loyaltyDiscountAmount)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Итого</p>
                        <p className="mt-1 text-3xl font-semibold text-foreground">{formatMoney(finalTotal)}</p>
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
