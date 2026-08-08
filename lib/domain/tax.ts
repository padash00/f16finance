/**
 * Налоги ИП на упрощёнке (Казахстан, форма 910.00).
 *
 * Расчёт жил только в компоненте страницы `/tax`: ставки, пороги и реверс
 * «на руки → брутто» были константами внутри React-компонента. Повторить их
 * на Swift означало бы две реализации одного налога — а расхождение здесь
 * стоит дороже, чем в отчёте: по этой цифре платят в бюджет.
 *
 * Поэтому константы и формулы вынесены сюда: чистые функции без обращений к
 * БД, покрытые тестами, одни на сайт и приложение.
 *
 * Ставка ИПН не константа: маслихат устанавливает её в диапазоне 2–6 %, и на
 * странице она выбирается вручную. Поэтому она параметр, а не число в коде.
 */

/** Год, к которому относятся ставки и пороги ниже. */
export const TAX_YEAR = 2026

/** Месячный расчётный показатель. */
export const MRP = 4_325
/** Минимальная заработная плата. */
export const MZP = 85_000

/** Ставка по умолчанию — та же, что подставляет страница `/tax`. */
export const DEFAULT_TAX_RATE = 2
/** Границы, в которых маслихат вправе установить ставку. */
export const MIN_TAX_RATE = 2
export const MAX_TAX_RATE = 6

/** Соцплатежи ИП «за себя» — ежемесячно от 1 МЗП. */
export const SELF_SOCIAL_RATES = { opv: 0.1, opvr: 0.035, so: 0.05, vosms: 0.07 }

/**
 * Фиксированный месячный платёж «за себя».
 *
 * Каждый взнос округляется отдельно, а не сумма в конце: в бюджет уходят
 * четыре разных платежа, и копейка, потерянная на общем округлении, потом
 * не сходится ни с одним из них.
 */
export const SELF_SOCIAL_MONTHLY =
  Math.round(MZP * SELF_SOCIAL_RATES.opv) +
  Math.round(MZP * SELF_SOCIAL_RATES.opvr) +
  Math.round(MZP * SELF_SOCIAL_RATES.so) +
  Math.round(MZP * SELF_SOCIAL_RATES.vosms)

/** Оборот, после которого обязательна постановка на учёт по НДС. */
export const VAT_THRESHOLD = 10_000 * MRP
/** Предел оборота, после которого упрощёнка недоступна. */
export const SIMPLIFIED_LIMIT = 600_000 * MRP

/** Налоги за работника, 2026. */
const EMPLOYEE_RATES = {
  ipn: 0.1,
  opv: 0.1,
  vosms: 0.02,
  opvr: 0.035,
  so: 0.035,
  osms: 0.03,
}
/** Стандартный налоговый вычет — 14 МРП в месяц. */
const STANDARD_DEDUCTION_MRP = 14
/** Оклад, до которого действует льгота 90 % по ИПН. */
const IPN_RELIEF_LIMIT = 25 * MRP

/** Строка журнала доходов, нужная для расчёта. */
export type TaxIncomeRow = {
  date: string
  company_id?: string | null
  cash_amount?: number | null
  kaspi_amount?: number | null
  online_amount?: number | null
  card_amount?: number | null
}

export type TaxMonth = {
  month: string
  revenue: number
  ipn: number
  social: number
  total: number
}

export type TaxSummary = {
  rate: number
  /** Налогооблагаемый оборот периода. */
  revenue: number
  ipn: number
  /** Соцплатежи «за себя» за все месяцы периода. */
  selfSocial: number
  monthsCount: number
  /** ИПН вместе с соцплатежами «за себя». */
  total: number
  /** Доля налога в обороте, в процентах. */
  effectiveRate: number
  months: TaxMonth[]
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function revenueOf(row: TaxIncomeRow): number {
  return num(row.cash_amount) + num(row.kaspi_amount) + num(row.online_amount) + num(row.card_amount)
}

/**
 * Налогооблагаемый оборот по месяцам.
 *
 * `excludedCompanyIds` — точки, чья выручка в налог не входит (на странице
 * это переключатель «включать F16 Extra»). Какие именно точки исключены —
 * решает вызывающий: это вопрос данных, а не формулы.
 */
export function monthlyTaxableRevenue(
  rows: TaxIncomeRow[],
  excludedCompanyIds: string[] = [],
): Array<{ month: string; revenue: number }> {
  const excluded = new Set(excludedCompanyIds.map(String))
  const byMonth = new Map<string, number>()

  for (const row of rows) {
    const companyId = row.company_id == null ? '' : String(row.company_id)
    if (companyId && excluded.has(companyId)) continue
    const month = String(row.date || '').slice(0, 7)
    if (month.length !== 7) continue
    byMonth.set(month, (byMonth.get(month) || 0) + revenueOf(row))
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }))
}

