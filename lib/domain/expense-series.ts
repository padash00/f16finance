/**
 * Серия расходов: один платёж, разнесённый по периодам.
 *
 * Кейс: налог за полгода заплачен одним платежом, но в отчётах должен лежать
 * помесячно — иначе весь налог падает в один месяц и ломает сравнение
 * прибыльности по месяцам. Здесь только чистая логика дат и разбивки сумм;
 * запись в БД — в app/api/admin/expenses/wizard/submit-series.
 */

export type SeriesKind = 'month' | 'quarter' | 'week'

export type SeriesRow = {
  date: string
  amount_cash: number
  amount_kaspi: number
  label: string
}

export const SERIES_MAX_PERIODS = 24

export const MONTHS_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

export const SERIES_KIND_LABELS: Record<SeriesKind, string> = {
  month: 'Месяц',
  quarter: 'Квартал',
  week: 'Неделя',
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Прибавить месяцы, не выпрыгивая из целевого месяца:
 * 31 января + 1 месяц = 28/29 февраля, а не 2/3 марта.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(Math.min(d, lastDay))}`
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  const target = new Date(Date.UTC(y, m - 1, d + days))
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(target.getUTCDate())}`
}

export function seriesPeriodLabel(iso: string, kind: SeriesKind): string {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m) return iso
  if (kind === 'month') return `${MONTHS_RU[m - 1]} ${y}`
  if (kind === 'quarter') return `${Math.floor((m - 1) / 3) + 1} кв. ${y}`
  return `неделя с ${pad2(d)}.${pad2(m)}.${y}`
}

/** Сгенерировать периоды серии от стартовой даты. Суммы — как в карточке расхода. */
export function buildSeriesRows(
  startISO: string,
  kind: SeriesKind,
  count: number,
  cash: number,
  kaspi: number,
): SeriesRow[] {
  const rows: SeriesRow[] = []
  const safeCount = Math.max(0, Math.min(SERIES_MAX_PERIODS, Math.floor(count)))
  for (let i = 0; i < safeCount; i += 1) {
    const date = kind === 'week'
      ? addDaysISO(startISO, 7 * i)
      : addMonthsClamped(startISO, kind === 'quarter' ? 3 * i : i)
    rows.push({ date, amount_cash: cash, amount_kaspi: kaspi, label: seriesPeriodLabel(date, kind) })
  }
  return rows
}

/** Попадает ли дата существующего расхода в период строки серии (поиск дублей). */
export function isDateInSeriesPeriod(existingISO: string, rowISO: string, kind: SeriesKind): boolean {
  if (!existingISO || !rowISO) return false
  if (kind === 'week') {
    return existingISO >= rowISO && existingISO <= addDaysISO(rowISO, 6)
  }
  const rowMonth = rowISO.slice(0, 7)
  const existingMonth = existingISO.slice(0, 7)
  if (kind === 'month') return existingMonth === rowMonth
  const lastMonth = addMonthsClamped(`${rowMonth}-01`, 2).slice(0, 7)
  return existingMonth >= rowMonth && existingMonth <= lastMonth
}

/**
 * Правка общей суммы периода: пропорции «наличные / безнал» берём из карточки,
 * чтобы правка одной цифры не меняла способ оплаты.
 */
export function splitPeriodAmount(
  total: number,
  cardCash: number,
  cardKaspi: number,
): { amount_cash: number; amount_kaspi: number } {
  const value = Math.max(0, Number(total) || 0)
  if (cardKaspi <= 0) return { amount_cash: value, amount_kaspi: 0 }
  if (cardCash <= 0) return { amount_cash: 0, amount_kaspi: value }
  const nextCash = Math.round(value * (cardCash / (cardCash + cardKaspi)))
  return { amount_cash: nextCash, amount_kaspi: Math.max(0, value - nextCash) }
}
