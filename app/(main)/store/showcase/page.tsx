'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Loader2,
  MoreHorizontal,
  Minus,
  Package,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TableSkeleton } from '@/components/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Search } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useStoreScope } from '@/components/store/store-scope'
import { LabelPrintDialog } from '@/components/store/label-print-dialog'
import type { LabelItem } from '@/components/store/label-print-dialog'
import { isAbortError } from '@/lib/is-abort-error'

// ─── Types ────────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; code: string | null }
type ShowcaseLocation = { id: string; name: string } | null
type WarehouseLocation = { id: string; name: string } | null

type BalanceItem = {
  item_id: string
  quantity: number
  catalog_quantity: number
  warehouse_quantity: number
  item: {
    id: string
    name: string
    barcode: string
    unit: string
    sale_price: number
    default_purchase_price: number
    low_stock_threshold: number | null
    category: { id: string; name: string } | null
  } | null
}

type WarehouseItem = {
  item_id: string
  quantity: number
  item: { id: string; name: string; barcode: string; unit: string } | null
}

type PendingRequest = {
  id: string
  status: string
  created_at: string
  comment: string | null
  items: Array<{
    id: string
    item_id: string
    requested_qty: number
    approved_qty: number | null
    item: { id: string; name: string } | null
  }>
}

type RequestLine = {
  item_id: string
  requested_qty: string
}

function parseQty(v: string) {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function statusLabel(s: string) {
  if (s === 'approved_full') return 'Одобрена'
  if (s === 'approved_partial') return 'Одобрена частично'
  if (s === 'rejected') return 'Отклонена'
  return 'На рассмотрении'
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'approved_full' || s === 'approved_partial') return 'default'
  if (s === 'rejected') return 'destructive'
  return 'secondary'
}

