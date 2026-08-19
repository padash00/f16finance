import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Места хранения: склады и витрины точек.
 *
 * Нужен экранам, где выбирают точку продажи, — сменному отчёту в первую
 * очередь. Раньше он брал этот список из базы сам, из браузера: фильтр по
 * организации оставался на стороне клиента, а право на раздел не спрашивалось.
 *
 * `?type=point_display` — только витрины, `?type=warehouse` — только склады.
 */
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store.view')
    if (denied) return denied

    const url = new URL(request.url)
    const type = url.searchParams.get('type')

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('inventory_locations')
      .select('id, name, company_id, location_type')
      .order('name')

    if (type) query = query.eq('location_type', type)
    if (scope.allowedCompanyIds) {
      if (scope.allowedCompanyIds.length === 0) return json({ data: [] })
      query = query.in('company_id', scope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ data: data || [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/locations GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
