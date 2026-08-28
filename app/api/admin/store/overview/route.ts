import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { fetchStoreOverviewLists, fetchStoreOverviewMetrics } from '@/lib/server/repositories/inventory'
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
    const denied = await requireCapability(access, 'store.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: new URL(request.url).searchParams.get('company_id') || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    // Счётчики — для веб-страницы, списки — для нативного приложения владельца:
    // выпущенная сборка iOS разбирает locations/balances/requests/movements и
    // без них показывает пустой склад. Один ответ обслуживает обоих.
    const [metrics, lists] = await Promise.all([
      fetchStoreOverviewMetrics(supabase as any, inventoryScope),
      fetchStoreOverviewLists(supabase as any, inventoryScope),
    ])

    return json({ ok: true, data: { ...metrics, ...lists } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/overview.GET',
      message: error?.message || 'Store overview GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить центр магазина' }, 500)
  }
}
