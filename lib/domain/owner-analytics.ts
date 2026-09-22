/**
 * Аналитика владельца: один ответ на экран с общим фильтром.
 *
 * Мобильное приложение показывает KPI, график, точки, статьи расходов,
 * операторов и кассу на одном экране под одним периодом и набором точек.
 * Раньше каждый блок ходил в свой маршрут со своим периодом — цифры на соседних
 * карточках считались за разные дни.
 *
 * Здесь только чистый счёт: строки на входе, готовые ряды на выходе. Выручка,
 * расходы и прибыль берутся из отчётов смен — как на сайте, в ОПиУ и налоге;
 * чеки, средний чек, часы и товары — из кассы.
 */

export type OwnerCompare = 'prev' | 'year'
export type OwnerGroup = 'day' | 'week' | 'month'

const DAY_MS = 86_400_000
/** Алматы: UTC+5 без перехода на летнее время. */
const ALMATY_OFFSET_MS = 5 * 3_600_000

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const round = (n: number) => Math.round(n)

function isoToUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, diff: number): string {
  return utcToIso(isoToUtc(iso) + diff * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((isoToUtc(to) - isoToUtc(from)) / DAY_MS)
}

/** Сегодняшняя дата по Алматы. */
export function almatyToday(now: Date = new Date()): string {
  return utcToIso(now.getTime() + ALMATY_OFFSET_MS)
}

/** Понедельник = 0 … воскресенье = 6. */
export function weekdayIndex(iso: string): number {
  return (new Date(isoToUtc(iso)).getUTCDay() + 6) % 7
}

/**
 * Шаг графика по длине периода: до двух месяцев — дни, до полугода — недели,
 * дальше — месяцы. Больше ~60 столбиков на телефоне не читаются.
 */
export function pickGroup(from: string, to: string): OwnerGroup {
  const days = daysBetween(from, to) + 1
  if (days <= 62) return 'day'
  if (days <= 190) return 'week'
  return 'month'
}

/** База сравнения: предыдущий период той же длины или тот же период годом раньше. */
export function comparisonRange(from: string, to: string, compare: OwnerCompare) {
  if (compare === 'year') {
    return { prevFrom: shiftYear(from, -1), prevTo: shiftYear(to, -1) }
  }
  // Целые календарные месяцы (месяц, квартал, год) сравниваются с такими же
  // месяцами перед ними: сентябрь — с августом с 1-го числа, а не с окном
  // «30 дней назад», которое начинается 2 августа.
  const months = wholeMonths(from, to)
  if (months) {
    const prevFrom = shiftMonths(from, -months)
    return { prevFrom, prevTo: addDays(shiftMonths(prevFrom, months), -1) }
  }
  const length = daysBetween(from, to) + 1
  const prevTo = addDays(from, -1)
  return { prevFrom: addDays(prevTo, -(length - 1)), prevTo }
}

/** Сколько целых месяцев в периоде; null — период не из целых месяцев. */
function wholeMonths(from: string, to: string): number | null {
  if (!from.endsWith('-01')) return null
  const next = addDays(to, 1)
  if (!next.endsWith('-01')) return null
  const [fy, fm] = from.split('-').map(Number)
  const [ny, nm] = next.split('-').map(Number)
  const count = (ny * 12 + nm) - (fy * 12 + fm)
  return count > 0 ? count : null
}

/** Сдвиг первого числа месяца на n месяцев. */
function shiftMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

function shiftYear(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const year = y + years
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/**
 * Номер столбика для даты внутри своего периода. Текущий и базовый периоды
 * нумеруются каждый от своего начала — так столбик i сравнивается со столбиком i,
 * даже если база — прошлый год.
 */
export function bucketIndex(start: string, date: string, group: OwnerGroup): number {
  if (group === 'day') return daysBetween(start, date)
  if (group === 'week') return Math.floor(daysBetween(start, date) / 7)
  const [sy, sm] = start.split('-').map(Number)
  const [y, m] = date.split('-').map(Number)
  return (y * 12 + m) - (sy * 12 + sm)
}

/** Первая дата столбика — подпись оси. */
export function bucketStart(start: string, index: number, group: OwnerGroup): string {
  if (group === 'day') return addDays(start, index)
  if (group === 'week') return addDays(start, index * 7)
  const [sy, sm] = start.split('-').map(Number)
  const total = sy * 12 + (sm - 1) + index
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  // Первый столбик месяца начинается с даты начала периода, а не с 1-го:
  // иначе подпись обещает дни, которых в периоде нет.
  return index === 0 ? start : `${y}-${String(m).padStart(2, '0')}-01`
}

// ── Отчёты смен ──────────────────────────────────────────────────────────────

export type OwnerIncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id?: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

export type OwnerExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

export type OwnerSeriesPoint = {
  /** Первая дата столбика в текущем периоде */
  date: string
  /** Первая дата столбика в базе сравнения */
  prevDate: string
  revenue: number
  expense: number
  profit: number
  prevRevenue: number
  prevExpense: number
  prevProfit: number
}

/**
 * Ряд графика с базой сравнения. Столбики идут сплошняком: день без выручки —
 * это ноль, а не дыра, иначе линия врёт о тренде. Будущие дни периода («месяц»
 * посреди месяца) не рисуются вовсе — нули там читались бы как провал.
 */
export function buildSeries(input: {
  incomes: OwnerIncomeRow[]
  expenses: OwnerExpenseRow[]
  from: string
  to: string
  prevFrom: string
  prevTo: string
  group: OwnerGroup
  /** Последний день с данными — обычно «сегодня» */
  through?: string
}): OwnerSeriesPoint[] {
  const { from, to, prevFrom, prevTo, group } = input
  const lastDay = input.through && input.through < to ? input.through : to
  if (lastDay < from) return []

  const count = bucketIndex(from, lastDay, group) + 1
  const points: OwnerSeriesPoint[] = Array.from({ length: count }, (_, i) => ({
    date: bucketStart(from, i, group),
    prevDate: bucketStart(prevFrom, i, group),
    revenue: 0,
    expense: 0,
    profit: 0,
    prevRevenue: 0,
    prevExpense: 0,
    prevProfit: 0,
  }))

  // База сравнения обрезается той же длиной, что и текущий период: при
  // «месяце» на 10-е число 10 дней сравниваются с 10 днями, а не с целым месяцем.
  const prevLast = addDays(prevFrom, daysBetween(from, lastDay))
  const prevCut = prevLast < prevTo ? prevLast : prevTo

  const place = (date: string, apply: (p: OwnerSeriesPoint, current: boolean) => void) => {
    if (date >= from && date <= lastDay) {
      const p = points[bucketIndex(from, date, group)]
      if (p) apply(p, true)
    } else if (date >= prevFrom && date <= prevCut) {
      const p = points[bucketIndex(prevFrom, date, group)]
      if (p) apply(p, false)
    }
  }

  for (const r of input.incomes) {
    const total = num(r.cash_amount) + num(r.kaspi_amount) + num(r.online_amount) + num(r.card_amount)
    place(r.date, (p, current) => {
      if (current) p.revenue += total
      else p.prevRevenue += total
    })
  }
  for (const r of input.expenses) {
    const total = num(r.cash_amount) + num(r.kaspi_amount)
    place(r.date, (p, current) => {
      if (current) p.expense += total
      else p.prevExpense += total
    })
  }

  for (const p of points) {
    p.revenue = round(p.revenue)
    p.expense = round(p.expense)
    p.prevRevenue = round(p.prevRevenue)
    p.prevExpense = round(p.prevExpense)
    p.profit = p.revenue - p.expense
    p.prevProfit = p.prevRevenue - p.prevExpense
  }
  return points
}

/**
 * Число смен в отчётах за период. Строка «безнал после полуночи» — хвост
 * ночной смены, а не отдельная смена: считая её, «выручка за смену» падала на
 * треть там, где половина смен ночные.
 */
export function countShifts(incomes: Pick<OwnerIncomeRow, 'id' | 'date'>[], from: string, to: string): number {
  let n = 0
  for (const r of incomes) {
    if (r.date >= from && r.date <= to && !String(r.id).endsWith(':kaspi-next-day')) n++
  }
  return n
}

/**
 * Средняя выручка по дням недели. Делим на число таких дней в периоде, а не на
 * число дней с выручкой: закрытое воскресенье — это ноль, и оно должно тянуть
 * среднее вниз.
 */
export function buildWeekdays(input: { incomes: OwnerIncomeRow[]; from: string; to: string }) {
  const sums = Array(7).fill(0)
  const days = Array(7).fill(0)
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days[weekdayIndex(d)] += 1
  for (const r of input.incomes) {
    if (r.date < input.from || r.date > input.to) continue
    sums[weekdayIndex(r.date)] +=
      num(r.cash_amount) + num(r.kaspi_amount) + num(r.online_amount) + num(r.card_amount)
  }
  return sums.map((sum, weekday) => ({
    weekday,
    total: round(sum),
    days: days[weekday],
    average: days[weekday] ? round(sum / days[weekday]) : 0,
  }))
}

/** Расходы по статьям с базой сравнения, крупные сверху. */
export function buildExpenseCategories(input: {
  expenses: OwnerExpenseRow[]
  from: string
  to: string
  prevFrom: string
  prevTo: string
}) {
  const map = new Map<string, { name: string; amount: number; prevAmount: number }>()
  for (const r of input.expenses) {
    const current = r.date >= input.from && r.date <= input.to
    const previous = r.date >= input.prevFrom && r.date <= input.prevTo
    if (!current && !previous) continue
    const name = r.category?.trim() || 'Без категории'
    const row = map.get(name) || { name, amount: 0, prevAmount: 0 }
    const total = num(r.cash_amount) + num(r.kaspi_amount)
    if (current) row.amount += total
    else row.prevAmount += total
    map.set(name, row)
  }
  return [...map.values()]
    .map((r) => ({ ...r, amount: round(r.amount), prevAmount: round(r.prevAmount) }))
    .filter((r) => r.amount !== 0 || r.prevAmount !== 0)
    .sort((a, b) => b.amount - a.amount || b.prevAmount - a.prevAmount)
}

/**
 * Выручка по операторам из отчётов смен.
 *
 * Строка «безнал после полуночи» — не отдельная смена, а хвост ночной: в
 * выручку идёт, в счётчик смен — нет. Выручка без оператора не приписывается
 * никому и считается отдельно.
 */
export function buildOperators(input: {
  incomes: OwnerIncomeRow[]
  from: string
  to: string
  prevFrom: string
  prevTo: string
  operatorName: (id: string) => string
}) {
  const map = new Map<string, { id: string; name: string; revenue: number; shifts: number; prevRevenue: number; prevShifts: number }>()
  let unattributed = 0
  for (const r of input.incomes) {
    const current = r.date >= input.from && r.date <= input.to
    const previous = r.date >= input.prevFrom && r.date <= input.prevTo
    if (!current && !previous) continue
    const total = num(r.cash_amount) + num(r.kaspi_amount) + num(r.online_amount) + num(r.card_amount)
    const isShift = !String(r.id).endsWith(':kaspi-next-day')
    const id = r.operator_id ? String(r.operator_id) : ''
    if (!id) {
      if (current) unattributed += total
      continue
    }
    const row = map.get(id) || { id, name: input.operatorName(id), revenue: 0, shifts: 0, prevRevenue: 0, prevShifts: 0 }
    if (current) {
      row.revenue += total
      if (isShift) row.shifts += 1
    } else {
      row.prevRevenue += total
      if (isShift) row.prevShifts += 1
    }
    map.set(id, row)
  }
  const rows = [...map.values()]
    .filter((r) => r.shifts > 0 || r.revenue > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      revenue: round(r.revenue),
      shifts: r.shifts,
      perShift: r.shifts ? round(r.revenue / r.shifts) : 0,
      prevRevenue: round(r.prevRevenue),
      prevPerShift: r.prevShifts ? round(r.prevRevenue / r.prevShifts) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
  return { rows, unattributed: round(unattributed) }
}

// ── Касса ────────────────────────────────────────────────────────────────────

export type OwnerPosSale = {
  sold_at: string
  total_amount: number | null
  cash_amount?: number | null
  kaspi_amount?: number | null
  card_amount?: number | null
  online_amount?: number | null
  items?: {
    quantity: number | null
    total_price: number | null
    universal_name?: string | null
    inventory_items?: OwnerPosItem | OwnerPosItem[] | null
  }[]
}

type OwnerPosItem = {
  name?: string | null
  default_purchase_price?: number | null
  category?: { name?: string | null } | { name?: string | null }[] | null
}

/**
 * Чеки кассы: сумма, средний чек, оплаты, тепловая карта «день недели × час»
 * и товары. Время — по Алматы и по факту продажи (sold_at), а не по дате смены:
 * ночная смена иначе сваливала бы продажи после полуночи во вчера.
 */
export function aggregatePos(sales: OwnerPosSale[], options: { topItems?: number } = {}) {
  let amount = 0
  let cash = 0
  let kaspi = 0
  let card = 0
  let online = 0
  let cost = 0
  let costKnown = true
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  const heatCount: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  const items = new Map<string, { name: string; qty: number; revenue: number; cost: number; costKnown: boolean }>()
  const categories = new Map<string, { name: string; qty: number; revenue: number }>()

  for (const s of sales) {
    const total = num(s.total_amount)
    amount += total
    cash += num(s.cash_amount)
    kaspi += num(s.kaspi_amount)
    card += num(s.card_amount)
    online += num(s.online_amount)

    const local = new Date(new Date(s.sold_at).getTime() + ALMATY_OFFSET_MS)
    const weekday = (local.getUTCDay() + 6) % 7
    const hour = local.getUTCHours()
    heatmap[weekday][hour] += total
    heatCount[weekday][hour] += 1

    for (const it of s.items || []) {
      const inv = Array.isArray(it.inventory_items) ? it.inventory_items[0] : it.inventory_items
      const qty = num(it.quantity)
      const revenue = num(it.total_price)
      const unitCost = inv?.default_purchase_price
      const known = unitCost != null && num(unitCost) > 0
      if (known) cost += num(unitCost) * qty
      else costKnown = false

      const name = inv?.name || it.universal_name || 'Товар'
      const row = items.get(name) || { name, qty: 0, revenue: 0, cost: 0, costKnown: true }
      row.qty += qty
      row.revenue += revenue
      if (known) row.cost += num(unitCost) * qty
      else row.costKnown = false
      items.set(name, row)

      const cat = Array.isArray(inv?.category) ? inv?.category[0]?.name : inv?.category?.name
      const catName = cat || (inv ? 'Без категории' : 'Прочее')
      const crow = categories.get(catName) || { name: catName, qty: 0, revenue: 0 }
      crow.qty += qty
      crow.revenue += revenue
      categories.set(catName, crow)
    }
  }

  const receipts = sales.length
  const byHour = Array.from({ length: 24 }, (_, hour) => {
    let a = 0
    let c = 0
    for (let d = 0; d < 7; d++) {
      a += heatmap[d][hour]
      c += heatCount[d][hour]
    }
    return { hour, amount: round(a), count: c }
  })

  return {
    amount: round(amount),
    receipts,
    avgCheck: receipts ? round(amount / receipts) : 0,
    payment: { cash: round(cash), kaspi: round(kaspi), card: round(card), online: round(online) },
    /** Себестоимость по закупочной цене; null — у части товаров цены нет, и сумма соврала бы */
    grossProfit: costKnown && sales.length ? round(amount - cost) : null,
    heatmap: heatmap.map((row) => row.map(round)),
    byHour,
    topItems: [...items.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, options.topItems ?? 20)
      .map((r) => ({
        name: r.name,
        qty: Math.round(r.qty * 100) / 100,
        revenue: round(r.revenue),
        profit: r.costKnown ? round(r.revenue - r.cost) : null,
      })),
    byCategory: [...categories.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((r) => ({ name: r.name, qty: Math.round(r.qty * 100) / 100, revenue: round(r.revenue) })),
  }
}

/**
 * Окно кассы для базы сравнения. Если период кончается сегодня, база
 * обрезается тем же часом: сегодняшние 3 часа работы против вчерашних целых
 * суток — это «−77%» на ровном месте.
 */
export function posCompareWindow(input: {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  now: Date
}) {
  const startOf = (iso: string) => isoToUtc(iso) - ALMATY_OFFSET_MS
  const today = almatyToday(input.now)
  const current = {
    start: startOf(input.from),
    end: Math.min(startOf(input.to) + DAY_MS, input.now.getTime()),
  }
  let prevEnd = startOf(input.prevTo) + DAY_MS
  if (input.to >= today && today >= input.from) {
    const elapsedToday = input.now.getTime() - startOf(today)
    const prevToday = addDays(input.prevFrom, daysBetween(input.from, today))
    prevEnd = Math.min(prevEnd, startOf(prevToday) + elapsedToday)
  }
  return {
    current: { from: new Date(current.start).toISOString(), to: new Date(current.end).toISOString() },
    previous: { from: new Date(startOf(input.prevFrom)).toISOString(), to: new Date(prevEnd).toISOString() },
    truncated: input.to >= today && today >= input.from,
  }
}
