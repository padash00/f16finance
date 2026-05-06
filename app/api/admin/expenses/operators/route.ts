import { NextResponse } from 'next/server'

import { listOrganizationOperatorIds } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    // Этот endpoint используется в форме создания расхода. Любой
    // авторизованный staff/super-admin может получить список операторов.
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'service_role_missing' }, 500)
    }
    const supabase = createAdminSupabaseClient()

    let query = supabase
      .from('operators')
      .select('id, name, short_name, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true })

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

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/operators GET',
      message: error?.message || 'expense operators list failed',
    })
    console.error('[expenses/operators GET]', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
