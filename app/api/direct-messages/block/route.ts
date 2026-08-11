import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Блокировка собеседника.
 *
 * Требование App Store к приложениям с перепиской: человек должен уметь
 * прекратить общение с тем, кто ведёт себя недопустимо, сам и сразу — не
 * дожидаясь, пока владелец разберёт жалобу.
 *
 * Блокировка односторонняя и молчаливая: заблокированному об этом не
 * сообщают, его сообщения просто перестают доходить. Уведомление «вас
 * заблокировали» в рабочем коллективе — это приглашение к разбирательству в
 * коридоре.
 *
 *   GET    /api/direct-messages/block            — кого я заблокировал
 *   POST   /api/direct-messages/block  { userId }
 *   DELETE /api/direct-messages/block  { userId }
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const userId = access.user?.id
    if (!userId) return json({ error: 'unauthorized' }, 401)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data } = await supabase
      .from('direct_message_blocks')
      .select('blocked_user_id')
      .eq('user_id', userId)

    return json({ data: ((data as any[]) || []).map((row) => String(row.blocked_user_id)) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/direct-messages/block GET',
      message: error?.message || 'error',
    })
    return json({ data: [] })
  }
}

export async function POST(request: Request) {
  return toggle(request, true)
}

export async function DELETE(request: Request) {
  return toggle(request, false)
}

async function toggle(request: Request, blocked: boolean) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const userId = access.user?.id
    if (!userId) return json({ error: 'unauthorized' }, 401)

    const body = (await request.json().catch(() => null)) as { userId?: string } | null
    const target = String(body?.userId || '').trim()
    if (!target) return json({ error: 'userId обязателен' }, 400)
    if (target === userId) return json({ error: 'Себя заблокировать нельзя' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    if (blocked) {
      const { error } = await supabase
        .from('direct_message_blocks')
        .upsert(
          { user_id: userId, blocked_user_id: target },
          { onConflict: 'user_id,blocked_user_id' },
        )
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('direct_message_blocks')
        .delete()
        .eq('user_id', userId)
        .eq('blocked_user_id', target)
      if (error) throw error
    }

    // В журнал — обе стороны: блокировка внутри рабочего коллектива это
    // событие, о котором владелец однажды спросит.
    await writeAuditLog(supabase as any, {
      actorUserId: userId,
      action: blocked ? 'direct-messages.block' : 'direct-messages.unblock',
      entityType: 'user',
      entityId: target,
      payload: { organization_id: access.activeOrganization?.id || null },
    })

    return json({ ok: true, blocked })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/direct-messages/block POST',
      message: error?.message || 'error',
    })
    return json({ error: 'block-failed' }, 500)
  }
}