function formatDate(s: string) {
  try { return new Date(s).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

// ─── Пикер товара с поиском по названию/штрихкоду ────────────────────────────
// Работает со сканером: полный штрихкод + Enter выбирает товар сразу.

type PickerOption = { id: string; name: string; barcode: string; hint: string }

function ItemSearchPicker({
  options,
  value,
  onSelect,
  placeholder,
}: {
  options: PickerOption[]
  value: string
  onSelect: (id: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const selected = options.find((o) => o.id === value) || null

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{selected.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {selected.barcode || 'без штрихкода'} · {selected.hint}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 text-[10px] text-muted-foreground underline transition hover:text-foreground"
          onClick={() => { onSelect(''); setQuery('') }}
        >
          изменить
        </button>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = (q
    ? options.filter((o) => o.name.toLowerCase().includes(q) || o.barcode.includes(q))
    : options
  ).slice(0, 20)

  const pickByBarcode = () => {
    const raw = query.trim()
    if (!raw) return
    const exact = options.find((o) => o.barcode && o.barcode === raw)
    if (exact) { onSelect(exact.id); setQuery(''); return }
    if (matches.length === 1) { onSelect(matches[0].id); setQuery('') }
  }

  return (
    <div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder || 'Название или штрихкод (сканер работает)'}
        className="h-8 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            pickByBarcode()
          }
        }}
      />
      {q.length > 0 && (
        <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-border bg-background shadow-sm">
          {matches.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-white/5"
              onClick={() => { onSelect(o.id); setQuery('') }}
            >
              <span className="min-w-0 truncate text-xs text-foreground">{o.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{o.barcode || '—'} · {o.hint}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">Ничего не найдено</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShowcasePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const { storeCompanyId } = useStoreScope()
  const [showcase, setShowcase] = useState<ShowcaseLocation>(null)
  const [warehouse, setWarehouse] = useState<WarehouseLocation>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPrintLabels, setShowPrintLabels] = useState(false)
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([])
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Request panel
  const [showRequestPanel, setShowRequestPanel] = useState(false)
  const [requestLines, setRequestLines] = useState<RequestLine[]>([{ item_id: '', requested_qty: '' }])
  const [requestComment, setRequestComment] = useState('')
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [stockSearch, setStockSearch] = useState('')

  // Инлайн-правка остатка витрины (карандашик, как «Подсобка» на складе)
  const [editingSc, setEditingSc] = useState<string | null>(null)
  const [editScVal, setEditScVal] = useState('')
  const [savingSc, setSavingSc] = useState(false)

  // Return to warehouse panel
  const [showReturnPanel, setShowReturnPanel] = useState(false)
  const [returnLines, setReturnLines] = useState<RequestLine[]>([{ item_id: '', requested_qty: '' }])
  const [returnComment, setReturnComment] = useState('')
  const [returning, setReturning] = useState(false)
  const [returnSuccess, setReturnSuccess] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async (companyId?: string | null, signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const id = companyId ?? selectedCompanyId
      const url = id ? `/api/admin/store/showcase?company_id=${id}` : '/api/admin/store/showcase'
      const res = await fetch(url, { cache: 'no-store', signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка загрузки')
      const d = json.data
      setCompanies(d.companies || [])
      setSelectedCompanyId(d.selectedCompanyId)
      setShowcase(d.showcase)
      setWarehouse(d.warehouse)
      setBalances(d.balances || [])
      setWarehouseItems(d.warehouseItems || [])
      setPendingRequests(d.pendingRequests || [])
    } catch (e: any) {
      if (isAbortError(e) || signal?.aborted) return
      setError(e?.message || 'Ошибка')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => {
    const ac = new AbortController()
    try {
      const params = new URLSearchParams(window.location.search)
      const companyId = params.get('company_id')
      void load(companyId, ac.signal)
    } catch {
      void load(undefined, ac.signal)
    }
    return () => ac.abort()
    // initial load + read company from URL; do not re-run when load/company changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Request form ─────────────────────────────────────────────────────────────

  function setLineQty(idx: number, qty: string) {
    setRequestLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: qty } : l))
  }
  function setLineItem(idx: number, itemId: string) {
    setRequestLines((prev) => prev.map((l, i) => i === idx ? { ...l, item_id: itemId } : l))
  }
  function addRequestLine() {
    setRequestLines((prev) => [...prev, { item_id: '', requested_qty: '' }])
  }
  function removeRequestLine(idx: number) {
    setRequestLines((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSendRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCompanyId) return
    setSending(true)
    setSendError(null)
    setSendSuccess(false)

    const items = requestLines
      .map((l) => ({ item_id: l.item_id, requested_qty: parseQty(l.requested_qty) }))
      .filter((l) => l.item_id && l.requested_qty > 0)

    if (items.length === 0) {
      setSendError('Добавьте хотя бы одну позицию')
      setSending(false)
      return
    }

    try {
      const res = await fetch('/api/admin/store/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createRequest',
          company_id: selectedCompanyId,
          comment: requestComment.trim() || null,
          items,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка отправки')

      setSendSuccess(true)
      setRequestLines([{ item_id: '', requested_qty: '' }])
      setRequestComment('')
      setShowRequestPanel(false)
      await load(selectedCompanyId)
      setTimeout(() => setSendSuccess(false), 3000)
    } catch (err: any) {
      setSendError(err?.message || 'Ошибка')
    } finally {
      setSending(false)
    }
  }

  async function handleReturn(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCompanyId) return
    setReturning(true)
    setReturnError(null)
    setReturnSuccess(false)

    const items = returnLines
      .map((l) => ({ item_id: l.item_id, quantity: parseQty(l.requested_qty) }))
      .filter((l) => l.item_id && l.quantity > 0)

    if (items.length === 0) {
      setReturnError('Добавьте хотя бы одну позицию')
      setReturning(false)
      return
    }

    try {
      const res = await fetch('/api/admin/store/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'returnToWarehouse',
          company_id: selectedCompanyId,
          comment: returnComment.trim() || null,
          items,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка возврата')

      setReturnSuccess(true)
      setReturnLines([{ item_id: '', requested_qty: '' }])
      setReturnComment('')
      setShowReturnPanel(false)
      await load(selectedCompanyId)
      setTimeout(() => setReturnSuccess(false), 3000)
    } catch (err: any) {
      setReturnError(err?.message || 'Ошибка')
    } finally {
      setReturning(false)
    }
  }

  async function handleSetShowcase(itemId: string) {
    if (!selectedCompanyId) return
    const qty = parseQty(editScVal)
    setSavingSc(true)
    try {
      const res = await fetch('/api/admin/store/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setShowcase',
          company_id: selectedCompanyId,
          item_id: itemId,
          quantity: qty,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        alert(json?.error || 'Ошибка сохранения')
        return
      }
      setEditingSc(null)
      setEditScVal('')
      await load(selectedCompanyId)
    } finally {
      setSavingSc(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const newRequestsCount = pendingRequests.filter((r) => r.status === 'new').length
  const totalShowcaseQty = balances.reduce((s, b) => s + Number(b.quantity || 0), 0)
  const totalPurchase = balances.reduce((s, b) => s + Number(b.quantity || 0) * Number(b.item?.default_purchase_price || 0), 0)
  const totalSale = balances.reduce((s, b) => s + Number(b.quantity || 0) * Number(b.item?.sale_price || 0), 0)
  const fmtMoney = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

  const filteredBalances = balances.filter((b) => {
    if (!stockSearch.trim()) return true
    const q = stockSearch.toLowerCase()
    return (
      b.item?.name?.toLowerCase().includes(q) ||
      b.item?.barcode?.toLowerCase().includes(q)
    )
  })

  return (
    <TooltipProvider delayDuration={200}>
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {/* Header */}
      {(() => {
        const hdrActions = (
          <>
            {companies.length > 1 && !storeCompanyId && (
              <div className="relative">
                <select
                  value={selectedCompanyId || ''}
                  onChange={(e) => { setSelectedCompanyId(e.target.value); void load(e.target.value) }}
                  className="h-9 appearance-none rounded-lg border border-border bg-white dark:bg-white/[0.04] pl-3 pr-8 text-sm text-foreground outline-none focus:border-amber-400/50"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
            {selectedIds.size > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowPrintLabels(true)} className="h-9 gap-1.5">
                <Printer className="h-3.5 w-3.5" />
                Ценники ({selectedIds.size})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowReturnPanel(true); setShowRequestPanel(false) }}
              disabled={balances.length === 0}
              className="h-9 gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Вернуть на склад
            </Button>
            <Button
              size="sm"
              onClick={() => { setShowRequestPanel(true); setShowReturnPanel(false) }}
              className="h-9 gap-1.5 bg-amber-600 hover:bg-amber-700"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Запросить со склада
            </Button>
          </>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-end gap-2">{hdrActions}</div>
        ) : (
          <AdminPageHeader
            title={showcase ? showcase.name : 'Витрина'}
            description={warehouse ? `Склад: ${warehouse.name}` : 'Склад не настроен'}
            icon={<Store className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={hdrActions}
          />
        )
      })()}

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-border bg-white dark:bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Позиций</p>
          <p className="mt-1 text-xl font-semibold">{balances.length}</p>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">Ед. товара на витрине</p>
          <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-200">{totalShowcaseQty}</p>
        </Card>
        <Card className={`p-3 ${newRequestsCount > 0 ? 'border-amber-500/20 bg-amber-500/[0.05]' : 'border-border bg-white dark:bg-white/[0.03]'}`}>
          <p className={`text-[10px] uppercase tracking-widest ${newRequestsCount > 0 ? 'text-amber-700 dark:text-amber-300/70' : 'text-muted-foreground'}`}>Заявок в работе</p>
          <p className={`mt-1 text-xl font-semibold ${newRequestsCount > 0 ? 'text-amber-700 dark:text-amber-300' : ''}`}>{newRequestsCount}</p>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-300/70">Стоимость (закуп / продажа)</p>
          <p className="mt-1 truncate text-sm font-semibold text-amber-700 dark:text-amber-200" title={`${fmtMoney(totalPurchase)} / ${fmtMoney(totalSale)} ₸`}>
            {fmtMoney(totalPurchase)} / {fmtMoney(totalSale)} ₸
          </p>
        </Card>
      </div>

      {sendSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Заявка отправлена — менеджер получил уведомление
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={stockSearch}
            onChange={(e) => setStockSearch(e.target.value)}
            placeholder="Поиск по названию или штрихкоду..."
            className="h-9 pl-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
              Действия
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Управление витриной</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setShowRequestPanel(true); setShowReturnPanel(false) }}>
              <ClipboardList className="h-3.5 w-3.5" />
              Запросить со склада
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={balances.length === 0}
              onClick={() => { setShowReturnPanel(true); setShowRequestPanel(false) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Вернуть на склад
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-border bg-card/70 p-0">
        {loading && balances.length === 0 ? (
          <div className="p-4">
            <TableSkeleton rows={8} cols={5} />
          </div>
        ) : !showcase ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Store className="h-8 w-8 opacity-30" />
            <p className="text-sm">Витрина не активирована для этой точки</p>
            <p className="text-xs">Обратитесь к администратору</p>
          </div>
        ) : error ? (
          <div className="flex h-60 items-center justify-center gap-2 text-rose-400">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        ) : filteredBalances.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <ShoppingBag className="h-8 w-8 opacity-50" />
            {stockSearch ? 'Ничего не найдено' : 'Витрина пустая — запросите товар со склада'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-380px)] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-slate-200 dark:border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-9 py-2.5 pl-4 pr-1 font-normal">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-amber-500"
                      checked={filteredBalances.length > 0 && filteredBalances.every((b) => selectedIds.has(b.item_id))}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredBalances.map((b) => b.item_id)) : new Set())}
                    />
                  </th>
                  <th className="py-2.5 px-2 font-normal">Товар</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Штрихкод</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Категория</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Итого</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal text-amber-700 dark:text-amber-300/70">Подсобка</th>
                  <th className="w-24 py-2.5 px-2 text-right font-normal text-amber-700 dark:text-amber-300/70">Витрина</th>
                  <th className="w-24 py-2.5 px-2 pr-4 text-right font-normal">Цена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                {filteredBalances.map((b) => {
                  const qty = Number(b.quantity)
                  const threshold = b.item?.low_stock_threshold ?? null
                  const isLow = threshold !== null ? qty <= threshold : qty <= 0
                  const isZero = qty <= 0
                  const qtyColor = isZero ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-amber-700 dark:text-amber-300'
                  const rowBg = isLow && !isZero ? 'bg-amber-500/[0.03]' : isZero ? 'bg-rose-500/[0.03]' : ''
                  return (
                    <tr key={b.item_id} className={`transition hover:bg-slate-50 dark:hover:bg-white/[0.02] ${rowBg}`}>
                      <td className="w-9 py-2.5 pl-4 pr-1 align-middle">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-amber-500"
                          checked={selectedIds.has(b.item_id)}
                          onChange={() => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(b.item_id)) n.delete(b.item_id); else n.add(b.item_id); return n })}
                        />
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="truncate text-sm font-medium">{b.item?.name || 'Товар'}</p>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            {b.item?.name || 'Товар'}
                          </TooltipContent>
                        </Tooltip>
                        {isLow && !isZero && threshold !== null && (
                          <p className="text-[10px] text-amber-400">⚠ мало (мин: {threshold})</p>
                        )}
                      </td>
                      <td className="w-36 py-2.5 px-2 align-middle">
                        <span className="truncate font-mono text-xs text-muted-foreground">{b.item?.barcode || '—'}</span>
                      </td>
                      <td className="w-36 py-2.5 px-2 align-middle">
                        <span className="line-clamp-1 text-xs text-muted-foreground">{b.item?.category?.name || '—'}</span>
                      </td>
                      <td className="w-20 py-2.5 px-2 text-right align-middle">
                        <span className="text-sm font-semibold">{b.catalog_quantity}</span>
                      </td>
                      <td className="w-20 py-2.5 px-2 text-right align-middle">
                        <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{b.warehouse_quantity}</span>
                      </td>
                      <td className="w-24 py-2.5 px-2 text-right align-middle">
                        {editingSc === b.item_id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              value={editScVal}
                              onChange={(e) => setEditScVal(e.target.value)}
                              className="h-7 w-14 px-1 text-center text-xs"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleSetShowcase(b.item_id)
                                if (e.key === 'Escape') { setEditingSc(null); setEditScVal('') }
                              }}
                            />
                            <button
                              onClick={() => void handleSetShowcase(b.item_id)}
                              disabled={savingSc}
                              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50"
                            >
                              {savingSc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              onClick={() => { setEditingSc(null); setEditScVal('') }}
                              className="text-muted-foreground hover:text-rose-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingSc(b.item_id); setEditScVal(String(b.quantity)) }}
                            className={`inline-flex items-center justify-end gap-1 text-sm font-semibold ${qtyColor} hover:opacity-80`}
                          >
                            {b.quantity}
                            <span className="text-[10px] font-normal text-muted-foreground">{b.item?.unit || 'шт'}</span>
                            <Pencil className="h-3 w-3 opacity-40" />
                          </button>
                        )}
                      </td>
                      <td className="w-24 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className="text-xs text-muted-foreground">{b.item?.sale_price ? `${b.item.sale_price} ₸` : '—'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showPrintLabels && (
        <LabelPrintDialog
          items={balances
            .filter((b) => selectedIds.has(b.item_id) && b.item != null)
            .map((b): LabelItem => ({
              item_id: b.item_id,
              name: b.item!.name || 'Товар',
              barcode: b.item!.barcode || '',
              sale_price: b.item!.sale_price ?? null,
              unit: b.item!.unit || 'шт',
            }))}
          onClose={() => setShowPrintLabels(false)}
        />
      )}

      {/* Request history */}
      <Card className="border-border bg-card/70">
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="h-4 w-4 text-amber-700 dark:text-amber-300" />
              История заявок
            </CardTitle>
            <Link
              href="/store/requests"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
            >
              Все заявки
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && pendingRequests.length === 0 ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted-foreground">
              <ClipboardList className="h-5 w-5 opacity-30" />
              <p className="text-xs">Заявок пока нет</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {pendingRequests.map((req) => (
                <div key={req.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{formatDate(req.created_at)}</span>
                    <Badge variant={statusVariant(req.status)} className="text-[10px]">
                      {statusLabel(req.status)}
                    </Badge>
                  </div>
                  {req.comment && <p className="mt-1 text-xs text-muted-foreground">{req.comment}</p>}
                  <div className="mt-2 grid gap-0.5 md:grid-cols-2">
                    {req.items.slice(0, 8).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{item.item?.name || 'Товар'}</span>
                        <span className="shrink-0 font-mono">
                          {item.requested_qty}
                          {item.approved_qty !== null ? ` → ${item.approved_qty}` : ''}
                        </span>
                      </div>
                    ))}
                    {req.items.length > 8 && (
                      <p className="text-[10px] text-muted-foreground">+{req.items.length - 8} ещё</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request Sheet */}
      <Sheet open={showRequestPanel} onOpenChange={setShowRequestPanel}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border p-5">
            <SheetTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              Заявка на пополнение
            </SheetTitle>
            <SheetDescription>
              {warehouse ? `Со склада: ${warehouse.name}` : 'Склад не настроен — обратитесь к администратору'}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
              {!warehouse ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Склад для этой точки не настроен. Сначала добавьте товары на склад.
                </div>
              ) : (
                <form onSubmit={handleSendRequest} className="space-y-3">
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {requestLines.map((line, idx) => (
                      <div key={idx} className="rounded-xl border border-border bg-white dark:bg-white/[0.03] p-2.5 space-y-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Товар</Label>
                          <ItemSearchPicker
                            options={warehouseItems
                              .filter((wi) => wi.item_id === line.item_id || !requestLines.some((l, i) => i !== idx && l.item_id === wi.item_id))
                              .map((wi) => ({
                                id: wi.item_id,
                                name: wi.item?.name || wi.item_id,
                                barcode: wi.item?.barcode || '',
                                hint: `${wi.quantity} ${wi.item?.unit || 'шт'} на складе`,
                              }))}
                            value={line.item_id}
                            onSelect={(id) => setLineItem(idx, id)}
                          />
                          {line.item_id && (() => {
                            const bal = balances.find((b) => b.item_id === line.item_id)
                            return bal ? (
                              <p className="text-[10px] text-muted-foreground">
                                Итого: <span className="font-medium text-foreground">{bal.catalog_quantity}</span>
                                {' · '}Склад: <span className="font-medium text-amber-700 dark:text-amber-300">{bal.warehouse_quantity}</span>
                                {' · '}Витрина: <span className="font-medium text-amber-700 dark:text-amber-300">{bal.quantity}</span>
                              </p>
                            ) : null
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="space-y-1 flex-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Количество</Label>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setLineQty(idx, String(Math.max(0, parseQty(line.requested_qty) - 1)))}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <Input
                                value={line.requested_qty}
                                onChange={(e) => setLineQty(idx, e.target.value)}
                                placeholder="0"
                                className="h-7 text-xs text-center flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => setLineQty(idx, String(parseQty(line.requested_qty) + 1))}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                              {(() => {
                                const wi = warehouseItems.find((w) => w.item_id === line.item_id)
                                return wi && wi.quantity > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setLineQty(idx, String(wi.quantity))}
                                    className="h-7 rounded-lg border border-border px-2 text-[10px] text-muted-foreground transition hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-foreground"
                                    title={`Запросить весь остаток склада: ${wi.quantity}`}
                                  >
                                    макс
                                  </button>
                                ) : null
                              })()}
                            </div>
                            {(() => {
                              const wi = warehouseItems.find((w) => w.item_id === line.item_id)
                              return wi && parseQty(line.requested_qty) > Number(wi.quantity)
                                ? <p className="text-[10px] text-amber-600 dark:text-amber-300">Больше, чем на складе ({wi.quantity}) — заявку могут одобрить частично</p>
                                : null
                            })()}
                          </div>
                          {requestLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeRequestLine(idx)}
                              className="mt-5 text-muted-foreground hover:text-rose-400 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1" onClick={addRequestLine}>
                    <Plus className="h-3.5 w-3.5" />
                    Добавить позицию
                  </Button>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Комментарий</Label>
                    <textarea
                      value={requestComment}
                      onChange={(e) => setRequestComment(e.target.value)}
                      placeholder="Что и зачем нужно..."
                      rows={2}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-amber-400/50"
                    />
                  </div>

                  {sendError && <p className="text-xs text-rose-400">{sendError}</p>}

                  {(() => {
                    const filled = requestLines.filter((l) => l.item_id && parseQty(l.requested_qty) > 0)
                    const totalUnits = filled.reduce((s, l) => s + parseQty(l.requested_qty), 0)
                    return (
                      <>
                        <div className="flex items-center justify-between rounded-lg border border-border bg-slate-50 dark:bg-white/[0.03] px-3 py-2 text-xs">
                          <span className="text-muted-foreground">В заявке</span>
                          <span className="font-medium text-foreground">
                            {filled.length} поз. · {totalUnits.toLocaleString('ru-RU')} ед.
                          </span>
                        </div>
                        <Button type="submit" disabled={sending || filled.length === 0} className="w-full gap-2">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                          Отправить заявку
                        </Button>
                      </>
                    )
                  })()}
                </form>
              )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Return Sheet */}
      <Sheet open={showReturnPanel} onOpenChange={setShowReturnPanel}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border p-5">
            <SheetTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              Возврат на склад
            </SheetTitle>
            <SheetDescription>
              Товары спишутся с витрины и добавятся на склад.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
              {balances.length === 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Витрина пустая — нечего возвращать.
                </div>
              ) : (
                <form onSubmit={handleReturn} className="space-y-3">
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {returnLines.map((line, idx) => (
                      <div key={idx} className="rounded-xl border border-border bg-white dark:bg-white/[0.03] p-2.5 space-y-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Товар</Label>
                          <ItemSearchPicker
                            options={balances
                              .filter((b) => Number(b.quantity) > 0)
                              .filter((b) => b.item_id === line.item_id || !returnLines.some((l, i) => i !== idx && l.item_id === b.item_id))
                              .map((b) => ({
                                id: b.item_id,
                                name: b.item?.name || b.item_id,
                                barcode: b.item?.barcode || '',
                                hint: `${b.quantity} ${b.item?.unit || 'шт'} на витрине`,
                              }))}
                            value={line.item_id}
                            onSelect={(id) => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, item_id: id } : l))}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="space-y-1 flex-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Количество</Label>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: String(Math.max(0, parseQty(l.requested_qty) - 1)) } : l))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:bg-slate-100 dark:hover:bg-white/[0.06]">
                                <Minus className="h-3 w-3" />
                              </button>
                              <Input value={line.requested_qty} onChange={(e) => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: e.target.value } : l))} placeholder="0" className="h-7 text-xs text-center flex-1" />
                              <button type="button" onClick={() => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: String(parseQty(l.requested_qty) + 1) } : l))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:bg-slate-100 dark:hover:bg-white/[0.06]">
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {returnLines.length > 1 && (
                            <button type="button" onClick={() => setReturnLines((prev) => prev.filter((_, i) => i !== idx))} className="mt-5 text-muted-foreground hover:text-rose-400 transition">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1" onClick={() => setReturnLines((prev) => [...prev, { item_id: '', requested_qty: '' }])}>
                    <Plus className="h-3.5 w-3.5" />
                    Добавить позицию
                  </Button>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Комментарий</Label>
                    <textarea value={returnComment} onChange={(e) => setReturnComment(e.target.value)} placeholder="Причина возврата..." rows={2} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-amber-400/50" />
                  </div>

                  {returnError && <p className="text-xs text-rose-400">{returnError}</p>}

                  <Button type="submit" disabled={returning} className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-black">
                    {returning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Вернуть на склад
                  </Button>
                </form>
              )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  )
}
