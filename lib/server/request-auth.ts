import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'

import { normalizeStaffRole, staffRoleHasCapability, type StaffCapability, type StaffRole } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { requiredEnv } from '@/lib/server/env'

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  if (!header) return cookies

  for (const chunk of header.split(';')) {
    const [rawName, ...rawValue] = chunk.trim().split('=')
    if (!rawName) continue
    cookies.set(rawName, rawValue.join('='))
  }

  return cookies
}

export function createRequestSupabaseClient(request: Request) {
  const cookieMap = parseCookies(request.headers.get('cookie'))

  return createServerClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      get(name: string) {
        return cookieMap.get(name)
      },
      set(_name: string, _value: string, _options: CookieOptions) {},
      remove(_name: string, _options: CookieOptions) {},
    },
  })
}

export async function getRequestUser(request: Request) {
  const supabase = createRequestSupabaseClient(request)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function getRequestAccessContext(request: Request): Promise<
  | {
      response: NextResponse
    }
  | {
      supabase: ReturnType<typeof createRequestSupabaseClient>
      user: Awaited<ReturnType<typeof getRequestUser>>
      isSuperAdmin: boolean
      staffMember: any | null
      staffRole: StaffRole
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

  const isSuperAdmin = isAdminEmail(user.email)
  if (isSuperAdmin) {
    return {
      supabase,
      user,
      isSuperAdmin: true,
      staffMember: null,
      staffRole: 'owner',
    }
  }

  const staffMember = await resolveStaffByUser(supabase, user)
  if (!staffMember) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return {
    supabase,
    user,
    isSuperAdmin: false,
    staffMember,
    staffRole: normalizeStaffRole(staffMember.role),
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
    .maybeSingle()

  if (authError || !operatorAuth?.operator_id) {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', operatorAuth.operator_id)
    .maybeSingle()

  if (operatorError || !operator) {
    return {
      response: NextResponse.json({ error: 'operator-not-found' }, { status: 404 }),
    }
  }

  return {
    supabase,
    user,
    operatorAuth,
    operator,
  }
}
