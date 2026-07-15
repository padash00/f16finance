import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

// Ежедневный дайджест по задачам с дедлайном: каждый исполнитель утром получает
// список своих задач — что горит сегодня, что скоро, что уже просрочено.
// Напоминаем каждый день до истечения срока и после (пока задача не закрыта).

const KZ_OFFSET = 5 * 3600_000

function kzToday(): string {
  const d = new Date(Date.now() + KZ_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.UTC(
    Number(fromISO.slice(0, 4)),
    Number(fromISO.slice(5, 7)) - 1,
    Number(fromISO.slice(8, 10)),
  )
  const to = Date.UTC(
    Number(toISO.slice(0, 4)),
    Number(toISO.slice(5, 7)) - 1,
    Number(toISO.slice(8, 10)),
  )
  return Math.round((to - from) / 86_400_000)
}

function daysWord(n: number): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return 'дней'
  if (last === 1) return 'день'
  if (last >= 2 && last <= 4) return 'дня'
  return 'дней'
}

type TaskRow = {
  id: string
  task_number: number
  title: string
  status: string
  due_date: string
  operator_id: string | null
  staff_id?: string | null
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const today = kzToday()

  try {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, task_number, title, status, due_date, operator_id, staff_id')
      .in('status', ['backlog', 'todo', 'in_progress', 'review'])
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
    if (error) throw error

    const rows = (tasks || []) as TaskRow[]
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, tasks: 0, sent: 0 })
    }

    // Получатель: оператор или сотрудник-исполнитель.
    const operatorIds = Array.from(new Set(rows.map((t) => t.operator_id).filter(Boolean))) as string[]
    const staffIds = Array.from(new Set(rows.map((t) => (t.operator_id ? null : t.staff_id)).filter(Boolean))) as string[]

    const [operatorsRes, staffRes] = await Promise.all([
      operatorIds.length
        ? supabase.from('operators').select('id, name, short_name, telegram_chat_id, operator_profiles(full_name)').in('id', operatorIds)
        : Promise.resolve({ data: [], error: null } as any),
      staffIds.length
        ? supabase.from('staff').select('id, full_name, short_name, telegram_chat_id').in('id', staffIds)
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (operatorsRes.error) throw operatorsRes.error
    if (staffRes.error) throw staffRes.error

    const recipients = new Map<string, { chatId: string; name: string; tasks: TaskRow[] }>()

    const chatKeyOf = (task: TaskRow): { chatId: string; name: string } | null => {
      if (task.operator_id) {
        const operator = ((operatorsRes.data || []) as any[]).find((o) => String(o.id) === String(task.operator_id))
        if (!operator?.telegram_chat_id) return null
        return { chatId: String(operator.telegram_chat_id), name: getOperatorDisplayName(operator, 'Оператор') }
      }
      if (task.staff_id) {
        const member = ((staffRes.data || []) as any[]).find((s) => String(s.id) === String(task.staff_id))
        if (!member?.telegram_chat_id) return null
        return { chatId: String(member.telegram_chat_id), name: String(member.full_name || member.short_name || 'Сотрудник') }
      }
      return null
    }

    for (const task of rows) {
      const recipient = chatKeyOf(task)
      if (!recipient) continue
      const bucket = recipients.get(recipient.chatId) || { chatId: recipient.chatId, name: recipient.name, tasks: [] }
      bucket.tasks.push(task)
      recipients.set(recipient.chatId, bucket)
    }

    let sent = 0
    let failed = 0

    for (const { chatId, tasks: personTasks } of recipients.values()) {
      const lines: string[] = ['⏰ <b>Напоминание по задачам</b>', '']

      const sorted = [...personTasks].sort(
        (a, b) => daysBetween(today, a.due_date) - daysBetween(today, b.due_date) || a.task_number - b.task_number,
      )

      for (const task of sorted) {
        const left = daysBetween(today, task.due_date)
        const label =
          left < 0
            ? `🔴 просрочено на ${Math.abs(left)} ${daysWord(left)}`
            : left === 0
              ? '🟠 срок сегодня'
              : left === 1
                ? '🟡 срок завтра'
                : `🟡 осталось ${left} ${daysWord(left)}`
        lines.push(`<b>#${task.task_number}</b> ${escapeTelegramHtml(task.title)} — ${label}`)
      }

      lines.push('', `<i>Ответьте текстом:</i> <code>#${sorted[0].task_number} готово</code> <i>— задача закроется.</i>`)

      const result = await sendTelegramMessage(chatId, lines.join('\n'), { skipFrame: true })
      if (result.ok) {
        sent += 1
      } else {
        failed += 1
      }

      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: chatId,
        status: result.ok ? 'sent' : 'failed',
        payload: {
          kind: 'task-daily-reminder',
          task_ids: personTasks.map((t) => t.id),
          task_numbers: personTasks.map((t) => t.task_number),
          error: result.ok ? undefined : result.error || 'send-failed',
        },
      }).catch(() => null)
    }

    return NextResponse.json({ ok: true, tasks: rows.length, recipients: recipients.size, sent, failed })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/task-reminders',
      message: error?.message || 'task reminders cron error',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 })
  }
}
