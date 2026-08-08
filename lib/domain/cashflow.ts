/**
 * Движение денег по дням: сколько пришло, сколько ушло, что осталось.
 *
 * Формула жила только в компоненте страницы `/cashflow`: она тянула сырые
 * строки доходов и расходов хуками и сворачивала их у себя. Повторить это на
 * Swift означало бы две реализации одного накопительного баланса — на сайте
 * одна цифра, в приложении другая, и объяснить владельцу расхождение было бы
 * нечем.
 *
 * Поэтому свёртка вынесена сюда: чистая функция без обращений к БД, покрытая
 * тестами, одна на всех потребителей.
 *
 * Накопительный баланс считается от нуля на начало периода — это не остаток
 * кассы, а результат самого периода. Остаток кассы живёт в сменах и сходится
 * по другим правилам (см. `/weekly-report`).
 */

/** Строка журнала доходов, нужная для расчёта. */
export type CashflowIncomeRow = {
  date: string
  cash_amount?: number | null
  kaspi_amount?: number | null
  online_amount?: number | null
  card_amount?: number | null
}

/** Строка журнала расходов, нужная для расчёта. */
export type CashflowExpenseRow = {
  date: string
  cash_amount?: number | null
  kaspi_amount?: number | null
}

/** День периода. `net` — итог дня, `balance` — накопленный итог с начала периода. */
export type CashflowDay = {
  date: string
  income: number
  expense: number
  net: number
  balance: number
}

export type CashflowTotals = {
  income: number
  expense: number
  net: number
  /** Доля прибыли в выручке, в процентах. */
  margin: number
  /** Дней, закрытых в минус. */
  negativeDays: number
  /** Баланс на конец периода. */
  endingBalance: number
  daysCount: number
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Доход строки — все способы оплаты вместе. */
function incomeOf(row: CashflowIncomeRow): number {
  return num(row.cash_amount) + num(row.kaspi_amount) + num(row.online_amount) + num(row.card_amount)
}

/** Расход строки — наличная и безналичная части вместе. */
function expenseOf(row: CashflowExpenseRow): number {
  return num(row.cash_amount) + num(row.kaspi_amount)
}

/**
 * Дни периода в хронологическом порядке.
 *
 * Дни без движений вообще пропускаются: пустая строка в таблице ничего не
 * сообщает, а на графике накопительного баланса ровный участок и так виден
 * по наклону. Порядок здесь важен — баланс накапливается по нему.
 */
export function buildCashflowDays(
  incomes: CashflowIncomeRow[],
  expenses: CashflowExpenseRow[],
): CashflowDay[] {
  const incomeByDate = new Map<string, number>()
  const expenseByDate = new Map<string, number>()

  for (const row of incomes) {
    const date = String(row.date || '')
    if (!date) continue
    incomeByDate.set(date, (incomeByDate.get(date) || 0) + incomeOf(row))
  }
  for (const row of expenses) {
    const date = String(row.date || '')
    if (!date) continue
    expenseByDate.set(date, (expenseByDate.get(date) || 0) + expenseOf(row))
  }

  const dates = Array.from(new Set([...incomeByDate.keys(), ...expenseByDate.keys()])).sort()

  let balance = 0
  return dates.map((date) => {
    const income = incomeByDate.get(date) || 0
    const expense = expenseByDate.get(date) || 0
    const net = income - expense
    balance += net
    return { date, income, expense, net, balance }
  })
}

/** Итоги периода по уже посчитанным дням. */
export function summarizeCashflow(days: CashflowDay[]): CashflowTotals {
  const income = days.reduce((sum, day) => sum + day.income, 0)
  const expense = days.reduce((sum, day) => sum + day.expense, 0)
  const net = income - expense

  return {
    income,
    expense,
    net,
    // Без выручки маржа не «минус бесконечность», а просто неопределена —
    // показываем ноль, иначе процент в шапке становится пугающим мусором.
    margin: income > 0 ? (net / income) * 100 : 0,
    negativeDays: days.filter((day) => day.net < 0).length,
    endingBalance: days.length > 0 ? days[days.length - 1].balance : 0,
    daysCount: days.length,
  }
}

/** Полный расчёт: дни и итоги за один проход. */
export function computeCashflow(
  incomes: CashflowIncomeRow[],
  expenses: CashflowExpenseRow[],
): { days: CashflowDay[]; totals: CashflowTotals } {
  const days = buildCashflowDays(incomes, expenses)
  return { days, totals: summarizeCashflow(days) }
}
