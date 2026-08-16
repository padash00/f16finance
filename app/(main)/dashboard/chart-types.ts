/**
 * Типы и форматирование графиков дашборда.
 *
 * Вынесены из страницы, чтобы графики могли жить в отдельном модуле и
 * подгружаться лениво. Если бы они остались в `page.tsx`, модуль графиков
 * импортировал бы саму страницу — и вся экономия исчезла бы.
 */

export type ChartPoint = {
  date: string
  income: number
  expense: number
  profit: number
  movingAvg: number
  label: string
}

export type CategoryData = {
  name: string
  value: number
  percentage: number
  color: string
}

/**
 * Работа с датами дашборда.
 *
 * Здесь же, потому что подпись оси графика («с 1 авг по 16 авг») нужна и
 * странице, и модулю графиков. Держать копию в каждом — верный способ
 * получить две разные даты на одном экране.
 */
export const DateUtils = {
  toISODateLocal(d: Date) {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  fromISO(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },
  todayISO() {
    return DateUtils.toISODateLocal(new Date())
  },
  monthStartISO() {
    const d = new Date()
    return DateUtils.toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1))
  },
  addDaysISO(iso: string, diff: number) {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },
  formatShort(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  },
  formatFull(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },
  getQuarterBounds() {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0)),
    }
  },
  getYearBounds() {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31)),
    }
  },
  calcPrevPeriod(dateFrom: string, dateTo: string) {
    const dFrom = DateUtils.fromISO(dateFrom)
    const dTo = DateUtils.fromISO(dateTo)
    const days = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
    return {
      prevFrom: DateUtils.addDaysISO(dateFrom, -days),
      prevTo: DateUtils.addDaysISO(dateFrom, -1),
      days,
    }
  },
  rangeDates(from: string, to: string) {
    const out: string[] = []
    let cur = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    while (cur <= end) {
      out.push(DateUtils.toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  },
}

export const Formatters = {
  moneyDetailed(v: number) {
    return (Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
  },
  percentChange(current: number, previous: number) {
    if (!previous) return { text: '—', positive: true }
    const p = ((current - previous) / Math.abs(previous)) * 100
    return { text: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, positive: p >= 0 }
  },
}

export const COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
}
