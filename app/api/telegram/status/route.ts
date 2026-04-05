import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

  if (!token) {
    return NextResponse.json({
      hasToken: false,
      hasChatId: false,
      hasWebhookSecret: false,
      botInfo: null,
      webhookInfo: null,
    })
  }

  const [botRes, webhookRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getMe`)
      .then((r) => r.json())
      .catch(() => null),
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
      .then((r) => r.json())
      .catch(() => null),
  ])

  const webhookRaw = webhookRes?.ok ? webhookRes.result : null

  return NextResponse.json({
    hasToken: true,
    hasChatId: !!chatId,
    hasWebhookSecret: !!webhookSecret,
    botInfo: botRes?.ok ? botRes.result : null,
    // Не возвращаем URL webhook и ip_address — чувствительная инфраструктурная информация
    webhookInfo: webhookRaw
      ? {
          has_custom_certificate: webhookRaw.has_custom_certificate,
          pending_update_count: webhookRaw.pending_update_count,
          last_error_date: webhookRaw.last_error_date,
          last_error_message: webhookRaw.last_error_message,
          max_connections: webhookRaw.max_connections,
          allowed_updates: webhookRaw.allowed_updates,
          isConfigured: !!webhookRaw.url,
        }
      : null,
  })
}
