import 'server-only'

import type { AdminSupabaseClient } from '@/lib/server/supabase'

type ExpoMessage = { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: 'default' }

/** Отправка через Expo Push API (чанки по 100). Best-effort, не кидает. */
export async function sendExpoPush(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  const valid = Array.from(new Set(tokens.filter((t) => t && /^Expo(nent)?PushToken/.test(t))))
  if (valid.length === 0) return
  const messages: ExpoMessage[] = valid.map((to) => ({ to, title: payload.title, body: payload.body, data: payload.data || {}, sound: 'default' }))
  for (let i = 0; i < messages.length; i += 100) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      })
    } catch {
      /* best-effort */
    }
  }
}

/** Push всем устройствам организации. */
export async function pushToOrganization(
  supabase: AdminSupabaseClient,
  organizationId: string | null,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!organizationId) return
  try {
    const { data } = await supabase.from('mobile_push_tokens').select('token').eq('organization_id', organizationId)
    const tokens = ((data as any[]) || []).map((r) => String(r.token)).filter(Boolean)
    await sendExpoPush(tokens, payload)
  } catch {
    /* best-effort */
  }
}

/** Push конкретным пользователям (по user_id). */
export async function pushToUsers(
  supabase: AdminSupabaseClient,
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  const ids = userIds.filter(Boolean)
  if (ids.length === 0) return
  try {
    const { data } = await supabase.from('mobile_push_tokens').select('token').in('user_id', ids)
    const tokens = ((data as any[]) || []).map((r) => String(r.token)).filter(Boolean)
    await sendExpoPush(tokens, payload)
  } catch {
    /* best-effort */
  }
}
