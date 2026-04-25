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
         operator:operator_id ( id, name, short_name )`,
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

    return json({ ok: true, data: { shifts: data || [] } })
  } catch (error) {
    return json(
      { error: 'admin-shifts-reports-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
