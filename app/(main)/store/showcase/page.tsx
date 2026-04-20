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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ─── Types ────────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; code: string | null }
type ShowcaseLocation = { id: string; name: string } | null
type WarehouseLocation = { id: string; name: string } | null

type BalanceItem = {
  item_id: string
  quantity: number           // showcase qty = catalog - warehouse
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

  useEffect(() => { void load() }, [])

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="rounded-3xl border border-blue-500/20 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.15),transparent_36%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.96))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
              <Store className="h-3.5 w-3.5" />
              Витрина точки
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              {showcase ? showcase.name : 'Витрина'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Товары на витрине вашей точки. Запросите пополнение со склада — менеджер одобрит и товар появится автоматически.
            </p>
            {warehouse && (
              <p className="mt-1 text-xs text-slate-500">Склад: {warehouse.name}</p>
            )}
          </div>

          <div className="flex flex-wrap items-start gap-2">
            {/* Company selector */}
            {companies.length > 1 && (
              <div className="relative">
                <select
                  value={selectedCompanyId || ''}
                  onChange={(e) => { setSelectedCompanyId(e.target.value); void load(e.target.value) }}
                  className="appearance-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 pr-8 text-sm text-foreground outline-none focus:border-blue-400/50"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => { setShowRequestPanel(!showRequestPanel); setShowReturnPanel(false) }}>
              <ClipboardList className="h-3.5 w-3.5" />
              Запросить со склада
            </Button>
            {balances.length > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 border-amber-500/30 text-amber-300 hover:bg-amber-500/10" onClick={() => { setShowReturnPanel(!showReturnPanel); setShowRequestPanel(false) }}>
                <Trash2 className="h-3.5 w-3.5" />
                Вернуть на склад
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Позиций</p>
            <p className="mt-1.5 text-2xl font-semibold">{balances.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Ед. товара</p>
            <p className="mt-1.5 text-2xl font-semibold">{balances.reduce((s, b) => s + Number(b.quantity || 0), 0)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Заявок в работе</p>
            <p className={`mt-1.5 text-2xl font-semibold ${newRequestsCount > 0 ? 'text-amber-400' : ''}`}>{newRequestsCount}</p>
          </div>
        </div>

        {sendSuccess && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Заявка отправлена — менеджер получил уведомление
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        {/* LEFT: showcase stock */}
        <div className="space-y-5">
          <Card className="border-white/10 bg-card/70">
            <CardHeader className="border-b border-white/10 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-blue-300" />
                Остатки на витрине
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !showcase ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Store className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Витрина не активирована для этой точки</p>
                  <p className="text-xs">Обратитесь к администратору для подключения магазина</p>
                </div>
              ) : error ? (
                <div className="flex h-40 items-center justify-center gap-2 text-rose-400">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">{error}</span>
                </div>
              ) : balances.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ShoppingBag className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Витрина пустая</p>
                  <p className="text-xs">Запросите товар со склада</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {balances.map((b) => {
                    const qty = Number(b.quantity)
                    const threshold = b.item?.low_stock_threshold ?? null
                    const isLow = threshold !== null ? qty <= threshold : qty <= 0
                    const isZero = qty <= 0
                    const qtyColor = isZero ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400'
                    const rowBg = isLow && !isZero ? 'bg-amber-500/[0.04]' : isZero ? 'bg-rose-500/[0.04]' : ''
                    return (
                      <div key={b.item_id} className={`flex items-center justify-between px-4 py-3 ${rowBg}`}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{b.item?.name || 'Товар'}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {b.item?.barcode || ''}
                            {b.item?.category ? ` · ${b.item.category.name}` : ''}
                          </p>
                          {isLow && !isZero && threshold !== null && (
                            <p className="text-[10px] text-amber-400">⚠ мало (мин: {threshold})</p>
                          )}
                        </div>
                        <div className="ml-3 shrink-0 flex gap-3 text-right">
                          <div>
                            <p className="text-[10px] text-muted-foreground">каталог</p>
                            <p className="text-sm font-semibold text-foreground">{b.catalog_quantity}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">склад</p>
                            <p className="text-sm font-semibold text-amber-300">{b.warehouse_quantity}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">витрина</p>
                            <p className={`text-sm font-semibold ${qtyColor}`}>{b.quantity}</p>
                          </div>
                          <div className="self-end pb-0.5">
                            <p className="text-[10px] text-muted-foreground">{b.item?.unit || 'шт'}</p>
                            {b.item?.sale_price ? (
                              <p className="text-[10px] text-muted-foreground">{b.item.sale_price} ₸</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
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
            <CardContent className="divide-y divide-white/[0.06] p-0">
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
                pendingRequests.map((req) => (
                  <div key={req.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{formatDate(req.created_at)}</span>
                      <Badge variant={statusVariant(req.status)} className="text-[10px]">
                        {statusLabel(req.status)}
                      </Badge>
                    </div>
                    {req.comment && <p className="mt-1 text-xs text-muted-foreground">{req.comment}</p>}
                    <div className="mt-2 space-y-0.5">
                      {req.items.slice(0, 4).map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="truncate">{item.item?.name || 'Товар'}</span>
                          <span className="ml-2 shrink-0 font-mono">
                            {item.requested_qty}
                            {item.approved_qty !== null ? ` → ${item.approved_qty}` : ''}
                          </span>
                        </div>
                      ))}
                      {req.items.length > 4 && (
                        <p className="text-[10px] text-muted-foreground">+{req.items.length - 4} ещё</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: request panel */}
        {showRequestPanel && (
          <Card className="border-blue-500/20 bg-card/70">
            <CardHeader className="border-b border-white/10 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ClipboardList className="h-4 w-4 text-blue-300" />
                  Заявка на пополнение
                </CardTitle>
                <button onClick={() => setShowRequestPanel(false)} className="text-muted-foreground hover:text-foreground">
                  ✕
                </button>
              </div>
              {warehouse && (
                <p className="mt-1 text-[11px] text-muted-foreground">Со склада: {warehouse.name}</p>
              )}
            </CardHeader>
            <CardContent className="p-4">
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
                                Каталог: <span className="font-medium text-foreground">{bal.catalog_quantity}</span>
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
            </CardContent>
          </Card>
        )}

        {/* Return to warehouse panel */}
        {showReturnPanel && (
          <Card className="border-amber-500/20 bg-card/70">
            <CardHeader className="border-b border-white/10 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Trash2 className="h-4 w-4 text-amber-300" />
                  Возврат на склад
                </CardTitle>
                <button onClick={() => setShowReturnPanel(false)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Товары спишутся с витрины и добавятся на склад</p>
            </CardHeader>
            <CardContent className="p-4">
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
