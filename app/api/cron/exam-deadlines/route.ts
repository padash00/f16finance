import { NextResponse } from 'next/server'

import { requiredEnv } from '@/lib/server/env'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { pushToOperators } from '@/lib/server/push'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

/**
 * Напоминание о несданном экзамене.
 *
 * Аттестацию назначают на неделю, и половина операторов вспоминает о ней в
 * последний день — если вообще вспоминает. Владелец потом видит «не сдал» и не
 * знает, лень это или человек не заметил. Напоминаем за сутки и в день срока:
 * дальше это уже осознанный выбор, а не забывчивость.
 *
 * Раз в сутки. Повторно за один и тот же день не шлём — отметка стоит на самой
 * попытке.
 *
 *   GET /api/cron/exam-deadlines
 */

export const runtime = 'nodejs'

const DAY_MS = 24 * 3600_000

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (auth !== `Bearer ${requiredEnv('CRON_SECRET')}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminSupabaseClient()
    const now = new Date()
    const today = dayKey(now)

    // Открытые попытки: разосланные и начатые. Завершённые, просроченные и
    // отменённые не трогаем.
    const { data: attempts, error } = await supabase
      .from('operator_exam_attempts')
      .select('id, operator_id, telegram_chat_id, status, reminded_on, total_questions, current_index, exam:exam_id(title, deadline_at, status)')
      .in('status', ['pending', 'sent', 'in_progress'])
      .limit(500)

    if (error) throw error

    let sent = 0
    const remindedIds: string[] = []

    for (const row of (attempts || []) as any[]) {
      const exam = Array.isArray(row.exam) ? row.exam[0] : row.exam
      if (!exam?.deadline_at) continue
      if (exam.status === 'cancelled' || exam.status === 'finished') continue
      // Уже напоминали сегодня.
      if (row.reminded_on === today) continue

      const deadline = new Date(exam.deadline_at)
      const left = deadline.getTime() - now.getTime()
      // Окно: сутки до срока и сам день срока. Раньше — рано, позже — поздно.
      if (left <= 0 || left > DAY_MS) continue

      const remaining = Math.max(0, Number(row.total_questions || 0) - Number(row.current_index || 0))
      const hours = Math.max(1, Math.round(left / 3600_000))
      const title = String(exam.title || 'Экзамен')

      await pushToOperators(supabase, [String(row.operator_id)], {
        title: 'Экзамен ждёт',
        body: `${title}: осталось ${remaining} ${plural(remaining)} и примерно ${hours} ч. «Профиль» → «Экзамены».`,
        data: { kind: 'operator-exam' },
      })

      // Telegram — тем, у кого он есть: половина операторов живёт в нём, а не
      // в приложении.
      if (row.telegram_chat_id) {
        await sendTelegramMessage(
          String(row.telegram_chat_id),
          [
            '⏰ <b>Экзамен ещё не сдан</b>',
            '',
            escapeTelegramHtml(title),
            `Осталось ${remaining} ${plural(remaining)}, срок истекает примерно через ${hours} ч.`,
          ].join('\n'),
        ).catch(() => null)
      }

      remindedIds.push(String(row.id))
      sent += 1
    }

    if (remindedIds.length > 0) {
      await supabase
        .from('operator_exam_attempts')
        .update({ reminded_on: today })
        .in('id', remindedIds)
    }

    return NextResponse.json({ ok: true, sent })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/exam-deadlines',
      message: error?.message || 'error',
    })
    return NextResponse.json({ ok: false, error: 'exam-deadlines-failed' }, { status: 500 })
  }
}

function plural(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'вопрос'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вопроса'
  return 'вопросов'
}
