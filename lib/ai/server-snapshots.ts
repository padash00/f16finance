import 'server-only'

import type { PageSnapshot } from '@/lib/ai/types'

type RequestSupabase = ReturnType<typeof import('@/lib/server/request-auth').createRequestSupabaseClient>

type IncomeRow = {
  date: string
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
}

type ExpenseRow = {
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

type CompanyRow = {
  id: string
  name: string
  code: string | null
}

type FinanceDataBundle = {
  dateFrom: string
  dateTo: string
  incomes: IncomeRow[]
  expenses: ExpenseRow[]
  companies: CompanyRow[]
}

function safeNumber(value: number | null | undefined) {
  return Number(value || 0)
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₸`
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function clampDate(date: string | undefined, fallback: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fallback
  return date
}

function todayISO() {
  const now = new Date()
  const t = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const value = new Date(y, (m || 1) - 1, d || 1)
  value.setDate(value.getDate() + diff)
  const t = value.getTime() - value.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

async function fetchFinanceBundle(
  supabase: RequestSupabase,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<FinanceDataBundle> {
  const dateTo = clampDate(params?.dateTo, todayISO())
  const dateFrom = clampDate(params?.dateFrom, addDaysISO(dateTo, -29))

  const [incomesRes, expensesRes, companiesRes] = await Promise.all([
    supabase
      .from('incomes')
      .select('date, company_id, cash_amount, kaspi_amount, online_amount, card_amount')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })
      .range(0, 4999),
    supabase
      .from('expenses')
      .select('date, company_id, category, cash_amount, kaspi_amount')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })
      .range(0, 4999),
    supabase.from('companies').select('id, name, code'),
  ])

  if (incomesRes.error) throw incomesRes.error
  if (expensesRes.error) throw expensesRes.error
  if (companiesRes.error) throw companiesRes.error

  return {
    dateFrom,
    dateTo,
    incomes: (incomesRes.data || []) as IncomeRow[],
    expenses: (expensesRes.data || []) as ExpenseRow[],
    companies: (companiesRes.data || []) as CompanyRow[],
  }
}

function buildSharedAggregates(bundle: FinanceDataBundle) {
  const companyMap = new Map(bundle.companies.map((item) => [item.id, item.name]))

  let totalIncome = 0
  let totalExpense = 0
  let incomeCash = 0
  let incomeKaspi = 0
  let incomeOnline = 0
  let incomeCard = 0
  let expenseCash = 0
  let expenseKaspi = 0

  const categoryMap = new Map<string, number>()
  const companyIncomeMap = new Map<string, number>()
  const companyExpenseMap = new Map<string, number>()
  const dailyIncomeMap = new Map<string, number>()
  const dailyExpenseMap = new Map<string, number>()

  for (const row of bundle.incomes) {
    const cash = safeNumber(row.cash_amount)
    const kaspi = safeNumber(row.kaspi_amount)
    const online = safeNumber(row.online_amount)
    const card = safeNumber(row.card_amount)
    const total = cash + kaspi + online + card
    if (!total) continue

    totalIncome += total
    incomeCash += cash
    incomeKaspi += kaspi
    incomeOnline += online
    incomeCard += card

    companyIncomeMap.set(row.company_id, (companyIncomeMap.get(row.company_id) || 0) + total)
    dailyIncomeMap.set(row.date, (dailyIncomeMap.get(row.date) || 0) + total)
  }

  for (const row of bundle.expenses) {
    const cash = safeNumber(row.cash_amount)
    const kaspi = safeNumber(row.kaspi_amount)
    const total = cash + kaspi
    if (!total) continue

    totalExpense += total
    expenseCash += cash
    expenseKaspi += kaspi

    const category = row.category || 'Без категории'
    categoryMap.set(category, (categoryMap.get(category) || 0) + total)
    companyExpenseMap.set(row.company_id, (companyExpenseMap.get(row.company_id) || 0) + total)
    dailyExpenseMap.set(row.date, (dailyExpenseMap.get(row.date) || 0) + total)
  }

  const uniqueDays = Math.max(
    1,
    new Set([...bundle.incomes.map((row) => row.date), ...bundle.expenses.map((row) => row.date)]).size,
  )
  const profit = totalIncome - totalExpense
  const avgIncome = totalIncome / uniqueDays
  const avgExpense = totalExpense / uniqueDays
  const avgProfit = profit / uniqueDays
  const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
  const cashlessShare = totalIncome > 0 ? ((incomeKaspi + incomeOnline + incomeCard) / totalIncome) * 100 : 0

  const topCategories = Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1])

  const companyLeaderboard = Array.from(companyIncomeMap.entries())
    .map(([companyId, income]) => {
      const expense = companyExpenseMap.get(companyId) || 0
      const profit = income - expense
      const margin = income > 0 ? (profit / income) * 100 : 0
      return {
        companyId,
        name: companyMap.get(companyId) || companyId,
        income,
        expense,
        profit,
        margin,
      }
    })
    .sort((a, b) => b.income - a.income)

  const incomeDays = Array.from(dailyIncomeMap.entries()).map(([, value]) => value)
  const expenseDays = Array.from(dailyExpenseMap.entries()).map(([, value]) => value)
  const avgDayIncome = incomeDays.length ? incomeDays.reduce((sum, value) => sum + value, 0) / incomeDays.length : 0
  const avgDayExpense = expenseDays.length ? expenseDays.reduce((sum, value) => sum + value, 0) / expenseDays.length : 0

  const anomalies = [
    ...Array.from(dailyIncomeMap.entries())
      .filter(([, value]) => avgDayIncome > 0 && value >= avgDayIncome * 1.8)
      .slice(0, 3)
      .map(([date, value]) => `Пик выручки ${date}: ${formatMoney(value)}`),
    ...Array.from(dailyExpenseMap.entries())
      .filter(([, value]) => avgDayExpense > 0 && value >= avgDayExpense * 1.8)
      .slice(0, 3)
      .map(([date, value]) => `Пик расходов ${date}: ${formatMoney(value)}`),
  ].slice(0, 5)

  const groupSize = Math.max(1, Math.ceil(expenseDays.length / 3))
  const expenseTrend =
    expenseDays.length >= 6
      ? expenseDays.slice(-groupSize).reduce((sum, value) => sum + value, 0) / groupSize -
        expenseDays.slice(0, groupSize).reduce((sum, value) => sum + value, 0) / groupSize
      : 0

  return {
    period: {
      from: bundle.dateFrom,
      to: bundle.dateTo,
      label: `${bundle.dateFrom} — ${bundle.dateTo}`,
    },
    totals: {
      totalIncome,
      totalExpense,
      profit,
      margin,
      avgIncome,
      avgExpense,
      avgProfit,
      incomeCash,
      incomeKaspi,
      incomeOnline,
      incomeCard,
      expenseCash,
      expenseKaspi,
      cashlessShare,
      uniqueDays,
    },
    topCategories,
    companyLeaderboard,
    anomalies,
    expenseTrend,
  }
}

export async function getAnalysisServerSnapshot(
  supabase: RequestSupabase,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<PageSnapshot> {
  const data = buildSharedAggregates(await fetchFinanceBundle(supabase, params))
  const riskLevel =
    data.totals.margin < 10 ? 'Высокий' : data.totals.margin < 20 || data.expenseTrend > 0 ? 'Средний' : 'Низкий'

  return {
    page: 'analysis',
    title: 'Серверный срез данных для финансового разбора',
    generatedAt: new Date().toISOString(),
    route: '/analysis',
    period: data.period,
    summary: [
      `Выручка ${formatMoney(data.totals.totalIncome)}, расходы ${formatMoney(data.totals.totalExpense)}, прибыль ${formatMoney(data.totals.profit)}.`,
      `Маржа ${formatPercent(data.totals.margin)}, средняя прибыль в день ${formatMoney(data.totals.avgProfit)}.`,
      `Риск по серверному срезу: ${riskLevel}.`,
    ],
    sections: [
      {
        title: 'Ключевые метрики',
        metrics: [
          { label: 'Выручка', value: formatMoney(data.totals.totalIncome) },
          { label: 'Расходы', value: formatMoney(data.totals.totalExpense) },
          { label: 'Прибыль', value: formatMoney(data.totals.profit) },
          { label: 'Маржа', value: formatPercent(data.totals.margin) },
          { label: 'Средняя выручка/день', value: formatMoney(data.totals.avgIncome) },
          { label: 'Средняя прибыль/день', value: formatMoney(data.totals.avgProfit) },
          { label: 'Риск', value: riskLevel },
        ],
      },
      {
        title: 'Структура оплат',
        metrics: [
          { label: 'Наличные', value: formatMoney(data.totals.incomeCash) },
          { label: 'Kaspi', value: formatMoney(data.totals.incomeKaspi) },
          { label: 'Онлайн', value: formatMoney(data.totals.incomeOnline) },
          { label: 'Банковские карты', value: formatMoney(data.totals.incomeCard) },
          { label: 'Доля безнала', value: formatPercent(data.totals.cashlessShare) },
        ],
      },
      {
        title: 'По точкам (все)',
        bullets: data.companyLeaderboard.map(
          (c) => `${c.name}: выручка ${formatMoney(c.income)}, расходы ${formatMoney(c.expense)}, прибыль ${formatMoney(c.profit)}, маржа ${formatPercent(c.margin)}`,
        ),
      },
      {
        title: 'Расходы по категориям (все)',
        bullets: data.topCategories.map(([name, value]) => `${name}: ${formatMoney(value)} (${data.totals.totalExpense > 0 ? formatPercent(value / data.totals.totalExpense * 100) : '0%'})`),
      },
      {
        title: 'Аномалии и сигналы',
        bullets: data.anomalies.length ? data.anomalies : ['Явных аномалий не обнаружено.'],
      },
    ],
  }
}

export async function getReportsServerSnapshot(
  supabase: RequestSupabase,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<PageSnapshot> {
  const data = buildSharedAggregates(await fetchFinanceBundle(supabase, params))

  return {
    page: 'reports',
    title: 'Серверный срез сводных отчётов',
    generatedAt: new Date().toISOString(),
    route: '/reports',
    period: data.period,
    summary: [
      `Отчётный период: ${data.period.label}.`,
      `Всего дней с данными: ${data.totals.uniqueDays}.`,
      `Баланс периода: ${formatMoney(data.totals.profit)} при марже ${formatPercent(data.totals.margin)}.`,
    ],
    sections: [
      {
        title: 'Сводка',
        metrics: [
          { label: 'Выручка', value: formatMoney(data.totals.totalIncome) },
          { label: 'Расходы', value: formatMoney(data.totals.totalExpense) },
          { label: 'Прибыль', value: formatMoney(data.totals.profit) },
          { label: 'Средняя выручка/день', value: formatMoney(data.totals.avgIncome) },
          { label: 'Средний расход/день', value: formatMoney(data.totals.avgExpense) },
        ],
      },
      {
        title: 'По точкам (все)',
        bullets: data.companyLeaderboard.map(
          (c) => `${c.name}: выручка ${formatMoney(c.income)}, расходы ${formatMoney(c.expense)}, прибыль ${formatMoney(c.profit)}, маржа ${formatPercent(c.margin)}`,
        ),
      },
      {
        title: 'Расходы по категориям (все)',
        bullets: data.topCategories.map(([name, value]) => `${name}: ${formatMoney(value)} (${data.totals.totalExpense > 0 ? formatPercent(value / data.totals.totalExpense * 100) : '0%'})`),
      },
    ],
  }
}

export async function getCashFlowServerSnapshot(
  supabase: RequestSupabase,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<PageSnapshot> {
  const bundle = await fetchFinanceBundle(supabase, params)
  const data = buildSharedAggregates(bundle)

  // Build daily cash flow
  const dailyIncomeMap = new Map<string, number>()
  const dailyExpenseMap = new Map<string, number>()
  for (const row of bundle.incomes) {
    const total = safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount) + safeNumber(row.online_amount) + safeNumber(row.card_amount)
    dailyIncomeMap.set(row.date, (dailyIncomeMap.get(row.date) || 0) + total)
  }
  for (const row of bundle.expenses) {
    const total = safeNumber(row.cash_amount) + safeNumber(row.kaspi_amount)
    dailyExpenseMap.set(row.date, (dailyExpenseMap.get(row.date) || 0) + total)
  }

  const allDates = Array.from(new Set([...dailyIncomeMap.keys(), ...dailyExpenseMap.keys()])).sort()
  let cumBalance = 0
  const dailyCashFlow = allDates.map((date) => {
    const income = dailyIncomeMap.get(date) || 0
    const expense = dailyExpenseMap.get(date) || 0
    const profit = income - expense
    cumBalance += profit
    return { date, income, expense, profit, cumBalance }
  })

  const negativeDays = dailyCashFlow.filter((d) => d.profit < 0)
  const topNegativeDays = [...negativeDays].sort((a, b) => a.profit - b.profit).slice(0, 3)
  const topPositiveDays = [...dailyCashFlow].sort((a, b) => b.profit - a.profit).slice(0, 3)

  return {
    page: 'cashflow',
    title: 'Серверный срез Cash Flow',
    generatedAt: new Date().toISOString(),
    route: '/cashflow',
    period: data.period,
    summary: [
      `Доходы: ${formatMoney(data.totals.totalIncome)}, расходы: ${formatMoney(data.totals.totalExpense)}.`,
      `Прибыль за период: ${formatMoney(data.totals.profit)}, маржа ${formatPercent(data.totals.margin)}.`,
      `Убыточных дней: ${negativeDays.length} из ${allDates.length}.`,
      `Баланс нарастающим итогом: ${formatMoney(cumBalance)}.`,
    ],
    sections: [
      {
        title: 'Сводка периода',
        metrics: [
          { label: 'Доходы', value: formatMoney(data.totals.totalIncome) },
          { label: 'Расходы', value: formatMoney(data.totals.totalExpense) },
          { label: 'Прибыль', value: formatMoney(data.totals.profit) },
          { label: 'Маржа', value: formatPercent(data.totals.margin) },
          { label: 'Дней с данными', value: String(allDates.length) },
          { label: 'Убыточных дней', value: String(negativeDays.length) },
          { label: 'Итоговый баланс', value: formatMoney(cumBalance) },
        ],
      },
      {
        title: 'Топ убыточных дней',
        bullets: topNegativeDays.length
          ? topNegativeDays.map((d) => `${d.date}: доход ${formatMoney(d.income)}, расход ${formatMoney(d.expense)}, убыток ${formatMoney(d.profit)}`)
          : ['Убыточных дней нет — отличный результат.'],
      },
      {
        title: 'Топ прибыльных дней',
        bullets: topPositiveDays.map((d) => `${d.date}: доход ${formatMoney(d.income)}, расход ${formatMoney(d.expense)}, прибыль ${formatMoney(d.profit)}`),
      },
      {
        title: 'Структура расходов',
        bullets: data.topCategories.map(([name, value]) => `${name}: ${formatMoney(value)}`),
      },
    ],
  }
}

export async function getExpensesServerSnapshot(
  supabase: RequestSupabase,
  params?: { dateFrom?: string; dateTo?: string },
): Promise<PageSnapshot> {
  const data = buildSharedAggregates(await fetchFinanceBundle(supabase, params))
  const trendLabel = data.expenseTrend > 0 ? 'Рост расходов' : data.expenseTrend < 0 ? 'Снижение расходов' : 'Стабильно'

  return {
    page: 'expenses',
    title: 'Серверный срез данных по расходам',
    generatedAt: new Date().toISOString(),
    route: '/expenses',
    period: data.period,
    summary: [
      `Расходы за период: ${formatMoney(data.totals.totalExpense)}.`,
      `Средний расход в день: ${formatMoney(data.totals.avgExpense)}.`,
      `Тренд по расходам: ${trendLabel}.`,
    ],
    sections: [
      {
        title: 'Платёжная структура расходов',
        metrics: [
          { label: 'Наличные', value: formatMoney(data.totals.expenseCash) },
          { label: 'Kaspi', value: formatMoney(data.totals.expenseKaspi) },
          { label: 'Всего расходов', value: formatMoney(data.totals.totalExpense) },
        ],
      },
      {
        title: 'Категории расходов (все)',
        bullets: data.topCategories.map(([name, value]) => `${name}: ${formatMoney(value)} (${data.totals.totalExpense > 0 ? formatPercent(value / data.totals.totalExpense * 100) : '0%'})`),
      },
      {
        title: 'По точкам (расходы)',
        bullets: data.companyLeaderboard.map(
          (c) => `${c.name}: расходы ${formatMoney(c.expense)}, выручка ${formatMoney(c.income)}, прибыль ${formatMoney(c.profit)}`,
        ),
      },
      {
        title: 'Аномалии',
        bullets: data.anomalies.length ? data.anomalies : ['Явных аномалий в серверном срезе данных не найдено.'],
      },
    ],
  }
}
