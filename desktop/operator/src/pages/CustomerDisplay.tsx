import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Экран клиента (Customer Display).
 *
 * Грузится на второй монитор в режиме "extend" через ?role=customer.
 * Главный процесс Electron открывает это окно по запросу из настроек
 * оператора. Состояние корзины приходит через IPC канал customer-display:state.
 *
 * Состояния:
 *  - idle      — корзина пуста, показываем приветствие и часы
 *  - active    — корзина не пуста, показываем позиции и итог
 *  - paid      — только что оплачен чек, на 5 секунд показываем «Спасибо»
 */

type CartLine = {
  id?: string
  name: string
  quantity: number
  unit_price: number
  comment?: string | null
}

type DisplayCustomer = {
  name: string | null
  phone: string | null
  loyaltyPoints: number
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
}

type DisplayEvent =
  | { kind: 'update'; state: DisplayState }
  | { kind: 'paid'; total: number; paymentLabel: string; lines: CartLine[] }
  | { kind: 'clear' }

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

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>(emptyState)
  const [paid, setPaid] = useState<{ total: number; paymentLabel: string; lines: CartLine[] } | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [totalPulse, setTotalPulse] = useState(0)
  const prevTotalRef = useRef(0)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const off = window.electron.customerDisplay.onState((raw) => {
      const event = raw as DisplayEvent
      if (event?.kind === 'update') {
        setState(event.state)
        setPaid(null)
      } else if (event?.kind === 'paid') {
        setPaid({ total: event.total, paymentLabel: event.paymentLabel, lines: event.lines })
        window.setTimeout(() => {
          setPaid(null)
          setState(emptyState)
        }, 5000)
      } else if (event?.kind === 'clear') {
        setState(emptyState)
        setPaid(null)
      }
    })
    return () => off()
  }, [])

  // Триггер пульсации итога при каждом изменении total
  useEffect(() => {
    if (state.total !== prevTotalRef.current) {
      setTotalPulse((n) => n + 1)
      prevTotalRef.current = state.total
    }
  }, [state.total])

  const animatedTotal = useAnimatedNumber(state.total, 500)

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
    return (
      <div className="grid h-screen place-items-center overflow-hidden bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white">
        <style>{checkmarkStyle}</style>
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/4 left-1/3 h-72 w-72 animate-pulse rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative text-center">
          <div className="mx-auto mb-8 grid h-36 w-36 place-items-center rounded-full bg-white/15 backdrop-blur-xl ring-4 ring-white/30 cd-check-pop">
            <svg viewBox="0 0 52 52" className="h-24 w-24">
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
          <p className="mt-4 text-2xl text-white/90 cd-fade-up cd-d-1">{paid.paymentLabel}</p>
          <p className="mt-12 text-[10rem] font-bold leading-none tabular-nums tracking-tight cd-fade-up cd-d-2">
            {formatMoney(paid.total)} <span className="text-7xl text-white/80">₸</span>
          </p>
          <p className="mt-12 text-xl text-white/70 cd-fade-up cd-d-3">Хорошего дня!</p>
        </div>
      </div>
    )
  }

  // ─── Idle — корзина пуста ────────────────────────────────────────────────
  if (state.cart.length === 0) {
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
        <style>{idleStyle}</style>
      </div>
    )
  }

  // ─── Active ──────────────────────────────────────────────────────────────
  const items = state.cart
  const lastAddedId = state.lastAddedId
  const customer = state.customer

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 -left-32 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
      <style>{activeStyle}</style>

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-6 border-b border-slate-200/70 bg-white/80 px-10 py-6 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/80">
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

      <main className="relative z-10 grid flex-1 grid-cols-[1fr_auto] gap-8 overflow-hidden p-10">
        <section className="flex flex-col overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm uppercase tracking-widest text-slate-500 dark:text-slate-400">Ваш заказ</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Позиций: {items.length}</p>
          </div>
          <div className="flex-1 space-y-3 overflow-auto pr-1">
            {[...items].reverse().map((line, idx) => {
              const isNew = lastAddedId && lastAddedId === line.id
              return (
                <div
                  key={(line.id || `idx-${idx}`)}
                  className={`flex items-center justify-between gap-4 rounded-2xl border px-6 py-4 transition shadow-sm cd-row ${
                    isNew
                      ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/40 dark:border-emerald-500/60 dark:bg-emerald-950/30 cd-row-new'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-2xl font-medium">{line.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {line.quantity} × {formatMoney(line.unit_price)} ₸
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatMoney(line.quantity * line.unit_price)} ₸
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="flex w-[26rem] flex-col gap-4">
          {state.discount > 0 ? (
            <div className="rounded-3xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-50 to-orange-100 p-6 shadow-md dark:border-amber-500/40 dark:from-amber-950/30 dark:to-orange-950/30">
              <p className="text-sm uppercase tracking-widest text-amber-700 dark:text-amber-300">Скидка</p>
              <p className="mt-2 text-5xl font-bold tabular-nums text-amber-700 dark:text-amber-200">
                −{formatMoney(state.discount)} <span className="text-2xl">₸</span>
              </p>
              <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-400/80">
                Из {formatMoney(state.subtotal)} ₸
              </p>
            </div>
          ) : null}

          <div className="flex-1 rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90 flex flex-col justify-end">
            <p className="text-2xl font-medium text-slate-500 dark:text-slate-400">Итого</p>
            <p
              key={totalPulse /* перерисовка для анимации */}
              className="mt-2 bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-[6.5rem] font-bold leading-none tabular-nums tracking-tight text-transparent cd-total-pulse"
            >
              {formatMoney(animatedTotal)}
            </p>
            <p className="mt-2 text-right text-3xl font-semibold text-slate-400 dark:text-slate-500">₸</p>
          </div>
        </aside>
      </main>
    </div>
  )
}

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
`

const idleStyle = `
  @keyframes cd-float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-8px) rotate(-2deg); }
  }
  .cd-float { animation: cd-float 4s ease-in-out infinite; }
`

const activeStyle = `
  @keyframes cd-row-in {
    from { opacity: 0; transform: translateX(40px) scale(0.96); }
    to { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes cd-row-glow {
    0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0), 0 2px 6px -1px rgba(0,0,0,0.05); }
    30% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0.25), 0 6px 18px -4px rgba(16,185,129,0.45); }
    100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0), 0 2px 6px -1px rgba(0,0,0,0.05); }
  }
  .cd-row-new { animation: cd-row-in 360ms cubic-bezier(0.22, 1, 0.36, 1) both, cd-row-glow 1400ms ease-out both; }

  @keyframes cd-total-pulse {
    0% { transform: scale(1); }
    25% { transform: scale(1.04); }
    100% { transform: scale(1); }
  }
  .cd-total-pulse { animation: cd-total-pulse 380ms cubic-bezier(0.34, 1.56, 0.64, 1); transform-origin: right center; }
`
