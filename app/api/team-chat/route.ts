/**
 * Командный чат — общий для всех ролей.
 * GET — последние N сообщений (paginate by before/after timestamps)
 * POST — отправить новое сообщение
 *
 * Авторизация: любой залогиненный (staff, operator, owner) может читать и писать.
 */

import { NextResponse } from 'next/server'
import { hasCapability } from '@/lib/server/capabilities'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
import { pushToOrganization, pushToUsers } from '@/lib/server/push'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sanitizeOrFilterValue } from '@/lib/server/postgrest-filter'
import { checkProfanity } from '@/lib/ai/profanity-filter'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * Кого упомянули в тексте.
 *
 * `@все` и `@all` зовут всю организацию. Имена берём как есть — сравнивать
 * будем по началу строки, потому что в чате пишут «@Асель», а в базе человек
 * записан «Асель Кадырова».
 */
function extractMentions(text: string): { all: boolean; names: string[] } {
  const raw = Array.from(text.matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)).map((m) => m[1].toLowerCase())
  if (raw.length === 0) return { all: false, names: [] }
  const all = raw.some((name) => name === 'все' || name === 'all' || name === 'всем')
  return { all, names: Array.from(new Set(raw.filter((name) => !['все', 'all', 'всем'].includes(name)))) }
}

