import { DEFAULT_COMPANY_CODES, DEFAULT_SHIFT_BASE_PAY } from '@/lib/core/constants'
import { resolveShiftOverrides, type PointRuleRow } from './point-rules'

export type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'
export type ShiftType = 'day' | 'night'

export type SalaryCompany = {
  id: string
  code: string | null
  name?: string | null
}

export type SalaryRule = {
  id?: number | null
  company_code: string
  shift_type: ShiftType
  base_per_shift: number | null
  senior_operator_bonus?: number | null
  senior_cashier_bonus?: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  effective_from?: string | null
  base_per_shift_prev?: number | null
  low_turnover_threshold?: number | null
  low_turnover_base?: number | null
  versions?: SalaryRuleVersion[]
}

export type SalaryRuleVersion = {
  id?: string | null
  rule_id: number
  effective_from: string
  base_per_shift: number | null
  low_turnover_threshold?: number | null
  low_turnover_base?: number | null
  senior_operator_bonus?: number | null
  senior_cashier_bonus?: number | null
  threshold1_turnover?: number | null
  threshold1_bonus?: number | null
  threshold2_turnover?: number | null
  threshold2_bonus?: number | null
  comment?: string | null
  created_at?: string | null
}

export type SalarySeniorityTier = {
  id?: string | null
  min_months: number
  bonus_percent: number
  is_active?: boolean | null
  effective_from?: string | null
}

export type SalaryOperatorCompanyAssignment = {
  operator_id: string
  company_id: string
  role_in_company: 'operator' | 'senior_operator' | 'senior_cashier'
  is_active?: boolean | null
}

export type SalaryIncomeRow = {
  date: string
  company_id: string
  shift: ShiftType | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount?: number | null
  card_amount: number | null
  operator_id: string | null
  operator_name?: string | null
  zone?: string | null
  comment?: string | null
}

export type SalaryAdjustmentRow = {
  operator_id: string
  amount: number
  kind: AdjustmentKind
  company_id?: string | null
  status?: string | null
}

