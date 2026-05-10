/**
 * Командный чат — общий для всех ролей.
 * GET — последние N сообщений (paginate by before/after timestamps)
 * POST — отправить новое сообщение
 *
 * Авторизация: любой залогиненный (staff, operator, owner) может читать и писать.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { checkProfanity } from '@/lib/ai/profanity-filter'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const before = url.searchParams.get('before')
  const contextType = url.searchParams.get('context_type')
  const contextId = url.searchParams.get('context_id')
  const q = (url.searchParams.get('q') || '').trim()

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const orgId = access.activeOrganization?.id || null

  let query = supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, sender_avatar_url, message, attachments, reply_to_id, edited_at, deleted_at, is_announcement, pinned_until, context_type, context_id, context_label, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (orgId) {
    query = query.or(`organization_id.eq.${orgId},organization_id.is.null`)
  }
  if (before) {
    query = query.lt('created_at', before)
  }
  if (contextType && contextId) {
    query = query.eq('context_type', contextType).eq('context_id', contextId)
  } else if (!contextType) {
    // По умолчанию — общий чат (без контекста)
    query = query.is('context_type', null)
  }

  if (q) {
    // ILIKE по тексту сообщения и имени отправителя
    const escaped = q.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.or(`message.ilike.%${escaped}%,sender_name.ilike.%${escaped}%`)
  }

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  const messageIds = (data || []).map((m: any) => m.id)

  // Активные закрепления (pinned_until > now())
  let pins: any[] = []
  if (!contextType) {
    const nowIso = new Date().toISOString()
    let pinQuery = supabase
      .from('team_chat_messages')
      .select('id, sender_name, message, attachments, pinned_until, is_announcement, created_at')
      .gt('pinned_until', nowIso)
      .is('deleted_at', null)
      .order('pinned_until', { ascending: false })
      .limit(5)
    if (orgId) pinQuery = pinQuery.or(`organization_id.eq.${orgId},organization_id.is.null`)
    const { data: pinData } = await pinQuery
    pins = pinData || []
  }

  // Батч-загрузка реакций и опросов одним заходом, чтобы клиент не делал N+1.
  const reactionsByMsg: Record<string, any[]> = {}
  const pollsByMsg: Record<string, any> = {}

  if (messageIds.length > 0) {
    const pollMessageIds = (data || [])
      .filter((m: any) => Array.isArray(m.attachments) && (m.attachments as any[]).some((a: any) => a?.type === 'poll'))
      .map((m: any) => m.id)

    const [reactionsRes, pollsRes] = await Promise.all([
      supabase
        .from('team_chat_reactions')
        .select('id, message_id, user_id, user_name, emoji')
        .in('message_id', messageIds),
      pollMessageIds.length > 0
        ? supabase
            .from('team_chat_polls')
            .select('id, message_id, question, options, multiple_choice, expires_at, created_at')
            .in('message_id', pollMessageIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    for (const r of reactionsRes.data || []) {
      const k = (r as any).message_id
      if (!reactionsByMsg[k]) reactionsByMsg[k] = []
      reactionsByMsg[k].push({
        id: (r as any).id,
        user_id: (r as any).user_id,
        user_name: (r as any).user_name,
        emoji: (r as any).emoji,
      })
    }

    const polls = (pollsRes.data || []) as any[]
    if (polls.length > 0) {
      const pollIds = polls.map((p) => p.id)
      const { data: votes } = await supabase
        .from('team_chat_poll_votes')
        .select('poll_id, option_id, voter_user_id, voter_name')
        .in('poll_id', pollIds)

      const votesByPoll: Record<string, any[]> = {}
      for (const v of votes || []) {
        const k = (v as any).poll_id
        if (!votesByPoll[k]) votesByPoll[k] = []
        votesByPoll[k].push(v)
      }

      const myUserId = access.user?.id || null
      for (const p of polls) {
        const pv = votesByPoll[p.id] || []
        const counts: Record<string, number> = {}
        const voters: Record<string, string[]> = {}
        for (const v of pv) {
          counts[v.option_id] = (counts[v.option_id] || 0) + 1
          if (!voters[v.option_id]) voters[v.option_id] = []
          voters[v.option_id].push(v.voter_name)
        }
        const myVote = pv.filter((v: any) => v.voter_user_id === myUserId).map((v: any) => v.option_id)
        pollsByMsg[p.message_id] = {
          poll: p,
          counts,
          voters,
          myVote,
          totalVotes: pv.length,
        }
      }
    }
  }

  // Прикрепляем реакции к каждому сообщению (inline) + отдаём polls map.
  const enriched = (data || []).map((m: any) => ({
    ...m,
    reactions: reactionsByMsg[m.id] || [],
  }))

  // Возвращаем в обратном порядке (старые → новые)
  return json({ messages: enriched.reverse(), pinned: pins, polls: pollsByMsg })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: false })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as {
    message?: string
    attachments?: Array<{ type: string; url: string; name?: string }>
    replyToId?: string
    isAnnouncement?: boolean
    pinnedUntil?: string
    contextType?: string
    contextId?: string
    contextLabel?: string
  } | null

  const messageText = String(body?.message || '').trim()
  if (!messageText && !(body?.attachments?.length)) {
    return json({ error: 'Сообщение пустое' }, 400)
  }
  if (messageText.length > 2000) {
    return json({ error: 'Сообщение слишком длинное (макс 2000)' }, 400)
  }

  // Фильтр мата — regex (мгновенно) + AI fallback (только если regex пропустил)
  if (messageText) {
    const profanity = await checkProfanity(messageText)
    if (profanity.blocked) {
      return json({ error: profanity.reason || 'Сообщение содержит запрещённую лексику', code: 'profanity' }, 422)
    }
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Определяем кто пишет
  let senderUserId: string | null = null
  let senderOperatorId: string | null = null
  let senderName = 'Аноним'
  let senderRole = 'guest'

  if (access.user) {
    senderUserId = access.user.id
  }
  if (access.staffMember) {
    senderName = access.staffMember.full_name || access.user?.email || 'Сотрудник'
    senderRole = access.staffMember.role || 'staff'
  } else if (access.operatorAuth) {
    senderOperatorId = access.operatorAuth.operator_id
    senderRole = 'operator'
    // Подтягиваем имя оператора из таблицы operators
    const { data: op } = await supabase
      .from('operators')
      .select('short_name, name')
      .eq('id', access.operatorAuth.operator_id)
      .maybeSingle()
    senderName = (op as any)?.short_name || (op as any)?.name || access.operatorAuth.username || 'Оператор'
  } else if (access.isSuperAdmin) {
    senderName = access.user?.email || 'Супер-админ'
    senderRole = 'super_admin'
  }

  // Только владелец/super-admin может ставить is_announcement
  const isOwnerOrSuper =
    access.isSuperAdmin || (access.staffMember?.role || '').toLowerCase() === 'owner'
  const isAnnouncement = !!body?.isAnnouncement && isOwnerOrSuper

  const { data, error } = await supabase
    .from('team_chat_messages')
    .insert({
      organization_id: access.activeOrganization?.id || null,
      sender_user_id: senderUserId,
      sender_operator_id: senderOperatorId,
      sender_name: senderName,
      sender_role: senderRole,
      message: messageText,
      attachments: body?.attachments || null,
      reply_to_id: body?.replyToId || null,
      is_announcement: isAnnouncement,
      pinned_until: body?.pinnedUntil || null,
      context_type: body?.contextType || null,
      context_id: body?.contextId || null,
      context_label: body?.contextLabel || null,
    })
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, message, attachments, reply_to_id, edited_at, deleted_at, is_announcement, pinned_until, context_type, context_id, context_label, created_at')
    .single()

  if (error) return json({ error: error.message }, 500)

  return json({ message: data })
}

/**
 * PATCH — редактировать своё сообщение.
 * Body: { id, message }
 */
