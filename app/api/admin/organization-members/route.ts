import { NextResponse } from 'next/server'

import { getPublicAppUrl } from '@/lib/core/app-url'
import { assertOrganizationLimitAvailable } from '@/lib/server/organizations'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type InviteMemberBody = {
  action?: 'inviteMember'
  organizationId?: string | null
  fullName?: string | null
  email?: string | null
  role?: 'owner' | 'manager' | 'marketer' | 'other' | null
}

type StaffAccountState = 'no_email' | 'no_account' | 'invited' | 'active'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function buildRedirectTo(origin: string, nextPath: string) {
  return `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
}

function mapUserState(user: any | null, hasEmail: boolean): StaffAccountState {
  if (!hasEmail) return 'no_email'
  if (!user) return 'no_account'
  if (user.email_confirmed_at || user.last_sign_in_at) return 'active'
  return 'invited'
}

function getManageableOrganizationId(params: {
  access: Exclude<Awaited<ReturnType<typeof getRequestAccessContext>>, { response: NextResponse }>
  requestedOrganizationId?: string | null
}) {
  const { access, requestedOrganizationId } = params
  const organizationId = String(requestedOrganizationId || access.activeOrganization?.id || '').trim()
  if (!organizationId) {
    throw new Error('active-organization-required')
  }

  if (access.isSuperAdmin) {
    return organizationId
  }

  const membership = access.organizations.find((item) => item.id === organizationId)
  if (!membership || membership.accessRole !== 'owner') {
    throw new Error('forbidden')
  }

  return organizationId
}

async function resolveOrCreateStaff(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  fullName: string
  email: string
  role: string
}) {
  const { supabase, fullName, email, role } = params

  const { data: existing, error: existingError } = await supabase
    .from('staff')
    .select('id, full_name, short_name, email, role, is_active')
    .ilike('email', email)
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    const updatePayload: Record<string, unknown> = {}
    if (!existing.full_name && fullName) updatePayload.full_name = fullName
    if (!existing.short_name && fullName) updatePayload.short_name = fullName.split(' ')[0] || fullName
    if (!existing.email) updatePayload.email = email
    if (!existing.role) updatePayload.role = role
    if (existing.is_active === false) updatePayload.is_active = true

    if (Object.keys(updatePayload).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from('staff')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('id, full_name, short_name, email, role, is_active')
        .single()
      if (updateError) throw updateError
      return updated
    }

    return existing
  }

  const { data: created, error: createError } = await supabase
    .from('staff')
    .insert([
      {
        full_name: fullName,
        short_name: fullName.split(' ')[0] || fullName,
        email,
        role,
        is_active: true,
      },
    ])
    .select('id, full_name, short_name, email, role, is_active')
    .single()

  if (createError) throw createError
  return created
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const { searchParams } = new URL(req.url)
    const requestedOrganizationId = searchParams.get('organizationId')
    const organizationId = getManageableOrganizationId({ access, requestedOrganizationId })

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'missing_service_role' }, 500)
    }

    const supabase = createAdminSupabaseClient()
    const { data: members, error: membersError } = await supabase
      .from('organization_members')
      .select('id, organization_id, staff_id, user_id, email, role, status, is_default, created_at, staff:staff_id(id, full_name, short_name, email, role, is_active)')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })

    if (membersError) throw membersError

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) throw usersError

    const usersByEmail = new Map<string, any>()
    for (const item of usersData.users) {
      if (item.email) usersByEmail.set(item.email.toLowerCase(), item)
    }

    const items = (members || []).map((member: any) => {
      const staff = Array.isArray(member.staff) ? member.staff[0] || null : member.staff || null
      const email = normalizeEmail(member.email || staff?.email)
      const authUser = email ? usersByEmail.get(email) || null : null
      return {
        id: String(member.id || ''),
        organizationId: String(member.organization_id || organizationId),
        staffId: member.staff_id ? String(member.staff_id) : null,
        userId: member.user_id ? String(member.user_id) : authUser?.id || null,
        email: email || null,
        role: String(member.role || 'other'),
        status: String(member.status || 'active'),
        isDefault: Boolean(member.is_default),
        fullName: staff?.full_name || staff?.short_name || email || 'Без имени',
        shortName: staff?.short_name || null,
        accountState: mapUserState(authUser, Boolean(email)),
        emailConfirmedAt: authUser?.email_confirmed_at || null,
        lastSignInAt: authUser?.last_sign_in_at || null,
      }
    })

    return json({ ok: true, items })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organization-members:get',
      message: error?.message || 'organization-members GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  let organizationIdForError: string | null = null
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!hasAdminSupabaseCredentials()) {
      return json(
        { error: 'Для отправки приглашения нужен SUPABASE_SERVICE_ROLE_KEY', code: 'missing_service_role' },
        500,
      )
    }

    const body = (await req.json().catch(() => null)) as InviteMemberBody | null
    if (body?.action !== 'inviteMember') {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const organizationId = getManageableOrganizationId({ access, requestedOrganizationId: body.organizationId })
    organizationIdForError = organizationId
    const fullName = String(body.fullName || '').trim()
    const email = normalizeEmail(body.email)
    const role = body.role || 'manager'

    if (!fullName) {
      return json({ error: 'Укажи имя приглашённого сотрудника.' }, 400)
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Некорректный email.' }, 400)
    }

    if (!['owner', 'manager', 'marketer', 'other'].includes(role)) {
      return json({ error: 'Некорректная роль.' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const { data: existingMembershipByEmail, error: existingMembershipError } = await supabase
      .from('organization_members')
      .select('id, staff_id')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .maybeSingle()

    if (existingMembershipError) throw existingMembershipError

    if (!existingMembershipByEmail?.id) {
      await assertOrganizationLimitAvailable({
        activeOrganizationId: organizationId,
        isSuperAdmin: access.isSuperAdmin,
        activeSubscription: access.activeSubscription,
        key: 'staff',
      })
    }

    const staffRow = await resolveOrCreateStaff({ supabase, fullName, email, role })
    const origin = getPublicAppUrl(new URL(req.url).origin)
    const accessRedirectTo = buildRedirectTo(origin, '/set-password')
    const recoveryRedirectTo = buildRedirectTo(origin, '/reset-password?mode=recovery')

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) throw usersError

    const existingUser = usersData.users.find((item) => item.email?.toLowerCase() === email) || null
    const userMetadata = {
      role: 'staff',
      staff_id: String(staffRow.id),
      staff_role: role,
      organization_id: organizationId,
      name: fullName,
    }

    let linkedUserId = existingUser?.id || null
    if (!existingUser) {
      const invite = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: accessRedirectTo,
        data: userMetadata,
      })
      if (invite.error) throw invite.error
      linkedUserId = invite.data.user?.id || null
    } else {
      const update = await supabase.auth.admin.updateUserById(existingUser.id, {
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          ...userMetadata,
        },
      })
      if (update.error) throw update.error

      const reset = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: recoveryRedirectTo,
      })
      if (reset.error) throw reset.error
    }

    const { error: membershipError } = await supabase
      .from('organization_members')
      .upsert(
        [
          {
            organization_id: organizationId,
            staff_id: String(staffRow.id),
            user_id: linkedUserId,
            email,
            role,
            status: 'active',
            is_default: false,
            metadata: {
              invited_from: 'project-hub',
            },
          },
        ],
        {
          onConflict: 'organization_id,staff_id',
        },
      )
    if (membershipError) throw membershipError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'organization-member',
      entityId: String(staffRow.id),
      action: 'invite',
      payload: { organization_id: organizationId, email, role },
    })
    await writeNotificationLog(supabase, {
      channel: 'email',
      recipient: email,
      status: 'sent',
      payload: { kind: 'organization-member-invite', organization_id: organizationId, role, staff_id: staffRow.id },
    })

    return json({
      ok: true,
      member: {
        staffId: String(staffRow.id),
        userId: linkedUserId,
        email,
        role,
        fullName,
        accountState: mapUserState(existingUser, true),
      },
      message: existingUser
        ? `Письмо для входа отправлено на ${email}. Пользователь сможет зайти в организацию после установки нового пароля.`
        : `Приглашение отправлено на ${email}. Пользователь сам задаст пароль по ссылке из письма.`,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organization-members:post',
      message: error?.message || 'organization-members POST error',
    })
    if (hasAdminSupabaseCredentials() && organizationIdForError) {
      await writeNotificationLog(createAdminSupabaseClient(), {
        channel: 'email',
        recipient: 'unknown',
        status: 'failed',
        payload: { kind: 'organization-member-invite', organization_id: organizationIdForError, error: error?.message || 'unknown-error' },
      }).catch(() => null)
    }
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
