/**
 * Движение денег (/cashflow) — полный расчёт без базы.
 *
 * Правила — как в /reports:
 *  - безналичный ночной смены после полуночи — на следующий день;
 *  - отклонённые расходы деньгами не стали и не считаются;
 *  - F16 Extra в итогах только по галочке (или если выбрана сама точка).
 *
 * Два разных вопроса — два разных охвата:
 *  - «сколько пришло и ушло» — по правилам отчётов (Extra по галочке);
 *  - «сколько денег на руках» — по отметке остатка: у организации это все
 *    точки, включая Extra, потому что деньги реальные. Остаток на конец дня
 *    = отметка на утро её даты + поступления − расходы от этой даты.
 *
 * «Безналичный» = терминал и переводы + онлайн + карта; расход безналом —
 * kaspi_amount расхода.
 */

import { addDaysISO } from '@/lib/core/date'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'

export type CfIncomeRow = {
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

export type CfExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  status?: string | null
  comment?: string | null
  one_off_payee?: string | null
}

export type CfCompany = { id: string; name: string; code?: string | null }

export type BalanceAnchor = {
  id: string
  company_id: string | null
  as_of_date: string
  cash_amount: number
  cashless_amount: number
  note?: string | null
}

export type Flow = { in: number; out: number; net: number }
export type ChannelFlows = { cash: Flow; cashless: Flow; total: Flow }
export type Money3 = { cash: number; cashless: number; total: number }

export type ActivityKey = 'operating' | 'investing' | 'owners' | 'taxes' | 'other'
export const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  operating: 'Текущие расходы',
  investing: 'Вложения и оборудование',
  owners: 'Выплаты партнёрам',
  taxes: 'Налоги',
  other: 'Разовые и прочие',
}

export function activityOf(group: FinancialGroup): ActivityKey {
  if (group === 'capex') return 'investing'
  if (group === 'profit_distribution') return 'owners'
  if (group === 'income_tax') return 'taxes'
  if (group === 'non_operating') return 'other'
  return 'operating'
}

export type CfDay = {
  date: string
  cashIn: number
  cashOut: number
  cashlessIn: number
  cashlessOut: number
  /** Старые поля ответа — их читает приложение */
  income: number
  expense: number
  net: number
  /** Накопленный поток с начала периода (не остаток) */
  balance: number
  /** Остаток на конец дня — только если есть отметка остатка */
  onHand: Money3 | null
}

export type CashflowReport = {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  days: CfDay[]
  /** Старый формат итогов — для приложения */
  totals: { income: number; expense: number; net: number; margin: number; negativeDays: number; endingBalance: number; daysCount: number }
  flows: ChannelFlows
  previous: ChannelFlows
  activities: Array<{ key: ActivityKey; label: string; amount: number; cash: number; cashless: number; previous: number }>
  categories: Array<{ name: string; group: FinancialGroup; activity: ActivityKey; amount: number; cash: number; cashless: number; previous: number }>
  companies: Array<{ id: string; name: string; isExtra: boolean; inTotals: boolean; flows: ChannelFlows; previousNet: number }>
  largestExpenses: Array<{ date: string; company: string; category: string; payee: string; amount: number; cash: number; cashless: number; pending: boolean }>
  pending: { count: number; total: number }
  /** Дни, когда наличных ушло больше, чем пришло */
  cashDeficitDays: Array<{ date: string; net: number }>
  balance: null | {
    scope: 'organization' | 'company'
    anchor: BalanceAnchor
    start: Money3
    end: Money3
    lowest: { date: string; total: number; cash: number }
  }
  extra: { names: string[]; included: boolean }
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d)
  return out
}

const emptyFlows = (): ChannelFlows => ({ cash: { in: 0, out: 0, net: 0 }, cashless: { in: 0, out: 0, net: 0 }, total: { in: 0, out: 0, net: 0 } })

