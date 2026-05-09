/**
 * Личные сообщения (DM) 1-на-1.
 *
 * POST { recipientUserId, message, attachments?, replyToId? } — отправить новое DM
 * PATCH { id, message } — редактировать своё (только sender)
 * DELETE { id } — мягкое удаление (только sender)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function resolveSender(access: any, supabase: any) {
  let senderName = 'Аноним'
  let senderRole = 'staff'
  if (access.staffMember) {
    senderName = access.staffMember.full_name || access.user?.email || 'Сотрудник'
    senderRole = access.staffMember.role || 'staff'
  } else if (access.operatorAuth) {
    senderRole = 'operator'
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
  return { senderName, senderRole }
}

async function resolveRecipientName(supabase: any, recipientUserId: string): Promise<string> {
  // Сначала ищем staff, затем operator
  const { data: staff } = await supabase
    .from('staff')
    .select('full_name')
    .eq('user_id', recipientUserId)
    .maybeSingle()
  if ((staff as any)?.full_name) return String((staff as any).full_name)

  const { data: opAuth } = await supabase
    .from('operator_auth')
    .select('operator_id')
    .eq('user_id', recipientUserId)
    .maybeSingle()
  if ((opAuth as any)?.operator_id) {
    const { data: op } = await supabase
      .from('operators')
      .select('short_name, name')
      .eq('id', (opAuth as any).operator_id)
      .maybeSingle()
    return (op as any)?.short_name || (op as any)?.name || 'Получатель'
  }
  return 'Получатель'
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as {
    recipientUserId?: string
    message?: string
    attachments?: Array<{ type: string; url: string; name?: string; size?: number }>
    replyToId?: string
  } | null

  const recipientUserId = String(body?.recipientUserId || '').trim()
  const messageText = String(body?.message || '').trim()
  if (!recipientUserId) return json({ error: 'recipientUserId обязателен' }, 400)
  if (recipientUserId === access.user.id) return json({ error: 'Нельзя писать самому себе' }, 400)
  if (!messageText && !(body?.attachments?.length)) {
    return json({ error: 'Сообщение пустое' }, 400)
  }
  if (messageText.length > 2000) return json({ error: 'Слишком длинное (макс 2000)' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { senderName, senderRole } = await resolveSender(access, supabase)
  const recipientName = await resolveRecipientName(supabase, recipientUserId)

  const { data, error } = await supabase
    .from('direct_messages')
    .insert({
      sender_user_id: access.user.id,
      recipient_user_id: recipientUserId,
      sender_name: senderName,
      sender_role: senderRole,
      recipient_name: recipientName,
      message: messageText,
      attachments: body?.attachments || null,
      reply_to_id: body?.replyToId || null,
    })
    .select('*')
    .single()

  if (error) return json({ error: error.message }, 500)
  return json({ message: data })
}

export async function PATCH(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as { id?: string; message?: string } | null
  if (!body?.id || typeof body?.message !== 'string') return json({ error: 'id и message обязательны' }, 400)
  const newText = body.message.trim()
  if (!newText) return json({ error: 'Пустое сообщение' }, 400)
  if (newText.length > 2000) return json({ error: 'Слишком длинное' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: existing } = await supabase
    .from('direct_messages')
    .select('sender_user_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!existing) return json({ error: 'Сообщение не найдено' }, 404)
  if ((existing as any).sender_user_id !== access.user.id && !access.isSuperAdmin) {
    return json({ error: 'Можно редактировать только свои' }, 403)
  }

  const { data, error } = await supabase
    .from('direct_messages')
    .update({ message: newText, edited_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .single()
  if (error) return json({ error: error.message }, 500)
  return json({ message: data })
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return json({ error: 'id обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { data: existing } = await supabase
    .from('direct_messages')
    .select('sender_user_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!existing) return json({ error: 'Сообщение не найдено' }, 404)
  if ((existing as any).sender_user_id !== access.user.id && !access.isSuperAdmin) {
    return json({ error: 'Можно удалять только свои' }, 403)
  }

  const { error } = await supabase
    .from('direct_messages')
    .update({ deleted_at: new Date().toISOString(), message: '', attachments: null })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
