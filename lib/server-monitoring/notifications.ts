import 'server-only'

import { randomUUID } from 'node:crypto'

import { formatMonitorTelegramMessage } from '@/lib/server-monitoring/notification-format'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export { formatMonitorTelegramMessage } from '@/lib/server-monitoring/notification-format'

type OutboxRow = {
  id: string
  status: string
  attempt_count: number
  max_attempts: number
  payload: Record<string, unknown>
}

async function sendMonitorTelegram(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_MONITOR_BOT_TOKEN
  const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID
  if (!token || !chatId) return { ok: false, error: 'monitor Telegram environment is not configured' }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatMonitorTelegramMessage(payload),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
    })
    const body = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null
    if (!response.ok || body?.ok !== true) {
      return { ok: false, error: body?.description || `Telegram HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Telegram network error' }
  }
}

export async function processMonitorNotificationOutbox(limit = 20): Promise<{
  claimed: number
  sent: number
  failed: number
}> {
  const supabase = createAdminSupabaseClient()
  const workerId = `monitor:${process.env.VERCEL_REGION || 'local'}:${randomUUID()}`
  const { data, error } = await supabase.rpc('server_monitor_claim_notifications', {
    p_worker_id: workerId,
    p_limit: Math.min(100, Math.max(1, limit)),
    p_now: new Date().toISOString(),
  })
  if (error) throw error

  const rows = (data || []) as OutboxRow[]
  let sent = 0
  let failed = 0
  for (const row of rows) {
    const result = await sendMonitorTelegram(row.payload || {})
    if (result.ok) {
      const { error: updateError } = await supabase
        .from('server_monitor_notification_outbox')
        .update({
          status: 'sent', sent_at: new Date().toISOString(), locked_at: null,
          locked_by: null, last_error: null,
        })
        .eq('id', row.id)
        .eq('status', 'processing')
      if (updateError) throw updateError
      sent += 1
      continue
    }

    const exhausted = row.attempt_count >= row.max_attempts
    const retrySeconds = Math.min(3600, 30 * (2 ** Math.max(0, row.attempt_count - 1)))
    const { error: updateError } = await supabase
      .from('server_monitor_notification_outbox')
      .update({
        status: exhausted ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: String(result.error || 'Telegram send failed').slice(0, 2000),
      })
      .eq('id', row.id)
      .eq('status', 'processing')
    if (updateError) throw updateError
    failed += 1
  }

  return { claimed: rows.length, sent, failed }
}

export async function sendMonitorTestNotification(params: {
  serverId: string
  organizationId: string
  serverName: string
  hostname?: string | null
}) {
  const supabase = createAdminSupabaseClient()
  const dedupeKey = `test:${params.serverId}:${randomUUID()}`
  const { error } = await supabase.from('server_monitor_notification_outbox').insert({
    server_id: params.serverId,
    organization_id: params.organizationId,
    alert_event_id: null,
    dedupe_key: dedupeKey,
    message_kind: 'test',
    payload: {
      serverId: params.serverId,
      serverName: params.serverName,
      hostname: params.hostname || null,
      title: 'Тест мониторинга',
      message: 'Канал мониторинга ORDA настроен.',
      transition: 'opened',
      severity: 'warning',
      value: 'OK',
      unit: '',
      occurredAt: new Date().toISOString(),
    },
  })
  if (error) throw error
  return processMonitorNotificationOutbox(1)
}
