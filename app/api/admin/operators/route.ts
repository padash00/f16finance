import { NextResponse } from 'next/server'

import {
  ensureOrganizationOperatorAccess,
  listOrganizationOperatorIds,
  resolveCompanyScope,
} from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
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
  | {
      action: 'linkStaff'
      operatorId: string
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

    // Оборот и долги режем ещё и по точкам: оператор может числиться в двух
    // организациях (ensureOrganizationOperatorAccess признаёт его «своим» по
    // назначению), и тогда в карточку попадали суммы чужой точки.
    const operatorCompanyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    let incomesQuery = supabase
      .from('incomes')
      .select('operator_id, cash_amount, kaspi_amount, online_amount, card_amount')
      .in('operator_id', operatorIds)
      .gte('date', dateStr)
    let debtsQuery = supabase
      .from('debts')
      .select('operator_id, amount')
      .in('operator_id', operatorIds)
      .eq('status', 'active')
    if (operatorCompanyScope.allowedCompanyIds) {
      incomesQuery = incomesQuery.in('company_id', operatorCompanyScope.allowedCompanyIds)
      debtsQuery = debtsQuery.in('company_id', operatorCompanyScope.allowedCompanyIds)
    }

    const [authResult, incomesResult, debtsResult, bonusesResult, staffLinksResult] = await Promise.all([
      supabase
        .from('operator_auth')
        .select('operator_id, user_id, username, role, is_active, last_login')
        .in('operator_id', operatorIds),
      incomesQuery,
      debtsQuery,
      supabase
        .from('operator_salary_adjustments')
        .select('operator_id, amount')
        .in('operator_id', operatorIds)
        .eq('kind', 'bonus')
        .gte('date', dateStr),
      // Карточка сотрудника: без неё смена открывается без хозяина, а
      // подтверждения регламентов не пишутся вовсе — они привязаны к карточке.
      supabase.from('operator_staff_links').select('operator_id, staff_id').in('operator_id', operatorIds),
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

    const staffIdByOperator = new Map(
      (((staffLinksResult as any).data as any[]) || [])
        .filter((row) => row?.operator_id && row?.staff_id)
        .map((row) => [String(row.operator_id), String(row.staff_id)]),
    )

    const merged = operators.map((operator) => {
      const operatorId = String(operator.id || '')
      return {
        ...operator,
        staff_id: staffIdByOperator.get(operatorId) || null,
        has_staff_link: staffIdByOperator.has(operatorId),
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
      const denied = await requireCapability(access, 'operators.create')
      if (denied) return denied as any
      if (!body.payload.name?.trim()) return json({ error: 'Имя оператора обязательно' }, 400)
      // Без организации оператор создавался «ничьим» (organization_id = null).
      // Такую запись потом может подобрать любая организация, назначив её на
      // свою точку (fallback по назначениям в ensureOrganizationOperatorAccess).
      if (!access.activeOrganization?.id && !access.isSuperAdmin) {
        return json({ error: 'Требуется активная организация' }, 400)
      }

      const { data: createdOperator, error: operatorError } = await supabase
        .from('operators')
        .insert([
          {
            name: body.payload.name.trim(),
            short_name: body.payload.short_name?.trim() || null,
            is_active: true,
            // Привязка к организации — иначе оператор «ничей» и не виден своей орг.
            organization_id: access.activeOrganization?.id || null,
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

    /**
     * Завести оператору карточку сотрудника и связать с ней.
     *
     * Без карточки система теряет человека в трёх местах сразу: смена
     * открывается без хозяина, подтверждения регламентов не пишутся (они
     * привязаны к карточке), и в дисциплине его нет. Со стороны это выглядит
     * как «кнопка не работает» — так и всплыло, на подтверждении статьи.
     *
     * Карточка заводится минимальная: имя, должность и точка. Оклад и роль —
     * это уже повышение, для него есть отдельный маршрут, и подмешивать его
     * сюда значит менять человеку условия одним нажатием.
     */
    if (body.action === 'linkStaff') {
      const denied = await requireCapability(access, 'operators.edit')
      if (denied) return denied as any

      const operatorId = String(body.operatorId || '').trim()
      if (!operatorId) return json({ error: 'operatorId обязателен' }, 400)

      try {
        await ensureOrganizationOperatorAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          operatorId,
        })
      } catch {
        return json({ error: 'forbidden' }, 403)
      }

      const { data: existing } = await supabase
        .from('operator_staff_links')
        .select('staff_id')
        .eq('operator_id', operatorId)
        .maybeSingle()

      if (existing?.staff_id) {
        return json({ ok: true, data: { staff_id: existing.staff_id, created: false } })
      }

      const [{ data: operator }, { data: profile }] = await Promise.all([
        supabase.from('operators').select('id, name, short_name, is_active, role').eq('id', operatorId).maybeSingle(),
        supabase.from('operator_profiles').select('full_name, phone, email, position').eq('operator_id', operatorId).maybeSingle(),
      ])

      if (!operator) return json({ error: 'Оператор не найден' }, 404)

      const { data: staffRow, error: staffError } = await supabase
        .from('staff')
        .insert([
          {
            full_name: (profile as any)?.full_name?.trim() || (operator as any).name,
            short_name: (operator as any).short_name?.trim() || null,
            role: 'other',
            position: (profile as any)?.position?.trim() || 'Оператор',
            phone: (profile as any)?.phone?.trim() || null,
            email: (profile as any)?.email?.trim() || null,
            is_active: (operator as any).is_active !== false,
            organization_id: access.activeOrganization?.id || null,
          },
        ])
        .select('id')
        .single()

      if (staffError) throw staffError

      const { error: linkError } = await supabase.from('operator_staff_links').insert([
        {
          operator_id: operatorId,
          staff_id: (staffRow as any).id,
          assigned_role: 'other',
          assigned_by: access.user?.id || null,
        },
      ])

      if (linkError) throw linkError

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'operator',
        entityId: operatorId,
        action: 'staff-link.create',
        payload: { staff_id: (staffRow as any).id },
      })

      return json({ ok: true, data: { staff_id: (staffRow as any).id, created: true } })
    }

    if (body.action === 'updateOperator') {
      const denied = await requireCapability(access, 'operators.edit')
      if (denied) return denied as any
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
      const denied = await requireCapability(access, 'operators.toggle_active')
      if (denied) return denied as any
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
      const denied = await requireCapability(access, 'operators.delete')
      if (denied) return denied as any
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
      const denied = await requireCapability(access, 'operators.bulk_delete')
      if (denied) return denied as any
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
