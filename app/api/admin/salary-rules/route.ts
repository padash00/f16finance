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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeNumber(value: unknown) {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round(num)
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
  }
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
        return json({ ok: true, data: { rules: [], companies: [], history: [] } })
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
      if (allowedCompanyCodes && !allowedCompanyCodes.includes(payload.company_code)) {
        return json({ error: 'forbidden-company' }, 403)
      }
      const { data, error } = await supabase
        .from('operator_salary_rules')
        .insert([payload])
        .select('*')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-rule',
        entityId: String(data.id),
        action: 'create',
        payload: {
          company_code: data.company_code,
          shift_type: data.shift_type,
          base_per_shift: data.base_per_shift,
          senior_operator_bonus: data.senior_operator_bonus,
          senior_cashier_bonus: data.senior_cashier_bonus,
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'updateRule') {
      const payload = normalizePayload(body.payload)
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

      const { data, error } = await supabase
        .from('operator_salary_rules')
        .update(payload)
        .eq('id', body.ruleId)
        .select('*')
        .single()

      if (error) throw error

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