/** Пользователи организации, чьи имена начинаются с упомянутого. */
async function resolveMentionTargets(
  supabase: any,
  orgId: string,
  names: string[],
  senderUserId: string | null,
): Promise<string[]> {
  const matches = (candidate: string | null | undefined) => {
    const value = String(candidate || '').trim().toLowerCase()
    if (!value) return false
    // По первому слову: «@асель» должно находить «Асель Кадырову», но не
    // «Асельхан» — иначе уведомление уходит не тому.
    const first = value.split(/\s+/)[0]
    return names.some((name) => first === name || value === name)
  }

  const targets = new Set<string>()

  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, email, staff:staff_id(full_name, short_name)')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .not('user_id', 'is', null)

  for (const row of (members as any[]) || []) {
    const person = Array.isArray(row.staff) ? row.staff[0] : row.staff
    if (matches(person?.full_name) || matches(person?.short_name) || matches(row.email)) {
      targets.add(String(row.user_id))
    }
  }

  // Операторы — только своей организации, через её точки. Без этого фильтра
  // тёзка из чужого клуба получал бы уведомление о разговоре, которого не
  // видит.
  const companyIds = await listOrganizationCompanyIds({
    activeOrganizationId: orgId,
    isSuperAdmin: false,
  })

  if (companyIds && companyIds.length > 0) {
    const [{ data: assignments }, { data: auths }] = await Promise.all([
      supabase
        .from('operator_company_assignments')
        .select('operator_id, is_active, operator:operator_id(name, short_name)')
        .in('company_id', companyIds)
        .eq('is_active', true),
      supabase.from('operator_auth').select('operator_id, user_id, username, is_active'),
    ])

    const userByOperator = new Map<string, { userId: string; username: string | null }>()
    for (const row of (auths as any[]) || []) {
      if (row.is_active === false || !row.user_id) continue
      userByOperator.set(String(row.operator_id), {
        userId: String(row.user_id),
        username: row.username || null,
      })
    }

    for (const row of (assignments as any[]) || []) {
      const person = Array.isArray(row.operator) ? row.operator[0] : row.operator
      const auth = userByOperator.get(String(row.operator_id))
      if (!auth) continue
      if (matches(person?.short_name) || matches(person?.name) || matches(auth.username)) {
        targets.add(auth.userId)
      }
    }
  }

  // Себя не дёргаем: упоминание собственного имени в своём же сообщении
  // случается, когда цитируют переписку.
  if (senderUserId) targets.delete(senderUserId)
  return Array.from(targets)
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

  // Без организации показывать нечего. Раньше при её отсутствии фильтр просто
  // не ставился — и человек видел переписку всех организаций сразу.
  if (!orgId) return json({ messages: [], pinned: [], hasMore: false })

  let query = supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, sender_avatar_url, message, attachments, reply_to_id, edited_at, deleted_at, is_announcement, pinned_until, context_type, context_id, context_label, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  // Строго по организации. Раньше сюда добавлялось `organization_id.is.null`,
  // и сообщение без организации видели все клиенты разом: достаточно было
  // написать в чат, не выбрав организацию, чтобы текст ушёл наружу.
  query = query.eq('organization_id', orgId)
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
    // ILIKE по тексту сообщения и имени отправителя (с защитой от .or()-инъекции)
    const safe = sanitizeOrFilterValue(q)
    query = query.or(`message.ilike.%${safe}%,sender_name.ilike.%${safe}%`)
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
    pinQuery = pinQuery.eq('organization_id', orgId)
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

  // Фотографии отправителей.
  //
  // В самом сообщении `sender_avatar_url` никогда не заполнялся — поле есть, а
  // писать в него забыли, и в чате у всех были инициалы, даже когда фото
  // загружено. Берём текущее фото по отправителю: так поменявший аватар
  // человек меняет его и в старой переписке, а не только в новых сообщениях.
  const operatorIds = Array.from(
    new Set((data || []).map((m: any) => m.sender_operator_id).filter(Boolean).map(String)),
  )
  const userIds = Array.from(
    new Set(
      (data || [])
        .filter((m: any) => !m.sender_operator_id)
        .map((m: any) => m.sender_user_id)
        .filter(Boolean)
        .map(String),
    ),
  )

  const avatarByOperator = new Map<string, string>()
  const avatarByUser = new Map<string, string>()

  if (operatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('operator_profiles')
      .select('operator_id, photo_url')
      .in('operator_id', operatorIds)
    for (const row of (profiles as any[]) || []) {
      if (row.photo_url) avatarByOperator.set(String(row.operator_id), String(row.photo_url))
    }
  }

  if (userIds.length > 0) {
    const { data: members } = await supabase
      .from('organization_members')
      .select('user_id, staff:staff_id(photo_url)')
      .eq('organization_id', orgId)
      .in('user_id', userIds)
    for (const row of (members as any[]) || []) {
      const person = Array.isArray(row.staff) ? row.staff[0] : row.staff
      if (person?.photo_url) avatarByUser.set(String(row.user_id), String(person.photo_url))
    }
  }

  // Прикрепляем реакции к каждому сообщению (inline) + отдаём polls map.
  const enriched = (data || []).map((m: any) => ({
    ...m,
    sender_avatar_url:
      (m.sender_operator_id ? avatarByOperator.get(String(m.sender_operator_id)) : null) ||
      (m.sender_user_id ? avatarByUser.get(String(m.sender_user_id)) : null) ||
      m.sender_avatar_url ||
      null,
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
    // Только regex, без обращения к ИИ: оно занимало секунду-две на каждом
    // сообщении, и человек ждал ответа сервера, глядя на замерший экран.
    // Всё, что regex пропустит, разберёт крон `chat-moderation` — он и так
    // проходит по переписке каждые пять минут и кладёт подозрительное в
    // очередь модерации. Ту же работу дважды делать незачем.
    const profanity = await checkProfanity(messageText, false)
    if (profanity.blocked) {
      return json({ error: profanity.reason || 'Сообщение содержит запрещённую лексику', code: 'profanity' }, 422)
    }
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Сообщение без организации видели бы все клиенты сразу: чат читается по
  // организации, и `null` там означает «всем». Лучше отказать, чем разослать.
  const orgId = access.activeOrganization?.id || null
  if (!orgId) return json({ error: 'Не выбрана организация' }, 400)

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

  // Закрепление — отдельное право `team-chat.pin`, а не роль владельца:
  // объявление в чате команды вправе повесить и тот, кому это доверили.
  const isAnnouncement = !!body?.isAnnouncement && (await hasCapability(access, 'team-chat.pin'))

  const { data, error } = await supabase
    .from('team_chat_messages')
    .insert({
      organization_id: orgId,
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

  // Упоминания.
  //
  // В общем чате точки за смену десятки сообщений, и адресованное конкретному
  // человеку тонет в общем потоке. `@все` — отдельный случай: так зовут всю
  // смену, и это ближе к объявлению, чем к личному обращению.
  const mentioned = extractMentions(messageText)
  if (mentioned.all) {
    await pushToOrganization(supabase, orgId, {
      title: `${senderName} обращается ко всем`,
      body: messageText.slice(0, 140),
      data: { kind: 'team-chat-mention' },
    })
  } else if (mentioned.names.length > 0) {
    const targets = await resolveMentionTargets(supabase, orgId, mentioned.names, senderUserId)
    if (targets.length > 0) {
      await pushToUsers(supabase, targets, {
        title: `${senderName} упомянул вас`,
        body: messageText.slice(0, 140),
        data: { kind: 'team-chat-mention' },
      })
    }
  }

  // Объявление — уведомлением всей организации.
  //
  // Обычные сообщения не шлём намеренно: в чате точки за смену их десятки, и
  // push на каждое приучает выключать уведомления вообще — вместе с теми, что
  // действительно важны. Объявление вешают, когда его должны прочитать все:
  // смена переносится, точка закрывается, поменялись цены.
  if (isAnnouncement) {
    await pushToOrganization(supabase, orgId, {
      title: 'Объявление',
      body: `${senderName}: ${messageText.slice(0, 120)}`,
      data: { kind: 'team-chat-announcement' },
    })
  }

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
