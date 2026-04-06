import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { normalizeStaffRole, staffRoleHasCapability, type StaffCapability, type StaffRole } from '@/lib/core/access'
import { resolveRequestAuthPersona, type RequestAuthPersonaKind } from '@/lib/server/auth-persona'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { fetchLinkedCustomersForUser, type LinkedCustomerRow } from '@/lib/server/linked-customers'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import {
  ACTIVE_ORGANIZATION_COOKIE,
  resolveActiveOrganizationSubscription,
  selectActiveOrganization,
  resolveUserOrganizations,
  type OrganizationSubscription,
  type OrganizationAccess,
} from '@/lib/server/organizations'
import { resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!header) return map

  for (const chunk of header.split(';')) {
    const [rawName, ...rawValue] = chunk.trim().split('=')
    if (!rawName) continue
    map.set(rawName, rawValue.join('='))
  }

  return map
}

function getBearerToken(request: Request): string | null {
  const raw = request.headers.get('authorization') || ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function createRequestSupabaseClient(request: Request) {
  const bearerToken = getBearerToken(request)
  if (bearerToken) {
    return createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
      global: {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }

  const cookieMap = parseCookies(request.headers.get('cookie'))

  return createServerClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      get(name: string) {
        return cookieMap.get(name)
      },
      async set(name: string, value: string, options: CookieOptions) {
        try {
          ;(await cookies()).set(name, value, options as any)
        } catch {
          // no-op if cookies can't be set (e.g. headers already sent)
        }
      },
      async remove(name: string, options: CookieOptions) {
        try {
          ;(await cookies()).delete({ name, ...options } as any)
        } catch {
          // no-op if cookies can't be deleted
        }
      },
    },
  })
}

