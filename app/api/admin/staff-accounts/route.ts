import { NextResponse } from 'next/server'

import { getPublicAppUrl } from '@/lib/core/app-url'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type PostBody =
  | {
      action: 'inviteStaffAccount'
      staffId: string
    }
  | {
      action: 'sendPasswordReset'
      staffId: string
    }
  | {
      action: 'changeEmail'
      staffId: string
      newEmail: string
    }

type ResolvedStaffAccount = {
  staff: any
  operatorProfile: any | null
  operator: any | null
  email: string | null
  phone: string | null
  fullName: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function buildRedirectTo(origin: string, nextPath: string) {
  return `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
}

function isEmailRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.toLowerCase().includes('email rate limit exceeded')
}

async function resolveStaffAccountTarget(supabase: any, staffId: string): Promise<ResolvedStaffAccount | null> {
  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id, full_name, short_name, email, role, is_active, phone')
    .eq('id', staffId)
    .maybeSingle()

  if (staffError) throw staffError
  if (!staffRow) return null

  const { data: link, error: linkError } = await supabase
    .from('operator_staff_links')
    .select('operator_id')
    .eq('staff_id', staffId)
    .maybeSingle()

  if (linkError && linkError.code !== 'PGRST116') throw linkError

  let operatorProfile: any = null
  let operator: any = null

  if (link?.operator_id) {
    const [{ data: profileData, error: profileError }, { data: operatorData, error: operatorError }] = await Promise.all([
      supabase
        .from('operator_profiles')
        .select('operator_id, full_name, email, phone')
        .eq('operator_id', link.operator_id)
        .maybeSingle(),
      supabase
        .from('operators')
        .select('id, name, short_name, is_active')
        .eq('id', link.operator_id)
        .maybeSingle(),
    ])

    if (profileError && profileError.code !== 'PGRST116') throw profileError
    if (operatorError && operatorError.code !== 'PGRST116') throw operatorError

    operatorProfile = profileData || null
    operator = operatorData || null
  }

  const fullName =
    operatorProfile?.full_name?.trim() ||
    staffRow.full_name?.trim() ||
    operator?.name?.trim() ||
    staffRow.short_name?.trim() ||
    operator?.short_name?.trim() ||
    null

  const email = operatorProfile?.email?.trim()?.toLowerCase() || staffRow.email?.trim()?.toLowerCase() || null
  const phone = operatorProfile?.phone?.trim() || staffRow.phone?.trim() || null

  if (
    (email && email !== (staffRow.email?.trim()?.toLowerCase() || null)) ||
    (phone && phone !== (staffRow.phone?.trim() || null)) ||
    (fullName && fullName !== (staffRow.full_name?.trim() || null))
  ) {
    const { data: syncedStaff, error: syncError } = await supabase
      .from('staff')
      .update({
        email,
        phone,
        full_name: fullName,
      })
      .eq('id', staffId)
      .select('id, full_name, short_name, email, role, is_active, phone')
      .single()

    if (syncError) throw syncError

    return {
      staff: syncedStaff,
      operatorProfile,
      operator,
      email,
      phone,
      fullName,
    }
  }

  return {
    staff: staffRow,
    operatorProfile,
    operator,
    email,
    phone,
    fullName,
  }
}

function mapUserState(user: any | null, hasEmail: boolean) {
  if (!hasEmail) return 'no_email'
  if (!user) return 'no_account'
  if (user.email_confirmed_at || user.last_sign_in_at) return 'active'
  return 'invited'
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) {
      return json(
        { error: 'Для работы со staff-аккаунтами нужен SUPABASE_SERVICE_ROLE_KEY', code: 'missing_service_role' },
        500,
      )
    }

    const { searchParams } = new URL(req.url)
    const staffIds = (searchParams.get('staffIds') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (staffIds.length === 0) {
      return json({ ok: true, items: [] })
    }

    const supabase = createAdminSupabaseClient()
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) throw usersError

    const usersByEmail = new Map<string, any>()
    for (const item of usersData.users) {
      if (item.email) usersByEmail.set(item.email.toLowerCase(), item)
    }

    const items = await Promise.all(
      staffIds.map(async (staffId) => {
        const resolved = await resolveStaffAccountTarget(supabase, staffId)
        if (!resolved) return null

        const user = resolved.email ? usersByEmail.get(resolved.email) || null : null
        const state = mapUserState(user, Boolean(resolved.email))

        return {
          staffId,
          email: resolved.email,
          phone: resolved.phone,
          full_name: resolved.fullName,
          accountState: state,
          hasAccount: Boolean(user),
          emailConfirmedAt: user?.email_confirmed_at || null,
          lastSignInAt: user?.last_sign_in_at || null,
          userId: user?.id || null,
        }
      }),
    )

    return json({ ok: true, items: items.filter(Boolean) })
  } catch (error: any) {
    console.error('Admin staff accounts GET route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/staff-accounts:get',
      message: error?.message || 'Admin staff accounts GET route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  let requestBody: PostBody | null = null
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) {
      return json(
        { error: 'Для отправки приглашения нужен SUPABASE_SERVICE_ROLE_KEY', code: 'missing_service_role' },
        500,
      )
    }

    const body = (await req.json().catch(() => null)) as PostBody | null
    requestBody = body
    if (!body?.staffId || !['inviteStaffAccount', 'sendPasswordReset', 'changeEmail'].includes(body.action)) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const resolved = await resolveStaffAccountTarget(supabase, body.staffId)
    if (!resolved) {
      return json({ error: 'Сотрудник не найден', code: 'staff_not_found' }, 404)
    }

    if (!resolved.staff.is_active) {
      return json({ error: 'Нельзя приглашать архивного сотрудника', code: 'staff_inactive' }, 400)
    }

    if (!resolved.email) {
      return json({ error: 'У сотрудника не заполнен email', code: 'missing_email' }, 400)
    }

    const email = resolved.email
    const origin = getPublicAppUrl(new URL(req.url).origin)
    const accessRedirectTo = buildRedirectTo(origin, '/set-password')
    const recoveryRedirectTo = buildRedirectTo(origin, '/reset-password?mode=recovery')

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) throw usersError

    const existingUser = usersData.users.find((item) => item.email?.toLowerCase() === email) || null
    const userMetadata = {
      role: 'staff',
      staff_id: resolved.staff.id,
      staff_role: resolved.staff.role,
      name: resolved.fullName || resolved.staff.short_name || email,
    }

    if (body.action === 'inviteStaffAccount') {
      if (!existingUser) {
        const invite = await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo: accessRedirectTo,
          data: userMetadata,
        })

        if (invite.error) throw invite.error

        await writeAuditLog(supabase, {
          actorUserId: user?.id || null,
          entityType: 'staff-account',
          entityId: String(resolved.staff.id),
          action: 'invite',
          payload: { email, staff_role: resolved.staff.role, mode: 'invite' },
        })
        await writeNotificationLog(supabase, {
          channel: 'email',
          recipient: email,
          status: 'sent',
          payload: { kind: 'staff-invite', staff_id: resolved.staff.id, role: resolved.staff.role },
        })

        return json({
          ok: true,
          email,
          accountState: 'invited',
          message: `Приглашение отправлено на ${email}. Сотрудник сам задаст пароль по ссылке из письма.`,
        })
      }

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

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff-account',
        entityId: String(resolved.staff.id),
        action: 'access-email',
        payload: { email, staff_role: resolved.staff.role, mode: 'recovery-for-existing-user', user_id: existingUser.id },
      })
      await writeNotificationLog(supabase, {
        channel: 'email',
        recipient: email,
        status: 'sent',
        payload: { kind: 'staff-access-email', staff_id: resolved.staff.id, role: resolved.staff.role, user_id: existingUser.id },
      })

      return json({
        ok: true,
        email,
        accountState: mapUserState(existingUser, true),
        message: `Письмо отправлено на ${email}. По ссылке сотрудник сможет задать новый пароль и войти в систему.`,
      })
    }

    if (body.action === 'changeEmail') {
      const newEmail = body.newEmail?.trim()?.toLowerCase()
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return json({ error: 'Некорректный email' }, 400)
      }

      // Update staff table
      const { error: updateStaffError } = await supabase
        .from('staff')
        .update({ email: newEmail })
        .eq('id', body.staffId)
      if (updateStaffError) throw updateStaffError

      // Update auth user if exists
      const { data: usersDataCE, error: usersErrorCE } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (usersErrorCE) throw usersErrorCE

      const existingUserCE = usersDataCE.users.find((u) => u.email?.toLowerCase() === resolved.email) || null
      if (existingUserCE) {
        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(existingUserCE.id, {
          email: newEmail,
        })
        if (updateAuthError) throw updateAuthError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff-account',
        entityId: String(resolved.staff.id),
        action: 'change-email',
        payload: { old_email: resolved.email, new_email: newEmail },
      })

      return json({ ok: true, email: newEmail, message: `Логин изменён на ${newEmail}` })
    }

    if (!existingUser) {
      return json({ error: 'Для этого email ещё не создан аккаунт', code: 'user_not_found' }, 404)
    }

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

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'staff-account',
      entityId: String(resolved.staff.id),
      action: 'password-reset',
      payload: { email, user_id: existingUser.id, staff_role: resolved.staff.role },
    })
    await writeNotificationLog(supabase, {
      channel: 'email',
      recipient: email,
      status: 'sent',
      payload: { kind: 'staff-password-reset', staff_id: resolved.staff.id, role: resolved.staff.role, user_id: existingUser.id },
    })

    return json({
      ok: true,
      email,
      accountState: mapUserState(existingUser, true),
      message: `Письмо для смены пароля отправлено на ${email}. После перехода сотрудник сам задаст новый пароль.`,
    })
  } catch (error: any) {
    console.error('Admin staff accounts POST route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/staff-accounts:post',
      message: error?.message || 'Admin staff accounts POST route error',
    })
    const staffId = requestBody && 'staffId' in requestBody ? requestBody.staffId : null
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (supabase && staffId) {
      const resolved = await resolveStaffAccountTarget(supabase, staffId).catch(() => null)
      if (resolved?.email) {
        await writeNotificationLog(supabase, {
          channel: 'email',
          recipient: resolved.email,
          status: 'failed',
          payload: { kind: requestBody?.action || 'staff-account-action', staff_id: staffId, error: error?.message || 'unknown-error' },
        })
      }
    }
    if (isEmailRateLimitError(error)) {
      return json(
        {
          error:
            'Превышен лимит отправки писем Supabase. Подожди немного и попробуй снова, либо подключи свой SMTP для стабильной отправки.',
          code: 'email_rate_limit',
        },
        429,
      )
    }
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
