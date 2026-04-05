'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, RotateCcw, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SaleItem = {
  id: string
  item_id: string
  quantity: number
  unit_price: number
  total_price: number
  inventory_items: { name: string } | null
}

type Sale = {
  id: string
  sale_date: string
  sold_at: string | null
  total_amount: number
  payment_method: string | null
  cash_amount: number
  kaspi_amount: number
  card_amount: number
  online_amount: number
  items: SaleItem[]
}

type ReturnItem = {
  item_id: string
  quantity: number
  unit_price: number
  name: string
  maxQty: number
  selected: boolean
}

type ReturnResult = {
  return_id: string
  return_amount: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase()
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PosReturnsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [sale, setSale] = useState<Sale | null>(null)
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [reason, setReason] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<ReturnResult | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return

    setSearching(true)
    setSearchError(null)
    setSale(null)
    setReturnItems([])
    setResult(null)
    setSubmitError(null)

    try {
      const params = new URLSearchParams()
      // If looks like a full UUID, use sale_id; otherwise short_id
      if (q.length === 36 && q.includes('-')) {
        params.set('sale_id', q)
      } else {
        params.set('short_id', q)
      }

      const res = await fetch(`/api/pos/return?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка поиска')

      const foundSale: Sale = json.data
      setSale(foundSale)

      // Build return items list
      const items: ReturnItem[] = (foundSale.items || []).map((item) => ({
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        name: item.inventory_items?.name || item.item_id,
        maxQty: item.quantity,
        selected: false,
      }))
      setReturnItems(items)
    } catch (err: any) {
      setSearchError(err?.message || 'Не удалось найти чек')
    } finally {
      setSearching(false)
    }
  }

  function toggleItem(index: number) {
    setReturnItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    )
  }

  function updateQty(index: number, value: string) {
    const qty = parseInt(value, 10)
    if (isNaN(qty) || qty < 1) return
    setReturnItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, quantity: Math.min(qty, item.maxQty) } : item
      )
    )
  }

  const selectedItems = returnItems.filter((item) => item.selected)
  const returnTotal = selectedItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sale) return
    if (selectedItems.length === 0) {
      setSubmitError('Выберите хотя бы один товар для возврата')
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/pos/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: sale.id,
          items: selectedItems.map((item) => ({
            item_id: item.item_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
          })),
          reason: reason.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка оформления возврата')

      setResult(json.data)
    } catch (err: any) {
      setSubmitError(err?.message || 'Ошибка возврата')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    setSearchQuery('')
    setSale(null)
    setReturnItems([])
    setReason('')
    setResult(null)
    setSearchError(null)
    setSubmitError(null)
  }

  return (
    <div className="app-page">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-amber-400" />
            Возврат товара
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Оформление возврата по чеку
          </p>
        </div>
        {(sale || result) && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Новый возврат
          </Button>
        )}
      </div>

      {/* Success Result */}
      {result && (
        <Card className="mb-6 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <CheckCircle className="h-8 w-8 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-bold text-emerald-400">Возврат оформлен</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Номер возврата:{' '}
                  <span className="font-mono text-foreground">
                    {result.return_id.slice(-12).toUpperCase()}
                  </span>
                </p>
                <p className="mt-2 text-xl font-bold">
                  Сумма возврата: {formatMoney(result.return_amount)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Товары возвращены на склад
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {!result && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Поиск чека</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Введите номер чека (последние 6 символов)"
                  className="pl-10"
                  disabled={searching}
                />
              </div>
              <Button type="submit" disabled={searching || !searchQuery.trim()}>
                {searching ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Найти чек
              </Button>
            </form>

            {searchError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {searchError}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sale Info + Return Form */}
      {sale && !result && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Original Sale Info */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Чек</CardTitle>
                <Badge variant="outline" className="font-mono">
                  #{shortId(sale.id)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm mb-4">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Дата</p>
                  <p className="mt-1 font-medium">
                    {formatDate(sale.sold_at || sale.sale_date)}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Сумма чека</p>
                  <p className="mt-1 font-bold text-emerald-400">
                    {formatMoney(sale.total_amount)}
                  </p>
                </div>
                {sale.cash_amount > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs text-muted-foreground">Наличные</p>
                    <p className="mt-1 font-medium">{formatMoney(sale.cash_amount)}</p>
                  </div>
                )}
                {sale.kaspi_amount > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs text-muted-foreground">Kaspi</p>
                    <p className="mt-1 font-medium">{formatMoney(sale.kaspi_amount)}</p>
                  </div>
                )}
                {sale.card_amount > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs text-muted-foreground">Карта</p>
                    <p className="mt-1 font-medium">{formatMoney(sale.card_amount)}</p>
                  </div>
                )}
                {sale.online_amount > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs text-muted-foreground">Онлайн</p>
                    <p className="mt-1 font-medium">{formatMoney(sale.online_amount)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Выберите товары для возврата
              </CardTitle>
            </CardHeader>
            <CardContent>
              {returnItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Нет товаров в чеке
                </p>
              ) : (
                <div className="space-y-2">
                  {returnItems.map((item, index) => (
                    <div
                      key={item.item_id}
                      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${
                        item.selected
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                      }`}
                      onClick={() => toggleItem(index)}
                    >
                      {/* Checkbox visual */}
                      <div
                        className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                          item.selected
                            ? 'border-amber-400 bg-amber-400'
                            : 'border-white/30'
                        }`}
                      >
                        {item.selected && (
                          <svg
                            className="h-3 w-3 text-black"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>

                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(item.unit_price)} × {item.maxQty} шт. = {formatMoney(item.unit_price * item.maxQty)}
                        </p>
                      </div>

                      {/* Quantity input */}
                      {item.selected && (
                        <div
                          className="flex items-center gap-2 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs text-muted-foreground">Кол-во:</span>
                          <Input
                            type="number"
                            min={1}
                            max={item.maxQty}
                            value={item.quantity}
                            onChange={(e) => updateQty(index, e.target.value)}
                            className="w-20 h-8 text-center"
                          />
                          <span className="text-xs text-muted-foreground">
                            / {item.maxQty}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reason + Summary */}
          {selectedItems.length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Причина возврата (необязательно)
                  </label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Укажите причину возврата..."
                    rows={3}
                  />
                </div>

                {/* Return summary */}
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-sm text-muted-foreground mb-1">
                    Товаров к возврату: {selectedItems.length}
                  </p>
                  <p className="text-xl font-bold text-amber-400">
                    Сумма возврата: {formatMoney(returnTotal)}
                  </p>
                </div>

                {submitError && (
                  <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {submitError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full"
                  size="lg"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Оформление...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Оформить возврат
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </form>
      )}
    </div>
  )
}
