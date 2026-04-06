import 'server-only'

import type { SupabaseClient, User } from '@supabase/supabase-js'

import type { SubscriptionFeature } from '@/lib/core/access'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const ACTIVE_ORGANIZATION_COOKIE = 'oc_org'

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
  status: string
}

export type OrganizationAccessRole =
  | 'super_admin'
  | 'owner'
  | 'manager'
  | 'marketer'
  | 'operator'
  | 'customer'
  | 'other'

export type OrganizationAccess = OrganizationSummary & {
  accessRole: OrganizationAccessRole
  isDefault: boolean
  source: 'super_admin' | 'staff' | 'operator' | 'customer'
}

export type OrganizationSubscription = {
  id: string
  status: string
  billingPeriod: string
  startsAt: string | null
  endsAt: string | null
  plan: {
    id: string
    code: string
    name: string
    features: Partial<Record<SubscriptionFeature, boolean>>
    limits: Record<string, unknown>
  } | null
} | null

export type OrganizationLimitKey = 'companies' | 'staff' | 'operators' | 'point_projects'

export type OrganizationUsage = Record<OrganizationLimitKey, number>

// Temporary rollback: restore the old F16-style single-tenant behavior
// while the SaaS layer is being redesigned safely.
export const LEGACY_SINGLE_TENANT_MODE = true

const ZERO_ORGANIZATION_USAGE: OrganizationUsage = {
  companies: 0,
  staff: 0,
  operators: 0,
  point_projects: 0,
}

const ORGANIZATION_LIMIT_LABELS: Record<OrganizationLimitKey, string> = {
  companies: 'точек',
  staff: 'сотрудников',
  operators: 'операторов',
  point_projects: 'проектов точек',
}

function parseLimitValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }

  return null
}

function formatUpgradeTarget(subscription: OrganizationSubscription) {
  if (!subscription?.plan?.code || subscription.plan.code === 'enterprise') {
    return 'Enterprise'
  }

  if (subscription.plan.code === 'starter') {
    return 'Growth'
  }

  return 'Enterprise'
}

function normalizeOrganizationRole(value: string | null | undefined): OrganizationAccessRole {
  if (value === 'owner' || value === 'manager' || value === 'marketer' || value === 'operator') {
    return value
  }

  return 'other'
}

function dedupeOrganizations(items: OrganizationAccess[]) {
  const map = new Map<string, OrganizationAccess>()

  for (const item of items) {
    const current = map.get(item.id)
    if (!current) {
      map.set(item.id, item)
      continue
    }

    const next = current.source === 'super_admin'
      ? current
      : item.source === 'super_admin'
        ? item
        : current.isDefault
          ? current
          : item.isDefault
            ? item
            : current

    map.set(item.id, next)
  }

  return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'))
}

