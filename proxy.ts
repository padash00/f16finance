import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { canAccessPath, getDefaultAppPath, normalizeStaffRole, isPublicPath } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'

const AUTH_SELF_SERVICE_PATHS = ['/forgot-password', '/reset-password', '/set-password', '/auth/callback', '/auth/complete'] as const

export async function proxy(request: NextRequest) {
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
    .maybeSingle()

  const isStaff = isSuperAdmin || !!staffMember
  const isOperator = !!operatorAuth
  const defaultPath = getDefaultAppPath({ isSuperAdmin, isStaff, isOperator, staffRole })

  if (AUTH_SELF_SERVICE_PATHS.some((path) => url.pathname.startsWith(path))) {
    return response
  }

  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/operator-login')) {
    url.pathname = defaultPath
    return NextResponse.redirect(url)
  }

  const requestedPath = url.pathname
  const hasAccess = canAccessPath({
    pathname: requestedPath,
    isStaff,
    isOperator,
    staffRole,
    isSuperAdmin,
  })

  if (requestedPath === '/' && !hasAccess) {
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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
