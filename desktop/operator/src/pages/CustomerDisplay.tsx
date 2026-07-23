import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { getCachedSalesContext } from '@/lib/cache'

/**
 * Экран клиента (Customer Display).
 *
 * Грузится на второй монитор в режиме "extend" через ?role=customer.
 * Главный процесс Electron открывает это окно по запросу из настроек
 * оператора. Состояние корзины приходит через IPC канал customer-display:state.
 *
 * Состояния:
 *  - idle      — корзина пуста: реклама (если есть плейлист) → витрина из
 *                кэша каталога (авто-слайды товаров с фото) → приветствие с часами
 *  - active    — корзина не пуста: карточная сетка товаров + полоса итога снизу
 *  - paid      — только что оплачен чек: «Спасибо» + сумма + баллы + QR «Оцените нас»
 *
 * Канал данных касса→дисплей аддитивный: новые поля (image_url, reviewUrl,
 * loyalty) опциональны — старая касса их не шлёт, старый дисплей игнорирует.
 */

type CartLine = {
  id?: string
  name: string
  quantity: number
  unit_price: number
  comment?: string | null
  /** Фото товара (аддитивное поле, может отсутствовать у старой кассы) */
  image_url?: string | null
}

type DisplayCustomer = {
  name: string | null
  phone: string | null
  loyaltyPoints: number
} | null

type AdItem = {
  id: string
  media_type: 'image' | 'video'
  url: string
  title: string | null
  duration_sec: number | null
}

/** Начисление баллов по чеку (аддитивное поле события 'paid') */
type PaidLoyalty = {
  earned: number
  spent: number
  totalAfter: number
} | null

type DisplayState = {
  companyName?: string | null
  operatorName?: string | null
  cart: CartLine[]
  lastAddedId?: string | null
  subtotal: number
  discount: number
  total: number
  paymentMethod?: 'cash' | 'kaspi' | 'mixed' | null
  customer?: DisplayCustomer
  playlist?: AdItem[]
  /** Ссылка «Оцените нас» из настроек чека (аддитивное поле) */
  reviewUrl?: string | null
}

type DisplayEvent =
  | { kind: 'update'; state: DisplayState }
  | {
      kind: 'paid'
      total: number
      paymentLabel: string
      lines: CartLine[]
      loyalty?: PaidLoyalty
      reviewUrl?: string | null
    }
  | { kind: 'clear' }

type PaidView = {
  total: number
  paymentLabel: string
  lines: CartLine[]
  loyalty: PaidLoyalty
  reviewUrl: string | null
}

/** Товар для витрины в простое (из локального кэша каталога кассы) */
type ShowcaseItem = {
  id: string
  name: string
  sale_price: number
  image_url: string
}

const emptyState: DisplayState = {
  companyName: null,
  operatorName: null,
  cart: [],
  lastAddedId: null,
  subtotal: 0,
  discount: 0,
  total: 0,
  paymentMethod: null,
  customer: null,
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('ru-RU')
}

/** 1 позиция / 2 позиции / 6 позиций */
function pluralPositions(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'позиция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции'
  return 'позиций'
}

