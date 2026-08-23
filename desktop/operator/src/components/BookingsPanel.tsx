/**
 * Брони точки одним списком.
 *
 * До этого бронь была видна только на карте — и только если найти нужный ПК.
 * Когда звонит человек и говорит «я на девять записывался, отмените», искать
 * его по залу бессмысленно: оператор знает телефон, а не номер машины.
 *
 * Поэтому здесь поиск по номеру и по имени, а компания на несколько ПК — одна
 * строка, как одна запись в тетради.
 */

import { useMemo, useState } from 'react'
import { CalendarClock, Phone, Search, X } from 'lucide-react'

import type { StationBooking } from '../lib/api'

type Props = {
  bookings: StationBooking[]
  /** Открыть карточку брони — оттуда она и отменяется. */
  onSelect: (booking: StationBooking) => void
  onClose: () => void
}

/** Строка списка: компания — одна строка, а не пять. */
type Row = {
  booking: StationBooking
  stations: string[]
  count: number
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** «через 40 мин» понятнее, чем «21:00», когда сейчас 20:20. */
function relative(startsAt: string, endsAt: string, now: number): string {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (now >= start && now < end) return 'сейчас'
  if (now >= end) return 'прошла'
  const minutes = Math.round((start - now) / 60_000)
  if (minutes < 60) return `через ${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `через ${hours} ч ${rest} мин` : `через ${hours} ч`
}

export function BookingsPanel({ bookings, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const now = Date.now()

  const rows = useMemo<Row[]>(() => {
    // Компания собирается в одну строку по общему признаку группы. Пять строк
    // об одном звонке создали бы впечатление, что вечер загружен вдвое.
    const groups = new Map<string, Row>()
    const singles: Row[] = []

    for (const booking of bookings) {
      const name = booking.stationName || '—'
      if (!booking.groupId) {
        singles.push({ booking, stations: [name], count: 1 })
        continue
      }
      const existing = groups.get(booking.groupId)
      if (existing) {
        existing.stations.push(name)
        existing.count += 1
      } else {
        groups.set(booking.groupId, { booking, stations: [name], count: 1 })
      }
    }

    return [...singles, ...groups.values()].sort((a, b) =>
      a.booking.startsAt < b.booking.startsAt ? -1 : 1,
    )
  }, [bookings])

  const filtered = useMemo(() => {
    const raw = query.trim().toLowerCase()
    if (!raw) return rows
    // Номер ищется по цифрам: диктуют его как угодно, а хранится он в одном
    // виде. Иначе «777 123» не найдёт «+77771234567».
    const digits = raw.replace(/\D/g, '')
    return rows.filter((row) => {
      const phone = (row.booking.phone || '').replace(/\D/g, '')
      if (digits.length >= 3 && phone.includes(digits)) return true
      const haystack = `${row.booking.name || ''} ${row.stations.join(' ')}`.toLowerCase()
      return haystack.includes(raw)
    })
  }, [rows, query])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-4 pt-16">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Брони</h2>
          <span className="text-xs text-muted-foreground">
            {rows.length > 0 ? `— ${rows.length}` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-muted-foreground hover:text-foreground"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Телефон, имя или номер ПК"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? 'Броней пока нет.' : 'Ничего не нашлось.'}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((row) => {
                const state = relative(row.booking.startsAt, row.booking.endsAt, now)
                // Выделяем только то, что происходит прямо сейчас: остальное —
                // ровный список, иначе выделено окажется всё.
                const soon = state === 'сейчас'
                return (
                  <li key={row.booking.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(row.booking)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover"
                    >
                      <div className="w-24 shrink-0">
                        <div className="font-semibold tabular-nums text-foreground">
                          {hhmm(row.booking.startsAt)}
                        </div>
                        <div className={`text-[11px] ${soon ? 'text-violet-400' : 'text-muted-foreground'}`}>
                          {state}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">
                          {row.booking.name || 'Без имени'}
                          {row.count > 1 ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              · {row.count} ПК
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.stations.join(', ')}
                          {row.booking.notes ? ` · ${row.booking.notes}` : ''}
                        </div>
                      </div>

                      <div className="shrink-0 text-xs text-muted-foreground">
                        {row.booking.phone ? (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Phone className="h-3 w-3" />
                            {row.booking.phone}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          Нажмите на бронь, чтобы посмотреть и отменить. Сессии бронь не запускает.
        </div>
      </div>
    </div>
  )
}
