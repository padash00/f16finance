/**
 * Опросы в командном чате.
 * POST { question, options:[{id,label}], multipleChoice?, expiresAt? } — создать опрос (всем)
 * GET ?pollId=X — получить опрос с результатами
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as {
    question?: string
    options?: Array<{ id: string; label: string }>
    multipleChoice?: boolean
    expiresAt?: string
  } | null

  const question = String(body?.question || '').trim()
  if (!question) return json({ error: 'question обязателен' }, 400)
  const options = Array.isArray(body?.options) ? body!.options : []
  if (options.length < 2) return json({ error: 'Минимум 2 варианта' }, 400)
  if (options.length > 10) return json({ error: 'Максимум 10 вариантов' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Создаём сообщение в чате
  let senderName = access.user.email || 'Аноним'
  if (access.staffMember) senderName = access.staffMember.full_name || senderName
  else if (access.operatorAuth) {
    const { data: op } = await supabase.from('operators').select('short_name, name').eq('id', access.operatorAuth.operator_id).maybeSingle()
    senderName = (op as any)?.short_name || (op as any)?.name || senderName
  }

  const senderRole = access.staffMember?.role || (access.operatorAuth ? 'operator' : access.isSuperAdmin ? 'super_admin' : 'staff')

  const { data: msg, error: msgErr } = await supabase
    .from('team_chat_messages')
    .insert({
      organization_id: access.activeOrganization?.id || null,
      sender_user_id: access.user.id,
      sender_operator_id: access.operatorAuth?.operator_id || null,
      sender_name: senderName,
      sender_role: senderRole,
      message: `📊 Опрос: ${question}`,
      attachments: [{ type: 'poll', placeholder: true }],
    })
    .select('id')
    .single()
  if (msgErr) return json({ error: msgErr.message }, 500)

  const { data: poll, error: pollErr } = await supabase
    .from('team_chat_polls')
    .insert({
      message_id: (msg as any).id,
      question,
      options,
      multiple_choice: !!body?.multipleChoice,
      expires_at: body?.expiresAt || null,
      created_by_user_id: access.user.id,
    })
    .select('*')
    .single()
  if (pollErr) return json({ error: pollErr.message }, 500)

  return json({ poll, messageId: (msg as any).id })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const pollId = url.searchParams.get('pollId')
  const messageId = url.searchParams.get('messageId')
  if (!pollId && !messageId) return json({ error: 'pollId или messageId обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  let query = supabase.from('team_chat_polls').select('*').limit(1)
  if (pollId) query = query.eq('id', pollId)
  if (messageId) query = query.eq('message_id', messageId)
  const { data: pollList } = await query
  const poll = pollList?.[0]
  if (!poll) return json({ error: 'Не найдено' }, 404)

  // Изоляция: опрос привязан к сообщению чата — оно обязано быть из орг вызывающего,
  // иначе по присланному pollId/messageId утекают имена проголосовавших чужой орг.
  if (!access.isSuperAdmin) {
    const { data: msg } = await supabase
      .from('team_chat_messages')
      .select('organization_id')
      .eq('id', (poll as any).message_id)
      .maybeSingle()
    if (msg && (msg as any).organization_id && (msg as any).organization_id !== (access.activeOrganization?.id || null)) {
      return json({ error: 'Не найдено' }, 404)
    }
  }

  const { data: votes } = await supabase
    .from('team_chat_poll_votes')
    .select('option_id, voter_user_id, voter_name')
    .eq('poll_id', (poll as any).id)

  // Группируем
  const counts: Record<string, number> = {}
  const voters: Record<string, string[]> = {}
  for (const v of votes || []) {
    counts[(v as any).option_id] = (counts[(v as any).option_id] || 0) + 1
    if (!voters[(v as any).option_id]) voters[(v as any).option_id] = []
    voters[(v as any).option_id].push((v as any).voter_name)
  }

  const myVote = (votes || []).filter((v: any) => v.voter_user_id === access.user?.id).map((v: any) => v.option_id)

  return json({ poll, counts, voters, myVote, totalVotes: (votes || []).length })
}
