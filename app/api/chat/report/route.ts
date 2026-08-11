import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Жалоба на сообщение.
 *
 * Требование App Store к приложениям с перепиской: человек должен уметь
 * пожаловаться на чужое сообщение прямо в приложении, а не писать в поддержку.
 * Фильтр мата и ночная проверка ИИ ловят не всё — угрозу или травлю
 * распознаёт только тот, кому она адресована.
 *
 * Жалоба ложится в тот же журнал модерации, что и находки ИИ: владелец
 * разбирает их в одном месте. Отличается только пометкой — «пожаловался
 * человек», и это важнее машинной оценки.
 *
 *   POST /api/chat/report  { source: 'team_chat' | 'direct_messages', messageId, reason? }
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  source?: 'team_chat' | 'direct_messages'
  messageId?: string
  reason?: string
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as Body | null
    const source = body?.source === 'direct_messages' ? 'direct_messages' : 'team_chat'
    const messageId = String(body?.messageId || '').trim()
    if (!messageId) return json({ error: 'messageId обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const orgId = access.activeOrganization?.id || null

    const table = source === 'team_chat' ? 'team_chat_messages' : 'direct_messages'
    const { data: message } = await supabase
      .from(table)
      .select('id, sender_user_id, sender_name, message, organization_id')
      .eq('id', messageId)
      .maybeSingle()

    if (!message) return json({ error: 'Сообщение не найдено' }, 404)

    // Изоляция: пожаловаться можно только на то, что видишь.
    const messageOrg = (message as any).organization_id || null
    if (!access.isSuperAdmin && messageOrg && messageOrg !== orgId) {
      return json({ error: 'Сообщение не найдено' }, 404)
    }

    const reason = String(body?.reason || '').trim().slice(0, 500)

    // Одна жалоба на сообщение: таблица так и устроена. Повторная от другого
    // человека дополняет причину, а не создаёт вторую запись — владельцу важно
    // разобрать случай один раз.
    const { data: existing } = await supabase
      .from('chat_moderation_flags')
      .select('id, ai_summary')
      .eq('source_table', source)
      .eq('source_message_id', messageId)
      .maybeSingle()

    const note = `Жалоба от пользователя${reason ? `: ${reason}` : ''}`

    if (existing) {
      await supabase
        .from('chat_moderation_flags')
        .update({
          status: 'pending',
          ai_summary: [(existing as any).ai_summary, note].filter(Boolean).join(' · '),
        })
        .eq('id', (existing as any).id)
      return json({ ok: true, duplicate: true })
    }

    const { error } = await supabase.from('chat_moderation_flags').insert({
      source_table: source,
      source_message_id: messageId,
      author_user_id: (message as any).sender_user_id || null,
      author_name: (message as any).sender_name || 'Аноним',
      organization_id: messageOrg || orgId,
      message_text: String((message as any).message || ''),
      // Жалоба человека весомее машинной оценки: ставим высокую важность,
      // чтобы она не потерялась среди находок ночной проверки.
      severity: 7,
      categories: ['user_report'],
      ai_summary: note,
      ai_model: null,
      status: 'pending',
    })

    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/chat/report POST',
      message: error?.message || 'error',
    })
    return json({ error: 'report-failed' }, 500)
  }
}
