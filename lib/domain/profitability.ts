import { resolveFinancialGroup } from '@/lib/core/financial-groups'

/**
 * Отчёт о прибылях и убытках за месяц.
 *
 * Формула жила только в компоненте страницы `/profitability` (2000+ строк).
 * Пока её потребитель был один, это было терпимо; с приходом мобильного
 * приложения повторить её на Swift означало бы две реализации одной
 * финансовой величины — и владелец, увидев разные EBITDA на сайте и в
 * телефоне, не смог бы понять, какая верна.
 *
 * Поэтому расчёт вынесен сюда: чистая функция без обращений к БД, покрытая
 * тестами, одна на всех потребителей.
 *
 * Порядок величин соответствует стандартному P&L:
 *
 *   выручка − себестоимость                       = валовая прибыль
 *   − операционные − комиссии POS − ФОТ − налоги ФОТ − прочие  = EBITDA
 *   − износ − амортизация                         = операционная прибыль
 *   − финансовые расходы                          = прибыль до налога
 *   − налог на прибыль − неоперационные           = чистая прибыль
 *
 * CAPEX и распределение прибыли в P&L не входят: первое — вложение, второе
 * происходит уже после чистой прибыли. Считаем их отдельно, справочно.
 */

/** Строка журнала расходов, нужная для расчёта. */
export type ProfitabilityExpenseRow = {
  date: string
  category?: string | null
  cash_amount?: number | null
  kaspi_amount?: number | null
}

/** Выручка месяца из журнала доходов, разложенная по способам оплаты. */
export type ProfitabilityIncome = {
  cash: number
  kaspi: number
  card: number
  online: number
}

/** Ручные вводы владельца за месяц (`monthly_profitability_inputs`). */
export type ProfitabilityInputs = {
  cash_revenue_override?: number | null
  pos_revenue_override?: number | null
  kaspi_qr_turnover?: number | null
  kaspi_qr_rate?: number | null
  kaspi_gold_turnover?: number | null
  kaspi_gold_rate?: number | null
  qr_gold_turnover?: number | null
  qr_gold_rate?: number | null
  other_cards_turnover?: number | null
  other_cards_rate?: number | null
  kaspi_red_turnover?: number | null
  kaspi_red_rate?: number | null
  kaspi_kredit_turnover?: number | null
  kaspi_kredit_rate?: number | null
  payroll_amount?: number | null
  payroll_taxes_amount?: number | null
  income_tax_amount?: number | null
  depreciation_amount?: number | null
  amortization_amount?: number | null
  other_operating_amount?: number | null
}

