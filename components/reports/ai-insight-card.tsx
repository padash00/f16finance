'use client'

import { useEffect, useRef, useState } from 'react'
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
}

/**
 * AI-инсайт для текущего среза /reports.
 * Запрашивается один раз при изменении периода (с дебаунсом 500ms).
 * Показывает короткий комментарий ассистента и кнопку «обновить».
 */
export function AIInsightCard({ dateFrom, dateTo, totals, totalsPrev, topIncome, topExpense, cashlessLabel }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestKey = `${dateFrom}|${dateTo}|${totals.incomeTotal}|${totals.expenseTotal}`
  const lastKeyRef = useRef<string>('')

  async function load(force = false) {
    if (!force && requestKey === lastKeyRef.current) return
    if (!totals.incomeTotal && !totals.expenseTotal) return
    lastKeyRef.current = requestKey
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

  useEffect(() => {
    const t = setTimeout(() => void load(false), 500)
    return () => clearTimeout(t)
  }, [requestKey])

  if (!text && !loading && !error) return null

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-200">AI-комментарий</h3>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-600 dark:text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
              title="Перегенерировать"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'думаю…' : 'обновить'}
            </button>
          </div>
          {error ? (
            <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
          ) : loading && !text ? (
            <div className="space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-violet-500/20" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-violet-500/20" />
            </div>
          ) : (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-100">{text}</p>
          )}
        </div>
      </div>
    </div>
  )
}
