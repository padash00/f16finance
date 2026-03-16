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

  return NextResponse.json({
    hasToken: true,
    hasChatId: !!chatId,
    hasWebhookSecret: !!webhookSecret,
    botInfo: botRes?.ok ? botRes.result : null,
    webhookInfo: webhookRes?.ok ? webhookRes.result : null,
  })
}
