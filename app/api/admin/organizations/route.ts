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

// Временный пароль для владельца клиента (без похожих символов).
function generatePassword(len = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
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

  // company_features → legacy-счётчик + эффективные коды фич по организации (устойчиво).
  const legacyByOrg = new Map<string, number>()
  const effectiveByOrg = new Map<string, Map<string, Set<string>>>()
  try {
    const cfR = await supabase
      .from('company_features')
      .select('company_id, source_type, enabled, ends_at, feature:feature_id(code)')
      .eq('enabled', true)
    if (!cfR.error) {
      const now = Date.now()
      for (const row of cfR.data || []) {
        const ends = (row as any).ends_at ? new Date((row as any).ends_at).getTime() : null
        if (ends && ends < now) continue
        const orgId = orgByCompany.get(String(row.company_id))
        if (!orgId) continue
        if (row.source_type === 'legacy') legacyByOrg.set(orgId, (legacyByOrg.get(orgId) || 0) + 1)
        const feat = (row as any).feature
        const code = Array.isArray(feat) ? feat[0]?.code : feat?.code
        if (!code) continue
        if (!effectiveByOrg.has(orgId)) effectiveByOrg.set(orgId, new Map())
        const m = effectiveByOrg.get(orgId)!
        if (!m.has(code)) m.set(code, new Set())
        m.get(code)!.add(String(row.source_type))
      }
    }
  } catch {
    /* таблицы может ещё не быть */
  }

  // Каталог пакетов/add-ons + привязки по организации (устойчиво к отсутствию таблиц).
  let packagesCatalog: any[] = []
  let addonsCatalog: any[] = []
  const orgPackage = new Map<string, string>()
  const orgAddons = new Map<string, string[]>()
  try {
    const [pkgR, adR, opR, oaR] = await Promise.all([
      supabase.from('packages').select('code, name, vertical, description, feature_codes, price_kzt, status').eq('status', 'active').order('price_kzt', { ascending: true }),
      supabase.from('addons').select('code, name, description, feature_codes, price_kzt, billing_unit, status').eq('status', 'active').order('price_kzt', { ascending: true }),
      supabase.from('organization_packages').select('organization_id, package_code'),
      supabase.from('organization_addons').select('organization_id, addon_code, enabled'),
    ])
    if (!pkgR.error) packagesCatalog = pkgR.data || []
    if (!adR.error) addonsCatalog = adR.data || []
    if (!opR.error) for (const row of opR.data || []) orgPackage.set(String(row.organization_id), String(row.package_code))
    if (!oaR.error) {
      for (const row of oaR.data || []) {
        if (!row.enabled) continue
        const k = String(row.organization_id)
        if (!orgAddons.has(k)) orgAddons.set(k, [])
        orgAddons.get(k)!.push(String(row.addon_code))
      }
    }
  } catch {
    /* таблиц может ещё не быть */
  }

  // История биллинга по организации (последние события).
  const billingByOrg = new Map<string, any[]>()
  try {
    const beR = await supabase
      .from('organization_billing_events')
      .select('organization_id, event_type, status, amount, currency, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (!beR.error) {
      for (const row of beR.data || []) {
        const k = String(row.organization_id || '')
        if (!k) continue
        const arr = billingByOrg.get(k) || []
        if (arr.length < 12) {
          arr.push({
            eventType: row.event_type,
            status: row.status ?? null,
            amount: row.amount ?? null,
            currency: row.currency ?? null,
            createdAt: row.created_at ?? null,
          })
          billingByOrg.set(k, arr)
        }
      }
    }
  } catch {
    /* таблицы может не быть */
  }

  // Каталог фич (для ручной выдачи в панели).
  let featuresCatalog: any[] = []
  try {
    const fR = await supabase
      .from('features')
      .select('code, name, category')
      .order('category', { ascending: true })
      .order('code', { ascending: true })
    if (!fR.error) featuresCatalog = fR.data || []
  } catch {
    /* таблицы может не быть */
  }

  // Счета по организации (ручной биллинг).
  const invoicesByOrg = new Map<string, any[]>()
  try {
    const invR = await supabase
      .from('invoices')
      .select('id, organization_id, amount, currency, period_start, period_end, due_date, status, method, note, paid_at, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (!invR.error) {
      for (const row of invR.data || []) {
        const k = String(row.organization_id || '')
        if (!k) continue
        const arr = invoicesByOrg.get(k) || []
        if (arr.length < 24) {
          arr.push(row)
          invoicesByOrg.set(k, arr)
        }
      }
    }
  } catch {
    /* таблицы может не быть */
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
      packageCode: orgPackage.get(id) || null,
      addonCodes: orgAddons.get(id) || [],
      effectiveFeatures: Array.from((effectiveByOrg.get(id) || new Map<string, Set<string>>()).entries())
        .map(([code, sources]) => ({ code, sources: Array.from(sources as Set<string>) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      billingEvents: billingByOrg.get(id) || [],
      invoices: invoicesByOrg.get(id) || [],
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

  // Обзор + «требуют внимания» (кокпит владельца)
  const todayIso = new Date().toISOString().slice(0, 10)
  const monthPrefix = todayIso.slice(0, 7)
  const soonIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  let activeSubscriptions = 0, trialingSubscriptions = 0, pastDueSubscriptions = 0
  let liveMrr = 0, trialMrr = 0
  let overdueInvoices = 0, overdueInvoicesSum = 0, paidThisMonth = 0, trialsEndingSoon = 0
  const attention: Array<{ id: string; name: string; slug: string; reasons: string[] }> = []

  for (const org of organizations) {
    const sub = org.subscription
    const reasons: string[] = []

    if (sub) {
      const plan = plansById.get(sub.plan?.id || '')
      const monthly = plan?.priceMonthly || 0
      if (sub.status === 'active') { activeSubscriptions++; liveMrr += monthly }
      else if (sub.status === 'trialing') {
        trialingSubscriptions++; trialMrr += monthly
        const d = sub.endsAt ? String(sub.endsAt).slice(0, 10) : null
        if (d && d >= todayIso && d <= soonIso) { trialsEndingSoon++; reasons.push('триал истекает') }
      } else if (sub.status === 'past_due') { pastDueSubscriptions++; reasons.push('подписка просрочена') }
    }

    if (org.status === 'suspended') reasons.push('заморожена')

    let orgHasOverdue = false
    for (const inv of org.invoices || []) {
      if (inv.status === 'issued' && inv.due_date && String(inv.due_date) < todayIso) {
        overdueInvoices++; overdueInvoicesSum += Number(inv.amount) || 0; orgHasOverdue = true
      }
      if (inv.status === 'paid' && inv.paid_at && String(inv.paid_at).slice(0, 7) === monthPrefix) {
        paidThisMonth += Number(inv.amount) || 0
      }
    }
    if (orgHasOverdue) reasons.push('просроченный счёт')

    if (reasons.length) attention.push({ id: org.id, name: org.name, slug: org.slug, reasons })
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
    overdueInvoices,
    overdueInvoicesSum,
    paidThisMonth,
    trialsEndingSoon,
  }

  return { overview, organizations, plans, packages: packagesCatalog, addons: addonsCatalog, features: featuresCatalog, attention }
}

// Пересчитывает plan/addon-гранты company_features организации из её пакета и включённых add-ons.
// Legacy/manual-гранты не трогает. Best-effort (устойчиво к отсутствию таблиц).
async function materializeOrgEntitlements(supabase: any, organizationId: string) {
  try {
    const { data: comps } = await supabase.from('companies').select('id').eq('organization_id', organizationId)
    const companyIds = (comps || []).map((c: any) => String(c.id))
    if (!companyIds.length) return

    // Пакет → коды фич
    let planCodes: string[] = []
    let planRef: string | null = null
    const { data: op } = await supabase.from('organization_packages').select('package_code').eq('organization_id', organizationId).maybeSingle()
    if (op?.package_code) {
      const { data: pkg } = await supabase.from('packages').select('id, feature_codes').eq('code', op.package_code).maybeSingle()
      if (pkg) { planCodes = (pkg as any).feature_codes || []; planRef = String((pkg as any).id) }
    }

    // Включённые add-ons → коды фич
    const addonFeatures: Array<{ code: string; ref: string }> = []
    const { data: oas } = await supabase.from('organization_addons').select('addon_code').eq('organization_id', organizationId).eq('enabled', true)
    const addonCodesList = (oas || []).map((r: any) => r.addon_code)
    if (addonCodesList.length) {
      const { data: ads } = await supabase.from('addons').select('id, feature_codes').in('code', addonCodesList)
      for (const a of ads || []) for (const fc of ((a as any).feature_codes || [])) addonFeatures.push({ code: fc, ref: String((a as any).id) })
    }

    // Коды → id фич
    const allCodes = Array.from(new Set([...planCodes, ...addonFeatures.map((a) => a.code)]))
    const featIdByCode = new Map<string, string>()
    if (allCodes.length) {
      const { data: feats } = await supabase.from('features').select('id, code').in('code', allCodes)
      for (const f of feats || []) featIdByCode.set(String((f as any).code), String((f as any).id))
    }

    // Снести старые plan/addon-гранты этих точек и пересобрать
    await supabase.from('company_features').delete().in('company_id', companyIds).in('source_type', ['plan', 'addon'])

    const rows: any[] = []
    for (const cid of companyIds) {
      for (const code of planCodes) {
        const fid = featIdByCode.get(code)
        if (fid) rows.push({ company_id: cid, feature_id: fid, source_type: 'plan', source_ref: planRef, enabled: true })
      }
      for (const af of addonFeatures) {
        const fid = featIdByCode.get(af.code)
        if (fid) rows.push({ company_id: cid, feature_id: fid, source_type: 'addon', source_ref: af.ref, enabled: true })
      }
    }
    if (rows.length) await supabase.from('company_features').insert(rows)
  } catch {
    /* материализация best-effort */
  }
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
    // Пакет (новая модель доступа): при создании сразу задаёт, какие страницы
    // есть у клиента. Без пакета орг получит полный доступ (allAccess) — поэтому
    // онбординг должен назначать пакет.
    const packageCode = String(body?.packageCode || '').trim()
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

    // Назначаем пакет (новая модель доступа). Меню/страницы клиента = пакет.
    if (packageCode) {
      await supabase.from('organization_packages').upsert(
        { organization_id: orgId, package_code: packageCode, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      ).then(() => {}, () => {})
    }

    if (createPrimaryDomain) {
      await supabase.from('tenant_domains').insert([{
        organization_id: orgId,
        host: buildTenantHost(slug),
        is_primary: true,
      }]).then(() => {}, () => {})
    }

    // Провижининг логина владельца клиента: Auth-аккаунт + staff(owner) + member(active).
    // Best-effort: сбой не ломает создание организации.
    let ownerPassword: string | null = null
    if (ownerEmail) {
      try {
        let authUserId: string | null = null
        ownerPassword = generatePassword()
        const created = await supabase.auth.admin.createUser({
          email: ownerEmail,
          password: ownerPassword,
          email_confirm: true,
          user_metadata: { must_change_password: true, full_name: ownerFullName || null },
        })
        if (created?.data?.user?.id) {
          authUserId = String(created.data.user.id)
        } else {
          // Аккаунт мог уже существовать — пароль не меняем.
          ownerPassword = null
        }

        let staffId: string | null = null
        const staffRes = await supabase
          .from('staff')
          .insert([{
            full_name: ownerFullName || ownerEmail,
            role: 'owner',
            monthly_salary: 0,
            email: ownerEmail,
            is_active: true,
            organization_id: orgId,
          }])
          .select('id')
          .single()
        if (!staffRes.error && staffRes.data) staffId = String((staffRes.data as any).id)

        if (authUserId && staffId) {
          await supabase.auth.admin.updateUserById(authUserId, {
            user_metadata: { must_change_password: true, full_name: ownerFullName || null, staff_id: staffId },
          }).then(() => {}, () => {})
        }

        await supabase.from('organization_members').insert([{
          organization_id: orgId,
          staff_id: staffId,
          user_id: authUserId,
          email: ownerEmail,
          role: 'owner',
          status: 'active',
          is_default: true,
          metadata: { full_name: ownerFullName || null, provisioned: true },
        }]).then(() => {}, () => {})
      } catch {
        /* провижининг best-effort */
      }
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
        ownerEmail: ownerEmail || null,
        ownerPassword,
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

    // ── Создать аккаунт владельца для существующей организации ──
    if (body?.action === 'provisionOwner') {
      const ownerEmail = String(body?.ownerEmail || '').trim().toLowerCase()
      const ownerFullName = String(body?.ownerFullName || '').trim() || null
      if (!ownerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
        return json({ error: 'Укажите корректный email' }, 400)
      }
      const customPassword = String(body?.ownerPassword || '').trim()
      const ownerPassword = customPassword || generatePassword()

      const created = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        user_metadata: { must_change_password: !customPassword, full_name: ownerFullName },
      })
      if (created.error || !created.data?.user?.id) {
        const msg = String(created.error?.message || '')
        const taken = /already|registered|exists/i.test(msg)
        return json({ error: taken ? 'Этот email уже занят — используйте другой' : `Не удалось создать аккаунт: ${msg || 'ошибка'}` }, 400)
      }
      const authUserId = String(created.data.user.id)

      const staffRes = await supabase
        .from('staff')
        .insert([{ full_name: ownerFullName || ownerEmail, role: 'owner', monthly_salary: 0, email: ownerEmail, is_active: true, organization_id: organizationId }])
        .select('id')
        .single()
      const staffId = staffRes.data ? String((staffRes.data as any).id) : null

      if (staffId) {
        await supabase.auth.admin.updateUserById(authUserId, {
          user_metadata: { must_change_password: !customPassword, full_name: ownerFullName, staff_id: staffId },
        }).then(() => {}, () => {})
      }

      await supabase.from('organization_members').insert([{
        organization_id: organizationId,
        staff_id: staffId,
        user_id: authUserId,
        email: ownerEmail,
        role: 'owner',
        status: 'active',
        is_default: true,
        metadata: { full_name: ownerFullName, provisioned: true },
      }]).then(() => {}, () => {})

      return json({ ok: true, owner: { email: ownerEmail, password: ownerPassword, userId: authUserId } })
    }

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

    // ── Назначение отраслевого пакета ──
    if (body?.assignPackage !== undefined) {
      const code = String(body.assignPackage || '').trim()
      if (code) {
        const { error } = await supabase.from('organization_packages').upsert(
          { organization_id: organizationId, package_code: code, updated_at: new Date().toISOString() },
          { onConflict: 'organization_id' },
        )
        if (error) throw error
      } else {
        await supabase.from('organization_packages').delete().eq('organization_id', organizationId)
      }
    }

    // ── Включение/выключение add-on ──
    if (body?.setAddon && body.setAddon.addon) {
      const addon = String(body.setAddon.addon).trim()
      const enabled = !!body.setAddon.enabled
      const { error } = await supabase.from('organization_addons').upsert(
        { organization_id: organizationId, addon_code: addon, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,addon_code' },
      )
      if (error) throw error
    }

    // ── Ручная выдача/снятие отдельной фичи (source 'manual') ──
    if (body?.setFeatureGrant && body.setFeatureGrant.code) {
      const code = String(body.setFeatureGrant.code)
      const enabled = body.setFeatureGrant.enabled === true
      const { data: comps } = await supabase.from('companies').select('id').eq('organization_id', organizationId)
      const companyIds = (comps || []).map((c: any) => String(c.id))
      // Гранты хранятся per-точка → без единой точки выдавать некуда.
      if (companyIds.length === 0) {
        return json({ error: 'У организации нет ни одной точки. Сначала добавьте точку — права выдаются на точки.' }, 400)
      }
      const { data: feat } = await supabase.from('features').select('id').eq('code', code).maybeSingle()
      if (!feat?.id) {
        return json({ error: `Неизвестная функция: ${code}` }, 400)
      }
      await supabase
        .from('company_features')
        .delete()
        .in('company_id', companyIds)
        .eq('feature_id', (feat as any).id)
        .eq('source_type', 'manual')
      if (enabled) {
        const rows = companyIds.map((cid) => ({
          company_id: cid,
          feature_id: (feat as any).id,
          source_type: 'manual',
          enabled: true,
        }))
        const { error: grantErr } = await supabase.from('company_features').insert(rows)
        if (grantErr) return json({ error: `Не удалось выдать: ${grantErr.message}` }, 500)
      }
    }

    // ── Ручной биллинг: выставить счёт ──
    if (body?.createInvoice) {
      const ci = body.createInvoice
      const amount = num(ci?.amount) || 0
      const currency = String(ci?.currency || 'KZT')
      const { data: inv, error } = await supabase
        .from('invoices')
        .insert([{
          organization_id: organizationId,
          amount,
          currency,
          period_start: ci?.periodStart || null,
          period_end: ci?.periodEnd || null,
          due_date: ci?.dueDate || null,
          status: 'issued',
          note: String(ci?.note || '').trim() || null,
          created_by: access.user?.id || null,
        }])
        .select('id')
        .single()
      if (error) throw error
      await supabase.from('organization_billing_events').insert([{
        organization_id: organizationId,
        event_type: 'invoice_issued',
        status: 'issued',
        amount,
        currency,
        created_by_user_id: access.user?.id || null,
        payload: { invoice_id: (inv as any)?.id || null },
      }]).then(() => {}, () => {})
    }

    // ── Ручной биллинг: отметить оплату ──
    if (body?.markInvoicePaid && body.markInvoicePaid.invoiceId) {
      const invoiceId = String(body.markInvoicePaid.invoiceId)
      const method = String(body.markInvoicePaid.method || 'manual')
      const { data: inv } = await supabase.from('invoices').select('amount, currency').eq('id', invoiceId).maybeSingle()
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', method, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
      if (error) throw error
      await supabase.from('organization_billing_events').insert([{
        organization_id: organizationId,
        event_type: 'payment_recorded',
        status: 'paid',
        amount: (inv as any)?.amount ?? null,
        currency: (inv as any)?.currency ?? 'KZT',
        created_by_user_id: access.user?.id || null,
        payload: { invoice_id: invoiceId, method },
      }]).then(() => {}, () => {})
    }

    // ── Ручной биллинг: аннулировать счёт ──
    if (body?.voidInvoice && body.voidInvoice.invoiceId) {
      const invoiceId = String(body.voidInvoice.invoiceId)
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
      if (error) throw error
    }

    // Если меняли пакет/модули — пересобрать plan/addon-гранты в company_features.
    if (body?.assignPackage !== undefined || body?.setAddon) {
      await materializeOrgEntitlements(supabase, organizationId)
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
