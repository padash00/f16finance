import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
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
  let q = supabase.from('companies').select('id, name, code, store_enabled').order('name')
  if (scoped) q = q.in('id', scoped)
  const { data } = await q
  return (data || []) as Array<{ id: string; name: string; code: string | null; store_enabled?: boolean }>
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store.view')
    if (denied) return denied
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

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

    const storeEnabledIds = companies.filter((c) => c.store_enabled).map((c) => c.id)
    return json({ ok: true, data: { store_company_id: storeCompanyId, store_enabled_ids: storeEnabledIds, companies, can_manage: canManage(access) } })
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
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'no-organization' }, 400)

    const body = await request.json().catch(() => ({})) as { store_company_id?: string | null; store_enabled_ids?: string[] }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const scope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
    const allowed = scope.allowedCompanyIds

    // ── Флаги «точка = магазин» (store_enabled) для точек орг ────────────────
    if (Array.isArray(body.store_enabled_ids)) {
      const requested = body.store_enabled_ids.map(String)
      // Только точки своей орг.
      const enabledSet = allowed ? requested.filter((id) => allowed.includes(id)) : requested
      // Все точки орг: включённым — true, остальным — false.
      const orgCompanyIds = allowed || (await loadCompanies(supabase, null)).map((c) => c.id)
      if (orgCompanyIds.length > 0) {
        await supabase.from('companies').update({ store_enabled: true }).in('id', enabledSet.length ? enabledSet : ['00000000-0000-0000-0000-000000000000'])
        const toDisable = orgCompanyIds.filter((id) => !enabledSet.includes(id))
        if (toDisable.length) await supabase.from('companies').update({ store_enabled: false }).in('id', toDisable)
      }

      // Новой точке-магазину нужны СВОИ локации (склад + витрина), иначе приёмке/
      // оприходованию/списанию некуда писать и дропдаун падает на чужую точку.
      if (enabledSet.length > 0) {
        const { data: enabledCompanies } = await supabase
          .from('companies').select('id, name, code, organization_id').in('id', enabledSet)
        for (const c of (enabledCompanies || []) as any[]) {
          for (const lt of ['warehouse', 'point_display'] as const) {
            const { data: exists } = await supabase
              .from('inventory_locations').select('id').eq('company_id', c.id).eq('location_type', lt).limit(1).maybeSingle()
            if (!exists) {
              await supabase.from('inventory_locations').insert({
                company_id: c.id, organization_id: c.organization_id,
                name: c.name, code: c.code, location_type: lt, is_active: true,
              })
            }
          }
        }
      }
    }

    // ── Стартовая точка по умолчанию (store_company_id) ──────────────────────
    if ('store_company_id' in body) {
      const storeCompanyId = body.store_company_id || null
      if (storeCompanyId && allowed && !allowed.includes(storeCompanyId)) {
        return json({ error: 'forbidden-company' }, 403)
      }
      const { error } = await supabase
        .from('store_settings')
        .upsert({ organization_id: orgId, store_company_id: storeCompanyId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
      if (error) throw error
    }

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/config.PUT', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
