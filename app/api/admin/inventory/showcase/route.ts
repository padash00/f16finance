import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { ensureInventoryCompanyAccess } from '@/lib/server/repositories/inventory'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => null)) as { company_id?: string; enabled?: boolean } | null
    const companyId = String(body?.company_id || '').trim()
    const enabled = Boolean(body?.enabled)
    if (!companyId) return json({ error: 'company-id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }

    await ensureInventoryCompanyAccess(supabase as any, companyId, inventoryScope)

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name, code, organization_id')
      .eq('id', companyId)
      .maybeSingle()

    if (companyError) throw companyError
    if (!company?.id) return json({ error: 'company-not-found' }, 404)

    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      if (String(company.organization_id || '') !== String(access.activeOrganization.id)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    if (!company.organization_id) {
      return json({ error: 'company-organization-missing' }, 400)
    }

    if (enabled) {
      const { data: existing, error: locErr } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('company_id', companyId)
        .eq('location_type', 'point_display')
        .maybeSingle()

      if (locErr) throw locErr

      if (existing?.id) {
        const { error: upErr } = await supabase
          .from('inventory_locations')
          .update({
            is_active: true,
            name: company.name,
            code: company.code,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        if (upErr) throw upErr
      } else {
        const { error: insErr } = await supabase.from('inventory_locations').insert({
          company_id: companyId,
          organization_id: company.organization_id,
          name: company.name,
          code: company.code,
          location_type: 'point_display',
          is_active: true,
        })

        if (insErr) throw insErr
      }
    } else {
      const { error: offErr } = await supabase
        .from('inventory_locations')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('location_type', 'point_display')

      if (offErr) throw offErr
    }

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory/showcase.POST',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
