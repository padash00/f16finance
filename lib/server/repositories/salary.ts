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
  SalaryRuleVersion,
  SalarySeniorityTier,
} from '@/lib/domain/salary'

type MaybeRoleOperator = SalaryOperatorMeta & {
  role?: string | null
}

function isOptionalSalarySchemaError(error: any) {
  const message = String(error?.message || error?.details || '')
  return (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    /does not exist/i.test(message) ||
    /Could not find/i.test(message)
  )
}

async function listActiveSalaryRules(supabase: AdminSupabaseClient): Promise<SalaryRule[]> {
  const newSelect =
    'id,company_code,shift_type,base_per_shift,senior_operator_bonus,senior_cashier_bonus,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus,effective_from,base_per_shift_prev,low_turnover_threshold,low_turnover_base'

  const { data, error } = await supabase
    .from('operator_salary_rules')
    .select(newSelect)
    .eq('is_active', true)

  if (!error) return (data || []) as SalaryRule[]
  if (!isOptionalSalarySchemaError(error)) throw error

  const fallback = await supabase
    .from('operator_salary_rules')
    .select(
      'company_code,shift_type,base_per_shift,senior_operator_bonus,senior_cashier_bonus,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus',
    )
    .eq('is_active', true)

  if (fallback.error) throw fallback.error
  return (fallback.data || []) as SalaryRule[]
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
    rules,
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    companyIds.length > 0
      ? supabase.from('companies').select('id,code,name').in('id', companyIds)
      : supabase.from('companies').select('id,code,name'),
    listActiveSalaryRules(supabase),
    assignmentsQuery,
  ])

  if (companiesError) throw companiesError
  if (assignmentsError) throw assignmentsError

  const ruleIds = (rules || [])
    .map((rule: any) => Number(rule.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0)

  let versions: SalaryRuleVersion[] = []
  if (ruleIds.length > 0) {
    const fullSelect =
      'id,rule_id,effective_from,base_per_shift,low_turnover_threshold,low_turnover_base,senior_operator_bonus,senior_cashier_bonus,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus,comment,created_at'
    const { data, error } = await supabase
      .from('operator_salary_rule_versions')
      .select(fullSelect)
      .in('rule_id', ruleIds)
      .order('effective_from', { ascending: false })

    if (error) {
      if (!isOptionalSalarySchemaError(error)) {
        throw error
      }
      // Колонок снапшота ещё нет — пробуем минимальный select.
      const fallback = await supabase
        .from('operator_salary_rule_versions')
        .select('id,rule_id,effective_from,base_per_shift,low_turnover_threshold,low_turnover_base,comment,created_at')
        .in('rule_id', ruleIds)
        .order('effective_from', { ascending: false })
      if (fallback.error) {
        if (!isOptionalSalarySchemaError(fallback.error)) throw fallback.error
      } else {
        versions = (fallback.data || []) as SalaryRuleVersion[]
      }
    } else {
      versions = (data || []) as SalaryRuleVersion[]
    }
  }

  const { data: seniorityTiersData, error: seniorityTiersError } = await supabase
    .from('operator_salary_seniority_tiers')
    .select('id,min_months,bonus_percent,is_active')
    .eq('is_active', true)
    .order('min_months', { ascending: true })

  if (seniorityTiersError && !isOptionalSalarySchemaError(seniorityTiersError)) {
    throw seniorityTiersError
  }

  const versionsByRuleId = new Map<number, SalaryRuleVersion[]>()
  for (const version of versions) {
    const key = Number(version.rule_id || 0)
    if (!key) continue
    const list = versionsByRuleId.get(key) || []
    list.push(version)
    versionsByRuleId.set(key, list)
  }

  const rulesWithVersions = (rules || []).map((rule: any) => ({
    ...rule,
    versions: versionsByRuleId.get(Number(rule.id || 0)) || [],
  }))

  return {
    companies: (companies || []) as SalaryCompany[],
    rules: rulesWithVersions as SalaryRule[],
    assignments: (assignments || []) as SalaryOperatorCompanyAssignment[],
    seniorityTiers: (seniorityTiersError ? [] : seniorityTiersData || []) as SalarySeniorityTier[],
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
