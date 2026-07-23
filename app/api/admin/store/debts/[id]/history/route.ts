import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let query: any = supabase
      .from('supplier_debt_payments')
      .select('id, debt_id, paid_at, cash_amount, kaspi_amount, receipt_file_url, comment, expense_id, event_type, event_payload, created_at')
      .eq('debt_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
    // NEVER-pattern: не-супер без орг → нулевой uuid → чужой id не совпадёт.
    const scopeOrg = access.isSuperAdmin ? null : (access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    if (scopeOrg) {
      query = query.eq('organization_id', scopeOrg)
    }

    const { data, error } = await query
    if (error) throw error
    return json({ ok: true, data: { events: data || [] } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить историю долга' }, 500)
  }
}
