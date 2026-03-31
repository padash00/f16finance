import { NextResponse } from 'next/server'

import { buildTenantHost, buildTenantUrl, normalizeTenantHost } from '@/lib/core/tenant-domain'
import { resolveOrganizationUsage } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type CreateOrganizationBody = {
  name?: string | null
  slug?: string | null
  legalName?: string | null
  planCode?: string | null
  trialDays?: number | null
  createPrimaryDomain?: boolean | null
}

type UpdateOrganizationBody = {
  organizationId?: string | null
  name?: string | null
  slug?: string | null
  legalName?: string | null
  productName?: string | null
  primaryColor?: string | null
  logoUrl?: string | null
  supportEmail?: string | null
  supportPhone?: string | null
  timezone?: string | null
  currency?: string | null
  organizationStatus?: string | null
  planCode?: string | null
  subscriptionStatus?: string | null
  billingPeriod?: string | null
  subscriptionEndsAt?: string | null
  cancelAt?: string | null
  trialDays?: number | null
  subscriptionAction?:
    | 'startTrial'
    | 'activate'
    | 'recordPayment'
    | 'markPastDue'
    | 'cancelAtPeriodEnd'
    | 'cancelNow'
    | 'resume'
    | 'renewCycle'
    | null
  billingNote?: string | null
  invoiceAmount?: number | null
}

type SubscriptionPlanRow = {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  price_monthly: number | null
  price_yearly: number | null
  currency: string | null
  limits: Record<string, unknown> | null
  features: Record<string, unknown> | null
}

type BillingEventRow = {
  id: string
  organization_id: string
  subscription_id: string | null
  event_type: string
  status: string | null
  amount: number | null
  currency: string | null
  billing_period: string | null
  note: string | null
  created_at: string
}

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  ә: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  қ: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  ң: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ұ: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  һ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  і: 'i',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ь: '',
  ъ: '',
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC_TO_LATIN_MAP[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function normalizeTrialDays(value: unknown, fallback = 14) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(Math.max(Math.round(numeric), 1), 90)
}

function addDaysIso(baseDate: Date, days: number) {
  const next = new Date(baseDate)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString()
}

function addBillingPeriodIso(baseDate: Date, billingPeriod: string) {
  if (billingPeriod === 'yearly') {
    const next = new Date(baseDate)
    next.setUTCFullYear(next.getUTCFullYear() + 1)
    return next.toISOString()
  }

  const next = new Date(baseDate)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next.toISOString()
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function normalizeInvoiceAmount(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric
}

function getMonthlyRevenueEquivalent(plan: SubscriptionPlanRow | null, billingPeriod: string | null | undefined) {
  if (!plan) return 0
  if (billingPeriod === 'yearly' && typeof plan.price_yearly === 'number') {
    return Number(plan.price_yearly) / 12
  }
  if (typeof plan.price_monthly === 'number') {
    return Number(plan.price_monthly)
  }
  return 0
}

async function writeBillingEvent(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  organizationId: string
  subscriptionId?: string | null
  eventType: string
  status?: string | null
  amount?: number | null
  currency?: string | null
  billingPeriod?: string | null
  note?: string | null
  createdByUserId?: string | null
  payload?: Record<string, unknown>
}) {
  const {
    supabase,
    organizationId,
    subscriptionId = null,
    eventType,
    status = null,
    amount = null,
    currency = null,
    billingPeriod = null,
    note = null,
    createdByUserId = null,
    payload = {},
  } = params

  const { error } = await supabase.from('organization_billing_events').insert([
    {
      organization_id: organizationId,
      subscription_id: subscriptionId,
      event_type: eventType,
      status,
      amount,
      currency,
      billing_period: billingPeriod,
      note,
      created_by_user_id: createdByUserId,
      payload,
    },
  ])

  if (error) {
    console.warn('Failed to write organization billing event', error)
  }
}

