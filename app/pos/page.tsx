'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Minus,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  User,
  X,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; code: string | null }
type Location = { id: string; name: string; company_id: string; location_type: string }
type PosItem = {
  id: string
  name: string
  barcode: string | null
  sale_price: number
  unit: string | null
  category_name: string | null
  total_balance: number
  is_active: boolean
  location_balances?: Record<string, number>
}
type Customer = { id: string; name: string; phone: string | null; card_number: string | null; loyalty_points: number }
type Discount = {
  id: string
  name: string
  type: 'percent' | 'fixed' | 'promo_code'
  value: number
  promo_code: string | null
  min_order_amount: number | null
}
type LoyaltyConfig = {
  company_id: string
  points_per_100_tenge: number
  tenge_per_point: number
  min_points_to_redeem: number
  max_redeem_percent: number
  is_active: boolean
}
type BootstrapData = {
  companies: Company[]
  locations: Location[]
  items: PosItem[]
  customers: Customer[]
  discounts: Discount[]
  loyalty_config: LoyaltyConfig | null
}
type CartItem = {
  item_id: string
  name: string
  unit_price: number
  quantity: number
  barcode: string | null
  unit: string | null
}
type PaymentMethod = 'cash' | 'kaspi' | 'card' | 'online' | 'mixed'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function today(override?: Date | null) {
  const value = override ?? new Date()
  return value.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function nowTime(override?: Date | null) {
  const value = override ?? new Date()
  return value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function itemLocationBalance(item: PosItem, locationId: string) {
  if (!locationId) return 0
  return Number(item.location_balances?.[locationId] || 0)
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// ─── Receipt Component ───────────────────────────────────────────────────────

type ReceiptProps = {
  receiptData: any
  items: PosItem[]
  cartItems: CartItem[]
  company: Company | null
  location: Location | null
  customer: Customer | null
  discountLabel: string
  onClose: () => void
  onNewSale: () => void
}

function ReceiptModal({
  receiptData,
  items: _items,
  cartItems,
  company,
  location,
  customer,
  discountLabel,
  onClose,
  onNewSale,
}: ReceiptProps) {
  const soldAt = receiptData.sale?.sold_at ? new Date(receiptData.sale.sold_at) : null
  const change =
    receiptData.cash_amount > 0
      ? Math.max(0, receiptData.cash_amount - receiptData.total_amount)
      : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-emerald-600 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            <span className="font-semibold">Чек #{receiptData.sale_id?.slice(-6)}</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-white/20 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Receipt content - scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Print area */}
          <div id="receipt-print" className="px-6 py-4 font-mono text-sm text-gray-800">
            <div className="text-center mb-3">
              <div className="font-bold text-base uppercase tracking-widest">ORDA CONTROL</div>
              <div className="text-xs text-gray-600">
                {company?.name || ''} {location ? `— ${location.name}` : ''}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Дата: {today(soldAt)} {nowTime(soldAt)}
              </div>
            </div>

            <div className="border-t border-dashed border-gray-400 my-2" />

            <div className="flex text-xs text-gray-500 mb-1">
              <span className="flex-1">Наименование</span>
              <span className="w-8 text-center">Кол</span>
              <span className="w-16 text-right">Цена</span>
              <span className="w-16 text-right">Сумма</span>
            </div>
            <div className="border-t border-dashed border-gray-400 mb-1" />

            {cartItems.map((ci) => (
              <div key={ci.item_id} className="flex text-xs mb-0.5">
                <span className="flex-1 truncate">{ci.name}</span>
                <span className="w-8 text-center">{ci.quantity}</span>
                <span className="w-16 text-right">{fmt(ci.unit_price)}</span>
                <span className="w-16 text-right">{fmt(ci.unit_price * ci.quantity)}</span>
              </div>
            ))}

            <div className="border-t border-dashed border-gray-400 my-2" />

            <div className="flex justify-between text-sm">
              <span>Итого:</span>
              <span className="font-semibold">{fmt(receiptData.subtotal)} ₸</span>
            </div>
            {receiptData.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-red-600">
                <span>Скидка ({discountLabel}):</span>
                <span>-{fmt(receiptData.discount_amount)} ₸</span>
              </div>
            )}
            {receiptData.loyalty_discount_amount > 0 && (
              <div className="flex justify-between text-sm text-amber-600">
                <span>⭐ Баллы:</span>
                <span>-{fmt(receiptData.loyalty_discount_amount)} ₸</span>
              </div>
            )}

            <div className="border-t border-gray-300 mt-2 pt-2">
              <div className="flex justify-between font-bold text-base">
                <span>К оплате:</span>
                <span>{fmt(receiptData.total_amount)} ₸</span>
              </div>
            </div>

            {receiptData.cash_amount > 0 && (
              <div className="flex justify-between text-sm mt-1 text-gray-600">
                <span>Наличные:</span>
                <span>{fmt(receiptData.cash_amount)} ₸</span>
              </div>
            )}
            {receiptData.kaspi_amount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Kaspi:</span>
                <span>{fmt(receiptData.kaspi_amount)} ₸</span>
              </div>
            )}
            {receiptData.card_amount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Карта:</span>
                <span>{fmt(receiptData.card_amount)} ₸</span>
              </div>
            )}
            {receiptData.online_amount > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Онлайн:</span>
                <span>{fmt(receiptData.online_amount)} ₸</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex justify-between text-sm font-medium mt-1">
                <span>Сдача:</span>
                <span>{fmt(change)} ₸</span>
              </div>
            )}

            <div className="border-t border-dashed border-gray-400 my-2" />

            {customer && (
              <div className="text-xs text-gray-600">
                <span>Клиент: {customer.name}</span>
                {receiptData.loyalty_points_earned > 0 && (
                  <span className="ml-2 text-amber-600">+{receiptData.loyalty_points_earned} баллов</span>
                )}
              </div>
            )}

            <div className="text-center text-xs text-gray-500 mt-3">
              <div>Спасибо за покупку!</div>
              <div className="text-[10px] mt-1">ordacontrol.kz</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex gap-3 p-4 border-t border-gray-100">
          <button
            onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gray-100 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Печать
          </button>
          <button
            onClick={onNewSale}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            <ShoppingCart className="h-4 w-4" />
            Новая продажа
          </button>
        </div>
      </div>

      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #receipt-print, #receipt-print * { visibility: visible !important; }
          #receipt-print {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 80mm !important;
            background: white !important;
            padding: 8px !important;
            font-size: 12px !important;
            color: black !important;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Main POS Page ────────────────────────────────────────────────────────────

