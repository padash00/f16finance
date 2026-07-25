'use client'

/**
 * Веб-касса ОПЕРАТОРА (роле-зависимая часть /pos).
 *
 * Тонкий клиент над операторским контуром `/api/operator/*` (та же смена и
 * `point_sales`, что и десктоп). Логика:
 *  1. Нет открытой смены → экран «Открой смену» (старт кассы). Без смены не продаём.
 *  2. Смена открыта → касса с карточками (как в десктопе). Закрытие смены — тут же.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ClipboardCheck,
  Loader2,
  LockKeyhole,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react'

// ─── Типы ──────────────────────────────────────────────────────────────────

type OpenShift = {
  id: string
  company_id: string
  shift_type: 'day' | 'night' | 'custom' | null
  opened_at: string | null
  opening_cash: number | null
  operator?: { id: string; full_name: string | null; short_name: string | null } | null
} | null

type PosItem = {
  id: string
  name: string
  barcode: string | null
  unit: string | null
  sale_price: number
  item_type?: string | null
  image_url?: string | null
  display_qty: number
  category?: { id: string; name: string } | null
}

type CatalogData = {
  company: { id: string; name: string; code: string | null }
  location: { id: string; name: string } | null
  items: PosItem[]
  loyalty_config: unknown
}

type CartLine = {
  id: string
  item_id: string | null
  name: string
  unit: string | null
  quantity: number
  unit_price: number
}

type PaymentMethod = 'cash' | 'kaspi' | 'mixed'

type WebCustomer = { id: string; name: string; phone: string | null; card_number: string | null; loyalty_points: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}
function localRef() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type ReceiptSnapshot = {
  saleId: string | null
  soldAt: string
  companyName: string
  shiftType: 'day' | 'night'
  payment: PaymentMethod
  cash: number
  kaspi: number
  subtotal: number
  discount: number
  total: number
  customerName: string | null
  items: Array<{ name: string; quantity: number; unit_price: number; unit: string | null }>
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function printReceipt(r: ReceiptSnapshot) {
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) return
  const dt = new Date(r.soldAt)
  const date = dt.toLocaleDateString('ru-RU')
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const change = r.payment === 'cash' && r.cash > r.total ? r.cash - r.total : 0
  const rows = r.items
    .map(
      (l) => `<tr><td>${escapeHtml(l.name)}</td><td style="text-align:center">${l.quantity}</td><td style="text-align:right">${fmt(l.unit_price)}</td><td style="text-align:right">${fmt(l.unit_price * l.quantity)}</td></tr>`,
    )
    .join('')
  const payLabel = r.payment === 'cash' ? 'Наличные' : r.payment === 'kaspi' ? 'Безналичный' : 'Смешанная'
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Чек</title>
    <style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:13px;color:#000;padding:6px}
    .c{text-align:center}.t{font-weight:800;font-size:18px}.line{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse;font-size:12px}td{padding:2px 0;vertical-align:top}
    .row{display:flex;justify-content:space-between;font-size:13px}.tot{font-weight:800;font-size:16px}</style></head>
    <body>
    <div class="c"><div class="t">ORDA POINT</div><div>${escapeHtml(r.companyName)}</div>
    <div style="font-size:11px;color:#444">${date} ${time} · ${r.shiftType === 'night' ? 'Ночь' : 'День'}${r.saleId ? ' · #' + r.saleId.slice(-6) : ''}</div></div>
    <div class="line"></div>
    <table><tr style="font-size:11px;color:#444"><td>Товар</td><td style="text-align:center">Кол</td><td style="text-align:right">Цена</td><td style="text-align:right">Сумма</td></tr>${rows}</table>
    <div class="line"></div>
    ${r.discount > 0 ? `<div class="row"><span>Подытог</span><span>${fmt(r.subtotal)} ₸</span></div><div class="row"><span>Скидка</span><span>−${fmt(r.discount)} ₸</span></div>` : ''}
    <div class="row tot"><span>К оплате</span><span>${fmt(r.total)} ₸</span></div>
    <div class="row"><span>${payLabel}</span><span>${fmt(r.total)} ₸</span></div>
    ${r.payment === 'mixed' ? `<div class="row" style="font-size:12px;color:#444"><span>↳ Наличные</span><span>${fmt(r.cash)} ₸</span></div><div class="row" style="font-size:12px;color:#444"><span>↳ Безнал</span><span>${fmt(r.kaspi)} ₸</span></div>` : ''}
    ${change > 0 ? `<div class="row"><span>Сдача</span><span>${fmt(change)} ₸</span></div>` : ''}
    ${r.customerName ? `<div style="font-size:12px;margin-top:6px">Клиент: ${escapeHtml(r.customerName)}</div>` : ''}
    <div class="line"></div>
    <div class="c" style="font-size:13px;font-weight:700;margin-top:6px">СПАСИБО ЗА ПОКУПКУ!</div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`)
  w.document.close()
}

// Чековый сменный отчёт (80мм) — печать при закрытии смены и повторно.
function printShiftReport(r: any) {
  const w = window.open('', '_blank', 'width=380,height=720')
  if (!w) return
  const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const money = (n: number) => `${fmt(Math.round(Number(n || 0)))} ₸`
  const req = r.requisites || {}
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Сменный отчёт</title>
    <style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:13px;color:#000;padding:6px}
    .c{text-align:center}.t{font-weight:800;font-size:16px}.line{border-top:1px dashed #000;margin:6px 0}
    .row{display:flex;justify-content:space-between;font-size:13px;gap:8px}.mut{font-size:11px;color:#444}
    .sec{font-weight:700;font-size:12px;margin:4px 0 2px}.tot{font-weight:800;font-size:16px}</style></head>
    <body>
    <div class="c">
      ${req.name ? `<div class="t">${escapeHtml(req.name)}</div>` : `<div class="t">${escapeHtml(r.pointName || 'ORDA POINT')}</div>`}
      ${req.bin ? `<div class="mut">БИН/ИИН ${escapeHtml(req.bin)}</div>` : ''}
      ${req.address ? `<div class="mut">${escapeHtml(req.address)}</div>` : ''}
      ${r.pointName ? `<div class="mut">Точка: ${escapeHtml(r.pointName)}</div>` : ''}
      <div style="font-weight:800;margin-top:6px">СМЕННЫЙ ОТЧЁТ</div>
    </div>
    <div class="line"></div>
    <div class="row"><span>Смена №</span><span>${r.shiftNumber}</span></div>
    <div class="row"><span>Кассир</span><span>${escapeHtml(r.cashier || '—')}</span></div>
    <div class="row mut"><span>Открыта</span><span>${dt(r.openedAt)}</span></div>
    <div class="row mut"><span>Закрыта</span><span>${dt(r.closedAt)}</span></div>
    <div class="line"></div>
    <div class="sec">ПРОДАЖИ</div>
    <div class="row"><span>Наличные · ${r.cashCount} чек</span><span>${money(r.cashSales)}</span></div>
    <div class="row"><span>Безнал · ${r.kaspiCount} чек</span><span>${money(r.kaspiSales)}</span></div>
    <div class="row"><span>Возвраты</span><span>${money(r.returns)}</span></div>
    <div class="line"></div>
    <div class="sec">НАЛИЧНОСТЬ</div>
    <div class="row"><span>На начало</span><span>${money(r.openingCash)}</span></div>
    <div class="row"><span>На конец</span><span>${money(r.closingCash)}</span></div>
    <div class="line"></div>
    <div class="row"><span>Чеков за смену</span><span>${r.checkCount}</span></div>
    <div class="row tot"><span>ИТОГО ВЫРУЧКА</span><span>${money(r.total)}</span></div>
    <div class="line"></div>
    <div class="c mut">Напечатано: ${new Date().toLocaleString('ru-RU')}</div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`)
  w.document.close()
}

// ─── Component ────────────────────────────────────────────────────────────────

type OwnerCompany = { id: string; name: string }

export default function OperatorPos({
  initialShift = null,
  mode = 'operator',
  companies = [],
  companyId = '',
  onCompanyChange,
}: {
  initialShift?: OpenShift
  mode?: 'operator' | 'owner'
  companies?: OwnerCompany[]
  companyId?: string
  onCompanyChange?: (id: string) => void
}) {
  const router = useRouter()
  const isOwner = mode === 'owner'
  // URL-хвост для админских (владельческих) эндпоинтов
  const cq = isOwner && companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''
  const shiftUrl = isOwner ? `/api/admin/pos/shift${cq}` : '/api/operator/shift/current'
  const catalogUrl = isOwner ? `/api/admin/pos/inventory-sales${cq}` : '/api/operator/inventory-sales'
  const [shift, setShift] = useState<OpenShift>(initialShift)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftReport, setShiftReport] = useState<any | null>(null) // чековый отчёт после закрытия

  // Открытие смены
  const [openingCash, setOpeningCash] = useState('')
  const [shiftType, setShiftType] = useState<'day' | 'night'>(() => {
    const h = new Date().getHours()
    return h >= 8 && h < 20 ? 'day' : 'night'
  })
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  // Каталог
  const [catalog, setCatalog] = useState<CatalogData | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  // Продажа
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [mixedKaspi, setMixedKaspi] = useState('')
  const [discountPct, setDiscountPct] = useState('')
  const [customer, setCustomer] = useState<WebCustomer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<WebCustomer[]>([])
  const [pointsToSpend, setPointsToSpend] = useState(0)
  const [showCustomer, setShowCustomer] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<ReceiptSnapshot | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)
  const saleRefKey = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Универсальный товар
  const [uniName, setUniName] = useState('')
  const [uniPrice, setUniPrice] = useState('')
  const [showUniversal, setShowUniversal] = useState(false)

  // Закрытие смены
  const [showClose, setShowClose] = useState(false)
  const [closeCash, setCloseCash] = useState('')
  const [closeKaspi, setCloseKaspi] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  // ── Загрузка смены ───────────────────────────────────────────────────────
  const reloadShift = useCallback(async () => {
    if (isOwner && !companyId) { setShift(null); return }
    setShiftLoading(true)
    try {
      const res = await fetch(shiftUrl)
      const j = await res.json().catch(() => ({}))
      setShift((j?.shift as OpenShift) || null)
    } catch {
      /* оставляем как есть */
    } finally {
      setShiftLoading(false)
    }
  }, [shiftUrl, isOwner, companyId])

  // Владелец сменил точку → подтянуть её смену
  useEffect(() => {
    if (isOwner) void reloadShift()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── Загрузка каталога (когда смена открыта) ──────────────────────────────
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const res = await fetch(catalogUrl)
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setCatalog(j.data as CatalogData)
    } catch (e: any) {
      setCatalogError(e?.message || 'Не удалось загрузить каталог')
    } finally {
      setCatalogLoading(false)
    }
  }, [catalogUrl])

  useEffect(() => {
    if (shift?.id) void loadCatalog()
  }, [shift?.id, loadCatalog])

  useEffect(() => {
    if (shift?.id) setTimeout(() => searchRef.current?.focus(), 100)
  }, [shift?.id])

  // Поиск клиента (debounced)
  useEffect(() => {
    const q = customerSearch.trim()
    if (q.length < 2) { setCustomerResults([]); return }
    const t = setTimeout(async () => {
      try {
        const url = isOwner
          ? `/api/admin/customers?company_id=${encodeURIComponent(companyId)}&search=${encodeURIComponent(q)}`
          : `/api/operator/customers?search=${encodeURIComponent(q)}`
        const res = await fetch(url)
        const j = await res.json().catch(() => ({}))
        setCustomerResults((j?.data || []) as WebCustomer[])
      } catch {
        setCustomerResults([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch, isOwner, companyId])

  // ── Derived ──────────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const it of catalog?.items || []) s.add(it.category?.name || 'Без категории')
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [catalog?.items])

  const gridItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (catalog?.items || [])
      .filter((it) => category === 'all' || (it.category?.name || 'Без категории') === category)
      .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.barcode || '').includes(q))
      .sort((a, b) => {
        const av = a.display_qty > 0 ? 1 : 0
        const bv = b.display_qty > 0 ? 1 : 0
        if (av !== bv) return bv - av
        return a.name.localeCompare(b.name, 'ru')
      })
  }, [catalog?.items, category, search])

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unit_price, 0), [cart])
  const discountAmount = useMemo(() => {
    const p = Math.max(0, Math.min(99, parseFloat(discountPct) || 0))
    return Math.round((subtotal * p) / 100 * 100) / 100
  }, [subtotal, discountPct])
  const afterDiscount = Math.max(0, subtotal - discountAmount)
  const loyalty = (catalog?.loyalty_config as any) || null
  const tengePerPoint = Number(loyalty?.tenge_per_point || 1) || 1
  const maxRedeemable = useMemo(() => {
    if (!customer || !loyalty?.is_active) return 0
    const maxPct = Number(loyalty?.max_redeem_percent ?? loyalty?.max_redeem_percent_per_purchase ?? 50)
    const maxTenge = Math.floor((afterDiscount * maxPct) / 100)
    const byPoints = tengePerPoint > 0 ? Math.floor(maxTenge / tengePerPoint) : 0
    return Math.min(Number(customer.loyalty_points || 0), byPoints)
  }, [customer, loyalty, afterDiscount, tengePerPoint])
  const loyaltyDiscount = Math.min(Math.max(0, pointsToSpend) * tengePerPoint, afterDiscount)
  const payable = Math.max(0, afterDiscount - loyaltyDiscount)

  // ── Cart actions ───────────────────────────────────────────────────────────
  const addItem = useCallback((item: PosItem) => {
    if (item.display_qty <= 0) return
    setCart((prev) => {
      const ex = prev.find((l) => l.item_id === item.id)
      if (ex) {
        if (ex.quantity + 1 > item.display_qty) return prev
        return prev.map((l) => (l.item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, { id: localRef(), item_id: item.id, name: item.name, unit: item.unit, quantity: 1, unit_price: item.sale_price }]
    })
  }, [])

  const changeQty = useCallback((id: string, next: number) => {
    setCart((prev) => {
      if (next <= 0) return prev.filter((l) => l.id !== id)
      return prev.map((l) => (l.id === id ? { ...l, quantity: next } : l))
    })
  }, [])

  const removeLine = useCallback((id: string) => setCart((prev) => prev.filter((l) => l.id !== id)), [])

  const addUniversal = () => {
    const price = Math.max(0, parseFloat(uniPrice) || 0)
    const name = uniName.trim()
    if (!name || price <= 0) return
    setCart((prev) => [...prev, { id: localRef(), item_id: null, name, unit: 'шт', quantity: 1, unit_price: price }])
    setUniName('')
    setUniPrice('')
    setShowUniversal(false)
  }

  // Скан по штрихкоду в поле поиска
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const q = search.trim()
    if (!q) return
    const byBarcode = (catalog?.items || []).find((it) => it.barcode === q && it.display_qty > 0)
    if (byBarcode) {
      addItem(byBarcode)
      setSearch('')
    } else if (gridItems.length === 1) {
      addItem(gridItems[0])
      setSearch('')
    }
  }

  // ── Открытие смены ─────────────────────────────────────────────────────────
  async function handleOpenShift() {
    setOpenError(null)
    if (openingCash.trim() === '') {
      setOpenError('Укажите старт кассы. Если мелочи нет — 0.')
      return
    }
    const cash = Number(openingCash)
    if (!Number.isFinite(cash) || cash < 0) {
      setOpenError('Старт кассы должен быть числом от 0.')
      return
    }
    setOpening(true)
    try {
      const res = await fetch(isOwner ? '/api/admin/pos/shift' : '/api/operator/shift/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isOwner
            ? { action: 'open', company_id: companyId, opening_cash: cash, shift_type: shiftType }
            : { opening_cash: cash, shift_type: shiftType },
        ),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 409 — смена уже открыта: подхватываем её.
        if (res.status === 409 && j?.shift) {
          await reloadShift()
          return
        }
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`)
      }
      await reloadShift()
    } catch (e: any) {
      setOpenError(e?.message || 'Не удалось открыть смену')
    } finally {
      setOpening(false)
    }
  }

  // ── Закрытие смены ─────────────────────────────────────────────────────────
  async function handleCloseShift() {
    setCloseError(null)
    setClosing(true)
    const closingShiftId = shift?.id || null
    try {
      const res = await fetch(isOwner ? '/api/admin/pos/shift' : '/api/operator/shift/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isOwner ? { action: 'close', company_id: companyId } : {}),
          closing_cash: Math.max(0, parseFloat(closeCash) || 0),
          closing_kaspi: Math.max(0, parseFloat(closeKaspi) || 0),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (j?.error === 'point-shift-required-checklists-missing') {
          throw new Error('Перед закрытием завершите обязательные чек-листы.')
        }
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`)
      }
      setShowClose(false)
      setCart([])
      // Чековый сменный отчёт: тянем данные закрытой смены и показываем модалку с печатью.
      if (!isOwner && closingShiftId) {
        try {
          const rr = await fetch(`/api/operator/shift/report?shift_id=${encodeURIComponent(closingShiftId)}`, { cache: 'no-store' })
          const rj = await rr.json().catch(() => null)
          if (rr.ok && rj?.report) setShiftReport(rj.report)
        } catch { /* отчёт не критичен для закрытия */ }
      }
      await reloadShift()
    } catch (e: any) {
      setCloseError(e?.message || 'Не удалось закрыть смену')
    } finally {
      setClosing(false)
    }
  }

  // ── Проведение продажи ───────────────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0) return
    setSaleError(null)

    let cash = 0
    let kaspi = 0
    if (payment === 'cash') cash = payable
    else if (payment === 'kaspi') kaspi = payable
    else {
      cash = Math.max(0, parseFloat(mixedCash) || 0)
      kaspi = Math.max(0, parseFloat(mixedKaspi) || 0)
      if (Math.abs(cash + kaspi - payable) > 0.01) {
        setSaleError(`Сумма наличных и безнала должна равняться ${fmt(payable)} ₸`)
        return
      }
      if (cash <= 0 || kaspi <= 0) {
        setSaleError('Для смешанной оплаты укажите обе части: наличные и безнал.')
        return
      }
    }

    if (!saleRefKey.current) saleRefKey.current = localRef()
    setSubmitting(true)
    try {
      const res = await fetch(isOwner ? '/api/admin/pos/inventory-sales' : '/api/operator/inventory-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createSale',
          payload: {
            company_id: companyId || null,
            sale_date: new Date().toISOString().slice(0, 10),
            shift: shift?.shift_type === 'night' ? 'night' : 'day',
            payment_method: payment,
            cash_amount: cash,
            kaspi_amount: kaspi,
            kaspi_before_midnight_amount: kaspi,
            kaspi_after_midnight_amount: 0,
            discount_amount: discountAmount,
            customer_id: customer?.id || null,
            loyalty_points_spent: customer ? Math.max(0, Math.min(pointsToSpend, maxRedeemable)) : 0,
            loyalty_discount_amount: loyaltyDiscount,
            comment: comment.trim() || null,
            local_ref: saleRefKey.current,
            items: cart.map((l) => ({
              item_id: l.item_id,
              universal_name: l.item_id ? null : l.name,
              quantity: l.quantity,
              unit_price: l.unit_price,
            })),
          },
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${res.status}`)
      saleRefKey.current = null
      const data = j.data || {}
      setLastReceipt({
        saleId: data.sale_id || null,
        soldAt: data.sold_at || new Date().toISOString(),
        companyName: catalog?.company?.name || '',
        shiftType: shift?.shift_type === 'night' ? 'night' : 'day',
        payment,
        cash,
        kaspi,
        subtotal,
        discount: discountAmount,
        total: payable,
        customerName: customer?.name || null,
        items: cart.map((l) => ({ name: l.name, quantity: l.quantity, unit_price: l.unit_price, unit: l.unit })),
      })
      // Сброс и обновление остатков
      setCart([])
      setComment('')
      setPayment('cash')
      setMixedCash('')
      setMixedKaspi('')
      setDiscountPct('')
      setCustomer(null)
      setCustomerSearch('')
      setCustomerResults([])
      setPointsToSpend(0)
      setShowCustomer(false)
      await loadCatalog()
      setTimeout(() => searchRef.current?.focus(), 100)
    } catch (e: any) {
      setSaleError(e?.message || 'Не удалось провести продажу')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render (владелец): точка не выбрана → экран выбора точки ─────────────
  if (isOwner && !companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4 text-white">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
          <div className="mb-5 text-center">
            <h1 className="text-lg font-bold">Выберите точку</h1>
            <p className="mt-1 text-sm text-gray-400">Касса владельца. Выберите точку, чтобы войти в смену.</p>
          </div>
          <div className="space-y-2">
            {companies.length === 0 && <p className="text-center text-sm text-gray-500">Нет доступных точек</p>}
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => onCompanyChange?.(c.id)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left text-sm font-medium transition hover:border-emerald-500 hover:bg-white/10"
              >
                {c.name}
              </button>
            ))}
          </div>
          <button onClick={() => router.push('/dashboard')} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm text-gray-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Выйти
          </button>
        </div>
      </div>
    )
  }

  // ── Render: нет открытой смены → экран открытия ──────────────────────────
  if (!shift?.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4 text-white">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600/20 text-emerald-400">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h1 className="text-lg font-bold">Открытие смены</h1>
            <p className="mt-1 text-sm text-gray-400">Продавать можно только при открытой смене. Укажите старт кассы.</p>
          </div>

          {isOwner && companies.length > 0 && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-gray-400">Точка</label>
              <select
                value={companyId}
                onChange={(e) => onCompanyChange?.(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-2">
            {(['day', 'night'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setShiftType(t)}
                className={`rounded-xl border py-2.5 text-sm font-medium transition ${
                  shiftType === t ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {t === 'day' ? '☀️ День' : '🌙 Ночь'}
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs text-gray-400">Старт кассы (₸)</label>
          <input
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="mb-3 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-lg font-semibold tabular-nums outline-none focus:ring-2 focus:ring-emerald-500"
          />

          {openError && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-600/20 px-3 py-2 text-xs text-red-300">{openError}</div>
          )}

          <button
            onClick={handleOpenShift}
            disabled={opening}
            className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {opening ? 'Открываем…' : 'Открыть смену'}
          </button>

          <button
            onClick={() => router.push('/dashboard')}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Выйти
          </button>
        </div>
      </div>
    )
  }

  // ── Render: смена открыта → касса ──────────────────────────────────────────
  const openedTime = shift.opened_at
    ? new Date(shift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-gray-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-emerald-400" />
          <div className="leading-tight">
            {isOwner && companies.length > 0 ? (
              <select
                value={companyId}
                onChange={(e) => onCompanyChange?.(e.target.value)}
                className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-semibold">{catalog?.company?.name || 'Касса'}</p>
            )}
            <p className="text-[11px] text-gray-400">
              {isOwner ? 'Касса владельца · ' : ''}Смена {shift.shift_type === 'night' ? 'ночь' : 'день'}{openedTime ? ` · с ${openedTime}` : ''}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => loadCatalog()} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white" title="Обновить">
            <RefreshCw className={`h-4 w-4 ${catalogLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setShowClose(true); setCloseError(null) }}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20"
          >
            <ClipboardCheck className="h-4 w-4" /> Закрыть смену
          </button>
          <button onClick={() => router.push('/dashboard')} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white" title="Выход">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: products */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-white/10">
          {/* Search */}
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Поиск или штрихкод (Enter)"
                  className="w-full rounded-xl border border-white/20 bg-white/10 py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                onClick={() => setShowUniversal(true)}
                className="rounded-xl border border-white/20 px-4 text-sm font-medium text-gray-200 hover:border-emerald-500 hover:text-emerald-300"
              >
                + Универсальная
              </button>
            </div>
          </div>

          {/* Category tabs */}
          {categories.length > 0 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-3 py-2">
              <button
                onClick={() => setCategory('all')}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${category === 'all' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}
              >
                Все
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${category === c ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {catalogLoading && !catalog ? (
              <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Загрузка…</div>
            ) : catalogError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-600/10 p-4 text-sm text-red-300">{catalogError}</div>
            ) : gridItems.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
                <Search className="h-10 w-10 opacity-30" />
                <p className="text-sm">Товары не найдены</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {gridItems.map((item) => {
                  const disabled = item.display_qty <= 0
                  const inCart = cart.find((l) => l.item_id === item.id)?.quantity || 0
                  return (
                    <button
                      key={item.id}
                      onClick={() => addItem(item)}
                      disabled={disabled}
                      className={`relative flex flex-col overflow-hidden rounded-xl border text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                        inCart > 0 ? 'border-emerald-500/60 ring-1 ring-emerald-500/30' : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div className="relative h-36 w-full overflow-hidden bg-white/5 sm:h-40">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-3xl font-black text-white/15">{item.name.slice(0, 1).toUpperCase()}</div>
                        )}
                        <span className={`absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${disabled ? 'bg-red-600/80' : 'bg-black/60'} text-white`}>
                          {disabled ? 'Нет' : item.display_qty}
                        </span>
                        {inCart > 0 && (
                          <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-xs font-bold">{inCart}</span>
                        )}
                      </div>
                      <div className="flex flex-col p-2">
                        <p className="line-clamp-2 min-h-[2rem] text-xs font-medium leading-snug">{item.name}</p>
                        <p className="pt-1 text-sm font-bold text-emerald-400">{fmt(item.sale_price)} ₸</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: cart */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden bg-gray-900 lg:w-96">
          <div className="shrink-0 border-b border-white/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-gray-400">К оплате</div>
            <div className="mt-1 text-4xl font-bold text-emerald-400">{fmt(payable)} <span className="text-lg text-emerald-400/60">₸</span></div>
            {discountAmount > 0 && (
              <div className="text-xs text-gray-400">Подытог {fmt(subtotal)} ₸ · скидка −{fmt(discountAmount)} ₸</div>
            )}
            <div className="text-xs text-gray-500">{cart.length} поз · {cart.reduce((s, l) => s + l.quantity, 0)} шт</div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-600">
                <ShoppingCart className="h-10 w-10 opacity-30" />
                <p className="text-sm">Нажмите на товар</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.name}</p>
                      <p className="text-[11px] text-gray-400">{fmt(l.unit_price)} ₸{l.unit ? ` / ${l.unit}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg bg-white/10">
                      <button onClick={() => changeQty(l.id, l.quantity - 1)} className="grid h-8 w-8 place-items-center hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="min-w-[1.75rem] text-center text-sm font-semibold">{l.quantity}</span>
                      <button onClick={() => changeQty(l.id, l.quantity + 1)} className="grid h-8 w-8 place-items-center hover:bg-white/10"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <span className="w-16 text-right text-sm font-semibold">{fmt(l.unit_price * l.quantity)}</span>
                    <button onClick={() => removeLine(l.id)} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cart.length > 0 && (
            <div className="shrink-0 space-y-2 border-t border-white/10 p-3">
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'kaspi', 'mixed'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayment(m)}
                    className={`rounded-xl py-2.5 text-xs font-medium transition ${payment === m ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}
                  >
                    {m === 'cash' ? '💵 Наличные' : m === 'kaspi' ? '📱 Безнал' : '🔀 Смешанная'}
                  </button>
                ))}
              </div>
              {payment === 'mixed' && (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-2">
                  <label className="block">
                    <span className="text-[11px] text-gray-400">Наличными</span>
                    <input
                      value={mixedCash}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') { setMixedCash(''); setMixedKaspi(String(payable)); return }
                        const c = Math.max(0, Math.min(payable, parseFloat(raw) || 0))
                        setMixedCash(String(c))
                        setMixedKaspi(String(Math.max(0, payable - c)))
                      }}
                      inputMode="numeric"
                      placeholder="0"
                      className="mt-0.5 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-400">Безнал</span>
                    <input
                      value={mixedKaspi}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') { setMixedKaspi(''); setMixedCash(String(payable)); return }
                        const k = Math.max(0, Math.min(payable, parseFloat(raw) || 0))
                        setMixedKaspi(String(k))
                        setMixedCash(String(Math.max(0, payable - k)))
                      }}
                      inputMode="numeric"
                      placeholder="0"
                      className="mt-0.5 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </label>
                </div>
              )}
              {/* Клиент + лояльность */}
              <div className="rounded-xl border border-white/10 bg-white/5">
                <button
                  type="button"
                  onClick={() => setShowCustomer((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="flex-1 text-left text-gray-300">{customer ? customer.name : 'Клиент'}</span>
                  {customer && <span className="text-xs text-amber-400">⭐ {customer.loyalty_points}</span>}
                  <span className="text-xs text-gray-500">{showCustomer ? '▲' : '▼'}</span>
                </button>
                {showCustomer && (
                  <div className="space-y-2 border-t border-white/10 p-2">
                    {customer ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{customer.name} · ⭐ {customer.loyalty_points}</span>
                          <button type="button" onClick={() => { setCustomer(null); setPointsToSpend(0) }} className="text-gray-500 hover:text-red-400">убрать</button>
                        </div>
                        {loyalty?.is_active && maxRedeemable > 0 && (
                          <input
                            type="number"
                            min={0}
                            max={maxRedeemable}
                            value={pointsToSpend || ''}
                            onChange={(e) => setPointsToSpend(Math.max(0, Math.min(maxRedeemable, parseInt(e.target.value) || 0)))}
                            placeholder={`Списать баллы (макс ${maxRedeemable})`}
                            className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        )}
                        {loyaltyDiscount > 0 && <div className="text-xs text-amber-300">Баллами −{fmt(loyaltyDiscount)} ₸</div>}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="Имя, телефон или карта"
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {customerResults.length > 0 && (
                          <div className="max-h-40 overflow-auto rounded-lg border border-white/10">
                            {customerResults.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { setCustomer(c); setCustomerResults([]); setCustomerSearch('') }}
                                className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-white/10"
                              >
                                <span className="truncate">{c.name}{c.phone ? ` · ${c.phone}` : ''}</span>
                                <span className="shrink-0 text-amber-400">⭐ {c.loyalty_points}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">Скидка&nbsp;%</span>
                <input
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  className="w-20 rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {discountAmount > 0 && <span className="text-xs text-emerald-300">−{fmt(discountAmount)} ₸</span>}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Комментарий (необязательно)"
                className="w-full rounded-xl border border-white/20 bg-white/10 p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {saleError && <div className="rounded-xl border border-red-500/30 bg-red-600/20 px-3 py-2 text-xs text-red-300">{saleError}</div>}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? 'Проводим…' : `Оплатить · ${fmt(payable)} ₸`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Universal product modal */}
      {showUniversal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setShowUniversal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-gray-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">Универсальный товар</h3>
              <button onClick={() => setShowUniversal(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <input value={uniName} onChange={(e) => setUniName(e.target.value)} placeholder="Название" className="mb-2 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <input value={uniPrice} onChange={(e) => setUniPrice(e.target.value)} inputMode="numeric" placeholder="Цена, ₸" className="mb-4 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <button onClick={addUniversal} className="w-full rounded-xl bg-emerald-600 py-3 font-semibold hover:bg-emerald-700">Добавить в чек</button>
          </div>
        </div>
      )}

      {/* Close shift modal */}
      {showClose && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => !closing && setShowClose(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-gray-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">Закрытие смены</h3>
              <button onClick={() => setShowClose(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-1 block text-xs text-gray-400">Наличные в кассе (₸)</label>
            <input value={closeCash} onChange={(e) => setCloseCash(e.target.value)} inputMode="numeric" placeholder="0" className="mb-3 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <label className="mb-1 block text-xs text-gray-400">Безналичный за смену (₸)</label>
            <input value={closeKaspi} onChange={(e) => setCloseKaspi(e.target.value)} inputMode="numeric" placeholder="0" className="mb-4 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            {closeError && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-600/20 px-3 py-2 text-xs text-red-300">{closeError}</div>}
            <button onClick={handleCloseShift} disabled={closing} className="w-full rounded-xl bg-amber-600 py-3 font-semibold hover:bg-amber-700 disabled:opacity-50">
              {closing ? 'Закрываем…' : 'Закрыть смену'}
            </button>
          </div>
        </div>
      )}

      {/* Receipt modal after successful sale */}
      {lastReceipt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-gray-900">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <p className="font-semibold text-emerald-400">Оплата проведена</p>
                <p className="text-xs text-gray-400">{lastReceipt.saleId ? `Чек #${lastReceipt.saleId.slice(-6)} · ` : ''}{fmt(lastReceipt.total)} ₸</p>
              </div>
              <button onClick={() => setLastReceipt(null)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm">
              <div className="space-y-1">
                {lastReceipt.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2 text-gray-200">
                    <span className="truncate">{it.name} × {it.quantity}</span>
                    <span className="shrink-0 tabular-nums">{fmt(it.unit_price * it.quantity)} ₸</span>
                  </div>
                ))}
              </div>
              {lastReceipt.discount > 0 && (
                <div className="mt-2 flex justify-between text-xs text-gray-400"><span>Скидка</span><span>−{fmt(lastReceipt.discount)} ₸</span></div>
              )}
              <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-base font-bold text-emerald-400"><span>Итого</span><span>{fmt(lastReceipt.total)} ₸</span></div>
            </div>
            <div className="flex gap-2 border-t border-white/10 p-3">
              <button onClick={() => printReceipt(lastReceipt)} className="flex-1 rounded-xl border border-white/20 py-3 text-sm font-medium text-gray-200 hover:bg-white/10">🖨 Печать</button>
              <button onClick={() => setLastReceipt(null)} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold hover:bg-emerald-700">Новая продажа</button>
            </div>
          </div>
        </div>
      )}

      {/* Чековый сменный отчёт — после закрытия смены */}
      {shiftReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-900">
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <span className="text-sm font-semibold text-white">Сменный отчёт</span>
              <span className="text-xs text-gray-400">Смена №{shiftReport.shiftNumber}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm text-gray-200">
              <div className="text-center">
                <div className="font-bold text-white">{shiftReport.requisites?.name || shiftReport.pointName || 'ORDA POINT'}</div>
                {shiftReport.requisites?.bin ? <div className="text-[11px] text-gray-400">БИН/ИИН {shiftReport.requisites.bin}</div> : null}
                <div className="mt-1 text-[11px] text-gray-400">Кассир: {shiftReport.cashier}</div>
              </div>
              <div className="my-3 border-t border-dashed border-white/15" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-400">ПРОДАЖИ</div>
                <div className="flex justify-between"><span>Наличные · {shiftReport.cashCount} чек</span><span>{fmt(Math.round(shiftReport.cashSales))} ₸</span></div>
                <div className="flex justify-between"><span>Безнал · {shiftReport.kaspiCount} чек</span><span>{fmt(Math.round(shiftReport.kaspiSales))} ₸</span></div>
                <div className="flex justify-between"><span>Возвраты</span><span>{fmt(Math.round(shiftReport.returns))} ₸</span></div>
              </div>
              <div className="my-3 border-t border-dashed border-white/15" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-400">НАЛИЧНОСТЬ</div>
                <div className="flex justify-between"><span>На начало</span><span>{fmt(Math.round(shiftReport.openingCash))} ₸</span></div>
                <div className="flex justify-between"><span>На конец</span><span>{fmt(Math.round(shiftReport.closingCash))} ₸</span></div>
              </div>
              <div className="my-3 border-t border-dashed border-white/15" />
              <div className="flex justify-between text-xs text-gray-400"><span>Чеков за смену</span><span>{shiftReport.checkCount}</span></div>
              <div className="mt-1 flex justify-between text-base font-bold text-emerald-400"><span>Итого выручка</span><span>{fmt(Math.round(shiftReport.total))} ₸</span></div>
            </div>
            <div className="flex gap-2 border-t border-white/10 p-3">
              <button onClick={() => printShiftReport(shiftReport)} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700">🖨 Печать</button>
              <button onClick={() => setShiftReport(null)} className="flex-1 rounded-xl border border-white/20 py-3 text-sm font-medium text-gray-200 hover:bg-white/10">Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
