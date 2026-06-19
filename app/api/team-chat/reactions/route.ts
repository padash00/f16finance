/**
 * Реакции на сообщения чата.
 * POST { messageId, emoji } — добавить (или убрать если уже стоит)
 * GET ?messageId=X — список реакций (для синка)
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

  const url = new URL(request.url)
  const messageId = url.searchParams.get('messageId')
  if (!messageId) return json({ error: 'messageId required' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  // Изоляция: реакции читаем только у сообщения своей орг.
  const { data: msg } = await supabase.from('team_chat_messages').select('organization_id').eq('id', messageId).maybeSingle()
  if (!msg) return json({ reactions: [] })
  if (!access.isSuperAdmin && (msg as any).organization_id && (msg as any).organization_id !== (access.activeOrganization?.id || null)) {
    return json({ reactions: [] })
  }
  const { data, error } = await supabase
    .from('team_chat_reactions')
    .select('id, user_id, user_name, emoji, created_at')
    .eq('message_id', messageId)
    .order('created_at', { ascending: true })

  if (error) return json({ error: error.message }, 500)
  return json({ reactions: data || [] })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as
    | { messageId?: string; emoji?: string }
    | null
  if (!body?.messageId || !body?.emoji) return json({ error: 'messageId and emoji required' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Изоляция: реагировать можно только на сообщение своей орг.
  const { data: msg } = await supabase.from('team_chat_messages').select('organization_id').eq('id', body.messageId).maybeSingle()
  if (!msg) return json({ error: 'not-found' }, 404)
  if (!access.isSuperAdmin && (msg as any).organization_id && (msg as any).organization_id !== (access.activeOrganization?.id || null)) {
    return json({ error: 'forbidden' }, 403)
  }

  let userId: string | null = null
  let userName = 'Аноним'
  if (access.user) userId = access.user.id
  if (access.staffMember) {
    userName = access.staffMember.full_name || access.user?.email || 'Сотрудник'
  } else if (access.operatorAuth) {
    userId = access.operatorAuth.operator_id
    const { data: op } = await supabase
      .from('operators')
      .select('short_name, name')
      .eq('id', access.operatorAuth.operator_id)
      .maybeSingle()
    userName = (op as any)?.short_name || (op as any)?.name || access.operatorAuth.username || 'Оператор'
  }

  if (!userId) return json({ error: 'unauthorized' }, 401)

  // Toggle: если уже есть → удалить, иначе добавить
  const { data: existing } = await supabase
    .from('team_chat_reactions')
    .select('id')
    .eq('message_id', body.messageId)
    .eq('user_id', userId)
    .eq('emoji', body.emoji)
    .maybeSingle()

  if (existing) {
    await supabase.from('team_chat_reactions').delete().eq('id', existing.id)
    return json({ ok: true, removed: true })
  }

  const { error } = await supabase
    .from('team_chat_reactions')
    .insert({ message_id: body.messageId, user_id: userId, user_name: userName, emoji: body.emoji })
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, added: true })
}