async function reserveUniqueSlug(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  baseSlug: string,
  excludeOrganizationId?: string | null,
) {
  const normalizedBase = slugify(baseSlug)
  if (!normalizedBase) {
    throw new Error('Укажите slug латиницей или название, из которого можно собрать slug.')
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug')
    .ilike('slug', `${normalizedBase}%`)

  if (error) throw error

  const existing = new Set(
    (data || [])
      .filter((row: any) => String(row.id || '') !== String(excludeOrganizationId || ''))
      .map((row: any) => String(row.slug || '').trim().toLowerCase())
      .filter(Boolean),
  )

  if (!existing.has(normalizedBase)) {
    return normalizedBase
  }

  let counter = 2
  while (existing.has(`${normalizedBase}-${counter}`)) {
    counter += 1
  }

  return `${normalizedBase}-${counter}`
}

function getManageableAccess(params: {
  organizations: Array<{ id: string; accessRole: string }>
  organizationId: string
  isSuperAdmin: boolean
}) {
  const { organizations, organizationId, isSuperAdmin } = params
  if (isSuperAdmin) {
    return { canManage: true, canManageSubscription: true }
  }

  const match = organizations.find((item) => item.id === organizationId)
  if (!match) {
    return { canManage: false, canManageSubscription: false }
  }

  return {
    canManage: match.accessRole === 'owner',
    canManageSubscription: false,
  }
}

function normalizePlan(plan: SubscriptionPlanRow) {
  return {
    id: String(plan.id),
    code: String(plan.code),
    name: String(plan.name),
    description: plan.description || null,
    status: String(plan.status || 'active'),
    priceMonthly: plan.price_monthly ?? null,
    priceYearly: plan.price_yearly ?? null,
    currency: plan.currency || 'KZT',
    limits: plan.limits || {},
    features: plan.features || {},
  }
}

async function loadOrganizationHubData(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  organizationIds: string[]
}) {
  const { supabase, organizationIds } = params

  if (!organizationIds.length) {
    const { data: plansData, error: plansError } = await supabase
      .from('subscription_plans')
      .select('id, code, name, description, status, price_monthly, price_yearly, currency, limits, features')
      .order('price_monthly', { ascending: true })

    if (plansError) throw plansError

    return {
      organizations: [],
      plans: ((plansData || []) as SubscriptionPlanRow[]).map(normalizePlan),
      overview: {
        organizationCount: 0,
        activeOrganizationCount: 0,
        activeSubscriptions: 0,
        trialingSubscriptions: 0,
        pastDueSubscriptions: 0,
        totalCompanies: 0,
        totalMembers: 0,
        liveMrr: 0,
        trialMrr: 0,
      },
    }
  }

  const [
    { data: organizationsData, error: organizationsError },
    { data: subscriptionsData, error: subscriptionsError },
    { data: companiesData, error: companiesError },
    { data: membersData, error: membersError },
    { data: plansData, error: plansError },
    { data: billingEventsData, error: billingEventsError },
    { data: tenantDomainsData, error: tenantDomainsError },
  ] =
    await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, legal_name, status, branding, settings, created_at')
        .in('id', organizationIds)
        .order('name', { ascending: true }),
      supabase
        .from('organization_subscriptions')
        .select(
          'id, organization_id, status, billing_period, starts_at, ends_at, cancel_at, created_at, plan:plan_id(id, code, name, description, status, price_monthly, price_yearly, currency, limits, features)',
        )
        .in('organization_id', organizationIds)
        .order('starts_at', { ascending: false }),
      supabase
        .from('companies')
        .select('id, name, code, organization_id')
        .in('organization_id', organizationIds)
        .order('name', { ascending: true }),
      supabase
        .from('organization_members')
        .select('organization_id, status')
        .in('organization_id', organizationIds),
      supabase
        .from('subscription_plans')
        .select('id, code, name, description, status, price_monthly, price_yearly, currency, limits, features')
        .order('price_monthly', { ascending: true }),
      supabase
        .from('organization_billing_events')
        .select('id, organization_id, subscription_id, event_type, status, amount, currency, billing_period, note, created_at')
        .in('organization_id', organizationIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('tenant_domains')
        .select('organization_id, host, is_primary')
        .in('organization_id', organizationIds)
        .order('is_primary', { ascending: false }),
    ])

  if (organizationsError) throw organizationsError
  if (subscriptionsError) throw subscriptionsError
  if (companiesError) throw companiesError
  if (membersError) throw membersError
  if (plansError) throw plansError
  if (billingEventsError) throw billingEventsError
  if (tenantDomainsError) throw tenantDomainsError

  const subscriptionsByOrganization = new Map<string, any>()
  for (const row of subscriptionsData || []) {
    const organizationId = String((row as any).organization_id || '')
    if (!organizationId || subscriptionsByOrganization.has(organizationId)) continue
    subscriptionsByOrganization.set(organizationId, row)
  }

  const billingEventsByOrganization = new Map<
    string,
    Array<{
      id: string
      subscriptionId: string | null
      eventType: string
      status: string | null
      amount: number | null
      currency: string | null
      billingPeriod: string | null
      note: string | null
      createdAt: string
    }>
  >()
  for (const row of (billingEventsData || []) as BillingEventRow[]) {
    const organizationId = String(row.organization_id || '')
    if (!organizationId) continue
    if (!billingEventsByOrganization.has(organizationId)) {
      billingEventsByOrganization.set(organizationId, [])
    }
    const current = billingEventsByOrganization.get(organizationId)!
    if (current.length >= 8) continue
    current.push({
      id: String(row.id || ''),
      subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
      eventType: String(row.event_type || ''),
      status: row.status ? String(row.status) : null,
      amount: typeof row.amount === 'number' ? row.amount : row.amount === null ? null : Number(row.amount),
      currency: row.currency || null,
      billingPeriod: row.billing_period || null,
      note: row.note || null,
      createdAt: row.created_at,
    })
  }

  const companiesByOrganization = new Map<string, Array<{ id: string; name: string; code: string | null }>>()
  for (const row of companiesData || []) {
    const organizationId = String((row as any).organization_id || '')
    if (!companiesByOrganization.has(organizationId)) {
      companiesByOrganization.set(organizationId, [])
    }
    companiesByOrganization.get(organizationId)?.push({
      id: String((row as any).id || ''),
      name: String((row as any).name || ''),
      code: (row as any).code || null,
    })
  }

  const memberCounts = new Map<string, number>()
  for (const row of membersData || []) {
    if (String((row as any).status || '') !== 'active') continue
    const organizationId = String((row as any).organization_id || '')
    memberCounts.set(organizationId, (memberCounts.get(organizationId) || 0) + 1)
  }

  const tenantDomainByOrganization = new Map<string, { host: string; isPrimary: boolean }>()
  for (const row of (tenantDomainsData || []) as Array<{ organization_id: string; host: string; is_primary: boolean }>) {
    const organizationId = String(row.organization_id || '')
    if (!organizationId || tenantDomainByOrganization.has(organizationId)) continue
    const normalizedHost = normalizeTenantHost(row.host)
    if (!normalizedHost) continue
    tenantDomainByOrganization.set(organizationId, {
      host: normalizedHost,
      isPrimary: Boolean(row.is_primary),
    })
  }

  const usageByOrganizationEntries = await Promise.all(
    organizationIds.map(async (organizationId) => [
      organizationId,
      await resolveOrganizationUsage({ activeOrganizationId: organizationId, isSuperAdmin: false }),
    ] as const),
  )
  const usageByOrganization = new Map(usageByOrganizationEntries)

  const normalizedPlans = ((plansData || []) as SubscriptionPlanRow[]).map(normalizePlan)
  const normalizedOrganizations = (organizationsData || []).map((row: any) => {
      const organizationId = String(row.id || '')
      const subscription = subscriptionsByOrganization.get(organizationId)
      const plan = subscription?.plan
      const companies = companiesByOrganization.get(organizationId) || []
      const tenantDomain = tenantDomainByOrganization.get(organizationId) || null
      const branding = (row.branding as Record<string, unknown> | null) || {}
      const settings = (row.settings as Record<string, unknown> | null) || {}
      const usage = usageByOrganization.get(organizationId) || {
        companies: companies.length,
        staff: memberCounts.get(organizationId) || 0,
        operators: 0,
        point_projects: 0,
      }

      return {
        id: organizationId,
        name: String(row.name || ''),
        slug: String(row.slug || ''),
        legalName: row.legal_name || null,
        status: String(row.status || 'active'),
        createdAt: row.created_at || null,
        primaryDomain: tenantDomain?.host || buildTenantHost(String(row.slug || '')),
        appUrl: buildTenantUrl(tenantDomain?.host || String(row.slug || '')),
        companyCount: companies.length,
        memberCount: memberCounts.get(organizationId) || 0,
        branding: {
          productName: String(branding.product_name || row.name || ''),
          primaryColor: typeof branding.primary_color === 'string' ? branding.primary_color : '',
          logoUrl: typeof branding.logo_url === 'string' ? branding.logo_url : '',
        },
        settings: {
          timezone: typeof settings.timezone === 'string' ? settings.timezone : 'Asia/Qyzylorda',
          currency: typeof settings.currency === 'string' ? settings.currency : 'KZT',
          supportEmail: typeof settings.support_email === 'string' ? settings.support_email : '',
          supportPhone: typeof settings.support_phone === 'string' ? settings.support_phone : '',
        },
        usage,
        companies,
        billingEvents: billingEventsByOrganization.get(organizationId) || [],
        subscription: subscription
          ? {
              id: String(subscription.id || ''),
              status: String(subscription.status || 'active'),
              billingPeriod: String(subscription.billing_period || 'monthly'),
              startsAt: subscription.starts_at || null,
              endsAt: subscription.ends_at || null,
              cancelAt: subscription.cancel_at || null,
              plan: plan
                ? normalizePlan(plan as SubscriptionPlanRow)
                : null,
            }
          : null,
      }
    })

  const overview = normalizedOrganizations.reduce(
    (acc, organization) => {
      acc.organizationCount += 1
      if (organization.status === 'active' || organization.status === 'trial') {
        acc.activeOrganizationCount += 1
      }
      acc.totalCompanies += organization.companyCount
      acc.totalMembers += organization.memberCount

      const status = organization.subscription?.status || null
      const plan = organization.subscription?.plan
      const mrrEquivalent = plan
        ? getMonthlyRevenueEquivalent(
            {
              id: plan.id,
              code: plan.code,
              name: plan.name,
              description: null,
              status: 'active',
              price_monthly: plan.priceMonthly,
              price_yearly: plan.priceYearly,
              currency: plan.currency,
              limits: plan.limits,
              features: plan.features,
            },
            organization.subscription?.billingPeriod,
          )
        : 0

      if (status === 'active') {
        acc.activeSubscriptions += 1
        acc.liveMrr += mrrEquivalent
      } else if (status === 'trialing') {
        acc.trialingSubscriptions += 1
        acc.trialMrr += mrrEquivalent
      } else if (status === 'past_due') {
        acc.pastDueSubscriptions += 1
        acc.liveMrr += mrrEquivalent
      }

      return acc
    },
    {
      organizationCount: 0,
      activeOrganizationCount: 0,
      activeSubscriptions: 0,
      trialingSubscriptions: 0,
      pastDueSubscriptions: 0,
      totalCompanies: 0,
      totalMembers: 0,
      liveMrr: 0,
      trialMrr: 0,
    },
  )

  return {
    organizations: normalizedOrganizations,
    plans: normalizedPlans,
    overview,
  }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = createAdminSupabaseClient()
    const organizationIds = access.organizations.map((item) => item.id)
    const data = await loadOrganizationHubData({ supabase, organizationIds })
    return json({
      ok: true,
      organizations: data.organizations,
      plans: data.plans,
      overview: data.overview,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as CreateOrganizationBody | null
    const name = String(body?.name || '').trim()
    const legalName = String(body?.legalName || '').trim() || null
    const desiredSlug = String(body?.slug || '').trim() || name
    const planCode = String(body?.planCode || '').trim() || 'starter'
    const trialDays = normalizeTrialDays(body?.trialDays, 14)
    const createPrimaryDomain = body?.createPrimaryDomain !== false

    if (!name) {
      return json({ error: 'Название организации обязательно' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const slug = await reserveUniqueSlug(supabase, desiredSlug)

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('id, code')
      .eq('code', planCode)
      .maybeSingle()

    if (planError) throw planError
    if (!plan?.id) {
      return json({ error: 'plan-not-found' }, 400)
    }

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .insert([
        {
          name,
          slug,
          legal_name: legalName,
          status: 'active',
          settings: {
            created_from: 'project-hub',
            timezone: 'Asia/Qyzylorda',
            currency: 'KZT',
          },
          branding: {
            product_name: name,
          },
        },
      ])
      .select('id, name, slug, status')
      .single()

    if (organizationError) throw organizationError

    const organizationId = String((organization as any).id)
    const primaryDomainHost = buildTenantHost(slug)
    const appUrl = buildTenantUrl(primaryDomainHost)

    const subscriptionStartsAt = new Date()
    const subscriptionEndsAt = addDaysIso(subscriptionStartsAt, trialDays)
    const { data: subscription, error: subscriptionError } = await supabase
      .from('organization_subscriptions')
      .insert([
        {
          organization_id: organizationId,
          plan_id: String(plan.id),
          status: 'trialing',
          billing_period: 'monthly',
          starts_at: subscriptionStartsAt.toISOString(),
          ends_at: subscriptionEndsAt,
          metadata: {
            created_from: 'project-hub',
            trial_days: trialDays,
          },
        },
      ])
      .select('id')
      .single()
    if (subscriptionError) throw subscriptionError

    const { error: memberError } = await supabase
      .from('organization_members')
      .upsert(
        [
          {
            organization_id: organizationId,
            staff_id: access.staffMember?.id || null,
            user_id: access.user?.id || null,
            email: access.user?.email?.trim().toLowerCase() || null,
            role: 'owner',
            status: 'active',
            is_default: true,
            metadata: {
              created_from: 'project-hub',
            },
          },
        ],
        {
          onConflict: 'organization_id,user_id',
        },
      )
    if (memberError) throw memberError

    if (createPrimaryDomain) {
      const { error: domainError } = await supabase
        .from('tenant_domains')
        .insert([
          {
            organization_id: organizationId,
            host: primaryDomainHost,
            is_primary: true,
          },
        ])
      if (domainError) {
        console.warn('Primary tenant domain was not created', domainError)
      }
    }

    await writeBillingEvent({
      supabase,
      organizationId,
      subscriptionId: String((subscription as any)?.id || '') || null,
      eventType: 'trial_started',
      status: 'trialing',
      billingPeriod: 'monthly',
      createdByUserId: access.user?.id || null,
      note: `Пробный период на ${trialDays} дней запущен при создании организации.`,
      payload: {
        plan_code: String(plan.code),
        trial_days: trialDays,
        created_from: 'project-hub',
      },
    })

    return json({
      ok: true,
      organization: {
        id: organizationId,
        name: String((organization as any).name || name),
        slug: String((organization as any).slug || slug),
        status: String((organization as any).status || 'active'),
        planCode: String(plan.code),
        primaryDomain: primaryDomainHost,
        appUrl,
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = (await req.json().catch(() => null)) as UpdateOrganizationBody | null
    const organizationId = String(body?.organizationId || '').trim()
    if (!organizationId) {
      return json({ error: 'organizationId required' }, 400)
    }

    const rights = getManageableAccess({
      organizations: access.organizations,
      organizationId,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (!rights.canManage) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = createAdminSupabaseClient()
    const organizationPayload: Record<string, unknown> = {}
    const brandingPatch: Record<string, unknown> = {}
    const settingsPatch: Record<string, unknown> = {}

    if (typeof body?.name === 'string' && body.name.trim()) {
      organizationPayload.name = body.name.trim()
    }

    if (typeof body?.legalName === 'string') {
      organizationPayload.legal_name = body.legalName.trim() || null
    }

    if (rights.canManageSubscription && typeof body?.slug === 'string' && body.slug.trim()) {
      organizationPayload.slug = await reserveUniqueSlug(supabase, body.slug, organizationId)
    }

    if (rights.canManageSubscription && typeof body?.organizationStatus === 'string' && body.organizationStatus.trim()) {
      organizationPayload.status = body.organizationStatus.trim()
    }

    if (typeof body?.productName === 'string') {
      brandingPatch.product_name = body.productName.trim() || null
    }

    if (typeof body?.primaryColor === 'string') {
      brandingPatch.primary_color = body.primaryColor.trim() || null
    }

    if (typeof body?.logoUrl === 'string') {
      brandingPatch.logo_url = body.logoUrl.trim() || null
    }

    if (typeof body?.supportEmail === 'string') {
      settingsPatch.support_email = body.supportEmail.trim() || null
    }

    if (typeof body?.supportPhone === 'string') {
      settingsPatch.support_phone = body.supportPhone.trim() || null
    }

    if (typeof body?.timezone === 'string') {
      settingsPatch.timezone = body.timezone.trim() || 'Asia/Qyzylorda'
    }

    if (typeof body?.currency === 'string') {
      settingsPatch.currency = body.currency.trim() || 'KZT'
    }

    if (Object.keys(brandingPatch).length > 0 || Object.keys(settingsPatch).length > 0) {
      const { data: existingOrganization, error: existingOrganizationError } = await supabase
        .from('organizations')
        .select('branding, settings')
        .eq('id', organizationId)
        .single()
      if (existingOrganizationError) throw existingOrganizationError

      if (Object.keys(brandingPatch).length > 0) {
        organizationPayload.branding = {
          ...((((existingOrganization as any)?.branding as Record<string, unknown> | null) || {})),
          ...brandingPatch,
        }
      }

      if (Object.keys(settingsPatch).length > 0) {
        organizationPayload.settings = {
          ...((((existingOrganization as any)?.settings as Record<string, unknown> | null) || {})),
          ...settingsPatch,
        }
      }
    }

    if (Object.keys(organizationPayload).length > 0) {
      const { error: organizationError } = await supabase
        .from('organizations')
        .update(organizationPayload)
        .eq('id', organizationId)
      if (organizationError) throw organizationError
    }

    const canUpdateSubscription =
      rights.canManageSubscription &&
      (typeof body?.planCode === 'string' ||
        typeof body?.subscriptionStatus === 'string' ||
        typeof body?.billingPeriod === 'string' ||
        typeof body?.subscriptionEndsAt === 'string' ||
        typeof body?.cancelAt === 'string' ||
        typeof body?.subscriptionAction === 'string')

    if (canUpdateSubscription) {
      const { data: currentSubscription, error: currentSubscriptionError } = await supabase
        .from('organization_subscriptions')
        .select('id, plan_id, status, billing_period, starts_at, ends_at, cancel_at')
        .eq('organization_id', organizationId)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (currentSubscriptionError) throw currentSubscriptionError

      let planId = currentSubscription?.plan_id ? String(currentSubscription.plan_id) : null
      if (typeof body?.planCode === 'string' && body.planCode.trim()) {
        const { data: plan, error: planError } = await supabase
          .from('subscription_plans')
          .select('id')
          .eq('code', body.planCode.trim())
          .maybeSingle()
        if (planError) throw planError
        if (!plan?.id) {
          return json({ error: 'plan-not-found' }, 400)
        }
        planId = String(plan.id)
      }

      const nextBillingPeriod =
        typeof body?.billingPeriod === 'string' && body.billingPeriod.trim()
          ? body.billingPeriod.trim()
          : currentSubscription?.billing_period || 'monthly'
      const currentStartsAt = normalizeIsoDate((currentSubscription as any)?.starts_at || null)
      const currentEndsAt = normalizeIsoDate((currentSubscription as any)?.ends_at || null)
      const currentCancelAt = normalizeIsoDate((currentSubscription as any)?.cancel_at || null)
      const now = new Date()
      const nextStartsAt = currentStartsAt || now.toISOString()
      let nextStatus =
        typeof body?.subscriptionStatus === 'string' && body.subscriptionStatus.trim()
          ? body.subscriptionStatus.trim()
          : currentSubscription?.status || 'active'
      let nextEndsAt =
        typeof body?.subscriptionEndsAt === 'string'
          ? normalizeIsoDate(body.subscriptionEndsAt)
          : currentEndsAt
      let nextCancelAt =
        typeof body?.cancelAt === 'string'
          ? normalizeIsoDate(body.cancelAt)
          : currentCancelAt

      const subscriptionAction =
        typeof body?.subscriptionAction === 'string' ? body.subscriptionAction.trim() : null
      const billingNote = String(body?.billingNote || '').trim() || null
      const invoiceAmount = normalizeInvoiceAmount(body?.invoiceAmount)
      const trialDays = normalizeTrialDays(body?.trialDays, 14)
      let billingEventType: string | null = null

      if (subscriptionAction === 'startTrial') {
        nextStatus = 'trialing'
        nextEndsAt = addDaysIso(now, trialDays)
        nextCancelAt = null
        billingEventType = 'trial_started'
      } else if (subscriptionAction === 'activate') {
        nextStatus = 'active'
        nextEndsAt = nextEndsAt || addBillingPeriodIso(now, nextBillingPeriod)
        nextCancelAt = null
        billingEventType = 'subscription_activated'
      } else if (subscriptionAction === 'recordPayment') {
        nextStatus = 'active'
        nextEndsAt = addBillingPeriodIso(now, nextBillingPeriod)
        nextCancelAt = null
        billingEventType = 'payment_recorded'
      } else if (subscriptionAction === 'markPastDue') {
        nextStatus = 'past_due'
        billingEventType = 'subscription_past_due'
      } else if (subscriptionAction === 'cancelAtPeriodEnd') {
        nextCancelAt = nextEndsAt || addBillingPeriodIso(now, nextBillingPeriod)
        billingEventType = 'subscription_cancel_scheduled'
      } else if (subscriptionAction === 'cancelNow') {
        nextStatus = 'canceled'
        nextEndsAt = now.toISOString()
        nextCancelAt = now.toISOString()
        billingEventType = 'subscription_canceled'
      } else if (subscriptionAction === 'resume') {
        nextStatus = 'active'
        nextCancelAt = null
        if (!nextEndsAt || new Date(nextEndsAt).getTime() <= now.getTime()) {
          nextEndsAt = addBillingPeriodIso(now, nextBillingPeriod)
        }
        billingEventType = 'subscription_resumed'
      } else if (subscriptionAction === 'renewCycle') {
        nextStatus = 'active'
        nextCancelAt = null
        nextEndsAt = addBillingPeriodIso(now, nextBillingPeriod)
        billingEventType = 'subscription_renewed'
      }

      const subscriptionPayload = {
        plan_id: planId,
        status: nextStatus,
        billing_period: nextBillingPeriod,
        starts_at: nextStartsAt,
        ends_at: nextEndsAt,
        cancel_at: nextCancelAt,
      }

      let subscriptionId = currentSubscription?.id ? String(currentSubscription.id) : null
      if (currentSubscription?.id) {
        const { error: subscriptionError } = await supabase
          .from('organization_subscriptions')
          .update(subscriptionPayload)
          .eq('id', currentSubscription.id)
        if (subscriptionError) throw subscriptionError
      } else if (planId) {
        const { data: createdSubscription, error: subscriptionError } = await supabase
          .from('organization_subscriptions')
          .insert([
            {
              organization_id: organizationId,
              ...subscriptionPayload,
            },
          ])
          .select('id')
          .single()
        if (subscriptionError) throw subscriptionError
        subscriptionId = String((createdSubscription as any)?.id || '') || null
      }

      const currentPlanId = currentSubscription?.plan_id ? String(currentSubscription.plan_id) : null
      if (planId && currentPlanId && planId !== currentPlanId) {
        await writeBillingEvent({
          supabase,
          organizationId,
          subscriptionId,
          eventType: 'plan_changed',
          status: nextStatus,
          billingPeriod: nextBillingPeriod,
          note: billingNote || 'Тариф организации изменён.',
          createdByUserId: access.user?.id || null,
          payload: {
            previous_plan_id: currentPlanId,
            next_plan_id: planId,
          },
        })
      }

      if (billingEventType) {
        await writeBillingEvent({
          supabase,
          organizationId,
          subscriptionId,
          eventType: billingEventType,
          status: nextStatus,
          amount: invoiceAmount,
          currency: body?.currency?.trim() || null,
          billingPeriod: nextBillingPeriod,
          note: billingNote,
          createdByUserId: access.user?.id || null,
          payload: {
            trial_days: subscriptionAction === 'startTrial' ? trialDays : undefined,
            action: subscriptionAction,
          },
        })
      } else if (
        typeof body?.subscriptionStatus === 'string' ||
        typeof body?.billingPeriod === 'string' ||
        typeof body?.subscriptionEndsAt === 'string' ||
        typeof body?.cancelAt === 'string'
      ) {
        await writeBillingEvent({
          supabase,
          organizationId,
          subscriptionId,
          eventType: 'subscription_updated',
          status: nextStatus,
          amount: invoiceAmount,
          currency: body?.currency?.trim() || null,
          billingPeriod: nextBillingPeriod,
          note: billingNote || 'Параметры подписки обновлены вручную.',
          createdByUserId: access.user?.id || null,
        })
      }
    }

    const data = await loadOrganizationHubData({ supabase, organizationIds: [organizationId] })
    return json({
      ok: true,
      organization: data.organizations[0] || null,
      plans: data.plans,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
