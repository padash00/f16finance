import { NextResponse } from 'next/server'
import { requireAdminRequest } from '@/lib/server/request-auth'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

export async function POST(request: Request) {
  try {
    const guard = await requireAdminRequest(request)
    if (guard) return guard

    const body = await request.json().catch(() => null)
    const { chatId, username, password, name } = body ?? {}

    if (!chatId || !username || !password) {
      return NextResponse.json({ error: 'chatId, username и password обязательны' }, { status: 400 })
    }

    const text = [
      `🔐 <b>Данные для входа в Orda Point</b>`,
      ``,
      `👤 ${name || username}`,
      `🔑 Логин: <code>${username}</code>`,
      `🔐 Пароль: <code>${password}</code>`,
      ``,
      `Введите эти данные в программе на кассе.`,
    ].join('\n')

    const result = await sendTelegramMessage(chatId, text)

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Не удалось отправить сообщение' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'send-operator-credentials', message: error?.message })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
