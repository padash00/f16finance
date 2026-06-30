import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope, listOrganizationOperatorIds } from '@/lib/server/organizations'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Returns static reference data for operator analytics page:
// companies, operators, operator_profiles, operator_documents
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'operator-analytics.view')
    if (denied) return denied

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    // Operator-id allowlist is only used to scope when company scoping is active.
    // When scope.allowedCompanyIds is null (legacy single-tenant / superadmin) we
    // must NOT apply any operator filter so behavior stays unchanged.
    const operatorIds = scope.allowedCompanyIds
      ? await listOrganizationOperatorIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          includeInactive: true,
        })
      : null

    let companiesQuery = supabase.from('companies').select('id,name,code').order('name')
    if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)

    let operatorsQuery = supabase.from('operators').select('id,name,short_name,is_active').order('name')
    if (operatorIds) operatorsQuery = operatorsQuery.in('id', operatorIds)

    let profilesQuery = supabase.from('operator_profiles').select('operator_id,photo_url,position,phone,email,hire_date')
    if (operatorIds) profilesQuery = profilesQuery.in('operator_id', operatorIds)

    let docsQuery = supabase.from('operator_documents').select('operator_id,expiry_date')
    if (operatorIds) docsQuery = docsQuery.in('operator_id', operatorIds)

    const [compRes, opsRes, profilesRes, docsRes] = await Promise.all([
      companiesQuery,
      operatorsQuery,
      profilesQuery,
      docsQuery,
    ])

    if (compRes.error) throw compRes.error
    if (opsRes.error) throw opsRes.error
    if (profilesRes.error) throw profilesRes.error
    if (docsRes.error) throw docsRes.error

    return json({
      ok: true,
      data: {
        companies: compRes.data || [],
        operators: opsRes.data || [],
        profiles: profilesRes.data || [],
        documents: docsRes.data || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operator-analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
