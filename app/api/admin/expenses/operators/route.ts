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

    // Endpoint используется списком расходов И формой создания.
    // Пускаем по любому из прав: expenses.view ИЛИ expenses.create.
    const viewDenied = await requireCapability(access, 'expenses.view')
    if (viewDenied) {
      const createDenied = await requireCapability(access, 'expenses.create')
      if (createDenied) return createDenied as any
    }

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
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
    console.error('[expenses/operators GET] full error:', error)
    let json_dump = ''
    try { json_dump = JSON.stringify(error, Object.getOwnPropertyNames(error)) } catch {}
    return json({
      error: error?.message || 'Ошибка сервера',
      _diagnostic: {
        name: error?.name || null,
        message: String(error?.message || error || 'unknown'),
        code: error?.code || null,
        status: error?.status || error?.statusCode || null,
        details: error?.details || null,
        hint: error?.hint || null,
        full: json_dump.slice(0, 1500),
      },
    }, 500)
  }
}
