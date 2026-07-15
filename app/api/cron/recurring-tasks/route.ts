import { NextResponse } from 'next/server'

import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { kzTodayISO, kzWeekday, spawnTaskFromTemplate, type TaskTemplateRow } from '@/lib/server/task-templates'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

// Повторяющиеся задачи: каждое утро создаём задачи из активных шаблонов,
// у которых сегодняшний день недели входит в recurrence_days.
// Дедуп — last_spawned_on: один шаблон порождает максимум одну задачу в день.

const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔥',
  high: '⚡',
  medium: '📌',
  low: '💧',
}

function taskKeyboard(taskId: string) {
  return {
    inline_keyboard: [
      [
        { text: 'Принял', callback_data: `task:${taskId}:accept` },
        { text: 'Нужны уточнения', callback_data: `task:${taskId}:need_info` },
      ],
      [
        { text: 'Не могу', callback_data: `task:${taskId}:blocked` },
        { text: 'Уже сделано', callback_data: `task:${taskId}:already_done` },
      ],
      [{ text: 'Завершил', callback_data: `task:${taskId}:complete` }],
    ],
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const cronSecret = requiredEnv('CRON_SECRET')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const today = kzTodayISO()
  const weekday = kzWeekday()

  try {
    const { data: templates, error } = await supabase
      .from('task_templates')
      .select('*')
      .eq('is_active', true)
      .not('recurrence_days', 'is', null)
    if (error) {
      if (String(error.message || '').includes('task_templates')) {
        return NextResponse.json({ ok: true, skipped: 'migration-missing' })
      }
      throw error
    }

    const dueTemplates = ((templates || []) as TaskTemplateRow[]).filter(
      (t) => Array.isArray(t.recurrence_days) && t.recurrence_days.includes(weekday) && t.last_spawned_on !== today,
    )

    let created = 0
    let notified = 0
    let failed = 0

    for (const template of dueTemplates) {
      try {
        const task = await spawnTaskFromTemplate(supabase, template, template.created_by || null)
        created += 1

        await supabase.from('task_templates').update({ last_spawned_on: today }).eq('id', template.id)

        await writeAuditLog(supabase, {
          entityType: 'task',
          entityId: String(task.id),
          action: 'create-recurring',
          payload: { template_id: template.id, task_number: task.task_number, title: task.title },
        }).catch(() => null)

        // Уведомление исполнителю (оператор или сотрудник)
        let chatId: string | null = null
        let companyName: string | null = null
        if (template.company_id) {
          const { data: company } = await supabase.from('companies').select('name').eq('id', template.company_id).maybeSingle()
          companyName = company?.name || null
        }
        if (task.operator_id) {
          const { data: operator } = await supabase
            .from('operators')
            .select('id, name, short_name, telegram_chat_id, operator_profiles(full_name)')
            .eq('id', task.operator_id)
            .maybeSingle()
          chatId = operator?.telegram_chat_id ? String(operator.telegram_chat_id) : null
        } else if (task.staff_id) {
          const { data: member } = await supabase
            .from('staff')
            .select('id, full_name, telegram_chat_id')
            .eq('id', task.staff_id)
            .maybeSingle()
          chatId = member?.telegram_chat_id ? String(member.telegram_chat_id) : null
        }

        if (chatId) {
          const lines = [
            `📋 <b>Новая задача #${task.task_number}</b>`,
            `<b>${escapeTelegramHtml(task.title)}</b>`,
          ]
          if (task.description) lines.push('', escapeTelegramHtml(String(task.description)))
          const meta: string[] = []
          if (companyName) meta.push(`🏢 ${escapeTelegramHtml(companyName)}`)
          meta.push(`${PRIORITY_EMOJI[String(task.priority)] || '📌'} ${escapeTelegramHtml(String(task.priority))}`)
          lines.push('', meta.join(' · '))
          if (task.due_date) lines.push(`⏰ Срок: ${escapeTelegramHtml(String(task.due_date))}`)
          const checklistCount = Array.isArray(task.checklist) ? task.checklist.length : 0
          if (checklistCount > 0) lines.push(`☑️ Чек-лист: ${checklistCount} пункт(ов)`)
          lines.push('', `<i>Ответьте кнопками ниже или текстом:</i> <code>#${task.task_number} принял</code>`)

          const result = await sendTelegramMessage(chatId, lines.join('\n'), {
            skipFrame: true,
            replyMarkup: taskKeyboard(String(task.id)),
          })
          if (result.ok) notified += 1

          await writeNotificationLog(supabase, {
            channel: 'telegram',
            recipient: chatId,
            status: result.ok ? 'sent' : 'failed',
            payload: {
              kind: 'task-recurring-assigned',
              task_id: task.id,
              task_number: task.task_number,
              template_id: template.id,
              error: result.ok ? undefined : result.error || 'send-failed',
            },
          }).catch(() => null)
        }
      } catch (spawnError: any) {
        failed += 1
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'api/cron/recurring-tasks',
          message: `template ${template.id}: ${spawnError?.message || 'spawn failed'}`,
        })
      }
    }

    return NextResponse.json({ ok: true, weekday, due: dueTemplates.length, created, notified, failed })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/recurring-tasks',
      message: error?.message || 'recurring tasks cron error',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 })
  }
}
