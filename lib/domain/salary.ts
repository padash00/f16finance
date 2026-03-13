import { DEFAULT_COMPANY_CODES, DEFAULT_SHIFT_BASE_PAY } from '@/lib/core/constants'

export type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'
export type ShiftType = 'day' | 'night'

export type SalaryCompany = {
  id: string
  code: string | null
  name?: string | null
}

export type SalaryRule = {
  company_code: string
  shift_type: ShiftType
  base_per_shift: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
}

export type SalaryIncomeRow = {
  date: string
  company_id: string
  shift: ShiftType | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  operator_name?: string | null
}

export type SalaryAdjustmentRow = {
  operator_id: string
  amount: number
  kind: AdjustmentKind
}

export type SalaryDebtRow = {
  operator_id: string | null
  amount: number | null
}

export type SalaryOperatorMeta = {
  id: string
  name: string
  full_name?: string | null
  short_name: string | null
  is_active?: boolean | null
  telegram_chat_id?: string | null
  photo_url?: string | null
  position?: string | null
  phone?: string | null
  email?: string | null
  hire_date?: string | null
  documents_count?: number
  expiring_documents?: number
}

export type SalarySummary = {
  shifts: number
  baseSalary: number
  autoBonuses: number
  manualBonuses: number
  totalAccrued: number
  autoDebts: number
  totalFines: number
  totalAdvances: number
  totalDeductions: number
  remainingAmount: number
  manualMinus: number
  manualPlus: number
  advances: number
}

export type SalaryBoardOperatorStat = SalarySummary & {
  operatorId: string
  operatorName: string
  basePerShift: number
  totalSalary: number
  finalSalary: number
  photo_url: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  documents_count: number
  expiring_documents: number
  telegram_chat_id: string | null
}

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyCode: string
  date: string
  shift: ShiftType
  turnover: number
}

type CalculationOptions = {
  companyCodes?: readonly string[]
}