export default function PosPage() {
  const router = useRouter()

  // Bootstrap data
  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Context selectors
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')

  // Search / filter
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const searchRef = useRef<HTMLInputElement>(null)

  // Cart
  const [cart, setCart] = useState<CartItem[]>([])

  // Customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [loyaltyPointsToSpend, setLoyaltyPointsToSpend] = useState(0)
  const [showCustomerPanel, setShowCustomerPanel] = useState(false)

  // Discount
  const [showDiscountPanel, setShowDiscountPanel] = useState(false)
  const [selectedDiscount, setSelectedDiscount] = useState<Discount | null>(null)
  const [manualDiscountPercent, setManualDiscountPercent] = useState(0)
  const [promoCode, setPromoCode] = useState('')

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [mixedAmounts, setMixedAmounts] = useState({ cash: 0, kaspi: 0, card: 0, online: 0 })

  // Receipt
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptData, setReceiptData] = useState<any>(null)
  const [receiptCartSnapshot, setReceiptCartSnapshot] = useState<CartItem[]>([])
  const [receiptCompany, setReceiptCompany] = useState<Company | null>(null)
  const [receiptLocation, setReceiptLocation] = useState<Location | null>(null)
  const [receiptCustomer, setReceiptCustomer] = useState<Customer | null>(null)
  const [receiptDiscountLabel, setReceiptDiscountLabel] = useState('')

  // Sale submitting
  const [submitting, setSubmitting] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)

  // AI Insights
  const [showAiHint, setShowAiHint] = useState(false)
  const [aiHint, setAiHint] = useState<string | null>(null)
  const [aiHintLoading, setAiHintLoading] = useState(false)
  const [aiStats, setAiStats] = useState<{ today: number; yesterday: number; change: number } | null>(null)
  const aiHintFetchedRef = useRef(false)

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  const loadBootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/pos/bootstrap')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setBootstrapData(json.data)

      // Auto-select first company/location
      if (json.data.companies.length > 0 && !selectedCompanyId) {
        setSelectedCompanyId(json.data.companies[0].id)
      }
      if (json.data.locations.length > 0 && !selectedLocationId) {
        setSelectedLocationId(json.data.locations[0].id)
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [selectedCompanyId, selectedLocationId])

  useEffect(() => {
    loadBootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-focus search on mount
  useEffect(() => {
    if (!loading) {
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [loading])

  // ── Derived ────────────────────────────────────────────────────────────────

  const categories = useMemo(
    () =>
      bootstrapData
        ? Array.from(new Set(bootstrapData.items.map((i) => i.category_name || 'Без категории'))).sort()
        : [],
    [bootstrapData],
  )

  const barcodeMap = useMemo(
    () =>
      new Map(
        (bootstrapData?.items || [])
          .filter((i) => i.barcode)
          .map((i) => [i.barcode!, i]),
      ),
    [bootstrapData?.items],
  )

  const filteredItems = bootstrapData
    ? bootstrapData.items
        .filter((item) => {
        const matchSearch =
          !search ||
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          (item.barcode && item.barcode.includes(search))
        const matchCategory =
          filterCategory === 'all' ||
          (item.category_name || 'Без категории') === filterCategory
          return matchSearch && matchCategory
        })
        .map((item) => ({
          ...item,
          total_balance: itemLocationBalance(item, selectedLocationId),
        }))
    : []

  const subtotal = cart.reduce((sum, ci) => sum + ci.unit_price * ci.quantity, 0)

  const discountAmount = (() => {
    if (selectedDiscount) {
      if (selectedDiscount.type === 'percent') {
        return Math.round((subtotal * selectedDiscount.value) / 100 * 100) / 100
      }
      if (selectedDiscount.type === 'fixed') {
        return Math.min(subtotal, selectedDiscount.value)
      }
    }
    if (manualDiscountPercent > 0) {
      return Math.round((subtotal * manualDiscountPercent) / 100 * 100) / 100
    }
    return 0
  })()

  const loyaltyConfig = bootstrapData?.loyalty_config

  const maxLoyaltyPoints = (() => {
    if (!selectedCustomer || !loyaltyConfig || !loyaltyConfig.is_active) return 0
    const tengePerPoint = loyaltyConfig.tenge_per_point || 0
    const available = selectedCustomer.loyalty_points
    if (!tengePerPoint) return 0
    const maxByPercent = loyaltyConfig.max_redeem_percent
      ? (subtotal * loyaltyConfig.max_redeem_percent) / 100 / tengePerPoint
      : available
    return Math.min(available, Math.floor(maxByPercent))
  })()

  const loyaltyDiscountAmount = (() => {
    if (!loyaltyConfig || !loyaltyConfig.is_active || !loyaltyPointsToSpend) return 0
    return Math.min(
      loyaltyPointsToSpend * (loyaltyConfig.tenge_per_point || 0),
      subtotal - discountAmount,
    )
  })()

  const totalAmount = Math.max(0, subtotal - discountAmount - loyaltyDiscountAmount)

  const filteredCustomers = bootstrapData
    ? bootstrapData.customers.filter(
        (c) =>
          !customerSearch ||
          c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.phone && c.phone.includes(customerSearch)) ||
          (c.card_number && c.card_number.includes(customerSearch)),
      )
    : []

  useEffect(() => {
    if (!bootstrapData || !selectedLocationId) return
    setCart((prev) =>
      prev
        .map((ci) => {
          const item = bootstrapData.items.find((candidate) => candidate.id === ci.item_id)
          if (!item) return null
          const maxQty = itemLocationBalance(item, selectedLocationId)
          if (maxQty <= 0) return null
          return { ...ci, quantity: Math.min(ci.quantity, maxQty) }
        })
        .filter((ci): ci is CartItem => ci !== null),
    )
  }, [bootstrapData, selectedLocationId])

  // ── Cart actions ───────────────────────────────────────────────────────────

  const addToCart = useCallback((item: PosItem) => {
    const maxQty = itemLocationBalance(item, selectedLocationId)
    if (maxQty <= 0) return
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item_id === item.id)
      if (existing) {
        return prev.map((ci) =>
          ci.item_id === item.id
            ? { ...ci, quantity: Math.min(ci.quantity + 1, maxQty) }
            : ci,
        )
      }
      return [
        ...prev,
        {
          item_id: item.id,
          name: item.name,
          unit_price: item.sale_price,
          quantity: 1,
          barcode: item.barcode,
          unit: item.unit,
        },
      ]
    })
  }, [selectedLocationId])

  const removeFromCart = useCallback((item_id: string) => {
    setCart((prev) => prev.filter((ci) => ci.item_id !== item_id))
  }, [])

  const updateQty = useCallback(
    (item_id: string, delta: number) => {
      const item = bootstrapData?.items.find((i) => i.id === item_id)
      setCart((prev) =>
        prev
          .map((ci) => {
            if (ci.item_id !== item_id) return ci
            const newQty = ci.quantity + delta
            if (newQty <= 0) return null
            const maxQty = item ? itemLocationBalance(item, selectedLocationId) : 9999
            return { ...ci, quantity: Math.min(newQty, maxQty) }
          })
          .filter((ci): ci is CartItem => ci !== null),
      )
    },
    [bootstrapData, selectedLocationId],
  )

  // ── Barcode scanner ────────────────────────────────────────────────────────

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.length >= 8) {
      const found = barcodeMap.get(search)
      if (found && itemLocationBalance(found, selectedLocationId) > 0) {
        addToCart(found)
        setSearch('')
      }
    }
  }

  // ── Promo code apply ────────────────────────────────────────────────────────

  const applyPromoCode = () => {
    if (!bootstrapData || !promoCode.trim()) return
    const discount = bootstrapData.discounts.find(
      (d) => d.type === 'promo_code' && d.promo_code?.toLowerCase() === promoCode.trim().toLowerCase(),
    )
    if (discount) {
      setSelectedDiscount(discount)
      setManualDiscountPercent(0)
    } else {
      alert('Промокод не найден или недействителен')
    }
  }

  // ── Payment amounts ────────────────────────────────────────────────────────

  const getPaymentAmounts = () => {
    if (paymentMethod === 'cash') {
      return { cash: totalAmount, kaspi: 0, card: 0, online: 0 }
    }
    if (paymentMethod === 'kaspi') {
      return { cash: 0, kaspi: totalAmount, card: 0, online: 0 }
    }
    if (paymentMethod === 'card') {
      return { cash: 0, kaspi: 0, card: totalAmount, online: 0 }
    }
    if (paymentMethod === 'online') {
      return { cash: 0, kaspi: 0, card: 0, online: totalAmount }
    }
    return {
      cash: roundMoney(mixedAmounts.cash || 0),
      kaspi: roundMoney(mixedAmounts.kaspi || 0),
      card: roundMoney(mixedAmounts.card || 0),
      online: roundMoney(mixedAmounts.online || 0),
    }
  }

  // ── Submit sale ────────────────────────────────────────────────────────────

  const handleSubmitSale = useCallback(async () => {
    if (cart.length === 0) return
    if (!selectedCompanyId || !selectedLocationId) {
      setSaleError('Выберите компанию и точку продаж')
      return
    }

    setSaleError(null)
    setSubmitting(true)

    const amounts = getPaymentAmounts()
    const paidTotal = roundMoney(amounts.cash + amounts.kaspi + amounts.card + amounts.online)

    if (paymentMethod === 'mixed') {
      if (paidTotal <= 0) {
        setSubmitting(false)
        setSaleError('Укажите суммы для смешанной оплаты')
        return
      }

      if (Math.abs(paidTotal - totalAmount) > 0.01) {
        setSubmitting(false)
        setSaleError(`Сумма способов оплаты должна совпадать с итогом: ${fmt(totalAmount)} т`)
        return
      }
    }

    try {
      const res = await fetch('/api/pos/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          location_id: selectedLocationId,
          items: cart.map((ci) => ({
            item_id: ci.item_id,
            quantity: ci.quantity,
            unit_price: ci.unit_price,
          })),
          cash_amount: amounts.cash,
          kaspi_amount: amounts.kaspi,
          online_amount: amounts.online,
          card_amount: amounts.card,
          customer_id: selectedCustomer?.id || null,
          discount_id: selectedDiscount?.id || null,
          discount_percent: manualDiscountPercent,
          loyalty_points_spent: loyaltyPointsToSpend,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }

      const data = json.data
      const receiptItemsMap = new Map(
        ((data.receipt_data?.items as Array<{ item_id: string; quantity: number; unit_price: number }> | undefined) || []).map((item) => [
          item.item_id,
          item,
        ]),
      )

      // Capture receipt snapshot
      const company = bootstrapData?.companies.find((c) => c.id === selectedCompanyId) || null
      const location = bootstrapData?.locations.find((l) => l.id === selectedLocationId) || null
      const discountLabel = selectedDiscount
        ? selectedDiscount.type === 'percent'
          ? `${selectedDiscount.value}%`
          : `${fmt(selectedDiscount.value)} ₸`
        : manualDiscountPercent > 0
          ? `${manualDiscountPercent}%`
          : ''

      setReceiptData({
        ...data.receipt_data,
        subtotal,
        discount_amount: discountAmount,
        loyalty_discount_amount: loyaltyDiscountAmount,
        total_amount: totalAmount,
        cash_amount: amounts.cash,
        kaspi_amount: amounts.kaspi,
        card_amount: amounts.card,
        online_amount: amounts.online,
        loyalty_points_earned: data.receipt_data.loyalty_points_earned,
      })
      setReceiptCartSnapshot(
        cart.map((ci) => {
          const receiptItem = receiptItemsMap.get(ci.item_id)
          return receiptItem
            ? { ...ci, quantity: receiptItem.quantity, unit_price: receiptItem.unit_price }
            : ci
        }),
      )
      setReceiptCompany(company)
      setReceiptLocation(location)
      setReceiptCustomer(selectedCustomer)
      setReceiptDiscountLabel(discountLabel)
      setShowReceipt(true)
    } catch (e: any) {
      setSaleError(e.message || 'Ошибка проведения продажи')
    } finally {
      setSubmitting(false)
    }
  }, [
    cart,
    selectedCompanyId,
    selectedLocationId,
    paymentMethod,
    mixedAmounts,
    totalAmount,
    subtotal,
    discountAmount,
    loyaltyDiscountAmount,
    selectedCustomer,
    selectedDiscount,
    manualDiscountPercent,
    loyaltyPointsToSpend,
    bootstrapData,
  ])

  const fetchAiHint = async () => {
    if (!selectedCompanyId) return
    setAiHintLoading(true)
    try {
      const params = new URLSearchParams({ company_id: selectedCompanyId })
      if (selectedLocationId) params.set('location_id', selectedLocationId)
      const res = await fetch(`/api/pos/ai-hint?${params.toString()}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка')
      setAiHint(j.hint || null)
      setAiStats({ today: j.today_total, yesterday: j.yesterday_total, change: j.change_percent })
    } catch {
      setAiHint('Не удалось получить AI подсказку.')
    } finally {
      setAiHintLoading(false)
    }
  }

  const handleAiHintToggle = () => {
    const nextOpen = !showAiHint
    setShowAiHint(nextOpen)
    if (nextOpen && !aiHintFetchedRef.current) {
      aiHintFetchedRef.current = true
      void fetchAiHint()
    }
  }

  const handleNewSale = () => {
    localStorage.removeItem('pos_cart')
    setCart([])
    setSelectedCustomer(null)
    setCustomerSearch('')
    setSelectedDiscount(null)
    setManualDiscountPercent(0)
    setPromoCode('')
    setLoyaltyPointsToSpend(0)
    setPaymentMethod('cash')
    setMixedAmounts({ cash: 0, kaspi: 0, card: 0, online: 0 })
    setShowReceipt(false)
    setReceiptData(null)
    setSaleError(null)
    setShowCustomerPanel(false)
    setShowDiscountPanel(false)
    // Reload bootstrap to update balances
    loadBootstrap()
    setTimeout(() => searchRef.current?.focus(), 100)
  }

  // ── Cart persistence ───────────────────────────────────────────────────────

  // Save cart to localStorage on every change
  useEffect(() => {
    localStorage.setItem('pos_cart', JSON.stringify(cart))
  }, [cart])

  // Restore cart from localStorage after bootstrap loads
  useEffect(() => {
    if (!bootstrapData) return
    const saved = localStorage.getItem('pos_cart')
    if (!saved || cart.length > 0) return
    try {
      const parsed = JSON.parse(saved) as CartItem[]
      const valid = parsed.filter((ci) => bootstrapData.items.some((i) => i.id === ci.item_id && i.is_active))
      if (valid.length > 0) setCart(valid)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapData])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Enter or F9 → submit sale
      if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F9') {
        e.preventDefault()
        if (cart.length > 0 && !submitting) handleSubmitSale()
      }
      // Escape → focus search
      if (e.key === 'Escape') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      // F3 → toggle customer panel
      if (e.key === 'F3') {
        e.preventDefault()
        setShowCustomerPanel((prev) => !prev)
      }
      // F4 → toggle discount panel
      if (e.key === 'F4') {
        e.preventDefault()
        setShowDiscountPanel((prev) => !prev)
      }
      // F8 → clear cart
      if (e.key === 'F8' && cart.length > 0) {
        e.preventDefault()
        if (window.confirm('Очистить корзину?')) {
          setCart([])
          localStorage.removeItem('pos_cart')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cart, submitting, handleSubmitSale])

  // ── Render loading / error ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-gray-400">Загрузка кассы...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="text-red-400 text-4xl">⚠</div>
          <p className="text-red-400 text-lg font-semibold">Ошибка загрузки</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button
            onClick={loadBootstrap}
            className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Повторить
          </button>
        </div>
      </div>
    )
  }

  const filteredLocations = bootstrapData?.locations.filter(
    (l) => !selectedCompanyId || l.company_id === selectedCompanyId,
  ) || []

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-gray-900 px-4 py-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Выход</span>
        </button>

        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-emerald-400" />
          <span className="font-semibold text-white">Касса</span>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {/* Company selector */}
          <select
            value={selectedCompanyId}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value)
              setSelectedLocationId('')
            }}
            className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">— Компания —</option>
            {bootstrapData?.companies.map((c) => (
              <option key={c.id} value={c.id} className="text-gray-900">
                {c.name}
              </option>
            ))}
          </select>

          {/* Location selector */}
          <select
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">— Точка —</option>
            {filteredLocations.map((l) => (
              <option key={l.id} value={l.id} className="text-gray-900">
                {l.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleAiHintToggle}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${showAiHint ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}
            title="AI подсказки"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">AI</span>
          </button>
          <button
            onClick={loadBootstrap}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Обновить данные"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── AI Insights Panel ──────────────────────────────────────────────── */}
      {showAiHint && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-4 py-3">
          {aiHintLoading ? (
            <div className="flex items-center gap-2 text-amber-300 text-sm">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Получаю AI подсказки...
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              {aiStats && (
                <div className="flex items-center gap-4 shrink-0 text-sm">
                  <div>
                    <span className="text-gray-400 text-xs">Сегодня</span>
                    <p className="font-bold text-white">{aiStats.today.toLocaleString('ru-RU')} ₸</p>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Вчера</span>
                    <p className="font-semibold text-gray-300">{aiStats.yesterday.toLocaleString('ru-RU')} ₸</p>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">Изменение</span>
                    <p className={`font-semibold text-sm ${aiStats.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {aiStats.change >= 0 ? '+' : ''}{aiStats.change}%
                    </p>
                  </div>
                </div>
              )}
              {aiHint && (
                <div className="flex-1 text-xs text-amber-200/80 whitespace-pre-line leading-relaxed">
                  {aiHint}
                </div>
              )}
              <button
                onClick={() => { aiHintFetchedRef.current = false; void fetchAiHint() }}
                className="shrink-0 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Обновить
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: products ────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-white/10">
          {/* Search */}
          <div className="shrink-0 p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Поиск товара или штрихкод (Enter для сканера)"
                className="w-full rounded-xl bg-white/10 border border-white/20 pl-10 pr-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Category filter */}
          {categories.length > 0 && (
            <div className="shrink-0 flex gap-2 overflow-x-auto px-3 py-2 border-b border-white/10 scrollbar-none">
              <button
                onClick={() => setFilterCategory('all')}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterCategory === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                }`}
              >
                Все
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    filterCategory === cat
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                <Search className="h-10 w-10 opacity-30" />
                <p className="text-sm">Товары не найдены</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                {filteredItems.map((item) => {
                  const inCart = cart.find((ci) => ci.item_id === item.id)
                  const locationBalance = itemLocationBalance(item, selectedLocationId)
                  const outOfStock = locationBalance <= 0
                  return (
                    <button
                      key={item.id}
                      onClick={() => !outOfStock && addToCart(item)}
                      disabled={outOfStock}
                      className={`relative flex flex-col rounded-xl border p-3 text-left transition-all min-h-[80px] ${
                        outOfStock
                          ? 'border-red-900/50 bg-red-900/10 opacity-60 cursor-not-allowed'
                          : inCart
                            ? 'border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20'
                            : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/30'
                      }`}
                    >
                      {/* Stock badge */}
                      <span
                        className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          outOfStock
                            ? 'bg-red-600/30 text-red-400'
                            : 'bg-emerald-600/20 text-emerald-400'
                        }`}
                      >
                        {outOfStock ? 'Нет' : item.total_balance}
                      </span>

                      {/* In-cart badge */}
                      {inCart && (
                        <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                          {inCart.quantity}
                        </span>
                      )}

                      <span className="mt-4 text-xs font-medium text-white leading-snug line-clamp-2">
                        {item.name}
                      </span>
                      <span className="mt-auto pt-1 text-sm font-bold text-emerald-400">
                        {fmt(item.sale_price)} ₸
                      </span>
                      {item.unit && (
                        <span className="text-[10px] text-gray-500">{item.unit}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: cart + checkout ───────────────────────────────── */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden bg-gray-900 lg:w-96">
          {/* Cart header */}
          <div className="shrink-0 flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <ShoppingCart className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold text-white">Корзина</span>
            {cart.length > 0 && (
              <span className="ml-auto rounded-full bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-400">
                {cart.reduce((sum, ci) => sum + ci.quantity, 0)} шт
              </span>
            )}
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-8">
                <ShoppingCart className="h-12 w-12 opacity-30" />
                <p className="text-sm text-center">Нажмите на товар чтобы добавить</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {cart.map((ci) => (
                  <div
                    key={ci.item_id}
                    className="flex items-start gap-2 rounded-xl bg-white/5 border border-white/10 p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{ci.name}</p>
                      <p className="text-xs text-gray-400">
                        {fmt(ci.unit_price)} ₸ {ci.unit ? `/ ${ci.unit}` : ''}
                      </p>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQty(ci.item_id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-7 text-center text-sm font-medium">{ci.quantity}</span>
                      <button
                        onClick={() => updateQty(ci.item_id, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex items-start gap-1 shrink-0">
                      <span className="text-sm font-semibold text-white">
                        {fmt(ci.unit_price * ci.quantity)} ₸
                      </span>
                      <button
                        onClick={() => removeFromCart(ci.item_id)}
                        className="rounded p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Totals */}
                <div className="mt-2 rounded-xl bg-white/5 border border-white/10 p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Итого</span>
                    <span>{fmt(subtotal)} ₸</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-red-400">
                      <span>
                        Скидка{' '}
                        {selectedDiscount
                          ? `(${selectedDiscount.name})`
                          : `(${manualDiscountPercent}%)`}
                      </span>
                      <span>−{fmt(discountAmount)} ₸</span>
                    </div>
                  )}
                  {loyaltyDiscountAmount > 0 && (
                    <div className="flex justify-between text-amber-400">
                      <span>⭐ Баллы</span>
                      <span>−{fmt(loyaltyDiscountAmount)} ₸</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-white/10 pt-2 font-bold text-base text-white">
                    <span>К ОПЛАТЕ</span>
                    <span className="text-emerald-400">{fmt(totalAmount)} ₸</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom panel */}
          {cart.length > 0 && (
            <div className="shrink-0 border-t border-white/10 p-3 space-y-3">
              {/* ── Customer panel ─────────────────────────────────────────── */}
              <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowCustomerPanel((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/5 transition-colors"
                >
                  <User className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="text-gray-300 flex-1 text-left">
                    {selectedCustomer ? selectedCustomer.name : 'Клиент'}
                  </span>
                  {selectedCustomer && (
                    <span className="text-xs text-amber-400">
                      ⭐ {selectedCustomer.loyalty_points}
                    </span>
                  )}
                  <span className="text-gray-500 text-xs">{showCustomerPanel ? '▲' : '▼'}</span>
                </button>

                {showCustomerPanel && (
                  <div className="border-t border-white/10 p-3 space-y-2">
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Имя, телефон или карта..."
                      className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {customerSearch && (
                      <div className="max-h-32 overflow-y-auto rounded-lg bg-gray-800 border border-white/10">
                        {filteredCustomers.slice(0, 8).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedCustomer(c)
                              setCustomerSearch('')
                              setShowCustomerPanel(false)
                            }}
                            className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-white/10 transition-colors"
                          >
                            <span className="text-white">{c.name}</span>
                            <span className="text-gray-500">{c.phone}</span>
                          </button>
                        ))}
                        {filteredCustomers.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-500">Не найдено</p>
                        )}
                      </div>
                    )}
                    {selectedCustomer && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">
                            {selectedCustomer.name} — {selectedCustomer.loyalty_points} баллов
                          </span>
                          <button
                            onClick={() => {
                              setSelectedCustomer(null)
                              setLoyaltyPointsToSpend(0)
                            }}
                            className="text-gray-500 hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {loyaltyConfig?.is_active && maxLoyaltyPoints > 0 && (
                          <div className="flex items-center gap-2">
                            <Star className="h-3 w-3 text-amber-400 shrink-0" />
                            <input
                              type="number"
                              min={0}
                              max={maxLoyaltyPoints}
                              value={loyaltyPointsToSpend || ''}
                              onChange={(e) =>
                                setLoyaltyPointsToSpend(
                                  Math.max(0, Math.min(maxLoyaltyPoints, parseInt(e.target.value) || 0)),
                                )
                              }
                              placeholder={`Баллы (макс: ${maxLoyaltyPoints})`}
                              className="w-full rounded-lg bg-white/10 border border-white/20 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Discount panel ─────────────────────────────────────────── */}
              <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowDiscountPanel((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/5 transition-colors"
                >
                  <Tag className="h-4 w-4 text-purple-400 shrink-0" />
                  <span className="text-gray-300 flex-1 text-left">
                    {selectedDiscount
                      ? selectedDiscount.name
                      : manualDiscountPercent > 0
                        ? `Скидка ${manualDiscountPercent}%`
                        : 'Скидка'}
                  </span>
                  {discountAmount > 0 && (
                    <span className="text-xs text-red-400">−{fmt(discountAmount)} ₸</span>
                  )}
                  <span className="text-gray-500 text-xs">{showDiscountPanel ? '▲' : '▼'}</span>
                </button>

                {showDiscountPanel && (
                  <div className="border-t border-white/10 p-3 space-y-3">
                    {/* Manual percent */}
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Ручная скидка (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={manualDiscountPercent || ''}
                        onChange={(e) => {
                          setManualDiscountPercent(
                            Math.max(0, Math.min(99, parseInt(e.target.value) || 0)),
                          )
                          setSelectedDiscount(null)
                        }}
                        placeholder="0"
                        className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>

                    {/* Promo code */}
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Промокод</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="Введите код..."
                          className="flex-1 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <button
                          onClick={applyPromoCode}
                          className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium hover:bg-purple-700 transition-colors"
                        >
                          ОК
                        </button>
                      </div>
                    </div>

                    {/* Predefined discounts */}
                    {bootstrapData && bootstrapData.discounts.length > 0 && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Акции</label>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {bootstrapData.discounts
                            .filter((d) => d.type !== 'promo_code')
                            .map((d) => (
                              <button
                                key={d.id}
                                onClick={() => {
                                  setSelectedDiscount(selectedDiscount?.id === d.id ? null : d)
                                  setManualDiscountPercent(0)
                                }}
                                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                                  selectedDiscount?.id === d.id
                                    ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                                    : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
                                }`}
                              >
                                <span>{d.name}</span>
                                <span className="text-purple-400">
                                  {d.type === 'percent'
                                    ? `${d.value}%`
                                    : `${fmt(d.value)} ₸`}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    {(selectedDiscount || manualDiscountPercent > 0) && (
                      <button
                        onClick={() => {
                          setSelectedDiscount(null)
                          setManualDiscountPercent(0)
                          setPromoCode('')
                        }}
                        className="w-full rounded-lg bg-red-600/20 border border-red-500/30 py-1.5 text-xs text-red-400 hover:bg-red-600/30 transition-colors"
                      >
                        Убрать скидку
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ── Payment method ─────────────────────────────────────────── */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Способ оплаты</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'kaspi', 'card', 'mixed'] as PaymentMethod[]).map((method) => {
                    const labels: Record<PaymentMethod, string> = {
                      cash: '💵 Наличные',
                      kaspi: '📱 Kaspi',
                      card: '💳 Карта',
                      online: '🔗 Онлайн',
                      mixed: '🔀 Смешанная',
                    }
                    return (
                      <button
                        key={method}
                        onClick={() => {
                          setPaymentMethod(method)
                          if (method !== 'mixed') {
                            setMixedAmounts({ cash: 0, kaspi: 0, card: 0, online: 0 })
                          }
                        }}
                        className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
                          paymentMethod === method
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                        }`}
                      >
                        {labels[method]}
                      </button>
                    )
                  })}
                </div>

                {/* Mixed payment inputs */}
                {paymentMethod === 'mixed' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(['cash', 'kaspi', 'card', 'online'] as const).map((method) => {
                      const labels = { cash: 'Наличные', kaspi: 'Kaspi', card: 'Карта', online: 'Онлайн' }
                      return (
                        <div key={method}>
                          <label className="text-[10px] text-gray-500">{labels[method]}</label>
                          <input
                            type="number"
                            min={0}
                            value={mixedAmounts[method] || ''}
                            onChange={(e) =>
                              setMixedAmounts((prev) => ({
                                ...prev,
                                [method]: Math.max(0, parseFloat(e.target.value) || 0),
                              }))
                            }
                            placeholder="0"
                            className="mt-0.5 w-full rounded-lg bg-white/10 border border-white/20 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── Error ────────────────────────────────────────────────────── */}
              {saleError && (
                <div className="rounded-xl bg-red-600/20 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                  {saleError}
                </div>
              )}

              {/* ── Submit button ─────────────────────────────────────────── */}
              <button
                onClick={handleSubmitSale}
                disabled={submitting || cart.length === 0 || !selectedCompanyId || !selectedLocationId}
                className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Проводим...
                  </span>
                ) : (
                  `✅ ПРОВЕСТИ — ${fmt(totalAmount)} ₸`
                )}
              </button>

              {/* Keyboard shortcuts hint */}
              <div className="text-xs text-gray-400 flex gap-3 mt-1 px-1 flex-wrap">
                <span>F9 — оплатить</span>
                <span>Esc — поиск</span>
                <span>F3 — клиент</span>
                <span>F4 — скидка</span>
                <span>F8 — очистить</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Receipt modal ─────────────────────────────────────────────────── */}
      {showReceipt && receiptData && (
        <ReceiptModal
          receiptData={receiptData}
          items={bootstrapData?.items || []}
          cartItems={receiptCartSnapshot}
          company={receiptCompany}
          location={receiptLocation}
          customer={receiptCustomer}
          discountLabel={receiptDiscountLabel}
          onClose={() => setShowReceipt(false)}
          onNewSale={handleNewSale}
        />
      )}
    </div>
  )
}
