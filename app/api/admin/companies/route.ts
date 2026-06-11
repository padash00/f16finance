import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { requireCapability } from '@/lib/server/capabilities'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    // Скоуп по организации. Пока LEGACY_SINGLE_TENANT_MODE=true → allowedCompanyIds=null → фильтр не применяется (no-op).
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('companies')
      .select('id, name, code')
      .order('name', { ascending: true })

    if (scope.allowedCompanyIds) {
      if (scope.allowedCompanyIds.length === 0) return json({ data: [] })
      query = query.in('id', scope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/companies GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'settings.manage_companies')
    if (denied) return denied

    const body = (await req.json().catch(() => null)) as { name?: string | null; code?: string | null; showInStructure?: boolean | null } | null
    const name = String(body?.name || '').trim()
    const showInStructure = body?.showInStructure !== false

    if (!name) {
      return json({ error: 'Название точки обязательно' }, 400)
    }

    // code NOT NULL: если не задан — генерируем из названия (латиница) или фолбэк.
    const code =
      String(body?.code || '').trim().toUpperCase() ||
      name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) ||
      `POINT${Date.now().toString().slice(-5)}`

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    // Привязываем точку к активной организации — иначе она «ничья» и не попадёт
    // в скоуп организации (новый клиент не увидит свою же точку).
    const organizationId = access.activeOrganization?.id || null

    const { data, error } = await supabase
      .from('companies')
      .insert([{ name, code, show_in_structure: showInStructure, organization_id: organizationId }])
      .select('id, name, code')
      .single()

    if (error) throw error

    return json({
      ok: true,
      company: {
        id: String((data as any).id),
        name: String((data as any).name || ''),
        code: (data as any).code || null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/companies POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