function finalizeFlows(f: ChannelFlows): ChannelFlows {
  f.cash.net = f.cash.in - f.cash.out
  f.cashless.net = f.cashless.in - f.cashless.out
  f.total = { in: f.cash.in + f.cashless.in, out: f.cash.out + f.cashless.out, net: 0 }
  f.total.net = f.total.in - f.total.out
  return f
}

export function splitIncomes(rows: CfIncomeRow[]) {
  return splitIncomeKaspiByCalendarDay(
    rows.map((r, i) => ({
      ...r,
      id: String(r.id ?? `row-${i}`),
      company_id: String(r.company_id),
      shift: (r.shift ?? 'day') as 'day' | 'night',
      zone: r.zone ?? null,
      comment: r.comment ?? null,
    })) as ReportIncomeCalendarRow[],
  )
}

// ─── Остаток ────────────────────────────────────────────────────────────────

/** Последняя отметка остатка для охвата не позже даты */
export function pickAnchor(anchors: BalanceAnchor[], companyId: string | null, onOrBefore: string): BalanceAnchor | null {
  return (
    anchors
      .filter((a) => (companyId ? a.company_id === companyId : !a.company_id) && a.as_of_date <= onOrBefore)
      .sort((a, b) => b.as_of_date.localeCompare(a.as_of_date))[0] ?? null
  )
}

export type ChannelNet = { cash: number; cashless: number }

/** Чистый поток по дням и каналам — уже с разнесённым ночным безналом */
export function dailyChannelNet(incomes: ReportIncomeCalendarRow[], expenses: CfExpenseRow[], include: (companyId: string) => boolean): Map<string, ChannelNet> {
  const map = new Map<string, ChannelNet>()
  const at = (date: string) => {
    let v = map.get(date)
    if (!v) {
      v = { cash: 0, cashless: 0 }
      map.set(date, v)
    }
    return v
  }
  for (const r of incomes) {
    if (!include(String(r.company_id))) continue
    const v = at(r.date)
    v.cash += n(r.cash_amount)
    v.cashless += n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount)
  }
  for (const r of expenses) {
    if (r.status === 'declined' || !include(String(r.company_id))) continue
    const v = at(r.date)
    v.cash -= n(r.cash_amount)
    v.cashless -= n(r.kaspi_amount)
  }
  return map
}

/** Остаток на конец дня `date` по отметке на утро её даты */
export function balanceAt(date: string, anchor: BalanceAnchor, daily: Map<string, ChannelNet>): Money3 {
  let cash = n(anchor.cash_amount)
  let cashless = n(anchor.cashless_amount)
  if (date >= anchor.as_of_date) {
    for (const [d, v] of daily) {
      if (d >= anchor.as_of_date && d <= date) {
        cash += v.cash
        cashless += v.cashless
      }
    }
  } else {
    // Отметка позже дня: отматываем назад движения между днём и отметкой
    for (const [d, v] of daily) {
      if (d > date && d < anchor.as_of_date) {
        cash -= v.cash
        cashless -= v.cashless
      }
    }
  }
  return { cash, cashless, total: cash + cashless }
}

// ─── Отчёт за период ────────────────────────────────────────────────────────

