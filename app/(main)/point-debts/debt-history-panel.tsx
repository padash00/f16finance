'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, History, Loader2, RefreshCw, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { weekStartUtcISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'

type DebtEvent = {
  id: string
  debt_id: string | null
  point_debt_item_id: string | null
  entity_kind: 'debt' | 'point_debt_item'
  event_type: string
  event_label: string
  company_id: string | null
  company_name: string
  operator_id: string | null
  client_name: string | null
  debtor_name: string
  occurred_at: string
  business_date: string | null
  week_start: string | null
  source: string | null
  actor_kind: string
  actor_name_resolved: string
  point_device_name: string | null
  delta_amount: number | null
  amount_before: number | null
  amount_after: number | null
  status_before: string | null
  status_after: string | null
  item_name: string | null
  local_ref: string | null
}

type HistoryPayload = {
  weekStart: string
  weekEnd: string
  events: DebtEvent[]
  total: number
  truncated?: boolean
}

const money = (value: number | null | undefined) => formatMoney(Number(value || 0))

function eventTone(eventType: string) {
  if (eventType.includes('settled') || eventType.includes('paid')) return 'border-emerald-500/30 bg-emerald-500/5'
  if (eventType.includes('deleted')) return 'border-red-500/30 bg-red-500/5'
  if (eventType.includes('changed') || eventType.includes('updated') || eventType.includes('reassigned')) {
    return 'border-amber-500/30 bg-amber-500/5'
  }
  return 'border-border bg-card'
}

function amountText(event: DebtEvent) {
  const settled = event.event_type.includes('settled') || event.event_type.includes('paid')
  if (settled) {
    const amount = event.amount_after ?? event.amount_before
    return amount != null ? `− ${money(amount)}` : null
  }
  if (event.event_type.includes('added') || event.event_type.includes('created')) {
    const amount = event.amount_after ?? event.delta_amount
    return amount != null ? `+ ${money(amount)}` : null
  }
  if (event.amount_before != null && event.amount_after != null && event.amount_before !== event.amount_after) {
    return `${money(event.amount_before)} → ${money(event.amount_after)}`
  }
  return event.amount_after != null ? money(event.amount_after) : null
}

export function DebtHistoryPanel() {
  const [open, setOpen] = useState(false)
  const [weekStart, setWeekStart] = useState(() => weekStartUtcISO(new Date()))
  const [data, setData] = useState<HistoryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | 'purchase' | 'payment' | 'change'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ weekStart, limit: '500' })
      const res = await fetch(`/api/admin/point-debts/history?${q.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `Ошибка ${res.status}`)
      setData(body.data as HistoryPayload)
    } catch (e: any) {
      setData(null)
      setError(e?.message || 'Не удалось загрузить историю')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.events || []).filter((event) => {
      const payment = event.event_type.includes('settled') || event.event_type.includes('paid')
      const purchase = event.event_type.includes('added') || event.event_type.includes('created')
      const change = !payment && !purchase
      if (kind === 'purchase' && !purchase) return false
      if (kind === 'payment' && !payment) return false
      if (kind === 'change' && !change) return false
      if (!q) return true
      return [
        event.debtor_name,
        event.item_name || '',
        event.event_label,
        event.actor_name_resolved,
        event.company_name,
        event.point_device_name || '',
        event.source || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [data, kind, search])

  const stats = useMemo(() => {
    const events = data?.events || []
    const debtors = new Set(events.map((e) => e.debtor_name).filter(Boolean))
    const purchases = events.filter((e) => e.event_type.includes('added') || e.event_type.includes('created')).length
    const payments = events.filter((e) => e.event_type.includes('settled') || e.event_type.includes('paid')).length
    return { debtors: debtors.size, purchases, payments }
  }, [data])

  return (
    <>
      <Button
        type="button"
        className="fixed bottom-6 right-6 z-40 shadow-lg"
        onClick={() => setOpen(true)}
        aria-label="Открыть историю долгов"
      >
        <History className="mr-2 h-4 w-4" />
        История долгов
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/45" onMouseDown={() => setOpen(false)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l bg-background shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <History className="h-5 w-5" />
                  История долгов
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Кто, что и когда сделал с долгом</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-3 border-b px-5 py-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-44 text-xs font-medium text-muted-foreground">
                  Неделя
                  <span className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                    <CalendarDays className="h-4 w-4" />
                    <input
                      type="date"
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                      className="w-full bg-transparent outline-none"
                    />
                  </span>
                </label>
                <div className="relative min-w-64 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Должник, товар, сотрудник, источник..."
                    className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Button variant="outline" onClick={() => void load()} disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Обновить
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  ['all', 'Все'],
                  ['purchase', 'Покупки'],
                  ['payment', 'Погашения'],
                  ['change', 'Изменения'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      kind === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {data ? (
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">Должников</div><div className="mt-1 text-lg font-semibold">{stats.debtors}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">Создано</div><div className="mt-1 text-lg font-semibold">{stats.purchases}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-muted-foreground">Погашено</div><div className="mt-1 text-lg font-semibold">{stats.payments}</div></div>
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && !data ? (
                <div className="flex h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка истории…
                </div>
              ) : error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
              ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Событий за выбранный период нет</div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((event) => {
                    const amount = amountText(event)
                    return (
                      <div key={event.id} className={`rounded-xl border p-4 ${eventTone(event.event_type)}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{event.debtor_name}</span>
                              <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">{event.event_label}</span>
                            </div>
                            {event.item_name ? <div className="mt-1 text-sm">{event.item_name}</div> : null}
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{new Date(event.occurred_at).toLocaleString('ru-RU')}</span>
                              <span>Автор: {event.actor_name_resolved}</span>
                              <span>{event.company_name}</span>
                              {event.point_device_name ? <span>{event.point_device_name}</span> : null}
                              {event.source ? <span>Источник: {event.source}</span> : null}
                            </div>
                          </div>
                          {amount ? <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{amount}</div> : null}
                        </div>
                        {event.status_before !== event.status_after && (event.status_before || event.status_after) ? (
                          <div className="mt-2 text-xs text-muted-foreground">Статус: {event.status_before || '—'} → {event.status_after || '—'}</div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {data?.truncated ? (
                <p className="mt-4 text-center text-xs text-muted-foreground">Показаны последние 500 событий за неделю. Используйте поиск и фильтры.</p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
