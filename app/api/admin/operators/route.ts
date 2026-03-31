import { NextResponse } from 'next/server'

import { ensureOrganizationOperatorAccess, listOrganizationOperatorIds } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body =
  | {
      action: 'createOperator'
      payload: {
        name: string
        full_name?: string | null
        short_name?: string | null
        position?: string | null
        phone?: string | null
        email?: string | null
      }
    }
  | {
      action: 'updateOperator'
      operatorId: string
      payload: {
        name: string
        full_name?: string | null
        short_name?: string | null
        position?: string | null
        phone?: string | null
        email?: string | null
      }
    }
  | {
      action: 'toggleOperatorActive'
      operatorId: string
      is_active: boolean
    }
  | {
      action: 'deleteOperator'
      operatorId: string
    }
  | {
      action: 'bulkDeleteOperators'
      operatorIds: string[]
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operators')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const activeOnly = url.searchParams.get('active_only') === 'true'

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    let query = supabase
      .from('operators')
      .select('id, name, short_name, is_active, role, telegram_chat_id, created_at, operator_profiles(full_name, phone, email, hire_date, position, photo_url)')
      .order('name', { ascending: true })

    if (activeOnly) query = query.eq('is_active', true)
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (allowedOperatorIds) {
      if (allowedOperatorIds.length === 0) return json({ data: [] })
      query = query.in('id', allowedOperatorIds)
    }

    const { data, error } = await query
    if (error) throw error
    const operators = (data || []) as any[]
    const operatorIds = operators.map((item) => String(item.id || '')).filter(Boolean)

    if (operatorIds.length === 0) {
      return json({ data: [] })
    }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0]

    const [authResult, incomesResult, debtsResult, bonusesResult] = await Promise.all([
      supabase
        .from('operator_auth')
        .select('operator_id, user_id, username, role, is_active, last_login')
        .in('operator_id', operatorIds),
      supabase
        .from('incomes')
        .select('operator_id, cash_amount, kaspi_amount, online_amount, card_amount')
        .in('operator_id', operatorIds)
        .gte('date', dateStr),
      supabase
        .from('debts')
        .select('operator_id, amount')
        .in('operator_id', operatorIds)
        .eq('status', 'active'),
      supabase
        .from('operator_salary_adjustments')
        .select('operator_id, amount')
        .in('operator_id', operatorIds)
        .eq('kind', 'bonus')
        .gte('date', dateStr),
    ])

    if (authResult.error) throw authResult.error
    if (incomesResult.error) throw incomesResult.error
    if (debtsResult.error) throw debtsResult.error
    if (bonusesResult.error) throw bonusesResult.error

    const authByOperatorId = new Map(
      ((authResult.data || []) as any[]).map((row) => [
        String(row.operator_id || ''),
        {
          user_id: row.user_id || null,
          username: row.username || null,
          role: row.role || 'operator',
          is_active: row.is_active !== false,
          last_login: row.last_login || null,
        },
      ]),
    )

    const statsByOperatorId = new Map<
      string,
      { totalShifts: number; totalTurnover: number; avgPerShift: number; totalDebts: number; totalBonuses: number }
    >()

    for (const operatorId of operatorIds) {
      statsByOperatorId.set(operatorId, {
        totalShifts: 0,
        totalTurnover: 0,
        avgPerShift: 0,
        totalDebts: 0,
        totalBonuses: 0,
      })
    }

    for (const row of (incomesResult.data || []) as any[]) {
      const stats = statsByOperatorId.get(String(row.operator_id || ''))
      if (!stats) continue
      stats.totalShifts += 1
      stats.totalTurnover +=
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.online_amount || 0) +
        Number(row.card_amount || 0)
    }

    for (const row of (debtsResult.data || []) as any[]) {
      const stats = statsByOperatorId.get(String(row.operator_id || ''))
      if (!stats) continue
      stats.totalDebts += Number(row.amount || 0)
    }

    for (const row of (bonusesResult.data || []) as any[]) {
      const stats = statsByOperatorId.get(String(row.operator_id || ''))
      if (!stats) continue
      stats.totalBonuses += Number(row.amount || 0)
    }

    for (const stats of statsByOperatorId.values()) {
      stats.avgPerShift = stats.totalShifts > 0 ? stats.totalTurnover / stats.totalShifts : 0
    }

    const merged = operators.map((operator) => {
      const operatorId = String(operator.id || '')
      return {
        ...operator,
        auth: authByOperatorId.get(operatorId) || {
          user_id: null,
          username: null,
          role: operator.role || 'operator',
          is_active: operator.is_active !== false,
          last_login: null,
        },
        stats: statsByOperatorId.get(operatorId) || {
          totalShifts: 0,
          totalTurnover: 0,
          avgPerShift: 0,
          totalDebts: 0,
          totalBonuses: 0,
        },
      }
    })

    return json({ data: merged })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operators GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operators')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'createOperator') {
      if (!body.payload.name?.trim()) return json({ error: 'Имя оператора обязательно' }, 400)

      const { data: createdOperator, error: operatorError } = await supabase
        .from('operators')
        .insert([
          {
            name: body.payload.name.trim(),
            short_name: body.payload.short_name?.trim() || null,
            is_active: true,
          },
        ])
        .select('*')
        .single()

      if (operatorError) throw operatorError

      const { error: profileError } = await supabase.from('operator_profiles').insert([
        {
          operator_id: createdOperator.id,
          full_name: body.payload.full_name?.trim() || null,
          position: body.payload.position?.trim() || null,
          phone: body.payload.phone?.trim() || null,
          email: body.payload.email?.trim() || null,
        },
      ])

      if (profileError) throw profileError

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator',
        entityId: String(createdOperator.id),
        action: 'create',
        payload: {
          name: createdOperator.name,
          short_name: createdOperator.short_name,
          full_name: body.payload.full_name?.trim() || null,
        },
      })

      return json({ ok: true, data: createdOperator })
    }

    if (body.action === 'updateOperator') {
      if (!body.operatorId?.trim()) return json({ error: 'operatorId обязателен' }, 400)
      if (!body.payload.name?.trim()) return json({ error: 'Имя оператора обязательно' }, 400)
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { error: operatorError } = await supabase
        .from('operators')
        .update({
          name: body.payload.name.trim(),
          short_name: body.payload.short_name?.trim() || null,
        })
        .eq('id', body.operatorId)

      if (operatorError) throw operatorError

      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('operator_profiles')
        .select('id')
        .eq('operator_id', body.operatorId)
        .maybeSingle()

      if (existingProfileError && existingProfileError.code !== 'PGRST116') throw existingProfileError

      const profilePayload = {
        full_name: body.payload.full_name?.trim() || null,
        position: body.payload.position?.trim() || null,
        phone: body.payload.phone?.trim() || null,
        email: body.payload.email?.trim() || null,
      }

      if (existingProfile?.id) {
        const { error: profileError } = await supabase
          .from('operator_profiles')
          .update(profilePayload)
          .eq('operator_id', body.operatorId)

        if (profileError) throw profileError
      } else {
        const { error: profileError } = await supabase.from('operator_profiles').insert([
          {
            operator_id: body.operatorId,
            ...profilePayload,
          },
        ])

        if (profileError) throw profileError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator',
        entityId: String(body.operatorId),
        action: 'update',
        payload: profilePayload,
      })

      return json({ ok: true })
    }

    if (body.action === 'toggleOperatorActive') {
      if (!body.operatorId?.trim()) return json({ error: 'operatorId обязателен' }, 400)
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { error } = await supabase
        .from('operators')
        .update({ is_active: body.is_active })
        .eq('id', body.operatorId)

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator',
        entityId: String(body.operatorId),
        action: body.is_active ? 'activate' : 'deactivate',
        payload: { is_active: body.is_active },
      })

      return json({ ok: true })
    }

    if (body.action === 'deleteOperator') {
      if (!body.operatorId?.trim()) return json({ error: 'operatorId обязателен' }, 400)
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { error } = await supabase.from('operators').delete().eq('id', body.operatorId)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator',
        entityId: String(body.operatorId),
        action: 'delete',
      })

      return json({ ok: true })
    }

    if (body.action === 'bulkDeleteOperators') {
      const ids = Array.isArray(body.operatorIds) ? body.operatorIds.filter(Boolean) : []
      if (ids.length === 0) return json({ error: 'Нужен список операторов' }, 400)
      if (ids.length > 100) return json({ error: 'Максимум 100 операторов за один запрос' }, 400)

      for (const operatorId of ids) {
        await ensureOrganizationOperatorAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          operatorId,
        })
      }

      const { error } = await supabase.from('operators').delete().in('id', ids)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator',
        entityId: 'bulk',
        action: 'bulk-delete',
        payload: { ids, count: ids.length },
      })

      return json({ ok: true, count: ids.length })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    console.error('Admin operators route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operators',
      message: error?.message || 'Admin operators route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
