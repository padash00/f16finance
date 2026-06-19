import { NextResponse } from 'next/server'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { ensureOrganizationOperatorAccess } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    // Staff-only + право operators.reset_password (операторы/гости отсекаются).
    const denied = await requireStaffCapability(access, 'operators.reset_password')
    if (denied) return denied
    const actorUserId = access.user?.id || null

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

    // Изоляция: целевой пользователь обязан быть оператором ЭТОЙ организации, иначе
    // staff орг A мог бы сбросить пароль (захватить аккаунт) оператора орг B по userId.
    if (!access.isSuperAdmin) {
      const { data: targetAuth } = await supabaseAdmin
        .from('operator_auth')
        .select('operator_id')
        .eq('user_id', userId)
        .maybeSingle()
      const targetOperatorId = (targetAuth as any)?.operator_id
      if (!targetOperatorId) {
        return NextResponse.json({ error: 'forbidden', code: 'target-not-operator' }, { status: 403 })
      }
      try {
        await ensureOrganizationOperatorAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          operatorId: targetOperatorId,
        })
      } catch {
        return NextResponse.json({ error: 'forbidden', code: 'operator-not-in-organization' }, { status: 403 })
      }
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
      actorUserId,
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
