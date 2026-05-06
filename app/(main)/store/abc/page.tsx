'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { isAbortError } from '@/lib/is-abort-error'

type AbcRow = {
  item_id: string
  name: string
  category: string | null
  abc_class: 'A' | 'B' | 'C'
  revenue?: number
  stock_value?: number
  qty: number
}

type AbcResponse = {
  ok: boolean
  data?: AbcRow[]
  summary?: Record<string, number>
  mode?: 'sales' | 'stock'
  error?: string
}

export default function StoreAbcPage() {
  const [tab, setTab] = useState<'sales' | 'stock'>('sales')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AbcRow[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})

  const load = async (mode: 'sales' | 'stock' = tab, signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/inventory/abc?mode=${mode}&days=30`, { cache: 'no-store', signal })
      const json = (await res.json().catch(() => null)) as AbcResponse | null
      if (signal?.aborted) return
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить ABC')
      setRows(json.data || [])
      setSummary(json.summary || {})
    } catch (e: any) {
      if (isAbortError(e) || signal?.aborted) return
      setRows([])
      setSummary({})
      setError(e?.message || 'Не удалось загрузить ABC')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(tab, ac.signal)
    return () => ac.abort()
  }, [tab])

  const topRows = useMemo(() => rows.slice(0, 20), [rows])

  return (
    <div className="app-page-wide space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
            <BarChart3 className="h-5 w-5 text-violet-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">ABC-анализ</h1>
            <p className="truncate text-xs text-muted-foreground">
              {tab === 'sales' ? 'По продажам витрины' : 'По запасам склада'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load(tab)} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <button
          type="button"
          onClick={() => setTab('sales')}
          className={`rounded-lg px-3 py-2 text-sm ${tab === 'sales' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}
        >
          По продажам (витрина)
        </button>
        <button
          type="button"
          onClick={() => setTab('stock')}
          className={`rounded-lg px-3 py-2 text-sm ${tab === 'stock' ? 'bg-white/10 text-foreground' : 'text-muted-foreground'}`}
        >
          По запасам (склад)
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div> : null}

      <Card className="border-white/10 bg-card/70 p-5">
        <div className="mb-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>A: {summary.count_a || 0}</span>
          <span>B: {summary.count_b || 0}</span>
          <span>C: {summary.count_c || 0}</span>
        </div>
        {loading && topRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Загрузка...</div>
        ) : topRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Нет данных.</div>
        ) : (
          <div className="space-y-2">
            {topRows.map((row) => (
              <div key={row.item_id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.category || 'Без категории'} · {row.abc_class}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p>{tab === 'sales' ? Math.round(Number(row.revenue || 0)).toLocaleString('ru-RU') : Math.round(Number(row.stock_value || 0)).toLocaleString('ru-RU')} ₸</p>
                    <p className="text-muted-foreground">qty: {row.qty}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
