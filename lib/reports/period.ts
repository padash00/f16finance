import { addDaysISO, parseISODate } from '@/lib/core/date'

export function calculatePrevPeriod(dateFrom: string, dateTo: string) {
  const dFrom = parseISODate(dateFrom)
  const dTo = parseISODate(dateTo)
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86400000) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

/** Тот же период годом раньше — для сравнения с учётом сезонности. 29 февраля → 28-е. */
export function sameRangeLastYear(dateFrom: string, dateTo: string) {
  return { prevFrom: shiftYears(dateFrom, -1), prevTo: shiftYears(dateTo, -1) }
}

function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const year = y + years
  const lastDay = new Date(year, m, 0).getDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/** Склеивает пересекающиеся и соседние диапазоны дат; результат по возрастанию, без наложений. */
export function mergeDateRanges(ranges: { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from))
  const out: { from: string; to: string }[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range.from <= addDaysISO(last.to, 1)) {
      if (range.to > last.to) last.to = range.to
    } else {
      out.push({ from: range.from, to: range.to })
    }
  }
  return out
}

/** Первый и последний день календарного месяца для даты YYYY-MM-DD. */
export function calendarMonthRange(anchor: string): { from: string; to: string } {
  const d = parseISODate(anchor)
  const y = d.getFullYear()
  const m = d.getMonth()
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const last = new Date(y, m + 1, 0)
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  return { from, to }
}

export function previousCalendarMonthRange(anchor: string): { from: string; to: string } {
  const d = parseISODate(anchor)
  const y = d.getFullYear()
  const m = d.getMonth() - 1
  const base = new Date(y, m, 1)
  const y2 = base.getFullYear()
  const m2 = base.getMonth()
  const from = `${y2}-${String(m2 + 1).padStart(2, '0')}-01`
  const last = new Date(y2, m2 + 1, 0)
  const to = `${y2}-${String(m2 + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  return { from, to }
}

export function isFullMonthRange(from: string, to: string): boolean {
  const a = parseISODate(from)
  const b = parseISODate(to)
  if (a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth()) return false
  if (a.getDate() !== 1) return false
  const last = new Date(a.getFullYear(), a.getMonth() + 1, 0)
  return b.getDate() === last.getDate()
}
