import 'server-only'

import type { AdminSupabaseClient } from '@/lib/server/supabase'
import type {
  SalaryAdjustmentRow,
  SalaryCompany,
  SalaryDebtRow,
  SalaryIncomeRow,
  SalaryOperatorCompanyAssignment,
  SalaryOperatorMeta,
  SalaryRule,
} from '@/lib/domain/salary'

type MaybeRoleOperator = SalaryOperatorMeta & {
  role?: string | null
}

export async function findOperatorByKey(
  supabase: AdminSupabaseClient,
  operatorKey: string,
) {
  const isDigits = /^[0-9]+$/.test(operatorKey)

  const { data, error } = await supabase
    .from('operators')
    .select('id,name,short_name,telegram_chat_id,is_active,role,operator_profiles(*)')
    .limit(2)
    .match(isDigits ? { telegram_chat_id: operatorKey } : { id: operatorKey })

  if (error) throw error
  const row = ((data || [])[0] as any) || null
  if (!row) return null
  return {
    ...row,
    full_name: row.operator_profiles?.[0]?.full_name || row.operator_profiles?.full_name || null,
  } as MaybeRoleOperator
}

export async function listSalaryReferenceData(
  supabase: AdminSupabaseClient,
  options?: {
    companyIds?: string[] | null
  },
) {
  const companyIds = (options?.companyIds || []).filter(Boolean)
  const assignmentsQuery = supabase
    .from('operator_company_assignments')
    .select('operator_id,company_id,role_in_company,is_active')
    .eq('is_active', true)

  if (companyIds.length > 0) {
    assignmentsQuery.in('company_id', companyIds)
  }

  const [
    { data: companies, error: companiesError },
    { data: rules, error: rulesError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    companyIds.length > 0
      ? supabase.from('companies').select('id,code,name').in('id', companyIds)
      : supabase.from('companies').select('id,code,name'),
    supabase
      .from('operator_salary_rules')
      .select(
        'company_code,shift_type,base_per_shift,senior_operator_bonus,senior_cashier_bonus,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus',
      )
      .eq('is_active', true),
    assignmentsQuery,
  ])

  if (companiesError) throw companiesError
  if (rulesError) throw rulesError
  if (assignmentsError) throw assignmentsError

  return {
    companies: (companies || []) as SalaryCompany[],
    rules: (rules || []) as SalaryRule[],
    assignments: (assignments || []) as SalaryOperatorCompanyAssignment[],
  }
}

export async function listOperatorSalaryData(
  supabase: AdminSupabaseClient,
  params: {
    operatorId: string
    dateFrom: string
    dateTo: string
    weekStart?: string
    companyCode?: string
    companyIds?: string[] | null
  },
) {
  const { operatorId, dateFrom, dateTo, weekStart, companyCode } = params
  const companyIds = (params.companyIds || []).filter(Boolean)

  const incomesQuery = supabase
    .from('incomes')
    .select('date,company_id,shift,cash_amount,kaspi_amount,online_amount,card_amount,operator_id,operator_name')
    .eq('operator_id', operatorId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const adjustmentsQuery = supabase
    .from('operator_salary_adjustments')
    .select('operator_id,amount,kind,company_id,status')
    .eq('operator_id', operatorId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const debtsBase = supabase
    .from('debts')
    .select('operator_id,amount,company_id,status')
    .eq('operator_id', operatorId)
    .eq('status', 'active')

  const debtsQuery = weekStart
    ? debtsBase.eq('week_start', weekStart)
    : debtsBase.gte('week_start', dateFrom).lte('week_start', dateTo)

  const [{ data: incomes, error: incomesError }, { data: adjustments, error: adjustmentsError }, { data: debts, error: debtsError }] =
    await Promise.all([incomesQuery, adjustmentsQuery, debtsQuery])

  if (incomesError) throw incomesError
  if (adjustmentsError) throw adjustmentsError
  if (debtsError) throw debtsError

  let filteredIncomes = (incomes || []) as SalaryIncomeRow[]
  let filteredAdjustments = (adjustments || []) as SalaryAdjustmentRow[]
  let filteredDebts = (debts || []) as SalaryDebtRow[]

  if (companyIds.length > 0) {
    filteredIncomes = filteredIncomes.filter((row) => companyIds.includes(String(row.company_id || '')))
    filteredAdjustments = filteredAdjustments.filter((row) => !row.company_id || companyIds.includes(String(row.company_id)))
    filteredDebts = filteredDebts.filter((row) => !row.company_id || companyIds.includes(String(row.company_id)))
  }

  if (companyCode) {
    const { data: companyRows, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('code', companyCode)
      .limit(1)

    if (companyError) throw companyError

    const companyId = companyRows?.[0]?.id
    filteredIncomes = companyId ? filteredIncomes.filter((row) => row.company_id === companyId) : []
    filteredAdjustments = companyId ? filteredAdjustments.filter((row) => !row.company_id || row.company_id === companyId) : filteredAdjustments.filter((row) => !row.company_id)
    filteredDebts = companyId ? filteredDebts.filter((row) => !row.company_id || row.company_id === companyId) : filteredDebts.filter((row) => !row.company_id)
  }

  return {
    incomes: filteredIncomes,
    adjustments: filteredAdjustments,
    debts: filteredDebts,
  }
}

export async function listWeeklyTelegramOperators(
  supabase: AdminSupabaseClient,
) {
  const { data, error } = await supabase
    .from('operators')
    .select('id,name,short_name,telegram_chat_id,is_active,role,operator_profiles(*)')
    .eq('is_active', true)

  if (error) throw error

  const rows = ((data || []) as any[]).map((row) => ({
    ...row,
    full_name: row.operator_profiles?.[0]?.full_name || row.operator_profiles?.full_name || null,
  })) as MaybeRoleOperator[]

  return rows.filter(
    (operator) => !!operator.telegram_chat_id && (operator.role === 'admin' || operator.role === 'worker'),
  )
}
