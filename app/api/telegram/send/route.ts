import { NextResponse } from 'next/server'

import { writeNotificationLog } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createRequestSupabaseClient, requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  chatId: string
  text: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const guard = await requireAdminRequest(req)
    if (guard) return guard

    const body = (await req.json().catch(() => null)) as Body | null
    const chatId = body?.chatId?.trim()
    const text = body?.text?.trim()

    if (!chatId) return json({ error: 'chatId обязателен' }, 400)
    if (!text) return json({ error: 'text обязателен' }, 400)

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN')
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: 'true',
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) {
      console.error('Task telegram send error', payload)
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: chatId,
        status: 'failed',
        payload: { kind: 'manual-send', error: payload?.description || 'telegram-error' },
      })
      return json({ error: payload?.description || 'Telegram не принял сообщение' }, 502)
    }

    await writeNotificationLog(supabase, {
      channel: 'telegram',
      recipient: chatId,
      status: 'sent',
      payload: { kind: 'manual-send' },
    })

    return json({ ok: true })
  } catch (error: any) {
    console.error('Task telegram route error', error)
    return json({ error: error?.message || 'Server error' }, 500)
  }
}
