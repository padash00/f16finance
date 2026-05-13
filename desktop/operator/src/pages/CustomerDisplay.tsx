import { useEffect, useState } from 'react'

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

type DisplayState = {
  companyName?: string | null
  operatorName?: string | null
  cart: CartLine[]
  subtotal: number
  discount: number
  total: number
  paymentMethod?: 'cash' | 'kaspi' | 'mixed' | null
}

type DisplayEvent =
  | { kind: 'update'; state: DisplayState }
  | { kind: 'paid'; total: number; paymentLabel: string; lines: CartLine[] }
  | { kind: 'clear' }

const emptyState: DisplayState = {
  companyName: null,
  operatorName: null,
  cart: [],
  subtotal: 0,
  discount: 0,
  total: 0,
  paymentMethod: null,
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('ru-RU')
}

export default function CustomerDisplay() {
  const [state, setState] = useState<DisplayState>(emptyState)
  const [paid, setPaid] = useState<{ total: number; paymentLabel: string; lines: CartLine[] } | null>(null)
  const [now, setNow] = useState(() => new Date())

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
        // через 5 секунд возвращаемся в idle
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

  const dateStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' })
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  // Экран «Спасибо»
  if (paid) {
    return (
      <div className="grid h-screen place-items-center bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white">
        <div className="text-center">
          <div className="mx-auto mb-8 grid h-32 w-32 place-items-center rounded-full bg-white/20 backdrop-blur">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-16 w-16">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-4xl font-semibold">Спасибо за покупку!</p>
          <p className="mt-3 text-2xl text-white/90">{paid.paymentLabel}</p>
          <p className="mt-10 text-8xl font-bold tabular-nums">{formatMoney(paid.total)} ₸</p>
          <p className="mt-10 text-lg text-white/70">Хорошего дня!</p>
        </div>
      </div>
    )
  }

  // Idle — корзина пуста
  if (state.cart.length === 0) {
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
        <div className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl font-bold text-white shadow-2xl shadow-emerald-500/40">
            OP
          </div>
          <h1 className="mt-8 text-5xl font-bold">{state.companyName || 'Orda Point'}</h1>
          <p className="mt-4 text-2xl text-slate-500 dark:text-slate-400">Добро пожаловать!</p>
          <div className="mt-16 space-y-2 text-slate-600 dark:text-slate-300">
            <p className="text-7xl font-light tabular-nums">{timeStr}</p>
            <p className="text-xl capitalize">{dateStr}</p>
          </div>
        </div>
      </div>
    )
  }

  // Active — корзина наполнена
  const items = state.cart
  const visible = items.slice(-5).reverse()
  const hidden = Math.max(0, items.length - visible.length)

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-32 right-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 -left-32 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/80 px-10 py-6 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/80">
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
        <div className="text-right text-slate-500 dark:text-slate-400">
          <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{timeStr}</p>
          <p className="text-sm capitalize">{dateStr}</p>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-6 overflow-hidden p-10">
        <div className="flex-1 overflow-hidden">
          <p className="text-sm uppercase tracking-widest text-slate-500 dark:text-slate-400">Ваш заказ</p>
          {hidden > 0 ? (
            <p className="mt-1 text-xs text-slate-400">… и ещё {hidden} ранее</p>
          ) : null}
          <div className="mt-4 space-y-3 overflow-auto">
            {visible.map((line, idx) => (
              <div
                key={line.id || idx}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
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
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex items-center justify-between text-base text-slate-500 dark:text-slate-400">
            <span>Позиций</span>
            <span>{items.length}</span>
          </div>
          {state.discount > 0 ? (
            <div className="mt-1 flex items-center justify-between text-base text-amber-700 dark:text-amber-300">
              <span>Скидка</span>
              <span>−{formatMoney(state.discount)} ₸</span>
            </div>
          ) : null}
          <div className="mt-6 flex items-end justify-between">
            <span className="text-2xl font-medium text-slate-500 dark:text-slate-400">Итого</span>
            <span className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-8xl font-bold tabular-nums text-transparent">
              {formatMoney(state.total)} ₸
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
