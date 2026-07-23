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
  BookmarkPlus,
  Clock,
  Loader2,
  LogOut,
  Minus,
  Percent,
  Plus,
  Receipt as ReceiptIcon,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import ScreenBackdrop, { screenBgClass } from '@/components/ScreenBackdrop'
import { ChangeCalculator } from '@/components/ChangeCalculator'
import { PreferencesModal } from '@/components/PreferencesModal'
import { SyncIndicator } from '@/components/SyncIndicator'
import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import * as offline from '@/lib/offline'
import { useSyncWatcher } from '@/lib/use-sync-watcher'
import { useCashlessLabels } from '@/lib/use-cashless-labels'
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
import {
  deleteParkedCart,
  loadParkedCarts,
  saveParkedCart,
} from '@/lib/parked-carts'
import type {
  AppConfig,
  BootstrapData,
  Customer,
  LoyaltyConfig,
  OperatorSession,
  ParkedCart,
  PointInventorySaleContext,
  PointInventorySaleItem,
  PointReceiptSettings,
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
  onSwitchToHistory?: () => void
  onSwitchToArena?: () => void
  onOpenCabinet?: () => void
}

type CartLine = {
  id: string             // unique key для React (для универсальных товаров — random)
  item_id: string | null // null для универсального товара
  name: string
  unit?: string | null
  quantity: number
  unit_price: number
  comment?: string | null // комментарий к позиции (используется в универсальной продаже)
}

const UNIVERSAL_PRODUCT_PREFIX = 'universal:'

/**
 * Порог «подозрительного» количества в одной позиции чека: при quantity >= порога
 * перед проведением продажи показываем подтверждение («Проверьте количество»).
 * Защита от опечаток кассира (25 вместо 2–5, скан штрихкода в поле количества).
 */
const QTY_CONFIRM_THRESHOLD = 10

