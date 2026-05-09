/**
 * GET /api/direct-messages/[userId]
 * Возвращает переписку текущего юзера с recipient (userId).
 * Помечает все непрочитанные от собеседника как прочитанные.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const { userId: otherUserId } = await params
  if (!otherUserId) return json({ error: 'userId обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const me = access.user.id

  const url = new URL(request.url)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100))

  const { data, error } = await supabase
    .from('direct_messages')
    .select('id, sender_user_id, recipient_user_id, sender_name, sender_role, message, attachments, reply_to_id, edited_at, deleted_at, read_at, created_at')
    .or(`and(sender_user_id.eq.${me},recipient_user_id.eq.${otherUserId}),and(sender_user_id.eq.${otherUserId},recipient_user_id.eq.${me})`)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return json({ error: error.message }, 500)

  // Помечаем непрочитанные сообщения от собеседника как прочитанные
  await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_user_id', otherUserId)
    .eq('recipient_user_id', me)
    .is('read_at', null)

  return json({ messages: (data || []).reverse() })
}
