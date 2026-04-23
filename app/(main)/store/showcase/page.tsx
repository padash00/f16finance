'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Loader2,
  MoreHorizontal,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShowcasePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [showcase, setShowcase] = useState<ShowcaseLocation>(null)
  const [warehouse, setWarehouse] = useState<WarehouseLocation>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
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

  // Return to warehouse panel
  const [showReturnPanel, setShowReturnPanel] = useState(false)
  const [returnLines, setReturnLines] = useState<RequestLine[]>([{ item_id: '', requested_qty: '' }])
  const [returnComment, setReturnComment] = useState('')
  const [returning, setReturning] = useState(false)
  const [returnSuccess, setReturnSuccess] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async (companyId?: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const id = companyId ?? selectedCompanyId
      const url = id ? `/api/admin/store/showcase?company_id=${id}` : '/api/admin/store/showcase'
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
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
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const companyId = params.get('company_id')
      void load(companyId)
    } catch {
      void load()
    }
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

  // ─── Render ───────────────────────────────────────────────────────────────────

  const newRequestsCount = pendingRequests.filter((r) => r.status === 'new').length
  const totalShowcaseQty = balances.reduce((s, b) => s + Number(b.quantity || 0), 0)

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
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
            <Store className="h-5 w-5 text-blue-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {showcase ? showcase.name : 'Витрина'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {warehouse ? `Склад: ${warehouse.name}` : 'Склад не настроен'}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {companies.length > 1 && (
            <div className="relative">
              <select
                value={selectedCompanyId || ''}
                onChange={(e) => { setSelectedCompanyId(e.target.value); void load(e.target.value) }}
                className="h-9 appearance-none rounded-lg border border-white/10 bg-white/[0.04] pl-3 pr-8 text-sm text-foreground outline-none focus:border-blue-400/50"
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
            className="h-9 gap-1.5 bg-blue-600 hover:bg-blue-700"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Запросить со склада
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Позиций</p>
          <p className="mt-1 text-xl font-semibold">{balances.length}</p>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Ед. товара на витрине</p>
          <p className="mt-1 text-xl font-semibold text-blue-200">{totalShowcaseQty}</p>
        </Card>
        <Card className={`p-3 ${newRequestsCount > 0 ? 'border-amber-500/20 bg-amber-500/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
          <p className={`text-[10px] uppercase tracking-widest ${newRequestsCount > 0 ? 'text-amber-300/70' : 'text-muted-foreground'}`}>Заявок в работе</p>
          <p className={`mt-1 text-xl font-semibold ${newRequestsCount > 0 ? 'text-amber-300' : ''}`}>{newRequestsCount}</p>
        </Card>
      </div>

      {sendSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
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
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 pl-4 pr-2 font-normal">Товар</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Штрихкод</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Категория</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Итого</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal text-amber-300/70">Подсобка</th>
                  <th className="w-24 py-2.5 px-2 text-right font-normal text-blue-300/70">Витрина</th>
                  <th className="w-24 py-2.5 px-2 pr-4 text-right font-normal">Цена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredBalances.map((b) => {
                  const qty = Number(b.quantity)
                  const threshold = b.item?.low_stock_threshold ?? null
                  const isLow = threshold !== null ? qty <= threshold : qty <= 0
                  const isZero = qty <= 0
                  const qtyColor = isZero ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-blue-300'
                  const rowBg = isLow && !isZero ? 'bg-amber-500/[0.03]' : isZero ? 'bg-rose-500/[0.03]' : ''
                  return (
                    <tr key={b.item_id} className={`transition hover:bg-white/[0.02] ${rowBg}`}>
                      <td className="min-w-0 max-w-0 py-2.5 pl-4 pr-2 align-middle">
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
                        <span className="text-sm font-semibold text-amber-300">{b.warehouse_quantity}</span>
                      </td>
                      <td className="w-24 py-2.5 px-2 text-right align-middle">
                        <span className={`text-sm font-semibold ${qtyColor}`}>{b.quantity}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">{b.item?.unit || 'шт'}</span>
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

      {/* Request history */}
      <Card className="border-white/10 bg-card/70">
        <CardHeader className="border-b border-white/10 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="h-4 w-4 text-violet-300" />
              История заявок
            </CardTitle>
            <Link
              href="/store/requests"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-violet-300 transition-colors"
            >
              Все заявки
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted-foreground">
              <ClipboardList className="h-5 w-5 opacity-30" />
              <p className="text-xs">Заявок пока нет</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
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
          <SheetHeader className="border-b border-white/10 p-5">
            <SheetTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-300" />
              Заявка на пополнение
            </SheetTitle>
            <SheetDescription>
              {warehouse ? `Со склада: ${warehouse.name}` : 'Склад не настроен — обратитесь к администратору'}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
              {!warehouse ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  Склад для этой точки не настроен. Сначала добавьте товары на склад.
                </div>
              ) : (
                <form onSubmit={handleSendRequest} className="space-y-3">
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {requestLines.map((line, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Товар</Label>
                          <select
                            value={line.item_id}
                            onChange={(e) => setLineItem(idx, e.target.value)}
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-400/50"
                          >
                            <option value="">Выберите товар</option>
                            {warehouseItems.map((wi) => (
                              <option key={wi.item_id} value={wi.item_id}>
                                {wi.item?.name || wi.item_id} · {wi.quantity} {wi.item?.unit || 'шт'} на складе
                              </option>
                            ))}
                          </select>
                          {line.item_id && (() => {
                            const bal = balances.find((b) => b.item_id === line.item_id)
                            return bal ? (
                              <p className="text-[10px] text-muted-foreground">
                                Итого: <span className="font-medium text-foreground">{bal.catalog_quantity}</span>
                                {' · '}Склад: <span className="font-medium text-amber-300">{bal.warehouse_quantity}</span>
                                {' · '}Витрина: <span className="font-medium text-blue-300">{bal.quantity}</span>
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
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 hover:bg-white/[0.06]"
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
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 hover:bg-white/[0.06]"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
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
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-blue-400/50"
                    />
                  </div>

                  {sendError && <p className="text-xs text-rose-400">{sendError}</p>}

                  <Button type="submit" disabled={sending} className="w-full gap-2">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                    Отправить заявку
                  </Button>
                </form>
              )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Return Sheet */}
      <Sheet open={showReturnPanel} onOpenChange={setShowReturnPanel}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-white/10 p-5">
            <SheetTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-amber-300" />
              Возврат на склад
            </SheetTitle>
            <SheetDescription>
              Товары спишутся с витрины и добавятся на склад.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
              {balances.length === 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  Витрина пустая — нечего возвращать.
                </div>
              ) : (
                <form onSubmit={handleReturn} className="space-y-3">
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {returnLines.map((line, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Товар</Label>
                          <select
                            value={line.item_id}
                            onChange={(e) => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, item_id: e.target.value } : l))}
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-amber-400/50"
                          >
                            <option value="">Выберите товар</option>
                            {balances.filter((b) => Number(b.quantity) > 0).map((b) => (
                              <option key={b.item_id} value={b.item_id}>
                                {b.item?.name || b.item_id} · {b.quantity} {b.item?.unit || 'шт'} на витрине
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="space-y-1 flex-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Количество</Label>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: String(Math.max(0, parseQty(l.requested_qty) - 1)) } : l))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 hover:bg-white/[0.06]">
                                <Minus className="h-3 w-3" />
                              </button>
                              <Input value={line.requested_qty} onChange={(e) => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: e.target.value } : l))} placeholder="0" className="h-7 text-xs text-center flex-1" />
                              <button type="button" onClick={() => setReturnLines((prev) => prev.map((l, i) => i === idx ? { ...l, requested_qty: String(parseQty(l.requested_qty) + 1) } : l))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 hover:bg-white/[0.06]">
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
