import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { pushToUsers } from '@/lib/server/push'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Удаление своего аккаунта.
 *
 * Требование App Store: если в приложении можно войти, из него же должно быть
 * можно уйти — без писем в поддержку. Отклоняют за это регулярно.
 *
 * Что удаление означает здесь. Учётная запись стирается: человек больше не
 * войдёт ни в приложение, ни в программу точки. Личные данные — телефон, почта,
 * Telegram — затираются. А рабочие записи остаются: смены, выручка, зарплатные
 * ведомости и инциденты не могут исчезнуть задним числом, потому что на них
 * стоит бухгалтерия точки и права других людей. Строка сотрудника остаётся
 * помеченной неактивной, чтобы прошлые смены не потеряли автора.
 *
 * Владельца, который остался в организации один, не удаляем: иначе организация
 * останется без единого человека, способного выдать доступ, — вместе со всеми
 * её сотрудниками.
 *
 *   DELETE /api/me/account
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const userId = access.user?.id
    if (!userId) return json({ error: 'unauthorized' }, 401)

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'Удаление недоступно: сервер не настроен' }, 503)
    }
    const supabase = createAdminSupabaseClient()

    // Суперадмина не удаляем через приложение: это платформенная учётка, и её
    // потеря отрезает поддержку от всех организаций разом.
    if (access.isSuperAdmin) {
      return json(
        { error: 'Учётная запись поддержки удаляется только вручную', code: 'super-admin' },
        409,
      )
    }

    const orgId = access.activeOrganization?.id || null
    const staffId = access.staffMember?.id ? String(access.staffMember.id) : null
    const operatorId = access.operatorAuth?.operator_id ? String(access.operatorAuth.operator_id) : null

    // Последний владелец организации: без него никто не сможет выдать доступ
    // ни себе, ни другим.
    let ownerIds: string[] = []
    if (orgId) {
      const { data: owners } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'owner')
        .eq('status', 'active')

      ownerIds = (owners || []).map((row: any) => String(row.user_id || '')).filter(Boolean)
      if (ownerIds.includes(userId) && ownerIds.length <= 1) {
        return json(
          {
            error: 'Вы единственный владелец организации. Передайте права другому человеку, иначе доступ потеряют все.',
            code: 'last-owner',
          },
          409,
        )
      }
    }

    // 1. Личные данные — стираем. Рабочие записи не трогаем: на них стоит
    //    зарплата, смены и история продаж.
    if (staffId) {
      await supabase
        .from('staff')
        .update({ phone: null, email: null, is_active: false })
        .eq('id', staffId)
    }

    if (operatorId) {
      await supabase
        .from('operator_profiles')
        .update({ phone: null, email: null })
        .eq('operator_id', operatorId)
      await supabase
        .from('operators')
        .update({ telegram_chat_id: null, is_active: false })
        .eq('id', operatorId)
      // Вход в программу точки закрываем отдельно: строка `operator_auth`
      // переживает удаление пользователя и иначе осталась бы висеть.
      await supabase.from('operator_auth').update({ is_active: false }).eq('user_id', userId)
    }

    // 2. Членство в организации — снимаем, чтобы человек не считался
    //    сотрудником и не попадал в списки.
    await supabase
      .from('organization_members')
      .update({ status: 'inactive', user_id: null })
      .eq('user_id', userId)

    // 3. Токены уведомлений — иначе push продолжит приходить на устройство.
    await supabase.from('mobile_push_tokens').delete().eq('user_id', userId)

    // 4. Журнал пишем до удаления пользователя: после него `actorUserId`
    //    будет ссылаться в пустоту.
    await writeAuditLog(supabase, {
      actorUserId: userId,
      entityType: staffId ? 'staff' : 'operator',
      entityId: staffId || operatorId || userId,
      action: 'self-account-deleted',
      payload: { organization_id: orgId },
    })

    // 5. Владельцу — уведомление. Удаление мгновенное, отменить его нельзя, но
    //    узнать о нём владелец обязан сразу: человек, который вчера стоял в
    //    графике, сегодня не войдёт, и смену надо кем-то закрывать.
    const displayName =
      (access.staffMember as any)?.full_name ||
      (access.staffMember as any)?.short_name ||
      (access.staffMember as any)?.name ||
      access.operatorAuth?.username ||
      'Сотрудник'
    await pushToUsers(
      supabase,
      ownerIds.filter((id) => id !== userId),
      {
        title: 'Удалён аккаунт',
        body: `${displayName} удалил свою учётную запись. Вход закрыт, история смен и выплат сохранена.`,
        data: { kind: 'staff-account-deleted' },
      },
    )

    // 6. Сама учётная запись.
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error) throw error

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/me/account DELETE',
      message: error?.message || 'error',
    })
    return json({ error: 'Не удалось удалить аккаунт' }, 500)
  }
}
