'use client'
import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer, Search, ChevronLeft, ChevronRight, Receipt, RefreshCw } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; code: string | null }
type Location = { id: string; name: string; company_id: string }

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
  sold_at: string
  payment_method: string | null
  cash_amount: number
  kaspi_amount: number
  card_amount: number
  online_amount: number
  total_amount: number
  discount_amount: number
  loyalty_points_earned: number
  loyalty_points_spent: number
  loyalty_discount_amount: number
  customer_id: string | null
  source: string | null
  comment: string | null
  items: SaleItem[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, { label: string; color: string }> = {
  cash: { label: 'Наличные', color: 'bg-green-100 text-green-800' },
  kaspi: { label: 'Kaspi', color: 'bg-orange-100 text-orange-800' },
  card: { label: 'Карта', color: 'bg-blue-100 text-blue-800' },
  online: { label: 'Онлайн', color: 'bg-purple-100 text-purple-800' },
  mixed: { label: 'Смешанный', color: 'bg-gray-100 text-gray-800' },
}

function fmt(n: number) {
  return Math.round(n).toLocaleString('ru-RU')
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU')
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function detectPaymentMethod(sale: Sale): string {
  if (sale.payment_method) return sale.payment_method
  const nonZero = [
    sale.cash_amount > 0 ? 'cash' : null,
    sale.kaspi_amount > 0 ? 'kaspi' : null,
    sale.card_amount > 0 ? 'card' : null,
    sale.online_amount > 0 ? 'online' : null,
  ].filter(Boolean)
  if (nonZero.length === 0) return 'cash'
  if (nonZero.length === 1) return nonZero[0]!
  return 'mixed'
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function ReceiptDetailModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const method = detectPaymentMethod(sale)
  const pm = PAYMENT_LABELS[method] || PAYMENT_LABELS.mixed

  const paymentBreakdown: { label: string; amount: number }[] = []
  if (sale.cash_amount > 0) paymentBreakdown.push({ label: 'Наличные', amount: sale.cash_amount })
  if (sale.kaspi_amount > 0) paymentBreakdown.push({ label: 'Kaspi', amount: sale.kaspi_amount })
  if (sale.card_amount > 0) paymentBreakdown.push({ label: 'Карта', amount: sale.card_amount })
  if (sale.online_amount > 0) paymentBreakdown.push({ label: 'Онлайн', amount: sale.online_amount })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-400" />
            Чек #{sale.id.slice(-6).toUpperCase()}
          </DialogTitle>
        </DialogHeader>

        {/* Printable receipt area */}
        <div id="receipt-reprint" className="space-y-4 text-sm">
          {/* Date/time */}
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{fmtDate(sale.sold_at)}</span>
            <span>{fmtTime(sale.sold_at)}</span>
          </div>

          {/* Payment badge */}
          <div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${pm.color}`}>
              {pm.label}
            </span>
          </div>

          {/* Items */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Товар</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Кол.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Цена</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item) => (
                  <tr key={item.id} className="border-b border-white/5">
                    <td className="px-3 py-2 font-medium">{item.inventory_items?.name || '—'}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{item.quantity}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{fmt(item.unit_price)} ₸</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(item.total_price)} ₸</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="space-y-1.5">
            {sale.discount_amount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Скидка</span>
                <span className="text-rose-400">−{fmt(sale.discount_amount)} ₸</span>
              </div>
            )}
            {sale.loyalty_discount_amount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Баллы лояльности</span>
                <span className="text-amber-400">−{fmt(sale.loyalty_discount_amount)} ₸</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-white/10 pt-2">
              <span>Итого</span>
              <span className="text-emerald-400">{fmt(sale.total_amount)} ₸</span>
            </div>
          </div>

          {/* Payment breakdown */}
          {paymentBreakdown.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Оплата</p>
              {paymentBreakdown.map((p) => (
                <div key={p.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className="font-medium">{fmt(p.amount)} ₸</span>
                </div>
              ))}
            </div>
          )}

          {/* Loyalty */}
          {(sale.loyalty_points_earned > 0 || sale.loyalty_points_spent > 0) && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
              <p className="text-xs font-medium text-amber-400 mb-1">Бонусная программа</p>
              {sale.loyalty_points_earned > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Начислено баллов</span>
                  <span className="text-amber-400 font-medium">+{sale.loyalty_points_earned}</span>
                </div>
              )}
              {sale.loyalty_points_spent > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Списано баллов</span>
                  <span className="text-amber-400 font-medium">−{sale.loyalty_points_spent}</span>
                </div>
              )}
            </div>
          )}

          {/* Comment */}
          {sale.comment && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-muted-foreground">Комментарий</p>
              <p className="mt-1 text-sm">{sale.comment}</p>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground pt-2 border-t border-white/10">
            ID: {sale.id}
          </div>
        </div>

        {/* Print button */}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Печать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PosReceiptsPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [locationId, setLocationId] = useState('')

  // Companies & locations
  const [companies, setCompanies] = useState<Company[]>([])
  const [locations, setLocations] = useState<Location[]>([])

  // Selected receipt for modal
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  // Load companies & locations on mount
  useEffect(() => {
    async function loadBootstrap() {
      try {
        const res = await fetch('/api/pos/bootstrap')
        const j = await res.json()
        if (j.companies) setCompanies(j.companies)
        if (j.locations) setLocations(j.locations)
      } catch {
        // non-critical, filters just won't be populated
      }
    }
    void loadBootstrap()
  }, [])

  const load = useCallback(async (p: number = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('company_id', companyId)
      if (locationId) params.set('location_id', locationId)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (search) params.set('search', search)
      params.set('page', String(p))

      const res = await fetch(`/api/pos/receipts?${params.toString()}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка загрузки')
      setSales(j.data || [])
      setTotal(j.total || 0)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить чеки')
    } finally {
      setLoading(false)
    }
  }, [companyId, locationId, dateFrom, dateTo, search, page])

  useEffect(() => {
    void load(page)
  }, [load, page])

  function handleSearch() {
    setPage(1)
    void load(1)
  }

  const filteredLocations = companyId
    ? locations.filter((l) => l.company_id === companyId)
    : locations

  return (
    <>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #receipt-reprint { display: block !important; position: static !important; }
          #receipt-reprint * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
        }
      `}</style>

      <div className="app-page">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-6 w-6 text-emerald-400" />
              История чеков
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Просмотр и повторная печать чеков POS</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load(page)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              {/* Date from */}
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs text-muted-foreground">Дата от</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {/* Date to */}
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs text-muted-foreground">Дата до</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {/* Company */}
              {companies.length > 0 && (
                <div className="flex flex-col gap-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground">Компания</label>
                  <select
                    value={companyId}
                    onChange={(e) => { setCompanyId(e.target.value); setLocationId('') }}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Location */}
              {filteredLocations.length > 0 && (
                <div className="flex flex-col gap-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground">Точка</label>
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Все точки</option>
                    {filteredLocations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Search */}
              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground">Поиск</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                    placeholder="Последние 6 символов ID или сумма..."
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex items-end">
                <Button size="sm" onClick={handleSearch} disabled={loading}>
                  <Search className="mr-2 h-4 w-4" />
                  Найти
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Загрузка...
              </div>
            ) : sales.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                Чеки не найдены
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Номер</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Время</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Сумма</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Оплата</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">Товаров</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale) => {
                      const method = detectPaymentMethod(sale)
                      const pm = PAYMENT_LABELS[method] || PAYMENT_LABELS.mixed
                      return (
                        <tr
                          key={sale.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer"
                          onClick={() => setSelectedSale(sale)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            #{sale.id.slice(-6).toUpperCase()}
                          </td>
                          <td className="px-4 py-3">{fmtDate(sale.sold_at)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{fmtTime(sale.sold_at)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                            {fmt(sale.total_amount)} ₸
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${pm.color}`}>
                              {pm.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">
                            {sale.items.length}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); setSelectedSale(sale) }}
                            >
                              Просмотр
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Стр. {page} из {totalPages} · всего {total} чеков
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                Вперёд
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Receipt detail modal */}
      {selectedSale && (
        <ReceiptDetailModal sale={selectedSale} onClose={() => setSelectedSale(null)} />
      )}
    </>
  )
}