export default function InventorySalesPageMinimal({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToReturn,
  onSwitchToScanner,
  onSwitchToRequest,
  onSwitchToHistory,
  onSwitchToArena,
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
  const [uniComment, setUniComment] = useState('')

  // Отложка корзины
  const todayDate = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const parkedScope = useMemo(
    () => ({ companyId: session.company.id, date: todayDate, shift: runtimeShift.shift }),
    [session.company.id, todayDate, runtimeShift.shift],
  )
  const [parkedCarts, setParkedCarts] = useState<ParkedCart[]>(() => loadParkedCarts(parkedScope))
  const [showParkedList, setShowParkedList] = useState(false)
  const [showParkDialog, setShowParkDialog] = useState(false)
  const [parkLabelInput, setParkLabelInput] = useState('')

  // Режим: продажа или история
  const [viewMode, setViewMode] = useState<'sale' | 'history'>('sale')
  const [selectedSale, setSelectedSale] = useState<any | null>(null)

  // Подтверждение оплаты
  const [showPayConfirm, setShowPayConfirm] = useState(false)

  // Подтверждение подозрительного количества (quantity >= QTY_CONFIRM_THRESHOLD)
  const [qtyConfirmLines, setQtyConfirmLines] = useState<
    Array<{ name: string; quantity: number; unit: string | null }> | null
  >(null)

  // Превью чека после успешной продажи (в iframe внутри программы)
  const [lastReceipt, setLastReceipt] = useState<SaleReceiptPreview | null>(null)
  const [receiptSettings, setReceiptSettings] = useState<PointReceiptSettings | null>(null)
  const [adPlaylist, setAdPlaylist] = useState<api.AdPlaylistItem[]>([])
  const [pushTick, setPushTick] = useState(0)
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null)

  // Корректировка оплаты
  const [correctionMethod, setCorrectionMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [correctionCash, setCorrectionCash] = useState('')
  const [correctionKaspi, setCorrectionKaspi] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionSaving, setCorrectionSaving] = useState(false)

  const [now, setNow] = useState(() => new Date())
  const [showPreferences, setShowPreferences] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Часы в шапке — обновляем каждую секунду чтобы не выглядели "застывшими"
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Горячие клавиши (для быстрой работы):
  //   F2 — фокус на поиск товара
  //   F4 — открыть подтверждение оплаты (если есть товары в корзине)
  //   Esc — закрыть модалки
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Игнорируем если фокус в инпуте (кроме Esc и F-клавиш)
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '')
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'F4') {
        if (cart.length > 0 && !showPayConfirm) {
          e.preventDefault()
          setShowPayConfirm(true)
        }
        return
      }
      if (e.key === 'Escape' && !inInput) {
        if (showPayConfirm) setShowPayConfirm(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cart.length, showPayConfirm])

  // Подгружаем реквизиты чека ККМ (один раз). Если сервер ответит — кэшируется
  // внутри api.getPointReceiptSettings в localStorage, для офлайн-печати.
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

  // Плейлист рекламы для экрана клиента. Тянем при старте и обновляем
  // раз в 10 минут (контент меняется из веб-админки нечасто).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const items = await api.fetchAdPlaylist(config, session.company.id)
        if (!cancelled) setAdPlaylist(items)
      } catch {
        /* реклама не критична — игнорируем сбой */
      }
    }
    void load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [config, session.company.id])

  // Свежеоткрытое окно клиента просит переслать состояние — форсим ре-пуш.
  useEffect(() => {
    const off = window.electron?.customerDisplay?.onRequest?.(() => setPushTick((n) => n + 1))
    return () => { if (off) off() }
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

  // Manual sync с toast-фидбеком — кассир жмёт после ревизии/перемещения,
  // чтобы тут же увидеть свежие остатки (не ждать 30-сек авто-синк).
  async function handleManualSync() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventorySales(config, session)
      setContext(data)
      setLoyaltyConfig((data as any).loyalty_config || null)
      void saveSalesContextCache(data)
      const itemsCount = Array.isArray((data as any)?.items) ? (data as any).items.length : 0
      toastSuccess(`Синхронизировано · ${itemsCount} товаров`)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось синхронизировать витрину')
    } finally {
      setLoading(false)
    }
  }

  // Provider-aware лейблы (Kaspi/Halyk/Безналичный) для UI
  const cashLabels = useCashlessLabels(session)

  // Realtime sync с сайтом — раз в 30с проверяем не изменились ли цены/остатки на сервере
  const { status: syncStatus, lastSyncedAt } = useSyncWatcher({
    config,
    watch: ['catalogVersion', 'balancesVersion'],
    onSyncNeeded: () => void load(true),
    onPushMessage: (msg) => {
      const senderLabel = msg.sent_by_name ? ` от ${msg.sent_by_name}` : ' от админа'
      if (msg.kind === 'urgent') {
        toastError(`🚨 Срочно${senderLabel}: ${msg.body}`)
      } else if (msg.kind === 'warning') {
        toastError(`⚠️ Внимание${senderLabel}: ${msg.body}`)
      } else if (msg.kind === 'lock_sales') {
        toastError(`🔒 Продажи заблокированы: ${msg.body}`)
      } else if (msg.kind === 'unlock_sales') {
        toastSuccess(`🔓 Продажи разблокированы: ${msg.body}`)
      } else {
        toastSuccess(`💬 Сообщение${senderLabel}: ${msg.body}`)
      }
    },
  })

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
      session.operator?.full_name?.trim() ||
      session.operator?.name?.trim() ||
      session.operator?.short_name?.trim() ||
      session.operator?.username?.trim() ||
      bootstrap?.operatorName?.trim() ||
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

  // Customer display: пушим текущее состояние корзины в окно клиента (если открыто).
  // lastAddedId — id последней позиции в корзине, чтобы на экране клиента подсветить
  // только что добавленное.
  // ВАЖНО: канал аддитивный — старые поля не менять/не удалять (окна могут быть
  // разных версий при рассинхроне обновлений). Новые поля: image_url, reviewUrl.
  useEffect(() => {
    try {
      window.electron.customerDisplay.push({
        kind: 'update',
        state: {
          companyName: session.company?.name || null,
          operatorName: operatorName || null,
          cart: cart.map((l) => ({
            id: l.id,
            name: l.name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            comment: l.comment || null,
            // Фото товара для карточной сетки на экране клиента (null для универсальных)
            image_url: (l.item_id ? itemsById.get(l.item_id)?.image_url : null) || null,
          })),
          lastAddedId: cart[cart.length - 1]?.id || null,
          subtotal,
          discount: discountAmount + loyaltyDiscountAmount,
          total: finalTotal,
          paymentMethod,
          customer: selectedCustomer
            ? {
                name: selectedCustomer.name,
                phone: selectedCustomer.phone,
                loyaltyPoints: Number(selectedCustomer.loyalty_points || 0),
              }
            : null,
          playlist: adPlaylist,
          // Ссылка «Оцените нас» (2GIS/Google Maps) — QR в заставке и на экране «Спасибо»
          reviewUrl: receiptSettings?.review_url?.trim() || null,
        },
      })
    } catch { /* customerDisplay API может отсутствовать в старых сборках */ }
  }, [cart, subtotal, discountAmount, loyaltyDiscountAmount, finalTotal, paymentMethod, session.company?.name, selectedCustomer, adPlaylist, pushTick, itemsById, receiptSettings])

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

  function openParkDialog() {
    if (cart.length === 0) {
      toastError('Корзина пуста — нечего откладывать')
      return
    }
    const nextNumber = parkedCarts.length + 1
    setParkLabelInput(`Отложка #${nextNumber}`)
    setShowParkDialog(true)
  }

  function confirmParkCart() {
    if (cart.length === 0) return
    const label = parkLabelInput.trim() || `Отложка #${parkedCarts.length + 1}`
    const parked: ParkedCart = {
      id: `park-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      createdAt: new Date().toISOString(),
      items: cart.map((l) => ({
        id: l.id,
        item_id: l.item_id,
        name: l.name,
        unit: l.unit || null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        comment: l.comment || null,
      })),
      customer: selectedCustomer
        ? { id: selectedCustomer.id, name: selectedCustomer.name, phone: selectedCustomer.phone }
        : null,
      comment: comment.trim() || null,
    }
    const next = saveParkedCart({ ...parkedScope, cart: parked })
    setParkedCarts(next)
    clearAll()
    setShowParkDialog(false)
    setParkLabelInput('')
    toastSuccess(`Отложено: ${label}`)
    beep('ok')
  }

  function restoreParkedCart(parked: ParkedCart) {
    if (cart.length > 0) {
      const ok = window.confirm('В корзине есть товары. Заменить их содержимым отложки?')
      if (!ok) return
    }
    setCart(
      parked.items.map((it) => ({
        id: it.id,
        item_id: it.item_id,
        name: it.name,
        unit: it.unit || null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        comment: it.comment || null,
      })),
    )
    if (parked.customer) {
      setSelectedCustomer({
        id: parked.customer.id,
        name: parked.customer.name,
        phone: parked.customer.phone,
        card_number: null,
        loyalty_points: 0,
      } as Customer)
    } else {
      setSelectedCustomer(null)
    }
    if (parked.comment) setComment(parked.comment)
    const next = deleteParkedCart({ ...parkedScope, id: parked.id })
    setParkedCarts(next)
    setShowParkedList(false)
    setViewMode('sale')
    beep('ok')
    toastSuccess(`Отложка восстановлена: ${parked.label}`)
  }

  function removeParkedCart(id: string) {
    const next = deleteParkedCart({ ...parkedScope, id })
    setParkedCarts(next)
    if (next.length === 0) setShowParkedList(false)
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
        comment: uniComment.trim() || null,
      },
    ])
    setUniName('')
    setUniPrice('')
    setUniComment('')
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
    // Подозрительно большое количество в позиции — просим подтвердить
    const suspicious = cart.filter((l) => l.quantity >= QTY_CONFIRM_THRESHOLD)
    if (suspicious.length > 0) {
      beep('error')
      setQtyConfirmLines(suspicious.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit || null })))
      return
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

    const ref = localRef()
    const salePayload = {
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
      local_ref: ref,
      items: cart.map((l) => ({
        item_id: l.item_id,
        universal_name: l.item_id ? null : l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        comment: l.comment || null,
      })),
      customer_id: selectedCustomer?.id || null,
      loyalty_points_spent: selectedCustomer ? loyaltyPointsToSpend : 0,
      discount_amount: discountAmount,
      loyalty_discount_amount: loyaltyDiscountAmount,
    }

    const showReceiptPreview = (saleId: string | null) => {
      const nowTs = new Date()
      const preview: SaleReceiptPreview = {
        saleId,
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
        receiptSettings,
        lines: cartDetailed.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          total: l.total,
          unit: l.unit || null,
        })),
      }
      setLastReceipt(preview)
    }

    // ── Optimistic UI ─────────────────────────────────────────────────────
    // Сразу показываем чек и очищаем корзину — UI отзывается мгновенно.
    // Запрос на сервер уходит в фоне; ошибка → откатываем корзину.
    const cartSnapshot = [...cart]
    const customerSnapshot = selectedCustomer
    const commentSnapshot = comment
    showReceiptPreview(ref) // чек с временным local_ref
    // Customer display: показать «Спасибо!».
    // Начисление баллов считаем той же формулой, что сервер
    // (app/api/point/inventory-sales: floor(total/100 * points_per_100_tenge)) —
    // пуш уходит оптимистично, до ответа сервера.
    const paidLoyalty = (() => {
      if (!customerSnapshot || !loyaltyConfig?.is_active) return null
      const currentPoints = Math.max(0, Number(customerSnapshot.loyalty_points || 0))
      const earned = Math.max(0, Math.floor((finalTotal / 100) * Number(loyaltyConfig.points_per_100_tenge || 1)))
      const spent = Math.max(0, Math.min(loyaltyPointsToSpend, currentPoints))
      return { earned, spent, totalAfter: Math.max(0, currentPoints + earned - spent) }
    })()
    try {
      window.electron.customerDisplay.push({
        kind: 'paid',
        total: finalTotal,
        paymentLabel:
          paymentMethod === 'cash'
            ? 'Оплата наличными'
            : paymentMethod === 'kaspi'
              ? `Оплата ${cashLabels.providerName}`
              : 'Смешанная оплата',
        lines: cartSnapshot.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          image_url: (l.item_id ? itemsById.get(l.item_id)?.image_url : null) || null,
        })),
        // Новые аддитивные поля (старый экран клиента их просто игнорирует)
        loyalty: paidLoyalty,
        reviewUrl: receiptSettings?.review_url?.trim() || null,
      })
    } catch { /* customerDisplay API недоступен — игнорируем */ }
    clearAll()
    setShowPayConfirm(false)
    setSaving(false) // оптимистично — оператор может работать дальше

    try {
      const result = await api.createPointInventorySale(config, session, salePayload as any)
      // Тихо обновляем id в превью чека на настоящий
      setLastReceipt((prev) => prev && prev.saleId === ref ? { ...prev, saleId: result?.sale_id || ref } : prev)
      toastSuccess('Продажа сохранена')
      beep('ok')
      void load(true)
    } catch (err: any) {
      const isNetworkError = err?.message?.includes('Failed to fetch') ||
                             err?.message?.includes('NetworkError') ||
                             err?.message?.includes('Превышено время ожидания') ||
                             err?.message?.includes('fetch failed') ||
                             !navigator.onLine
      if (isNetworkError) {
        try {
          await offline.queueInventorySale(salePayload, session, session.company.id)
          toastSuccess('Нет интернета — продажа в очереди, отправится сама')
          beep('ok')
        } catch (queueErr: any) {
          // Откат: возвращаем корзину
          beep('error')
          toastError('Не удалось сохранить даже локально: ' + (queueErr?.message || 'unknown'))
          setCart(cartSnapshot)
          setSelectedCustomer(customerSnapshot)
          setComment(commentSnapshot)
          setLastReceipt(null)
        }
      } else {
        // Откат при серверной ошибке
        beep('error')
        toastError(err?.message || 'Не удалось провести продажу')
        setCart(cartSnapshot)
        setSelectedCustomer(customerSnapshot)
        setComment(commentSnapshot)
        setLastReceipt(null)
      }
    }
  }

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`relative flex h-screen flex-col overflow-hidden ${screenBgClass} text-foreground`}>
      {/* Декоративные акценты — единый фон рабочих экранов (как на «Смене») */}
      <ScreenBackdrop />
      <div className="h-9 shrink-0 drag-region bg-card/80 backdrop-blur" />

      {/* Шапка */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-3 py-2 backdrop-blur-xl no-drag sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-[11px] font-bold tracking-tight text-primary-foreground shadow-md shadow-primary/30">OP</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{session.company?.name || 'Точка'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {operatorName} · {formatShiftLabel(runtimeShift.shift)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 no-drag">
          {parkedCarts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowParkedList((v) => !v)}
              className="hidden items-center gap-1.5 rounded-full border border-amber-300/50 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60 sm:inline-flex"
              title="Отложенные корзины этой смены"
            >
              <Clock className="h-3.5 w-3.5" />
              Отложено · {parkedCarts.length}
            </button>
          )}
          <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline">{timeStr}</span>
          <WorkModeSwitch
            active="sale"
            showSale
            showReturn={!!onSwitchToReturn}
            showHistory={!!onSwitchToHistory}
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            showArena={!!onSwitchToArena}
            onShift={onSwitchToShift}
            onSale={() => undefined}
            onReturn={onSwitchToReturn}
            onHistory={onSwitchToHistory}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
            onArena={onSwitchToArena}
            onCabinet={onOpenCabinet}
          />
          <SyncIndicator status={syncStatus} lastSyncedAt={lastSyncedAt} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleManualSync()}
            disabled={loading}
            className="h-9 gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
            title="Подтянуть свежие остатки с сервера (после ревизии или перемещения со склада)"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Синхронизирую…' : 'Синхронизировать'}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPreferences(true)} className="h-9 w-9 p-0" title="Настройки">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-9 w-9 p-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Вкладки: Продажи / История */}
      <nav className="relative z-10 flex shrink-0 items-center gap-1 border-b border-border bg-card/80 px-3 backdrop-blur-xl sm:px-4">
        {(['sale', 'history'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`relative px-4 py-2.5 text-sm font-medium transition ${
              viewMode === mode
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {mode === 'sale' ? 'Продажи' : `История${(context?.sales?.length || 0) > 0 ? ` (${context?.sales?.length})` : ''}`}
            {viewMode === mode && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary shadow shadow-primary/30" />
            )}
          </button>
        ))}
      </nav>

      {/* Основной контент */}
      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {viewMode === 'history' ? (
          <section className="flex-1 overflow-auto p-3 sm:p-4">
            {(context?.sales || []).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <ReceiptIcon className="h-12 w-12 opacity-30" />
                <p className="text-sm">Чеков ещё нет</p>
                <p className="text-xs text-muted-foreground">Все ваши продажи за смену появятся здесь</p>
              </div>
            ) : (
              <>
                {/* Сводка дня */}
                {(() => {
                  const sales = context?.sales || []
                  const total = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0)
                  const cashSum = sales.reduce(
                    (s, x) =>
                      s + (x.payment_method === 'cash' ? Number(x.total_amount || 0) : Number((x as any).cash_amount || 0)),
                    0,
                  )
                  const kaspiSum = sales.reduce(
                    (s, x) =>
                      s + (x.payment_method === 'kaspi' ? Number(x.total_amount || 0) : Number((x as any).kaspi_amount || 0)),
                    0,
                  )
                  return (
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-2xl border border-border bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Чеков</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{sales.length}</p>
                      </div>
                      <div className="rounded-2xl border border-border bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Сумма</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-primary">
                          {formatMoney(total)} ₸
                        </p>
                      </div>
                      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-primary/80">Наличные</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(cashSum)} ₸</p>
                      </div>
                      <div className="rounded-2xl border border-sky-200/60 bg-sky-50/60 p-3 dark:border-sky-900/40 dark:bg-sky-950/30">
                        <p className="text-[10px] uppercase tracking-wider text-sky-700/80 dark:text-sky-300/70">
                          {cashLabels.providerName}
                        </p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(kaspiSum)} ₸</p>
                      </div>
                    </div>
                  )
                })()}
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
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
                        <tr key={sale.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-3">
                            <p className="text-sm font-medium">{timeStr}</p>
                            <p className="text-xs text-muted-foreground">#{sale.id.slice(-6)}</p>
                          </td>
                          <td className="px-3 py-3 text-sm">{sale.items?.length || 0}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                sale.payment_method === 'cash'
                                  ? 'bg-primary/10 text-primary'
                                  : sale.payment_method === 'kaspi'
                                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              {sale.payment_method === 'cash' ? 'Наличные' : sale.payment_method === 'kaspi' ? cashLabels.providerName : 'Смешанная'}
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
              </>
            )}
          </section>
        ) : (
        <>
        {/* Левая зона: поиск + таблица позиций */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* Поиск */}
          <div className="relative shrink-0 border-b border-border bg-card p-3 sm:p-4">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
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
                  className="h-12 w-full rounded-2xl border border-input bg-muted pl-12 pr-12 text-base text-foreground outline-none transition focus:border-ring"
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowUniversal(true)}
                className="h-12 rounded-2xl border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary"
                title="Универсальная продажа: услуга или товар не из каталога"
              >
                + Универсальная
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-80 overflow-auto rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg sm:left-4 sm:right-4">
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
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-accent"
                    >
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-border object-cover" loading="lazy" />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
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
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Загружаем витрину…</p>
              </div>
            ) : error && cart.length === 0 ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                {error}
              </div>
            ) : cartDetailed.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <ReceiptIcon className="h-12 w-12 opacity-30" />
                <p className="text-sm">Список пуст</p>
                <p className="text-xs text-muted-foreground">Найдите товар через поиск или отсканируйте штрихкод</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
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
                      <tr key={line.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-3 text-sm text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium leading-tight">{line.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
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
                          <div className="mx-auto flex w-fit items-center gap-1 rounded-xl border border-border">
                            <button
                              type="button"
                              onClick={() => changeQty(line.id, line.quantity - 1)}
                              className="grid h-9 w-9 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQty(line.id, line.quantity + 1)}
                              className="grid h-9 w-9 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
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
                            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
        <aside className="shrink-0 border-t border-border bg-card p-3 lg:w-96 lg:overflow-auto lg:border-l lg:border-t-0 lg:p-4 xl:w-[420px]">
          <div className="flex h-full flex-col gap-3">
            {/* Итого */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
              <p className="relative text-xs uppercase tracking-wider text-primary">К оплате</p>
              <p className="relative mt-1 text-4xl font-bold tabular-nums text-primary sm:text-5xl">
                {formatMoney(finalTotal)}
                <span className="ml-1 text-lg font-medium text-primary/60">₸</span>
              </p>
              {(discountAmount > 0 || loyaltyDiscountAmount > 0) && (
                <div className="mt-2 space-y-0.5 text-xs">
                  <div className="flex justify-between text-muted-foreground"><span>Подытог</span><span>{formatMoney(subtotal)} ₸</span></div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-destructive">
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
              <p className="mt-2 text-xs text-muted-foreground">
                {cartDetailed.length} {cartDetailed.length === 1 ? 'позиция' : 'позиций'} · {cartDetailed.reduce((s, l) => s + l.quantity, 0)} шт
              </p>
            </div>

            {/* Клиент / Скидка тогглы */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowCustomer(!showCustomer)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition ${
                  selectedCustomer
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <UserCircle2 className="h-3.5 w-3.5" />
                {selectedCustomer ? selectedCustomer.name.slice(0, 12) : 'Клиент'}
              </button>
              <button
                type="button"
                onClick={() => setShowDiscount(!showDiscount)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition ${
                  effectiveDiscountPercent > 0
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <Tag className="h-3.5 w-3.5" />
                {effectiveDiscountPercent > 0 ? `Скидка -${effectiveDiscountPercent}%` : 'Скидка'}
              </button>
            </div>

            {/* Панель клиента */}
            {showCustomer && (
              <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
                {selectedCustomer ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selectedCustomer.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{selectedCustomer.phone || selectedCustomer.card_number || '—'}</p>
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
                          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                          min={0}
                          max={maxRedeemablePoints}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={clearCustomer}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Убрать клиента
                    </button>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Телефон или карта"
                        className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-xs text-foreground outline-none focus:border-ring"
                      />
                      {customerSearching && (
                        <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {showCustomerDropdown && customerResults.length > 0 && (
                      <div className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-border">
                        {customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCustomer(c)}
                            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{c.name}</p>
                              <p className="truncate text-muted-foreground">{c.phone || c.card_number || '—'}</p>
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
              <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="number"
                    value={manualDiscountPercent}
                    onChange={(e) => {
                      setManualDiscountPercent(e.target.value)
                      clearPromoCode()
                    }}
                    placeholder="Скидка вручную, %"
                    className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                    min={0}
                    max={99}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    placeholder="Промокод"
                    className="h-9 flex-1 rounded-lg border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-ring"
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
                    <span className="text-primary">✓ {appliedPromoCode} применён</span>
                    <button type="button" onClick={clearPromoCode} className="text-muted-foreground hover:text-destructive">убрать</button>
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
                  className={`rounded-xl border py-3 text-sm font-medium transition ${
                    paymentMethod === m
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m === 'cash' ? 'Наличные' : m === 'kaspi' ? cashLabels.providerName : 'Смешанная'}
                </button>
              ))}
            </div>

            {paymentMethod === 'mixed' && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Наличными</span>
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
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium tabular-nums text-foreground outline-none focus:border-ring"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{cashLabels.providerName}</span>
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
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium tabular-nums text-foreground outline-none focus:border-ring"
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
              className="w-full rounded-xl border border-input bg-background p-2 text-xs text-foreground outline-none focus:border-ring"
            />

            {/* Кнопки действий */}
            <div className="mt-auto flex flex-col gap-2">
              <Button
                type="button"
                onClick={openPayConfirm}
                disabled={saving || cart.length === 0}
                className="h-16 rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-40 disabled:hover:shadow-lg"
              >
                ОПЛАТИТЬ · {formatMoney(finalTotal)} ₸
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={openParkDialog}
                  disabled={cart.length === 0}
                  className="h-10 gap-1.5 rounded-xl"
                  title="Отложить корзину до конца смены"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  Отложить
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearAll}
                  disabled={cart.length === 0}
                  className="h-10 rounded-xl"
                >
                  Очистить
                </Button>
              </div>
            </div>
          </div>
        </aside>
        </>
        )}
      </main>

      {/* Модалка после успешной продажи: подтверждение + превью чека */}
      {lastReceipt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 sm:p-4" onClick={() => setLastReceipt(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl">
            {/* Шапка */}
            <div className="flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-5 w-5">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Оплата проведена</h3>
                  <p className="text-xs text-primary/80">
                    Чек #{lastReceipt.saleId?.slice(-6) || '—'} · {formatMoney(lastReceipt.totalAmount)} ₸
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLastReceipt(null)}
                className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Превью чека */}
            <div className="flex-1 overflow-auto bg-muted p-3 sm:p-5">
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
            <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-5">
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
                className="h-12 rounded-xl text-base font-semibold sm:order-2 sm:px-8"
              >
                🖨 Печатать чек
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка подтверждения оплаты */}
      {showPayConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !saving && setShowPayConfirm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-card text-card-foreground shadow-xl">
            {/* Шапка */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold">Подтвердите оплату</h3>
                <p className="text-xs text-muted-foreground">Проверьте детали чека перед проведением</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setShowPayConfirm(false)}
                disabled={saving}
                className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Список товаров */}
            <div className="max-h-64 overflow-auto px-5 py-3">
              <div className="space-y-1">
                {cartDetailed.map((line) => (
                  <div key={line.id} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-muted-foreground">{line.quantity} × {formatMoney(line.unit_price)} ₸</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(line.total)} ₸</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Сводка */}
            <div className="border-t border-border px-5 py-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Подытог ({cartDetailed.length} поз. · {cartDetailed.reduce((s, l) => s + l.quantity, 0)} шт)</span>
                  <span className="tabular-nums">{formatMoney(subtotal)} ₸</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-destructive">
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
              <div className="mt-3 rounded-xl bg-primary/5 border border-primary/20 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">
                    {paymentMethod === 'cash' ? 'Наличные' : paymentMethod === 'kaspi' ? cashLabels.providerName : 'Смешанная'}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    {formatMoney(finalTotal)} <span className="text-sm font-medium text-muted-foreground">₸</span>
                  </span>
                </div>
                {paymentMethod === 'mixed' && (
                  <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Наличные</span>
                      <span className="tabular-nums">{formatMoney(parseMoney(mixedCash))} ₸</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{cashLabels.providerName}</span>
                      <span className="tabular-nums">{formatMoney(parseMoney(mixedKaspi))} ₸</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Клиент / Комментарий */}
              {selectedCustomer && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  <span>{selectedCustomer.name}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}</span>
                </div>
              )}
              {comment.trim() && (
                <div className="mt-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                  {comment.trim()}
                </div>
              )}
            </div>

            {/* Калькулятор сдачи (только для наличных или смешанной оплаты) */}
            {(paymentMethod === 'cash' || paymentMethod === 'mixed') && (
              <ChangeCalculator
                amountDue={paymentMethod === 'cash' ? finalTotal : Math.max(0, parseMoney(mixedCash))}
                paymentLabel={paymentMethod === 'cash' ? 'Получено наличными' : 'Получено налом'}
              />
            )}

            {/* Кнопки */}
            <div className="flex flex-col gap-2 border-t border-border p-5 sm:flex-row sm:justify-end">
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
                className="h-14 rounded-xl text-base font-semibold shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-50 disabled:hover:shadow-lg sm:order-2 sm:h-12 sm:px-8"
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={closeCorrection}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-card text-card-foreground p-5 shadow-xl">
            <h3 className="text-base font-semibold">Исправить оплату</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Чек #{selectedSale.id.slice(-6)} · {formatMoney(selectedSale.total_amount)} ₸
            </p>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-1.5">
                {(['cash', 'kaspi', 'mixed'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCorrectionMethod(m)}
                    className={`rounded-xl border py-2.5 text-sm font-medium transition ${
                      correctionMethod === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'cash' ? 'Наличные' : m === 'kaspi' ? cashLabels.providerName : 'Смешан.'}
                  </button>
                ))}
              </div>
              {correctionMethod === 'mixed' && (
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="text-xs text-muted-foreground">Наличные</span>
                    <input
                      value={correctionCash}
                      onChange={(e) => {
                        const v = e.target.value
                        setCorrectionCash(v)
                        const total = Number(selectedSale.total_amount || 0)
                        const cash = Math.max(0, Math.min(total, parseMoney(v)))
                        setCorrectionKaspi(String(Math.max(0, total - cash)))
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground outline-none focus:border-ring"
                    />
                  </label>
                  <label>
                    <span className="text-xs text-muted-foreground">{cashLabels.providerName}</span>
                    <input
                      value={correctionKaspi}
                      onChange={(e) => {
                        const v = e.target.value
                        setCorrectionKaspi(v)
                        const total = Number(selectedSale.total_amount || 0)
                        const kaspi = Math.max(0, Math.min(total, parseMoney(v)))
                        setCorrectionCash(String(Math.max(0, total - kaspi)))
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground outline-none focus:border-ring"
                    />
                  </label>
                </div>
              )}
              <label className="block">
                <span className="text-xs text-muted-foreground">Причина исправления (обязательно)</span>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={2}
                  placeholder="Например: ошибка при выборе способа оплаты"
                  className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm text-foreground outline-none focus:border-ring"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeCorrection} disabled={correctionSaving}>Отмена</Button>
              <Button
                type="button"
                onClick={() => void handleCorrection()}
                disabled={correctionSaving || !correctionReason.trim()}
              >
                {correctionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Исправить'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка подтверждения подозрительного количества */}
      {qtyConfirmLines && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-black/60 p-4" onClick={() => setQtyConfirmLines(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-card text-card-foreground shadow-xl"
          >
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-4">
              <h3 className="text-base font-bold text-amber-700 dark:text-amber-300">Проверьте количество</h3>
              <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
                В чеке есть позиции с необычно большим количеством ({QTY_CONFIRM_THRESHOLD}+ шт).
              </p>
            </div>
            <div className="max-h-56 space-y-2 overflow-auto px-5 py-4">
              {qtyConfirmLines.map((line, idx) => (
                <p key={idx} className="rounded-xl border border-border bg-muted px-3 py-2 text-sm">
                  «{line.name}» × <span className="font-bold">{line.quantity}</span> {line.unit || 'шт'}. Всё верно?
                </p>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end sm:gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setQtyConfirmLines(null)}
                className="h-12 sm:order-1 sm:px-6"
              >
                Исправить
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setQtyConfirmLines(null)
                  setShowPayConfirm(true)
                }}
                className="h-12 rounded-xl text-base font-semibold sm:order-2 sm:px-8"
              >
                Да, продать
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка универсальной продажи */}
      {showUniversal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowUniversal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-card text-card-foreground p-5 shadow-xl"
          >
            <h3 className="text-base font-semibold">Универсальная продажа</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Услуга или товар, которого нет на витрине. Способ оплаты выбирается перед проводом чека.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-muted-foreground">Наименование*</span>
                <input
                  value={uniName}
                  onChange={(e) => setUniName(e.target.value)}
                  placeholder="Например: услуга или товар не из каталога"
                  className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Сумма, ₸*</span>
                <input
                  value={uniPrice}
                  onChange={(e) => setUniPrice(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground outline-none focus:border-ring"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Комментарий</span>
                <textarea
                  value={uniComment}
                  onChange={(e) => setUniComment(e.target.value)}
                  placeholder="Что именно продано (необязательно)"
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowUniversal(false)
                  setUniName('')
                  setUniPrice('')
                  setUniComment('')
                }}
              >
                Отмена
              </Button>
              <Button type="button" onClick={addUniversalItem}>
                Добавить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Диалог отложки — задать подпись */}
      {showParkDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowParkDialog(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-card text-card-foreground p-5 shadow-xl"
          >
            <h3 className="text-base font-semibold">Отложить корзину</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Сохранит {cart.length} позиций на {formatMoney(finalTotal)} ₸ как черновик до конца смены.
            </p>
            <label className="mt-4 block">
              <span className="text-xs text-muted-foreground">Подпись (необязательно)</span>
              <input
                value={parkLabelInput}
                onChange={(e) => setParkLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    confirmParkCart()
                  }
                }}
                placeholder="Например: клиент в синей куртке"
                autoFocus
                className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowParkDialog(false)}>
                Отмена
              </Button>
              <Button type="button" onClick={confirmParkCart} className="bg-amber-500 text-white hover:bg-amber-600">
                Отложить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Список отложек этой смены */}
      {showParkedList && (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/60 p-4 pt-20" onClick={() => setShowParkedList(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-card text-card-foreground p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Отложки этой смены</h3>
              <button
                type="button"
                onClick={() => setShowParkedList(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Восстанавливается одноразово. После закрытия смены все отложки сбрасываются.
            </p>
            <div className="mt-4 space-y-2">
              {parkedCarts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  Пусто
                </p>
              ) : (
                parkedCarts.map((parked) => {
                  const total = parked.items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
                  const time = new Date(parked.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div
                      key={parked.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{parked.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {time} · {parked.items.length} поз. · {formatMoney(total)} ₸
                          {parked.customer ? ` · ${parked.customer.name}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => restoreParkedCart(parked)}
                          className="h-8 rounded-lg px-3 text-xs"
                        >
                          Восстановить
                        </Button>
                        <button
                          type="button"
                          onClick={() => removeParkedCart(parked.id)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                          title="Удалить отложку"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Настройки оператора (тема, шрифт, звуки) */}
      <PreferencesModal open={showPreferences} onClose={() => setShowPreferences(false)} />
    </div>
  )
}