export type MonthlyPnl = {
  month: string
  revenue: number
  cashRevenue: number
  cashlessRevenue: number
  cogs: number
  grossProfit: number
  operatingExpenses: number
  posCommission: number
  payroll: number
  payrollTaxes: number
  otherOperating: number
  ebitda: number
  ebitdaMargin: number
  depreciation: number
  amortization: number
  operatingProfit: number
  financialExpenses: number
  incomeTax: number
  nonOperating: number
  netProfit: number
  netMargin: number
  /** Вне P&L, справочно. */
  capex: number
  profitDistribution: number
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Разбор журнала расходов месяца по финансовым группам. */
function splitJournal(
  rows: ProfitabilityExpenseRow[],
  month: string,
  categoryGroups: Record<string, string | null>,
) {
  const acc = {
    cogs: 0,
    operating: 0,
    posCommission: 0,
    payroll: 0,
    payrollTaxes: 0,
    incomeTax: 0,
    financial: 0,
    nonOperating: 0,
    depreciation: 0,
    capex: 0,
    profitDistribution: 0,
  }

  for (const row of rows) {
    if (!row.date?.startsWith(month)) continue

    const amount = num(row.cash_amount) + num(row.kaspi_amount)
    const normalized = String(row.category || '').trim().toLowerCase()
    const group = resolveFinancialGroup(row.category, categoryGroups[normalized] ?? null)

    switch (group) {
      case 'cogs':
        acc.cogs += amount
        break
      case 'pos_commission':
        acc.posCommission += amount
        break
      // Аванс — часть ФОТ, а не отдельная статья: иначе он выпал бы из EBITDA.
      case 'payroll':
      case 'payroll_advance':
        acc.payroll += amount
        break
      case 'payroll_tax':
        acc.payrollTaxes += amount
        break
      case 'income_tax':
        acc.incomeTax += amount
        break
      case 'financial_expenses':
        acc.financial += amount
        break
      case 'non_operating':
        acc.nonOperating += amount
        break
      case 'depreciation':
        acc.depreciation += amount
        break
      case 'capex':
        acc.capex += amount
        break
      case 'profit_distribution':
        acc.profitDistribution += amount
        break
      default:
        acc.operating += amount
    }
  }

  return acc
}

/** Комиссии эквайринга по ручным оборотам и ставкам. */
function posCommissionFromInputs(inputs: ProfitabilityInputs) {
  const qrTurnover = num(inputs.kaspi_qr_turnover)
  const goldTurnover = num(inputs.kaspi_gold_turnover)

  // Раньше QR и Gold вводили одной строкой. Если заполнены новые поля,
  // старое поле игнорируем — иначе оборот посчитается дважды.
  const hasSplit = qrTurnover > 0 || goldTurnover > 0
  const legacyTurnover = hasSplit ? 0 : num(inputs.qr_gold_turnover)
  const legacyCommission = hasSplit ? 0 : (legacyTurnover * num(inputs.qr_gold_rate)) / 100

  const commission =
    (qrTurnover * num(inputs.kaspi_qr_rate)) / 100 +
    (goldTurnover * num(inputs.kaspi_gold_rate)) / 100 +
    (num(inputs.other_cards_turnover) * num(inputs.other_cards_rate)) / 100 +
    (num(inputs.kaspi_red_turnover) * num(inputs.kaspi_red_rate)) / 100 +
    (num(inputs.kaspi_kredit_turnover) * num(inputs.kaspi_kredit_rate)) / 100 +
    legacyCommission

  return commission
}

/**
 * Считает P&L одного месяца.
 *
 * @param month           месяц в формате `YYYY-MM`
 * @param income          выручка из журнала доходов
 * @param expenses        строки журнала расходов (лишние месяцы отфильтруются)
 * @param inputs          ручные вводы владельца за этот месяц
 * @param categoryGroups  соответствие «категория → финансовая группа»
 */
export function computeMonthlyPnl(
  month: string,
  income: ProfitabilityIncome,
  expenses: ProfitabilityExpenseRow[],
  inputs: ProfitabilityInputs | null | undefined,
  categoryGroups: Record<string, string | null> = {},
): MonthlyPnl {
  const manual = inputs || {}
  const journal = splitJournal(expenses, month, categoryGroups)

  const journalRevenue = income.cash + income.kaspi + income.card + income.online
  const journalCashless = income.kaspi + income.card + income.online

  // Ручная выручка перекрывает журнал целиком, а не по частям: смешение
  // дало бы величину, не сходящуюся ни с кассой, ни с журналом.
  const cashOverride = num(manual.cash_revenue_override)
  const posOverride = num(manual.pos_revenue_override)
  const hasOverride = cashOverride > 0 || posOverride > 0

  const revenue = hasOverride ? cashOverride + posOverride : journalRevenue
  const cashRevenue = hasOverride ? cashOverride : income.cash
  const cashlessRevenue = hasOverride ? posOverride : journalCashless

  // Ручное значение имеет приоритет над журналом — владелец вводит его
  // именно тогда, когда журнал неполон. Ноль означает «не заполнено».
  const payroll = num(manual.payroll_amount) > 0 ? num(manual.payroll_amount) : journal.payroll
  const payrollTaxes =
    num(manual.payroll_taxes_amount) > 0 ? num(manual.payroll_taxes_amount) : journal.payrollTaxes
  const incomeTax = num(manual.income_tax_amount) > 0 ? num(manual.income_tax_amount) : journal.incomeTax
  const depreciation =
    num(manual.depreciation_amount) > 0 ? num(manual.depreciation_amount) : journal.depreciation
  const amortization = num(manual.amortization_amount)
  const otherOperating = num(manual.other_operating_amount)

  // Комиссию берём из ручных оборотов, если они заполнены, иначе из журнала:
  // сложение дало бы двойной счёт одной и той же комиссии.
  const manualCommission = posCommissionFromInputs(manual)
  const posCommission = manualCommission > 0 ? manualCommission : journal.posCommission

  const cogs = journal.cogs
  const grossProfit = revenue - cogs

  const ebitda =
    grossProfit - journal.operating - posCommission - payroll - payrollTaxes - otherOperating
  const operatingProfit = ebitda - depreciation - amortization
  const ebt = operatingProfit - journal.financial
  const netProfit = ebt - incomeTax - journal.nonOperating

  return {
    month,
    revenue,
    cashRevenue,
    cashlessRevenue,
    cogs,
    grossProfit,
    operatingExpenses: journal.operating,
    posCommission,
    payroll,
    payrollTaxes,
    otherOperating,
    ebitda,
    ebitdaMargin: revenue > 0 ? (ebitda / revenue) * 100 : 0,
    depreciation,
    amortization,
    operatingProfit,
    financialExpenses: journal.financial,
    incomeTax,
    nonOperating: journal.nonOperating,
    netProfit,
    netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    capex: journal.capex,
    profitDistribution: journal.profitDistribution,
  }
}
