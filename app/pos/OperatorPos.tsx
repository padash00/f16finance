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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}
function localRef() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    if (payment === 'cash') cash = subtotal
    else if (payment === 'kaspi') kaspi = subtotal
    else {
      cash = Math.min(subtotal, Math.max(0, parseFloat(mixedCash) || 0))
      kaspi = Math.max(0, subtotal - cash)
      if (cash <= 0 || kaspi <= 0) {
        setSaleError('Для смешанной оплаты укажите часть наличными, остальное уйдёт в Безналичный.')
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
      // Сброс и обновление остатков
      setCart([])
      setComment('')
      setPayment('cash')
      setMixedCash('')
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
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
                      <div className="relative aspect-square w-full bg-white/5">
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
                      <div className="flex flex-1 flex-col p-2">
                        <p className="line-clamp-2 text-xs font-medium leading-snug">{item.name}</p>
                        <p className="mt-auto pt-1 text-sm font-bold text-emerald-400">{fmt(item.sale_price)} ₸</p>
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
            <div className="mt-1 text-4xl font-bold text-emerald-400">{fmt(subtotal)} <span className="text-lg text-emerald-400/60">₸</span></div>
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
                <input
                  value={mixedCash}
                  onChange={(e) => setMixedCash(e.target.value)}
                  inputMode="numeric"
                  placeholder="Наличными, остальное — безнал"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              )}
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
                {submitting ? 'Проводим…' : `Оплатить · ${fmt(subtotal)} ₸`}
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
    </div>
  )
}
