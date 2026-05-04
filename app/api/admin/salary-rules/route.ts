import { NextResponse } from 'next/server'

import { listOrganizationCompanyCodes } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type ShiftType = 'day' | 'night'

type RulePayload = {
  company_code: string
  shift_type: ShiftType
  base_per_shift: number | null
  senior_operator_bonus: number | null
  senior_cashier_bonus: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
  is_active: boolean
  effective_from: string | null
  base_per_shift_prev: number | null
  low_turnover_threshold: number | null
  low_turnover_base: number | null
}

type RuleVersionPayload = {
  id?: string | null
  rule_id: number
  effective_from: string
  base_per_shift: number | null
  low_turnover_threshold: number | null
  low_turnover_base: number | null
  comment?: string | null
}

type SeniorityTierPayload = {
  id?: string | null
  min_months: number | null
  bonus_percent: number | null
  is_active?: boolean | null
}

type Body =
  | {
      action: 'createRule'
      payload: RulePayload
    }
  | {
      action: 'updateRule'
      ruleId: number
      payload: RulePayload
    }
  | {
      action: 'deleteRule'
      ruleId: number
    }
  | {
      action: 'upsertRuleVersion'
      payload: RuleVersionPayload
    }
  | {
      action: 'deleteRuleVersion'
      versionId: string
    }
  | {
      action: 'upsertSeniorityTier'
      payload: SeniorityTierPayload
    }
  | {
      action: 'deleteSeniorityTier'
      tierId: string
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeNumber(value: unknown) {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round(num)
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

function normalizeDate(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function normalizePayload(payload: RulePayload) {
  return {
    company_code: String(payload.company_code || '').trim(),
    shift_type: payload.shift_type,
    base_per_shift: normalizeNumber(payload.base_per_shift),
    senior_operator_bonus: normalizeNumber(payload.senior_operator_bonus),
    senior_cashier_bonus: normalizeNumber(payload.senior_cashier_bonus),
    threshold1_turnover: normalizeNumber(payload.threshold1_turnover),
    threshold1_bonus: normalizeNumber(payload.threshold1_bonus),
    threshold2_turnover: normalizeNumber(payload.threshold2_turnover),
    threshold2_bonus: normalizeNumber(payload.threshold2_bonus),
    is_active: !!payload.is_active,
    effective_from: normalizeDate(payload.effective_from),
    base_per_shift_prev: normalizeNumber(payload.base_per_shift_prev),
    low_turnover_threshold: normalizeNumber(payload.low_turnover_threshold),
    low_turnover_base: normalizeNumber(payload.low_turnover_base),
  }
}

function normalizeRuleVersionPayload(payload: RuleVersionPayload) {
  return {
    id: payload.id ? String(payload.id) : null,
    rule_id: Number(payload.rule_id || 0),
    effective_from: normalizeDate(payload.effective_from),
    base_per_shift: normalizeNumber(payload.base_per_shift),
    low_turnover_threshold: normalizeNumber(payload.low_turnover_threshold),
    low_turnover_base: normalizeNumber(payload.low_turnover_base),
    comment: String(payload.comment || '').trim() || null,
  }
}

function normalizeSeniorityTierPayload(payload: SeniorityTierPayload) {
  return {
    id: payload.id ? String(payload.id) : null,
    min_months: normalizeNumber(payload.min_months),
    bonus_percent: normalizeNumber(payload.bonus_percent),
    is_active: payload.is_active !== false,
  }
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.company_code) {
    return 'Укажите код компании'
  }
  if (payload.shift_type !== 'day' && payload.shift_type !== 'night') {
    return 'Некорректный тип смены'
  }
  if (payload.base_per_shift == null || payload.base_per_shift < 0) {
    return 'Оклад за смену должен быть 0 или больше'
  }
  if (payload.senior_operator_bonus != null && payload.senior_operator_bonus < 0) {
    return 'Бонус старшего оператора не может быть отрицательным'
  }
  if (payload.senior_cashier_bonus != null && payload.senior_cashier_bonus < 0) {
    return 'Бонус старшего кассира не может быть отрицательным'
  }
  if (payload.threshold1_turnover != null && payload.threshold1_turnover < 0) {
    return 'Порог 1 не может быть отрицательным'
  }
  if (payload.threshold2_turnover != null && payload.threshold2_turnover < 0) {
    return 'Порог 2 не может быть отрицательным'
  }
  if (payload.threshold1_bonus != null && payload.threshold1_bonus < 0) {
    return 'Бонус 1 не может быть отрицательным'
  }
  if (payload.threshold2_bonus != null && payload.threshold2_bonus < 0) {
    return 'Бонус 2 не может быть отрицательным'
  }
  if (payload.low_turnover_threshold != null && payload.low_turnover_threshold < 0) {
    return 'Порог условного оклада не может быть отрицательным'
  }
  if (payload.low_turnover_base != null && payload.low_turnover_base < 0) {
    return 'Условный оклад не может быть отрицательным'
  }

  if (payload.threshold1_bonus != null && payload.threshold1_turnover == null) {
    return 'Для бонуса 1 нужно указать порог 1'
  }
  if (payload.threshold2_bonus != null && payload.threshold2_turnover == null) {
    return 'Для бонуса 2 нужно указать порог 2'
  }
  if (
    payload.threshold1_turnover != null &&
    payload.threshold2_turnover != null &&
    payload.threshold2_turnover <= payload.threshold1_turnover
  ) {
    return 'Порог 2 должен быть больше порога 1'
  }
  if (
    (payload.low_turnover_threshold == null && payload.low_turnover_base != null) ||
    (payload.low_turnover_threshold != null && payload.low_turnover_base == null)
  ) {
    return 'Для условного оклада нужно указать и порог, и оклад'
  }

  return null
}

function validateRuleVersionPayload(payload: ReturnType<typeof normalizeRuleVersionPayload>) {
  if (!payload.rule_id) return 'Правило не найдено'
  if (!payload.effective_from) return 'Укажите дату вступления версии'
  if (payload.base_per_shift == null || payload.base_per_shift < 0) return 'Оклад версии должен быть 0 или больше'
  if (
    (payload.low_turnover_threshold == null && payload.low_turnover_base != null) ||
    (payload.low_turnover_threshold != null && payload.low_turnover_base == null)
  ) {
    return 'Для условного оклада версии нужно указать и порог, и оклад'
  }
  return null
}

function validateSeniorityTierPayload(payload: ReturnType<typeof normalizeSeniorityTierPayload>) {
  if (payload.min_months == null || payload.min_months < 0) return 'Стаж в месяцах должен быть 0 или больше'
  if (payload.bonus_percent == null || payload.bonus_percent < 0) return 'Процент стажа должен быть 0 или больше'
  if (payload.bonus_percent > 15) return 'Максимальная надбавка за стаж — 15%'
  return null
}

async function findDuplicateRule(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  params: { companyCode: string; shiftType: ShiftType; excludeId?: number },
) {
  let query = supabase
    .from('operator_salary_rules')
    .select('id')
    .eq('company_code', params.companyCode)
    .eq('shift_type', params.shiftType)
    .limit(1)

  if (params.excludeId != null) {
    query = query.neq('id', params.excludeId)
  }

  const { data, error } = await query
  if (error) throw error
  return Boolean(data?.length)
}

async function hasAnotherActiveRule(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  params: { companyCode: string; shiftType: ShiftType; excludeId: number },
) {
  const { data, error } = await supabase
    .from('operator_salary_rules')
    .select('id')
    .eq('company_code', params.companyCode)
    .eq('shift_type', params.shiftType)
    .eq('is_active', true)
    .neq('id', params.excludeId)
    .limit(1)

  if (error) throw error
  return Boolean(data?.length)
}

async function getRuleForMutation(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  ruleId: number,
  allowedCompanyCodes: string[] | null,
) {
  const { data, error } = await supabase
    .from('operator_salary_rules')
    .select('id,company_code,shift_type,base_per_shift,effective_from')
    .eq('id', ruleId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { error: json({ error: 'Правило не найдено' }, 404), rule: null as any }
  if (allowedCompanyCodes && !allowedCompanyCodes.includes(String(data.company_code || ''))) {
    return { error: json({ error: 'forbidden-company' }, 403), rule: null as any }
  }

  return { error: null, rule: data }
}

async function syncCurrentRuleVersion(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  rule: {
    id: number
    effective_from?: string | null
    base_per_shift?: number | null
    low_turnover_threshold?: number | null
    low_turnover_base?: number | null
  },
) {
  if (!rule.effective_from || rule.base_per_shift == null) return

  const { error } = await supabase
    .from('operator_salary_rule_versions')
    .upsert(
      [
        {
          rule_id: rule.id,
          effective_from: rule.effective_from,
          base_per_shift: rule.base_per_shift,
          low_turnover_threshold: rule.low_turnover_threshold ?? null,
          low_turnover_base: rule.low_turnover_base ?? null,
          comment: 'Обновлено из базового правила',
        },
      ],
      { onConflict: 'rule_id,effective_from' },
    )

  if (error && !isOptionalSalarySchemaError(error)) throw error
}

async function mapActorEmails(supabase: ReturnType<typeof createAdminSupabaseClient>, actorIds: string[]) {
  const actorEmailMap = new Map<string, string>()
  if (!actorIds.length || !hasAdminSupabaseCredentials()) return actorEmailMap

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error || !data?.users) return actorEmailMap

  for (const user of data.users) {
    if (user.id && user.email && actorIds.includes(user.id)) {
      actorEmailMap.set(user.id, user.email)
    }
  }

  return actorEmailMap
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const allowedCompanyCodes = await listOrganizationCompanyCodes({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let rulesQuery = supabase
      .from('operator_salary_rules')
      .select('*')
      .order('company_code', { ascending: true })
      .order('shift_type', { ascending: true })
    if (allowedCompanyCodes) {
      if (allowedCompanyCodes.length === 0) {
        return json({ ok: true, data: { rules: [], companies: [], history: [], ruleVersions: [], seniorityTiers: [] } })
      }
      rulesQuery = rulesQuery.in('company_code', allowedCompanyCodes)
    }

    let companiesQuery = supabase.from('companies').select('id,name,code').order('name')
    if (access.activeOrganization?.id && !access.isSuperAdmin) {
      companiesQuery = companiesQuery.eq('organization_id', access.activeOrganization.id)
    }

    const [rulesRes, companiesRes, historyRes] = await Promise.all([
      rulesQuery,
      companiesQuery,
      supabase
        .from('audit_log')
        .select('id, actor_user_id, entity_type, entity_id, action, payload, created_at')
        .eq('entity_type', 'operator-salary-rule')
        .order('created_at', { ascending: false })
        .limit(40),
    ])

    if (rulesRes.error) throw rulesRes.error
    if (companiesRes.error) throw companiesRes.error
    if (historyRes.error) throw historyRes.error

    const ruleIds = (rulesRes.data || [])
      .map((rule: any) => Number(rule.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)

    let ruleVersions: any[] = []
    if (ruleIds.length > 0) {
      const { data, error } = await supabase
        .from('operator_salary_rule_versions')
        .select('id,rule_id,effective_from,base_per_shift,low_turnover_threshold,low_turnover_base,comment,created_at')
        .in('rule_id', ruleIds)
        .order('rule_id', { ascending: true })
        .order('effective_from', { ascending: false })

      if (error) {
        if (!isOptionalSalarySchemaError(error)) throw error
      } else {
        ruleVersions = data || []
      }
    }

    const { data: seniorityTiersData, error: seniorityTiersError } = await supabase
      .from('operator_salary_seniority_tiers')
      .select('id,min_months,bonus_percent,is_active,created_at,updated_at')
      .order('min_months', { ascending: true })

    if (seniorityTiersError && !isOptionalSalarySchemaError(seniorityTiersError)) {
      throw seniorityTiersError
    }

    const actorIds = Array.from(
      new Set((historyRes.data || []).map((item: any) => item.actor_user_id).filter(Boolean)),
    ) as string[]
    const actorEmailMap =
      hasAdminSupabaseCredentials() ? await mapActorEmails(createAdminSupabaseClient(), actorIds) : new Map<string, string>()

    return json({
      ok: true,
      data: {
        rules: rulesRes.data || [],
        companies: companiesRes.data || [],
        ruleVersions,
        seniorityTiers: seniorityTiersError ? [] : seniorityTiersData || [],
        history: (allowedCompanyCodes
          ? (historyRes.data || []).filter((item: any) => allowedCompanyCodes.includes(String(item?.payload?.company_code || '')))
          : historyRes.data || []).map((item: any) => ({
          ...item,
          actor_email: item.actor_user_id ? actorEmailMap.get(item.actor_user_id) || null : null,
        })),
      },
    })
  } catch (error: any) {
    console.error('Salary rules GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary-rules:get',
      message: error?.message || 'Salary rules GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const body = (await req.json().catch(() => null)) as Body | null
    const allowedCompanyCodes = await listOrganizationCompanyCodes({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    if (!body?.action) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    if (body.action === 'createRule') {
      const payload = normalizePayload(body.payload)
      const validationError = validatePayload(payload)
      if (validationError) return json({ error: validationError }, 400)
      if (allowedCompanyCodes && !allowedCompanyCodes.includes(payload.company_code)) {
        return json({ error: 'forbidden-company' }, 403)
      }
      const duplicateExists = await findDuplicateRule(supabase, {
        companyCode: payload.company_code,
        shiftType: payload.shift_type,
      })
      if (duplicateExists) {
        return json({ error: 'Дубликат правила: для этой компании и смены уже есть запись' }, 400)
      }
      const { data, error } = await supabase
        .from('operator_salary_rules')
        .insert([payload])
        .select('*')
        .single()

      if (error) throw error
      await syncCurrentRuleVersion(supabase, data)

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule',
        entityId: String(data.id),
        action: 'create',
        payload: {
          company_code: data.company_code,
          shift_type: data.shift_type,
          base_per_shift: data.base_per_shift,
          effective_from: data.effective_from,
          base_per_shift_prev: data.base_per_shift_prev,
          low_turnover_threshold: data.low_turnover_threshold,
          low_turnover_base: data.low_turnover_base,
          senior_operator_bonus: data.senior_operator_bonus,
          senior_cashier_bonus: data.senior_cashier_bonus,
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'updateRule') {
      const payload = normalizePayload(body.payload)
      const validationError = validatePayload(payload)
      if (validationError) return json({ error: validationError }, 400)
      if (allowedCompanyCodes && !allowedCompanyCodes.includes(payload.company_code)) {
        return json({ error: 'forbidden-company' }, 403)
      }
      const { data: previous, error: previousError } = await supabase
        .from('operator_salary_rules')
        .select('*')
        .eq('id', body.ruleId)
        .maybeSingle()

      if (previousError) throw previousError
      if (!previous) return json({ error: 'Правило не найдено' }, 404)
      if (allowedCompanyCodes && !allowedCompanyCodes.includes(String(previous.company_code || ''))) {
        return json({ error: 'forbidden-company' }, 403)
      }
      const duplicateExists = await findDuplicateRule(supabase, {
        companyCode: payload.company_code,
        shiftType: payload.shift_type,
        excludeId: body.ruleId,
      })
      if (duplicateExists) {
        return json({ error: 'Дубликат правила: для этой компании и смены уже есть запись' }, 400)
      }
      if (previous.is_active && !payload.is_active) {
        const hasReplacement = await hasAnotherActiveRule(supabase, {
          companyCode: String(previous.company_code || ''),
          shiftType: previous.shift_type,
          excludeId: previous.id,
        })
        if (!hasReplacement) {
          return json(
            { error: 'Нельзя отключить последнее активное правило для этой компании и смены' },
            400,
          )
        }
      }

      const { data, error } = await supabase
        .from('operator_salary_rules')
        .update(payload)
        .eq('id', body.ruleId)
        .select('*')
        .single()

      if (error) throw error
      await syncCurrentRuleVersion(supabase, data)

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule',
        entityId: String(data.id),
        action: 'update',
        payload: {
          company_code: data.company_code,
          shift_type: data.shift_type,
          previous: {
            base_per_shift: previous.base_per_shift,
            senior_operator_bonus: previous.senior_operator_bonus,
            senior_cashier_bonus: previous.senior_cashier_bonus,
            threshold1_turnover: previous.threshold1_turnover,
            threshold1_bonus: previous.threshold1_bonus,
            threshold2_turnover: previous.threshold2_turnover,
            threshold2_bonus: previous.threshold2_bonus,
            effective_from: previous.effective_from,
            base_per_shift_prev: previous.base_per_shift_prev,
            low_turnover_threshold: previous.low_turnover_threshold,
            low_turnover_base: previous.low_turnover_base,
            is_active: previous.is_active,
          },
          next: {
            base_per_shift: data.base_per_shift,
            senior_operator_bonus: data.senior_operator_bonus,
            senior_cashier_bonus: data.senior_cashier_bonus,
            threshold1_turnover: data.threshold1_turnover,
            threshold1_bonus: data.threshold1_bonus,
            threshold2_turnover: data.threshold2_turnover,
            threshold2_bonus: data.threshold2_bonus,
            effective_from: data.effective_from,
            base_per_shift_prev: data.base_per_shift_prev,
            low_turnover_threshold: data.low_turnover_threshold,
            low_turnover_base: data.low_turnover_base,
            is_active: data.is_active,
          },
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'deleteRule') {
      const { data: previous, error: previousError } = await supabase
        .from('operator_salary_rules')
        .select('*')
        .eq('id', body.ruleId)
        .maybeSingle()

      if (previousError) throw previousError
      if (!previous) return json({ error: 'Правило не найдено' }, 404)
      if (allowedCompanyCodes && !allowedCompanyCodes.includes(String(previous.company_code || ''))) {
        return json({ error: 'forbidden-company' }, 403)
      }
      if (previous.is_active) {
        const hasReplacement = await hasAnotherActiveRule(supabase, {
          companyCode: String(previous.company_code || ''),
          shiftType: previous.shift_type,
          excludeId: previous.id,
        })
        if (!hasReplacement) {
          return json(
            { error: 'Нельзя удалить последнее активное правило для этой компании и смены' },
            400,
          )
        }
      }

      const versionsDelete = await supabase.from('operator_salary_rule_versions').delete().eq('rule_id', body.ruleId)
      if (versionsDelete.error && !isOptionalSalarySchemaError(versionsDelete.error)) throw versionsDelete.error

      const { error } = await supabase.from('operator_salary_rules').delete().eq('id', body.ruleId)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule',
        entityId: String(body.ruleId),
        action: 'delete',
        payload: {
          company_code: previous.company_code,
          shift_type: previous.shift_type,
          base_per_shift: previous.base_per_shift,
        },
      })

      return json({ ok: true })
    }

    if (body.action === 'upsertRuleVersion') {
      const payload = normalizeRuleVersionPayload(body.payload)
      const validationError = validateRuleVersionPayload(payload)
      if (validationError) return json({ error: validationError }, 400)

      const accessCheck = await getRuleForMutation(supabase, payload.rule_id, allowedCompanyCodes)
      if (accessCheck.error) return accessCheck.error

      const row = {
        rule_id: payload.rule_id,
        effective_from: payload.effective_from,
        base_per_shift: payload.base_per_shift,
        low_turnover_threshold: payload.low_turnover_threshold,
        low_turnover_base: payload.low_turnover_base,
        comment: payload.comment,
      }

      const result = payload.id
        ? await supabase
            .from('operator_salary_rule_versions')
            .update(row)
            .eq('id', payload.id)
            .select('*')
            .single()
        : await supabase
            .from('operator_salary_rule_versions')
            .upsert([row], { onConflict: 'rule_id,effective_from' })
            .select('*')
            .single()

      if (result.error) {
        if (isOptionalSalarySchemaError(result.error)) {
          return json({ error: 'Сначала выполните миграцию для версий оклада' }, 400)
        }
        throw result.error
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule-version',
        entityId: String(result.data.id),
        action: payload.id ? 'update' : 'create',
        payload: {
          ...row,
          company_code: accessCheck.rule.company_code,
          shift_type: accessCheck.rule.shift_type,
        },
      })

      return json({ ok: true, data: result.data })
    }

    if (body.action === 'deleteRuleVersion') {
      const versionId = String(body.versionId || '').trim()
      if (!versionId) return json({ error: 'versionId обязателен' }, 400)

      const { data: version, error: versionError } = await supabase
        .from('operator_salary_rule_versions')
        .select('*')
        .eq('id', versionId)
        .maybeSingle()

      if (versionError) {
        if (isOptionalSalarySchemaError(versionError)) {
          return json({ error: 'Сначала выполните миграцию для версий оклада' }, 400)
        }
        throw versionError
      }
      if (!version) return json({ error: 'Версия не найдена' }, 404)

      const accessCheck = await getRuleForMutation(supabase, Number(version.rule_id || 0), allowedCompanyCodes)
      if (accessCheck.error) return accessCheck.error

      const { error } = await supabase.from('operator_salary_rule_versions').delete().eq('id', versionId)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule-version',
        entityId: versionId,
        action: 'delete',
        payload: {
          previous: version,
          company_code: accessCheck.rule.company_code,
          shift_type: accessCheck.rule.shift_type,
        },
      })

      return json({ ok: true })
    }

    if (body.action === 'upsertSeniorityTier') {
      const payload = normalizeSeniorityTierPayload(body.payload)
      const validationError = validateSeniorityTierPayload(payload)
      if (validationError) return json({ error: validationError }, 400)

      const row = {
        min_months: payload.min_months,
        bonus_percent: payload.bonus_percent,
        is_active: payload.is_active,
        updated_at: new Date().toISOString(),
      }

      const result = payload.id
        ? await supabase
            .from('operator_salary_seniority_tiers')
            .update(row)
            .eq('id', payload.id)
            .select('*')
            .single()
        : await supabase
            .from('operator_salary_seniority_tiers')
            .upsert([row], { onConflict: 'min_months' })
            .select('*')
            .single()

      if (result.error) {
        if (isOptionalSalarySchemaError(result.error)) {
          return json({ error: 'Сначала выполните миграцию для правил стажа' }, 400)
        }
        throw result.error
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-seniority-tier',
        entityId: String(result.data.id),
        action: payload.id ? 'update' : 'create',
        payload: row,
      })

      return json({ ok: true, data: result.data })
    }

    if (body.action === 'deleteSeniorityTier') {
      const tierId = String(body.tierId || '').trim()
      if (!tierId) return json({ error: 'tierId обязателен' }, 400)

      const { data, error } = await supabase
        .from('operator_salary_seniority_tiers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', tierId)
        .select('*')
        .single()

      if (error) {
        if (isOptionalSalarySchemaError(error)) {
          return json({ error: 'Сначала выполните миграцию для правил стажа' }, 400)
        }
        throw error
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-seniority-tier',
        entityId: tierId,
        action: 'delete',
        payload: data,
      })

      return json({ ok: true })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    console.error('Salary rules POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary-rules:post',
      message: error?.message || 'Salary rules POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
