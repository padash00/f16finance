import { parseISODate, toISODateLocal } from '@/lib/core/date'

export { toISODateLocal }

export function fromISO(iso: string): Date {
  return parseISODate(iso)
}

export function getISOWeekKey(isoDate: string): string {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const isoYear = d.getFullYear()
  const week1 = new Date(isoYear, 0, 4)
  week1.setHours(0, 0, 0, 0)
  const week1Thursday = new Date(week1)
  week1Thursday.setDate(week1.getDate() + 3 - ((week1.getDay() + 6) % 7))
  const diffDays = Math.round((d.getTime() - week1Thursday.getTime()) / 86400000)
  const weekNo = 1 + Math.floor(diffDays / 7)
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`
}

export function getISOWeekStartISO(isoDate: string): string {
  const d = fromISO(isoDate)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diffToMonday = (day + 6) % 7
  d.setDate(d.getDate() - diffToMonday)
  return toISODateLocal(d)
}

export const getMonthKey = (isoDate: string): string => isoDate.slice(0, 7)
export const getYearKey = (isoDate: string): string => isoDate.slice(0, 4)