export async function resolveUserOrganizations(params: {
  user: User
  isSuperAdmin: boolean
  staffMember?: { id?: string | null; email?: string | null; role?: string | null } | null
  operatorId?: string | null
  /** Companies from linked `customers.auth_user_id` (guest contour). */
  customerCompanyIds?: string[] | null
}) {
  const { user, isSuperAdmin, staffMember, operatorId, customerCompanyIds } = params
  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null

  if (!supabase) {
    return {
      organizations: [] as OrganizationAccess[],
      activeOrganization: null as OrganizationAccess | null,
    }
  }

  const organizations: OrganizationAccess[] = []

  if (isSuperAdmin) {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug, status')
      .order('name', { ascending: true })

    for (const row of data || []) {
      organizations.push({
        id: String((row as any).id),
        name: String((row as any).name || ''),
        slug: String((row as any).slug || ''),
        status: String((row as any).status || 'active'),
        accessRole: 'super_admin',
        isDefault: organizations.length === 0,
        source: 'super_admin',
      })
    }
  }

  const staffId = typeof staffMember?.id === 'string' ? staffMember.id : null
  const staffEmail = typeof staffMember?.email === 'string' ? staffMember.email.trim().toLowerCase() : user.email?.trim().toLowerCase() || null

  if (staffId) {
    const { data } = await supabase
      .from('organization_members')
      .select('organization_id, role, status, is_default, organization:organization_id(id, name, slug, status)')
      .eq('status', 'active')
      .eq('staff_id', staffId)

    for (const row of data || []) {
      const organization = Array.isArray((row as any).organization)
        ? (row as any).organization[0]
        : (row as any).organization

      if (!organization?.id) continue
      if (organization.status === 'suspended') continue

      organizations.push({
        id: String(organization.id),
        name: String(organization.name || ''),
        slug: String(organization.slug || ''),
        status: String(organization.status || 'active'),
        accessRole: normalizeOrganizationRole((row as any).role ?? staffMember?.role),
        isDefault: Boolean((row as any).is_default),
        source: 'staff',
      })
    }
  }

  if (staffEmail) {
    const { data } = await supabase
      .from('organization_members')
      .select('organization_id, role, status, is_default, organization:organization_id(id, name, slug, status)')
      .eq('status', 'active')
      .eq('email', staffEmail)

    for (const row of data || []) {
      const organization = Array.isArray((row as any).organization)
        ? (row as any).organization[0]
        : (row as any).organization

      if (!organization?.id) continue
      if (organization.status === 'suspended') continue

      organizations.push({
        id: String(organization.id),
        name: String(organization.name || ''),
        slug: String(organization.slug || ''),
        status: String(organization.status || 'active'),
        accessRole: normalizeOrganizationRole((row as any).role ?? staffMember?.role),
        isDefault: Boolean((row as any).is_default),
        source: 'staff',
      })
    }
  }

  if (operatorId) {
    const { data } = await supabase
      .from('operator_company_assignments')
      .select('company:company_id(organization_id, organization:organization_id(id, name, slug, status))')
      .eq('operator_id', operatorId)
      .eq('is_active', true)

    for (const row of data || []) {
      const company = Array.isArray((row as any).company)
        ? (row as any).company[0]
        : (row as any).company
      const organization = Array.isArray(company?.organization)
        ? company.organization[0]
        : company?.organization

      if (!organization?.id) continue
      if (organization.status === 'suspended') continue

      organizations.push({
        id: String(organization.id),
        name: String(organization.name || ''),
        slug: String(organization.slug || ''),
        status: String(organization.status || 'active'),
        accessRole: 'operator',
        isDefault: organizations.length === 0,
        source: 'operator',
      })
    }
  }

  const uniqueCustomerCompanyIds = [...new Set((customerCompanyIds || []).filter(Boolean))]
  if (uniqueCustomerCompanyIds.length) {
    const { data } = await supabase
      .from('companies')
      .select('id, organization_id, organization:organization_id(id, name, slug, status)')
      .in('id', uniqueCustomerCompanyIds)

    for (const row of data || []) {
      const organization = Array.isArray((row as any).organization)
        ? (row as any).organization[0]
        : (row as any).organization

      if (!organization?.id) continue
      if (organization.status === 'suspended') continue

      organizations.push({
        id: String(organization.id),
        name: String(organization.name || ''),
        slug: String(organization.slug || ''),
        status: String(organization.status || 'active'),
        accessRole: 'customer',
        isDefault: organizations.length === 0,
        source: 'customer',
      })
    }
  }

  const deduped = dedupeOrganizations(organizations)
  const activeOrganization = deduped.find((item) => item.isDefault) || deduped[0] || null

  return {
    organizations: deduped,
    activeOrganization,
  }
}

export function selectActiveOrganization(params: {
  organizations: OrganizationAccess[]
  requestedOrganizationId?: string | null
}) {
  const { organizations, requestedOrganizationId } = params

  if (!organizations.length) return null
  if (requestedOrganizationId) {
    const directMatch = organizations.find((item) => item.id === requestedOrganizationId)
    if (directMatch) return directMatch
  }

  return organizations.find((item) => item.isDefault) || organizations[0] || null
}

/**
 * Когда SaaS-выбор организации в UI отключён / cookie пустой, но в БД одна организация (классический single-tenant).
 * Если организаций несколько и activeOrganizationId не задан — возвращает null (нужен явный выбор).
 */
export async function resolveEffectiveOrganizationId(params: {
  supabase: SupabaseClient<any, 'public', any>
  activeOrganizationId: string | null
}): Promise<string | null> {
  if (params.activeOrganizationId) return params.activeOrganizationId

  if (!LEGACY_SINGLE_TENANT_MODE) return null

  const { data: orgs, error } = await params.supabase
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })

  if (error) throw error
  const list = orgs || []
  if (list.length === 1) return String((list[0] as { id: string }).id)
  return null
}

