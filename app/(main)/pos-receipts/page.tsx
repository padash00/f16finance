'use client'
import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer, Search, ChevronLeft, ChevronRight, ChevronDown, Receipt, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useUrlState } from '@/lib/hooks/use-url-state'
import { useApiCache } from '@/lib/client/use-api-cache'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { TableSkeleton } from '@/components/skeleton'

// ─── Types ───────────────────────────────────────────────────────────────────

type Company = { id: string; name: string; code: string | null }
type Location = { id: string; name: string; company_id: string }

type SaleItem = {
  id: string
  item_id: string | null
  universal_name?: string | null
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
  kaspi: { label: 'Безналичный', color: 'bg-orange-100 text-orange-800' },
  card: { label: 'Карта', color: 'bg-blue-100 text-blue-800' },
  online: { label: 'Онлайн', color: 'bg-amber-100 text-amber-800' },
  mixed: { label: 'Смешанный', color: 'bg-slate-100 text-slate-800' },
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
  const { can } = useCapabilities()

  const paymentBreakdown: { label: string; amount: number }[] = []
  if (sale.cash_amount > 0) paymentBreakdown.push({ label: 'Наличные', amount: sale.cash_amount })
  if (sale.kaspi_amount > 0) paymentBreakdown.push({ label: 'Безналичный', amount: sale.kaspi_amount })
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
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Товар</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Кол.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Цена</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-white/5">
                    <td className="px-3 py-2 font-medium">{item.inventory_items?.name || item.universal_name || '—'}</td>
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
            <div className="flex justify-between font-bold text-base border-t border-border pt-2">
              <span>Итого</span>
              <span className="text-emerald-400">{fmt(sale.total_amount)} ₸</span>
            </div>
          </div>

          {/* Payment breakdown */}
          {paymentBreakdown.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-muted p-3 space-y-1">
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
            <div className="rounded-xl border border-border bg-surface-muted p-3">
              <p className="text-xs text-muted-foreground">Комментарий</p>
              <p className="mt-1 text-sm">{sale.comment}</p>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground pt-2 border-t border-border">
            ID: {sale.id}
          </div>
        </div>

        {/* Print button */}
        {can('pos-receipts.print') && (
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => window.print()} className="gap-2">
              <Printer className="h-4 w-4" />
              Печать
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function PosReceiptsPageContent({ embedded = false }: { embedded?: boolean }) {
  const [sales, setSales] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filterDefaults = useMemo(
    () => ({
      page: '1',
      date_from: '',
      date_to: '',
      search: '',
      company_id: '',
      location_id: '',
    }),
    [],
  )
  const [filters, setFilters] = useUrlState(filterDefaults)
  const [searchInput, setSearchInput] = useState(filters.search)

  // Companies & locations (кэшируются — фильтры заполняются мгновенно при повторном заходе)
  const { data: bootstrapData } = useApiCache<{ companies?: Company[]; locations?: Location[] }>('/api/pos/bootstrap')
  const companies = useMemo(
    () => (Array.isArray(bootstrapData?.companies) ? bootstrapData.companies : []),
    [bootstrapData],
  )
  const locations = useMemo(
    () => (Array.isArray(bootstrapData?.locations) ? bootstrapData.locations : []),
    [bootstrapData],
  )

  // Selected receipt for modal
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  // Мобильные карточки: раскрытый состав чека (только презентация)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const pageSize = 20
  const page = Math.max(1, Number(filters.page || '1') || 1)
  const totalPages = Math.ceil(total / pageSize)

  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  const load = useCallback(async (p: number = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.company_id) params.set('company_id', filters.company_id)
      if (filters.location_id) params.set('location_id', filters.location_id)
      if (filters.date_from) params.set('date_from', filters.date_from)
      if (filters.date_to) params.set('date_to', filters.date_to)
      if (filters.search) params.set('search', filters.search)
      params.set('page', String(p))

      const res = await fetch(`/api/pos/receipts?${params.toString()}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка загрузки')
      const normalizedSales = Array.isArray(j.data)
        ? j.data.map((sale: Sale) => ({
            ...sale,
            items: Array.isArray(sale.items) ? sale.items : [],
          }))
        : []
      setSales(normalizedSales)
      setTotal(j.total || 0)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить чеки')
    } finally {
      setLoading(false)
    }
  }, [
    filters.company_id,
    filters.location_id,
    filters.date_from,
    filters.date_to,
    filters.search,
    page,
  ])

  useEffect(() => {
    void load(page)
  }, [load, page])

  function handleSearch() {
    setFilters({ search: searchInput, page: '1' })
  }

  const filteredLocations = filters.company_id
    ? locations.filter((l) => l.company_id === filters.company_id)
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

      <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
        {/* Header */}
        {(() => {
          const hdrActions = (
            <Button variant="ghost" size="sm" onClick={() => void load(page)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )
          const hdrToolbar = (
            <div className="flex flex-wrap gap-3">
              {/* Date from */}
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs text-muted-foreground">Дата от</label>
                <DatePicker
                  value={filters.date_from}
                  onChange={(v) => setFilters({ date_from: v, page: '1' })}
                />
              </div>
              {/* Date to */}
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs text-muted-foreground">Дата до</label>
                <DatePicker
                  value={filters.date_to}
                  onChange={(v) => setFilters({ date_to: v, page: '1' })}
                />
              </div>
              {/* Company */}
              {companies.length > 0 && (
                <div className="flex flex-col gap-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground">Компания</label>
                  <select
                    value={filters.company_id}
                    onChange={(e) => {
                      setFilters({ company_id: e.target.value, location_id: '', page: '1' })
                    }}
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
                    value={filters.location_id}
                    onChange={(e) => setFilters({ location_id: e.target.value, page: '1' })}
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
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
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
          )
          return embedded ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              {hdrToolbar}
              <div className="flex flex-wrap items-center gap-2">{hdrActions}</div>
            </div>
          ) : (
            <AdminPageHeader
              title="История чеков"
              description="Просмотр и повторная печать чеков POS"
              icon={<Receipt className="h-5 w-5" />}
              accent="emerald"
              backHref="/"
              actions={hdrActions}
              toolbar={hdrToolbar}
            />
          )
        })()}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading && sales.length === 0 ? (
              <>
                {/* Мобильный скелетон карточек */}
                <div className="space-y-3 p-3 sm:hidden">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                      <Skeleton className="mt-3 h-8 w-32" />
                      <Skeleton className="mt-3 h-9 w-full" />
                    </div>
                  ))}
                </div>
                <div className="hidden p-4 sm:block">
                  <TableSkeleton rows={8} cols={7} />
                </div>
              </>
            ) : sales.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                Чеки не найдены
              </div>
            ) : (
              <>
              {/* Мобильная версия: карточки чеков вместо таблицы */}
              <div className="space-y-3 p-3 sm:hidden">
                {sales.map((sale) => {
                  const method = detectPaymentMethod(sale)
                  const pm = PAYMENT_LABELS[method] || PAYMENT_LABELS.mixed
                  const open = expandedId === sale.id
                  return (
                    <div key={sale.id} className="rounded-xl border border-border bg-white dark:bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-muted-foreground">#{sale.id.slice(-6).toUpperCase()}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{fmtDate(sale.sold_at)} · {fmtTime(sale.sold_at)}</div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${pm.color}`}>
                          {pm.label}
                        </span>
                      </div>

                      <div className="mt-2 flex items-end justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">Сумма</div>
                          <div className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(sale.total_amount)} ₸</div>
                        </div>
                        <div className="pb-1 text-xs text-slate-500">{sale.items.length} товаров</div>
                      </div>

                      {sale.discount_amount > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl border border-border bg-slate-50 dark:bg-white/[0.02] px-1 py-2">
                            <div className="text-[10px] text-slate-500">Скидка</div>
                            <div className="mt-0.5 text-xs font-medium tabular-nums text-rose-600 dark:text-rose-400">−{fmt(sale.discount_amount)} ₸</div>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 flex-1 rounded-xl text-xs"
                          onClick={() => setSelectedSale(sale)}
                        >
                          Просмотр
                        </Button>
                      </div>

                      {sale.items.length > 0 && (
                        <button
                          type="button"
                          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-1.5 text-[11px] text-slate-500"
                          onClick={() => setExpandedId(open ? null : sale.id)}
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {open ? 'Скрыть состав' : 'Состав чека'}
                        </button>
                      )}

                      {open && (
                        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                          {sale.items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 flex-1 truncate text-body">
                                {item.inventory_items?.name || item.universal_name || '—'}
                                <span className="ml-1 text-slate-500">× {item.quantity}</span>
                              </span>
                              <span className="shrink-0 font-medium tabular-nums text-foreground">{fmt(item.total_price)} ₸</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Десктоп: прежняя таблица */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
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
                          className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer"
                          onClick={() => setSelectedSale(sale)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            #{sale.id.slice(-6).toUpperCase()}
                          </td>
                          <td className="px-4 py-3">{fmtDate(sale.sold_at)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{fmtTime(sale.sold_at)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
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
              </>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Стр. {page} из {totalPages} · всего {total} чеков
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ page: String(Math.max(1, page - 1)) })}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ page: String(Math.min(totalPages, page + 1)) })}
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

export default function PosReceiptsPage({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <Suspense fallback={null}>
      <PosReceiptsPageContent embedded={embedded} />
    </Suspense>
  )
}
