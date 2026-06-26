import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { computePurchasePlan } from '@/lib/server/purchase-plan'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Любой staff — расчёт только читает данные. Capability-гейты выше уже отсеяли.
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const companyId = String(url.searchParams.get('company_id') || '').trim()
    if (!companyId) return json({ error: 'company_id обязателен' }, 400)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    // null = супер-админ, не фильтруем. Иначе company_id должен быть в списке.
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)
    const supabase = createAdminSupabaseClient()

    const data = await computePurchasePlan(supabase, companyId)
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/purchase-plan/suggest GET',
      message: error?.message || 'Purchase plan suggest error',
    })
    return json({ error: error?.message || 'Не удалось рассчитать план закупа' }, 500)
  }
}
