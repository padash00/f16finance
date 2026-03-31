import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import {
  canAccessPath,
  getDefaultAppPath,
  getRequiredSubscriptionFeature,
  hasSubscriptionFeature,
  normalizeStaffRole,
  isPublicPath,
  type SubscriptionFeature,
} from '@/lib/core/access'
import { APEX_MAINTENANCE_MODE, SITE_URL } from '@/lib/core/site'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

const AUTH_SELF_SERVICE_PATHS = ['/forgot-password', '/reset-password', '/set-password', '/auth/callback', '/auth/complete'] as const
const ACTIVE_ORGANIZATION_COOKIE = 'oc_org'

function getPrimarySiteHosts() {
  const url = new URL(SITE_URL)
  const hostname = url.hostname.toLowerCase()
  return new Set([hostname, `www.${hostname.replace(/^www\./, '')}`])
}

function shouldServeApexMaintenance(hostHeader: string | null) {
  if (!APEX_MAINTENANCE_MODE) return false
  const host = String(hostHeader || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
  if (!host) return false
  return getPrimarySiteHosts().has(host)
}

function clearSessionCookies(request: NextRequest, response: NextResponse) {
  const cookieNames = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => name === ACTIVE_ORGANIZATION_COOKIE || name.startsWith('sb-'))

  for (const name of cookieNames) {
    response.cookies.set({
      name,
      value: '',
      path: '/',
      expires: new Date(0),
    })
  }

  return response
}

