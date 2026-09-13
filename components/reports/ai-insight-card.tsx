'use client'

import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'

interface Props {
  dateFrom: string
  dateTo: string
  totals: {
    incomeTotal?: number
    expenseTotal?: number
    profit?: number
    incomeCash?: number
    incomeKaspi?: number
    incomeOnline?: number
    incomeCard?: number
  }
  totalsPrev?: { incomeTotal?: number; expenseTotal?: number; profit?: number }
  topIncome?: { name: string; value: number }[]
  topExpense?: { name: string; value: number }[]
  cashlessLabel?: string
  /** Внутри другой карточки: без своей рамки и градиента */
  embedded?: boolean
}

/**
 * AI-инсайт для текущего среза /reports.
 * Запрашивается только по кнопке: раньше вызов уходил при каждой смене
 * фильтра и тратил деньги на срезы, которые никто не читал.
 * При смене среза старый комментарий сбрасывается — он был про другие цифры.
 */
export function AIInsightCard({ dateFrom, dateTo, totals, totalsPrev, topIncome, topExpense, cashlessLabel, embedded = false }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestKey = `${dateFrom}|${dateTo}|${totals.incomeTotal}|${totals.expenseTotal}`

  useEffect(() => {
    setText(null)
    setError(null)
  }, [requestKey])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/reports/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo, totals, totalsPrev, topIncome, topExpense, cashlessLabel }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'AI failed')
      setText(data.text)
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить AI-комментарий')
    } finally {
      setLoading(false)
    }
  }

  if (!totals.incomeTotal && !totals.expenseTotal) return null

  return (
    <div className={embedded ? '' : 'rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-4'}>
      <div className="flex items-start gap-3">
        <div className={`grid shrink-0 place-items-center bg-gradient-to-br from-violet-500 to-fuchsia-500 ${embedded ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl shadow-lg shadow-violet-500/30'}`}>
          <Sparkles className={embedded ? 'h-4 w-4 text-white' : 'h-5 w-5 text-white'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-200">AI-комментарий</h3>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-600 dark:text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'думаю…' : text ? 'обновить' : 'получить'}
            </button>
          </div>
          {error ? (
            <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
          ) : loading && !text ? (
            <div className="space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-violet-500/20" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-violet-500/20" />
            </div>
          ) : text ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-100">{text}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Короткий разбор выбранного периода: что выросло, что просело и на что обратить внимание.</p>
          )}
        </div>
      </div>
    </div>
  )
}
