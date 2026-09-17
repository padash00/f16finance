import { NextResponse } from 'next/server'
import { ensureOrganizationOperatorAccess } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const denied = await requireStaffCapability(access, 'operators.send_credentials_telegram')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    // chatId из запроса больше не используется (клиенты ещё присылают — игнорируем)
    const { operatorId, password, name } = body ?? {}

    if (!operatorId || !password) {
      return NextResponse.json({ error: 'operatorId и password обязательны' }, { status: 400 })
    }

    await ensureOrganizationOperatorAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      operatorId: String(operatorId),
    })

    // Пароль уходит ТОЛЬКО в Telegram самого оператора и только с его настоящим
    // логином. Раньше chatId и логин брались из запроса — пароль можно было
    // отправить в любой чат, а поля использовать для произвольного текста от бота.
    const supabase = createAdminSupabaseClient()
    const [{ data: operatorRow }, { data: authRow }] = await Promise.all([
      supabase.from('operators').select('telegram_chat_id').eq('id', String(operatorId)).maybeSingle(),
      supabase.from('operator_auth').select('username').eq('operator_id', String(operatorId)).maybeSingle(),
    ])
    const chatId = String((operatorRow as { telegram_chat_id?: string | null } | null)?.telegram_chat_id || '').trim()
    const username = String((authRow as { username?: string | null } | null)?.username || '').trim()
    if (!chatId) return NextResponse.json({ error: 'У оператора не указан Telegram ID' }, { status: 400 })
    if (!username) return NextResponse.json({ error: 'У оператора нет учётной записи для входа' }, { status: 400 })
    if (String(password).length > 128) return NextResponse.json({ error: 'Некорректный пароль' }, { status: 400 })

    const who = escapeTelegramHtml(String(name || username).slice(0, 80))
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
