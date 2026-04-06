import { NextResponse } from 'next/server'
import { ensureOrganizationOperatorAccess } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = await request.json().catch(() => null)
    const { operatorId, chatId, username, password, name } = body ?? {}

    if (!operatorId || !chatId || !username || !password) {
      return NextResponse.json({ error: 'operatorId, chatId, username и password обязательны' }, { status: 400 })
    }

    await ensureOrganizationOperatorAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      operatorId: String(operatorId),
    })

    const who = escapeTelegramHtml(String(name || username))
    const u = escapeTelegramHtml(String(username))
    const p = escapeTelegramHtml(String(password))
    const text = [
      `<b>🔐 Вход в Orda Point</b>`,
      ``,
      `👤 <b>${who}</b>`,
      ``,
      `🔑 Логин`,
      `<code>${u}</code>`,
      ``,
      `🔐 Пароль`,
      `<code>${p}</code>`,
      ``,
      `<i>Сохраните сообщение и введите данные в программе на кассе.</i>`,
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
