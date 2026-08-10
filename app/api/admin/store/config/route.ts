import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { hasCapability, requireAnyCapability, requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function loadCompanies(supabase: any, scoped: string[] | null) {
  let q = supabase.from('companies').select('id, name, code, store_enabled, organization_id').order('name')
  if (scoped) q = q.in('id', scoped)
  const { data } = await q
  return (data || []) as Array<{ id: string; name: string; code: string | null; store_enabled?: boolean; organization_id?: string | null }>
}

/**
 * У каждой точки-магазина должны быть СВОИ локации (склад + витрина), иначе
 * приёмке/оприходованию/списанию некуда писать. Идемпотентно, батчем: читаем
 * все локации данных точек одним запросом, создаём недостающие. Вызывается при
 * заходе в модуль (GET) — точка получает локации без ручных действий.
 */
async function ensureShopLocations(
  supabase: any,
  companies: Array<{ id: string; name: string; code: string | null; organization_id?: string | null }>,
) {
  const ids = companies.map((c) => c.id)
  if (ids.length === 0) return
  const { data: locs } = await supabase
    .from('inventory_locations')
    .select('company_id, location_type')
    .in('company_id', ids)
  const have = new Set<string>((locs || []).map((l: any) => `${l.company_id}:${l.location_type}`))
  const toCreate: any[] = []
  for (const c of companies) {
    for (const lt of ['warehouse', 'point_display'] as const) {
      if (!have.has(`${c.id}:${lt}`)) {
        toCreate.push({ company_id: c.id, organization_id: c.organization_id || null, name: c.name, code: c.code, location_type: lt, is_active: true })
      }
    }
  }
  if (toCreate.length) {
    try { await supabase.from('inventory_locations').insert(toCreate) } catch { /* гонка/уник — не критично */ }
  }
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    // Роут обслуживает «Настройки магазина», поэтому пускает и по их праву.
    // Раньше он спрашивал только `store.view` — право «Магазина», — и тот,
    // кому выдали ровно настройки, видел пункт и упирался в отказ.
    const denied = await requireAnyCapability(access, ['store-settings.view', 'store.view'])
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

    // Авто-провижн: точки-магазины без своих локаций получают склад+витрину прямо
    // здесь (модуль загружается через этот GET) — без ручного пере-сохранения.
    await ensureShopLocations(supabase, companies.filter((c) => c.store_enabled))

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
    return json({ ok: true, data: { store_company_id: storeCompanyId, store_enabled_ids: storeEnabledIds, companies, can_manage: await hasCapability(access, 'store-settings.edit') } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/config.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

export async function PUT(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-settings.edit')
    if (denied) return denied
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

      // Новой точке-магазину нужны СВОИ локации (склад + витрина).
      if (enabledSet.length > 0) {
        const { data: enabledCompanies } = await supabase
          .from('companies').select('id, name, code, organization_id').in('id', enabledSet)
        await ensureShopLocations(supabase, (enabledCompanies || []) as any[])
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
