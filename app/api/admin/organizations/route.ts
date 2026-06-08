import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { buildTenantHost, buildTenantUrl } from '@/lib/core/tenant-domain'
import { PLATFORM_FEATURES, resolveFeatureState } from '@/lib/core/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Панель суперадмина: организации, подписки, обзор платформы.
// Только суперадмин (env ADMIN_EMAILS). Читаем/пишем admin-клиентом (минуя RLS).

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const RESERVED_SLUGS = new Set([
  'www', 'admin', 'status', 'api', 'app', 'mail', 'blog', 'docs', 'support',
  'pricing', 'signup', 'login', 'select-organization', 'platform',
])

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due']

function getSupabase() {
  if (!hasAdminSupabaseCredentials()) throw new Error('admin-supabase-unavailable')
  return createAdminSupabaseClient()
}

function num(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mapPlan(p: any) {
  return {
    id: String(p.id),
    code: String(p.code || ''),
    name: String(p.name || ''),
    description: p.description ?? null,
    status: String(p.status || 'active'),
    priceMonthly: num(p.price_monthly),
    priceYearly: num(p.price_yearly),
    currency: String(p.currency || 'KZT'),
    limits: p.limits || {},
    features: p.features || {},
  }
}

// Собирает полную картину платформы: обзор + организации + тарифы.
async function loadPlatformData(supabase: any) {
  const [orgsR, plansR, subsR, compsR, memsR] = await Promise.all([
    supabase.from('organizations').select('*').order('created_at', { ascending: false }),
    supabase.from('subscription_plans').select('*').order('price_monthly', { ascending: true }),
    supabase.from('organization_subscriptions').select('*').order('created_at', { ascending: false }),
    supabase.from('companies').select('id, name, code, organization_id'),
    supabase.from('organization_members').select('id, organization_id, status'),
  ])
  for (const r of [orgsR, plansR, subsR, compsR, memsR]) {
    if (r.error) throw r.error
  }

  // Overrides фич по тенанту — устойчиво к отсутствию таблицы (миграция могла не примениться).
  const overridesByOrg = new Map<string, Map<string, boolean>>()
  try {
    const ovR = await supabase.from('tenant_feature_overrides').select('organization_id, feature, enabled')
    if (!ovR.error) {
      for (const row of ovR.data || []) {
        const k = String(row.organization_id || '')
        if (!k) continue
        if (!overridesByOrg.has(k)) overridesByOrg.set(k, new Map())
        overridesByOrg.get(k)!.set(String(row.feature), !!row.enabled)
      }
    }
  } catch {
    /* таблицы может ещё не быть */
  }

  const plans = (plansR.data || []).map(mapPlan)
  const plansById = new Map<string, any>(plans.map((p: any) => [p.id, p]))

  const companiesByOrg = new Map<string, any[]>()
  const orgByCompany = new Map<string, string>()
  for (const c of compsR.data || []) {
    const k = String(c.organization_id || '')
    if (!k) continue
    orgByCompany.set(String(c.id), k)
    if (!companiesByOrg.has(k)) companiesByOrg.set(k, [])
    companiesByOrg.get(k)!.push({ id: String(c.id), name: c.name, code: c.code ?? null })
  }

  // Legacy-гранты (company_features) по организации — устойчиво к отсутствию таблицы.
  const legacyByOrg = new Map<string, number>()
  try {
    const lgR = await supabase
      .from('company_features')
      .select('company_id')
      .eq('source_type', 'legacy')
      .eq('enabled', true)
    if (!lgR.error) {
      for (const row of lgR.data || []) {
        const orgId = orgByCompany.get(String(row.company_id))
        if (orgId) legacyByOrg.set(orgId, (legacyByOrg.get(orgId) || 0) + 1)
      }
    }
  } catch {
    /* таблицы может ещё не быть */
  }

  const memberCountByOrg = new Map<string, number>()
  for (const m of memsR.data || []) {
    const k = String(m.organization_id || '')
    if (!k) continue
    memberCountByOrg.set(k, (memberCountByOrg.get(k) || 0) + 1)
  }

  // Текущая подписка организации: предпочитаем active/trialing/past_due, иначе самую свежую.
  const subByOrg = new Map<string, any>()
  for (const s of subsR.data || []) {
    const k = String(s.organization_id || '')
    if (!k) continue
    const cur = subByOrg.get(k)
    if (!cur) { subByOrg.set(k, s); continue }
    const sActive = ACTIVE_SUB_STATUSES.includes(s.status)
    const curActive = ACTIVE_SUB_STATUSES.includes(cur.status)
    if (sActive && !curActive) subByOrg.set(k, s)
  }

  const organizations = (orgsR.data || []).map((o: any) => {
    const id = String(o.id)
    const slug = String(o.slug || '')
    const branding = o.branding || {}
    const settings = o.settings || {}
    const sub = subByOrg.get(id) || null
    const plan = sub ? plansById.get(String(sub.plan_id)) || null : null
    const companies = companiesByOrg.get(id) || []
    const orgOverrides = overridesByOrg.get(id)
    const planFeatures = (plan?.features || {}) as Record<string, unknown>
    const entitlements: Record<string, { enabled: boolean; source: string }> = {}
    for (const f of PLATFORM_FEATURES) {
      entitlements[f.key] = resolveFeatureState(f.key, planFeatures, orgOverrides?.get(f.key))
    }
    return {
      id,
      name: String(o.name || ''),
      slug,
      status: String(o.status || 'active'),
      legalName: o.legal_name ?? null,
      primaryDomain: buildTenantHost(slug),
      appUrl: buildTenantUrl(slug),
      createdAt: o.created_at ?? null,
      companyCount: companies.length,
      memberCount: memberCountByOrg.get(id) || 0,
      branding: {
        productName: branding.product_name || o.name || '',
        primaryColor: branding.primary_color || '',
        logoUrl: branding.logo_url || '',
      },
      settings: {
        timezone: settings.timezone || '',
        currency: settings.currency || 'KZT',
        supportEmail: settings.support_email || '',
        supportPhone: settings.support_phone || '',
      },
      companies,
      entitlements,
      legacyGrants: legacyByOrg.get(id) || 0,
      subscription: sub
        ? {
            id: String(sub.id),
            status: String(sub.status || ''),
            billingPeriod: String(sub.billing_period || 'monthly'),
            startsAt: sub.starts_at ?? null,
            endsAt: sub.ends_at ?? null,
            cancelAt: sub.cancel_at ?? null,
            plan: plan ? { id: plan.id, name: plan.name, code: plan.code } : null,
          }
        : null,
    }
  })

  // Обзор
  let activeSubscriptions = 0, trialingSubscriptions = 0, pastDueSubscriptions = 0
  let liveMrr = 0, trialMrr = 0
  for (const org of organizations) {
    const sub = org.subscription
    if (!sub) continue
    const plan = plansById.get(sub.plan?.id || '')
    const monthly = plan?.priceMonthly || 0
    if (sub.status === 'active') { activeSubscriptions++; liveMrr += monthly }
    else if (sub.status === 'trialing') { trialingSubscriptions++; trialMrr += monthly }
    else if (sub.status === 'past_due') { pastDueSubscriptions++ }
  }
  const overview = {
    organizationCount: organizations.length,
    activeOrganizationCount: organizations.filter((o: any) => o.status === 'active').length,
    activeSubscriptions,
    trialingSubscriptions,
    pastDueSubscriptions,
    totalCompanies: (compsR.data || []).length,
    totalMembers: (memsR.data || []).length,
    liveMrr,
    trialMrr,
  }

  return { overview, organizations, plans }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = getSupabase()
    const data = await loadPlatformData(supabase)
    return json(data)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/organizations GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as any
    const name = String(body?.name || '').trim()
    const slug = String(body?.slug || '').trim().toLowerCase()
    const planCode = String(body?.planCode || 'starter').trim()
    const trialDays = Math.max(0, Math.min(90, Number(body?.trialDays) || 0))
    const createPrimaryDomain = body?.createPrimaryDomain !== false
    const ownerEmail = String(body?.ownerEmail || '').trim().toLowerCase()
    const ownerFullName = String(body?.ownerFullName || '').trim()

    if (!name) return json({ error: 'Название организации обязательно' }, 400)
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'Slug: только латиница, цифры и дефис' }, 400)
    if (RESERVED_SLUGS.has(slug)) return json({ error: `Slug «${slug}» зарезервирован` }, 400)

    const supabase = getSupabase()

    const { data: existing } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle()
    if (existing) return json({ error: `Slug «${slug}» уже занят` }, 409)

    const { data: plan } = await supabase.from('subscription_plans').select('id, code').eq('code', planCode).maybeSingle()

    const orgStatus = trialDays > 0 ? 'trial' : 'active'
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert([{
        name,
        slug,
        legal_name: name,
        status: orgStatus,
        branding: { product_name: name },
        settings: {},
      }])
      .select('id, name, slug')
      .single()
    if (orgErr) throw orgErr
    const orgId = String((org as any).id)

    if (plan?.id) {
      const nowIso = new Date().toISOString()
      const endsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86400000).toISOString() : null
      await supabase.from('organization_subscriptions').insert([{
        organization_id: orgId,
        plan_id: (plan as any).id,
        status: trialDays > 0 ? 'trialing' : 'active',
        billing_period: 'monthly',
        starts_at: nowIso,
        ends_at: endsAt,
        metadata: { created_via: 'platform-admin' },
      }])
      await supabase.from('organization_billing_events').insert([{
        organization_id: orgId,
        event_type: trialDays > 0 ? 'trial_started' : 'subscription_activated',
        status: trialDays > 0 ? 'trialing' : 'active',
        created_by_user_id: access.user?.id || null,
        payload: { plan_code: planCode, trial_days: trialDays },
      }]).then(() => {}, () => {})
    }

    if (createPrimaryDomain) {
      await supabase.from('tenant_domains').insert([{
        organization_id: orgId,
        host: buildTenantHost(slug),
        is_primary: true,
      }]).then(() => {}, () => {})
    }

    if (ownerEmail) {
      await supabase.from('organization_members').insert([{
        organization_id: orgId,
        email: ownerEmail,
        role: 'owner',
        status: 'invited',
        is_default: true,
        metadata: { full_name: ownerFullName || null },
      }]).then(() => {}, () => {})
    }

    return json({
      ok: true,
      organization: {
        id: orgId,
        name,
        slug,
        primaryDomain: buildTenantHost(slug),
        appUrl: buildTenantUrl(slug),
        planCode,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/organizations POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as any
    const organizationId = String(body?.organizationId || '').trim()
    if (!organizationId) return json({ error: 'organizationId обязателен' }, 400)

    const supabase = getSupabase()

    // ── Организация ──
    const orgPatch: Record<string, unknown> = {}
    if (body?.name !== undefined) orgPatch.name = String(body.name || '').trim()
    if (body?.legalName !== undefined) orgPatch.legal_name = String(body.legalName || '').trim() || null
    if (body?.organizationStatus !== undefined) orgPatch.status = String(body.organizationStatus || 'active')
    if (body?.slug !== undefined && body.slug) {
      const s = String(body.slug).trim().toLowerCase()
      if (/^[a-z0-9-]+$/.test(s) && !RESERVED_SLUGS.has(s)) orgPatch.slug = s
    }

    const brandingPatch: Record<string, unknown> = {}
    if (body?.productName !== undefined) brandingPatch.product_name = String(body.productName || '').trim() || null
    if (body?.primaryColor !== undefined) brandingPatch.primary_color = String(body.primaryColor || '').trim() || null
    if (body?.logoUrl !== undefined) brandingPatch.logo_url = String(body.logoUrl || '').trim() || null

    const settingsPatch: Record<string, unknown> = {}
    if (body?.timezone !== undefined) settingsPatch.timezone = String(body.timezone || '').trim() || null
    if (body?.currency !== undefined) settingsPatch.currency = String(body.currency || '').trim() || null
    if (body?.supportEmail !== undefined) settingsPatch.support_email = String(body.supportEmail || '').trim() || null
    if (body?.supportPhone !== undefined) settingsPatch.support_phone = String(body.supportPhone || '').trim() || null

    if (Object.keys(brandingPatch).length || Object.keys(settingsPatch).length) {
      const { data: cur } = await supabase.from('organizations').select('branding, settings').eq('id', organizationId).single()
      if (Object.keys(brandingPatch).length) orgPatch.branding = { ...((cur as any)?.branding || {}), ...brandingPatch }
      if (Object.keys(settingsPatch).length) orgPatch.settings = { ...((cur as any)?.settings || {}), ...settingsPatch }
    }

    if (Object.keys(orgPatch).length) {
      const { error } = await supabase.from('organizations').update(orgPatch).eq('id', organizationId)
      if (error) throw error
    }

    // ── Подписка ──
    const { data: sub } = await supabase
      .from('organization_subscriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (sub) {
      const subId = String((sub as any).id)
      const subPatch: Record<string, unknown> = {}
      let eventType: string | null = null

      if (body?.subscriptionStatus) subPatch.status = String(body.subscriptionStatus)
      if (body?.billingPeriod) subPatch.billing_period = String(body.billingPeriod)
      if (body?.subscriptionEndsAt !== undefined) subPatch.ends_at = body.subscriptionEndsAt || null
      if (body?.cancelAt !== undefined) subPatch.cancel_at = body.cancelAt || null
      if (body?.planCode) {
        const { data: plan } = await supabase.from('subscription_plans').select('id').eq('code', String(body.planCode)).maybeSingle()
        if (plan?.id) { subPatch.plan_id = (plan as any).id; eventType = eventType || 'plan_changed' }
      }

      const action = String(body?.subscriptionAction || '')
      const now = new Date()
      const nowIso = now.toISOString()
      const trialDays = Math.max(0, Math.min(90, Number(body?.trialDays) || 14))
      switch (action) {
        case 'activate': subPatch.status = 'active'; subPatch.cancel_at = null; eventType = 'subscription_activated'; break
        case 'startTrial': subPatch.status = 'trialing'; subPatch.ends_at = new Date(Date.now() + trialDays * 86400000).toISOString(); eventType = 'trial_started'; break
        case 'recordPayment': subPatch.status = 'active'; eventType = 'payment_recorded'; break
        case 'markPastDue': subPatch.status = 'past_due'; eventType = 'subscription_past_due'; break
        case 'cancelAtPeriodEnd': subPatch.cancel_at = (sub as any).ends_at || nowIso; eventType = 'subscription_cancel_scheduled'; break
        case 'cancelNow': subPatch.status = 'canceled'; subPatch.cancel_at = nowIso; eventType = 'subscription_canceled'; break
        case 'resume': subPatch.status = 'active'; subPatch.cancel_at = null; eventType = 'subscription_resumed'; break
        case 'renewCycle': subPatch.status = 'active'; subPatch.starts_at = nowIso; subPatch.ends_at = new Date(Date.now() + 30 * 86400000).toISOString(); eventType = 'subscription_renewed'; break
        default: break
      }

      if (Object.keys(subPatch).length) {
        const { error } = await supabase.from('organization_subscriptions').update(subPatch).eq('id', subId)
        if (error) throw error
      }
      if (eventType) {
        await supabase.from('organization_billing_events').insert([{
          organization_id: organizationId,
          subscription_id: subId,
          event_type: eventType,
          status: (subPatch.status as string) || (sub as any).status,
          amount: num(body?.invoiceAmount),
          created_by_user_id: access.user?.id || null,
          payload: { note: body?.billingNote || null },
        }]).then(() => {}, () => {})
      }
    }

    // ── Override функции (entitlement) ──
    if (body?.featureOverride && body.featureOverride.feature) {
      const feature = String(body.featureOverride.feature)
      const enabled = body.featureOverride.enabled
      if (enabled === null || enabled === undefined) {
        const { error } = await supabase
          .from('tenant_feature_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('feature', feature)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('tenant_feature_overrides')
          .upsert(
            {
              organization_id: organizationId,
              feature,
              enabled: !!enabled,
              created_by: access.user?.id || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'organization_id,feature' },
          )
        if (error) throw error
      }
    }

    // Возвращаем обновлённую организацию в том же формате, что и GET.
    const data = await loadPlatformData(supabase)
    const organization = data.organizations.find((o: any) => o.id === organizationId) || null
    return json({ ok: true, organization })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/organizations PATCH', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
