'use client'

/**
 * Брони точки — то, что раньше было тетрадью.
 *
 * Владелец смотрит сюда, чтобы увидеть, кто и на когда записан: имя, телефон,
 * какие ПК, во сколько. Заводят брони операторы в своей программе; здесь
 * только просмотр.
 *
 * Компания на пять машин показывается ОДНОЙ строкой, как и была одной записью
 * в тетради. Пять отдельных строк создали бы ложное впечатление, что вечер
 * загружен вдвое сильнее, чем на самом деле.
 */

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Loader2, Phone, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type BookingRow = {
  id: string
  booking_group_id: string | null
  stations: string[]
  starts_at: string
  ends_at: string | null
  status: string
  phone: string | null
  name: string | null
  notes: string | null
  source: string
  created_at: string
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  confirmed: { label: 'подтверждена', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  requested: { label: 'заявка', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  cancelled: { label: 'отменена', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  completed: { label: 'состоялась', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  rejected: { label: 'отклонена', className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
}

/** Дата в поле ввода: сегодня по умолчанию. */
function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function timeRange(startsAt: string, endsAt: string | null): string {
  const opts = { hour: '2-digit', minute: '2-digit' } as const
  const start = new Date(startsAt).toLocaleTimeString('ru-RU', opts)
  if (!endsAt) return start
  return `${start} – ${new Date(endsAt).toLocaleTimeString('ru-RU', opts)}`
}

export function ArenaBookingsTab(props: { companyId?: string | null }) {
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ stations_only: '1' })
      if (props.companyId) params.set('company_id', props.companyId)

      // Окно суток по местному времени: владелец спрашивает про день, а не
      // про промежуток по всемирному времени.
      params.set('from', new Date(`${date}T00:00:00`).toISOString())
      params.set('to', new Date(`${date}T23:59:59`).toISOString())

      const res = await fetch(`/api/admin/client/bookings?${params}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setRows(json.data || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить брони')
    } finally {
      setLoading(false)
    }
  }, [date, props.companyId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">День</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-44"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <p className="text-xs text-muted-foreground">
            Брони заводят операторы в своей программе. Здесь — просмотр.
          </p>
        </div>
      </Card>

      {error ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Брони на {new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
          </h2>
          {rows.length > 0 ? (
            <span className="text-xs text-muted-foreground">— {rows.length}</span>
          ) : null}
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            На этот день броней нет.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-32 py-2 pl-4 pr-2 font-normal">Время</th>
                  <th className="py-2 px-2 font-normal">Кто</th>
                  <th className="w-40 py-2 px-2 font-normal">Телефон</th>
                  <th className="py-2 px-2 font-normal">Компьютеры</th>
                  <th className="w-32 py-2 px-2 font-normal">Статус</th>
                  <th className="py-2 px-2 pr-4 font-normal">Заметка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => {
                  const status = STATUS_LABELS[row.status] || {
                    label: row.status,
                    className: 'bg-slate-500/10 text-slate-600',
                  }
                  return (
                    <tr key={row.id} className="hover:bg-surface-hover">
                      <td className="py-2.5 pl-4 pr-2 tabular-nums text-foreground">
                        {timeRange(row.starts_at, row.ends_at)}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="text-foreground">{row.name || 'Без имени'}</span>
                        {row.source === 'operator' ? null : (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">из приложения</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-muted-foreground">
                        {row.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {row.phone}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        {/*
                          Компания показывается одной строкой со списком ПК —
                          как одна запись в тетради. Пять отдельных строк
                          создали бы впечатление, что вечер вдвое загруженнее.
                        */}
                        <span className="text-foreground">
                          {row.stations.length > 0 ? row.stations.join(', ') : '—'}
                        </span>
                        {row.stations.length > 1 ? (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">
                            ({row.stations.length} ПК)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 pr-4 text-xs text-muted-foreground">
                        {row.notes || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