export function buildCashflowReport(input: {
  incomes: CfIncomeRow[]
  expenses: CfExpenseRow[]
  companies: CfCompany[]
  categoryGroups: Record<string, string | null>
  from: string
  to: string
  includeExtra: boolean
  companyId: string | null
  anchors: BalanceAnchor[]
}): CashflowReport {
  const { from, to, companyId } = input
  const length = dayDiff(from, to) + 1
  const prevTo = addDaysISO(from, -1)
  const prevFrom = addDaysISO(prevTo, -(length - 1))

  const extraIds = new Set(input.companies.filter(isExtraCompany).map((c) => String(c.id)))
  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))
  const inTotals = (cid: string) => (companyId ? cid === companyId : input.includeExtra || !extraIds.has(cid))
  const inBalance = (cid: string) => (companyId ? cid === companyId : true)

  const incomes = splitIncomes(input.incomes)
  const expenses = input.expenses.filter((r) => r.status !== 'declined')
  const inPeriod = (d: string) => d >= from && d <= to
  const inPrevious = (d: string) => d >= prevFrom && d <= prevTo

  const current = emptyFlows()
  const previous = emptyFlows()
  const dates = datesBetween(from, to)
  const dayAcc = new Map(dates.map((d) => [d, { cashIn: 0, cashOut: 0, cashlessIn: 0, cashlessOut: 0 }]))

  const companyAcc = new Map<string, { flows: ChannelFlows; previousNet: number }>()
  const companyOf = (id: string) => {
    let acc = companyAcc.get(id)
    if (!acc) {
      acc = { flows: emptyFlows(), previousNet: 0 }
      companyAcc.set(id, acc)
    }
    return acc
  }

  for (const r of incomes) {
    const cid = String(r.company_id)
    const cash = n(r.cash_amount)
    const cashless = n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount)
    if (!cash && !cashless) continue
    if (inPeriod(r.date)) {
      const acc = companyOf(cid)
      acc.flows.cash.in += cash
      acc.flows.cashless.in += cashless
      if (inTotals(cid)) {
        current.cash.in += cash
        current.cashless.in += cashless
        const day = dayAcc.get(r.date)!
        day.cashIn += cash
        day.cashlessIn += cashless
      }
    } else if (inPrevious(r.date)) {
      companyOf(cid).previousNet += cash + cashless
      if (inTotals(cid)) {
        previous.cash.in += cash
        previous.cashless.in += cashless
      }
    }
  }

  const categoryAcc = new Map<string, { group: FinancialGroup; cash: number; cashless: number; previous: number }>()
  const largest: CashflowReport['largestExpenses'] = []
  const pending = { count: 0, total: 0 }

  for (const r of expenses) {
    const cid = String(r.company_id)
    const cash = n(r.cash_amount)
    const cashless = n(r.kaspi_amount)
    if (!cash && !cashless) continue
    const name = String(r.category || '').trim() || 'Без статьи'
    const group = resolveFinancialGroup(name, input.categoryGroups[name.toLowerCase()] ?? null)
    if (inPeriod(r.date)) {
      const acc = companyOf(cid)
      acc.flows.cash.out += cash
      acc.flows.cashless.out += cashless
      if (!inTotals(cid)) continue
      current.cash.out += cash
      current.cashless.out += cashless
      const day = dayAcc.get(r.date)!
      day.cashOut += cash
      day.cashlessOut += cashless
      const cat = categoryAcc.get(name) || { group, cash: 0, cashless: 0, previous: 0 }
      cat.cash += cash
      cat.cashless += cashless
      categoryAcc.set(name, cat)
      const isPending = r.status === 'pending_approval'
      if (isPending) {
        pending.count += 1
        pending.total += cash + cashless
      }
      largest.push({
        date: r.date,
        company: nameOf.get(cid) || '—',
        category: name,
        payee: String(r.one_off_payee || r.comment || '').trim(),
        amount: cash + cashless,
        cash,
        cashless,
        pending: isPending,
      })
    } else if (inPrevious(r.date)) {
      companyOf(cid).previousNet -= cash + cashless
      if (!inTotals(cid)) continue
      previous.cash.out += cash
      previous.cashless.out += cashless
      const cat = categoryAcc.get(name) || { group, cash: 0, cashless: 0, previous: 0 }
      cat.previous += cash + cashless
      categoryAcc.set(name, cat)
    }
  }

  finalizeFlows(current)
  finalizeFlows(previous)

  // Остаток: отметка по охвату, движения — по охвату денег (у организации все точки)
  const anchor = pickAnchor(input.anchors, companyId, to)
  const daily = anchor ? dailyChannelNet(incomes, expenses, inBalance) : null

  let cumulative = 0
  const days: CfDay[] = dates.map((date) => {
    const d = dayAcc.get(date)!
    const income = d.cashIn + d.cashlessIn
    const expense = d.cashOut + d.cashlessOut
    const net = income - expense
    cumulative += net
    return {
      date,
      ...d,
      income,
      expense,
      net,
      balance: cumulative,
      onHand: anchor && daily ? balanceAt(date, anchor, daily) : null,
    }
  })

  let balance: CashflowReport['balance'] = null
  if (anchor && daily) {
    const lowestDay = days.reduce<CfDay | null>((min, d) => (!min || (d.onHand!.total < min.onHand!.total) ? d : min), null)
    balance = {
      scope: companyId ? 'company' : 'organization',
      anchor,
      start: balanceAt(prevTo, anchor, daily),
      end: balanceAt(to, anchor, daily),
      lowest: lowestDay ? { date: lowestDay.date, total: lowestDay.onHand!.total, cash: lowestDay.onHand!.cash } : { date: to, total: 0, cash: 0 },
    }
  }

  const moving = days.filter((d) => d.income || d.expense)
  const totals = {
    income: current.total.in,
    expense: current.total.out,
    net: current.total.net,
    margin: current.total.in > 0 ? (current.total.net / current.total.in) * 100 : 0,
    negativeDays: moving.filter((d) => d.net < 0).length,
    endingBalance: cumulative,
    daysCount: moving.length,
  }

  const categories = Array.from(categoryAcc.entries())
    .map(([name, v]) => ({ name, group: v.group, activity: activityOf(v.group), amount: v.cash + v.cashless, cash: v.cash, cashless: v.cashless, previous: v.previous }))
    .filter((c) => c.amount || c.previous)
    .sort((a, b) => b.amount - a.amount || b.previous - a.previous)

  const activities = (Object.keys(ACTIVITY_LABELS) as ActivityKey[])
    .map((key) => {
      const items = categories.filter((c) => c.activity === key)
      return {
        key,
        label: ACTIVITY_LABELS[key],
        amount: items.reduce((s, c) => s + c.amount, 0),
        cash: items.reduce((s, c) => s + c.cash, 0),
        cashless: items.reduce((s, c) => s + c.cashless, 0),
        previous: items.reduce((s, c) => s + c.previous, 0),
      }
    })
    .filter((a) => a.amount || a.previous)

  const companies = input.companies
    .map((c) => {
      const id = String(c.id)
      const acc = companyOf(id)
      return { id, name: c.name, isExtra: extraIds.has(id), inTotals: inTotals(id), flows: finalizeFlows(acc.flows), previousNet: acc.previousNet }
    })
    .filter((c) => (companyId ? c.id === companyId : c.flows.total.in || c.flows.total.out || c.previousNet || !c.isExtra))
    .sort((a, b) => Number(a.isExtra) - Number(b.isExtra) || b.flows.total.in - a.flows.total.in)

  largest.sort((a, b) => b.amount - a.amount)

  return {
    from,
    to,
    prevFrom,
    prevTo,
    days,
    totals,
    flows: current,
    previous,
    activities,
    categories,
    companies,
    largestExpenses: largest.slice(0, 20),
    pending,
    cashDeficitDays: days.filter((d) => d.cashOut > d.cashIn).map((d) => ({ date: d.date, net: d.cashIn - d.cashOut })),
    balance,
    extra: {
      names: input.companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name),
      included: companyId ? extraIds.has(companyId) : input.includeExtra,
    },
  }
}

