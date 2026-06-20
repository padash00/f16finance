import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { normalizeStaffRole, type StaffCapability, type StaffRole } from '@/lib/core/access'
import { resolveRequestAuthPersona, type RequestAuthPersonaKind } from '@/lib/server/auth-persona'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { fetchLinkedCustomersForUser, type LinkedCustomerRow } from '@/lib/server/linked-customers'
import { requiredEnv } from '@/lib/server/env'
import { ensureRoleMatrixHydrated } from '@/lib/server/role-hydration'
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

// Канонная валидация Bearer-токена: прямой GET {url}/auth/v1/user (apikey=anon + Bearer).
// Возвращаем пользователя И причину (для диагностики прямо в тексте 401).
async function validateBearerUser(token: string): Promise<{ user: any | null; reason: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return { user: null, reason: 'server-no-env' }
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const user = await res.json().catch(() => null)
      if (user && user.id) return { user, reason: 'ok' }
      return { user: null, reason: 'gotrue-200-no-id' }
    }
    const body = (await res.text().catch(() => '')) || ''
    return { user: null, reason: `gotrue-${res.status}:${body.slice(0, 100)}` }
  } catch (e: any) {
    return { user: null, reason: `fetch-err:${e?.message || 'ex'}` }
  }
}

export async function authenticateRequest(request: Request): Promise<{ user: any | null; reason: string }> {
  const bearerToken = getBearerToken(request)
  if (bearerToken) {
    const raw = await validateBearerUser(bearerToken)
    if (raw.user) return raw
    // Фолбэк на supabase-js admin getUser.
    if (hasAdminSupabaseCredentials()) {
      try {
        const { data, error } = await createAdminSupabaseClient().auth.getUser(bearerToken)
        if (data?.user) return { user: data.user, reason: 'admin-ok' }
        return { user: null, reason: `${raw.reason}|admin:${error?.message || 'null'}` }
      } catch (e: any) {
        return { user: null, reason: `${raw.reason}|admin-ex:${e?.message || 'ex'}` }
      }
    }
    return raw
  }

  const supabase = createRequestSupabaseClient(request)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { user: user ?? null, reason: user ? 'cookie-ok' : 'no-auth' }
}

export async function getRequestUser(request: Request) {
  return (await authenticateRequest(request)).user
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
  // Гидрируем динамическую матрицу ролей из БД (positions + position_paths).
  // Покрывает все API routes которые используют getRequestAccessContext.
  await ensureRoleMatrixHydrated()

  const supabase = createRequestSupabaseClient(request)
  const cookieMap = parseCookies(request.headers.get('cookie'))
  // Bearer (мобилка/API): валидируем токен через GoTrue; причина уходит в текст 401.
  const auth = await authenticateRequest(request)
  const user = auth.user

  if (!user) {
    return {
      response: NextResponse.json({ error: `unauthorized: ${auth.reason}` }, { status: 401 }),
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
  // Мобильное приложение (нет поддомена-тенанта) выбирает активную орг заголовком
  // x-organization-id. Безопасно: selectActiveOrganization берёт орг только из тех,
  // к которым у пользователя есть доступ (чужой id просто игнорируется).
  const headerOrganizationId = request.headers.get('x-organization-id')?.trim() || null
  const requestedOrganizationId =
    hostOrganization?.id || headerOrganizationId || cookieMap.get(ACTIVE_ORGANIZATION_COOKIE) || null
  const activeOrganization = selectActiveOrganization({
    organizations: organizationAccess.organizations,
    requestedOrganizationId,
  })
  const hostOrganizationLocked = Boolean(hostOrganization?.id)
  const hostOrganizationAccessible =
    !hostOrganizationLocked || isSuperAdmin || organizationAccess.organizations.some((item) => item.id === hostOrganization?.id)

  if (!hostOrganizationAccessible) {
    return {
      response: NextResponse.json({ error: 'forbidden', code: 'host-organization-not-accessible' }, { status: 403 }),
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

  // Suspend-рубильник (неоплата): приостановленная организация блокирует доступ не-суперадмину.
  // F16 имеет status='active' → не срабатывает. Суперадмин выше уже вернулся.
  if ((activeOrganization as any)?.status === 'suspended') {
    return {
      response: NextResponse.json(
        { error: 'organization_suspended', code: 'organization-suspended' },
        { status: 403 },
      ),
    }
  }

  const isCustomer = !staffMember && !operatorAuth && linkedCustomers.length > 0

  if (!staffMember && !operatorAuth && !isCustomer) {
    return {
      response: NextResponse.json(
        {
          error: 'forbidden',
          code: 'guest-not-linked',
          hint: 'В таблице customers нет активной строки с этим auth_user_id (или запрос customers не прошёл RLS).',
        },
        { status: 403 },
      ),
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

  // Не-staff (операторы заходят как role='other' без staffMember, гости) — закрываем.
  // Раньше здесь пропускался ЛЮБОЙ staffRole, включая операторов (role='other'),
  // т.е. проверка была no-op. Теперь требуется реальный staffMember.
  if (!context.staffMember) {
    return NextResponse.json({ error: 'forbidden', reason: 'staff-only' }, { status: 403 })
  }
  // staff проходит; гранулярную проверку права делает requireCapability в самих роутах.
  void capability
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
  // Bearer (мобилка): валидируем токен через GoTrue; причина уходит в текст 401.
  const auth = await authenticateRequest(request)
  const user = auth.user

  if (!user) {
    return {
      response: NextResponse.json({ error: `unauthorized: ${auth.reason}` }, { status: 401 }),
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
      response: NextResponse.json(
        {
          error: 'forbidden',
          code: 'client-api-guest-only',
          hint: 'Эти маршруты только для гостя. У аккаунта есть роль сотрудника или оператора — для /api/client/* нужен отдельный вход клиента.',
        },
        { status: 403 },
      ),
    }
  }

  const linkedCustomerIds = context.linkedCustomers.map((item) => item.id).filter(Boolean)
  if (!linkedCustomerIds.length) {
    return {
      response: NextResponse.json(
        { error: 'customer-not-linked', code: 'customer-rows-missing-id', hint: 'Профиль гостя без id — проверьте данные customers.' },
        { status: 403 },
      ),
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
