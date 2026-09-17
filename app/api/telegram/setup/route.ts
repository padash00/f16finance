import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireAddon } from '@/lib/server/entitlements'

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  const addonDenied = await requireAddon(access, 'addon.telegram')
  if (addonDenied) return addonDenied
  // Бот один на всю платформу: переустановка вебхука — только суперадмин.
  // Раньше мог владелец любой организации и указать СВОЙ адрес — тогда к нему
  // уходили бы сообщения всех арендаторов вместе с секретом вебхука.
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN не настроен в .env' }, { status: 400 })
  }

  // Адрес не берём из запроса: только наш домен и наш путь вебхука.
  const siteUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  if (!/^https:\/\//.test(siteUrl)) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL не настроен (нужен https-адрес сайта)' }, { status: 400 })
  }
  const webhookUrl = `${siteUrl}/api/telegram/webhook`

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

  return NextResponse.json({ ok: true, description: json.description, webhookUrl })
}