/**
 * Налог за период по журналу доходов.
 *
 * Соцплатежи «за себя» платятся помесячно и от оборота не зависят: их
 * умножаем на число месяцев, в которых была выручка. Месяц без выручки не
 * считаем — период на странице задаётся датами, и пустой хвост месяца иначе
 * добавил бы платёж, которого не было.
 */
export function computeTaxSummary(
  rows: TaxIncomeRow[],
  options: { rate?: number; excludedCompanyIds?: string[] } = {},
): TaxSummary {
  const rate = normalizeRate(options.rate)
  const monthly = monthlyTaxableRevenue(rows, options.excludedCompanyIds || [])

  const months: TaxMonth[] = monthly.map(({ month, revenue }) => {
    const ipn = Math.round(revenue * (rate / 100))
    return { month, revenue, ipn, social: SELF_SOCIAL_MONTHLY, total: ipn + SELF_SOCIAL_MONTHLY }
  })

  const revenue = monthly.reduce((sum, item) => sum + item.revenue, 0)
  // ИПН периода считаем от общего оборота, а не суммой месячных: сумма
  // округлений разошлась бы с декларацией, где база — оборот за период.
  const ipn = Math.round(revenue * (rate / 100))
  const monthsCount = months.length
  const selfSocial = SELF_SOCIAL_MONTHLY * monthsCount
  const total = ipn + selfSocial

  return {
    rate,
    revenue,
    ipn,
    selfSocial,
    monthsCount,
    total,
    effectiveRate: revenue > 0 ? (total / revenue) * 100 : 0,
    months,
  }
}

/** Ставку вне 2–6 % маслихат установить не вправе — чужое значение не принимаем. */
export function normalizeRate(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_TAX_RATE
  return Math.min(MAX_TAX_RATE, Math.max(MIN_TAX_RATE, value))
}

// ── Пороги ───────────────────────────────────────────────────────────────────

export type TaxYearOutlook = {
  yearRevenue: number
  /** Оборот на конец года, если темп сохранится. */
  projected: number
  vatThreshold: number
  vatRemaining: number
  vatRisk: boolean
  simplifiedLimit: number
  simplifiedRemaining: number
  simplifiedRisk: boolean
}

/**
 * Приближение к порогам НДС и упрощёнки.
 *
 * Прогноз линейный: оборот с начала года, растянутый на 365 дней. Сезонность
 * он не учитывает — и не должен: это сигнал «пора считать точнее», а не
 * плановая цифра.
 */
export function computeYearOutlook(yearRevenue: number, dayOfYear: number): TaxYearOutlook {
  const revenue = num(yearRevenue)
  const day = Math.max(1, Math.round(num(dayOfYear)))
  const projected = revenue * (365 / day)

  return {
    yearRevenue: revenue,
    projected,
    vatThreshold: VAT_THRESHOLD,
    vatRemaining: Math.max(0, VAT_THRESHOLD - revenue),
    vatRisk: projected > VAT_THRESHOLD,
    simplifiedLimit: SIMPLIFIED_LIMIT,
    simplifiedRemaining: Math.max(0, SIMPLIFIED_LIMIT - revenue),
    simplifiedRisk: projected > SIMPLIFIED_LIMIT,
  }
}

/** Номер дня в году — база линейного прогноза. */
export function dayOfYear(date: Date = new Date()): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((today - start) / 86_400_000) + 1
}

// ── Налоги за работников ─────────────────────────────────────────────────────

