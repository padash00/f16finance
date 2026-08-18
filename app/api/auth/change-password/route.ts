import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

/**
 * Смена своего пароля тем, кто уже вошёл.
 *
 * Сброс по почте (`/api/auth/password-reset`) — для тех, кто пароль забыл.
 * Тому, кто его помнит и просто хочет поменять — например, оператору, которому
 * владелец выдал временный, — почта не нужна вовсе, а у оператора её и нет:
 * он входит по логину.
 *
 * Текущий пароль спрашиваем обязательно: телефон бывает разблокирован и лежит
 * на стойке, а смена пароля без подтверждения — это захват учётной записи
 * любым, кто взял его в руки.
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const LIMIT = 10
const WINDOW_MS = 15 * 60 * 1000
const MIN_LENGTH = 8

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const user = access.user
    if (!user?.id || !user.email) {
      return json({ error: 'no-account', message: 'У этого входа нет учётной записи с паролем.' }, 400)
    }

    const limit = checkRateLimit(`change-password:${user.id}:${getClientIp(request)}`, LIMIT, WINDOW_MS)
    if (!limit.allowed) {
      return json(
        { error: 'rate-limited', message: 'Слишком много попыток. Попробуйте через несколько минут.', retry_at: limit.resetAt },
        429,
      )
    }

    const body = (await request.json().catch(() => null)) as {
      current_password?: string
      new_password?: string
    } | null
    const currentPassword = String(body?.current_password || '')
    const newPassword = String(body?.new_password || '')

    if (!currentPassword || !newPassword) {
      return json({ error: 'passwords-required', message: 'Введите текущий и новый пароль.' }, 400)
    }
    if (newPassword.length < MIN_LENGTH) {
      return json(
        { error: 'password-too-short', message: `Новый пароль должен быть не короче ${MIN_LENGTH} символов.` },
        400,
      )
    }
    if (currentPassword === newPassword) {
      return json({ error: 'password-same', message: 'Новый пароль должен отличаться от текущего.' }, 400)
    }

    // Текущий пароль проверяем входом: своей проверки пароля у нас нет и быть
    // не должно — хэши живут в Supabase Auth.
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || requiredEnv('SUPABASE_URL'),
      requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (signInError || !signIn.user || signIn.user.id !== user.id) {
      return json({ error: 'invalid-current-password', message: 'Текущий пароль не подошёл.' }, 401)
    }
    await authClient.auth.signOut().catch(() => null)

    const supabaseAdmin = createAdminSupabaseClient()
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    })
    if (updateError) throw updateError

    // Временный пароль перестаёт быть временным: иначе приложение продолжит
    // требовать смены при каждом входе.
    await supabaseAdmin
      .from('operator_auth')
      .update({ must_change_password: false })
      .eq('user_id', user.id)

    await writeAuditLog(supabaseAdmin as any, {
      actorUserId: user.id,
      entityType: 'user-account',
      entityId: user.id,
      action: 'change-password',
      payload: { source: 'app' },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/change-password',
      message: error?.message || 'change-password',
    })
    return json({ error: 'change-failed', message: 'Не удалось сменить пароль. Попробуйте позже.' }, 500)
  }
}
