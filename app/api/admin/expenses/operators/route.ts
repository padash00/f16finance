import { NextResponse } from 'next/server'

import { listOrganizationOperatorIds } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'expenses.view')
    if (denied) return denied as any

    if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

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
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