export type SalaryDebtRow = {
  operator_id: string | null
  amount: number | null
  company_id?: string | null
  status?: string | null
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
  seniorityBonuses: number
  autoBonuses: number
  roleBonuses: number
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

export type SalaryShiftBreakdown = {
  id: string
  payoutKey: string
  date: string
  shift: ShiftType
  companyId: string
  companyCode: string | null
  companyName: string | null
  totalIncome: number
  cash: number
  kaspi: number
  online: number
  card: number
  zones: string[]
  comments: string[]
  baseSalary: number
  seniorityBonus: number
  seniorityPercent: number
  autoBonus: number
  roleBonus: number
  salary: number
  matchedRules: Array<{ id: string; name: string }>
}

export type SalaryWeekCompanyAllocation = {
  companyId: string
  companyCode: string | null
  companyName: string | null
  accruedAmount: number
  bonusAmount: number
  fineAmount: number
  debtAmount: number
  advanceAmount: number
  netAmount: number
  shareRatio: number
}

export type SalaryWeekSummary = {
  operatorId: string
  grossAmount: number
  bonusAmount: number
  fineAmount: number
  debtAmount: number
  advanceAmount: number
  netAmount: number
  companyAllocations: SalaryWeekCompanyAllocation[]
  shiftsCount: number
  autoBonusTotal: number
  seniorityBonusTotal: number
  shifts: SalaryShiftBreakdown[]
}

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyId: string
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

function calculateIncomeTotal(row: Pick<SalaryIncomeRow, 'cash_amount' | 'kaspi_amount' | 'online_amount' | 'card_amount'>) {
  return (
    toAmount(row.cash_amount) +
    toAmount(row.kaspi_amount) +
    toAmount(row.online_amount) +
    toAmount(row.card_amount)
  )
}

function isActiveStatus(value: string | null | undefined) {
  return !value || value === 'active'
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function parseISODate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function fullMonthsBetween(startISO: string | null | undefined, endISO: string | null | undefined) {
  const start = parseISODate(startISO)
  const end = parseISODate(endISO)
  if (!start || !end || end < start) return 0

  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (end.getDate() < start.getDate()) months -= 1
  return Math.max(0, months)
}

export function resolveSeniorityPercent(
  tiers: SalarySeniorityTier[] | undefined,
  hireDate: string | null | undefined,
  shiftDate: string | null | undefined,
) {
  if (!tiers?.length || !hireDate || !shiftDate) return 0
  const workedMonths = fullMonthsBetween(hireDate, shiftDate)
  const matched = tiers
    .filter((tier) => tier.is_active !== false)
    // Tier применяется только если у него есть дата вступления и она <= даты
    // смены. Это защищает прошлые смены от ретроактивного начисления стажа.
    .filter((tier) => !!tier.effective_from && tier.effective_from <= shiftDate)
    .filter((tier) => Number(tier.min_months || 0) <= workedMonths)
    .sort((left, right) => Number(right.min_months || 0) - Number(left.min_months || 0))[0]

  if (!matched) return 0
  return Math.min(15, Math.max(0, Number(matched.bonus_percent || 0)))
}

export function distributeAmountByWeights<T extends { key: string; weight: number }>(
  amount: number,
  items: T[],
): Map<string, number> {
  const total = roundMoney(amount)
  const result = new Map<string, number>()
  if (!items.length || total === 0) return result

  const normalizedItems = items.map((item) => ({
    ...item,
    weight: Math.max(0, roundMoney(item.weight)),
  }))
  const totalWeight = normalizedItems.reduce((sum, item) => sum + item.weight, 0)

  if (totalWeight <= 0) {
    result.set(normalizedItems[0].key, total)
    return result
  }

  let assigned = 0
  const drafts = normalizedItems.map((item) => {
    const raw = (total * item.weight) / totalWeight
    const rounded = roundMoney(raw)
    assigned += rounded
    return { key: item.key, rounded, delta: raw - rounded }
  })

  let remainder = roundMoney(total - assigned)
  drafts.sort((left, right) => right.delta - left.delta)

  for (const item of drafts) {
    if (remainder === 0) break
    const step = remainder > 0 ? 0.01 : -0.01
    item.rounded = roundMoney(item.rounded + step)
    remainder = roundMoney(remainder - step)
  }

  for (const item of drafts) {
    result.set(item.key, roundMoney(item.rounded))
  }

  return result
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

function getRuleForShift(
  ruleMap: Map<string, SalaryRule>,
  companyCode: string | null | undefined,
  shift: ShiftType,
) {
  if (!companyCode) return undefined
  return ruleMap.get(`${companyCode}_${shift}`)
}

function calculateThresholdBonus(rule: SalaryRule | undefined, turnover: number) {
  let bonus = 0

  const threshold1 = toAmount(rule?.threshold1_turnover)
  const threshold2 = toAmount(rule?.threshold2_turnover)
  if (threshold1 > 0 && turnover >= threshold1) bonus += toAmount(rule?.threshold1_bonus)
  if (threshold2 > 0 && turnover >= threshold2) bonus += toAmount(rule?.threshold2_bonus)

  return bonus
}

function resolveRevenueBase(params: {
  base: number | null | undefined
  lowTurnoverThreshold?: number | null
  lowTurnoverBase?: number | null
  turnover: number
}) {
  if (params.lowTurnoverThreshold != null && params.lowTurnoverBase != null) {
    if (params.turnover < toAmount(params.lowTurnoverThreshold)) {
      return toAmount(params.lowTurnoverBase)
    }
  }

  return toAmount(params.base ?? DEFAULT_SHIFT_BASE_PAY)
}

function resolveRuleVersion(rule: SalaryRule, shiftDate: string | undefined) {
  if (!shiftDate || !rule.versions?.length) return null
  return [...rule.versions]
    .filter((version) => version.effective_from && version.effective_from <= shiftDate)
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] || null
}

// Возвращает «правило для конкретной даты смены».
// Если есть подходящая версия в operator_salary_rule_versions — берём все
// поля из неё (полный снапшот). Иначе если у текущего правила есть
// effective_from и смена раньше этой даты — применяем legacy fallback:
// для base используем base_per_shift_prev, low_turnover отключаем
// (предполагаем, что условие добавлено вместе с новым окладом).
// Иначе возвращаем текущее правило как есть.
function resolveEffectiveRule(rule: SalaryRule, shiftDate: string | undefined): SalaryRule {
  const version = resolveRuleVersion(rule, shiftDate)
  if (version) {
    return {
      ...rule,
      base_per_shift: version.base_per_shift ?? rule.base_per_shift ?? null,
      low_turnover_threshold: version.low_turnover_threshold ?? null,
      low_turnover_base: version.low_turnover_base ?? null,
      senior_operator_bonus: version.senior_operator_bonus ?? rule.senior_operator_bonus ?? null,
      senior_cashier_bonus: version.senior_cashier_bonus ?? rule.senior_cashier_bonus ?? null,
      threshold1_turnover: version.threshold1_turnover ?? rule.threshold1_turnover ?? null,
      threshold1_bonus: version.threshold1_bonus ?? rule.threshold1_bonus ?? null,
      threshold2_turnover: version.threshold2_turnover ?? rule.threshold2_turnover ?? null,
      threshold2_bonus: version.threshold2_bonus ?? rule.threshold2_bonus ?? null,
    }
  }

  if (rule.effective_from && shiftDate && shiftDate < rule.effective_from) {
    return {
      ...rule,
      base_per_shift: rule.base_per_shift_prev ?? rule.base_per_shift ?? null,
      low_turnover_threshold: null,
      low_turnover_base: null,
    }
  }

  return rule
}

function resolveBasePerShift(rule: SalaryRule | undefined, shiftDate: string | undefined, turnover: number): number {
  if (!rule) return DEFAULT_SHIFT_BASE_PAY

  const effective = resolveEffectiveRule(rule, shiftDate)
  return resolveRevenueBase({
    base: effective.base_per_shift,
    lowTurnoverThreshold: effective.low_turnover_threshold,
    lowTurnoverBase: effective.low_turnover_base,
    turnover,
  })
}

function computeShiftCompensation(params: {
  rule: SalaryRule | undefined
  shiftRules: PointRuleRow[] | undefined
  companyId: string | null
  shiftType: ShiftType
  turnover: number
  assignmentRole: SalaryOperatorCompanyAssignment['role_in_company'] | undefined
  shiftDate?: string
  operator?: SalaryOperatorMeta | null
  seniorityTiers?: SalarySeniorityTier[]
}) {
  const override = params.shiftRules && params.shiftRules.length > 0
    ? resolveShiftOverrides({
        rules: params.shiftRules,
        companyId: params.companyId,
        shiftType: params.shiftType,
        turnover: params.turnover,
      })
    : null

  // Все компоненты зарплаты берём из правила, актуального для даты смены.
  // Это гарантирует, что прошлые смены не пересчитаются при правке текущего
  // правила: для них берётся снапшот из operator_salary_rule_versions.
  const effectiveRule = params.rule ? resolveEffectiveRule(params.rule, params.shiftDate) : undefined

  const basePerShift =
    override?.basePerShift != null
      ? override.basePerShift
      : resolveBasePerShift(params.rule, params.shiftDate, params.turnover)

  const seniorOperatorBonus =
    override?.seniorOperatorBonus != null
      ? override.seniorOperatorBonus
      : toAmount(effectiveRule?.senior_operator_bonus)
  const seniorCashierBonus =
    override?.seniorCashierBonus != null
      ? override.seniorCashierBonus
      : toAmount(effectiveRule?.senior_cashier_bonus)

  const roleBonus =
    params.assignmentRole === 'senior_operator'
      ? seniorOperatorBonus
      : params.assignmentRole === 'senior_cashier'
        ? seniorCashierBonus
        : 0

  const autoBonus =
    calculateThresholdBonus(effectiveRule, params.turnover) + (override?.thresholdBonusDelta || 0)

  const seniorityPercent = resolveSeniorityPercent(
    params.seniorityTiers,
    params.operator?.hire_date,
    params.shiftDate,
  )
  const seniorityBonus = roundMoney((basePerShift * seniorityPercent) / 100)

  return {
    basePerShift,
    roleBonus,
    autoBonus,
    seniorityBonus,
    seniorityPercent,
    matchedRules: override?.matchedRules || [],
  }
}

function createOperatorCompanyRoleMap(params: {
  assignments: SalaryOperatorCompanyAssignment[]
  companies: SalaryCompany[]
}): Map<string, SalaryOperatorCompanyAssignment['role_in_company']> {
  const companyCodeMap = createCompanyCodeMap(params.companies)
  const map = new Map<string, SalaryOperatorCompanyAssignment['role_in_company']>()

  for (const assignment of params.assignments) {
    if (assignment.is_active === false) continue
    const companyCode = companyCodeMap.get(assignment.company_id)
    if (!companyCode) continue
    map.set(`${assignment.operator_id}_${companyCode}`, assignment.role_in_company)
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
    const turnover = calculateIncomeTotal(row)
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
      companyId: row.company_id,
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
  operator?: SalaryOperatorMeta | null
  companies: SalaryCompany[]
  rules: SalaryRule[]
  seniorityTiers?: SalarySeniorityTier[]
  shiftRules?: PointRuleRow[]
  assignments?: SalaryOperatorCompanyAssignment[]
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
  const operatorCompanyRoleMap = createOperatorCompanyRoleMap({
    assignments: params.assignments || [],
    companies: params.companies,
  })

  let shifts = 0
  let baseSalary = 0
  let seniorityBonuses = 0
  let autoBonuses = 0
  let roleBonuses = 0

  for (const shift of aggregated.values()) {
    const rule = getRuleForShift(ruleMap, shift.companyCode, shift.shift)
    const assignmentRole = operatorCompanyRoleMap.get(`${shift.operatorId}_${shift.companyCode}`)
    const { basePerShift, roleBonus, autoBonus, seniorityBonus } = computeShiftCompensation({
      rule,
      shiftRules: params.shiftRules,
      companyId: shift.companyId,
      shiftType: shift.shift,
      turnover: shift.turnover,
      assignmentRole,
      shiftDate: shift.date,
      operator: params.operator || null,
      seniorityTiers: params.seniorityTiers,
    })

    shifts += 1
    baseSalary += basePerShift
    seniorityBonuses += seniorityBonus
    autoBonuses += autoBonus
    roleBonuses += roleBonus
  }

  let manualBonuses = 0
  let totalFines = 0
  let totalAdvances = 0

  for (const adjustment of params.adjustments) {
    if (adjustment.operator_id !== params.operatorId) continue
    if (!isActiveStatus(adjustment.status)) continue
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

  const totalAccrued = baseSalary + seniorityBonuses + autoBonuses + roleBonuses + manualBonuses
  const totalDeductions = autoDebts + totalFines + totalAdvances

  return {
    shifts,
    baseSalary,
    seniorityBonuses: roundMoney(seniorityBonuses),
    autoBonuses,
    roleBonuses,
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

export function calculateOperatorShiftBreakdown(params: {
  operatorId: string
  operator?: SalaryOperatorMeta | null
  companies: SalaryCompany[]
  rules: SalaryRule[]
  seniorityTiers?: SalarySeniorityTier[]
  shiftRules?: PointRuleRow[]
  assignments?: SalaryOperatorCompanyAssignment[]
  incomes: SalaryIncomeRow[]
  options?: CalculationOptions
}): SalaryShiftBreakdown[] {
  const companyCodeMap = createCompanyCodeMap(params.companies)
  const companyNameMap = new Map<string, string | null>()
  for (const company of params.companies) {
    companyNameMap.set(company.id, company.name || null)
  }

  const ruleMap = createRuleMap(params.rules)
  const operatorCompanyRoleMap = createOperatorCompanyRoleMap({
    assignments: params.assignments || [],
    companies: params.companies,
  })
  const allowedCodes = new Set((params.options?.companyCodes || DEFAULT_COMPANY_CODES).map((item) => item.toLowerCase()))
  const aggregated = new Map<
    string,
    Omit<
      SalaryShiftBreakdown,
      'baseSalary' | 'seniorityBonus' | 'seniorityPercent' | 'autoBonus' | 'roleBonus' | 'salary' | 'matchedRules'
    >
  >()

  for (const row of params.incomes) {
    if (row.operator_id !== params.operatorId) continue
    if (!row.shift) continue

    const companyCode = companyCodeMap.get(row.company_id)
    if (!companyCode || !allowedCodes.has(companyCode)) continue

    const key = `${row.date}_${row.shift}_${row.company_id}`
    const existing = aggregated.get(key)
    const cash = toAmount(row.cash_amount)
    const kaspi = toAmount(row.kaspi_amount)
    const online = toAmount(row.online_amount)
    const card = toAmount(row.card_amount)
    const totalIncome = cash + kaspi + online + card
    if (totalIncome <= 0) continue

    if (existing) {
      existing.totalIncome += totalIncome
      existing.cash += cash
      existing.kaspi += kaspi
      existing.online += online
      existing.card += card
      if (row.zone && !existing.zones.includes(row.zone)) existing.zones.push(row.zone)
      if (row.comment && !existing.comments.includes(row.comment)) existing.comments.push(row.comment)
      continue
    }

    aggregated.set(key, {
      id: key,
      payoutKey: `${row.date}_${row.shift}`,
      date: row.date,
      shift: row.shift,
      companyId: row.company_id,
      companyCode,
      companyName: companyNameMap.get(row.company_id) || null,
      totalIncome,
      cash,
      kaspi,
      online,
      card,
      zones: row.zone ? [row.zone] : [],
      comments: row.comment ? [row.comment] : [],
    })
  }

  const breakdown = Array.from(aggregated.values()).map((shift) => {
    const rule = getRuleForShift(ruleMap, shift.companyCode, shift.shift)
    const assignmentRole = operatorCompanyRoleMap.get(`${params.operatorId}_${shift.companyCode}`)
    const { basePerShift, roleBonus, autoBonus, seniorityBonus, seniorityPercent, matchedRules } = computeShiftCompensation({
      rule,
      shiftRules: params.shiftRules,
      companyId: shift.companyId,
      shiftType: shift.shift,
      turnover: shift.totalIncome,
      assignmentRole,
      shiftDate: shift.date,
      operator: params.operator || null,
      seniorityTiers: params.seniorityTiers,
    })

    return {
      ...shift,
      baseSalary: basePerShift,
      seniorityBonus,
      seniorityPercent,
      autoBonus,
      roleBonus,
      salary: basePerShift + seniorityBonus + autoBonus + roleBonus,
      matchedRules,
    }
  })

  breakdown.sort((left, right) => left.date.localeCompare(right.date) || left.shift.localeCompare(right.shift))
  return breakdown
}

export function calculateOperatorWeekSummary(params: {
  operatorId: string
  operator?: SalaryOperatorMeta | null
  companies: SalaryCompany[]
  rules: SalaryRule[]
  seniorityTiers?: SalarySeniorityTier[]
  shiftRules?: PointRuleRow[]
  assignments?: SalaryOperatorCompanyAssignment[]
  incomes: SalaryIncomeRow[]
  adjustments: SalaryAdjustmentRow[]
  debts: SalaryDebtRow[]
  options?: CalculationOptions
}): SalaryWeekSummary {
  const shifts = calculateOperatorShiftBreakdown({
    operatorId: params.operatorId,
    operator: params.operator || null,
    companies: params.companies,
    rules: params.rules,
    seniorityTiers: params.seniorityTiers,
    shiftRules: params.shiftRules,
    assignments: params.assignments,
    incomes: params.incomes,
    options: params.options,
  })

  const companyMeta = new Map<string, { companyCode: string | null; companyName: string | null }>()
  for (const company of params.companies) {
    companyMeta.set(company.id, {
      companyCode: company.code || null,
      companyName: company.name || null,
    })
  }

  const companyAllocations = new Map<string, SalaryWeekCompanyAllocation>()
  const ensureCompany = (companyId: string) => {
    const existing = companyAllocations.get(companyId)
    if (existing) return existing

    const meta = companyMeta.get(companyId)
    const next: SalaryWeekCompanyAllocation = {
      companyId,
      companyCode: meta?.companyCode || null,
      companyName: meta?.companyName || null,
      accruedAmount: 0,
      bonusAmount: 0,
      fineAmount: 0,
      debtAmount: 0,
      advanceAmount: 0,
      netAmount: 0,
      shareRatio: 0,
    }
    companyAllocations.set(companyId, next)
    return next
  }

  for (const shift of shifts) {
    const company = ensureCompany(shift.companyId)
    // "Начислено" on the weekly board is the fixed part for the shift
    // (base + seniority + role premium). Auto bonuses are shown in a separate column
    // and added explicitly into the final weekly/net formula below.
    company.accruedAmount += shift.baseSalary + shift.seniorityBonus + shift.roleBonus
    company.bonusAmount += shift.autoBonus
  }

  let bonusAmount = 0
  let fineAmount = 0
  let advanceAmount = 0

  const unassignedBonuses: number[] = []
  const unassignedFines: number[] = []
  const unassignedAdvances: number[] = []

  for (const adjustment of params.adjustments) {
    if (adjustment.operator_id !== params.operatorId) continue
    if (!isActiveStatus(adjustment.status)) continue

    const amount = toAmount(adjustment.amount)
    if (amount <= 0) continue

    if (adjustment.kind === 'bonus') bonusAmount += amount
    else if (adjustment.kind === 'advance') advanceAmount += amount
    else fineAmount += amount

    const targetCompanyId = adjustment.company_id || null
    if (targetCompanyId) {
      const company = ensureCompany(targetCompanyId)
      if (adjustment.kind === 'bonus') company.bonusAmount += amount
      else if (adjustment.kind === 'advance') company.advanceAmount += amount
      else company.fineAmount += amount
      continue
    }

    if (adjustment.kind === 'bonus') unassignedBonuses.push(amount)
    else if (adjustment.kind === 'advance') unassignedAdvances.push(amount)
    else unassignedFines.push(amount)
  }

  let debtAmount = 0
  const unassignedDebts: number[] = []
  for (const debt of params.debts) {
    if (debt.operator_id !== params.operatorId) continue
    if (!isActiveStatus(debt.status)) continue

    const amount = toAmount(debt.amount)
    if (amount <= 0) continue
    debtAmount += amount

    const targetCompanyId = debt.company_id || null
    if (targetCompanyId) {
      const company = ensureCompany(targetCompanyId)
      company.debtAmount += amount
      continue
    }

    unassignedDebts.push(amount)
  }

  const weightedCompanies = Array.from(companyAllocations.values()).map((company) => ({
    key: company.companyId,
    weight: company.accruedAmount,
  }))

  const distributeUnassigned = (
    values: number[],
    apply: (company: SalaryWeekCompanyAllocation, amount: number) => void,
  ) => {
    for (const value of values) {
      const distributed = distributeAmountByWeights(value, weightedCompanies)
      for (const [companyId, amount] of distributed.entries()) {
        apply(ensureCompany(companyId), amount)
      }
    }
  }

  distributeUnassigned(unassignedBonuses, (company, amount) => {
    company.bonusAmount += amount
  })
  distributeUnassigned(unassignedFines, (company, amount) => {
    company.fineAmount += amount
  })
  distributeUnassigned(unassignedAdvances, (company, amount) => {
    company.advanceAmount += amount
  })
  distributeUnassigned(unassignedDebts, (company, amount) => {
    company.debtAmount += amount
  })

  const grossAmount = Array.from(companyAllocations.values()).reduce((sum, company) => sum + company.accruedAmount, 0)
  const denominator = grossAmount > 0 ? grossAmount : 1

  const allocations = Array.from(companyAllocations.values())
    .map((company) => {
      const netAmount =
        company.accruedAmount + company.bonusAmount - company.fineAmount - company.debtAmount - company.advanceAmount

      return {
        ...company,
        accruedAmount: roundMoney(company.accruedAmount),
        bonusAmount: roundMoney(company.bonusAmount),
        fineAmount: roundMoney(company.fineAmount),
        debtAmount: roundMoney(company.debtAmount),
        advanceAmount: roundMoney(company.advanceAmount),
        netAmount: roundMoney(netAmount),
        shareRatio: grossAmount > 0 ? roundMoney(company.accruedAmount / denominator) : 0,
      }
    })
    .sort((left, right) => (right.accruedAmount - left.accruedAmount) || left.companyName?.localeCompare(right.companyName || '', 'ru') || 0)

  const autoBonusTotal = roundMoney(shifts.reduce((sum, s) => sum + s.autoBonus, 0))
  const seniorityBonusTotal = roundMoney(shifts.reduce((sum, s) => sum + s.seniorityBonus, 0))

  return {
    operatorId: params.operatorId,
    grossAmount: roundMoney(grossAmount),
    bonusAmount: roundMoney(bonusAmount),
    fineAmount: roundMoney(fineAmount),
    debtAmount: roundMoney(debtAmount),
    advanceAmount: roundMoney(advanceAmount),
    netAmount: roundMoney(
      grossAmount + autoBonusTotal + bonusAmount - fineAmount - debtAmount - advanceAmount,
    ),
    companyAllocations: allocations,
    shiftsCount: shifts.length,
    autoBonusTotal,
    seniorityBonusTotal,
    shifts,
  }
}

export function calculateSalaryBoard(params: {
  operators: SalaryOperatorMeta[]
  companies: SalaryCompany[]
  rules: SalaryRule[]
  seniorityTiers?: SalarySeniorityTier[]
  shiftRules?: PointRuleRow[]
  assignments?: SalaryOperatorCompanyAssignment[]
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
  const operatorCompanyRoleMap = createOperatorCompanyRoleMap({
    assignments: params.assignments || [],
    companies: params.companies,
  })
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
      seniorityBonuses: 0,
      autoBonuses: 0,
      roleBonuses: 0,
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
    const rule = getRuleForShift(ruleMap, shift.companyCode, shift.shift)
    const assignmentRole = operatorCompanyRoleMap.get(`${shift.operatorId}_${shift.companyCode}`)
    const { basePerShift, roleBonus, autoBonus, seniorityBonus } = computeShiftCompensation({
      rule,
      shiftRules: params.shiftRules,
      companyId: shift.companyId,
      shiftType: shift.shift,
      turnover: shift.turnover,
      assignmentRole,
      shiftDate: shift.date,
      operator: operatorMap[shift.operatorId] || null,
      seniorityTiers: params.seniorityTiers,
    })

    const stat = ensureOperator(shift.operatorId)
    stat.basePerShift = basePerShift
    stat.shifts += 1
    stat.baseSalary += basePerShift
    stat.seniorityBonuses += seniorityBonus
    stat.autoBonuses += autoBonus
    stat.roleBonuses += roleBonus
    stat.totalSalary += basePerShift + seniorityBonus + autoBonus + roleBonus
  }

  for (const adjustment of params.adjustments) {
    if (!isActiveStatus(adjustment.status)) continue
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
      stat.totalAccrued = stat.baseSalary + stat.seniorityBonuses + stat.autoBonuses + stat.roleBonuses + stat.manualBonuses
      stat.totalDeductions = stat.autoDebts + stat.totalFines + stat.totalAdvances
      stat.remainingAmount = stat.totalAccrued - stat.totalDeductions
      stat.finalSalary = stat.totalSalary + stat.manualPlus - stat.manualMinus - stat.autoDebts - stat.advances
      totalSalary += stat.finalSalary
      return stat
    })
    .sort((left, right) => left.operatorName.localeCompare(right.operatorName, 'ru'))

  return { operators, totalSalary }
}
