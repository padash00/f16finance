import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

async function loadCompanies(supabase: any, scoped: string[] | null) {
  let q = supabase.from('companies').select('id, name, code').order('name')
  if (scoped) q = q.in('id', scoped)
  const { data } = await q
  return (data || []) as Array<{ id: string; name: string; code: string | null }>
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const orgId = access.activeOrganization?.id || null
    const scope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const companies = await loadCompanies(supabase, scope.allowedCompanyIds)

    let storeCompanyId: string | null = null
    if (orgId) {
      const { data } = await supabase
        .from('store_settings')
        .select('store_company_id')
        .eq('organization_id', orgId)
        .maybeSingle()
      storeCompanyId = (data?.store_company_id as string | null) || null
    }

    return json({ ok: true, data: { store_company_id: storeCompanyId, companies, can_manage: canManage(access) } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/config.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

export async function PUT(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'no-organization' }, 400)

    const body = await request.json().catch(() => ({})) as { store_company_id?: string | null }
    const storeCompanyId = body.store_company_id || null

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const scope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })

    // Точка должна быть доступна организации
    if (storeCompanyId && scope.allowedCompanyIds && !scope.allowedCompanyIds.includes(storeCompanyId)) {
      return json({ error: 'forbidden-company' }, 403)
    }

    const { error } = await supabase
      .from('store_settings')
      .upsert({ organization_id: orgId, store_company_id: storeCompanyId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    if (error) throw error

    return json({ ok: true, data: { store_company_id: storeCompanyId } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/config.PUT', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
