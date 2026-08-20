import 'server-only'

import { isApnsToken, sendApnsPush, type ApnsPayload } from '@/lib/server/apns'
import { writeNotificationLogSafe } from '@/lib/server/audit'
import type { AdminSupabaseClient } from '@/lib/server/supabase'

type ExpoMessage = { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: 'default' }

export type PushPayload = {
  title: string
  body: string
  data?: Record<string, unknown>
  /** Значение бейджа на иконке (только Apple). */
  badge?: number
  /** Категория действий в уведомлении — «Одобрить»/«Отклонить» из шторки (только Apple). */
  categoryId?: string
  /** Схлопывать повторы с тем же идентификатором (только Apple). */
  collapseId?: string
}

/** Токен Expo-приложения (React Native). */
function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken/.test(token)
}

/** Отправка через Expo Push API (чанки по 100). Best-effort, не кидает. */
export async function sendExpoPush(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  const valid = Array.from(new Set(tokens.filter((t) => t && isExpoToken(t))))
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

/**
 * Отправка на любые устройства: Expo и нативные Apple одновременно.
 *
 * Приложений два и они будут сосуществовать: Expo-версия остаётся на Android и
 * у тех, кто ещё не перешёл, нативное — на iPhone/iPad/Mac. Токены лежат в
 * одной таблице `mobile_push_tokens`, поэтому разделяем их по форме токена, а
 * не по колонке `platform` — она заполняется клиентом и ей нельзя доверять.
 *
 * Возвращает список токенов, которые APNs признал мёртвыми навсегда.
 */
export async function sendPush(
  tokens: string[],
  payload: PushPayload,
): Promise<{ invalidTokens: string[]; sent: number; reasons: string[]; configError?: string }> {
  const cleaned = tokens.map((t) => String(t || '').trim()).filter(Boolean)
  if (cleaned.length === 0) return { invalidTokens: [], sent: 0, reasons: [] }

  const expoTokens = cleaned.filter(isExpoToken)
  const apnsTokens = cleaned.filter(isApnsToken)

  const apnsPayload: ApnsPayload = {
    title: payload.title,
    body: payload.body,
    data: payload.data,
    badge: payload.badge,
    categoryId: payload.categoryId,
    collapseId: payload.collapseId,
  }

  const [, apnsResult] = await Promise.all([
    sendExpoPush(expoTokens, payload),
    sendApnsPush(apnsTokens, apnsPayload),
  ])

  // Записываем каждую отправку.
  //
  // На вопрос «уведомления вообще работают?» ответить было нечем: отправки
  // нигде не оставляли следа. Не пришло — и непонятно, сервер не отправил,
  // Apple не принял или телефон не показал. Теперь первые два случая видны:
  // сколько адресов было, сколько ушло и что ответил Apple.
  //
  // Молча и в стороне: журнал не должен мешать отправке.
  void writeNotificationLogSafe({
    channel: 'push',
    recipient: `устройств: ${cleaned.length}`,
    status: apnsResult.configError ? 'failed' : apnsResult.sent > 0 ? 'sent' : 'skipped',
    payload: {
      title: payload.title,
      tokens: cleaned.length,
      apple: apnsTokens.length,
      expo: expoTokens.length,
      sent: apnsResult.sent,
      invalid: apnsResult.invalidTokens.length,
      config_error: apnsResult.configError || null,
      reasons: apnsResult.reasons.slice(0, 5),
    },
  })

  // Наверх отдаём и причины отказа: без них поломка настройки выглядит как
  // успешная отправка, и разбираться в «уведомления не приходят» нечем.
  return {
    invalidTokens: apnsResult.invalidTokens,
    sent: apnsResult.sent,
    reasons: apnsResult.reasons,
    configError: apnsResult.configError,
  }
}

/**
 * Удалить токены, которые APNs признал невалидными.
 *
 * Без этого мёртвые токены копятся годами: приложение удалили, а мы продолжаем
 * стучаться в Apple на каждом уведомлении.
 */
async function pruneInvalidTokens(supabase: AdminSupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  try {
    await supabase.from('mobile_push_tokens').delete().in('token', tokens)
  } catch {
    /* best-effort */
  }
}

/** Push всем устройствам организации. */
export async function pushToOrganization(
  supabase: AdminSupabaseClient,
  organizationId: string | null,
  payload: PushPayload,
): Promise<void> {
  if (!organizationId) return
  try {
    const { data } = await supabase.from('mobile_push_tokens').select('token').eq('organization_id', organizationId)
    const tokens = ((data as any[]) || []).map((r) => String(r.token)).filter(Boolean)
    const { invalidTokens } = await sendPush(tokens, payload)
    await pruneInvalidTokens(supabase, invalidTokens)
  } catch {
    /* best-effort */
  }
}

/** Push конкретным пользователям (по user_id). */
export async function pushToUsers(
  supabase: AdminSupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  const ids = userIds.filter(Boolean)
  if (ids.length === 0) return
  try {
    const { data } = await supabase.from('mobile_push_tokens').select('token').in('user_id', ids)
    const tokens = ((data as any[]) || []).map((r) => String(r.token)).filter(Boolean)
    const { invalidTokens } = await sendPush(tokens, payload)
    await pruneInvalidTokens(supabase, invalidTokens)
  } catch {
    /* best-effort */
  }
}

/** Push конкретным операторам (по operator_id). Нужен для смен и чек-листов. */
export async function pushToOperators(
  supabase: AdminSupabaseClient,
  operatorIds: string[],
  payload: PushPayload,
): Promise<void> {
  const ids = operatorIds.filter(Boolean)
  if (ids.length === 0) return
  try {
    const { data } = await supabase.from('mobile_push_tokens').select('token').in('operator_id', ids)
    const tokens = ((data as any[]) || []).map((r) => String(r.token)).filter(Boolean)
    const { invalidTokens } = await sendPush(tokens, payload)
    await pruneInvalidTokens(supabase, invalidTokens)
  } catch {
    /* best-effort */
  }
}
