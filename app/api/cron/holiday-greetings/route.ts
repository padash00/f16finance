/**
 * Cron: авто-поздравление команды с государственными праздниками РК.
 *
 * Каждый день проверяет — не сегодня ли праздник. Если да — шлёт поздравление
 * всем активным операторам с telegram_chat_id + копию владельцу.
 *
 * Расписание: каждое утро 9:00 Алматы.
 */

import { NextResponse } from 'next/server'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

interface Holiday {
  month: number
  day: number
  name: string
  greeting: string
  emoji: string
}

const HOLIDAYS: Holiday[] = [
  {
    month: 1, day: 1, emoji: '🎄', name: 'Новый год',
    greeting: 'С Новым годом, {name}! 🎄\n\nПусть этот год принесёт здоровье, успех и много добрых моментов. Спасибо что ты с нами!',
  },
  {
    month: 1, day: 2, emoji: '🎄', name: 'Новый год (2-й день)',
    greeting: 'Продолжаем праздник! 🎉 С новогодними каникулами, {name}! Отдыхай как следует.',
  },
  {
    month: 3, day: 8, emoji: '💐', name: 'Международный женский день',
    greeting: 'С 8 Марта, {name}! 💐\n\nСпасибо за тепло, заботу и труд. Пусть весна принесёт радость. Ты прекрасна!',
  },
  {
    month: 3, day: 21, emoji: '🌷', name: 'Наурыз',
    greeting: 'Наурыз құтты болсын, {name}! 🌷\n\nЖаңа жыл жаңа сәттіліктер әкелсін! Здоровья тебе и твоим близким.',
  },
  {
    month: 3, day: 22, emoji: '🌷', name: 'Наурыз (2-й день)',
    greeting: 'Наурыз мейрамын құттықтаймыз, {name}! 🌷 Берекелі күндер тілейміз.',
  },
  {
    month: 3, day: 23, emoji: '🌷', name: 'Наурыз (3-й день)',
    greeting: 'Наурыз көрісу күні құтты болсын, {name}! 🌷',
  },
  {
    month: 5, day: 1, emoji: '🤝', name: 'Праздник единства народа Казахстана',
    greeting: 'С праздником единства народа Казахстана, {name}! 🤝\n\nМы — одна команда, одна семья. Мира и согласия!',
  },
  {
    month: 5, day: 7, emoji: '🛡', name: 'День защитника Отечества',
    greeting: 'С Днём защитника Отечества, {name}! 🛡 Спасибо за службу всем кто защищал и защищает.',
  },
  {
    month: 5, day: 9, emoji: '🌹', name: 'День Победы',
    greeting: 'С Днём Победы, {name}! 🌹\n\nПомним подвиг тех, кто отстоял мир. Низкий поклон ветеранам.',
  },
  {
    month: 7, day: 6, emoji: '🇰🇿', name: 'День Столицы',
    greeting: 'С Днём Столицы, {name}! 🇰🇿\n\nАстана — наша гордость. Желаю тебе процветания и здоровья!',
  },
  {
    month: 8, day: 30, emoji: '🇰🇿', name: 'День Конституции',
    greeting: 'С Днём Конституции, {name}! 🇰🇿\n\nС праздником, желаю мира и стабильности.',
  },
  {
    month: 10, day: 25, emoji: '🇰🇿', name: 'Республика күні',
    greeting: 'Республика күні құтты болсын, {name}! 🇰🇿\n\nБейбітшілік пен берекелі тірлік тілеймін.',
  },
  {
    month: 12, day: 1, emoji: '🌟', name: 'День Первого Президента',
    greeting: 'С Днём Первого Президента, {name}! 🌟',
  },
  {
    month: 12, day: 16, emoji: '🇰🇿', name: 'День Независимости',
    greeting: 'С Днём Независимости, {name}! 🇰🇿\n\nПусть мир, процветание и независимость всегда будут с нами. Гордимся нашей страной!',
  },
  {
    month: 12, day: 17, emoji: '🇰🇿', name: 'День Независимости (2-й день)',
    greeting: 'С праздником Независимости, {name}! 🇰🇿',
  },
]

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const todayMonth = today.getMonth() + 1
  const todayDay = today.getDate()

  const holiday = HOLIDAYS.find((h) => h.month === todayMonth && h.day === todayDay)
  if (!holiday) {
    return NextResponse.json({ ok: true, holiday: null })
  }

  const supabase = createAdminSupabaseClient()
  const { data: operators, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(full_name)')
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sent: { name: string }[] = []
  for (const op of (operators as any[]) || []) {
    const profile = Array.isArray(op.operator_profiles) ? op.operator_profiles[0] : op.operator_profiles
    const displayName = profile?.full_name || op.short_name || op.name || 'друг'
    const chat = String(op.telegram_chat_id || '')
    if (!chat) continue

    try {
      await sendTelegramMessage(chat, holiday.greeting.replace('{name}', displayName), { parseMode: 'HTML' })
      sent.push({ name: displayName })
    } catch (e: any) {
      console.error(`[holiday-greetings] failed for ${displayName}:`, e?.message)
    }
  }

  // Уведомляем владельца
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID
  if (ownerChatId) {
    try {
      await sendTelegramMessage(
        ownerChatId,
        `${holiday.emoji} Сегодня <b>${holiday.name}</b>. Команде разослано поздравление (${sent.length} человек).`,
        { parseMode: 'HTML' },
      )
    } catch {}
  }

  return NextResponse.json({ ok: true, holiday: holiday.name, sent: sent.length })
}
