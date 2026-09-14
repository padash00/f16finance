/**
 * Недельный баланс (/weekly-report) — расчёт без базы и без React.
 *
 * Правила — как в /reports и печатном акте:
 *  - безналичный ночной смены после полуночи относится к следующему дню
 *    (splitIncomeKaspiByCalendarDay), поэтому ночь с воскресенья на понедельник
 *    частично уходит в следующую неделю, а ночь перед понедельником — приходит;
 *  - отклонённые расходы не считаются; расходы на согласовании считаются, но
 *    показываются отдельно;
 *  - «Безналичный» = терминал и переводы + онлайн + карта, расход безналом —
 *    kaspi_amount расхода;
 *  - F16 Extra в итогах только по галочке, но в списке точек видна всегда.
 *
 * Сравнение — по тем же дням: если идёт среда, пн–ср против пн–ср. База на
 * выбор: прошлая неделя, 4 недели назад или среднее за 8 недель.
 */

import { addDaysISO } from '@/lib/core/date'
import { cumulativeTargetCurve, datesBetween, goalPace, weekdayWeights, type GoalPace } from '@/lib/analysis/goal-pace'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'

export type WeekIncomeRow = {
  id?: string | number
  date: string
  company_id: string
  shift?: 'day' | 'night' | null
  zone?: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight?: number | null
  online_amount: number | null
  card_amount: number | null
  comment?: string | null
}

export type WeekExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  status?: string | null
  comment?: string | null
  one_off_payee?: string | null
}

export type WeekCompany = { id: string; name: string; code?: string | null }

export type CompareMode = 'week' | 'month' | 'avg8'

export const COMPARE_MODES: Record<CompareMode, { offsets: number[]; label: string; short: string }> = {
  week: { offsets: [7], label: 'те же дни прошлой недели', short: 'Прошлая неделя' },
  month: { offsets: [28], label: 'те же дни 4 недели назад', short: '4 недели назад' },
  avg8: { offsets: [7, 14, 21, 28, 35, 42, 49, 56], label: 'в среднем те же дни за 8 недель', short: 'Среднее за 8 недель' },
}

export type PeriodSums = {
  income: { cash: number; terminal: number; online: number; card: number; cashless: number; total: number; day: number; night: number }
  expense: { cash: number; cashless: number; total: number }
  profit: number
  margin: number
  netCash: number
  netCashless: number
}

export type WeekDay = { date: string; weekday: number; current: PeriodSums; previous: PeriodSums; hasData: boolean; future: boolean }

export type CompanyWeek = {
  id: string
  name: string
  isExtra: boolean
  inTotals: boolean
  current: PeriodSums
  /** Текущая неделя по сравнимые дни */
  currentCompared: PeriodSums
  previous: PeriodSums
  categories: Array<{ name: string; cash: number; cashless: number; total: number }>
}

export type CategoryWeek = { name: string; cash: number; cashless: number; total: number; compared: number; previous: number; share: number }
export type LargeExpense = { date: string; company: string; category: string; payee: string; cash: number; cashless: number; total: number; pending: boolean }
export type WeekChange = { key: string; label: string; kind: 'revenue' | 'category'; current: number; previous: number; effect: number }
export type WeekAlert = { tone: 'danger' | 'warning' | 'success' | 'info'; title: string; text: string }
export type MissingShift = { companyId: string; company: string; date: string; shift: 'day' | 'night' }

