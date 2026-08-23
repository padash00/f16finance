/**
 * Сколько машин свободно к каждому часу.
 *
 * Главный вопрос телефонного разговора — «а на девять есть десять компьютеров?».
 * До этого ответить на него можно было только глазами: пройти по карте, найти
 * фиолетовые, вычесть, не сбиться. Человек на линии ждал.
 *
 * Полоса считает это сама, по часам до конца смены. Нажатие на час
 * перекрашивает карту зала на этот момент: видно не только сколько, но и какие
 * именно машины.
 *
 * Считаются только брони. Сессии сюда не входят: сколько человек будет сидеть
 * через два часа, знает SENET, а не мы, и складывать догадку с обещанием
 * значило бы выдать её за факт.
 */

import { useMemo } from 'react'

import type { StationBooking } from '../lib/api'
import type { ArenaStation } from '../types'

type Props = {
  stations: ArenaStation[]
  bookings: StationBooking[]
  /** Докуда разрешено бронировать этой смене — дальше часы не показываем. */
  horizonEnd: string | null
  /** Выбранный час: карта зала показывает его же. */
  previewAt: number | null
  onPreview: (at: number | null) => void
}

/** Сколько часов вперёд показывать, если горизонт далеко. */
const MAX_HOURS = 10

export function BookingTimeline({ stations, bookings, horizonEnd, previewAt, onPreview }: Props) {
  const activeStations = stations.filter((s) => s.is_active !== false)

  const hours = useMemo(() => {
    const result: Array<{ at: number; free: number; label: string }> = []
    if (activeStations.length === 0) return result

    // Начинаем со следующего круглого часа: про текущий оператор и так видит
    // карту, а спрашивают его про «попозже».
    const first = new Date()
    first.setMinutes(0, 0, 0)
    first.setHours(first.getHours() + 1)

    const limit = horizonEnd ? new Date(horizonEnd).getTime() : first.getTime() + MAX_HOURS * 3600_000

    for (let i = 0; i < MAX_HOURS; i++) {
      const at = first.getTime() + i * 3600_000
      if (at > limit) break

      const busy = new Set<string>()
      for (const booking of bookings) {
        if (!booking.stationId) continue
        const start = new Date(booking.startsAt).getTime()
        const end = new Date(booking.endsAt).getTime()
        if (start <= at && end > at) busy.add(booking.stationId)
      }

      result.push({
        at,
        free: activeStations.filter((s) => !busy.has(s.id)).length,
        label: new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      })
    }

    return result
  }, [activeStations, bookings, horizonEnd])

  if (hours.length === 0) return null

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-border bg-card px-3 py-2 shadow-[var(--card-shadow)]">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Свободно к
      </span>

      {hours.map((hour) => {
        const active = previewAt === hour.at
        // Ноль свободных — это отказ клиенту, и выглядеть он должен иначе, чем
        // «есть места». Оператор смотрит на полосу боковым зрением.
        const empty = hour.free === 0
        return (
          <button
            key={hour.at}
            type="button"
            onClick={() => onPreview(active ? null : hour.at)}
            className={
              active
                ? 'shrink-0 rounded-lg border border-violet-400 bg-violet-500/20 px-2.5 py-1 text-center'
                : 'shrink-0 rounded-lg border border-border px-2.5 py-1 text-center hover:border-violet-400/60'
            }
          >
            <div className="text-xs font-semibold tabular-nums text-foreground">{hour.label}</div>
            <div
              className={`text-[11px] tabular-nums ${empty ? 'text-rose-400' : 'text-muted-foreground'}`}
            >
              {hour.free}
            </div>
          </button>
        )
      })}

      {previewAt !== null && (
        <button
          type="button"
          onClick={() => onPreview(null)}
          className="ml-auto shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Вернуть «сейчас»
        </button>
      )}
    </div>
  )
}
