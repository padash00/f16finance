/**
 * Прототип минималистичного дизайна страницы продаж под стиль Wipon Pro.
 *
 * ВАЖНО: это прототип, не замена основной страницы.
 * Базовый flow: поиск/штрихкод → добавить → корзина → оплата → чек.
 *
 * Нет в этом прототипе (можно добавить позже):
 * - Скидки и промокоды
 * - Клиенты и бонусы
 * - Корректировка оплаты на проведённых чеках
 * - История продаж
 *
 * Подключается через флаг в App.tsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, LogOut, Minus, Plus, RefreshCw, Search, X } from 'lucide-react'

import WorkModeSwitch from '@/components/WorkModeSwitch'
import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import { getCachedSalesContext, saveSalesContextCache } from '@/lib/cache'
import { resolveRuntimeShift } from '@/lib/shift-runtime'
import { toastError, toastSuccess } from '@/lib/toast'
import { formatMoney, localRef, parseMoney } from '@/lib/utils'
import type {
  AppConfig,
  BootstrapData,
  OperatorSession,
  PointInventorySaleContext,
  PointInventorySaleItem,
} from '@/types'

type Props = {
  config: AppConfig
  bootstrap: BootstrapData
  session: OperatorSession
  onLogout: () => void
  onSwitchToShift?: () => void
  onSwitchToReturn?: () => void
  onSwitchToScanner?: () => void
  onSwitchToRequest?: () => void
  onOpenCabinet?: () => void
}

type CartLine = {
  item_id: string
  quantity: number
  unit_price: number
}

function formatShiftLabel(shift: 'day' | 'night' | string) {
  if (shift === 'day') return 'Дневная'
  if (shift === 'night') return 'Ночная'
  return shift
}

function buildReceipt(html: string) {
  const win = window.open('', '_blank', 'width=420,height=720')
  if (!win) {
    toastError('Не удалось открыть окно печати')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}

export default function InventorySalesPageMinimal({
  config,
  bootstrap,
  session,
  onLogout,
  onSwitchToShift,
  onSwitchToReturn,
  onSwitchToScanner,
  onSwitchToRequest,
  onOpenCabinet,
}: Props) {
  const runtimeShift = useMemo(() => resolveRuntimeShift(), [])
  const isNightAfterMidnight = useMemo(() => {
    const h = new Date().getHours()
    return runtimeShift.shift === 'night' && h < 12
  }, [runtimeShift.shift])

  const [context, setContext] = useState<PointInventorySaleContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi' | 'mixed'>('cash')
  const [mixedCash, setMixedCash] = useState('')
  const [mixedKaspi, setMixedKaspi] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Часы в шапке
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Первичная загрузка с кэшем
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await getCachedSalesContext<PointInventorySaleContext>().catch(() => null)
      if (!cancelled && cached) {
        setContext(cached)
        setLoading(false)
        void load(true)
      } else if (!cancelled) {
        void load(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function load(silent: boolean) {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await api.getPointInventorySales(config, session)
      setContext(data)
      void saveSalesContextCache(data)
    } catch (err: any) {
      if (!silent) {
        setError(err?.message || 'Не удалось загрузить витрину')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Operator name display
  const operatorName = useMemo(() => {
    return (
      session.operator?.full_name ||
      session.operator?.short_name ||
      bootstrap?.operatorName ||
      'Оператор'
    )
  }, [session, bootstrap])

  // Items by id для быстрого доступа
  const itemsById = useMemo(() => {
    const m = new Map<string, PointInventorySaleItem>()
    for (const item of context?.items || []) m.set(item.id, item)
    return m
  }, [context?.items])

  // Поиск
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as PointInventorySaleItem[]
    return (context?.items || [])
      .filter((it) => Number(it.display_qty || 0) > 0)
      .filter((it) =>
        it.name.toLowerCase().includes(q) ||
        (it.barcode || '').includes(q),
      )
      .slice(0, 8)
  }, [search, context?.items])

  // Подробная корзина
  const cartDetailed = useMemo(() => {
    return cart.map((line) => {
      const item = itemsById.get(line.item_id)
      return {
        ...line,
        item: item || null,
        total: line.quantity * line.unit_price,
      }
    })
  }, [cart, itemsById])

  const subtotal = useMemo(() => cartDetailed.reduce((s, l) => s + l.total, 0), [cartDetailed])

  // Авто-добавление по штрихкоду (если введён ровно штрихкод)
  function handleSearchSubmit() {
    const q = search.trim()
    if (!q) return
    const exactBarcode = (context?.items || []).find(
      (it) => it.barcode === q && Number(it.display_qty || 0) > 0,
    )
    if (exactBarcode) {
      addItem(exactBarcode)
      setSearch('')
      return
    }
    // Если ровно один результат — добавляем
    if (searchResults.length === 1) {
      addItem(searchResults[0])
      setSearch('')
    }
  }

  function addItem(item: PointInventorySaleItem) {
    const available = Number(item.display_qty || 0)
    if (available <= 0) {
      toastError(`Нет на витрине: ${item.name}`)
      return
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.item_id === item.id)
      if (existing) {
        const nextQty = existing.quantity + 1
        if (nextQty > available) {
          toastError(`Доступно только ${available}`)
          return prev
        }
        return prev.map((l) =>
          l.item_id === item.id ? { ...l, quantity: nextQty } : l,
        )
      }
      return [
        ...prev,
        { item_id: item.id, quantity: 1, unit_price: Number(item.sale_price || 0) },
      ]
    })
  }

  function changeQty(itemId: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((l) => l.item_id !== itemId))
      return
    }
    const item = itemsById.get(itemId)
    const available = Number(item?.display_qty || 0)
    if (nextQty > available) {
      toastError(`Доступно только ${available}`)
      return
    }
    setCart((prev) =>
      prev.map((l) => (l.item_id === itemId ? { ...l, quantity: nextQty } : l)),
    )
  }

  function removeLine(itemId: string) {
    setCart((prev) => prev.filter((l) => l.item_id !== itemId))
  }

  function clearCart() {
    setCart([])
    setMixedCash('')
    setMixedKaspi('')
  }

  async function handlePay() {
    if (cart.length === 0) {
      toastError('Корзина пуста')
      return
    }
    const cashAmount =
      paymentMethod === 'cash'
        ? subtotal
        : paymentMethod === 'mixed'
          ? Math.max(0, Math.min(subtotal, parseMoney(mixedCash)))
          : 0
    const kaspiAmount =
      paymentMethod === 'kaspi'
        ? subtotal
        : paymentMethod === 'mixed'
          ? Math.max(0, subtotal - cashAmount)
          : 0

    if (paymentMethod === 'mixed' && (cashAmount <= 0 || kaspiAmount <= 0)) {
      toastError('В смешанной оплате обе суммы должны быть больше 0')
      return
    }

    setSaving(true)
    try {
      await api.createPointInventorySale(config, session, {
        sale_date: new Date().toISOString().slice(0, 10),
        shift: runtimeShift.shift,
        payment_method: paymentMethod,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        kaspi_before_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? 0 : kaspiAmount,
        kaspi_after_midnight_amount:
          runtimeShift.shift === 'night' && isNightAfterMidnight ? kaspiAmount : 0,
        comment: '',
        local_ref: localRef(),
        items: cart.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
      } as any)
      toastSuccess('Продажа сохранена')
      clearCart()
      void load(true)
      // (здесь можно вызывать печать чека — позже добавить)
    } catch (err: any) {
      toastError(err?.message || 'Не удалось провести продажу')
    } finally {
      setSaving(false)
    }
  }

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Drag region для Electron */}
      <div className="h-9 shrink-0 drag-region bg-white dark:bg-slate-900" />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 no-drag dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 text-white text-sm font-bold">F</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{session.company?.name || 'Точка'}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {operatorName} · {formatShiftLabel(runtimeShift.shift)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <span className="hidden text-sm tabular-nums text-slate-500 sm:inline dark:text-slate-400">{timeStr}</span>
          <WorkModeSwitch
            active="sale"
            showSale
            showReturn={!!onSwitchToReturn}
            showScanner={!!onSwitchToScanner}
            showRequest={!!onSwitchToRequest}
            onShift={onSwitchToShift}
            onSale={() => undefined}
            onReturn={onSwitchToReturn}
            onScanner={onSwitchToScanner}
            onRequest={onSwitchToRequest}
            onCabinet={onOpenCabinet}
          />
          <Button variant="ghost" size="sm" onClick={() => void load(false)} disabled={loading} className="h-8 w-8 p-0">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-8 w-8 p-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Основной контент */}
      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Левая зона: поиск + таблица позиций */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* Поиск */}
          <div className="relative shrink-0 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSearchSubmit()
                  }
                }}
                placeholder="Поиск товара по названию, штрихкоду или артикулу"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-12 text-base outline-none transition focus:border-emerald-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Выпадающий список результатов поиска */}
            {searchResults.length > 0 && (
              <div className="absolute left-3 right-3 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:left-4 sm:right-4">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      addItem(item)
                      setSearch('')
                      searchRef.current?.focus()
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {item.barcode || '—'} · {Number(item.display_qty || 0)} шт на витрине
                      </p>
                    </div>
                    <p className="shrink-0 text-base font-semibold">{formatMoney(item.sale_price)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Таблица позиций чека */}
          <div className="flex-1 overflow-auto p-3 sm:p-4">
            {loading && cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Загружаем витрину…</p>
              </div>
            ) : error && cart.length === 0 ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            ) : cartDetailed.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-10 w-10">
                    <path d="M3 9l9-6 9 6M3 9l9 6 9-6M3 9v10a2 2 0 002 2h14a2 2 0 002-2V9" />
                  </svg>
                </div>
                <p className="text-sm">Список пуст</p>
                <p className="text-xs text-slate-500 dark:text-slate-500">Найдите товар через поиск или отсканируйте штрихкод</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="w-10 px-3 py-3 text-left font-medium">#</th>
                      <th className="px-3 py-3 text-left font-medium">Наименование</th>
                      <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Цена</th>
                      <th className="px-3 py-3 text-center font-medium">Кол-во</th>
                      <th className="px-3 py-3 text-right font-medium">Сумма</th>
                      <th className="w-12 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {cartDetailed.map((line, idx) => (
                      <tr
                        key={line.item_id}
                        className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/50"
                      >
                        <td className="px-3 py-3 text-sm text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium leading-tight">{line.item?.name || 'Товар'}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:hidden">
                            {formatMoney(line.unit_price)} / {line.item?.unit || 'шт'}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 text-right text-sm tabular-nums sm:table-cell">{formatMoney(line.unit_price)}</td>
                        <td className="px-3 py-3">
                          <div className="mx-auto flex w-fit items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button
                              type="button"
                              onClick={() => changeQty(line.item_id, line.quantity - 1)}
                              className="grid h-8 w-8 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQty(line.item_id, line.quantity + 1)}
                              className="grid h-8 w-8 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">{formatMoney(line.total)}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.item_id)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Правая зона: оплата */}
        <aside className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:w-96 lg:border-l lg:border-t-0 lg:p-4 xl:w-[420px]">
          <div className="flex h-full flex-col gap-3">
            {/* Итого */}
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">К оплате</p>
              <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">
                {formatMoney(subtotal)}
                <span className="ml-1 text-lg font-medium text-slate-400">₸</span>
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {cartDetailed.length} {cartDetailed.length === 1 ? 'позиция' : 'позиций'} ·{' '}
                {cartDetailed.reduce((s, l) => s + l.quantity, 0)} шт
              </p>
            </div>

            {/* Способ оплаты */}
            <div className="grid grid-cols-3 gap-1.5">
              {(['cash', 'kaspi', 'mixed'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-xl border py-2.5 text-sm font-medium transition ${
                    paymentMethod === m
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {m === 'cash' ? 'Наличные' : m === 'kaspi' ? 'Kaspi' : 'Смешанная'}
                </button>
              ))}
            </div>

            {/* Поля смешанной оплаты */}
            {paymentMethod === 'mixed' && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Наличными</span>
                  <input
                    value={mixedCash}
                    onChange={(e) => {
                      const v = e.target.value
                      setMixedCash(v)
                      const cash = Math.max(0, Math.min(subtotal, parseMoney(v)))
                      setMixedKaspi(String(Math.max(0, subtotal - cash)))
                    }}
                    placeholder="0"
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Kaspi</span>
                  <input
                    value={mixedKaspi}
                    onChange={(e) => {
                      const v = e.target.value
                      setMixedKaspi(v)
                      const kaspi = Math.max(0, Math.min(subtotal, parseMoney(v)))
                      setMixedCash(String(Math.max(0, subtotal - kaspi)))
                    }}
                    placeholder="0"
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium tabular-nums outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>
              </div>
            )}

            {/* Кнопки действий */}
            <div className="mt-auto flex flex-col gap-2">
              <Button
                type="button"
                onClick={() => void handlePay()}
                disabled={saving || cart.length === 0}
                className="h-14 rounded-2xl bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Сохраняем…
                  </span>
                ) : (
                  <>ОПЛАТИТЬ · {formatMoney(subtotal)} ₸</>
                )}
              </Button>
              {cart.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearCart}
                  className="h-10 rounded-xl"
                >
                  Очистить корзину
                </Button>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
