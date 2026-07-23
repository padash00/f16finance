/**
 * История продаж точки (v2.9).
 *
 * Сценарий: клиент пришёл за чеком назавтра — кассир находит продажу
 * (поиск по сумме чека, серверный q) и печатает КОПИЮ чека.
 *
 * Онлайн: GET /api/point/sales-history?days=7&q=&limit=100 (все смены и кассиры точки).
 * Офлайн-фолбэк: локальная очередь неотправленных продаж + кэш последних
 * серверных продаж этой кассы (getCachedSalesContext) с пометкой об офлайне.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Banknote,
  CloudOff,
  History,
  Loader2,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  UserCircle2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import type { PointSalesHistorySale } from '@/lib/api'
import { getQueueItems } from '@/lib/offline'
import { getCachedSalesContext } from '@/lib/cache'
import { useCashlessLabels } from '@/lib/use-cashless-labels'
import {
  buildReceiptHtmlForPreview,
  printReceiptFromIframe,
  type SaleReceiptPreview,
} from '@/lib/receipt-html'
import { toastError } from '@/lib/toast'
import { formatMoney } from '@/lib/utils'
import type {
  AppConfig,
  OperatorSession,
  PointInventorySaleContext,
  PointReceiptSettings,
} from '@/types'

interface Props {
  config: AppConfig
  session: OperatorSession
  onBack: () => void
}

/** Продажа в списке: серверная или локальная (из офлайн-очереди) */
type HistorySale = PointSalesHistorySale & {
  /** true — продажа ещё в очереди на отправку (офлайн) */
  pending?: boolean
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatSoldAt(soldAt: string | null, saleDate: string): string {
  const d = soldAt ? new Date(soldAt) : null
  if (!d || Number.isNaN(d.getTime())) return saleDate || '—'
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(d, today)) return `сегодня ${time}`
  if (isSameDay(d, yesterday)) return `вчера ${time}`
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`
}

function operatorNameFromSession(operator: Record<string, unknown> | null | undefined): string | null {
  if (!operator) return null
  const value =
    (operator.full_name as string) ||
    (operator.name as string) ||
    (operator.short_name as string) ||
    (operator.username as string) ||
    ''
  return value.trim() || null
}

/** Продажи из офлайн-очереди (ещё не отправлены на сервер) */
async function loadLocalSales(): Promise<HistorySale[]> {
  const result: HistorySale[] = []

  const cachedContext = await getCachedSalesContext<PointInventorySaleContext>().catch(() => null)
  const itemsById = new Map((cachedContext?.items || []).map((item) => [item.id, item]))

  // 1) Очередь неотправленных продаж этой кассы
  try {
    const queue = await getQueueItems()
    for (const entry of queue) {
      if (entry.type !== 'inventory_sale') continue
      const p = entry.payload || {}
      const cash = Number(p.cash_amount || 0)
      const kaspi = Number(p.kaspi_amount || 0)
      const rawItems = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
      const lines = rawItems.map((line) => {
        const itemId = (line.item_id as string) || null
        const catalogItem = itemId ? itemsById.get(itemId) : null
        const quantity = Number(line.quantity || 0)
        const unitPrice = Number(line.unit_price || 0)
        return {
          name: String((line.universal_name as string) || catalogItem?.name || 'Товар'),
          unit: String(catalogItem?.unit || 'шт'),
          quantity,
          unit_price: unitPrice,
          total_price: Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100,
        }
      })
      result.push({
        id: String(p.local_ref || entry.local_ref || `local-${entry.id}`),
        sold_at: entry.created_at || null,
        sale_date: String(p.sale_date || ''),
        shift: String(p.shift || 'day'),
        payment_method: String(p.payment_method || 'cash'),
        cash_amount: cash,
        kaspi_amount: kaspi,
        card_amount: 0,
        online_amount: 0,
        total_amount: cash + kaspi,
        discount_amount: Number(p.discount_amount || 0),
        comment: (p.comment as string) || null,
        operator_name: operatorNameFromSession((p._session as any)?.operator || null),
        items: lines,
        pending: true,
      })
    }
  } catch {
    /* очередь недоступна — покажем что есть из кэша */
  }

  // 2) Кэш последних серверных продаж (последний удачный ответ inventory-sales)
  for (const sale of cachedContext?.sales || []) {
    result.push({
      id: String(sale.id),
      sold_at: sale.sold_at || null,
      sale_date: sale.sale_date,
      shift: sale.shift,
      payment_method: sale.payment_method,
      cash_amount: Number(sale.cash_amount || 0),
      kaspi_amount: Number(sale.kaspi_amount || 0),
      card_amount: 0,
      online_amount: 0,
      total_amount: Number(sale.total_amount || 0),
      discount_amount: 0,
      comment: sale.comment || null,
      operator_name: null,
      items: (sale.items || []).map((line) => ({
        name: String((line as any).universal_name || line.item?.name || 'Товар'),
        unit: 'шт',
        quantity: Number(line.quantity || 0),
        unit_price: Number(line.unit_price || 0),
        total_price: Number(line.total_price || 0),
      })),
    })
  }

  result.sort((a, b) => new Date(b.sold_at || 0).getTime() - new Date(a.sold_at || 0).getTime())
  return result
}

export default function SalesHistoryPage({ config, session, onBack }: Props) {
  const cashLabels = useCashlessLabels(session)
  const [sales, setSales] = useState<HistorySale[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [offlineMode, setOfflineMode] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedSale, setSelectedSale] = useState<HistorySale | null>(null)
  const [printPreview, setPrintPreview] = useState<SaleReceiptPreview | null>(null)
  const [receiptSettings, setReceiptSettings] = useState<PointReceiptSettings | null>(null)
  const printIframeRef = useRef<HTMLIFrameElement | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadNonce = useRef(0)

  // Реквизиты ККМ для чека-копии (getPointReceiptSettings сам кэширует офлайн)
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

  const load = useCallback(
    async (q: string) => {
      const nonce = ++loadNonce.current
      setLoading(true)
      try {
        const data = await api.getPointSalesHistory(config, { days: 7, q, limit: 100 }, session.company.id)
        if (nonce !== loadNonce.current) return
        setSales(data)
        setOfflineMode(false)
      } catch {
        // Сервер недоступен — офлайн-фолбэк: очередь + кэш этой кассы
        const local = await loadLocalSales()
        if (nonce !== loadNonce.current) return
        const trimmed = q.trim()
        const qNum = Number(trimmed.replace(/\s/g, '').replace(',', '.'))
        const filtered = trimmed
          ? local.filter((sale) =>
              Number.isFinite(qNum) && qNum > 0
                ? Math.abs(sale.total_amount - qNum) < 0.005
                : (sale.comment || '').toLowerCase().includes(trimmed.toLowerCase()),
            )
          : local
        setSales(filtered)
        setOfflineMode(true)
      } finally {
        if (nonce === loadNonce.current) setLoading(false)
      }
    },
    [config, session.company.id],
  )

  // Первичная загрузка
  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Поиск с debounce (серверный q)
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      void load(query)
    }, 400)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const totalShown = useMemo(
    () => (sales || []).reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0),
    [sales],
  )

  function paymentLabel(method: string) {
    if (method === 'cash') return 'Наличные'
    if (method === 'kaspi') return cashLabels.providerName
    return 'Смешанная'
  }

  function handlePrintCopy(sale: HistorySale) {
    if (!sale.items || sale.items.length === 0) {
      toastError('У этого чека нет позиций — печать копии недоступна')
      return
    }
    const soldAt = sale.sold_at ? new Date(sale.sold_at) : null
    const validDate = soldAt && !Number.isNaN(soldAt.getTime()) ? soldAt : null
    const subtotal = sale.items.reduce((sum, line) => sum + Number(line.total_price || 0), 0)
    const preview: SaleReceiptPreview = {
      saleId: sale.id,
      saleDate: validDate ? validDate.toLocaleDateString('ru-RU') : sale.sale_date,
      saleTime: validDate ? validDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '',
      shift: sale.shift,
      paymentMethod: (sale.payment_method as 'cash' | 'kaspi' | 'mixed') || 'cash',
      cashAmount: Number(sale.cash_amount || 0),
      kaspiAmount: Number(sale.kaspi_amount || 0),
      totalAmount: Number(sale.total_amount || 0),
      subtotal,
      discountAmount: Number(sale.discount_amount || 0),
      loyaltyDiscountAmount: 0,
      customer: null,
      comment: sale.comment,
      operatorName: sale.operator_name || '—',
      companyName: session.company.name,
      locationName: '',
      receiptSettings,
      isCopy: true,
      lines: sale.items.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unit_price: line.unit_price,
        total: line.total_price,
        unit: line.unit || null,
      })),
    }
    setPrintPreview(preview)
  }

  const list = sales || []

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      <div className="h-9 shrink-0 drag-region bg-card/80 backdrop-blur" />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-3 pb-2 backdrop-blur-xl no-drag sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-9 gap-2 px-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Назад</span>
          </Button>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-none">История продаж</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {session.company.name} · последние 7 дней · все кассиры
              </p>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load(query)}
          disabled={loading}
          className="h-9 w-9 p-0 text-muted-foreground"
          title="Обновить историю"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </header>

      {/* Поиск по сумме чека */}
      <div className="shrink-0 border-b border-border bg-card/60 p-3 sm:px-4">
        <div className="relative mx-auto w-full max-w-3xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode="numeric"
            placeholder="Сумма чека — например 750"
            className="h-12 w-full rounded-2xl border border-input bg-muted pl-12 pr-12 text-base text-foreground outline-none transition focus:border-ring"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Очистить поиск"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Офлайн-баннер */}
      {offlineMode ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>
              Сервер недоступен — офлайн: показаны только продажи этой кассы (очередь на отправку и последний кэш).
            </span>
          </div>
        </div>
      ) : null}

      {/* Список чеков */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {loading && sales === null ? (
            <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Загружаем историю продаж…
            </div>
          ) : list.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <ReceiptText className="h-12 w-12 opacity-30" />
              <p className="text-sm">{query.trim() ? 'Чеков с такой суммой не найдено' : 'Чеков за последние 7 дней нет'}</p>
              {query.trim() ? (
                <p className="text-xs">Проверьте сумму — поиск ищет точное совпадение суммы чека.</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span>Чеков: {list.length}</span>
                <span>На сумму: {formatMoney(totalShown)} ₸</span>
              </div>
              {list.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => setSelectedSale(sale)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-muted"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{formatSoldAt(sale.sold_at, sale.sale_date)}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        {paymentLabel(sale.payment_method)}
                      </Badge>
                      {sale.pending ? (
                        <Badge variant="warning" className="text-[10px]">ждёт отправки</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {sale.operator_name || 'Кассир не указан'} · {sale.items.length} поз. · #{sale.id.slice(-6)}
                      </span>
                    </p>
                  </div>
                  <p className="shrink-0 text-xl font-bold tabular-nums text-foreground">
                    {formatMoney(Number(sale.total_amount || 0))} ₸
                  </p>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Детальный вид чека */}
      {selectedSale ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 sm:p-4" onClick={() => setSelectedSale(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <ReceiptText className="h-4 w-4 text-primary" />
                  Чек #{selectedSale.id.slice(-6)}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatSoldAt(selectedSale.sold_at, selectedSale.sale_date)} ·{' '}
                  {selectedSale.operator_name || 'кассир не указан'}
                  {selectedSale.pending ? ' · ещё не отправлен на сервер' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSale(null)}
                className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-72 overflow-auto px-5 py-3">
              {selectedSale.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Позиции чека недоступны</p>
              ) : (
                <div className="space-y-1">
                  {selectedSale.items.map((line, idx) => (
                    <div
                      key={`${selectedSale.id}-${idx}`}
                      className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity} {line.unit || 'шт'} × {formatMoney(line.unit_price)} ₸
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(line.total_price)} ₸</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border px-5 py-3">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Banknote className="h-4 w-4 text-primary" />
                    {paymentLabel(selectedSale.payment_method)}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    {formatMoney(Number(selectedSale.total_amount || 0))}{' '}
                    <span className="text-sm font-medium text-muted-foreground">₸</span>
                  </span>
                </div>
                {selectedSale.payment_method === 'mixed' ? (
                  <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Наличные</span>
                      <span className="tabular-nums">{formatMoney(Number(selectedSale.cash_amount || 0))} ₸</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{cashLabels.providerName}</span>
                      <span className="tabular-nums">{formatMoney(Number(selectedSale.kaspi_amount || 0))} ₸</span>
                    </div>
                  </div>
                ) : null}
                {selectedSale.discount_amount > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Скидка: −{formatMoney(Number(selectedSale.discount_amount || 0))} ₸
                  </p>
                ) : null}
                {selectedSale.comment ? (
                  <p className="mt-2 text-xs text-muted-foreground">Комментарий: {selectedSale.comment}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-5">
              <Button type="button" variant="outline" onClick={() => setSelectedSale(null)} className="h-12 sm:order-1 sm:px-6">
                Закрыть
              </Button>
              <Button
                type="button"
                onClick={() => handlePrintCopy(selectedSale)}
                disabled={selectedSale.items.length === 0}
                className="h-12 gap-2 rounded-xl text-base font-semibold sm:order-2 sm:px-8"
              >
                <Printer className="h-4 w-4" />
                Печать копии
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Превью копии чека + печать */}
      {printPreview ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-3 sm:p-4" onClick={() => setPrintPreview(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-bold">Копия чека #{printPreview.saleId?.slice(-6) || '—'}</h3>
                <p className="text-xs text-muted-foreground">
                  На чеке будет крупная пометка «КОПИЯ» — это повторная печать.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintPreview(null)}
                className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-muted p-3 sm:p-5">
              <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-lg bg-white shadow-md">
                <iframe
                  ref={printIframeRef}
                  srcDoc={buildReceiptHtmlForPreview(printPreview)}
                  title="Превью копии чека"
                  className="h-[60vh] w-full border-0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end sm:gap-3 sm:p-5">
              <Button type="button" variant="outline" onClick={() => setPrintPreview(null)} className="h-12 sm:order-1 sm:px-6">
                Закрыть
              </Button>
              <Button
                type="button"
                onClick={() => printReceiptFromIframe(printIframeRef.current)}
                className="h-12 rounded-xl text-base font-semibold sm:order-2 sm:px-8"
              >
                🖨 Печатать копию
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
