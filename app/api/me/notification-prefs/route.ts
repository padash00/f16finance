/**
 * Настройки уведомлений пользователя.
 * GET — список (channel × event_type → enabled)
 * POST { channel, eventType, enabled } — обновить одну запись
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const VALID_CHANNELS = ['push', 'telegram', 'in_app']
const VALID_EVENTS = [
  'team_chat_message', 'dm', 'announcement', 'mention',
  'shift_assigned', 'shift_changed',
  'task_assigned', 'task_commented',
  'debt_overdue', 'debt_added',
  'birthday', 'holiday',
  'news_post',
]

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { data } = await supabase
    .from('notification_prefs')
    .select('channel, event_type, enabled')
    .eq('user_id', access.user.id)

  return json({ prefs: data || [], channels: VALID_CHANNELS, events: VALID_EVENTS })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response
  if (!access.user?.id) return json({ error: 'unauthorized' }, 401)

  const body = (await request.json().catch(() => null)) as
    | { channel?: string; eventType?: string; enabled?: boolean }
    | null

  if (!body?.channel || !body?.eventType) return json({ error: 'channel + eventType' }, 400)
  if (!VALID_CHANNELS.includes(body.channel)) return json({ error: 'invalid channel' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  await supabase.from('notification_prefs').upsert(
    {
      user_id: access.user.id,
      channel: body.channel,
      event_type: body.eventType,
      enabled: !!body.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,channel,event_type' },
  )

  return json({ ok: true })
}
