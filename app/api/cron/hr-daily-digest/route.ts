/**
 * HR daily digest — раз в день автоматом разносит важные события:
 *   • ДР операторов сегодня → пост в /news + Telegram владельцу
 *   • Годовщины найма сегодня → то же
 *   • Список «без логина» если > 0 → инфо-пост
 *
 * Запускать через Vercel Cron в vercel.json:
 *   { "path": "/api/cron/hr-daily-digest", "schedule": "0 6 * * *" }  // 9:00 UTC+3 = 6:00 UTC
 *
 * Защита: header `x-cron-secret` или query `?secret=` должен совпасть с
 * env CRON_SECRET. Иначе 401.
 */

import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function isToday(iso: string | null, today: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
}

function yearsSince(iso: string, today: Date): number {
  const d = new Date(iso)
  let y = today.getFullYear() - d.getFullYear()
  if (
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())
  ) {
    y -= 1
  }
  return y
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch {
    // не падаем
  }
}

export async function GET(request: Request) {
  // Защита: секрет должен совпадать
  const url = new URL(request.url)
  const provided = request.headers.get('x-cron-secret') || url.searchParams.get('secret')
  const expected = process.env.CRON_SECRET
  if (expected && provided !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!hasAdminSupabaseCredentials()) {
    return json({ error: 'no_admin_creds' }, 500)
  }
  const supabase = createAdminSupabaseClient()
  const today = new Date()

  // Соберём данные
  const [profilesRes, opsRes, staffRes, authRes] = await Promise.all([
    supabase.from('operator_profiles').select('operator_id, full_name, birth_date, hire_date'),
    supabase.from('operators').select('id, name, is_active, dismissed_at'),
    supabase.from('staff').select('id, full_name, role, is_active, dismissed_at, telegram_chat_id'),
    supabase.from('operator_auth').select('operator_id, is_active'),
  ])

  const profiles = (profilesRes.data || []) as any[]
  const ops = (opsRes.data || []) as any[]
  const staff = (staffRes.data || []) as any[]
  const auth = (authRes.data || []) as any[]

  const profileById = new Map<string, any>()
  for (const p of profiles) profileById.set(p.operator_id, p)
  const activeOps = ops.filter((o) => o.is_active && !o.dismissed_at)
  const activeStaff = staff.filter((s) => s.is_active && !s.dismissed_at)
  const opIdsWithAuth = new Set(auth.filter((a) => a.is_active).map((a) => a.operator_id))

  // ДР сегодня (только операторы — staff пока без birth_date)
  const birthdaysToday: Array<{ name: string; age?: number }> = []
  for (const o of activeOps) {
    const profile = profileById.get(o.id)
    if (profile?.birth_date && isToday(profile.birth_date, today)) {
      const age = yearsSince(profile.birth_date, today)
      birthdaysToday.push({ name: profile.full_name || o.name || '—', age })
    }
  }

  // Годовщины сегодня
  const anniversariesToday: Array<{ name: string; years: number }> = []
  for (const o of activeOps) {
    const profile = profileById.get(o.id)
    if (profile?.hire_date && isToday(profile.hire_date, today)) {
      const years = yearsSince(profile.hire_date, today)
      if (years > 0) anniversariesToday.push({ name: profile.full_name || o.name || '—', years })
    }
  }

  // Операторы без логина
  const noLogin = activeOps.filter((o) => !opIdsWithAuth.has(o.id))

  // Куда пушить — staff с telegram_chat_id (владелец/менеджер увидят сводку)
  const recipients = activeStaff
    .filter((s) => s.telegram_chat_id && (s.role === 'owner' || s.role === 'manager'))
    .map((s) => s.telegram_chat_id as string)

  // Формируем посты в news_feed
  const newsRows: Array<{ title: string; body: string; pinned_until?: string }> = []
  if (birthdaysToday.length > 0) {
    const list = birthdaysToday.map((b) => `🎂 ${b.name}${b.age ? ` (${b.age} лет)` : ''}`).join('\n')
    newsRows.push({
      title: `🎂 День рождения сегодня`,
      body: `${list}\n\nНе забудьте поздравить!`,
    })
  }
  if (anniversariesToday.length > 0) {
    const list = anniversariesToday.map((a) => `🎉 ${a.name} — ${a.years} ${a.years === 1 ? 'год' : a.years < 5 ? 'года' : 'лет'} в команде`).join('\n')
    newsRows.push({
      title: `🎉 Годовщина в команде`,
      body: list,
    })
  }
  if (noLogin.length > 0 && noLogin.length <= 10) {
    newsRows.push({
      title: `⚠️ ${noLogin.length} оператор${noLogin.length === 1 ? '' : 'ов'} без логина`,
      body: noLogin.map((o) => `• ${profileById.get(o.id)?.full_name || o.name}`).join('\n') + '\n\nСоздай аккаунты на /hr или /operators.',
    })
  }

  // Постим в news_feed
  let postedCount = 0
  for (const row of newsRows) {
    try {
      await supabase.from('news_posts').insert({
        title: row.title,
        body: row.body,
        author_name: 'HR-бот',
        pinned_until: null,
      })
      postedCount++
    } catch {
      // если таблица news_posts иначе называется — не падаем
    }
  }

  // Шлём Telegram
  let telegramSent = 0
  for (const chatId of recipients) {
    const lines: string[] = ['<b>HR-сводка</b>']
    if (birthdaysToday.length > 0) {
      lines.push('', '🎂 <b>Сегодня ДР:</b>')
      for (const b of birthdaysToday) lines.push(`• ${b.name}${b.age ? ` (${b.age} лет)` : ''}`)
    }
    if (anniversariesToday.length > 0) {
      lines.push('', '🎉 <b>Годовщина в команде:</b>')
      for (const a of anniversariesToday) lines.push(`• ${a.name} — ${a.years} ${a.years === 1 ? 'год' : a.years < 5 ? 'года' : 'лет'}`)
    }
    if (noLogin.length > 0) {
      lines.push('', `⚠️ <b>Без логина:</b> ${noLogin.length} оператор${noLogin.length === 1 ? '' : 'ов'}`)
    }
    if (lines.length > 1) {
      await sendTelegram(chatId, lines.join('\n'))
      telegramSent++
    }
  }

  return json({
    ok: true,
    posted: postedCount,
    telegram_sent: telegramSent,
    birthdays: birthdaysToday.length,
    anniversaries: anniversariesToday.length,
    no_login: noLogin.length,
  })
}