export async function PATCH(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: false })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as
    | { id?: string; message?: string }
    | null
  if (!body?.id || typeof body?.message !== 'string') {
    return json({ error: 'id и message обязательны' }, 400)
  }
  const newText = body.message.trim()
  if (!newText) return json({ error: 'Пустое сообщение' }, 400)
  if (newText.length > 2000) return json({ error: 'Слишком длинное' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Проверяем что сообщение принадлежит этому юзеру/оператору
  const { data: existing } = await supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id')
    .eq('id', body.id)
    .maybeSingle()

  if (!existing) return json({ error: 'Сообщение не найдено' }, 404)

  const ownsByUser = access.user && existing.sender_user_id === access.user.id
  const ownsByOperator =
    access.operatorAuth && existing.sender_operator_id === access.operatorAuth.operator_id
  if (!ownsByUser && !ownsByOperator && !access.isSuperAdmin) {
    return json({ error: 'Можно редактировать только свои сообщения' }, 403)
  }

  const { data, error } = await supabase
    .from('team_chat_messages')
    .update({ message: newText, edited_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, message, attachments, reply_to_id, edited_at, created_at')
    .single()
  if (error) return json({ error: error.message }, 500)

  return json({ message: data })
}

/**
 * DELETE — мягкое удаление (выставляет deleted_at).
 * Body: { id }
 */
export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: false })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return json({ error: 'id обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: existing } = await supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id')
    .eq('id', body.id)
    .maybeSingle()

  if (!existing) return json({ error: 'Сообщение не найдено' }, 404)

  const ownsByUser = access.user && existing.sender_user_id === access.user.id
  const ownsByOperator =
    access.operatorAuth && existing.sender_operator_id === access.operatorAuth.operator_id
  if (!ownsByUser && !ownsByOperator && !access.isSuperAdmin) {
    return json({ error: 'Можно удалять только свои сообщения' }, 403)
  }

  const { error } = await supabase
    .from('team_chat_messages')
    .update({ deleted_at: new Date().toISOString(), message: '', attachments: null })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true })
}