export type WeeklyBalance = {
  weekStart: string
  weekEnd: string
  compare: CompareMode
  compareLabel: string
  compareShort: string
  /** Последний сравнимый день текущей недели; null — данных ещё нет */
  compareUntil: string | null
  comparedDays: number
  /** Вся неделя */
  current: PeriodSums
  /** Текущая неделя по сравнимые дни */
  compared: PeriodSums
  /** База сравнения за те же дни */
  previous: PeriodSums
  days: WeekDay[]
  cumulative: Array<{ date: string; netCash: number; netCashless: number; net: number }>
  companies: CompanyWeek[]
  categories: CategoryWeek[]
  largestExpenses: LargeExpense[]
  changes: WeekChange[]
  alerts: WeekAlert[]
  missingShifts: MissingShift[]
  pending: { count: number; total: number }
  extra: { names: string[]; excludedIncome: number }
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

function emptySums(): PeriodSums {
  return {
    income: { cash: 0, terminal: 0, online: 0, card: 0, cashless: 0, total: 0, day: 0, night: 0 },
    expense: { cash: 0, cashless: 0, total: 0 },
    profit: 0,
    margin: 0,
    netCash: 0,
    netCashless: 0,
  }
}

type IncomeParts = { cash: number; terminal: number; online: number; card: number; night: boolean }

function addIncome(s: PeriodSums, p: IncomeParts, k = 1) {
  s.income.cash += p.cash * k
  s.income.terminal += p.terminal * k
  s.income.online += p.online * k
  s.income.card += p.card * k
  const total = (p.cash + p.terminal + p.online + p.card) * k
  if (p.night) s.income.night += total
  else s.income.day += total
}

function addExpense(s: PeriodSums, cash: number, cashless: number, k = 1) {
  s.expense.cash += cash * k
  s.expense.cashless += cashless * k
}

function finalize(s: PeriodSums): PeriodSums {
  s.income.cashless = s.income.terminal + s.income.online + s.income.card
  s.income.total = s.income.cash + s.income.cashless
  s.expense.total = s.expense.cash + s.expense.cashless
  s.profit = s.income.total - s.expense.total
  s.margin = s.income.total ? (s.profit / s.income.total) * 100 : 0
  s.netCash = s.income.cash - s.expense.cash
  s.netCashless = s.income.cashless - s.expense.cashless
  return s
}

const money = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ₸`
const DAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const LARGEST = 15
const TOP_CHANGES = 5
/** Сколько недель истории смотреть, чтобы понять, какие смены точка обычно сдаёт */
const SHIFT_HISTORY_DAYS = 28
/** Смена «обычная», если отчёт по ней был хотя бы в такой доле дней */
const SHIFT_REGULAR_SHARE = 0.6

const splitRows = (rows: WeekIncomeRow[]) =>
  splitIncomeKaspiByCalendarDay(
    rows.map((r, i) => ({
      ...r,
      id: String(r.id ?? `row-${i}`),
      company_id: String(r.company_id),
      shift: (r.shift ?? 'day') as 'day' | 'night',
      zone: r.zone ?? null,
      comment: r.comment ?? null,
    })) as ReportIncomeCalendarRow[],
  )

const partsOf = (r: ReportIncomeCalendarRow): IncomeParts => ({
  cash: n(r.cash_amount),
  terminal: n(r.kaspi_amount),
  online: n(r.online_amount),
  card: n(r.card_amount),
  night: r.shift === 'night',
})

/**
 * Какие отчёты смен не внесены. Ожидаем смену, если точка сдавала её в 60%+
 * дней за 4 недели до этой недели. Проверяем по вчерашний день: сегодняшние
 * отчёты ещё в работе. Новая точка без истории не проверяется.
 */
export function findMissingShifts(input: { incomes: WeekIncomeRow[]; companies: WeekCompany[]; weekStart: string; today: string }): MissingShift[] {
  const { weekStart, today } = input
  const historyFrom = addDaysISO(weekStart, -SHIFT_HISTORY_DAYS)
  const checkUntil = addDaysISO(today, -1)
  const weekEnd = addDaysISO(weekStart, 6)
  const until = checkUntil < weekEnd ? checkUntil : weekEnd
  if (until < weekStart) return []

  const seen = new Map<string, Set<string>>() // company|shift -> dates
  for (const r of input.incomes) {
    if (r.shift !== 'day' && r.shift !== 'night') continue
    const key = `${r.company_id}|${r.shift}`
    const set = seen.get(key) || new Set<string>()
    set.add(r.date)
    seen.set(key, set)
  }

  const out: MissingShift[] = []
  const checkDates = datesBetween(weekStart, until)
  for (const c of input.companies) {
    for (const shift of ['day', 'night'] as const) {
      const dates = seen.get(`${c.id}|${shift}`)
      if (!dates) continue
      let history = 0
      for (const d of dates) if (d >= historyFrom && d < weekStart) history += 1
      if (history / SHIFT_HISTORY_DAYS < SHIFT_REGULAR_SHARE) continue
      for (const d of checkDates) if (!dates.has(d)) out.push({ companyId: String(c.id), company: c.name, date: d, shift })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company) || a.shift.localeCompare(b.shift))
}

export function buildWeeklyBalance(input: {
  incomes: WeekIncomeRow[]
  expenses: WeekExpenseRow[]
  companies: WeekCompany[]
  /** Понедельник недели, YYYY-MM-DD */
  weekStart: string
  today: string
  includeExtra: boolean
  compare?: CompareMode
}): WeeklyBalance {
  const { weekStart, today, includeExtra } = input
  const compare = input.compare ?? 'week'
  const mode = COMPARE_MODES[compare]
  const k = 1 / mode.offsets.length
  const weekEnd = addDaysISO(weekStart, 6)

  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const inTotals = (companyId: string) => includeExtra || !extraIds.has(companyId)
  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))

  const incomes = splitRows(input.incomes)
  const expenses = input.expenses.filter((r) => r.status !== 'declined')

  // Последний сравнимый день: прошедшая неделя — целиком, идущая — по последний день с данными
  let compareUntil: string | null = null
  if (weekEnd < today) {
    compareUntil = weekEnd
  } else {
    const limit = today < weekEnd ? today : weekEnd
    const consider = (date: string, companyId: string, amount: number) => {
      if (date < weekStart || date > limit || !inTotals(companyId) || !amount) return
      if (!compareUntil || date > compareUntil) compareUntil = date
    }
    for (const r of incomes) consider(r.date, String(r.company_id), n(r.cash_amount) + n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount))
    for (const r of expenses) consider(r.date, String(r.company_id), n(r.cash_amount) + n(r.kaspi_amount))
  }
  const until: string | null = compareUntil
  const comparedDays = until ? Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000) + 1 : 0

  const current = emptySums()
  const compared = emptySums()
  const previous = emptySums()
  const dates = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i))
  const dayCurrent = new Map(dates.map((d) => [d, emptySums()]))
  const dayPrevious = new Map(dates.map((d) => [d, emptySums()]))

  type CompanyAcc = { current: PeriodSums; compared: PeriodSums; previous: PeriodSums; categories: Map<string, { cash: number; cashless: number }> }
  const companyAcc = new Map<string, CompanyAcc>()
  const companyOf = (id: string) => {
    let acc = companyAcc.get(id)
    if (!acc) {
      acc = { current: emptySums(), compared: emptySums(), previous: emptySums(), categories: new Map() }
      companyAcc.set(id, acc)
    }
    return acc
  }
  for (const c of input.companies) companyOf(String(c.id))

  const inWeek = (d: string) => d >= weekStart && d <= weekEnd
  const inCompared = (d: string) => until != null && d >= weekStart && d <= until
  let extraIncome = 0

  for (const r of incomes) {
    const cid = String(r.company_id)
    const p = partsOf(r)
    if (!p.cash && !p.terminal && !p.online && !p.card) continue
    const acc = companyOf(cid)
    const counted = inTotals(cid)
    if (inWeek(r.date)) {
      addIncome(acc.current, p)
      if (!counted) extraIncome += p.cash + p.terminal + p.online + p.card
      if (counted) {
        addIncome(current, p)
        addIncome(dayCurrent.get(r.date)!, p)
      }
    }
    if (inCompared(r.date)) {
      addIncome(acc.compared, p)
      if (counted) addIncome(compared, p)
    }
    // База сравнения: день, сдвинутый вперёд на смещение, попадает в сравнимые дни этой недели
    for (const offset of mode.offsets) {
      const shifted = addDaysISO(r.date, offset)
      if (inCompared(shifted)) {
        addIncome(acc.previous, p, k)
        if (counted) addIncome(previous, p, k)
      }
      if (counted && inWeek(shifted)) addIncome(dayPrevious.get(shifted)!, p, k)
    }
  }

  const categoryAcc = new Map<string, { cash: number; cashless: number; compared: number; previous: number }>()
  const categoryOf = (name: string) => {
    let acc = categoryAcc.get(name)
    if (!acc) {
      acc = { cash: 0, cashless: 0, compared: 0, previous: 0 }
      categoryAcc.set(name, acc)
    }
    return acc
  }
  const largest: LargeExpense[] = []
  const pending = { count: 0, total: 0 }

  for (const r of expenses) {
    const cid = String(r.company_id)
    const cash = n(r.cash_amount)
    const cashless = n(r.kaspi_amount)
    if (!cash && !cashless) continue
    const category = String(r.category || '').trim() || 'Без статьи'
    const acc = companyOf(cid)
    const counted = inTotals(cid)
    const isPending = r.status === 'pending_approval'
    if (inWeek(r.date)) {
      addExpense(acc.current, cash, cashless)
      const cat = acc.categories.get(category) || { cash: 0, cashless: 0 }
      cat.cash += cash
      cat.cashless += cashless
      acc.categories.set(category, cat)
      if (counted) {
        addExpense(current, cash, cashless)
        addExpense(dayCurrent.get(r.date)!, cash, cashless)
        const total = categoryOf(category)
        total.cash += cash
        total.cashless += cashless
        if (isPending) {
          pending.count += 1
          pending.total += cash + cashless
        }
        largest.push({
          date: r.date,
          company: nameOf.get(cid) || '—',
          category,
          payee: String(r.one_off_payee || r.comment || '').trim(),
          cash,
          cashless,
          total: cash + cashless,
          pending: isPending,
        })
      }
    }
    if (inCompared(r.date)) {
      addExpense(acc.compared, cash, cashless)
      if (counted) {
        addExpense(compared, cash, cashless)
        categoryOf(category).compared += cash + cashless
      }
    }
    for (const offset of mode.offsets) {
      const shifted = addDaysISO(r.date, offset)
      if (inCompared(shifted)) {
        addExpense(acc.previous, cash, cashless, k)
        if (counted) {
          addExpense(previous, cash, cashless, k)
          categoryOf(category).previous += (cash + cashless) * k
        }
      }
      if (counted && inWeek(shifted)) addExpense(dayPrevious.get(shifted)!, cash, cashless, k)
    }
  }

  finalize(current)
  finalize(compared)
  finalize(previous)

  const days: WeekDay[] = dates.map((date, weekday) => {
    const cur = finalize(dayCurrent.get(date)!)
    return {
      date,
      weekday,
      current: cur,
      previous: finalize(dayPrevious.get(date)!),
      hasData: cur.income.total !== 0 || cur.expense.total !== 0,
      future: date > today,
    }
  })

  let runCash = 0
  let runCashless = 0
  const cumulative = days
    .filter((d) => !d.future)
    .map((d) => {
      runCash += d.current.netCash
      runCashless += d.current.netCashless
      return { date: d.date, netCash: runCash, netCashless: runCashless, net: runCash + runCashless }
    })

  const companies: CompanyWeek[] = input.companies
    .map((c) => {
      const id = String(c.id)
      const acc = companyOf(id)
      return {
        id,
        name: c.name,
        isExtra: extraIds.has(id),
        inTotals: inTotals(id),
        current: finalize(acc.current),
        currentCompared: finalize(acc.compared),
        previous: finalize(acc.previous),
        categories: Array.from(acc.categories.entries())
          .map(([name, v]) => ({ name, cash: v.cash, cashless: v.cashless, total: v.cash + v.cashless }))
          .sort((a, b) => b.total - a.total),
      }
    })
    .filter((c) => c.current.income.total || c.current.expense.total || c.previous.income.total || c.previous.expense.total || !c.isExtra)
    .sort((a, b) => Number(a.isExtra) - Number(b.isExtra) || b.current.income.total - a.current.income.total)

  const categories: CategoryWeek[] = Array.from(categoryAcc.entries())
    .map(([name, v]) => ({
      name,
      cash: v.cash,
      cashless: v.cashless,
      total: v.cash + v.cashless,
      compared: v.compared,
      previous: v.previous,
      share: current.expense.total ? ((v.cash + v.cashless) / current.expense.total) * 100 : 0,
    }))
    .filter((c) => c.total || c.previous)
    .sort((a, b) => b.total - a.total || b.previous - a.previous)

  largest.sort((a, b) => b.total - a.total)

  const changes: WeekChange[] = []
  if (until) {
    const revenueEffect = compared.income.total - previous.income.total
    if (Math.round(revenueEffect)) {
      changes.push({ key: 'revenue', label: 'Выручка', kind: 'revenue', current: compared.income.total, previous: previous.income.total, effect: revenueEffect })
    }
    changes.push(
      ...categories
        .map((c) => ({ key: `cat:${c.name}`, label: c.name, kind: 'category' as const, current: c.compared, previous: c.previous, effect: -(c.compared - c.previous) }))
        .filter((c) => Math.round(c.effect) !== 0)
        .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
        .slice(0, TOP_CHANGES),
    )
  }

  const missingShifts = findMissingShifts({
    incomes: input.incomes.filter((r) => inTotals(String(r.company_id))),
    companies: input.companies.filter((c) => inTotals(String(c.id))),
    weekStart,
    today,
  })

  const alerts: WeekAlert[] = []
  if (missingShifts.length) {
    const shown = missingShifts
      .slice(0, 3)
      .map((m) => `${m.company} — ${m.shift === 'night' ? 'ночь' : 'день'} ${DAY_SHORT[(new Date(`${m.date}T00:00:00Z`).getUTCDay() + 6) % 7]} ${m.date.slice(8, 10)}.${m.date.slice(5, 7)}`)
    alerts.push({
      tone: 'warning',
      title: `Не внесены отчёты смен: ${missingShifts.length}`,
      text: `${shown.join(', ')}${missingShifts.length > 3 ? ' и ещё' : ''}. Пока их нет, выручка недели занижена.`,
    })
  }
  if (!current.income.total && !current.expense.total) {
    alerts.push({ tone: 'info', title: 'За неделю ещё нет данных', text: 'Отчёты смен и расходы появятся здесь, как только их внесут.' })
  } else {
    if (current.profit < 0) {
      alerts.push({ tone: 'danger', title: 'Неделя в минусе', text: `Расходы больше выручки на ${money(-current.profit)}.` })
    }
    if (current.netCash < 0) {
      alerts.push({ tone: 'warning', title: 'Наличных потрачено больше, чем получено', text: `Разница ${money(-current.netCash)} — проверьте остаток в кассе.` })
    }
    if (current.netCashless < 0) {
      alerts.push({ tone: 'warning', title: 'Безналичных расходов больше поступлений', text: `Разница ${money(-current.netCashless)}.` })
    }
    const revenueChange = deltaPct(compared.income.total, previous.income.total)
    const daysLabel = comparedDays === 7 ? '' : ` (пн–${DAY_SHORT[comparedDays - 1]})`
    if (revenueChange != null && revenueChange <= -15) {
      alerts.push({ tone: 'warning', title: 'Выручка ниже обычного', text: `${revenueChange.toFixed(1)}% к ${mode.label.replace('те же', 'тем же')}${daysLabel}: ${money(compared.income.total)} против ${money(previous.income.total)}.` })
    } else if (revenueChange != null && revenueChange >= 15) {
      alerts.push({ tone: 'success', title: 'Выручка выше обычного', text: `+${revenueChange.toFixed(1)}% к ${mode.label.replace('те же', 'тем же')}${daysLabel}: ${money(compared.income.total)} против ${money(previous.income.total)}.` })
    }
    if (pending.count) {
      alerts.push({ tone: 'info', title: `Ждут согласования: ${pending.count} на ${money(pending.total)}`, text: 'Уже учтены в расходах недели; если их отклонят — прибыль вырастет.' })
    }
    const top = categories[0]
    if (top && top.share > 40 && categories.length > 1) {
      alerts.push({ tone: 'info', title: 'Одна статья — большая часть расходов', text: `«${top.name}» — ${top.share.toFixed(0)}% расходов недели (${money(top.total)}).` })
    }
  }

  return {
    weekStart,
    weekEnd,
    compare,
    compareLabel: mode.label,
    compareShort: mode.short,
    compareUntil: until,
    comparedDays,
    current,
    compared,
    previous,
    days,
    cumulative,
    companies,
    categories,
    largestExpenses: largest.slice(0, LARGEST),
    changes,
    alerts: alerts.slice(0, 5),
    missingShifts,
    pending,
    extra: { names: input.companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name), excludedIncome: extraIncome },
  }
}

// ─── Неделя против месячного плана ──────────────────────────────────────────

export type PlanRow = { company_id: string | null; kind: string; target_amount: number; period_start: string }

export type WeekPlanStatus = {
  month: string
  target: number
  source: 'org' | 'points'
  fact: number
  lastFactDate: string
  pace: GoalPace
  /** Часть недели внутри месяца */
  weekFrom: string
  weekTo: string
  /** Сколько по ритму нужно было за эту неделю (её дни в месяце) */
  weekExpected: number
  /** …и по последний день с фактом */
  weekExpectedToDate: number
  weekFact: number
}

/**
 * Неделя против цели выручки месяца (/goals). Цель — общая цель организации,
 * а если её нет — сумма целей точек. Факт — сеть без F16 Extra, как в целях.
 */
export function weekPlanStatus(input: {
  plans: PlanRow[]
  incomes: WeekIncomeRow[]
  companies: WeekCompany[]
  weekStart: string
  today: string
}): WeekPlanStatus | null {
  const weekEnd = addDaysISO(input.weekStart, 6)
  const yesterday = addDaysISO(input.today, -1)
  const anchor = weekEnd < input.today ? weekEnd : yesterday < input.weekStart ? input.weekStart : yesterday
  const month = anchor.slice(0, 7)
  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

  const revenuePlans = input.plans.filter((p) => p.kind === 'month.revenue' && p.period_start === monthStart && Number(p.target_amount) > 0)
  const org = revenuePlans.find((p) => !p.company_id)
  const target = org ? Number(org.target_amount) : revenuePlans.filter((p) => p.company_id).reduce((s, p) => s + Number(p.target_amount), 0)
  if (!(target > 0)) return null

  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const lastFactDate = anchor < yesterday ? anchor : yesterday
  const byDate = new Map<string, number>()
  for (const r of splitRows(input.incomes)) {
    if (extraIds.has(String(r.company_id))) continue
    const total = n(r.cash_amount) + n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount)
    if (!total) continue
    byDate.set(r.date, (byDate.get(r.date) || 0) + total)
  }
  const sumRange = (from: string, to: string) => {
    let s = 0
    for (const [date, v] of byDate) if (date >= from && date <= to) s += v
    return s
  }

  const rhythmFrom = addDaysISO(lastFactDate, -55)
  const weights = weekdayWeights(
    Array.from(byDate.entries())
      .filter(([date]) => date >= rhythmFrom && date <= lastFactDate)
      .map(([date, value]) => ({ date, value })),
  )
  const fact = sumRange(monthStart, lastFactDate)
  const pace = goalPace({ target, fact, start: monthStart, end: monthEnd, lastFactDate, weights })
  if (!pace) return null

  const monthDates = datesBetween(monthStart, monthEnd)
  const curve = cumulativeTargetCurve(monthDates, target, weights)
  const cumAt = (date: string) => {
    if (date < monthStart) return 0
    const idx = monthDates.indexOf(date > monthEnd ? monthEnd : date)
    return idx >= 0 ? curve[idx] : 0
  }
  const weekFrom = input.weekStart > monthStart ? input.weekStart : monthStart
  const weekTo = weekEnd < monthEnd ? weekEnd : monthEnd
  const factTo = weekTo < lastFactDate ? weekTo : lastFactDate
  const before = addDaysISO(weekFrom, -1)

  return {
    month,
    target,
    source: org ? 'org' : 'points',
    fact,
    lastFactDate,
    pace,
    weekFrom,
    weekTo,
    weekExpected: cumAt(weekTo) - cumAt(before),
    weekExpectedToDate: factTo >= weekFrom ? cumAt(factTo) - cumAt(before) : 0,
    weekFact: factTo >= weekFrom ? sumRange(weekFrom, factTo) : 0,
  }
}