// Плавная анимация числа: значение «доезжает» до target за ~400 мс
function useAnimatedNumber(target: number, durationMs = 400) {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    fromRef.current = display
    startRef.current = null
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const elapsed = t - startRef.current
      const progress = Math.min(1, elapsed / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      const next = fromRef.current + (target - fromRef.current) * eased
      setDisplay(next)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return display
}

/** Генерация QR как data-URL (библиотека qrcode, без сети) */
function useQrDataUrl(url: string | null, width = 240) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!url) {
      setDataUrl(null)
      return
    }
    QRCode.toDataURL(url, { margin: 1, width })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [url, width])
  return dataUrl
}

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>(emptyState)
  const [paid, setPaid] = useState<PaidView | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [totalPulse, setTotalPulse] = useState(0)
  // Плейлист и reviewUrl держим отдельно, чтобы они переживали события paid/clear
  const [playlist, setPlaylist] = useState<AdItem[]>([])
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  // Витрина для простоя — из локального кэша каталога кассы (только товары с фото)
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([])
  const prevTotalRef = useRef(0)
  const reviewUrlRef = useRef<string | null>(null)
  const paidTimerRef = useRef<number | null>(null)

  useEffect(() => {
    reviewUrlRef.current = reviewUrl
  }, [reviewUrl])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Кэш каталога (пишет касса через electron cache) — для витрины в простое.
  // Обновляем раз в 10 минут: каталог меняется нечасто.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const ctx = await getCachedSalesContext<{ items?: unknown[] }>()
        const rawItems = Array.isArray(ctx?.items) ? (ctx!.items as any[]) : []
        const withPhoto: ShowcaseItem[] = rawItems
          .filter(
            (it) =>
              it &&
              typeof it.image_url === 'string' &&
              it.image_url.trim().length > 0 &&
              Number(it.display_qty || 0) > 0,
          )
          .map((it) => ({
            id: String(it.id),
            name: String(it.name || ''),
            sale_price: Number(it.sale_price || 0),
            image_url: String(it.image_url).trim(),
          }))
        if (!cancelled) setShowcase(withPhoto)
      } catch {
        /* кэша может не быть — просто без витрины */
      }
    }
    void load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    const clearPaidTimer = () => {
      if (paidTimerRef.current !== null) {
        window.clearTimeout(paidTimerRef.current)
        paidTimerRef.current = null
      }
    }
    const off = window.electron.customerDisplay.onState((raw) => {
      const event = raw as DisplayEvent
      if (event?.kind === 'update') {
        clearPaidTimer()
        setState(event.state)
        if (Array.isArray(event.state.playlist)) setPlaylist(event.state.playlist)
        if ('reviewUrl' in event.state) setReviewUrl(event.state.reviewUrl?.trim() || null)
        setPaid(null)
      } else if (event?.kind === 'paid') {
        clearPaidTimer()
        const paidReviewUrl = (event.reviewUrl ?? reviewUrlRef.current)?.trim() || null
        setPaid({
          total: event.total,
          paymentLabel: event.paymentLabel,
          lines: event.lines,
          loyalty: event.loyalty || null,
          reviewUrl: paidReviewUrl,
        })
        // С QR держим экран дольше (~12 c), чтобы клиент успел отсканировать
        const holdMs = paidReviewUrl ? 12_000 : 5_000
        paidTimerRef.current = window.setTimeout(() => {
          paidTimerRef.current = null
          setPaid(null)
          setState(emptyState)
        }, holdMs)
      } else if (event?.kind === 'clear') {
        clearPaidTimer()
        setState(emptyState)
        setPaid(null)
      }
    })
    return () => {
      clearPaidTimer()
      off()
    }
  }, [])

  // Триггер пульсации итога при каждом изменении total
  useEffect(() => {
    if (state.total !== prevTotalRef.current) {
      setTotalPulse((n) => n + 1)
      prevTotalRef.current = state.total
    }
  }, [state.total])

  const animatedTotal = useAnimatedNumber(state.total, 500)
  const reviewQr = useQrDataUrl(reviewUrl, 200)
  const paidQr = useQrDataUrl(paid?.reviewUrl || null, 260)

  const dateStr = useMemo(
    () => now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' }),
    [now],
  )
  const timeStr = useMemo(
    () => now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    [now],
  )

  // ─── Экран «Спасибо» ─────────────────────────────────────────────────────
  if (paid) {
    const loyalty = paid.loyalty
    return (
      <div className="grid h-screen place-items-center overflow-hidden bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white">
        <style>{checkmarkStyle}</style>
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/4 left-1/3 h-72 w-72 animate-pulse rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative flex max-h-screen flex-col items-center px-8 text-center">
          <div className="mb-6 grid h-28 w-28 place-items-center rounded-full bg-white/15 backdrop-blur-xl ring-4 ring-white/30 cd-check-pop">
            <svg viewBox="0 0 52 52" className="h-20 w-20">
              <circle cx="26" cy="26" r="24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" />
              <path
                className="cd-check-path"
                d="M14 27 l8 8 l16 -18"
                fill="none"
                stroke="white"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-5xl font-semibold tracking-tight cd-fade-up">Спасибо за покупку!</p>
          <p className="mt-3 text-2xl text-white/90 cd-fade-up cd-d-1">{paid.paymentLabel}</p>
          <p className="mt-8 text-[7.5rem] font-bold leading-none tabular-nums tracking-tight cd-fade-up cd-d-2">
            {formatMoney(paid.total)} <span className="text-6xl text-white/80">₸</span>
          </p>
          {loyalty && loyalty.earned > 0 ? (
            <div className="mt-6 flex items-center gap-3 rounded-full bg-white/15 px-7 py-3 backdrop-blur-xl ring-1 ring-white/25 cd-fade-up cd-d-3">
              <span className="text-3xl">⭐</span>
              <p className="text-2xl font-semibold tabular-nums">
                +{formatMoney(loyalty.earned)} баллов
                <span className="ml-2 font-normal text-white/80">· всего {formatMoney(loyalty.totalAfter)}</span>
              </p>
            </div>
          ) : null}
          {paidQr ? (
            <div className="mt-8 flex items-center gap-5 rounded-3xl bg-white p-5 pr-7 text-left text-slate-900 shadow-2xl cd-fade-up cd-d-4">
              <img src={paidQr} alt="QR — оцените нас" className="h-36 w-36 rounded-xl" />
              <div>
                <p className="text-2xl font-bold">Оцените нас</p>
                <p className="mt-1 max-w-[16rem] text-base text-slate-500">
                  Наведите камеру телефона на QR-код и оставьте отзыв
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-10 text-xl text-white/70 cd-fade-up cd-d-3">Хорошего дня!</p>
          )}
        </div>
      </div>
    )
  }

  // ─── Idle — корзина пуста ────────────────────────────────────────────────
  if (state.cart.length === 0) {
    const qrCorner = reviewQr ? <ReviewQrCorner dataUrl={reviewQr} /> : null
    // Если есть реклама — крутим её во весь экран вместо часов
    if (playlist.length > 0) {
      return (
        <div className="relative h-screen w-screen overflow-hidden">
          <AdPlayer items={playlist} clock={timeStr} />
          {qrCorner}
        </div>
      )
    }
    // Рекламы нет, но в кэше есть товары с фото — авто-витрина каталога
    if (showcase.length > 0) {
      return (
        <div className="relative h-screen w-screen overflow-hidden">
          <ShowcasePlayer
            items={showcase}
            clock={timeStr}
            companyName={state.companyName || 'Orda Point'}
          />
          {qrCorner}
        </div>
      )
    }
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
        <div className="pointer-events-none absolute -top-40 -right-40 h-[28rem] w-[28rem] animate-pulse rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[28rem] w-[28rem] animate-pulse rounded-full bg-blue-500/10 blur-3xl [animation-delay:1.2s]" />
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="grid h-28 w-28 place-items-center rounded-[28px] bg-gradient-to-br from-emerald-400 to-teal-600 text-3xl font-bold text-white shadow-[0_20px_60px_-15px_rgba(16,185,129,0.6)] cd-float">
            OP
          </div>
          <h1 className="mt-10 text-6xl font-bold tracking-tight">{state.companyName || 'Orda Point'}</h1>
          <p className="mt-4 text-2xl text-slate-500 dark:text-slate-400">Добро пожаловать</p>
          <div className="mt-16 space-y-2 text-slate-600 dark:text-slate-300">
            <p className="text-8xl font-light tabular-nums tracking-tight">{timeStr}</p>
            <p className="text-xl capitalize text-slate-500 dark:text-slate-400">{dateStr}</p>
          </div>
        </div>
        {qrCorner}
        <style>{idleStyle}</style>
      </div>
    )
  }

  // ─── Active ──────────────────────────────────────────────────────────────
  const items = state.cart
  const lastAddedId = state.lastAddedId
  const customer = state.customer
  const count = items.length
  // Размер карточек от количества позиций: 1–3 очень крупные, 4–8 средние, дальше компактные
  const tier: CardTier = count <= 3 ? 'xl' : count <= 8 ? 'md' : 'sm'

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 -left-32 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
      <style>{activeStyle}</style>

      {/* Шапка: точка слева, клиент по центру, часы и дата справа */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-6 border-b border-slate-200/70 bg-white/80 px-10 py-5 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/80">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-base font-bold text-white shadow-lg shadow-emerald-500/30">
            OP
          </div>
          <div>
            <p className="text-2xl font-semibold">{state.companyName || 'Orda Point'}</p>
            {state.operatorName ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Кассир: {state.operatorName}</p>
            ) : null}
          </div>
        </div>

        {customer ? (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-3 shadow-sm dark:border-amber-700/40 dark:from-amber-950/30 dark:to-orange-950/30">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-500 text-white shadow-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
              </svg>
            </div>
            <div className="leading-tight">
              <p className="text-base font-semibold">{customer.name || 'Постоянный клиент'}</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Бонусы: <span className="font-bold text-amber-700 dark:text-amber-300">{customer.loyaltyPoints.toLocaleString('ru-RU')}</span>
              </p>
            </div>
          </div>
        ) : null}

        <div className="text-right text-slate-500 dark:text-slate-400">
          <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{timeStr}</p>
          <p className="text-sm capitalize">{dateStr}</p>
        </div>
      </header>

      {/* Карточная сетка позиций */}
      <main className="relative z-10 flex-1 overflow-hidden px-10 py-6">
        <CartCardGrid items={items} lastAddedId={lastAddedId || null} tier={tier} />
      </main>

      {/* Постоянная полоса итога */}
      <footer className="relative z-10 shrink-0 border-t border-slate-200/70 bg-white/85 px-10 py-6 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/85">
        <div className="flex items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              К оплате
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <p
                key={totalPulse /* перерисовка для анимации */}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-[5.5rem] font-bold leading-none tabular-nums tracking-tight text-transparent cd-total-pulse"
              >
                {formatMoney(animatedTotal)} <span className="text-[3rem]">₸</span>
              </p>
              {state.discount > 0 ? (
                <p className="text-4xl font-medium tabular-nums text-slate-400 line-through decoration-2 dark:text-slate-500 cd-discount-in">
                  {formatMoney(state.subtotal)} ₸
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 pb-1 text-right">
            {state.discount > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-2.5 shadow-sm dark:border-amber-600/40 dark:from-amber-950/40 dark:to-orange-950/40 cd-discount-in">
                <span className="text-xl">🏷️</span>
                <p className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  Скидка −{formatMoney(state.discount)} ₸
                </p>
              </div>
            ) : null}
            <p className="text-2xl font-medium text-slate-500 dark:text-slate-400">
              {count} {pluralPositions(count)}
              {customer ? (
                <span className="ml-4 text-amber-600 dark:text-amber-400">
                  Баллы: <span className="font-bold tabular-nums">{customer.loyaltyPoints.toLocaleString('ru-RU')}</span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Карточная сетка корзины ───────────────────────────────────────────────

type CardTier = 'xl' | 'md' | 'sm'

const TIER_STYLES: Record<
  CardTier,
  { grid: string; name: string; meta: string; total: string; letter: string; pad: string }
> = {
  xl: {
    grid: 'grid-cols-3 gap-8',
    name: 'text-3xl',
    meta: 'text-xl',
    total: 'text-3xl',
    letter: 'text-8xl',
    pad: 'p-5',
  },
  md: {
    grid: 'grid-cols-4 gap-5',
    name: 'text-xl',
    meta: 'text-base',
    total: 'text-2xl',
    letter: 'text-6xl',
    pad: 'p-4',
  },
  sm: {
    grid: 'grid-cols-6 gap-4',
    name: 'text-base',
    meta: 'text-sm',
    total: 'text-lg',
    letter: 'text-4xl',
    pad: 'p-3',
  },
}

function CartCardGrid({
  items,
  lastAddedId,
  tier,
}: {
  items: CartLine[]
  lastAddedId: string | null
  tier: CardTier
}) {
  const s = TIER_STYLES[tier]
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Автопрокрутка к последней добавленной позиции
  useEffect(() => {
    if (!lastAddedId || !scrollRef.current) return
    try {
      const el = scrollRef.current.querySelector(`[data-line-id="${CSS.escape(lastAddedId)}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch {
      /* CSS.escape/scrollIntoView — best effort */
    }
  }, [lastAddedId, items.length])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto pr-1">
      <div className={`grid ${s.grid} content-start pb-2`}>
        {items.map((line, idx) => {
          const isNew = !!lastAddedId && lastAddedId === line.id
          return (
            <div
              key={line.id || `idx-${idx}`}
              data-line-id={line.id || `idx-${idx}`}
              className={`flex flex-col overflow-hidden rounded-3xl border shadow-sm transition ${s.pad} ${
                isNew
                  ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/40 dark:border-emerald-500/60 dark:bg-emerald-950/30 cd-card-new'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
                <ProductImage name={line.name} imageUrl={line.image_url || null} letterClass={s.letter} />
                {line.quantity > 1 ? (
                  <span className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-3 py-1 text-base font-bold tabular-nums text-white backdrop-blur-sm">
                    ×{line.quantity}
                  </span>
                ) : null}
              </div>
              <p className={`mt-3 line-clamp-2 font-semibold leading-snug ${s.name}`}>{line.name}</p>
              <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                <p className={`tabular-nums text-slate-500 dark:text-slate-400 ${s.meta}`}>
                  {line.quantity} × {formatMoney(line.unit_price)} ₸
                </p>
                <p className={`font-bold tabular-nums ${s.total}`}>
                  {formatMoney(line.quantity * line.unit_price)} ₸
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Фото товара; без фото — не серый квадрат, а изумрудная градиентная карточка
 * с крупной первой буквой названия.
 */
function ProductImage({
  name,
  imageUrl,
  letterClass,
}: {
  name: string
  imageUrl: string | null
  letterClass: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [imageUrl])

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }
  const letter = (name.trim().charAt(0) || '·').toUpperCase()
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-700 dark:from-emerald-500 dark:via-teal-600 dark:to-emerald-900">
      <span className={`font-bold text-white/90 drop-shadow-lg ${letterClass}`}>{letter}</span>
    </div>
  )
}

// ─── QR «Оцените нас» в углу заставки ──────────────────────────────────────
function ReviewQrCorner({ dataUrl }: { dataUrl: string }) {
  return (
    <div className="absolute bottom-5 left-6 z-20 flex items-center gap-3 rounded-2xl bg-white/95 p-3 pr-4 shadow-xl backdrop-blur-sm">
      <img src={dataUrl} alt="QR — оцените нас" className="h-24 w-24 rounded-lg" />
      <div className="leading-tight text-slate-900">
        <p className="text-base font-bold">Оцените нас</p>
        <p className="mt-0.5 max-w-[9rem] text-xs text-slate-500">Наведите камеру и оставьте отзыв</p>
      </div>
    </div>
  )
}

// ─── Витрина каталога в простое ────────────────────────────────────────────
// Крутится, когда рекламный плейлист пуст: авто-слайды товаров с фото
// из локального кэша каталога, смена каждые ~8 секунд.
function ShowcasePlayer({
  items,
  clock,
  companyName,
}: {
  items: ShowcaseItem[]
  clock: string
  companyName: string
}) {
  const [index, setIndex] = useState(0)
  const safeIndex = index % items.length
  const current = items[safeIndex]

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), 8000)
    return () => clearInterval(t)
  }, [items.length])

  if (!current) return null

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[28rem] w-[28rem] animate-pulse rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[28rem] w-[28rem] animate-pulse rounded-full bg-teal-500/10 blur-3xl [animation-delay:1.2s]" />

      <header className="relative z-10 flex shrink-0 items-center justify-between px-10 py-6">
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-bold text-white shadow-lg shadow-emerald-500/30">
            OP
          </div>
          <p className="text-2xl font-semibold">{companyName}</p>
        </div>
        <p className="text-3xl font-light tabular-nums text-slate-500 dark:text-slate-400">{clock}</p>
      </header>

      <div key={current.id} className="relative z-10 flex flex-1 flex-col items-center justify-center px-10 pb-16 cd-slide-in">
        <div className="h-[52vh] w-[52vh] overflow-hidden rounded-[2.5rem] bg-white shadow-2xl ring-1 ring-slate-200/70 dark:bg-slate-900 dark:ring-slate-800">
          <ShowcaseImage item={current} />
        </div>
        <p className="mt-8 max-w-[70vw] truncate text-center text-5xl font-bold tracking-tight">{current.name}</p>
        <p className="mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-6xl font-bold tabular-nums text-transparent">
          {formatMoney(current.sale_price)} ₸
        </p>
      </div>

      {/* Точки-индикатор — ненавязчиво */}
      {items.length > 1 ? (
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {items.slice(0, 12).map((it, i) => (
            <span
              key={it.id}
              className={`h-2 rounded-full transition-all ${
                i === safeIndex % Math.min(items.length, 12)
                  ? 'w-6 bg-emerald-500'
                  : 'w-2 bg-slate-300 dark:bg-slate-700'
              }`}
            />
          ))}
        </div>
      ) : null}

      <style>{showcaseStyle}</style>
    </div>
  )
}

function ShowcaseImage({ item }: { item: ShowcaseItem }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [item.image_url])
  if (failed) {
    const letter = (item.name.trim().charAt(0) || '·').toUpperCase()
    return (
      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-700">
        <span className="text-[10rem] font-bold text-white/90 drop-shadow-lg">{letter}</span>
      </div>
    )
  }
  return (
    <img
      src={item.image_url}
      alt={item.name}
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

// ─── Плеер рекламы (idle) ──────────────────────────────────────────────────
// Крутит плейлист по кругу: картинки держим duration_sec секунд,
// видео играем до конца (без звука — иначе браузер блокирует автоплей).
function AdPlayer({ items, clock }: { items: AdItem[]; clock: string }) {
  const [index, setIndex] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Защита: если индекс вышел за границы (плейлист уменьшился) — сброс
  const safeIndex = index % items.length
  const current = items[safeIndex]

  const goNext = () => setIndex((i) => (i + 1) % items.length)

  // Картинки: таймер на duration_sec. Видео: переключаем по onEnded.
  useEffect(() => {
    if (!current) return
    if (current.media_type === 'image') {
      const sec = current.duration_sec && current.duration_sec > 0 ? current.duration_sec : 8
      const t = setTimeout(goNext, sec * 1000)
      return () => clearTimeout(t)
    }
    // video — пытаемся запустить воспроизведение
    const v = videoRef.current
    if (v) {
      v.currentTime = 0
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => { /* автоплей мог не стартовать */ })
    }
    // подстраховка: если видео зависло/не доиграло — максимум 5 минут на ролик
    const guard = setTimeout(goNext, 5 * 60 * 1000)
    return () => clearTimeout(guard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, current?.id])

  if (!current) return null

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {current.media_type === 'video' ? (
        <video
          ref={videoRef}
          key={current.id}
          src={current.url}
          className="h-full w-full object-contain"
          autoPlay
          muted
          playsInline
          onEnded={goNext}
          onError={goNext}
        />
      ) : (
        <img
          key={current.id}
          src={current.url}
          alt={current.title || ''}
          className="h-full w-full object-contain cd-ad-fade"
          onError={goNext}
        />
      )}

      {/* Часы в углу — ненавязчиво */}
      <div className="absolute bottom-5 right-6 rounded-2xl bg-black/40 px-4 py-2 text-2xl font-light tabular-nums text-white/80 backdrop-blur-sm">
        {clock}
      </div>

      <style>{adStyle}</style>
    </div>
  )
}

const adStyle = `
  @keyframes cd-ad-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .cd-ad-fade { animation: cd-ad-fade 600ms ease-out both; }
`

const showcaseStyle = `
  @keyframes cd-slide-in {
    from { opacity: 0; transform: translateY(18px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .cd-slide-in { animation: cd-slide-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both; }
`

// Стили анимаций (Web Animations / CSS keyframes). Без сторонних библиотек.
const checkmarkStyle = `
  @keyframes cd-check-pop {
    0% { transform: scale(0.2); opacity: 0; }
    60% { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); }
  }
  @keyframes cd-check-stroke {
    from { stroke-dashoffset: 60; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes cd-fade-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .cd-check-pop { animation: cd-check-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .cd-check-path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: cd-check-stroke 500ms 300ms ease-out forwards; }
  .cd-fade-up { animation: cd-fade-up 480ms 200ms ease-out both; }
  .cd-d-1 { animation-delay: 360ms; }
  .cd-d-2 { animation-delay: 520ms; }
  .cd-d-3 { animation-delay: 720ms; }
  .cd-d-4 { animation-delay: 900ms; }
`

const idleStyle = `
  @keyframes cd-float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-8px) rotate(-2deg); }
  }
  .cd-float { animation: cd-float 4s ease-in-out infinite; }
`

const activeStyle = `
  @keyframes cd-card-in {
    from { opacity: 0; transform: translateY(24px) scale(0.94); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes cd-card-glow {
    0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0), 0 2px 6px -1px rgba(0,0,0,0.05); }
    30% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0.25), 0 6px 18px -4px rgba(16,185,129,0.45); }
    100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0), 0 2px 6px -1px rgba(0,0,0,0.05); }
  }
  .cd-card-new { animation: cd-card-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both, cd-card-glow 1400ms ease-out both; }

  @keyframes cd-total-pulse {
    0% { transform: scale(1); }
    25% { transform: scale(1.04); }
    100% { transform: scale(1); }
  }
  .cd-total-pulse { animation: cd-total-pulse 380ms cubic-bezier(0.34, 1.56, 0.64, 1); transform-origin: left center; }

  @keyframes cd-discount-in {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .cd-discount-in { animation: cd-discount-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both; }
`
