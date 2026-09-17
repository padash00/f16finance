/**
 * Дата и смена дохода по часам Казахстана (UTC+5, без перехода на летнее).
 *
 * Сервер на Vercel живёт в UTC, поэтому `new Date().getHours()` и
 * `toISOString().slice(0, 10)` дают не наш час и не наш день: доход в 02:00
 * по Алматы уезжал в предыдущие сутки, а граница смен сдвигалась на 5 часов.
 *
 * Правило то же, что у кассы (desktop/operator/src/lib/shift-runtime.ts) и
 * бота «кто на смене»: день 08:00–20:00, ночь 20:00–08:00. Ночная смена
 * записывается одной строкой с датой НАЧАЛА — после полуночи это вчерашняя
 * дата, а безнал до/после полуночи разводится полем kaspi_before_midnight
 * (см. lib/reports/income-calendar-kaspi.ts).
 */

const KZ_OFFSET_MS = 5 * 3_600_000

export type KzShiftContext = {
  /** Дата смены (для ночи после полуночи — вчерашняя) */
  date: string
  shift: 'day' | 'night'
  /** Ночная смена, но уже после 00:00 — безнал относится к следующим суткам */
  afterMidnight: boolean
}

function isoOf(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * @param openShiftType тип открытой смены точки, если он известен. Смену
 * открывают чуть раньше 08:00/20:00 и закрывают чуть позже — её тип надёжнее
 * часов. Дата ночной смены до полудня — вчерашняя, после — сегодняшняя.
 */
export function resolveKzShift(now: Date = new Date(), openShiftType?: string | null): KzShiftContext {
  const kzMs = now.getTime() + KZ_OFFSET_MS
  const hour = new Date(kzMs).getUTCHours()
  const today = isoOf(kzMs)
  const yesterday = isoOf(kzMs - 86_400_000)

  if (openShiftType === 'day') return { date: today, shift: 'day', afterMidnight: false }
  if (openShiftType === 'night') {
    return hour < 12
      ? { date: yesterday, shift: 'night', afterMidnight: true }
      : { date: today, shift: 'night', afterMidnight: false }
  }

  if (hour >= 8 && hour < 20) return { date: today, shift: 'day', afterMidnight: false }
  if (hour >= 20) return { date: today, shift: 'night', afterMidnight: false }
  return { date: yesterday, shift: 'night', afterMidnight: true }
}

/** Значение kaspi_before_midnight для строки дохода (у дневной — null, как в отчёте смены) */
export function kzKaspiBeforeMidnight(ctx: KzShiftContext, kaspiAmount: number): number | null {
  if (ctx.shift !== 'night') return null
  return ctx.afterMidnight ? 0 : kaspiAmount
}
