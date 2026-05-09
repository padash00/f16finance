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

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const orgId = access.activeOrganization?.id || null

  let query = supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, sender_avatar_url, message, attachments, reply_to_id, edited_at, deleted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (orgId) {
    query = query.or(`organization_id.eq.${orgId},organization_id.is.null`)
  }
  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  // Возвращаем в обратном порядке (старые → новые)
  return json({ messages: (data || []).reverse() })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: false })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as {
    message?: string
    attachments?: Array<{ type: string; url: string; name?: string }>
    replyToId?: string
  } | null

  const messageText = String(body?.message || '').trim()
  if (!messageText && !(body?.attachments?.length)) {
    return json({ error: 'Сообщение пустое' }, 400)
  }
  if (messageText.length > 2000) {
    return json({ error: 'Сообщение слишком длинное (макс 2000)' }, 400)
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
    })
    .select('id, sender_user_id, sender_operator_id, sender_name, sender_role, message, attachments, reply_to_id, created_at')
    .single()

  if (error) return json({ error: error.message }, 500)

  return json({ message: data })
}
