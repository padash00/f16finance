import { addDaysISO, parseISODate } from '@/lib/core/date'

export function calculatePrevPeriod(dateFrom: string, dateTo: string) {
  const dFrom = parseISODate(dateFrom)
  const dTo = parseISODate(dateTo)
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86400000) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
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
