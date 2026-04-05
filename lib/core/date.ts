export type DateRange = {
  from: string
  to: string
}

export function toISODateLocal(input: Date): string {
  const shifted = input.getTime() - input.getTimezoneOffset() * 60_000
  return new Date(shifted).toISOString().slice(0, 10)
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export function formatDateForInput(input: Date): string {
  return [
    input.getFullYear(),
    String(input.getMonth() + 1).padStart(2, '0'),
    String(input.getDate()).padStart(2, '0'),
  ].join('-')
}

export function todayISO(): string {
  return toISODateLocal(new Date())
}

export function addDaysISO(iso: string, diff: number): string {
  const next = parseISODate(iso)
  next.setDate(next.getDate() + diff)
  return toISODateLocal(next)
}

export function mondayOfDate(input: Date): Date {
  const next = new Date(input)
  const day = next.getDay() || 7
  if (day !== 1) next.setDate(next.getDate() - (day - 1))
  next.setHours(0, 0, 0, 0)
  return next
}

export function mondayOfISO(iso: string): string {
  return toISODateLocal(mondayOfDate(parseISODate(iso)))
}

/**
 * Понедельник недели в UTC (ISO-стиль), как при записи долгов с точки (`point/debts` → week_start).
 * Отличается от `mondayOfDate` (локальный TZ): иначе на границе суток список на /point-debts пустой.
 */
export function weekStartUtcISO(from: Date | string = new Date()): string {
  const base = typeof from === 'string' ? new Date(from) : from
  const date = Number.isNaN(base.getTime()) ? new Date() : base
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = copy.getUTCDay()
  const offset = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + offset)
  return copy.toISOString().slice(0, 10)
}

export function getWeekRange(input = new Date()): DateRange {
  const monday = mondayOfDate(input)
  return {
    from: formatDateForInput(monday),
    to: formatDateForInput(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)),
  }
}

export function getPreviousWeekRange(input = new Date()): DateRange {
  const monday = mondayOfDate(input)
  monday.setDate(monday.getDate() - 7)
  return {
    from: formatDateForInput(monday),
    to: formatDateForInput(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)),
  }
}

export function getMonthRange(input = new Date()): DateRange {
  return {
    from: formatDateForInput(new Date(input.getFullYear(), input.getMonth(), 1)),
    to: formatDateForInput(new Date(input.getFullYear(), input.getMonth() + 1, 0)),
  }
}

export function formatRuDate(iso: string, mode: 'short' | 'full' = 'short'): string {
  if (!iso) return ''
  const date = parseISODate(iso)
  if (mode === 'short') {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