export async function resolveActiveOrganizationSubscription(params: {
  activeOrganizationId?: string | null
}) {
  const { activeOrganizationId } = params
  if (!activeOrganizationId) return null

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) return null

  const { data, error } = await supabase
    .from('organization_subscriptions')
    .select(
      'id, status, billing_period, starts_at, ends_at, limits_override, plan:plan_id(id, code, name, features, limits)',
    )
    .eq('organization_id', activeOrganizationId)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const plan = Array.isArray((data as any).plan) ? (data as any).plan[0] || null : (data as any).plan || null
  const limitsOverride = ((data as any).limits_override as Record<string, unknown> | null) || {}
  const mergedLimits = {
    ...(((plan?.limits as Record<string, unknown> | null) || {})),
    ...limitsOverride,
  }

  return {
    id: String((data as any).id || ''),
    status: String((data as any).status || 'active'),
    billingPeriod: String((data as any).billing_period || 'monthly'),
    startsAt: (data as any).starts_at || null,
    endsAt: (data as any).ends_at || null,
    plan: plan
      ? {
          id: String(plan.id || ''),
          code: String(plan.code || ''),
          name: String(plan.name || ''),
          features: ((plan.features as Partial<Record<SubscriptionFeature, boolean>> | null) || {}),
          limits: mergedLimits,
        }
      : null,
  } satisfies OrganizationSubscription
}

export function getOrganizationEffectiveLimits(subscription: OrganizationSubscription) {
  return (subscription?.plan?.limits || {}) as Record<string, unknown>
}

export function getOrganizationLimitValue(params: {
  subscription: OrganizationSubscription
  key: OrganizationLimitKey
}) {
  return parseLimitValue(getOrganizationEffectiveLimits(params.subscription)[params.key])
}

export async function resolveOrganizationUsage(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params
  if (LEGACY_SINGLE_TENANT_MODE) {
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) {
      throw new Error('organization-scope-unavailable')
    }

    const [companiesResult, staffResult, projectAssignmentsResult, operatorResult] = await Promise.all([
      supabase.from('companies').select('id'),
      supabase.from('staff').select('id'),
      supabase.from('point_projects').select('id'),
      supabase.from('operators').select('id').eq('is_active', true),
    ])

    if (companiesResult.error) throw companiesResult.error
    if (staffResult.error) throw staffResult.error
    if (projectAssignmentsResult.error) throw projectAssignmentsResult.error
    if (operatorResult.error) throw operatorResult.error

    return {
      companies: (companiesResult.data || []).length,
      staff: (staffResult.data || []).length,
      operators: (operatorResult.data || []).length,
      point_projects: (projectAssignmentsResult.data || []).length,
    } satisfies OrganizationUsage
  }

  if (isSuperAdmin) return ZERO_ORGANIZATION_USAGE
  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const [companiesResult, staffResult, projectAssignmentsResult, operatorIds] = await Promise.all([
    supabase.from('companies').select('id').eq('organization_id', activeOrganizationId),
    supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', activeOrganizationId)
      .in('status', ['invited', 'active']),
    supabase
      .from('point_project_companies')
      .select('project_id, company:company_id(organization_id)'),
    listOrganizationOperatorIds({ activeOrganizationId, isSuperAdmin }),
  ])

  if (companiesResult.error) throw companiesResult.error
  if (staffResult.error) throw staffResult.error
  if (projectAssignmentsResult.error) throw projectAssignmentsResult.error

  const pointProjects = new Set(
    ((projectAssignmentsResult.data || []) as any[])
      .filter((row) => {
        const company = Array.isArray((row as any).company) ? (row as any).company[0] || null : (row as any).company || null
        return String(company?.organization_id || '') === activeOrganizationId
      })
      .map((row) => String((row as any).project_id || ''))
      .filter(Boolean),
  )

  return {
    companies: (companiesResult.data || []).length,
    staff: (staffResult.data || []).length,
    operators: operatorIds?.length || 0,
    point_projects: pointProjects.size,
  } satisfies OrganizationUsage
}