// ─── Регулярные платежи и прогноз ───────────────────────────────────────────

export type ExpenseTemplate = {
  id: string
  name: string
  category: string | null
  amount: number
  payment_type: string | null
  company_id: string | null
  recurring_day_of_month: number | null
  recurring_active?: boolean | null
  recurring_last_run_at?: string | null
}

export type UpcomingPayment = {
  date: string
  templateId: string
  name: string
  category: string
  amount: number
  cashless: boolean
  companyId: string
  company: string
}

/**
 * Платежи из шаблонов регулярных расходов на ближайшие `horizonDays` дней.
 * День 31 в коротком месяце — последний день месяца. Платёж, который крон уже
 * создал в этом месяце, уже есть в расходах и второй раз не считается.
 */
export function upcomingPayments(input: {
  templates: ExpenseTemplate[]
  companies: CfCompany[]
  today: string
  horizonDays?: number
  include: (companyId: string) => boolean
}): UpcomingPayment[] {
  const horizonEnd = addDaysISO(input.today, (input.horizonDays ?? 31) - 1)
  const nameOf = new Map(input.companies.map((c) => [String(c.id), c.name]))
  const [y, m] = input.today.split('-').map(Number)
  const out: UpcomingPayment[] = []
  for (const t of input.templates) {
    const day = Number(t.recurring_day_of_month || 0)
    const amount = n(t.amount)
    if (t.recurring_active === false || !day || !t.company_id || amount <= 0 || !input.include(String(t.company_id))) continue
    for (let offset = 0; offset < 3; offset++) {
      const monthDate = new Date(Date.UTC(y, m - 1 + offset, 1))
      const year = monthDate.getUTCFullYear()
      const month = monthDate.getUTCMonth() + 1
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const date = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
      if (date < input.today || date > horizonEnd) continue
      if (t.recurring_last_run_at && String(t.recurring_last_run_at).slice(0, 7) === date.slice(0, 7)) continue
      out.push({
        date,
        templateId: String(t.id),
        name: t.name,
        category: String(t.category || '').trim() || 'Без статьи',
        amount,
        cashless: t.payment_type === 'kaspi',
        companyId: String(t.company_id),
        company: nameOf.get(String(t.company_id)) || '—',
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

export type MonthProjection = {
  monthEnd: string
  source: 'model' | 'average'
  incomeLeft: number
  paymentsLeft: number
  otherSpendLeft: number
  netLeft: number
  balanceStart: number | null
  balanceEnd: number | null
  lowest: { date: string; balance: number } | null
  days: Array<{ date: string; income: number; payments: number; other: number; balance: number | null }>
}

/**
 * Деньги до конца месяца: ожидаемая выручка по дням недели, регулярные платежи
 * в их дни и остальные расходы поровну. От остатка на сегодня — где будет
 * самая низкая точка.
 */
export function projectMonthEnd(input: {
  today: string
  incomeLeft: number
  expenseLeft: number
  payments: UpcomingPayment[]
  /** Вес дня недели, индекс getUTCDay (0 — вс) */
  weights: number[]
  balanceStart: number | null
  source: 'model' | 'average'
}): MonthProjection {
  const [y, m] = input.today.split('-').map(Number)
  const monthEnd = `${input.today.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  const dates = datesBetween(input.today, monthEnd)
  const inMonth = input.payments.filter((p) => p.date >= input.today && p.date <= monthEnd)
  const paymentsLeft = inMonth.reduce((s, p) => s + p.amount, 0)
  const incomeLeft = Math.max(0, input.incomeLeft)
  const otherSpendLeft = Math.max(0, input.expenseLeft - paymentsLeft)
  const weightOf = (d: string) => input.weights[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? 1
  const totalWeight = dates.reduce((s, d) => s + weightOf(d), 0) || 1

  let balance = input.balanceStart
  let lowest: MonthProjection['lowest'] = null
  const days = dates.map((date) => {
    const income = (incomeLeft * weightOf(date)) / totalWeight
    const payments = inMonth.filter((p) => p.date === date).reduce((s, p) => s + p.amount, 0)
    const other = otherSpendLeft / dates.length
    if (balance != null) {
      balance += income - payments - other
      if (!lowest || balance < lowest.balance) lowest = { date, balance }
    }
    return { date, income, payments, other, balance }
  })

  return {
    monthEnd,
    source: input.source,
    incomeLeft,
    paymentsLeft,
    otherSpendLeft,
    netLeft: incomeLeft - paymentsLeft - otherSpendLeft,
    balanceStart: input.balanceStart,
    balanceEnd: balance,
    lowest,
    days,
  }
}
