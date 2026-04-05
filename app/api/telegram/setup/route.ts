import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN не настроен в .env' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const webhookUrl = body.webhookUrl as string
  if (!webhookUrl) {
    return NextResponse.json({ error: 'webhookUrl обязателен' }, { status: 400 })
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const params: Record<string, string> = { url: webhookUrl }
  if (secret) params.secret_token = secret

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const json = await res.json()
  if (!json.ok) {
    return NextResponse.json(
      { error: json.description || 'Ошибка регистрации вебхука' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, description: json.description })
}
