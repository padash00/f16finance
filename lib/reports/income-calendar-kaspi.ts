import { addDaysISO } from '@/lib/core/date'

/** Minimal income row for calendar Kaspi split (reports and similar UIs). */
export type ReportIncomeCalendarRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night'
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight?: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
  created_at?: string
}

/**
 * Ночная смена в БД одной строкой с датой начала; для отчётов по календарным суткам
 * Kaspi «после полуночи» относится на следующий календарный день.
 */
export function splitIncomeKaspiByCalendarDay(rows: ReportIncomeCalendarRow[]): ReportIncomeCalendarRow[] {
  const normalized: ReportIncomeCalendarRow[] = []

  for (const row of rows) {
    const totalKaspi = Number(row.kaspi_amount || 0)
    const beforeMidnight =
      row.kaspi_before_midnight == null ? null : Number(row.kaspi_before_midnight || 0)

    if (row.shift !== 'night') {
      normalized.push(row)
      continue
    }

    const currentDateKaspi =
      beforeMidnight == null ? 0 : Math.min(Math.max(beforeMidnight, 0), Math.max(totalKaspi, 0))
    const nextDateKaspi =
      beforeMidnight == null ? Math.max(totalKaspi, 0) : Math.max(totalKaspi - currentDateKaspi, 0)

    normalized.push({
      ...row,
      kaspi_amount: currentDateKaspi,
    })

    if (nextDateKaspi > 0) {
      normalized.push({
        ...row,
        id: `${row.id}:kaspi-next-day`,
        date: addDaysISO(row.date, 1),
        cash_amount: 0,
        kaspi_amount: nextDateKaspi,
        online_amount: 0,
        card_amount: 0,
        comment: row.comment ? `${row.comment} [Kaspi после 00:00]` : 'Kaspi после 00:00 (авторазбивка)',
      })
    }
  }

  return normalized
}

export function countImpreciseNightKaspiInRange(
  rows: Pick<ReportIncomeCalendarRow, 'date' | 'shift' | 'kaspi_amount' | 'kaspi_before_midnight'>[],
  dateFrom: string,
  dateTo: string,
): number {
  let n = 0
  for (const r of rows) {
    if (r.date < dateFrom || r.date > dateTo) continue
    if (r.shift !== 'night') continue
    if (Number(r.kaspi_amount || 0) <= 0) continue
    if (r.kaspi_before_midnight != null) continue
    n++
  }
  return n
}
