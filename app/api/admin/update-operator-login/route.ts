import { NextResponse } from 'next/server'
import { ensureOrganizationOperatorAccess } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { toOperatorAuthEmail } from '@/lib/core/auth'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = await request.json().catch(() => null)
    const { operatorId, username } = body ?? {}

    if (!operatorId || typeof operatorId !== 'string' || !username || typeof username !== 'string') {
      return NextResponse.json({ error: 'operatorId и username обязательны' }, { status: 400 })
    }

    const trimmed = username.trim().toLowerCase()
    if (trimmed.length < 2) {
      return NextResponse.json({ error: 'Логин должен быть не менее 2 символов' }, { status: 400 })
    }

    await ensureOrganizationOperatorAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      operatorId,
    })

    const supabaseAdmin = createAdminSupabaseClient()

    const { data: operatorRow, error: opErr } = await supabaseAdmin
      .from('operators')
      .select('id')
      .eq('id', operatorId)
      .maybeSingle()

    if (opErr) throw opErr
    if (!operatorRow) {
      return NextResponse.json({ error: 'Оператор не найден в базе', code: 'OPERATOR_NOT_FOUND' }, { status: 404 })
    }

    // Check uniqueness
    const { data: existing } = await supabaseAdmin
      .from('operator_auth')
      .select('operator_id')
      .eq('username', trimmed)
      .neq('operator_id', operatorId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Такой логин уже занят другим оператором' }, { status: 409 })
    }

    // Получаем user_id из operator_auth чтобы обновить email в Supabase Auth
    const { data: authRow, error: fetchError } = await supabaseAdmin
      .from('operator_auth')
      .select('user_id')
      .eq('operator_id', operatorId)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!authRow) {
      return NextResponse.json(
        {
          error:
            'У этого оператора ещё нет аккаунта входа (нет записи operator_auth). Сначала создайте аккаунт оператора (супер-админ: раздел создания аккаунта / API create-operator-account).',
          code: 'NO_OPERATOR_AUTH',
        },
        { status: 422 },
      )
    }
    if (!authRow.user_id) {
      return NextResponse.json(
        {
          error:
            'Запись входа оператора не привязана к Supabase Auth (нет user_id). Создайте аккаунт заново или обратитесь к администратору.',
          code: 'NO_AUTH_USER_ID',
        },
        { status: 422 },
      )
    }

    // Обновляем email в Supabase Auth (логин → email формат)
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(authRow.user_id, {
      email: toOperatorAuthEmail(trimmed),
    })
    if (authError) throw authError

    // Обновляем username в таблице operator_auth
    const { error } = await supabaseAdmin
      .from('operator_auth')
      .update({ username: trimmed })
      .eq('operator_id', operatorId)

    if (error) throw error

    await writeAuditLog(supabaseAdmin, {
      actorUserId: access.user?.id || null,
      entityType: 'operator-auth',
      entityId: operatorId,
      action: 'update-username',
      payload: { new_username: trimmed },
    })

    return NextResponse.json({ ok: true, username: trimmed })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/update-operator-login',
      message: error?.message || 'Server error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
