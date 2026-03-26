import { NextResponse } from 'next/server'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const guard = await requireAdminRequest(request)
    if (guard) return guard

    const body = await request.json().catch(() => null)
    const { userId, password } = body ?? {}

    if (!userId || typeof userId !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'userId и password обязательны' },
        { status: 400 }
      )
    }

    // Минимальная длина пароля
    if (password.length < 8) {
      return NextResponse.json({ error: 'Пароль должен быть не менее 8 символов' }, { status: 400 })
    }

    const supabaseAdmin = createAdminSupabaseClient()

    // Проверяем что userId существует в системе прежде чем менять пароль
    const { data: existingUser, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (lookupError || !existingUser?.user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    // Обновляем пароль через admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password }
    )

    if (error) {
      console.error('Admin API error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Помечаем пароль как временный — оператор должен сменить при входе
    await supabaseAdmin
      .from('operator_auth')
      .update({ must_change_password: true })
      .eq('user_id', userId)

    await writeAuditLog(supabaseAdmin, {
      actorUserId: null,
      entityType: 'auth-user',
      entityId: userId,
      action: 'admin-password-reset',
      payload: { via: 'api/reset-password', targetEmail: existingUser.user.email },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Server error:', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/reset-password',
      message: error?.message || 'Server error',
    })
    return NextResponse.json(
      { error: error.message || 'Внутренняя ошибка сервера' },
      { status: 500 }
    )
  }
}
