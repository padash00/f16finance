import { NextResponse } from 'next/server'

import { writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

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
    if (!/^-?\d+$/.test(chatId)) return json({ error: 'chatId должен быть числом' }, 400)
    if (!text) return json({ error: 'text обязателен' }, 400)
    if (text.length > 4096) return json({ error: 'text не должен превышать 4096 символов' }, 400)

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    const core = `<b>📨 Сообщение от команды</b>\n\n${escapeTelegramHtml(text)}`
    const result = await sendTelegramMessage(chatId, core)
    if (!result.ok) {
      console.error('Task telegram send error', result.error)
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: chatId,
        status: 'failed',
        payload: { kind: 'manual-send', error: result.error || 'telegram-error' },
      })
      return json({ error: result.error || 'Telegram не принял сообщение' }, 502)
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
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/telegram/send',
      message: error?.message || 'Task telegram route error',
    })
    return json({ error: error?.message || 'Server error' }, 500)
  }
}
