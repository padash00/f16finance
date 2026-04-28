import { addDaysISO, parseISODate } from '@/lib/core/date'
import { calendarMonthRange, isFullMonthRange, previousCalendarMonthRange } from '@/lib/reports/period'

export type ForecastHints = {
  lastFullMonth: { from: string; to: string; totalIncome: number; totalExpense: number; profit: number }
  lastMonthMtd: { from: string; to: string; totalIncome: number; totalExpense: number; profit: number; days: number }
}

/**
 * Гибридный прогноз на конец выбранного календарного месяца:
 * - run-rate: факт МТД + средняя дневная по факту × остаток дней
 * - сезонность: «хвост» прошлого месяца по аналогии с оставшимися днями
 * - смешивание: ближе к концу месяца больше веса у run-rate
 */
export function computeMonthEndForecast(input: {
  dateFrom: string
  dateTo: string
  asOf: string
  /** Факт за текущий просматриваемый месяц (уже с учётом разбивки Kaspi) */
  mtdIncome: number
  mtdExpense: number
  hints: ForecastHints | null
}): {
  remainingDays: number
  forecastIncome: number
  forecastExpense: number
  forecastProfit: number
  confidence: number
  runRateIncome: number
  seasonalIncome: number
  note: string
} | null {
  if (!isFullMonthRange(input.dateFrom, input.dateTo) || !input.hints) return null

  const asOf = input.asOf
  if (asOf < input.dateFrom || asOf > input.dateTo) return null

  const start = parseISODate(input.dateFrom)
  const asOfD = parseISODate(asOf)
  const endD = parseISODate(input.dateTo)

  const daysPassed = Math.max(1, Math.floor((asOfD.getTime() - start.getTime()) / 86400000) + 1)
  const totalDays = Math.floor((endD.getTime() - start.getTime()) / 86400000) + 1
  const remainingDays = Math.max(0, totalDays - daysPassed)
  if (remainingDays <= 0) return null

  const { lastFullMonth, lastMonthMtd } = input.hints

  const avgIn = input.mtdIncome / daysPassed
  const avgEx = input.mtdExpense / daysPassed
  const runRateIncome = input.mtdIncome + avgIn * remainingDays
  const runRateExpense = input.mtdExpense + avgEx * remainingDays

  const lastMonthRemainingDays = Math.max(1, lastFullMonth.totalIncome > 0 ? totalDays - lastMonthMtd.days : totalDays)
  const tailLastMonth =
    lastFullMonth.totalIncome - lastMonthMtd.totalIncome > 0
      ? (lastFullMonth.totalIncome - lastMonthMtd.totalIncome) / lastMonthRemainingDays
      : lastFullMonth.totalIncome / totalDays
  const tailLastMonthEx =
    lastFullMonth.totalExpense - lastMonthMtd.totalExpense > 0
      ? (lastFullMonth.totalExpense - lastMonthMtd.totalExpense) / lastMonthRemainingDays
      : lastFullMonth.totalExpense / totalDays

  const seasonalIncome = input.mtdIncome + tailLastMonth * remainingDays
  const seasonalExpense = input.mtdExpense + tailLastMonthEx * remainingDays

  const w = Math.min(0.85, Math.max(0.25, daysPassed / totalDays))
  const forecastIncome = Math.round(w * runRateIncome + (1 - w) * seasonalIncome)
  const forecastExpense = Math.round(w * runRateExpense + (1 - w) * seasonalExpense)
  const forecastProfit = forecastIncome - forecastExpense

  const confidence = Math.min(92, Math.max(48, 52 + (daysPassed / totalDays) * 38))

  return {
    remainingDays,
    forecastIncome,
    forecastExpense,
    forecastProfit,
    confidence,
    runRateIncome,
    seasonalIncome,
    note: `Смешение: ${(w * 100).toFixed(0)}% по текущему темпу, ${((1 - w) * 100).toFixed(0)}% по «хвосту» ${previousCalendarMonthRange(input.dateFrom).from.slice(0, 7)}`,
  }
}

/** Диапазон 1..N в прошлом календарном месяце, N = число дней от начала текущего месяца до asOf */
export function lastMonthMtdRangeForCurrentMonth(
  monthDateFrom: string,
  asOf: string,
): { from: string; to: string; days: number } | null {
  const { to: monthEnd } = calendarMonthRange(monthDateFrom)
  if (!isFullMonthRange(monthDateFrom, monthEnd)) return null
  const { from: pmFrom } = previousCalendarMonthRange(monthDateFrom)
  const d0 = parseISODate(monthDateFrom)
  const a = parseISODate(asOf)
  const days = Math.max(1, Math.floor((a.getTime() - d0.getTime()) / 86400000) + 1)
  const to = addDaysISO(pmFrom, days - 1)
  return { from: pmFrom, to, days }
}
