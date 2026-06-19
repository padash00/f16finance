/**
 * Закрепить / открепить сообщение в командном чате.
 * POST { id, until: ISO } — закрепить до даты
 * DELETE { id } — открепить
 *
 * Право: автор сообщения, владелец или super-admin.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManagePin(access: any, msg: any): boolean {
  if (access.isSuperAdmin) return true
  if ((access.staffMember?.role || '').toLowerCase() === 'owner') return true
  if (access.user?.id && msg?.sender_user_id === access.user.id) return true
  if (access.operatorAuth?.operator_id && msg?.sender_operator_id === access.operatorAuth.operator_id) return true
  return false
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { id?: string; until?: string } | null
  if (!body?.id || !body?.until) return json({ error: 'id и until обязательны' }, 400)

  const untilDate = new Date(body.until)
  if (isNaN(untilDate.getTime())) return json({ error: 'until: некорректная дата' }, 400)
  if (untilDate.getTime() < Date.now()) return json({ error: 'until должна быть в будущем' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const { data: msg } = await supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id, organization_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!msg) return json({ error: 'Сообщение не найдено' }, 404)
  // Изоляция: нельзя трогать сообщение чужой орг по присланному id.
  if (!access.isSuperAdmin && (msg as any).organization_id && (msg as any).organization_id !== (access.activeOrganization?.id || null)) {
    return json({ error: 'Сообщение не найдено' }, 404)
  }
  if (!canManagePin(access, msg)) return json({ error: 'Нет прав закреплять это' }, 403)

  const { data, error } = await supabase
    .from('team_chat_messages')
    .update({ pinned_until: untilDate.toISOString() })
    .eq('id', body.id)
    .select('id, pinned_until')
    .single()
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, pinned: data })
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return json({ error: 'id обязателен' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { data: msg } = await supabase
    .from('team_chat_messages')
    .select('id, sender_user_id, sender_operator_id, organization_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!msg) return json({ error: 'Сообщение не найдено' }, 404)
  if (!access.isSuperAdmin && (msg as any).organization_id && (msg as any).organization_id !== (access.activeOrganization?.id || null)) {
    return json({ error: 'Сообщение не найдено' }, 404)
  }
  if (!canManagePin(access, msg)) return json({ error: 'Нет прав' }, 403)

  await supabase.from('team_chat_messages').update({ pinned_until: null }).eq('id', body.id)
  return json({ ok: true })
}
