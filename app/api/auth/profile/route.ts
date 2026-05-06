import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * PATCH /api/auth/profile
 * Body: { fullName?: string, shortName?: string, name?: string }
 *
 * Изменить отображаемое имя текущего пользователя.
 * Для staff — пишем в таблицу staff (full_name / short_name).
 * Для остальных — обновляем user_metadata в Supabase Auth.
 */
export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request, { allowCustomer: true })
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as {
      fullName?: string
      shortName?: string
      name?: string
    } | null
    if (!body) return json({ error: 'body обязателен' }, 400)

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null
    const shortName = typeof body.shortName === 'string' ? body.shortName.trim() : null
    const name = typeof body.name === 'string' ? body.name.trim() : null

    if (!fullName && !shortName && !name) {
      return json({ error: 'Нечего обновлять' }, 400)
    }
    if (fullName && fullName.length > 200) return json({ error: 'fullName слишком длинный' }, 400)
    if (shortName && shortName.length > 100) return json({ error: 'shortName слишком длинный' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const user = access.user
    if (!user) return json({ error: 'unauthorized' }, 401)

    // 1. Если staff — пишем в таблицу staff.
    if (access.staffMember?.id) {
      const updates: Record<string, string> = {}
      if (fullName !== null) updates.full_name = fullName
      if (shortName !== null) updates.short_name = shortName

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('staff')
          .update(updates)
          .eq('id', access.staffMember.id)
        if (error) return json({ error: error.message }, 500)
      }
    }

    // 2. Параллельно обновляем user_metadata (используется когда нет staff).
    const metaName = fullName || name || null
    if (metaName) {
      const { error: authError } = await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { ...(user.user_metadata || {}), name: metaName },
      })
      if (authError) {
        // Не критично — staff обновился, просто логируем
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'api/auth/profile.PATCH.user_metadata',
          message: authError.message,
        })
      }
    }

    await writeAuditLog(supabase, {
      actorUserId: user.id,
      entityType: 'user-profile',
      entityId: user.id,
      action: 'update',
      payload: { fullName, shortName },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/profile.PATCH',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Ошибка обновления профиля' }, 500)
  }
}
