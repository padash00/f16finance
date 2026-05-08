/**
 * Калькулятор сдачи — оператор вводит сколько денег дал клиент,
 * сразу видит сколько вернуть. Без необходимости считать в голове.
 */

import { useState } from 'react'
import { Banknote } from 'lucide-react'

import { formatMoney, parseMoney } from '@/lib/utils'

type ChangeCalculatorProps = {
  amountDue: number
  paymentLabel?: string
}

export function ChangeCalculator({ amountDue, paymentLabel = 'Получено' }: ChangeCalculatorProps) {
  const [received, setReceived] = useState('')
  const receivedNum = parseMoney(received)
  const change = receivedNum - amountDue
  const isExact = change === 0
  const isShort = change < 0
  const isOver = change > 0

  // Подсказки — частые номиналы (округление до ближайшей "удобной" суммы)
  const suggestions: number[] = []
  if (amountDue > 0) {
    const round500 = Math.ceil(amountDue / 500) * 500
    const round1000 = Math.ceil(amountDue / 1000) * 1000
    const round5000 = Math.ceil(amountDue / 5000) * 5000
    suggestions.push(round500)
    if (round1000 !== round500) suggestions.push(round1000)
    if (round5000 !== round1000 && round5000 !== round500) suggestions.push(round5000)
  }

  return (
    <div className="border-t border-slate-200 px-5 py-3 dark:border-slate-800">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Banknote className="h-4 w-4 text-emerald-500" />
        Калькулятор сдачи
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">{paymentLabel}</label>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder={String(amountDue)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">Сдача</label>
          <div
            className={`flex h-10 items-center rounded-lg border bg-white px-3 text-sm font-bold tabular-nums dark:bg-slate-800 ${
              !received
                ? 'border-slate-200 text-slate-400 dark:border-slate-700'
                : isExact
                  ? 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                  : isShort
                    ? 'border-rose-500 text-rose-600 dark:border-rose-400 dark:text-rose-400'
                    : 'border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-400'
            }`}
          >
            {!received
              ? '—'
              : isShort
                ? `Не хватает ${formatMoney(Math.abs(change))} ₸`
                : isExact
                  ? 'Без сдачи'
                  : `${formatMoney(change)} ₸`}
          </div>
        </div>
      </div>
      {suggestions.length > 0 && !received && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-500 self-center">Быстро:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setReceived(String(s))}
              className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {formatMoney(s)} ₸
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
