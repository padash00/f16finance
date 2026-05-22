import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { requiredEnv } from '@/lib/server/env'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

const KZ_OFFSET = 5 * 3600_000
// Окно, в котором ещё уместно отправить напоминание (на случай задержки крона).
const FIRE_WINDOW_MIN = 12

function kzNow() {
  const d = new Date(Date.now() + KZ_OFFSET)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return { date, minutes }
}

function kzDateOf(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(new Date(iso).getTime() + KZ_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// 'HH:MM:SS' | 'HH:MM' -> минуты от начала суток
function timeToMinutes(t: string | null): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const { date: today, minutes: nowMin } = kzNow()

  // Кандидаты: с включённым напоминанием и заданным временем.
  const { data: tasks, error } = await supabase
    .from('personal_tasks')
    .select('id, user_id, title, recurrence, task_date, task_time, remind_minutes_before, last_reminded_at')
    .eq('remind', true)
    .not('task_time', 'is', null)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const due = (tasks || []).filter((t: any) => {
    // разовые — только в свою дату
    if (t.recurrence === 'once' && t.task_date !== today) return false
    // уже напоминали сегодня?
    if (kzDateOf(t.last_reminded_at) === today) return false
    const tMin = timeToMinutes(t.task_time)
    if (tMin === null) return false
    const fireAt = tMin - Number(t.remind_minutes_before || 0)
    return nowMin >= fireAt && nowMin < fireAt + FIRE_WINDOW_MIN
  })

  if (due.length === 0) {
    return NextResponse.json({ ok: true, checked: tasks?.length || 0, sent: 0 })
  }

  // Резолв chat_id: user_id -> operator_auth.operator_id -> operators.telegram_chat_id
  const userIds = Array.from(new Set(due.map((t: any) => t.user_id)))
  const { data: auths } = await supabase
    .from('operator_auth')
    .select('user_id, operator_id')
    .in('user_id', userIds)
  const operatorIdByUser = new Map<string, string>(
    ((auths || []) as any[]).map((a) => [String(a.user_id), String(a.operator_id)]),
  )
  const operatorIds = Array.from(new Set(Array.from(operatorIdByUser.values())))
  let chatByOperator = new Map<string, string>()
  if (operatorIds.length > 0) {
    const { data: ops } = await supabase
      .from('operators')
      .select('id, telegram_chat_id')
      .in('id', operatorIds)
    chatByOperator = new Map(
      ((ops || []) as any[])
        .filter((o) => o.telegram_chat_id)
        .map((o) => [String(o.id), String(o.telegram_chat_id)]),
    )
  }

  // Не дёргаем тех, кто уже отметил задачу сделанной сегодня.
  const dueIds = due.map((t: any) => t.id)
  const { data: comps } = await supabase
    .from('personal_task_completions')
    .select('task_id')
    .eq('done_date', today)
    .in('task_id', dueIds)
  const doneToday = new Set(((comps || []) as any[]).map((c) => String(c.task_id)))

  let sent = 0
  for (const t of due) {
    if (doneToday.has(String(t.id))) continue
    const opId = operatorIdByUser.get(String(t.user_id))
    const chatId = opId ? chatByOperator.get(opId) : null
    if (!chatId) continue

    const timeLabel = String(t.task_time).slice(0, 5)
    const text =
      `⏰ <b>Напоминание</b>\n\n` +
      `${escapeTelegramHtml(t.title)}\n` +
      `🕐 ${timeLabel}`

    const res = await sendTelegramMessage(chatId, text, { parseMode: 'HTML' })
    if (res.ok) {
      sent++
      await supabase
        .from('personal_tasks')
        .update({ last_reminded_at: new Date().toISOString() })
        .eq('id', t.id)
    }
  }

  return NextResponse.json({ ok: true, checked: tasks?.length || 0, due: due.length, sent })
}