export type EmployeeTax = {
  gross: number
  ipn: number
  opv: number
  vosms: number
  opvr: number
  so: number
  osms: number
  /** Удержано с работника. */
  withheld: number
  /** Сверх оклада, за счёт работодателя. */
  employerTop: number
  /** На руки. */
  net: number
  /** Сколько уходит из бюджета ИП на этого работника. */
  totalCost: number
  /** Все налоги за работника, что ИП перечисляет в бюджет за месяц. */
  monthlyTax: number
}

/**
 * Налоги за одного работника от месячного оклада (брутто).
 *
 * ОПВ и СО считаются от ограниченной базы: сверх потолка взнос не растёт.
 * Льгота по ИПН — 90 % для окладов до 25 МРП; она применяется к уже
 * посчитанному налогу, а не к базе, поэтому вычет учитывается раньше.
 */
export function computeEmployeeTax(grossSalary: number): EmployeeTax {
  const gross = Math.max(0, num(grossSalary))

  const opv = Math.round(Math.min(gross, 50 * MZP) * EMPLOYEE_RATES.opv)
  const vosms = Math.round(gross * EMPLOYEE_RATES.vosms)

  const ipnBase = Math.max(0, gross - STANDARD_DEDUCTION_MRP * MRP - opv - vosms)
  let ipn = Math.round(ipnBase * EMPLOYEE_RATES.ipn)
  if (gross <= IPN_RELIEF_LIMIT) ipn = Math.round(ipn * 0.1)

  const opvr = Math.round(gross * EMPLOYEE_RATES.opvr)
  const so = Math.round(Math.min(gross, 7 * MZP) * EMPLOYEE_RATES.so)
  const osms = Math.round(gross * EMPLOYEE_RATES.osms)

  const withheld = ipn + opv + vosms
  const employerTop = opvr + so + osms

  return {
    gross,
    ipn,
    opv,
    vosms,
    opvr,
    so,
    osms,
    withheld,
    employerTop,
    net: gross - withheld,
    totalCost: gross + employerTop,
    monthlyTax: withheld + employerTop,
  }
}

export type PayrollTaxes = {
  employees: number
  gross: number
  ipn: number
  opv: number
  vosms: number
  opvr: number
  so: number
  osms: number
  withheld: number
  employerTop: number
  net: number
  totalCost: number
  /** Налоги за всех работников за один месяц. */
  monthlyTax: number
}

/** Свод по всем работникам. Оклады — брутто, месячные. */
export function computePayrollTaxes(salaries: number[]): PayrollTaxes {
  const rows = salaries.map(computeEmployeeTax)
  const sum = (pick: (row: EmployeeTax) => number) => rows.reduce((total, row) => total + pick(row), 0)

  return {
    employees: rows.length,
    gross: sum((r) => r.gross),
    ipn: sum((r) => r.ipn),
    opv: sum((r) => r.opv),
    vosms: sum((r) => r.vosms),
    opvr: sum((r) => r.opvr),
    so: sum((r) => r.so),
    osms: sum((r) => r.osms),
    withheld: sum((r) => r.withheld),
    employerTop: sum((r) => r.employerTop),
    net: sum((r) => r.net),
    totalCost: sum((r) => r.totalCost),
    monthlyTax: sum((r) => r.monthlyTax),
  }
}

export type TaxBurden = {
  ipn: number
  selfSocial: number
  payrollTaxes: number
  total: number
  effectiveRate: number
}

/**
 * Полная налоговая нагрузка периода: ИПН, соцплатежи «за себя» и налоги за
 * работников вместе.
 *
 * Считается здесь, а не на клиенте: иначе три слагаемых пришлось бы складывать
 * в каждом приложении заново, и «эффективная ставка» разъехалась бы первой.
 */
export function computeTaxBurden(summary: TaxSummary, payrollMonthlyTax: number): TaxBurden {
  const payrollTaxes = Math.round(num(payrollMonthlyTax) * summary.monthsCount)
  const total = summary.ipn + summary.selfSocial + payrollTaxes

  return {
    ipn: summary.ipn,
    selfSocial: summary.selfSocial,
    payrollTaxes,
    total,
    effectiveRate: summary.revenue > 0 ? (total / summary.revenue) * 100 : 0,
  }
}
