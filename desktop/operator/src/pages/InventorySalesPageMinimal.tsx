/**
 * Минималистичный дизайн страницы продаж под стиль Wipon Pro.
 *
 * Что есть:
 * - Поиск товара (название/штрихкод/артикул) с авто-добавлением
 * - Универсальный товар (ручной ввод названия и цены)
 * - Таблица позиций чека по центру
 * - Скидки (ручной % + промокоды)
 * - Клиенты и бонусы лояльности
 * - Комментарий к продаже
 * - Все 3 способа оплаты с автозаполнением смешанной
 * - Печать чека после оплаты
 * - Звуковой сигнал при добавлении/ошибке
 * - Адаптивная вёрстка от 10" планшета до 34" монитора
 *
 * Подключается через VITE_USE_MINIMAL_SALES=1 при сборке.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  LogOut,
  Minus,
  Percent,
  Plus,
  Receipt as ReceiptIcon,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import { getCachedSalesContext, saveSalesContextCache } from '@/lib/cache'
import {
  beep,
  buildReceiptHtmlForPreview,
  formatShiftLabel,
  printReceiptFromIframe,
  type SaleReceiptPreview,
} from '@/lib/receipt-html'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatMoney, localRef, parseMoney } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  Customer,
  LoyaltyConfig,
  OperatorSession,
  PointInventorySaleContext,
  PointInventorySaleItem,
} from '@/types'

type Props = {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift?: () => void
  onSwitchToReturn?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

type CartLine = {
  id: string             // unique key для React (для универсальных товаров — random)
  item_id: string | null // null для универсального товара
  name: string
  unit?: string | null
  quantity: number
  unit_price: number
}

const UNIVERSAL_PRODUCT_PREFIX = 'universal:'

export default function InventorySalesPageMinimal({
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
  const isNightAfterMidnight = useMemo(() => {
    const h = new Date().getHours()
    return runtimeShift.shift === 'night' && h < 12
  }, [runtimeShift.shift])

  const [context, setContext] = useState<PointInventorySaleContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [comment, setComment] = useState('')

  // Оплата
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [mixedKaspi, setMixedKaspi] = useState('')
  const [saving, setSaving] = useState(false)

  // Скидки
  const [showDiscount, setShowDiscount] = useState(false)
  const [manualDiscountPercent, setManualDiscountPercent] = useState('')
  const [promoCodeInput, setPromoCodeInput] = useState('')
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null)
  const [promoDiscountPercent, setPromoDiscountPercent] = useState(0)
  const [promoValidating, setPromoValidating] = useState(false)

  // Клиенты
  const [showCustomer, setShowCustomer] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | null>(null)
  const [customerSearching, setCustomerSearching] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [loyaltyPointsToSpend, setLoyaltyPointsToSpend] = useState(0)
  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Универсальный товар
  const [showUniversal, setShowUniversal] = useState(false)
  const [uniName, setUniName] = useState('')
  const [uniPrice, setUniPrice] = useState('')

  // Режим: продажа или история
  const [viewMode, setViewMode] = useState<'sale' | 'history'>('sale')
  const [selectedSale, setSelectedSale] = useState<any | null>(null)

  // Подтверждение оплаты
  const [showPayConfirm, setShowPayConfirm] = useState(false)

  // Превью чека после успешной продажи (в iframe внутри программы)
  const [lastReceipt, setLastReceipt] = useState<SaleReceiptPreview | null>(null)
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null)

  // Корректировка оплаты
  const [correctionMethod, setCorrectionMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [correctionCash, setCorrectionCash] = useState('')
  const [correctionKaspi, setCorrectionKaspi] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionSaving, setCorrectionSaving] = useState(false)

  const [now, setNow] = useState(() => new Date())
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Часы в шапке — обновляем каждую секунду чтобы не выглядели "застывшими"
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Первичная загрузка с кэшем
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await getCachedSalesContext<PointInventorySaleContext>().catch(() => null)
      if (!cancelled && cached) {
        setContext(cached)
        setLoyaltyConfig((cached as any).loyalty_config || null)
        setLoading(false)
        void load(true)
      } else if (!cancelled) {
        void load(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function load(silent: boolean) {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventorySales(config, session)
      setContext(data)
      setLoyaltyConfig((data as any).loyalty_config || null)
      void saveSalesContextCache(data)
    } catch (err: any) {
      if (!silent) setError(err?.message || 'Не удалось загрузить витрину')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Поиск клиента (debounced)
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
        setCustomerResults(result?.customers || [])
        if (result?.loyalty_config) setLoyaltyConfig(result.loyalty_config)
        setShowCustomerDropdown(true)
      } catch {
        /* тихо */
      } finally {
        setCustomerSearching(false)
      }
    }, 300)
    return () => {
      if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current)
    }
  }, [customerSearch, config, session])

  // Operator name
  const operatorName = useMemo(() => {
    return (
      session.operator?.full_name ||
      session.operator?.short_name ||
      bootstrap?.operatorName ||
      'Оператор'
    )
  }, [session, bootstrap])

  // Items by id для быстрого доступа
  const itemsById = useMemo(() => {
    const m = new Map<string, PointInventorySaleItem>()
    for (const item of context?.items || []) m.set(item.id, item)
    return m
  }, [context?.items])

  // Поиск товара
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as PointInventorySaleItem[]
    return (context?.items || [])
      .filter((it) => Number(it.display_qty || 0) > 0)
      .filter((it) =>
        it.name.toLowerCase().includes(q) ||
        (it.barcode || '').includes(q),
      )
      .slice(0, 8)
  }, [search, context?.items])

  // Подытог корзины
  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.quantity * l.unit_price, 0),
    [cart],
  )

  // Эффективная скидка (промокод имеет приоритет)
  const effectiveDiscountPercent = useMemo(() => {
    const manual = Math.max(0, Math.min(99, parseMoney(manualDiscountPercent)))
    return appliedPromoCode ? promoDiscountPercent : manual
  }, [manualDiscountPercent, appliedPromoCode, promoDiscountPercent])

  const discountAmount = useMemo(() => {
    return Math.round(((subtotal * effectiveDiscountPercent) / 100) * 100) / 100
  }, [subtotal, effectiveDiscountPercent])

  const afterDiscountTotal = useMemo(
    () => Math.max(0, subtotal - discountAmount),
    [subtotal, discountAmount],
  )

  // Бонусы лояльности
  const maxRedeemablePoints = useMemo(() => {
    if (!selectedCustomer || !loyaltyConfig?.is_active) return 0
    const points = Math.max(0, selectedCustomer.loyalty_points || 0)
    const maxPercent = Math.max(0, Math.min(100, loyaltyConfig.max_redeem_percent_per_purchase || 100))
    const maxByPercent = Math.floor((afterDiscountTotal * maxPercent) / 100)
    return Math.min(points, maxByPercent)
  }, [selectedCustomer, loyaltyConfig, afterDiscountTotal])

  const loyaltyDiscountAmount = useMemo(() => {
    if (!selectedCustomer || !loyaltyConfig?.is_active || loyaltyPointsToSpend <= 0) return 0
    return Math.min(loyaltyPointsToSpend, afterDiscountTotal, maxRedeemablePoints)
  }, [selectedCustomer, loyaltyConfig, loyaltyPointsToSpend, afterDiscountTotal, maxRedeemablePoints])

  const finalTotal = useMemo(
    () => Math.max(0, afterDiscountTotal - loyaltyDiscountAmount),
    [afterDiscountTotal, loyaltyDiscountAmount],
  )

  // Подробная корзина для печати/UI
  const cartDetailed = useMemo(() => {
    return cart.map((line) => ({
      ...line,
      total: line.quantity * line.unit_price,
    }))
  }, [cart])

  // Авто-добавление по штрихкоду / Enter
  function handleSearchSubmit() {
    const q = search.trim()
    if (!q) return
    const exactBarcode = (context?.items || []).find(
      (it) => it.barcode === q && Number(it.display_qty || 0) > 0,
    )
    if (exactBarcode) {
      addItem(exactBarcode)
      setSearch('')
      return
    }
    if (searchResults.length === 1) {
      addItem(searchResults[0])
      setSearch('')
    } else if (searchResults.length === 0) {
      beep('error')
      toastError('Товар не найден')
    }
  }

  function addItem(item: PointInventorySaleItem) {
    const available = Number(item.display_qty || 0)
    if (available <= 0) {
      beep('error')
      toastError(`Нет на витрине: ${item.name}`)
      return
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.item_id === item.id)
      if (existing) {
        const nextQty = existing.quantity + 1
        if (nextQty > available) {
          beep('error')
          toastError(`Доступно только ${available}`)
          return prev
        }
        return prev.map((l) => (l.item_id === item.id ? { ...l, quantity: nextQty } : l))
      }
      return [
        ...prev,
        {
          id: item.id,
          item_id: item.id,
          name: item.name,
          unit: item.unit || null,
          quantity: 1,
          unit_price: Number(item.sale_price || 0),
        },
      ]
    })
    beep('ok')
  }

  function addUniversalItem() {
    const name = uniName.trim()
    const price = parseMoney(uniPrice)
    if (!name) {
      toastError('Введите название')
      return
    }
    if (price <= 0) {
      toastError('Цена должна быть больше 0')
      return
    }
    setCart((prev) => [
      ...prev,
      {
        id: `${UNIVERSAL_PRODUCT_PREFIX}${Date.now()}`,
        item_id: null,
        name,
        quantity: 1,
        unit_price: price,
      },
    ])
    setUniName('')
    setUniPrice('')
    setShowUniversal(false)
    beep('ok')
  }

  function changeQty(id: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((l) => l.id !== id))
      return
    }
    const line = cart.find((l) => l.id === id)
    if (line?.item_id) {
      const item = itemsById.get(line.item_id)
      const available = Number(item?.display_qty || 0)
      if (nextQty > available) {
        beep('error')
        toastError(`Доступно только ${available}`)
        return
      }
    }
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, quantity: nextQty } : l)))
  }

  function removeLine(id: string) {
    setCart((prev) => prev.filter((l) => l.id !== id))
  }

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setShowCustomerDropdown(false)
    setCustomerResults([])
    setCustomerSearch('')
    setLoyaltyPointsToSpend(0)
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setLoyaltyPointsToSpend(0)
    setCustomerSearch('')
    setShowCustomerDropdown(false)
    setCustomerResults([])
  }

  async function applyPromoCode() {
    const code = promoCodeInput.trim().toUpperCase()
    if (!code) return
    setPromoValidating(true)
    try {
      const result = await api.validatePromoCode(config, code, subtotal)
      if (result.value > 0) {
        const pct = result.type === 'percent' ? result.value : (subtotal > 0 ? (result.value / subtotal) * 100 : 0)
        setAppliedPromoCode(code)
        setPromoDiscountPercent(Math.min(99, pct))
        setManualDiscountPercent('')
        toastSuccess(`Промокод «${code}» применён`)
      } else {
        toastError('Промокод недействителен')
      }
    } catch (err: any) {
      toastError(err?.message || 'Промокод недействителен')
    } finally {
      setPromoValidating(false)
    }
  }

  function clearPromoCode() {
    setAppliedPromoCode(null)
    setPromoDiscountPercent(0)
    setPromoCodeInput('')
  }

  function clearAll() {
    setCart([])
    setMixedCash('')
    setMixedKaspi('')
    setComment('')
    setManualDiscountPercent('')
    clearPromoCode()
    clearCustomer()
  }

  function openCorrection(sale: any) {
    setSelectedSale(sale)
    setCorrectionMethod(sale.payment_method || 'cash')
    setCorrectionCash(String(Number(sale.cash_amount || 0)))
    setCorrectionKaspi(String(Number(sale.kaspi_amount || 0)))
    setCorrectionReason('')
  }

  function closeCorrection() {
    setSelectedSale(null)
    setCorrectionReason('')
  }

  async function handleCorrection() {
    if (!selectedSale) return
    if (!correctionReason.trim()) {
      toastError('Укажите причину исправления')
      return
    }
    const total = Number(selectedSale.total_amount || 0)
    const cash =
      correctionMethod === 'cash'
        ? total
        : correctionMethod === 'mixed'
          ? Math.max(0, Math.min(total, parseMoney(correctionCash)))
          : 0
    const kaspi =
      correctionMethod === 'kaspi'
        ? total
        : correctionMethod === 'mixed'
          ? Math.max(0, total - cash)
          : 0
    if (correctionMethod === 'mixed' && (cash <= 0 || kaspi <= 0)) {
      toastError('В смешанной оплате обе суммы должны быть больше 0')
      return
    }
    setCorrectionSaving(true)
    try {
      await api.correctPointInventorySalePayment(config, session, {
        sale_id: selectedSale.id,
        payment_method: correctionMethod,
        cash_amount: cash,
        kaspi_amount: kaspi,
        kaspi_before_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? 0 : kaspi,
        kaspi_after_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? kaspi : 0,
        reason: correctionReason.trim(),
      })
      toastSuccess('Оплата исправлена')
      closeCorrection()
      void load(true)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось исправить оплату')
    } finally {
      setCorrectionSaving(false)
    }
  }

  function openPayConfirm() {
    if (cart.length === 0) {
      toastError('Корзина пуста')
      return
    }
    if (finalTotal <= 0) {
      toastError('Сумма должна быть больше 0')
      return
    }
    if (paymentMethod === 'mixed') {
      const cashCheck = Math.max(0, parseMoney(mixedCash))
      const kaspiCheck = Math.max(0, parseMoney(mixedKaspi))
      if (cashCheck <= 0 || kaspiCheck <= 0) {
        toastError('Заполните обе суммы для смешанной оплаты')
        return
      }
      if (Math.abs(cashCheck + kaspiCheck - finalTotal) > 0.5) {
        toastError(`Сумма ${cashCheck + kaspiCheck} ₸ не совпадает с итогом ${finalTotal} ₸`)
        return
      }
    }
    setShowPayConfirm(true)
  }

  async function handlePay() {
    // Защита от двойного клика
    if (saving) return
    setSaving(true)

    const cashAmount =
      paymentMethod === 'cash'
        ? finalTotal
        : paymentMethod === 'mixed'
          ? Math.max(0, Math.min(finalTotal, parseMoney(mixedCash)))
          : 0
    const kaspiAmount =
      paymentMethod === 'kaspi'
        ? finalTotal
        : paymentMethod === 'mixed'
          ? Math.max(0, finalTotal - cashAmount)
          : 0

    try {
      const result = await api.createPointInventorySale(config, session, {
        sale_date: new Date().toISOString().slice(0, 10),
        shift: runtimeShift.shift,
        payment_method: paymentMethod,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        kaspi_before_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? 0 : kaspiAmount,
        kaspi_after_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? kaspiAmount : 0,
        comment: comment.trim() || null,
        local_ref: localRef(),
        items: cart.map((l) => ({
          item_id: l.item_id,
          universal_name: l.item_id ? null : l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        customer_id: selectedCustomer?.id || null,
        loyalty_points_spent: selectedCustomer ? loyaltyPointsToSpend : 0,
        discount_amount: discountAmount,
        loyalty_discount_amount: loyaltyDiscountAmount,
      })
      toastSuccess('Продажа сохранена')
      beep('ok')

      // Печать чека
      const nowTs = new Date()
      const preview: SaleReceiptPreview = {
        saleId: result?.sale_id || null,
        saleDate: nowTs.toLocaleDateString('ru-RU'),
        saleTime: nowTs.toLocaleTimeString('ru-RU'),
        shift: runtimeShift.shift,
        paymentMethod,
        cashAmount,
        kaspiAmount,
        totalAmount: finalTotal,
        subtotal,
        discountAmount,
        loyaltyDiscountAmount,
        customer: selectedCustomer ? { name: selectedCustomer.name, phone: selectedCustomer.phone } : null,
        comment: comment.trim() || null,
        operatorName,
        companyName: session.company?.name || '',
        locationName: context?.location?.name || '',
        lines: cartDetailed.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          total: l.total,
          unit: l.unit || null,
        })),
      }
      // Показываем превью чека внутри программы — пользователь сам решает печатать или нет
      setLastReceipt(preview)

      clearAll()
      setShowPayConfirm(false)
      void load(true)
    } catch (err: any) {
      beep('error')
      toastError(err?.message || 'Не удалось провести продажу')
    } finally {
      setSaving(false)
    }
  }

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="h-9 shrink-0 drag-region bg-white dark:bg-slate-900" />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 no-drag dark:border-slate-800 dark:bg-slate-900 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-sm font-bold text-white">F</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{session.company?.name || 'Точка'}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {operatorName} · {formatShiftLabel(runtimeShift.shift)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <span className="hidden text-sm tabular-nums text-slate-500 sm:inline dark:text-slate-400">{timeStr}</span>
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
          <Button variant="ghost" size="sm" onClick={() => void load(false)} disabled={loading} className="h-8 w-8 p-0">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-8 w-8 p-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Вкладки: Продажи / История */}
      <nav className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
        {(['sale', 'history'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`relative px-4 py-2.5 text-sm font-medium transition ${
              viewMode === mode
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {mode === 'sale' ? 'Продажи' : `История${(context?.sales?.length || 0) > 0 ? ` (${context?.sales?.length})` : ''}`}
            {viewMode === mode && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
      </nav>

      {/* Основной контент */}
      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {viewMode === 'history' ? (
          <section className="flex-1 overflow-auto p-3 sm:p-4">
            {(context?.sales || []).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                <ReceiptIcon className="h-12 w-12 opacity-30" />
                <p className="text-sm">Чеков ещё нет</p>
                <p className="text-xs text-slate-500">Все ваши продажи за смену появятся здесь</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-3 text-left font-medium">Время</th>
                      <th className="px-3 py-3 text-left font-medium">Позиций</th>
                      <th className="px-3 py-3 text-left font-medium">Оплата</th>
                      <th className="px-3 py-3 text-right font-medium">Сумма</th>
                      <th className="w-32 px-3 py-3 text-right font-medium">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(context?.sales || []).map((sale) => {
                      const t = sale.sold_at ? new Date(sale.sold_at) : null
                      const timeStr = t ? t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'
                      return (
                        <tr key={sale.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/50">
                          <td className="px-3 py-3">
                            <p className="text-sm font-medium">{timeStr}</p>
                            <p className="text-xs text-slate-500">#{sale.id.slice(-6)}</p>
                          </td>
                          <td className="px-3 py-3 text-sm">{sale.items?.length || 0}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                sale.payment_method === 'cash'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : sale.payment_method === 'kaspi'
                                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              {sale.payment_method === 'cash' ? 'Наличные' : sale.payment_method === 'kaspi' ? 'Kaspi' : 'Смешанная'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">
                            {formatMoney(sale.total_amount)} ₸
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openCorrection(sale)}
                              className="h-8 text-xs"
                            >
                              Исправить оплату
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
        <>
        {/* Левая зона: поиск + таблица позиций */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* Поиск */}
          <div className="relative shrink-0 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearchSubmit()
                    }
                  }}
                  placeholder="Поиск товара по названию, штрихкоду или артикулу"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-12 text-base outline-none transition focus:border-emerald-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900"
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowUniversal(true)}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                title="Универсальный товар: ввести название и цену вручную (требует серверной доработки)"
              >
                + Товар
              </button>
              {/* Универсальный товар сейчас только для UI-теста — серверная поддержка отсутствует */}
            </div>

            {searchResults.length > 0 && (
              <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:left-4 sm:right-4">
                {searchResults.map((item) => {
                  const qty = Number(item.display_qty || 0)
                  const isLow = qty > 0 && qty <= 3
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        addItem(item)
                        setSearch('')
                        searchRef.current?.focus()
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {item.barcode || '—'} · <span className={isLow ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>{qty} шт{isLow ? ' (мало!)' : ''}</span>
                        </p>
                      </div>
                      <p className="shrink-0 text-base font-semibold">{formatMoney(item.sale_price)}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Таблица позиций */}
          <div className="flex-1 overflow-auto p-3 sm:p-4">
            {loading && cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Загружаем витрину…</p>
              </div>
            ) : error && cart.length === 0 ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            ) : cartDetailed.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
                <ReceiptIcon className="h-12 w-12 opacity-30" />
                <p className="text-sm">Список пуст</p>
                <p className="text-xs text-slate-500 dark:text-slate-500">Найдите товар через поиск или отсканируйте штрихкод</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="w-10 px-3 py-3 text-left font-medium">#</th>
                      <th className="px-3 py-3 text-left font-medium">Наименование</th>
                      <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Цена</th>
                      <th className="px-3 py-3 text-center font-medium">Кол-во</th>
                      <th className="px-3 py-3 text-right font-medium">Сумма</th>
                      <th className="w-12 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {cartDetailed.map((line, idx) => (
                      <tr key={line.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/50">
                        <td className="px-3 py-3 text-sm text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium leading-tight">{line.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:hidden">
                            {formatMoney(line.unit_price)} / {line.unit || 'шт'}
                          </p>
                          {!line.item_id && (
                            <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                              универсальный
                            </span>
                          )}
                        </td>
                        <td className="hidden px-3 py-3 text-right text-sm tabular-nums sm:table-cell">{formatMoney(line.unit_price)}</td>
                        <td className="px-3 py-3">
                          <div className="mx-auto flex w-fit items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button
                              type="button"
                              onClick={() => changeQty(line.id, line.quantity - 1)}
                              className="grid h-8 w-8 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQty(line.id, line.quantity + 1)}
                              className="grid h-8 w-8 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">{formatMoney(line.total)}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Правая зона: оплата */}
        <aside className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:w-96 lg:overflow-auto lg:border-l lg:border-t-0 lg:p-4 xl:w-[420px]">
          <div className="flex h-full flex-col gap-3">
            {/* Итого */}
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">К оплате</p>
              <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
                {formatMoney(finalTotal)}
                <span className="ml-1 text-lg font-medium text-slate-400">₸</span>
              </p>
              {(discountAmount > 0 || loyaltyDiscountAmount > 0) && (
                <div className="mt-2 space-y-0.5 text-xs">
                  <div className="flex justify-between text-slate-500"><span>Подытог</span><span>{formatMoney(subtotal)} ₸</span></div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-rose-600 dark:text-rose-400">
                      <span>Скидка {effectiveDiscountPercent}%</span>
                      <span>−{formatMoney(discountAmount)} ₸</span>
                    </div>
                  )}
                  {loyaltyDiscountAmount > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                      <span>Бонусы</span>
                      <span>−{formatMoney(loyaltyDiscountAmount)} ₸</span>
                    </div>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {cartDetailed.length} {cartDetailed.length === 1 ? 'позиция' : 'позиций'} · {cartDetailed.reduce((s, l) => s + l.quantity, 0)} шт
              </p>
            </div>

            {/* Клиент / Скидка тогглы */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowCustomer(!showCustomer)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition ${
                  selectedCustomer
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <UserCircle2 className="h-3.5 w-3.5" />
                {selectedCustomer ? selectedCustomer.name.slice(0, 12) : 'Клиент'}
              </button>
              <button
                type="button"
                onClick={() => setShowDiscount(!showDiscount)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition ${
                  effectiveDiscountPercent > 0
                    ? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <Tag className="h-3.5 w-3.5" />
                {effectiveDiscountPercent > 0 ? `Скидка -${effectiveDiscountPercent}%` : 'Скидка'}
              </button>
            </div>

            {/* Панель клиента */}
            {showCustomer && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                {selectedCustomer ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selectedCustomer.name}</p>
                        <p className="truncate text-xs text-slate-500">{selectedCustomer.phone || selectedCustomer.card_number || '—'}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-amber-500">{selectedCustomer.loyalty_points} б.</p>
                    </div>
                    {loyaltyConfig?.is_active && maxRedeemablePoints > 0 && (
                      <div className="flex items-center gap-2">
                        <Star className="h-3.5 w-3.5 text-amber-500" />
                        <input
                          type="number"
                          value={loyaltyPointsToSpend || ''}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, maxRedeemablePoints))
                            setLoyaltyPointsToSpend(val)
                          }}
                          placeholder={`Использовать баллы (макс. ${maxRedeemablePoints})`}
                          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-900"
                          min={0}
                          max={maxRedeemablePoints}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={clearCustomer}
                      className="text-xs text-slate-500 hover:text-rose-600"
                    >
                      Убрать клиента
                    </button>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Телефон или карта"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                      />
                      {customerSearching && (
                        <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
                      )}
                    </div>
                    {showCustomerDropdown && customerResults.length > 0 && (
                      <div className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCustomer(c)}
                            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{c.name}</p>
                              <p className="truncate text-slate-500">{c.phone || c.card_number || '—'}</p>
                            </div>
                            <p className="shrink-0 font-semibold text-amber-500">{c.loyalty_points} б.</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Панель скидки */}
            {showDiscount && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center gap-2">
                  <Percent className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="number"
                    value={manualDiscountPercent}
                    onChange={(e) => {
                      setManualDiscountPercent(e.target.value)
                      clearPromoCode()
                    }}
                    placeholder="Скидка вручную, %"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900"
                    min={0}
                    max={99}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    placeholder="Промокод"
                    className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void applyPromoCode()}
                    disabled={promoValidating || !promoCodeInput.trim()}
                    className="h-9"
                  >
                    {promoValidating ? '...' : 'OK'}
                  </Button>
                </div>
                {appliedPromoCode && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {appliedPromoCode} применён</span>
                    <button type="button" onClick={clearPromoCode} className="text-slate-400 hover:text-rose-600">убрать</button>
                  </div>
                )}
              </div>
            )}

            {/* Способ оплаты */}
            <div className="grid grid-cols-3 gap-1.5">
              {(['cash', 'kaspi', 'mixed'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-xl border py-2.5 text-sm font-medium transition ${
                    paymentMethod === m
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {m === 'cash' ? 'Наличные' : m === 'kaspi' ? 'Kaspi' : 'Смешанная'}
                </button>
              ))}
            </div>

            {paymentMethod === 'mixed' && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Наличными</span>
                  <input
                    value={mixedCash}
                    onChange={(e) => {
                      const v = e.target.value
                      setMixedCash(v)
                      const cash = Math.max(0, Math.min(finalTotal, parseMoney(v)))
                      setMixedKaspi(String(Math.max(0, finalTotal - cash)))
                    }}
                    placeholder="0"
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Kaspi</span>
                  <input
                    value={mixedKaspi}
                    onChange={(e) => {
                      const v = e.target.value
                      setMixedKaspi(v)
                      const kaspi = Math.max(0, Math.min(finalTotal, parseMoney(v)))
                      setMixedCash(String(Math.max(0, finalTotal - kaspi)))
                    }}
                    placeholder="0"
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>
              </div>
            )}

            {/* Комментарий */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Комментарий к продаже (необязательно)"
              className="w-full rounded-xl border border-slate-200 bg-white p-2 text-xs outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
            />

            {/* Кнопки действий */}
            <div className="mt-auto flex flex-col gap-2">
              <Button
                type="button"
                onClick={openPayConfirm}
                disabled={saving || cart.length === 0}
                className="h-14 rounded-2xl bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                ОПЛАТИТЬ · {formatMoney(finalTotal)} ₸
              </Button>
              {cart.length > 0 && (
                <Button type="button" variant="outline" onClick={clearAll} className="h-10 rounded-xl">
                  Очистить
                </Button>
              )}
            </div>
          </div>
        </aside>
        </>
        )}
      </main>

      {/* Модалка после успешной продажи: подтверждение + превью чека */}
      {lastReceipt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3 sm:p-4" onClick={() => setLastReceipt(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            {/* Шапка */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50 px-5 py-4 dark:border-slate-800 dark:bg-emerald-950/30">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-5 w-5">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-emerald-700 dark:text-emerald-300">Оплата проведена</h3>
                  <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                    Чек #{lastReceipt.saleId?.slice(-6) || '—'} · {formatMoney(lastReceipt.totalAmount)} ₸
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLastReceipt(null)}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Превью чека */}
            <div className="flex-1 overflow-auto bg-slate-100 p-3 dark:bg-slate-800 sm:p-5">
              <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-lg bg-white shadow-md">
                <iframe
                  ref={receiptIframeRef}
                  srcDoc={buildReceiptHtmlForPreview(lastReceipt)}
                  title="Превью чека"
                  className="h-[60vh] w-full border-0"
                />
              </div>
            </div>

            {/* Действия */}
            <div className="flex flex-col gap-2 border-t border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:justify-end sm:gap-3 sm:p-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLastReceipt(null)}
                className="h-12 sm:order-1 sm:px-6"
              >
                Закрыть без печати
              </Button>
              <Button
                type="button"
                onClick={() => {
                  printReceiptFromIframe(receiptIframeRef.current)
                }}
                className="h-12 rounded-xl bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600 sm:order-2 sm:px-8"
              >
                🖨 Печатать чек
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка подтверждения оплаты */}
      {showPayConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => !saving && setShowPayConfirm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            {/* Шапка */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-bold">Подтвердите оплату</h3>
                <p className="text-xs text-slate-500">Проверьте детали чека перед проведением</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setShowPayConfirm(false)}
                disabled={saving}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Список товаров */}
            <div className="max-h-64 overflow-auto px-5 py-3">
              <div className="space-y-1">
                {cartDetailed.map((line) => (
                  <div key={line.id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0 dark:border-slate-800/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-slate-500">{line.quantity} × {formatMoney(line.unit_price)} ₸</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(line.total)} ₸</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Сводка */}
            <div className="border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Подытог ({cartDetailed.length} поз. · {cartDetailed.reduce((s, l) => s + l.quantity, 0)} шт)</span>
                  <span className="tabular-nums">{formatMoney(subtotal)} ₸</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-rose-600 dark:text-rose-400">
                    <span>Скидка {effectiveDiscountPercent}%{appliedPromoCode ? ` (${appliedPromoCode})` : ''}</span>
                    <span className="tabular-nums">−{formatMoney(discountAmount)} ₸</span>
                  </div>
                )}
                {loyaltyDiscountAmount > 0 && (
                  <div className="flex justify-between text-amber-600 dark:text-amber-400">
                    <span>Бонусы ({loyaltyPointsToSpend} б.)</span>
                    <span className="tabular-nums">−{formatMoney(loyaltyDiscountAmount)} ₸</span>
                  </div>
                )}
              </div>

              {/* Способ оплаты */}
              <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">
                    {paymentMethod === 'cash' ? 'Наличные' : paymentMethod === 'kaspi' ? 'Kaspi' : 'Смешанная'}
                  </span>
                  <span className="text-2xl font-bold tabular-nums">
                    {formatMoney(finalTotal)} <span className="text-sm font-medium text-slate-500">₸</span>
                  </span>
                </div>
                {paymentMethod === 'mixed' && (
                  <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-700">
                    <div className="flex justify-between">
                      <span>Наличные</span>
                      <span className="tabular-nums">{formatMoney(parseMoney(mixedCash))} ₸</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Kaspi</span>
                      <span className="tabular-nums">{formatMoney(parseMoney(mixedKaspi))} ₸</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Клиент / Комментарий */}
              {selectedCustomer && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  <span>{selectedCustomer.name}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}</span>
                </div>
              )}
              {comment.trim() && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {comment.trim()}
                </div>
              )}
            </div>

            {/* Кнопки */}
            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 dark:border-slate-800 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPayConfirm(false)}
                disabled={saving}
                className="h-12 sm:order-1 sm:w-auto sm:px-6"
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handlePay()}
                disabled={saving}
                className="h-14 rounded-xl bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 sm:order-2 sm:h-12 sm:px-8"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Проводим…
                  </span>
                ) : (
                  <>✓ Подтвердить · {formatMoney(finalTotal)} ₸</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка корректировки оплаты */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={closeCorrection}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
            <h3 className="text-base font-semibold">Исправить оплату</h3>
            <p className="mt-1 text-xs text-slate-500">
              Чек #{selectedSale.id.slice(-6)} · {formatMoney(selectedSale.total_amount)} ₸
            </p>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-1.5">
                {(['cash', 'kaspi', 'mixed'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCorrectionMethod(m)}
                    className={`rounded-xl border py-2 text-sm font-medium transition ${
                      correctionMethod === m
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {m === 'cash' ? 'Наличные' : m === 'kaspi' ? 'Kaspi' : 'Смешан.'}
                  </button>
                ))}
              </div>
              {correctionMethod === 'mixed' && (
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="text-xs text-slate-500">Наличные</span>
                    <input
                      value={correctionCash}
                      onChange={(e) => {
                        const v = e.target.value
                        setCorrectionCash(v)
                        const total = Number(selectedSale.total_amount || 0)
                        const cash = Math.max(0, Math.min(total, parseMoney(v)))
                        setCorrectionKaspi(String(Math.max(0, total - cash)))
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                  <label>
                    <span className="text-xs text-slate-500">Kaspi</span>
                    <input
                      value={correctionKaspi}
                      onChange={(e) => {
                        const v = e.target.value
                        setCorrectionKaspi(v)
                        const total = Number(selectedSale.total_amount || 0)
                        const kaspi = Math.max(0, Math.min(total, parseMoney(v)))
                        setCorrectionCash(String(Math.max(0, total - kaspi)))
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </label>
                </div>
              )}
              <label className="block">
                <span className="text-xs text-slate-500">Причина исправления (обязательно)</span>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={2}
                  placeholder="Например: ошибка при выборе способа оплаты"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeCorrection} disabled={correctionSaving}>Отмена</Button>
              <Button
                type="button"
                onClick={() => void handleCorrection()}
                disabled={correctionSaving || !correctionReason.trim()}
                className="bg-emerald-500 hover:bg-emerald-600"
              >
                {correctionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Исправить'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка универсального товара */}
      {showUniversal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setShowUniversal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
          >
            <h3 className="text-base font-semibold">Универсальный товар</h3>
            <p className="mt-1 text-xs text-slate-500">Введите название и цену вручную (товара нет в каталоге).</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500">Название</span>
                <input
                  value={uniName}
                  onChange={(e) => setUniName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Цена, ₸</span>
                <input
                  value={uniPrice}
                  onChange={(e) => setUniPrice(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowUniversal(false)}>Отмена</Button>
              <Button type="button" onClick={addUniversalItem} className="bg-emerald-500 hover:bg-emerald-600">Добавить</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
