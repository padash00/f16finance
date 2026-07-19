'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { TableSkeleton } from '@/components/skeleton'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Row = {
  id: string
  item_name: string
  barcode: string | null
  unit: string | null
  quantity: number
  remaining: number
  production_date: string | null
  expiry_date: string
  days_left: number
  status: 'expired' | 'soon' | 'ok'
  received_at: string | null
  kind: 'supplier' | 'posting'
  location_name: string
}
type Data = { rows: Row[]; summary: { expired: number; soon: number; depleted?: number; total: number } }

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')

function daysLabel(d: number) {
  if (d < 0) return `просрочен ${Math.abs(d)} дн.`
  if (d === 0) return 'сегодня'
  return `через ${d} дн.`
}

export default function StoreExpiryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'expired' | 'soon'>('all')
  const [showDepleted, setShowDepleted] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/store/expiry', { cache: 'no-store' })
        const j = await res.json().catch(() => null)
        if (!res.ok) throw new Error(j?.error || `Ошибка (${res.status})`)
        if (!cancelled) setData(j?.data || { rows: [], summary: { expired: 0, soon: 0, total: 0 } })
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Не удалось загрузить')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const depletedCount = useMemo(() => (data?.rows || []).filter((r) => (r.remaining ?? 0) <= 0.0005).length, [data?.rows])

  const rows = useMemo(() => {
    let all = data?.rows || []
    // По FIFO партия израсходована — прячем, если не попросили показать
    if (!showDepleted) all = all.filter((r) => (r.remaining ?? 0) > 0.0005)
    if (filter === 'all') return all
    return all.filter((r) => r.status === filter)
  }, [data?.rows, filter, showDepleted])

  const body = (
    <div className="space-y-4">
      {/* Сводка */}
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'all', label: 'Всего партий', value: data?.summary.total ?? 0, cls: 'text-foreground' },
          { key: 'soon', label: 'Истекают (≤14 дн.)', value: data?.summary.soon ?? 0, cls: 'text-amber-700 dark:text-amber-300' },
          { key: 'expired', label: 'Просрочено', value: data?.summary.expired ?? 0, cls: 'text-rose-600 dark:text-rose-300' },
        ] as const).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key as any)}
            className={`rounded-xl border p-3 text-left transition ${filter === c.key ? 'border-emerald-400/40 bg-emerald-500/[0.06]' : 'border-border bg-white dark:bg-white/[0.02] hover:border-slate-300 dark:hover:border-white/20'}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className={`mt-1 font-mono text-xl font-semibold tabular-nums sm:text-2xl ${c.cls}`}>{c.value}</div>
          </button>
        ))}
      </div>

      {error ? <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</Card> : null}

      {depletedCount > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-600"
            checked={showDepleted}
            onChange={(e) => setShowDepleted(e.target.checked)}
          />
          Показать израсходованные партии ({depletedCount}) — по FIFO их остаток уже продан или списан
        </label>
      )}

      <Card className="border-border bg-card/70 p-0">
        <CardContent className="p-4 sm:p-5">
          {loading ? (
            <div className="py-2"><TableSkeleton rows={6} cols={6} /></div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {filter === 'all' ? 'Партий со сроком годности пока нет. Срок указывается при приёмке/оприходовании.' : 'Ничего не найдено по фильтру.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pl-2 pr-2 font-normal">Товар</th>
                    <th className="py-2 px-2 font-normal">Где</th>
                    <th className="py-2 px-2 text-right font-normal">Остаток партии</th>
                    <th className="py-2 px-2 font-normal">Изготовлен</th>
                    <th className="py-2 px-2 font-normal">Годен до</th>
                    <th className="py-2 px-2 font-normal">Осталось</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {rows.map((r) => {
                    const depleted = (r.remaining ?? 0) <= 0.0005
                    return (
                    <tr key={r.id} className={depleted ? 'opacity-50' : r.status === 'expired' ? 'bg-rose-500/[0.04]' : ''}>
                      <td className="py-2 pl-2 pr-2">
                        <div className="font-medium text-foreground">{r.item_name}</div>
                        {r.barcode ? <div className="font-mono text-[10px] text-muted-foreground tabular-nums">{r.barcode}</div> : null}
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{r.location_name}</td>
                      <td className="py-2 px-2 text-right text-xs tabular-nums">
                        {depleted ? (
                          <span className="text-muted-foreground">израсходована · было {r.quantity}{r.unit ? ` ${r.unit}` : ''}</span>
                        ) : (
                          <span className="font-medium text-foreground">{r.remaining} из {r.quantity}{r.unit ? ` ${r.unit}` : ''}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground tabular-nums">{fmtDate(r.production_date)}</td>
                      <td className="py-2 px-2 text-xs tabular-nums">{fmtDate(r.expiry_date)}</td>
                      <td className="py-2 px-2">
                        {depleted ? (
                          <span className="text-xs text-muted-foreground">{daysLabel(r.days_left)}</span>
                        ) : r.status === 'expired' ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-200"><AlertTriangle className="mr-1 h-3 w-3" />{daysLabel(r.days_left)}</Badge>
                        ) : r.status === 'soon' ? (
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200">{daysLabel(r.days_left)}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{daysLabel(r.days_left)}</span>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )

  if (embedded) return body

  return (
    <div className="app-page-wide space-y-4">
      <AdminPageHeader
        title="Срок годности"
        description="Партии товара по сроку годности — что просрочено и что скоро истекает"
        icon={<CalendarClock className="h-5 w-5" />}
        accent="emerald"
        backHref="/store/documents"
      />
      {body}
    </div>
  )
}
