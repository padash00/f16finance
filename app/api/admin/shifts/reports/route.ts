import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
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
    // из первой продажи (point_sales.operator_id → operators table).
    const shiftsWithoutOperator = shifts.filter((s) => !s.operator || !s.operator.id)
    if (shiftsWithoutOperator.length > 0) {
      const shiftIds = shiftsWithoutOperator.map((s) => s.id)
      const { data: salesRows } = await supabase
        .from('point_sales')
        .select('shift_id, operator_id, sold_at, operator:operators!operator_id(id, full_name, short_name)')
        .in('shift_id', shiftIds)
        .not('operator_id', 'is', null)
        .order('sold_at', { ascending: true })

      const firstOperatorByShift = new Map<string, any>()
      for (const row of salesRows || []) {
        const sid = String((row as any).shift_id || '')
        if (!sid) continue
        if (!firstOperatorByShift.has(sid)) {
          const op = (row as any).operator
          const opObj = Array.isArray(op) ? op[0] : op
          if (opObj) firstOperatorByShift.set(sid, opObj)
        }
      }

      for (const s of shifts) {
        if ((!s.operator || !s.operator.id) && firstOperatorByShift.has(s.id)) {
          const op = firstOperatorByShift.get(s.id)
          s.operator = {
            id: op.id,
            full_name: op.full_name,
            short_name: op.short_name,
          }
          s.operator_source = 'sales' // помечаем что подтянуто из продаж
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
