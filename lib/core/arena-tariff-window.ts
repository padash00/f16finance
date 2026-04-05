/** Время тарифа «пакет по окну»: HH:MM, локальное время точки */

export function parseTimeToMinutes(s: string | null | undefined): number | null {
  if (!s || typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function minutesNow(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** Окно через полночь: start > end (например 22:00 → 10:00) */
export function isOvernightWindow(startM: number, endM: number): boolean {
  return startM > endM
}

/**
 * Можно ли начать сессию сейчас (тариф «пакет по окну»).
 * - Заданы начало и конец — интервал [start, end), ночное окно если start > end.
 * - Задан только конец — интервал с полуночи до end (локальные часы `now`).
 */
export function isNowInTariffWindow(
  now: Date,
  tariffType: string,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): { ok: boolean; code?: string } {
  if (tariffType !== 'time_window' || !windowEnd) return { ok: true }
  const endM = parseTimeToMinutes(windowEnd)
  if (endM === null) return { ok: true }
  const nowM = minutesNow(now)

  if (!windowStart?.trim()) {
    if (nowM < endM) return { ok: true }
    return { ok: false, code: 'outside-tariff-window' }
  }

  const startM = parseTimeToMinutes(windowStart)
  if (startM === null) return { ok: true }

  if (!isOvernightWindow(startM, endM)) {
    if (nowM >= startM && nowM < endM) return { ok: true }
    return { ok: false, code: 'outside-tariff-window' }
  }
  if (nowM >= startM || nowM < endM) return { ok: true }
  return { ok: false, code: 'outside-tariff-window' }
}

/**
 * Момент окончания сессии для пакета по окну.
 * Без window_start — прежняя логика: ближайшее window_end после now.
 */
export function computeTimeWindowEndsAt(
  now: Date,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): Date | null {
  if (!windowEnd) return null
  const endM = parseTimeToMinutes(windowEnd)
  if (endM === null) return null
  const endH = Math.floor(endM / 60)
  const endMin = endM % 60

  if (!windowStart?.trim()) {
    const endsAt = new Date(now)
    endsAt.setHours(endH, endMin, 0, 0)
    if (endsAt <= now) endsAt.setDate(endsAt.getDate() + 1)
    return endsAt
  }

  const startM = parseTimeToMinutes(windowStart)
  if (startM === null) {
    const endsAt = new Date(now)
    endsAt.setHours(endH, endMin, 0, 0)
    if (endsAt <= now) endsAt.setDate(endsAt.getDate() + 1)
    return endsAt
  }

  const nowM = minutesNow(now)
  const overnight = isOvernightWindow(startM, endM)
  const endsAt = new Date(now)

  if (!overnight) {
    endsAt.setHours(endH, endMin, 0, 0)
    return endsAt
  }

  if (nowM >= startM) {
    endsAt.setDate(endsAt.getDate() + 1)
  }
  endsAt.setHours(endH, endMin, 0, 0)
  return endsAt
}

/** Подпись для UI: «10:00–16:00 (день)» / «22:00–10:00 (ночь)» / «до 16:00» */
export function formatTariffWindowLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!end?.trim()) return ''
  if (!start?.trim()) return `до ${end}`
  const a = parseTimeToMinutes(start)
  const b = parseTimeToMinutes(end)
  if (a == null || b == null) return `${start}–${end}`
  if (isOvernightWindow(a, b)) return `${start}–${end} (ночь)`
  return `${start}–${end} (день)`
}

/** Для выдачи в API терминалу: фиксированные тарифы всегда; по окну — только если сейчас в интервале. */
export function isTariffOfferedNow(
  now: Date,
  tariff: {
    tariff_type?: string | null
    window_start_time?: string | null
    window_end_time?: string | null
  },
): boolean {
  if (tariff.tariff_type !== 'time_window') return true
  return isNowInTariffWindow(
    now,
    String(tariff.tariff_type),
    tariff.window_start_time,
    tariff.window_end_time,
  ).ok
}
