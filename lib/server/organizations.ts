import 'server-only'

import type { User } from '@supabase/supabase-js'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const ACTIVE_ORGANIZATION_COOKIE = 'oc_org'

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
  status: string
}

export type OrganizationAccessRole = 'super_admin' | 'owner' | 'manager' | 'marketer' | 'operator' | 'other'

export type OrganizationAccess = OrganizationSummary & {
  accessRole: OrganizationAccessRole
  isDefault: boolean
  source: 'super_admin' | 'staff' | 'operator'
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
}) {
  const { user, isSuperAdmin, staffMember, operatorId } = params
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

export async function resolveCompanyScope(params: {
  activeOrganizationId?: string | null
  requestedCompanyId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, requestedCompanyId, isSuperAdmin } = params

  if (isSuperAdmin) {
    return {
      allowedCompanyIds: requestedCompanyId ? [requestedCompanyId] : null,
      organizationId: activeOrganizationId || null,
    }
  }

  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('organization_id', activeOrganizationId)

  if (error) throw error

  const allowedCompanyIds = (data || []).map((row: any) => String(row.id))
  if (requestedCompanyId) {
    if (!allowedCompanyIds.includes(requestedCompanyId)) {
      throw new Error('forbidden-company')
    }

    return {
      allowedCompanyIds: [requestedCompanyId],
      organizationId: activeOrganizationId,
    }
  }

  return {
    allowedCompanyIds,
    organizationId: activeOrganizationId,
  }
}

export async function listOrganizationCompanyIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params
  if (isSuperAdmin) return null
  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('organization_id', activeOrganizationId)

  if (error) throw error
  return (data || []).map((row: any) => String(row.id))
}

export async function listOrganizationCompanyCodes(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params
  if (isSuperAdmin) return null
  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const { data, error } = await supabase
    .from('companies')
    .select('code')
    .eq('organization_id', activeOrganizationId)
    .not('code', 'is', null)

  if (error) throw error
  return (data || [])
    .map((row: any) => String(row.code || '').trim())
    .filter(Boolean)
}

export async function listOrganizationOperatorIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params
  if (isSuperAdmin) return null
  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const { data, error } = await supabase
    .from('operator_company_assignments')
    .select('operator_id, company:company_id(organization_id)')
    .eq('is_active', true)

  if (error) throw error

  return Array.from(
    new Set(
      (data || [])
        .filter((row: any) => {
          const company = Array.isArray(row.company) ? row.company[0] || null : row.company || null
          return String(company?.organization_id || '') === activeOrganizationId
        })
        .map((row: any) => String(row.operator_id || ''))
        .filter(Boolean),
    ),
  )
}

export async function listOrganizationStaffIds(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
}) {
  const { activeOrganizationId, isSuperAdmin } = params
  if (isSuperAdmin) return null
  if (!activeOrganizationId) {
    throw new Error('active-organization-required')
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
  if (!supabase) {
    throw new Error('organization-scope-unavailable')
  }

  const { data, error } = await supabase
    .from('organization_members')
    .select('staff_id')
    .eq('organization_id', activeOrganizationId)
    .not('staff_id', 'is', null)

  if (error) throw error
  return Array.from(new Set((data || []).map((row: any) => String(row.staff_id || '')).filter(Boolean)))
}

export async function ensureOrganizationOperatorAccess(params: {
  activeOrganizationId?: string | null
  isSuperAdmin?: boolean
  operatorId: string
}) {
  const { activeOrganizationId, isSuperAdmin, operatorId } = params
  if (isSuperAdmin) return
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
  if (isSuperAdmin) return
  const allowedStaffIds = await listOrganizationStaffIds({ activeOrganizationId, isSuperAdmin })
  if (!allowedStaffIds?.includes(staffId)) {
    throw new Error('forbidden-staff')
  }
}
