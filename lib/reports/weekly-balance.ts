/**
 * Недельный баланс (/weekly-report) — расчёт без базы и без React.
 *
 * Правила — как в /reports и печатном акте:
 *  - безналичный ночной смены после полуночи относится к следующему дню
 *    (splitIncomeKaspiByCalendarDay), поэтому ночь с воскресенья на понедельник
 *    частично уходит в следующую неделю, а ночь перед понедельником — приходит;
 *  - отклонённые расходы не считаются;
 *  - «Безналичный» = терминал и переводы + онлайн + карта, расход безналом —
 *    kaspi_amount расхода;
 *  - F16 Extra в итогах только по галочке, но в списке точек видна всегда.
 *
 * Сравнение с прошлой неделей — по тем же дням: если идёт среда, пн–ср против
 * пн–ср, а не против всей прошлой недели (иначе до воскресенья всегда «падение»).
 */

import { addDaysISO } from '@/lib/core/date'
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

export type PeriodSums = {
  income: { cash: number; terminal: number; online: number; card: number; cashless: number; total: number }
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
export type LargeExpense = { date: string; company: string; category: string; payee: string; cash: number; cashless: number; total: number }
export type WeekChange = { key: string; label: string; kind: 'revenue' | 'category'; current: number; previous: number; effect: number }
export type WeekAlert = { tone: 'danger' | 'warning' | 'success' | 'info'; title: string; text: string }

export type WeeklyBalance = {
  weekStart: string
  weekEnd: string
  prevStart: string
  /** Последний сравнимый день текущей недели; null — данных ещё нет */
  compareUntil: string | null
  prevUntil: string | null
  comparedDays: number
  /** Вся неделя */
  current: PeriodSums
  /** Текущая неделя по сравнимые дни */
  compared: PeriodSums
  /** Те же дни прошлой недели */
  previous: PeriodSums
  days: WeekDay[]
  cumulative: Array<{ date: string; netCash: number; netCashless: number; net: number }>
  companies: CompanyWeek[]
  categories: CategoryWeek[]
  largestExpenses: LargeExpense[]
  changes: WeekChange[]
  alerts: WeekAlert[]
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
    income: { cash: 0, terminal: 0, online: 0, card: 0, cashless: 0, total: 0 },
    expense: { cash: 0, cashless: 0, total: 0 },
    profit: 0,
    margin: 0,
    netCash: 0,
    netCashless: 0,
  }
}

function addIncome(s: PeriodSums, cash: number, terminal: number, online: number, card: number) {
  s.income.cash += cash
  s.income.terminal += terminal
  s.income.online += online
  s.income.card += card
}

