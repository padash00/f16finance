import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { searchStore } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { json } from '@/lib/server/api-response'

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store.global_search')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const url = new URL(request.url)
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
    if (!q) return json({ ok: true, data: { query: '', results: [] } })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: new URL(request.url).searchParams.get('company_id') || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const scope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }

    const results = await searchStore(supabase as any, scope, q)
    return json({ ok: true, data: { query: q, results } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/global-search.GET',
      message: error?.message || 'Store global search GET error',
    })
    return json({ error: error?.message || 'Не удалось выполнить поиск по магазину' }, 500)
  }
}
