import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { toOperatorAuthEmail } from '@/lib/core/auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { requirePointDevice } from '@/lib/server/point-devices'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const body = await request.json().catch(() => null)
    const { username, current_password, new_password } = body ?? {}

    if (!username || !current_password || !new_password) {
      return json({ error: 'username, current_password и new_password обязательны' }, 400)
    }

    if (new_password.length < 6) {
      return json({ error: 'Новый пароль должен быть не менее 6 символов' }, 400)
    }

    if (current_password === new_password) {
      return json({ error: 'Новый пароль должен отличаться от временного' }, 400)
    }

    // Проверяем текущий пароль через Supabase Auth
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || requiredEnv('SUPABASE_URL'),
      requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: authData, error: signInError } = await authClient.auth.signInWithPassword({
      email: toOperatorAuthEmail(username),
      password: current_password,
    })

    if (signInError || !authData.user) {
      return json({ error: 'Неверный текущий пароль' }, 401)
    }

    await authClient.auth.signOut().catch(() => null)

    // Меняем пароль и снимаем флаг must_change_password
    const supabaseAdmin = createAdminSupabaseClient()

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      authData.user.id,
      { password: new_password },
    )
    if (updateAuthError) throw updateAuthError

    await supabaseAdmin
      .from('operator_auth')
      .update({ must_change_password: false })
      .eq('user_id', authData.user.id)

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-change-password',
      message: error?.message || 'Change password error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