function addExpense(s: PeriodSums, cash: number, cashless: number) {
  s.expense.cash += cash
  s.expense.cashless += cashless
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

export function buildWeeklyBalance(input: {
  incomes: WeekIncomeRow[]
  expenses: WeekExpenseRow[]
  companies: WeekCompany[]
  /** Понедельник недели, YYYY-MM-DD */
  weekStart: string
  today: string
  includeExtra: boolean
}): WeeklyBalance {
  const { weekStart, today, includeExtra } = input
  const weekEnd = addDaysISO(weekStart, 6)
  const prevStart = addDaysISO(weekStart, -7)

  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const inTotals = (companyId: string) => includeExtra || !extraIds.has(companyId)
  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))

  const incomes = splitIncomeKaspiByCalendarDay(
    input.incomes.map((r, i) => ({
      ...r,
      id: String(r.id ?? `row-${i}`),
      company_id: String(r.company_id),
      shift: (r.shift ?? 'day') as 'day' | 'night',
      zone: r.zone ?? null,
      comment: r.comment ?? null,
    })) as ReportIncomeCalendarRow[],
  )
  const expenses = input.expenses.filter((r) => r.status !== 'declined')

  // Последний сравнимый день: прошедшая неделя — целиком, идущая — по последний день с данными
  let compareUntil: string | null = null
  if (weekEnd < today) {
    compareUntil = weekEnd
  } else {
    const limit = today < weekEnd ? today : weekEnd
    for (const r of [...incomes, ...expenses]) {
      if (r.date < weekStart || r.date > limit || !inTotals(String(r.company_id))) continue
      const has = 'category' in r ? n(r.cash_amount) + n(r.kaspi_amount) !== 0 : n(r.cash_amount) + n(r.kaspi_amount) + n((r as any).online_amount) + n((r as any).card_amount) !== 0
      if (has && (!compareUntil || r.date > compareUntil)) compareUntil = r.date
    }
  }
  const prevUntil = compareUntil ? addDaysISO(compareUntil, -7) : null
  const comparedDays = compareUntil ? Math.round((Date.parse(`${compareUntil}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000) + 1 : 0

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
  const inCompared = (d: string) => compareUntil != null && d >= weekStart && d <= compareUntil
  const inPrevious = (d: string) => prevUntil != null && d >= prevStart && d <= prevUntil
  const inPrevWeek = (d: string) => d >= prevStart && d < weekStart
  let extraIncome = 0

  for (const r of incomes) {
    const cid = String(r.company_id)
    const cash = n(r.cash_amount)
    const terminal = n(r.kaspi_amount)
    const online = n(r.online_amount)
    const card = n(r.card_amount)
    if (!cash && !terminal && !online && !card) continue
    const acc = companyOf(cid)
    const counted = inTotals(cid)
    if (inWeek(r.date)) {
      addIncome(acc.current, cash, terminal, online, card)
      if (!counted) extraIncome += cash + terminal + online + card
      if (counted) {
        addIncome(current, cash, terminal, online, card)
        addIncome(dayCurrent.get(r.date)!, cash, terminal, online, card)
      }
    }
    if (inCompared(r.date)) {
      addIncome(acc.compared, cash, terminal, online, card)
      if (counted) addIncome(compared, cash, terminal, online, card)
    }
    if (inPrevious(r.date)) {
      addIncome(acc.previous, cash, terminal, online, card)
      if (counted) addIncome(previous, cash, terminal, online, card)
    }
    if (counted && inPrevWeek(r.date)) addIncome(dayPrevious.get(addDaysISO(r.date, 7))!, cash, terminal, online, card)
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

  for (const r of expenses) {
    const cid = String(r.company_id)
    const cash = n(r.cash_amount)
    const cashless = n(r.kaspi_amount)
    if (!cash && !cashless) continue
    const category = String(r.category || '').trim() || 'Без статьи'
    const acc = companyOf(cid)
    const counted = inTotals(cid)
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
        largest.push({
          date: r.date,
          company: nameOf.get(cid) || '—',
          category,
          payee: String(r.one_off_payee || r.comment || '').trim(),
          cash,
          cashless,
          total: cash + cashless,
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
    if (inPrevious(r.date)) {
      addExpense(acc.previous, cash, cashless)
      if (counted) {
        addExpense(previous, cash, cashless)
        categoryOf(category).previous += cash + cashless
      }
    }
    if (counted && inPrevWeek(r.date)) addExpense(dayPrevious.get(addDaysISO(r.date, 7))!, cash, cashless)
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

  // Что изменилось к тем же дням прошлой недели: выручка и статьи с самым сильным влиянием
  const changes: WeekChange[] = []
  if (compareUntil) {
    const revenueEffect = compared.income.total - previous.income.total
    if (revenueEffect) {
      changes.push({ key: 'revenue', label: 'Выручка', kind: 'revenue', current: compared.income.total, previous: previous.income.total, effect: revenueEffect })
    }
    changes.push(
      ...categories
        .map((c) => ({ key: `cat:${c.name}`, label: c.name, kind: 'category' as const, current: c.compared, previous: c.previous, effect: -(c.compared - c.previous) }))
        .filter((c) => c.effect !== 0)
        .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
        .slice(0, TOP_CHANGES),
    )
  }

  const alerts: WeekAlert[] = []
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
    const daysLabel = comparedDays === 7 ? 'за неделю' : `за те же дни (пн–${DAY_SHORT[comparedDays - 1]})`
    if (revenueChange != null && revenueChange <= -15) {
      alerts.push({ tone: 'warning', title: 'Выручка ниже прошлой недели', text: `${revenueChange.toFixed(1)}% ${daysLabel}: ${money(compared.income.total)} против ${money(previous.income.total)}.` })
    } else if (revenueChange != null && revenueChange >= 15) {
      alerts.push({ tone: 'success', title: 'Выручка выше прошлой недели', text: `+${revenueChange.toFixed(1)}% ${daysLabel}: ${money(compared.income.total)} против ${money(previous.income.total)}.` })
    }
    const top = categories[0]
    if (top && top.share > 40 && categories.length > 1) {
      alerts.push({ tone: 'info', title: 'Одна статья — большая часть расходов', text: `«${top.name}» — ${top.share.toFixed(0)}% расходов недели (${money(top.total)}).` })
    }
  }

  return {
    weekStart,
    weekEnd,
    prevStart,
    compareUntil,
    prevUntil,
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
    alerts: alerts.slice(0, 4),
    extra: { names: input.companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name), excludedIncome: extraIncome },
  }
}
