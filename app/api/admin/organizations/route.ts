import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type CreateOrganizationBody = {
  name?: string | null
  slug?: string | null
  legalName?: string | null
  planCode?: string | null
  createPrimaryDomain?: boolean | null
}

type UpdateOrganizationBody = {
  organizationId?: string | null
  name?: string | null
  slug?: string | null
  legalName?: string | null
  organizationStatus?: string | null
  planCode?: string | null
  subscriptionStatus?: string | null
  billingPeriod?: string | null
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
    }
  }

  const [{ data: organizationsData, error: organizationsError }, { data: subscriptionsData, error: subscriptionsError }, { data: companiesData, error: companiesError }, { data: membersData, error: membersError }, { data: plansData, error: plansError }] =
    await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, legal_name, status, created_at')
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
    ])

  if (organizationsError) throw organizationsError
  if (subscriptionsError) throw subscriptionsError
  if (companiesError) throw companiesError
  if (membersError) throw membersError
  if (plansError) throw plansError

  const subscriptionsByOrganization = new Map<string, any>()
  for (const row of subscriptionsData || []) {
    const organizationId = String((row as any).organization_id || '')
    if (!organizationId || subscriptionsByOrganization.has(organizationId)) continue
    subscriptionsByOrganization.set(organizationId, row)
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

  return {
    organizations: (organizationsData || []).map((row: any) => {
      const organizationId = String(row.id || '')
      const subscription = subscriptionsByOrganization.get(organizationId)
      const plan = subscription?.plan
      const companies = companiesByOrganization.get(organizationId) || []

      return {
        id: organizationId,
        name: String(row.name || ''),
        slug: String(row.slug || ''),
        legalName: row.legal_name || null,
        status: String(row.status || 'active'),
        createdAt: row.created_at || null,
        companyCount: companies.length,
        memberCount: memberCounts.get(organizationId) || 0,
        companies,
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
    }),
    plans: ((plansData || []) as SubscriptionPlanRow[]).map(normalizePlan),
  }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = createAdminSupabaseClient()
    const organizationIds = access.isSuperAdmin ? access.organizations.map((item) => item.id) : access.organizations.map((item) => item.id)
    const data = await loadOrganizationHubData({ supabase, organizationIds })
    return json({
      ok: true,
      organizations: data.organizations,
      plans: data.plans,
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
          },
        },
      ])
      .select('id, name, slug, status')
      .single()

    if (organizationError) throw organizationError

    const organizationId = String((organization as any).id)

    const { error: subscriptionError } = await supabase
      .from('organization_subscriptions')
      .insert([
        {
          organization_id: organizationId,
          plan_id: String(plan.id),
          status: 'trialing',
          billing_period: 'monthly',
          metadata: {
            created_from: 'project-hub',
          },
        },
      ])
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
            host: slug,
            is_primary: true,
          },
        ])
      if (domainError) {
        console.warn('Primary tenant domain was not created', domainError)
      }
    }

    return json({
      ok: true,
      organization: {
        id: organizationId,
        name: String((organization as any).name || name),
        slug: String((organization as any).slug || slug),
        status: String((organization as any).status || 'active'),
        planCode: String(plan.code),
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
        typeof body?.billingPeriod === 'string')

    if (canUpdateSubscription) {
      const { data: currentSubscription, error: currentSubscriptionError } = await supabase
        .from('organization_subscriptions')
        .select('id, plan_id, status, billing_period')
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

      const subscriptionPayload = {
        plan_id: planId,
        status: typeof body?.subscriptionStatus === 'string' && body.subscriptionStatus.trim()
          ? body.subscriptionStatus.trim()
          : currentSubscription?.status || 'active',
        billing_period: typeof body?.billingPeriod === 'string' && body.billingPeriod.trim()
          ? body.billingPeriod.trim()
          : currentSubscription?.billing_period || 'monthly',
      }

      if (currentSubscription?.id) {
        const { error: subscriptionError } = await supabase
          .from('organization_subscriptions')
          .update(subscriptionPayload)
          .eq('id', currentSubscription.id)
        if (subscriptionError) throw subscriptionError
      } else if (planId) {
        const { error: subscriptionError } = await supabase
          .from('organization_subscriptions')
          .insert([
            {
              organization_id: organizationId,
              ...subscriptionPayload,
            },
          ])
        if (subscriptionError) throw subscriptionError
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