export async function assertOrganizationLimitAvailable(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
  activeSubscription: OrganizationSubscription
  key: OrganizationLimitKey
  increment?: number
}) {
  const { activeOrganizationId, isSuperAdmin, activeSubscription, key, increment = 1 } = params
  if (isSuperAdmin) return

  const limit = getOrganizationLimitValue({ subscription: activeSubscription, key })
  if (limit === null) return

  const usage = await resolveOrganizationUsage({ activeOrganizationId, isSuperAdmin })
  const currentUsage = usage[key] || 0

  if (currentUsage + increment <= limit) {
    return
  }

  const currentPlanName = activeSubscription?.plan?.name || 'текущий тариф'
  const upgradeTarget = formatUpgradeTarget(activeSubscription)
  throw new Error(
    `Лимит по тарифу на ${ORGANIZATION_LIMIT_LABELS[key]} исчерпан: ${currentUsage}/${limit}. ` +
      `Перейдите на ${upgradeTarget}, чтобы увеличить лимит для организации (${currentPlanName}).`,
  )
}

export async function listOrganizationCompanyIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  let query = supabase.from('companies').select('id')
  if (!LEGACY_SINGLE_TENANT_MODE && !isSuperAdmin && activeOrganizationId) {
    query = query.eq('organization_id', activeOrganizationId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => String(row.id))
}

export async function listOrganizationCompanyCodes(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  let query = supabase.from('companies').select('code')
  if (!LEGACY_SINGLE_TENANT_MODE && !isSuperAdmin && activeOrganizationId) {
    query = query.eq('organization_id', activeOrganizationId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => String(row.code || '')).filter(Boolean)
}

export async function listOrganizationStaffIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  let query = supabase.from('staff').select('id')
  if (!LEGACY_SINGLE_TENANT_MODE && !isSuperAdmin && activeOrganizationId) {
    query = query.eq('organization_id', activeOrganizationId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row: any) => String(row.id))
}

export async function listOrganizationOperatorIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  if (LEGACY_SINGLE_TENANT_MODE || isSuperAdmin || !activeOrganizationId) {
    const { data, error } = await supabase.from('operators').select('id').eq('is_active', true)
    if (error) throw error
    return (data || []).map((row: any) => String(row.id))
  }

  const { data, error } = await supabase
    .from('operator_company_assignments')
    .select('operator_id, company:company_id(organization_id)')
    .eq('is_active', true)

  if (error) throw error

  return Array.from(
    new Set(
      ((data || []) as any[])
        .filter((row) => {
          const company = Array.isArray(row.company) ? row.company[0] || null : row.company || null
          return String(company?.organization_id || '') === activeOrganizationId
        })
        .map((row) => String(row.operator_id || ''))
        .filter(Boolean),
    ),
  )
}

export async function resolveCompanyScope(params: {
  activeOrganizationId?: string | null
  requestedCompanyId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, requestedCompanyId, isSuperAdmin } = params

  if (LEGACY_SINGLE_TENANT_MODE || isSuperAdmin || !activeOrganizationId) {
    return {
      allowedCompanyIds: requestedCompanyId ? [requestedCompanyId] : null,
      organizationId: null,
    }
  }

  const allowedCompanyIds = await listOrganizationCompanyIds({ activeOrganizationId, isSuperAdmin })
  if (requestedCompanyId && !allowedCompanyIds.includes(requestedCompanyId)) {
    throw new Error('company-out-of-scope')
  }

  return {
    allowedCompanyIds: requestedCompanyId ? [requestedCompanyId] : allowedCompanyIds,
    organizationId: activeOrganizationId || null,
  }
}

export async function ensureOrganizationOperatorAccess(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
  operatorId: string
}) {
  const { activeOrganizationId, isSuperAdmin, operatorId } = params
  if (isSuperAdmin && !activeOrganizationId) return
  const allowedOperatorIds = await listOrganizationOperatorIds({ activeOrganizationId, isSuperAdmin })
  if (!allowedOperatorIds?.includes(operatorId)) {
    throw new Error('forbidden-operator')
  }
}

export async function ensureOrganizationStaffAccess(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
  staffId: string
}) {
  const { activeOrganizationId, isSuperAdmin, staffId } = params
  if (isSuperAdmin && !activeOrganizationId) return
  const allowedStaffIds = await listOrganizationStaffIds({ activeOrganizationId, isSuperAdmin })
  if (!allowedStaffIds?.includes(staffId)) {
    throw new Error('forbidden-staff')
  }
}
