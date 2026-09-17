/**
 * Серия расходов: один платёж, разнесённый по периодам.
 *
 * Кейс: налог за полгода заплачен одним платежом, но в отчётах должен лежать
 * помесячно — иначе весь налог падает в один месяц и ломает сравнение
 * прибыльности по месяцам. Здесь только чистая логика дат и разбивки сумм;
 * запись в БД — в app/api/admin/expenses/wizard/submit-series.
 */

export type SeriesKind = 'day' | 'week' | 'month' | 'quarter'

export type SeriesRow = {
  date: string
  amount_cash: number
  amount_kaspi: number
  label: string
}

export const SERIES_MAX_PERIODS = 24
/** Дни — до месяца: 24 не хватило бы на «оплата за 30 дней». */
export const SERIES_MAX_DAYS = 31

/** Потолок количества периодов для вида серии. */
export function seriesMaxPeriods(kind: SeriesKind): number {
  return kind === 'day' ? SERIES_MAX_DAYS : SERIES_MAX_PERIODS
}

export const MONTHS_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

const WEEKDAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

// Порядок ключей = порядок в выпадающем списке: от короткого периода к длинному
export const SERIES_KIND_LABELS: Record<SeriesKind, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
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
  if (kind === 'day') {
    // День недели рядом с датой: при разнесении по дням важно видеть выходные
    const weekday = d ? WEEKDAYS_RU[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : ''
    return `${pad2(d)}.${pad2(m)}.${y}${weekday ? `, ${weekday}` : ''}`
  }
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
  const safeCount = Math.max(0, Math.min(seriesMaxPeriods(kind), Math.floor(count)))
  for (let i = 0; i < safeCount; i += 1) {
    const date = kind === 'day'
      ? addDaysISO(startISO, i)
      : kind === 'week'
        ? addDaysISO(startISO, 7 * i)
        : addMonthsClamped(startISO, kind === 'quarter' ? 3 * i : i)
    rows.push({ date, amount_cash: cash, amount_kaspi: kaspi, label: seriesPeriodLabel(date, kind) })
  }
  return rows
}

/** Попадает ли дата существующего расхода в период строки серии (поиск дублей). */
export function isDateInSeriesPeriod(existingISO: string, rowISO: string, kind: SeriesKind): boolean {
  if (!existingISO || !rowISO) return false
  if (kind === 'day') return existingISO === rowISO
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
 * Общая сумма, разнесённая по периодам поровну. Целые тенге; то, что не делится
 * поровну, уходит в последний период — сумма периодов всегда равна общей.
 * 84 000 на 6 → по 14 000; 100 000 на 3 → 33 333, 33 333, 33 334.
 */
export function splitTotalAcrossPeriods(total: number, count: number): number[] {
  const safeCount = Math.max(0, Math.floor(count))
  if (safeCount === 0) return []
  const value = Math.max(0, Math.round(Number(total) || 0))
  const base = Math.floor(value / safeCount)
  const amounts = Array.from({ length: safeCount }, () => base)
  amounts[safeCount - 1] += value - base * safeCount
  return amounts
}

export type SeriesPreset = { key: string; label: string; start: string; count: number }

/** Понедельник недели, в которую попадает дата. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysISO(iso, -((dow + 6) % 7))
}

function daysInMonthISO(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Быстрые варианты «с какого периода и сколько» — чтобы не высчитывать руками.
 * Серия не уходит в будущее и не меньше двух периодов: неподходящие варианты
 * не предлагаем вовсе.
 */
export function seriesPresets(kind: SeriesKind, todayISO: string): SeriesPreset[] {
  const [y, m, d] = String(todayISO).split('-').map(Number)
  if (!y || !m || !d) return []
  const firstOfMonth = `${todayISO.slice(0, 7)}-01`
  const out: SeriesPreset[] = []
  const add = (key: string, label: string, start: string, count: number) => {
    const safe = Math.min(seriesMaxPeriods(kind), Math.floor(count))
    if (safe >= 2) out.push({ key, label, start, count: safe })
  }

  if (kind === 'day') {
    const monday = mondayOf(todayISO)
    add('this-week', 'Эта неделя', monday, Math.round((Date.parse(todayISO) - Date.parse(monday)) / 86_400_000) + 1)
    add('this-month', 'С 1-го числа', firstOfMonth, d)
    const prevMonth = addMonthsClamped(firstOfMonth, -1)
    add('last-month', 'Прошлый месяц', prevMonth, daysInMonthISO(prevMonth))
  } else if (kind === 'week') {
    const monday = mondayOf(todayISO)
    add('last-4', '4 недели', addDaysISO(monday, -7 * 3), 4)
    add('last-8', '8 недель', addDaysISO(monday, -7 * 7), 8)
    add('last-12', '12 недель', addDaysISO(monday, -7 * 11), 12)
  } else if (kind === 'month') {
    add('this-year', 'С января', `${y}-01-01`, m)
    add('last-6', '6 месяцев', addMonthsClamped(firstOfMonth, -5), 6)
    add('last-12', '12 месяцев', addMonthsClamped(firstOfMonth, -11), 12)
  } else {
    const quarterStart = addMonthsClamped(firstOfMonth, -((m - 1) % 3))
    add('this-year', 'С начала года', `${y}-01-01`, Math.floor((m - 1) / 3) + 1)
    add('last-4', '4 квартала', addMonthsClamped(quarterStart, -9), 4)
  }
  return out
}

export type ExistingExpense = {
  id?: string
  date: string
  cash_amount?: number | null
  kaspi_amount?: number | null
  comment?: string | null
  status?: string | null
}

export type ExistingMatch = { id?: string; date: string; amount: number; comment: string; sameAmount: boolean }

/**
 * Что уже лежит в периоде строки серии — чтобы вместо голого «есть расход (2)»
 * показать сами расходы. Отклонённые не считаем. Совпадение суммы — главный
 * признак дубля: регулярные закупки той же статьи обычно на другие суммы.
 */
export function matchExistingExpenses(
  existing: ExistingExpense[],
  rowDate: string,
  kind: SeriesKind,
  rowAmount: number,
): { items: ExistingMatch[]; sameAmountCount: number } {
  const target = Math.round(Number(rowAmount) || 0)
  const items = existing
    .filter((e) => e.status !== 'declined' && isDateInSeriesPeriod(String(e.date || ''), rowDate, kind))
    .map((e) => {
      const amount = Math.round(Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0))
      return { id: e.id, date: String(e.date || ''), amount, comment: String(e.comment || '').trim(), sameAmount: target > 0 && amount === target }
    })
    .sort((a, b) => Number(b.sameAmount) - Number(a.sameAmount) || a.date.localeCompare(b.date))
  return { items, sameAmountCount: items.filter((i) => i.sameAmount).length }
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
