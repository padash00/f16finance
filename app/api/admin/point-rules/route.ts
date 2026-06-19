import { NextResponse } from 'next/server'

import { evaluatePointRules, type PointRuleAction, type PointRuleCondition } from '@/lib/domain/point-rules'
import { listOrganizationCompanyIds, resolveCompanyScope } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type RulePayload = {
  company_id?: string | null
  scope: string
  event: string
  name: string
  description?: string | null
  priority?: number
  is_active?: boolean
  stop_processing?: boolean
  conditions?: PointRuleCondition[]
  actions?: PointRuleAction[]
}

type Body =
  | { action: 'createRule'; payload: RulePayload }
  | { action: 'updateRule'; ruleId: string; payload: RulePayload }
  | { action: 'deleteRule'; ruleId: string }
  | { action: 'testRules'; scope: string; event: string; company_id?: string | null; context: Record<string, unknown> }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizePayload(payload: RulePayload) {
  return {
    company_id: payload.company_id || null,
    scope: String(payload.scope || '').trim().toLowerCase(),
    event: String(payload.event || '').trim().toLowerCase(),
    name: String(payload.name || '').trim(),
    description: payload.description?.trim() || null,
    priority: Number.isFinite(Number(payload.priority)) ? Math.trunc(Number(payload.priority)) : 100,
    is_active: payload.is_active !== false,
    stop_processing: payload.stop_processing === true,
    conditions: Array.isArray(payload.conditions) ? payload.conditions : [],
    actions: Array.isArray(payload.actions) ? payload.actions : [],
  }
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.scope) return 'scope обязателен'
  if (!payload.event) return 'event обязателен'
  if (!payload.name) return 'name обязателен'
  if (!Array.isArray(payload.conditions)) return 'conditions должен быть массивом'
  if (!Array.isArray(payload.actions) || payload.actions.length === 0) return 'actions должен содержать минимум 1 действие'

  for (const condition of payload.conditions) {
    if (!condition?.field || !condition?.operator) return 'Каждое условие должно содержать field и operator'
  }
  for (const action of payload.actions) {
    if (!action?.type) return 'Каждое действие должно содержать type'
  }
  return null
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const supabase = createAdminSupabaseClient()
    let query = supabase.from('point_rules').select('*').order('priority', { ascending: true }).order('created_at', { ascending: false })
    if (allowedCompanyIds) {
      if (allowedCompanyIds.length === 0) return json({ ok: true, data: [] })
      query = query.or(`company_id.is.null,company_id.in.(${allowedCompanyIds.map((id) => `"${id}"`).join(',')})`)
    }
    const { data, error } = await query
    if (error) throw error
    return json({ ok: true, data: data || [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-rules:get',
      message: error?.message || 'Point rules GET error',
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

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    const supabase = createAdminSupabaseClient()

    if (body.action === 'testRules') {
      const scope = String(body.scope || '').trim().toLowerCase()
      const event = String(body.event || '').trim().toLowerCase()
      if (!scope || !event) return json({ error: 'scope и event обязательны' }, 400)
      if (body.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: body.company_id,
        })
      }

      let query = supabase
        .from('point_rules')
        .select('*')
        .eq('scope', scope)
        .eq('event', event)
        .eq('is_active', true)
        .order('priority', { ascending: true })
      if (body.company_id) query = query.or(`company_id.is.null,company_id.eq."${body.company_id}"`)
      const { data, error } = await query
      if (error) throw error

      const rules = (data || []) as any[]
      const result = evaluatePointRules({
        rules: rules.map((row) => ({
          ...row,
          conditions: Array.isArray(row.conditions) ? row.conditions : [],
          actions: Array.isArray(row.actions) ? row.actions : [],
        })),
        context: body.context || {},
      })
      return json({ ok: true, data: { rulesCount: rules.length, ...result } })
    }

    if (body.action === 'createRule') {
      const capDenied = await requireStaffCapability(access, 'salary-rules.create')
      if (capDenied) return capDenied
      const payload = normalizePayload(body.payload)
      const payloadError = validatePayload(payload)
      if (payloadError) return json({ error: payloadError }, 400)
      if (payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: payload.company_id,
        })
      }
      const { data, error } = await supabase
        .from('point_rules')
        .insert([{ ...payload, created_by: user?.id || null, updated_by: user?.id || null }])
        .select('*')
        .single()
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'point-rule',
        entityId: String(data.id),
        action: 'create',
        payload: data,
      })
      return json({ ok: true, data })
    }

    if (body.action === 'updateRule') {
      const capDenied = await requireStaffCapability(access, 'salary-rules.edit')
      if (capDenied) return capDenied
      const payload = normalizePayload(body.payload)
      const payloadError = validatePayload(payload)
      if (payloadError) return json({ error: payloadError }, 400)
      const { data: current, error: currentError } = await supabase.from('point_rules').select('*').eq('id', body.ruleId).maybeSingle()
      if (currentError) throw currentError
      if (!current) return json({ error: 'Правило не найдено' }, 404)
      // Изоляция: существующее правило обязано быть в скоупе вызывающего (а не только
      // новое значение company_id). Глобальные (company_id=null) правила — суперадмин.
      if (current.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: current.company_id,
        })
      } else if (!access.isSuperAdmin) {
        return json({ error: 'forbidden' }, 403)
      }
      if (payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: payload.company_id,
        })
      }
      const { data, error } = await supabase
        .from('point_rules')
        .update({ ...payload, updated_by: user?.id || null })
        .eq('id', body.ruleId)
        .select('*')
        .single()
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'point-rule',
        entityId: String(data.id),
        action: 'update',
        payload: { previous: current, next: data },
      })
      return json({ ok: true, data })
    }

    if (body.action === 'deleteRule') {
      const capDenied = await requireStaffCapability(access, 'salary-rules.delete')
      if (capDenied) return capDenied
      const { data: current, error: currentError } = await supabase.from('point_rules').select('*').eq('id', body.ruleId).maybeSingle()
      if (currentError) throw currentError
      if (!current) return json({ error: 'Правило не найдено' }, 404)
      // Изоляция: глобальные (company_id=null) правила удаляет только суперадмин.
      if (current.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: current.company_id,
        })
      } else if (!access.isSuperAdmin) {
        return json({ error: 'forbidden' }, 403)
      }
      const { error } = await supabase.from('point_rules').delete().eq('id', body.ruleId)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'point-rule',
        entityId: body.ruleId,
        action: 'delete',
        payload: current,
      })
      return json({ ok: true })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-rules:post',
      message: error?.message || 'Point rules POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