export async function getRequestUser(request: Request) {
  const bearerToken = getBearerToken(request)
  if (bearerToken && hasAdminSupabaseCredentials()) {
    const { data } = await createAdminSupabaseClient().auth.getUser(bearerToken)
    return data.user
  }

  const supabase = createRequestSupabaseClient(request)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export type GetRequestAccessContextOptions = {
  /** Разрешить контекст для гостя (`customers.auth_user_id`). По умолчанию false — только staff/оператор/super-admin. */
  allowCustomer?: boolean
}

export async function getRequestAccessContext(
  request: Request,
  options?: GetRequestAccessContextOptions,
): Promise<
  | {
      response: NextResponse
    }
  | {
      supabase: ReturnType<typeof createRequestSupabaseClient>
      user: Awaited<ReturnType<typeof getRequestUser>>
      isSuperAdmin: boolean
      staffMember: any | null
      staffRole: StaffRole
      operatorAuth: {
        id: string
        operator_id: string
        username?: string | null
        role?: string | null
      } | null
      isCustomer: boolean
      linkedCustomers: LinkedCustomerRow[]
      persona: RequestAuthPersonaKind
      requestedOrganizationId: string | null
      organizationHubRequired: boolean
      organizationSelectionRequired: boolean
      organizations: OrganizationAccess[]
      activeOrganization: OrganizationAccess | null
      activeSubscription: OrganizationSubscription
    }
> {
  const supabase = createRequestSupabaseClient(request)
  const cookieMap = parseCookies(request.headers.get('cookie'))
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const isSuperAdmin = isAdminEmail(user.email)
  const { data: operatorAuth } = await supabase
    .from('operator_auth')
    .select('id, operator_id, username, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()
  const staffMember = isSuperAdmin ? null : await resolveStaffByUser(supabase, user)
  const linkedCustomers =
    !isSuperAdmin && !staffMember && !operatorAuth ? await fetchLinkedCustomersForUser(supabase, user.id) : []

  const customerCompanyIds = linkedCustomers.map((c) => c.company_id).filter((id): id is string => Boolean(id))

  const organizationAccess = await resolveUserOrganizations({
    user,
    isSuperAdmin,
    staffMember,
    operatorId: String((operatorAuth as any)?.operator_id || '') || null,
    customerCompanyIds: customerCompanyIds.length ? customerCompanyIds : null,
  })
  const hostOrganization = await resolveOrganizationByHost(request.headers.get('host'))
  const requestedOrganizationId = hostOrganization?.id || cookieMap.get(ACTIVE_ORGANIZATION_COOKIE) || null
  const activeOrganization = selectActiveOrganization({
    organizations: organizationAccess.organizations,
    requestedOrganizationId,
  })
  const hostOrganizationLocked = Boolean(hostOrganization?.id)
  const hostOrganizationAccessible =
    !hostOrganizationLocked || isSuperAdmin || organizationAccess.organizations.some((item) => item.id === hostOrganization?.id)

  if (!hostOrganizationAccessible) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const activeSubscription = await resolveActiveOrganizationSubscription({
    activeOrganizationId: activeOrganization?.id || null,
  })
  const organizationHubRequired = false
  const organizationSelectionRequired = false

  if (isSuperAdmin) {
    return {
      supabase,
      user,
      isSuperAdmin: true,
      staffMember: null,
      staffRole: 'owner',
      operatorAuth: null,
      isCustomer: false,
      linkedCustomers: [],
      persona: 'super_admin',
      requestedOrganizationId,
      organizationHubRequired,
      organizationSelectionRequired,
      organizations: organizationAccess.organizations,
      activeOrganization,
      activeSubscription,
    }
  }

  const isCustomer = !staffMember && !operatorAuth && linkedCustomers.length > 0

  if (!staffMember && !operatorAuth && !isCustomer) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  if (isCustomer && !options?.allowCustomer) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const persona = resolveRequestAuthPersona({
    isSuperAdmin: false,
    staffMember,
    operatorAuth,
    linkedCustomers,
  })!

  return {
    supabase,
    user,
    isSuperAdmin: false,
    staffMember,
    staffRole: normalizeStaffRole(staffMember?.role),
    operatorAuth: operatorAuth
      ? {
          id: String((operatorAuth as any).id),
          operator_id: String((operatorAuth as any).operator_id),
          username: (operatorAuth as any).username || null,
          role: (operatorAuth as any).role || null,
        }
      : null,
    isCustomer,
    linkedCustomers,
    persona,
    requestedOrganizationId,
    organizationHubRequired,
    organizationSelectionRequired,
    organizations: organizationAccess.organizations,
    activeOrganization,
    activeSubscription,
  }
}

export async function requireAdminRequest(request: Request) {
  const context = await getRequestAccessContext(request)
  if ('response' in context) return context.response
  return null
}

export async function requireStaffCapabilityRequest(request: Request, capability: StaffCapability) {
  const context = await getRequestAccessContext(request)
  if ('response' in context) return context.response

  if (context.isSuperAdmin) {
    return null
  }

  if (!staffRoleHasCapability(context.staffRole, capability)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return null
}

export async function requireOperatorAuthRow(request: Request, authId: string) {
  const supabase = createRequestSupabaseClient(request)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('operator_auth')
    .select('id')
    .eq('id', authId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return null
}

export async function getRequestOperatorContext(request: Request): Promise<
  | {
      response: NextResponse
    }
  | {
      supabase: ReturnType<typeof createRequestSupabaseClient>
      user: Awaited<ReturnType<typeof getRequestUser>>
      operatorAuth: {
        id: string
        operator_id: string
        username?: string | null
        role?: string | null
      }
      operator: {
        id: string
        name: string
        short_name: string | null
        telegram_chat_id: string | null
        operator_profiles?: { full_name?: string | null }[] | null
      }
    }
> {
  const supabase = createRequestSupabaseClient(request)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const { data: operatorAuth, error: authError } = await supabase
    .from('operator_auth')
    .select('id, operator_id, username, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (authError || !operatorAuth?.operator_id) {
    return {
      response: NextResponse.json({ error: 'operator-auth-disabled' }, { status: 403 }),
    }
  }

  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(*)')
    .eq('id', operatorAuth.operator_id)
    .maybeSingle()

  if (operatorError || !operator) {
    return {
      response: NextResponse.json({ error: 'operator-not-found' }, { status: 404 }),
    }
  }

  if (operator.is_active === false) {
    return {
      response: NextResponse.json({ error: 'operator-inactive' }, { status: 403 }),
    }
  }

  return {
    supabase,
    user,
    operatorAuth,
    operator,
  }
}

export type OperatorLeadAssignment = {
  id: string
  operator_id: string
  company_id: string
  role_in_company: 'senior_operator' | 'senior_cashier'
  is_primary: boolean
  is_active: boolean
  notes: string | null
  company?: {
    id: string
    name: string
    code: string | null
  } | null
}

export async function listActiveOperatorLeadAssignments(supabase: ReturnType<typeof createRequestSupabaseClient>, operatorId: string) {
  const { data, error } = await supabase
    .from('operator_company_assignments')
    .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes, company:company_id(id, name, code)')
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .in('role_in_company', ['senior_operator', 'senior_cashier'])
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data || []) as unknown[]).map((item: any) => ({
    ...item,
    company: Array.isArray(item.company) ? item.company[0] || null : item.company || null,
  })) as OperatorLeadAssignment[]
}

export async function getRequestOperatorLeadContext(request: Request): Promise<
  | {
      response: NextResponse
    }
  | (Awaited<ReturnType<typeof getRequestOperatorContext>> extends infer T
      ? T extends { response: NextResponse }
        ? never
        : T & { leadAssignments: OperatorLeadAssignment[] }
      : never)
> {
  const context = await getRequestOperatorContext(request)
  if ('response' in context) {
    return context
  }

  const leadAssignments = await listActiveOperatorLeadAssignments(context.supabase, context.operator.id)
  if (leadAssignments.length === 0) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return {
    ...context,
    leadAssignments,
  }
}

export async function getRequestCustomerContext(request: Request): Promise<
  | {
      response: NextResponse
    }
  | (Awaited<ReturnType<typeof getRequestAccessContext>> extends infer T
      ? T extends { response: NextResponse }
        ? never
        : T & {
            linkedCustomerIds: string[]
            linkedCompanyIds: string[]
          }
      : never)
> {
  const context = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in context) return context

  if (!context.isCustomer) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const linkedCustomerIds = context.linkedCustomers.map((item) => item.id).filter(Boolean)
  if (!linkedCustomerIds.length) {
    return {
      response: NextResponse.json({ error: 'customer-not-linked' }, { status: 403 }),
    }
  }

  const linkedCompanyIds = context.linkedCustomers
    .map((item) => item.company_id)
    .filter((item): item is string => Boolean(item))

  return {
    ...context,
    linkedCustomerIds,
    linkedCompanyIds,
  }
}
