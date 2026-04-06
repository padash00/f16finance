import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { canAccessPath, getDefaultAppPath, normalizeStaffRole, isPublicPath } from '@/lib/core/access'
import { SITE_URL } from '@/lib/core/site'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { fetchLinkedCustomersForUser } from '@/lib/server/linked-customers'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const AUTH_SELF_SERVICE_PATHS = [
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/auth/callback',
  '/auth/complete',
] as const

function normalizeHost(hostHeader: string | null) {
  return String(hostHeader || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
}

function isStaticAsset(pathname: string) {
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico') return true
  return /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff|woff2|ttf|eot)$/i.test(pathname)
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Не трогаем статику и внутренние next-файлы, чтобы не ломать дизайн
  if (isStaticAsset(pathname)) {
    return NextResponse.next()
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
  const apexHost = new URL(SITE_URL).hostname.toLowerCase()
  const requestHost = normalizeHost(request.headers.get('host'))

  if (url.pathname.startsWith('/api/')) {
    return response
  }

  if (requestHost && requestHost !== apexHost && requestHost !== `www.${apexHost}`) {
    url.protocol = new URL(SITE_URL).protocol
    url.host = apexHost
    return NextResponse.redirect(url)
  }

  if (!user) {
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
    .eq('is_active', true)
    .maybeSingle()

  const operatorJoin = operatorAuth?.operators as { id?: string; name?: string; is_active?: boolean } | { id?: string; name?: string; is_active?: boolean }[] | null | undefined
  const operatorRow = Array.isArray(operatorJoin) ? operatorJoin[0] : operatorJoin
  const operatorRecordActive = operatorRow?.is_active !== false

  const isStaff = isSuperAdmin || !!staffMember
  const isOperator = !!(operatorAuth && operatorRecordActive)
  const linkedCustomers =
    !isSuperAdmin && !staffMember && !isOperator
      ? await fetchLinkedCustomersForUser(supabase, user.id)
      : []
  const isCustomer = !isSuperAdmin && !staffMember && !isOperator && linkedCustomers.length > 0

  let rolePermissionOverrides: Array<{ path: string; enabled: boolean }> = []

  const adminSupabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : supabase

  if (!isSuperAdmin && (staffRole === 'manager' || staffRole === 'marketer' || staffRole === 'owner')) {
    try {
      const { data } = await adminSupabase
        .from('role_permissions')
        .select('path, enabled')
        .eq('role', staffRole)

      rolePermissionOverrides = Array.isArray(data)
        ? data
            .filter((item: any) => item?.path)
            .map((item: any) => ({
              path: String(item.path),
              enabled: item.enabled !== false,
            }))
        : []
    } catch {
      rolePermissionOverrides = []
    }
  }

  const defaultPath = getDefaultAppPath({
    isSuperAdmin,
    isStaff,
    isOperator,
    isCustomer,
    staffRole,
    rolePermissionOverrides,
  })

  if (AUTH_SELF_SERVICE_PATHS.some((path) => url.pathname.startsWith(path))) {
    return response
  }

  if (
    url.pathname === '/platform' ||
    url.pathname.startsWith('/platform/') ||
    url.pathname === '/select-organization'
  ) {
    url.pathname = defaultPath
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/operator-login')) {
    if (defaultPath === '/login' || defaultPath.startsWith('/login')) {
      return response
    }
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  const requestedPath = url.pathname
  const hasAccess = canAccessPath({
    pathname: requestedPath,
    isStaff,
    isOperator,
    isCustomer,
    staffRole,
    isSuperAdmin,
    rolePermissionOverrides,
  })

  if (requestedPath === '/') {
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  if (!hasAccess) {
    if (!requestedPath.startsWith('/unauthorized')) {
      url.pathname = '/unauthorized'
      return NextResponse.redirect(url)
    }
    return response
  }

  if (requestedPath.startsWith('/unauthorized') && hasAccess) {
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  return response
}
