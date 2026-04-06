import { NextResponse } from 'next/server'

import { requiredEnv } from '@/lib/server/env'
import { sendSystemEmail } from '@/lib/server/mailer'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function outboxMessageText(payload: Record<string, unknown>) {
  const providedText = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (providedText) return providedText

  const kind = String(payload.kind || '')
  if (kind === 'ticket_status_changed') {
    const status = String(payload.status || 'updated')
    return `Статус вашего обращения обновлён: ${status}.`
  }
  if (kind === 'client_support_created') {
    return 'Ваше обращение получено. Команда клуба скоро ответит.'
  }
  return 'У вас есть обновление в личном кабинете Orda.'
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  try {
    const supabase = createAdminSupabaseClient()
    const nowIso = new Date().toISOString()

    const { data: rows, error } = await supabase
      .from('client_notification_outbox')
      .select('id, customer_id, ticket_id, channel, status, payload, attempts, scheduled_at')
      .eq('status', 'pending')
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(100)

    if (error) throw error

    let sent = 0
    let failed = 0

    for (const row of rows || []) {
      const channel = String((row as any).channel || '')
      const payload = payloadRecord((row as any).payload)
      const attempts = Number((row as any).attempts || 0) + 1

      try {
        if (channel === 'in_app') {
          const { error: markSentError } = await supabase
            .from('client_notification_outbox')
            .update({
              status: 'sent',
              attempts,
              sent_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', (row as any).id)
          if (markSentError) throw markSentError
          sent++
          continue
        }

        if (channel === 'telegram') {
          const payloadChatId =
            (typeof payload.telegramChatId === 'string' && payload.telegramChatId.trim()) ||
            (typeof payload.chatId === 'string' && payload.chatId.trim()) ||
            null

          const { data: customerRow, error: customerError } = await supabase
            .from('customers')
            .select('id, name')
            .eq('id', String((row as any).customer_id || ''))
            .maybeSingle()
          if (customerError) throw customerError

          if (!payloadChatId) throw new Error('telegram-chat-id-missing')

          const text = [
            `<b>Обновление для клиента</b>`,
            `Клиент: ${escapeTelegramHtml(String(customerRow?.name || 'Клиент'))}`,
            ``,
            escapeTelegramHtml(outboxMessageText(payload)),
          ].join('\n')

          const telegramResult = await sendTelegramMessage(payloadChatId, text, { parseMode: 'HTML' })
          if (!telegramResult.ok) throw new Error(telegramResult.error || 'telegram-send-failed')

          const { error: markSentError } = await supabase
            .from('client_notification_outbox')
            .update({
              status: 'sent',
              attempts,
              sent_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', (row as any).id)
          if (markSentError) throw markSentError
          sent++
          continue
        }

        if (channel === 'email') {
          const payloadEmail = typeof payload.email === 'string' ? payload.email.trim() : ''
          let email = payloadEmail
          if (!email) {
            const { data: customerRow, error: customerError } = await supabase
              .from('customers')
              .select('email')
              .eq('id', String((row as any).customer_id || ''))
              .maybeSingle()
            if (customerError) throw customerError
            email = String(customerRow?.email || '').trim()
          }
          if (!email) throw new Error('customer-email-missing')

          const message = outboxMessageText(payload)
          await sendSystemEmail({
            to: email,
            subject: 'Обновление в личном кабинете Orda',
            text: message,
          })

          const { error: markSentError } = await supabase
            .from('client_notification_outbox')
            .update({
              status: 'sent',
              attempts,
              sent_at: new Date().toISOString(),
              last_error: null,
            })
            .eq('id', (row as any).id)
          if (markSentError) throw markSentError
          sent++
          continue
        }

        throw new Error(`unsupported-channel:${channel || 'unknown'}`)
      } catch (deliveryError: any) {
        const { error: markFailedError } = await supabase
          .from('client_notification_outbox')
          .update({
            status: 'failed',
            attempts,
            last_error: String(deliveryError?.message || deliveryError || 'delivery-failed'),
          })
          .eq('id', (row as any).id)
        if (markFailedError) throw markFailedError
        failed++
      }
    }

    return json({
      ok: true,
      scanned: (rows || []).length,
      sent,
      failed,
    })
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'client-outbox-cron-failed' }, 500)
  }
}