function setActiveOrganizationCookie(response: NextResponse, organizationId: string | null) {
  if (!organizationId) return response
  response.cookies.set({
    name: ACTIVE_ORGANIZATION_COOKIE,
    value: organizationId,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

function dedupeOrganizationIds(items: Array<{ id: string; isDefault: boolean }>) {
  const map = new Map<string, { id: string; isDefault: boolean }>()
  for (const item of items) {
    const current = map.get(item.id)
    if (!current) {
      map.set(item.id, item)
      continue
    }
    if (!current.isDefault && item.isDefault) {
      map.set(item.id, item)
    }
  }
  return Array.from(map.values())
}

async function resolveAccessibleOrganizations(params: {
  supabase: ReturnType<typeof createServerClient>
  isSuperAdmin: boolean
  staffMember: any | null
  operatorAuth: any | null
  userEmail?: string | null
}) {
  const { supabase, isSuperAdmin, staffMember, operatorAuth, userEmail } = params
  const organizations: Array<{ id: string; isDefault: boolean }> = []

  if (isSuperAdmin) {
    const { data } = await supabase.from('organizations').select('id').order('name', { ascending: true })
    for (const [index, row] of (data || []).entries()) {
      organizations.push({ id: String((row as any).id), isDefault: index === 0 })
    }
  }

  if (staffMember?.id) {
    const { data } = await supabase
      .from('organization_members')
      .select('organization_id, is_default')
      .eq('staff_id', staffMember.id)
      .eq('status', 'active')
    for (const row of data || []) {
      organizations.push({
        id: String((row as any).organization_id),
        isDefault: Boolean((row as any).is_default),
      })
    }
  }

  if (userEmail) {
    const { data } = await supabase
      .from('organization_members')
      .select('organization_id, is_default')
      .eq('email', userEmail)
      .eq('status', 'active')
    for (const row of data || []) {
      organizations.push({
        id: String((row as any).organization_id),
        isDefault: Boolean((row as any).is_default),
      })
    }
  }

  if (operatorAuth?.operator_id) {
    const { data } = await supabase
      .from('operator_company_assignments')
      .select('company:company_id(organization_id)')
      .eq('operator_id', operatorAuth.operator_id)
      .eq('is_active', true)
    for (const row of data || []) {
      const company = Array.isArray((row as any).company) ? (row as any).company[0] || null : (row as any).company || null
      if (company?.organization_id) {
        organizations.push({
          id: String(company.organization_id),
          isDefault: organizations.length === 0,
        })
      }
    }
  }

  return dedupeOrganizationIds(organizations)
}

async function resolveActiveSubscriptionFeatures(params: {
  supabase: ReturnType<typeof createServerClient>
  organizationId?: string | null
}) {
  const { supabase, organizationId } = params
  if (!organizationId) return {}

  const { data } = await supabase
    .from('organization_subscriptions')
    .select('plan:plan_id(features)')
    .eq('organization_id', organizationId)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const plan = Array.isArray((data as any)?.plan) ? (data as any).plan[0] || null : (data as any)?.plan || null
  return ((plan?.features as Partial<Record<SubscriptionFeature, boolean>> | null) || {})
}

export async function proxy(request: NextRequest) {
  const maintenanceMode = shouldServeApexMaintenance(request.headers.get('host'))
  if (maintenanceMode && !request.nextUrl.pathname.startsWith('/api/')) {
    const url = request.nextUrl.clone()
    if (url.pathname !== '/maintenance') {
      url.pathname = '/maintenance'
      url.search = ''
      return clearSessionCookies(request, NextResponse.redirect(url))
    }
    return clearSessionCookies(
      request,
      NextResponse.next({
        request: {
          headers: request.headers,
        },
      }),
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    const url = request.nextUrl.clone()

    if (url.pathname.startsWith('/api/')) {
      return NextResponse.next()
    }

    if (url.pathname !== '/setup-required') {
      url.pathname = '/setup-required'
      return NextResponse.redirect(url)
    }

    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options })
        response = NextResponse.next({
          request: { headers: request.headers },
        })
        response.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options })
        response = NextResponse.next({
          request: { headers: request.headers },
        })
        response.cookies.set({ name, value: '', ...options })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()

  if (url.pathname.startsWith('/api/')) {
    return response
  }

  // Resolve host-based organization early so we can use it in unauthenticated flow
  const hostOrganization = await resolveOrganizationByHost(request.headers.get('host'))
  const hostOrganizationId = hostOrganization?.id || null

  if (!user) {
    // On a tenant subdomain unauthenticated users should always see login, not the platform marketing page
    if (hostOrganizationId && isPublicPath(url.pathname)) {
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    if (isPublicPath(url.pathname)) {
      return response
    }
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const isSuperAdmin = isAdminEmail(user.email)
  const staffMember = isSuperAdmin ? null : await resolveStaffByUser(supabase, user)
  const staffRole = normalizeStaffRole(staffMember?.role)

  const { data: operatorAuth } = await supabase
    .from('operator_auth')
    .select(
      `
      operator_id,
      role,
      operators (
        id,
        name,
        is_active
      )
    `,
    )
    .eq('user_id', user.id)
    .maybeSingle()

  const isStaff = isSuperAdmin || !!staffMember
  const isOperator = !!operatorAuth
  const organizations = await resolveAccessibleOrganizations({
    supabase,
    isSuperAdmin,
    staffMember,
    operatorAuth,
    userEmail: user.email?.trim().toLowerCase() || null,
  })
  const hasHostOrganization = hostOrganizationId
    ? isSuperAdmin || organizations.some((organization) => organization.id === hostOrganizationId)
    : false
  if (hostOrganizationId && !hasHostOrganization) {
    url.pathname = '/login'
    url.search = ''
    return clearSessionCookies(request, NextResponse.redirect(url))
  }
  const requestedOrganizationId = request.cookies.get(ACTIVE_ORGANIZATION_COOKIE)?.value || null
  const hasRequestedOrganization = requestedOrganizationId
    ? organizations.some((organization) => organization.id === requestedOrganizationId)
    : false
  const defaultOrganizationId =
    organizations.find((organization) => organization.isDefault)?.id || organizations[0]?.id || null
  const activeOrganizationId = hostOrganizationId
    ? hostOrganizationId
    : hasRequestedOrganization
      ? requestedOrganizationId
      : !isSuperAdmin
        ? defaultOrganizationId
        : null
  const needsOrganizationSelection = isSuperAdmin && organizations.length > 0 && !hostOrganizationId && !hasRequestedOrganization
  const organizationHubRequired = isSuperAdmin && organizations.length > 0 && !hostOrganizationId
  const subscriptionFeatures = isSuperAdmin
    ? null
    : await resolveActiveSubscriptionFeatures({
        supabase,
        organizationId: activeOrganizationId,
      })
  const defaultPath = getDefaultAppPath({ isSuperAdmin, isStaff, isOperator, staffRole })

  if (AUTH_SELF_SERVICE_PATHS.some((path) => url.pathname.startsWith(path))) {
    return setActiveOrganizationCookie(response, activeOrganizationId)
  }

  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/operator-login')) {
    if (organizationHubRequired) {
      url.pathname = '/select-organization'
      return NextResponse.redirect(url)
    }
    // Guard: if defaultPath resolves back to /login (unresolved role), don't redirect — prevents infinite loop
    if (defaultPath === '/login' || defaultPath.startsWith('/login')) {
      return setActiveOrganizationCookie(response, activeOrganizationId)
    }
    url.pathname = defaultPath
    return setActiveOrganizationCookie(NextResponse.redirect(url), activeOrganizationId)
  }

  const requestedPath = url.pathname
  const requestedTarget = `${requestedPath}${url.search}`

  if (requestedPath === '/select-organization') {
    if (!isSuperAdmin || hostOrganizationId) {
      url.pathname = defaultPath
      url.search = ''
      return setActiveOrganizationCookie(NextResponse.redirect(url), activeOrganizationId)
    }
    return setActiveOrganizationCookie(response, activeOrganizationId)
  }

  if (!organizations.length) {
    url.pathname = '/select-organization'
    return NextResponse.redirect(url)
  }

  if (needsOrganizationSelection) {
    const next = `${requestedPath}${url.search}`
    url.pathname = '/select-organization'
    url.search = isPublicPath(next) ? '' : `?next=${encodeURIComponent(next)}`
    return NextResponse.redirect(url)
  }

  const hasAccess = canAccessPath({
    pathname: requestedPath,
    isStaff,
    isOperator,
    staffRole,
    isSuperAdmin,
    subscriptionFeatures,
  })
  const requiredSubscriptionFeature = getRequiredSubscriptionFeature(requestedPath)
  const missingSubscriptionFeature = !isSuperAdmin && !hasSubscriptionFeature(subscriptionFeatures, requiredSubscriptionFeature)

  if (requestedPath === '/') {
    url.pathname = organizationHubRequired ? '/select-organization' : defaultPath
    return setActiveOrganizationCookie(NextResponse.redirect(url), activeOrganizationId)
  }

  if (!hasAccess) {
    if (!requestedPath.startsWith('/unauthorized')) {
      url.pathname = '/unauthorized'
      if (missingSubscriptionFeature && requiredSubscriptionFeature) {
        url.searchParams.set('kind', 'plan')
        url.searchParams.set('feature', requiredSubscriptionFeature)
        url.searchParams.set('next', requestedTarget)
      } else {
        url.search = ''
      }
      return setActiveOrganizationCookie(NextResponse.redirect(url), activeOrganizationId)
    }
    return setActiveOrganizationCookie(response, activeOrganizationId)
  }

  if (requestedPath.startsWith('/unauthorized') && hasAccess) {
    url.pathname = defaultPath
    return setActiveOrganizationCookie(NextResponse.redirect(url), activeOrganizationId)
  }

  return setActiveOrganizationCookie(response, activeOrganizationId)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
