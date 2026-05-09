/**
 * Cron: авто-поздравление сотрудников с днём рождения.
 *
 * Каждый день в 9:00 Алматы (4:00 UTC) проверяет всех активных операторов:
 * у кого operator_profiles.birth_date = сегодня (день+месяц).
 * Шлёт тёплое поздравление в личный Telegram + копию владельцу.
 */

import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

const GREETINGS = [
  '🎉 С днём рождения, {name}!\n\nСпасибо что ты часть нашей команды. Желаю тебе здоровья, успехов и большой удачи в году вперёд. От всей команды — обнимаем!',
  '🎂 С праздником, {name}!\n\nПусть этот год станет лучшим. Здоровья, любви, и крутых эмоций! Команда тебя очень ценит.',
  '✨ {name}, с днём рождения!\n\nТы делаешь нашу команду сильнее каждый день. Желаю тебе всего самого доброго, что только может быть. Празднуй ярко!',
  '🎈 С днюхой, {name}!\n\nСпасибо за работу, за энергию и хорошее настроение. Пусть исполнятся самые крутые мечты. Обнимаем!',
]

function pickGreeting(name: string): string {
  const idx = Math.floor(Date.now() / 86400000) % GREETINGS.length
  return GREETINGS[idx].replace('{name}', name)
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const today = new Date()
  const todayMonth = today.getMonth() + 1
  const todayDay = today.getDate()

  // Все активные операторы с их профилями и telegram chat_id
  const { data: operators, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(full_name, birth_date)')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sent: { name: string; chat: string }[] = []
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID

  for (const op of (operators as any[]) || []) {
    const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] : op.operator_profiles
    if (!profile?.birth_date) continue

    const [, m, d] = String(profile.birth_date).split('-').map(Number)
    if (m !== todayMonth || d !== todayDay) continue

    const displayName = profile.full_name || op.short_name || op.name
    const personalChat = String(op.telegram_chat_id || '')
    if (!personalChat) continue

    // Личное поздравление
    try {
      await sendTelegramMessage(personalChat, pickGreeting(displayName), { parseMode: 'HTML' })
      sent.push({ name: displayName, chat: personalChat })
    } catch (e: any) {
      console.error(`[birthday] failed for ${displayName}:`, e?.message)
    }

    // Напоминание владельцу
    if (ownerChatId) {
      try {
        await sendTelegramMessage(
          ownerChatId,
          `🎂 Сегодня день рождения у <b>${displayName}</b>. Команда уже отправила поздравление. Не забудь поздравить голосом / купить торт / выдать бонус.`,
          { parseMode: 'HTML' },
        )
      } catch {}
    }
  }

  return NextResponse.json({ ok: true, sent: sent.length, recipients: sent })
}
