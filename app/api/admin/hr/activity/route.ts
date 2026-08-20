/**
 * GET /api/admin/hr/activity?kind=operator&id=...
 *
 * Возвращает ленту активности конкретного сотрудника:
 *   • Последние смены (для оператора)
 *   • Последние выплаты (для staff/operator с долгом)
 *   • Записи audit_log (события HR)
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope, ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { requireAddon } from '@/lib/server/entitlements'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const addonDenied = await requireAddon(access, 'addon.hr')
    if (addonDenied) return addonDenied
    const denied = await requireCapability(access, 'hr.view')
    if (denied) return denied as any

    const url = new URL(req.url)
    const kind = url.searchParams.get('kind')
    const id = String(url.searchParams.get('id') || '').trim()
    if (kind !== 'staff' && kind !== 'operator') return json({ error: 'kind required' }, 400)
    if (!id) return json({ error: 'id required' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Изоляция: id (operator/staff) обязан принадлежать организации вызывающего,
    // иначе передав чужой id читаются долги/зарплаты/события сотрудника другой орг.
    try {
      if (kind === 'operator') {
        await ensureOrganizationOperatorAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          operatorId: id,
        })
      } else {
        await ensureOrganizationStaffAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          staffId: id,
        })
      }
    } catch {
      return json({ error: 'forbidden', code: 'entity-not-in-organization' }, 403)
    }

    // Четыре куска карточки — события, смены, долги, выплаты — независимы
    // друг от друга, а читались по очереди. Карточку открывают на человеке,
    // и ждать четыре дороги до базы вместо одной незачем.
    const eventsTask = (async () => {
      const auditRes = await supabase
        .from('audit_log')
        .select('id, action, payload, created_at, actor_user_id')
        .eq('entity_type', kind)
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(50)

      // Имена авторов — только они и зависят от событий.
      const actorIds = Array.from(new Set((auditRes.data || []).map((r: any) => r.actor_user_id).filter(Boolean)))
      const actors: Record<string, string> = {}
      if (actorIds.length > 0) {
        const { data } = await supabase
          .from('staff')
          .select('user_id, full_name, short_name')
          .in('user_id', actorIds)
        for (const r of (data || []) as any[]) {
          if (r.user_id) actors[String(r.user_id)] = String(r.full_name || r.short_name || '')
        }
      }

      return (auditRes.data || []).map((row: any) => ({
        id: String(row.id),
        type: 'audit' as const,
        action: String(row.action),
        payload: row.payload || null,
        created_at: row.created_at,
        actor_name: row.actor_user_id ? actors[String(row.actor_user_id)] || null : null,
      }))
    })()

    // Для оператора: последние смены. Имя нужно, чтобы их найти, — эта пара
    // остаётся последовательной.
    const shiftsTask = (async () => {
      if (kind !== 'operator') return [] as any[]
      const { data: opRow } = await supabase
        .from('operators')
        .select('name, short_name')
        .eq('id', id)
        .maybeSingle()
      const name = (opRow as any)?.short_name || (opRow as any)?.name
      if (!name) return [] as any[]

      let shiftsQuery = supabase
        .from('shifts')
        .select('id, date, shift_type, company_id')
        .eq('operator_name', name)
      if (scope.allowedCompanyIds) {
        shiftsQuery = shiftsQuery.in('company_id', scope.allowedCompanyIds)
      }
      const { data: shiftsData } = await shiftsQuery
        .order('date', { ascending: false })
        .limit(15)
      return (shiftsData || []) as any[]
    })()

    const debtsTask = (async () => {
      if (kind !== 'operator') return [] as any[]
      const { data } = await supabase
        .from('debts')
        .select('id, amount, comment, week_start, status, created_at')
        .eq('operator_id', id)
        .order('created_at', { ascending: false })
        .limit(10)
      return (data || []) as any[]
    })()

    const paymentsTask = (async () => {
      if (kind !== 'staff') return [] as any[]
      const { data } = await supabase
        .from('staff_salary_payments')
        .select('id, pay_date, slot, amount, comment')
        .eq('staff_id', id)
        .order('pay_date', { ascending: false })
        .limit(10)
      return (data || []) as any[]
    })()

    const [events, shifts, debts, payments] = await Promise.all([
      eventsTask,
      shiftsTask,
      debtsTask,
      paymentsTask,
    ])

    return json({ events, shifts, debts, payments })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/activity GET',
      message: error?.message || 'activity failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
