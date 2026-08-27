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
  // Различаем null («фильтра нет», супер-админ) и [] («ничего»). Раньше обе
  // ситуации сводились к `length > 0`, поэтому пустой скоуп (пользователь без
  // организации) означал «все компании и все назначения всех тенантов».
  const scopedCompanyIds = options?.companyIds === undefined || options?.companyIds === null
    ? null
    : options.companyIds.filter(Boolean)
  const assignmentsQuery = supabase
    .from('operator_company_assignments')
    .select('operator_id,company_id,role_in_company,is_active')
    .eq('is_active', true)

  if (scopedCompanyIds) {
    assignmentsQuery.in('company_id', scopedCompanyIds)
  }

  const [
    { data: companies, error: companiesError },
    rules,
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    scopedCompanyIds
      ? supabase.from('companies').select('id,code,name').in('id', scopedCompanyIds)
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

  let seniorityTiersData: any[] = []
  let seniorityTiersError: any = null
  {
    const fullTierSelect = 'id,min_months,bonus_percent,is_active,effective_from'
    const result = await supabase
      .from('operator_salary_seniority_tiers')
      .select(fullTierSelect)
      .eq('is_active', true)
      .order('min_months', { ascending: true })

    if (result.error && isOptionalSalarySchemaError(result.error)) {
      // effective_from ещё не накатан — пробуем без него.
      const fallback = await supabase
        .from('operator_salary_seniority_tiers')
        .select('id,min_months,bonus_percent,is_active')
        .eq('is_active', true)
        .order('min_months', { ascending: true })
      seniorityTiersData = fallback.data || []
      seniorityTiersError = fallback.error
    } else {
      seniorityTiersData = result.data || []
      seniorityTiersError = result.error
    }
  }

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
  // null/undefined = «без фильтра» (супер-админ), [] = «ничего». Раньше пустой
  // скоуп проходил как «фильтра нет», и в расчёт попадали доходы/долги чужих точек.
  const companyIds = params.companyIds === undefined || params.companyIds === null
    ? null
    : params.companyIds.filter(Boolean)

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

  // Долг, удержанный из зарплаты, остаётся в расчёте и после закрытия — иначе
  // «к выплате» вырастает на его сумму, и выплаченная неделя снова становится
  // «Частично». Подробности — в `isDebtDeductedFromSalary`.
  const debtsBase = supabase
    .from('debts')
    .select('operator_id,amount,company_id,status,settled_via')
    .eq('operator_id', operatorId)
    .or('status.eq.active,settled_via.eq.salary')

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

  if (companyIds) {
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

/**
 * Данные для расчёта недели сразу по всем операторам.
 *
 * `listOperatorSalaryData` спрашивает базу про одного человека: доходы,
 * корректировки, долги — три запроса. Ведомость за неделю зовёт её на каждого
 * оператора, и три запроса превращаются в три десятка. Ответ базы быстрый, но
 * дорога до неё одна и та же для каждого, и складывается она в секунды
 * ожидания на пустом месте.
 *
 * Здесь те же три запроса, но на всех сразу — дальше расчёт разбирает строки
 * по людям уже в памяти.
 */
export async function listOperatorsSalaryData(
  supabase: AdminSupabaseClient,
  params: {
    operatorIds: string[]
    dateFrom: string
    dateTo: string
    weekStart?: string
    companyIds?: string[] | null
  },
) {
  const operatorIds = Array.from(new Set(params.operatorIds.filter(Boolean)))
  const empty = new Map<string, { incomes: SalaryIncomeRow[]; adjustments: SalaryAdjustmentRow[]; debts: SalaryDebtRow[] }>()
  if (operatorIds.length === 0) return empty

  const companyIds = params.companyIds === undefined || params.companyIds === null
    ? null
    : params.companyIds.filter(Boolean)

  // PostgREST молча отдаёт первую тысячу строк. Неделя на всех операторов в
  // тысячу укладывается с запасом, но «с запасом» — это не «никогда»: молча
  // потерянные строки означают недоплату, поэтому дочитываем страницами.
  const fetchAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
    const pageSize = 1000
    const rows: T[] = []
    for (let page = 0; page < 20; page += 1) {
      const { data, error } = await build(page * pageSize, page * pageSize + pageSize - 1)
      if (error) throw error
      const batch = (data || []) as T[]
      rows.push(...batch)
      if (batch.length < pageSize) break
    }
    return rows
  }

  const [incomes, adjustments, debts] = await Promise.all([
    fetchAll<SalaryIncomeRow>((from, to) =>
      supabase
        .from('incomes')
        .select('date,company_id,shift,cash_amount,kaspi_amount,online_amount,card_amount,operator_id,operator_name')
        .in('operator_id', operatorIds)
        .gte('date', params.dateFrom)
        .lte('date', params.dateTo)
        .order('id')
        .range(from, to),
    ),
    fetchAll<SalaryAdjustmentRow>((from, to) =>
      supabase
        .from('operator_salary_adjustments')
        .select('operator_id,amount,kind,company_id,status')
        .in('operator_id', operatorIds)
        .gte('date', params.dateFrom)
        .lte('date', params.dateTo)
        .order('id')
        .range(from, to),
    ),
    fetchAll<SalaryDebtRow>((from, to) => {
      // Тот же отбор, что в `listOperatorSalaryData`: удержанный из зарплаты
      // долг продолжает вычитаться.
      const base = supabase
        .from('debts')
        .select('operator_id,amount,company_id,status,settled_via')
        .in('operator_id', operatorIds)
        .or('status.eq.active,settled_via.eq.salary')
      const scoped = params.weekStart
        ? base.eq('week_start', params.weekStart)
        : base.gte('week_start', params.dateFrom).lte('week_start', params.dateTo)
      return scoped.order('id').range(from, to)
    }),
  ])

  const result = empty
  for (const id of operatorIds) result.set(id, { incomes: [], adjustments: [], debts: [] })

  // Фильтр по точкам — тот же, что в `listOperatorSalaryData`: у дохода точка
  // обязательна, у корректировки и долга может отсутствовать (общие для всех).
  for (const row of incomes) {
    const bucket = result.get(String(row.operator_id || ''))
    if (!bucket) continue
    if (companyIds && !companyIds.includes(String(row.company_id || ''))) continue
    bucket.incomes.push(row)
  }
  for (const row of adjustments) {
    const bucket = result.get(String(row.operator_id || ''))
    if (!bucket) continue
    if (companyIds && row.company_id && !companyIds.includes(String(row.company_id))) continue
    bucket.adjustments.push(row)
  }
  for (const row of debts) {
    const bucket = result.get(String(row.operator_id || ''))
    if (!bucket) continue
    if (companyIds && row.company_id && !companyIds.includes(String(row.company_id))) continue
    bucket.debts.push(row)
  }

  return result
}
