import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const status = (url.searchParams.get('status') || 'closed').trim()
    const companyId = url.searchParams.get('company_id') || null
    const operatorId = url.searchParams.get('operator_id') || null
    const dateFrom = url.searchParams.get('date_from') || null
    const dateTo = url.searchParams.get('date_to') || null
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

    let query = supabase
      .from('point_shifts')
      .select(
        `id, company_id, organization_id, operator_id, point_device_id,
         status, shift_type, opened_at, closed_at,
         opening_cash, closing_cash, closing_kaspi, totals_json,
         z_report_url, x_report_url, handover_from_shift_id,
         company:company_id ( id, name, code ),
         operator:staff!operator_id ( id, full_name, short_name )`,
      )
      .order('opened_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (companyId) query = query.eq('company_id', companyId)
    if (operatorId) query = query.eq('operator_id', operatorId)
    if (dateFrom) query = query.gte('opened_at', dateFrom)
    if (dateTo) query = query.lte('opened_at', dateTo)

    if (companyScope.allowedCompanyIds) {
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    const shifts = (data || []) as any[]

    // Fallback: для смен без staff-оператора подтягиваем оператора-кассира
    // (а) из первой продажи смены через shift_id
    // (б) если shift_id не проставлен в продажах — через окно времени смены и компанию
    const shiftsWithoutOperator = shifts.filter((s) => !s.operator || !s.operator.id)
    if (shiftsWithoutOperator.length > 0) {
      const shiftIds = shiftsWithoutOperator.map((s) => s.id)
      const firstOperatorIdByShift = new Map<string, string>()

      // Способ A: одной выборкой — без вложенного join, только operator_id
      const { data: salesByShift } = await supabase
        .from('point_sales')
        .select('shift_id, operator_id, sold_at')
        .in('shift_id', shiftIds)
        .not('operator_id', 'is', null)
        .order('sold_at', { ascending: true })

      for (const row of salesByShift || []) {
        const sid = String((row as any).shift_id || '')
        const opId = (row as any).operator_id
        if (!sid || !opId) continue
        if (!firstOperatorIdByShift.has(sid)) firstOperatorIdByShift.set(sid, String(opId))
      }

      // Способ B: для оставшихся — параллельно через company_id + временное окно
      const stillMissing = shiftsWithoutOperator.filter(
        (s) => !firstOperatorIdByShift.has(s.id) && s.company_id && s.opened_at,
      )
      if (stillMissing.length > 0) {
        const fallback = await Promise.all(
          stillMissing.map((s) =>
            supabase
              .from('point_sales')
              .select('operator_id')
              .eq('company_id', s.company_id)
              .gte('sold_at', s.opened_at)
              .lte('sold_at', s.closed_at || new Date().toISOString())
              .not('operator_id', 'is', null)
              .order('sold_at', { ascending: true })
              .limit(1)
              .maybeSingle()
              .then((res) => ({ shiftId: s.id, opId: (res?.data as any)?.operator_id || null })),
          ),
        )
        for (const r of fallback) {
          if (r.opId) firstOperatorIdByShift.set(r.shiftId, String(r.opId))
        }
      }

      // Одной выборкой подтянуть имена операторов
      const operatorIds = Array.from(new Set(Array.from(firstOperatorIdByShift.values())))
      if (operatorIds.length > 0) {
        const { data: opsData } = await supabase
          .from('operators')
          .select('id, full_name, short_name')
          .in('id', operatorIds)
        const operatorById = new Map<string, any>(
          (opsData || []).map((o: any) => [String(o.id), o]),
        )
        for (const s of shifts) {
          if (s.operator && s.operator.id) continue
          const opId = firstOperatorIdByShift.get(s.id)
          if (!opId) continue
          const op = operatorById.get(opId)
          if (op) {
            s.operator = { id: op.id, full_name: op.full_name, short_name: op.short_name }
            s.operator_source = 'sales'
          }
        }
      }
    }

    return json({ ok: true, data: { shifts } })
  } catch (error) {
    return json(
      { error: 'admin-shifts-reports-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
