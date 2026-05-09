/**
 * GET /api/direct-messages/threads
 * Список переписок текущего юзера: для каждого собеседника — последнее сообщение + кол-во непрочитанных.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const me = access.user.id

  // Берём последние 500 сообщений где я отправитель или получатель
  const { data: msgs, error } = await supabase
    .from('direct_messages')
    .select('id, sender_user_id, recipient_user_id, sender_name, recipient_name, message, attachments, read_at, created_at, deleted_at')
    .or(`sender_user_id.eq.${me},recipient_user_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return json({ error: error.message }, 500)

  // Группируем по собеседнику
  type Thread = {
    otherUserId: string
    otherName: string
    lastMessage: string
    lastAttachmentType: string | null
    lastAt: string
    lastFromMe: boolean
    unreadCount: number
  }
  const threads = new Map<string, Thread>()

  for (const m of msgs || []) {
    const isMine = (m as any).sender_user_id === me
    const otherUserId = isMine ? (m as any).recipient_user_id : (m as any).sender_user_id
    const otherName = isMine ? (m as any).recipient_name : (m as any).sender_name
    if (!otherUserId) continue

    const existing = threads.get(otherUserId)
    const isUnread = !isMine && !(m as any).read_at && !(m as any).deleted_at
    const attType =
      Array.isArray((m as any).attachments) && (m as any).attachments.length > 0
        ? (m as any).attachments[0]?.type || null
        : null

    if (!existing) {
      threads.set(otherUserId, {
        otherUserId,
        otherName: otherName || 'Без имени',
        lastMessage: (m as any).deleted_at
          ? '[удалено]'
          : (m as any).message || (attType ? `[${attType}]` : ''),
        lastAttachmentType: attType,
        lastAt: (m as any).created_at,
        lastFromMe: isMine,
        unreadCount: isUnread ? 1 : 0,
      })
    } else if (isUnread) {
      existing.unreadCount += 1
    }
  }

  const list = Array.from(threads.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  return json({ threads: list })
}
