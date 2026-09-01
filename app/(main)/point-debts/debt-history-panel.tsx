'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { History, Loader2, RefreshCw, Search } from 'lucide-react'

import { AppModal } from '@/components/ui/app-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
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

function eventAccent(eventType: string) {
  if (eventType.includes('settled') || eventType.includes('paid')) {
    return 'border-l-emerald-400 bg-emerald-50/55 dark:bg-emerald-500/5'
  }
  if (eventType.includes('deleted')) {
    return 'border-l-red-400 bg-red-50/55 dark:bg-red-500/5'
  }
  if (eventType.includes('changed') || eventType.includes('updated') || eventType.includes('reassigned')) {
    return 'border-l-amber-400 bg-amber-50/55 dark:bg-amber-500/5'
  }
  return 'border-l-sky-400 bg-white dark:bg-white/[0.025]'
}

export function DebtHistoryPanel() {
  const [open, setOpen] = useState(false)
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)
  const [weekStart, setWeekStart] = useState(() => weekStartUtcISO(new Date()))
  const [data, setData] = useState<HistoryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | 'purchase' | 'payment' | 'change'>('all')

  useEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-tour="page-header"]')
    const host = header?.querySelector<HTMLElement>('div.flex.flex-wrap.items-center.gap-2') ?? null
    setActionHost(host)
  }, [])

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

  const historyAction = (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="h-8 rounded-xl"
      onClick={() => setOpen(true)}
      aria-label="Открыть историю долгов"
    >
      <History className="h-3.5 w-3.5" />
      История долгов
    </Button>
  )

  return (
    <>
      {actionHost ? createPortal(historyAction, actionHost) : null}

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="max-w-5xl"
        title={
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                <History className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-semibold text-foreground">История долгов</div>
                <div className="mt-0.5 text-xs font-normal text-muted-foreground">Кто, что и когда сделал с долгом</div>
              </div>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Неделя</div>
              <DatePicker value={weekStart} onChange={setWeekStart} align="start" />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Поиск</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Должник, товар, сотрудник, источник..."
                  className="h-11 rounded-xl pl-9"
                />
              </div>
            </div>

            <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
              <Button
                key={value}
                type="button"
                variant={kind === value ? 'default' : 'outline'}
                size="xs"
                onClick={() => setKind(value)}
                className="rounded-xl"
              >
                {label}
              </Button>
            ))}
          </div>

          {data ? (
            <div className="grid grid-cols-3 gap-3">
              <Card className="border-border bg-white p-4 shadow-sm dark:bg-white/[0.03]">
                <div className="text-xs text-muted-foreground">Должников</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{stats.debtors}</div>
              </Card>
              <Card className="border-border bg-white p-4 shadow-sm dark:bg-white/[0.03]">
                <div className="text-xs text-muted-foreground">Создано</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{stats.purchases}</div>
              </Card>
              <Card className="border-border bg-white p-4 shadow-sm dark:bg-white/[0.03]">
                <div className="text-xs text-muted-foreground">Погашено</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{stats.payments}</div>
              </Card>
            </div>
          ) : null}

          <div className="border-t border-border pt-4">
            {loading && !data ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка истории…
              </div>
            ) : error ? (
              <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">{error}</Card>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-10 text-center text-sm text-muted-foreground dark:bg-white/[0.02]">
                Событий за выбранный период нет
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((event) => {
                  const amount = amountText(event)
                  return (
                    <div
                      key={event.id}
                      className={`rounded-2xl border border-border border-l-4 p-4 shadow-sm ${eventAccent(event.event_type)}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{event.debtor_name}</span>
                            <span className="rounded-full border border-border bg-white px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-white/5">
                              {event.event_label}
                            </span>
                          </div>
                          {event.item_name ? <div className="mt-1 text-sm text-body">{event.item_name}</div> : null}
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{new Date(event.occurred_at).toLocaleString('ru-RU')}</span>
                            <span>Автор: {event.actor_name_resolved}</span>
                            <span>{event.company_name}</span>
                            {event.point_device_name ? <span>{event.point_device_name}</span> : null}
                            {event.source ? <span>Источник: {event.source}</span> : null}
                          </div>
                          {event.status_before !== event.status_after && (event.status_before || event.status_after) ? (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Статус: {event.status_before || '—'} → {event.status_after || '—'}
                            </div>
                          ) : null}
                        </div>
                        {amount ? (
                          <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{amount}</div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {data?.truncated ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Показаны последние 500 событий за неделю. Используйте поиск и фильтры.
              </p>
            ) : null}
          </div>
        </div>
      </AppModal>
    </>
  )
}
