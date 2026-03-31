import { NextResponse } from 'next/server'

import { assertOrganizationLimitAvailable } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type CreateCompanyBody = {
  name?: string | null
  code?: string | null
  organizationId?: string | null
  showInStructure?: boolean | null
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const activeOrganizationId = access.activeOrganization?.id || null
    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    let query = supabase
      .from('companies')
      .select('id, name, code')
      .order('name', { ascending: true })

    if (!access.isSuperAdmin && activeOrganizationId) {
      query = query.eq('organization_id', activeOrganizationId)
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

    const canManageCompanies = access.isSuperAdmin || access.staffRole === 'owner'
    if (!canManageCompanies) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as CreateCompanyBody | null
    const name = String(body?.name || '').trim()
    const code = String(body?.code || '').trim() || null
    const requestedOrganizationId = String(body?.organizationId || '').trim() || null
    const showInStructure = body?.showInStructure !== false

    if (!name) {
      return json({ error: 'Название точки обязательно' }, 400)
    }

    const targetOrganizationId = access.isSuperAdmin
      ? requestedOrganizationId || access.activeOrganization?.id || null
      : access.activeOrganization?.id || null

    if (!targetOrganizationId) {
      return json({ error: 'active-organization-required' }, 400)
    }

    if (!access.isSuperAdmin && targetOrganizationId !== access.activeOrganization?.id) {
      return json({ error: 'forbidden' }, 403)
    }

    await assertOrganizationLimitAvailable({
      activeOrganizationId: targetOrganizationId,
      isSuperAdmin: access.isSuperAdmin,
      activeSubscription: access.activeSubscription,
      key: 'companies',
    })

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const { data, error } = await supabase
      .from('companies')
      .insert([
        {
          name,
          code,
          organization_id: targetOrganizationId,
          show_in_structure: showInStructure,
        },
      ])
      .select('id, name, code, organization_id')
      .single()

    if (error) throw error

    return json({
      ok: true,
      company: {
        id: String((data as any).id),
        name: String((data as any).name || ''),
        code: (data as any).code || null,
        organizationId: String((data as any).organization_id || targetOrganizationId),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/companies POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