function toAmount(value: number | null | undefined): number {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function createCompanyCodeMap(companies: SalaryCompany[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const company of companies) {
    if (!company.code) continue
    map.set(company.id, String(company.code).toLowerCase())
  }
  return map
}

function createRuleMap(rules: SalaryRule[]): Map<string, SalaryRule> {
  const map = new Map<string, SalaryRule>()
  for (const rule of rules) {
    map.set(`${String(rule.company_code).toLowerCase()}_${rule.shift_type}`, rule)
  }
  return map
}

function aggregateShifts(params: {
  incomes: SalaryIncomeRow[]
  companies: SalaryCompany[]
  operatorsById?: Record<string, SalaryOperatorMeta>
  options?: CalculationOptions
}): Map<string, AggregatedShift> {
  const companyCodeMap = createCompanyCodeMap(params.companies)
  const allowedCodes = new Set((params.options?.companyCodes || DEFAULT_COMPANY_CODES).map((item) => item.toLowerCase()))
  const aggregated = new Map<string, AggregatedShift>()

  for (const row of params.incomes) {
    if (!row.operator_id) continue

    const companyCode = companyCodeMap.get(row.company_id)
    if (!companyCode || !allowedCodes.has(companyCode)) continue

    const shift: ShiftType = row.shift === 'night' ? 'night' : 'day'
    const turnover = toAmount(row.cash_amount) + toAmount(row.kaspi_amount) + toAmount(row.card_amount)
    if (turnover <= 0) continue

    const operatorMeta = params.operatorsById?.[row.operator_id]
    const operatorName = operatorMeta?.full_name || operatorMeta?.name || operatorMeta?.short_name || row.operator_name || 'Без имени'
    const key = `${row.operator_id}_${companyCode}_${row.date}_${shift}`
    const existing = aggregated.get(key)

    if (existing) {
      existing.turnover += turnover
      continue
    }

    aggregated.set(key, {
      operatorId: row.operator_id,
      operatorName,
      companyCode,
      date: row.date,
      shift,
      turnover,
    })
  }

  return aggregated
}

export function calculateOperatorSalarySummary(params: {
  operatorId: string
  companies: SalaryCompany[]
  rules: SalaryRule[]
  incomes: SalaryIncomeRow[]
  adjustments: SalaryAdjustmentRow[]
  debts: SalaryDebtRow[]
  options?: CalculationOptions
}): SalarySummary {
  const aggregated = aggregateShifts({
    incomes: params.incomes.filter((row) => row.operator_id === params.operatorId),
    companies: params.companies,
    options: params.options,
  })
  const ruleMap = createRuleMap(params.rules)

  let shifts = 0
  let baseSalary = 0
  let autoBonuses = 0

  for (const shift of aggregated.values()) {
    const rule = ruleMap.get(`${shift.companyCode}_${shift.shift}`)
    const basePerShift = toAmount(rule?.base_per_shift ?? DEFAULT_SHIFT_BASE_PAY)

    let bonus = 0
    if (toAmount(rule?.threshold1_turnover) > 0 && shift.turnover >= toAmount(rule?.threshold1_turnover)) {
      bonus += toAmount(rule?.threshold1_bonus)
    }
    if (toAmount(rule?.threshold2_turnover) > 0 && shift.turnover >= toAmount(rule?.threshold2_turnover)) {
      bonus += toAmount(rule?.threshold2_bonus)
    }

    shifts += 1
    baseSalary += basePerShift
    autoBonuses += bonus
  }

  let manualBonuses = 0
  let totalFines = 0
  let totalAdvances = 0

  for (const adjustment of params.adjustments) {
    if (adjustment.operator_id !== params.operatorId) continue
    const amount = toAmount(adjustment.amount)
    if (amount <= 0) continue

    if (adjustment.kind === 'bonus') manualBonuses += amount
    else if (adjustment.kind === 'advance') totalAdvances += amount
    else totalFines += amount
  }

  let autoDebts = 0
  for (const debt of params.debts) {
    if (debt.operator_id !== params.operatorId) continue
    const amount = toAmount(debt.amount)
    if (amount > 0) autoDebts += amount
  }

  const totalAccrued = baseSalary + autoBonuses + manualBonuses
  const totalDeductions = autoDebts + totalFines + totalAdvances

  return {
    shifts,
    baseSalary,
    autoBonuses,
    manualBonuses,
    totalAccrued,
    autoDebts,
    totalFines,
    totalAdvances,
    totalDeductions,
    remainingAmount: totalAccrued - totalDeductions,
    manualMinus: totalFines,
    manualPlus: manualBonuses,
    advances: totalAdvances,
  }
}

export function calculateSalaryBoard(params: {
  operators: SalaryOperatorMeta[]
  companies: SalaryCompany[]
  rules: SalaryRule[]
  incomes: SalaryIncomeRow[]
  adjustments: SalaryAdjustmentRow[]
  debts: SalaryDebtRow[]
  options?: CalculationOptions
}): { operators: SalaryBoardOperatorStat[]; totalSalary: number } {
  const operatorMap = Object.fromEntries(params.operators.map((operator) => [operator.id, operator]))
  const aggregated = aggregateShifts({
    incomes: params.incomes,
    companies: params.companies,
    operatorsById: operatorMap,
    options: params.options,
  })
  const ruleMap = createRuleMap(params.rules)
  const board = new Map<string, SalaryBoardOperatorStat>()

  const ensureOperator = (operatorId: string): SalaryBoardOperatorStat => {
    const existing = board.get(operatorId)
    if (existing) return existing

    const meta = operatorMap[operatorId]
    const next: SalaryBoardOperatorStat = {
      operatorId,
      operatorName: meta?.full_name || meta?.name || meta?.short_name || 'Без имени',
      shifts: 0,
      basePerShift: DEFAULT_SHIFT_BASE_PAY,
      baseSalary: 0,
      autoBonuses: 0,
      manualBonuses: 0,
      totalAccrued: 0,
      autoDebts: 0,
      totalFines: 0,
      totalAdvances: 0,
      totalDeductions: 0,
      remainingAmount: 0,
      manualMinus: 0,
      manualPlus: 0,
      advances: 0,
      totalSalary: 0,
      finalSalary: 0,
      photo_url: meta?.photo_url || null,
      position: meta?.position || null,
      phone: meta?.phone || null,
      email: meta?.email || null,
      hire_date: meta?.hire_date || null,
      documents_count: meta?.documents_count || 0,
      expiring_documents: meta?.expiring_documents || 0,
      telegram_chat_id: meta?.telegram_chat_id || null,
    }

    board.set(operatorId, next)
    return next
  }

  for (const operator of params.operators) {
    if (operator.is_active === false) continue
    ensureOperator(operator.id)
  }

  for (const shift of aggregated.values()) {
    const rule = ruleMap.get(`${shift.companyCode}_${shift.shift}`)
    const basePerShift = toAmount(rule?.base_per_shift ?? DEFAULT_SHIFT_BASE_PAY)

    let bonus = 0
    if (toAmount(rule?.threshold1_turnover) > 0 && shift.turnover >= toAmount(rule?.threshold1_turnover)) {
      bonus += toAmount(rule?.threshold1_bonus)
    }
    if (toAmount(rule?.threshold2_turnover) > 0 && shift.turnover >= toAmount(rule?.threshold2_turnover)) {
      bonus += toAmount(rule?.threshold2_bonus)
    }

    const stat = ensureOperator(shift.operatorId)
    stat.basePerShift = basePerShift
    stat.shifts += 1
    stat.baseSalary += basePerShift
    stat.autoBonuses += bonus
    stat.totalSalary += basePerShift + bonus
  }

  for (const adjustment of params.adjustments) {
    const stat = ensureOperator(adjustment.operator_id)
    const amount = toAmount(adjustment.amount)
    if (amount <= 0) continue

    if (adjustment.kind === 'bonus') {
      stat.manualBonuses += amount
      stat.manualPlus += amount
    } else if (adjustment.kind === 'advance') {
      stat.totalAdvances += amount
      stat.advances += amount
    } else {
      stat.totalFines += amount
      stat.manualMinus += amount
    }
  }

  for (const debt of params.debts) {
    if (!debt.operator_id) continue
    const stat = ensureOperator(debt.operator_id)
    const amount = toAmount(debt.amount)
    if (amount <= 0) continue
    stat.autoDebts += amount
  }

  let totalSalary = 0
  const operators = Array.from(board.values())
    .map((stat) => {
      stat.totalAccrued = stat.baseSalary + stat.autoBonuses + stat.manualBonuses
      stat.totalDeductions = stat.autoDebts + stat.totalFines + stat.totalAdvances
      stat.remainingAmount = stat.totalAccrued - stat.totalDeductions
      stat.finalSalary = stat.totalSalary + stat.manualPlus - stat.manualMinus - stat.autoDebts - stat.advances
      totalSalary += stat.finalSalary
      return stat
    })
    .sort((left, right) => left.operatorName.localeCompare(right.operatorName, 'ru'))

  return { operators, totalSalary }
}
