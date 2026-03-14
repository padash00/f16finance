import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
type TaskResponse = 'accept' | 'need_info' | 'blocked' | 'already_done' | 'complete'

type TelegramUpdate = {
  callback_query?: {
    id: string
    data?: string
    from?: { id?: number; first_name?: string; username?: string }
    message?: { message_id?: number; chat?: { id?: number | string } }
  }
  message?: {
    text?: string
    message_id?: number
    chat?: { id?: number | string }
    from?: { id?: number; first_name?: string; username?: string }
  }
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  archived: 'Архив',
}

const RESPONSE_CONFIG: Record<
  TaskResponse,
  { label: string; status: TaskStatus; emoji: string; comment: string }
> = {
  accept: {
    label: 'Принял в работу',
    status: 'in_progress',
    emoji: '✅',
    comment: 'Оператор подтвердил, что взял задачу в работу.',
  },
  need_info: {
    label: 'Нужны уточнения',
    status: 'backlog',
    emoji: '❓',
    comment: 'Оператор запросил уточнения по задаче.',
  },
  blocked: {
    label: 'Не могу выполнить',
    status: 'backlog',
    emoji: '⛔',
    comment: 'Оператор сообщил, что не может выполнить задачу.',
  },
  already_done: {
    label: 'Уже сделано',
    status: 'review',
    emoji: '📨',
    comment: 'Оператор сообщил, что задача уже выполнена и передана на проверку.',
  },
  complete: {
    label: 'Завершил задачу',
    status: 'done',
    emoji: '🏁',
    comment: 'Оператор завершил задачу через Telegram.',
  },
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function callTelegram(method: string, payload: Record<string, unknown>) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram method ${method} failed`)
  }

  return data
}

async function answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false) {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  })
}

async function sendTelegramText(chatId: string | number, text: string) {
  await callTelegram('sendMessage', {
    chat_id: String(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

async function clearCallbackButtons(chatId: string | number, messageId: number) {
  await callTelegram('editMessageReplyMarkup', {
    chat_id: String(chatId),
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  })
}

async function loadTaskById(supabase: ReturnType<typeof createAdminSupabaseClient>, taskId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_number, title, status, operator_id')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function loadTaskByNumberForOperator(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  taskNumber: number,
  telegramUserId: string,
) {
  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id')
    .eq('telegram_chat_id', telegramUserId)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator?.id) return null

  const { data, error } = await supabase
    .from('tasks')
    .select('id, task_number, title, status, operator_id')
    .eq('task_number', taskNumber)
    .eq('operator_id', operator.id)
    .maybeSingle()

  if (error) throw error
  return data
}

async function processTaskResponse(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  taskId: string
  response: TaskResponse
  telegramUserId: string
  note?: string | null
}) {
  const task = await loadTaskById(params.supabase, params.taskId)
  if (!task) {
    throw new Error('Задача не найдена')
  }

  if (!task.operator_id) {
    throw new Error('У задачи не назначен оператор')
  }

  const { data: operator, error: operatorError } = await params.supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', task.operator_id)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator) throw new Error('Оператор не найден')

  if (String(operator.telegram_chat_id || '') !== String(params.telegramUserId)) {
    throw new Error('Эта задача назначена другому сотруднику')
  }

  const config = RESPONSE_CONFIG[params.response]
  const payload = {
    status: config.status,
    completed_at: config.status === 'done' ? new Date().toISOString() : null,
  }

  const { error: updateError } = await params.supabase.from('tasks').update(payload).eq('id', task.id)
  if (updateError) throw updateError

  const commentText = [config.emoji, config.comment, params.note?.trim() ? `Комментарий: ${params.note.trim()}` : '']
    .filter(Boolean)
    .join(' ')

  let comment: { id: string } | null = null

  const primaryInsert = await params.supabase
    .from('task_comments')
    .insert([
      {
        task_id: task.id,
        operator_id: operator.id,
        content: commentText,
      },
    ])
    .select('id')
    .single()

  if (!primaryInsert.error) {
    comment = primaryInsert.data
  } else if (
    String(primaryInsert.error?.message || '').includes("Could not find the 'operator_id' column") ||
    String(primaryInsert.error?.message || '').includes('schema cache')
  ) {
    const fallbackInsert = await params.supabase
      .from('task_comments')
      .insert([
        {
          task_id: task.id,
          content: `${getOperatorDisplayName(operator, 'Оператор')}: ${commentText}`,
        },
      ])
      .select('id')
      .single()

    if (fallbackInsert.error) throw fallbackInsert.error
    comment = fallbackInsert.data
  } else {
    throw primaryInsert.error
  }

  await writeAuditLog(params.supabase, {
    entityType: 'task',
    entityId: String(task.id),
    action: `telegram-response-${params.response}`,
    payload: {
      task_number: task.task_number,
      operator_id: operator.id,
      operator_name: getOperatorDisplayName(operator, 'Оператор'),
      response: params.response,
      status: config.status,
      note: params.note?.trim() || null,
      comment_id: comment?.id || null,
    },
  })

  await writeNotificationLog(params.supabase, {
    channel: 'telegram',
    recipient: String(params.telegramUserId),
    status: 'received',
    payload: {
      kind: 'task-response',
      task_id: task.id,
      task_number: task.task_number,
      operator_id: operator.id,
      operator_name: getOperatorDisplayName(operator, 'Оператор'),
      response: params.response,
      status: config.status,
    },
  })

  return {
    taskNumber: task.task_number,
    title: task.title,
    responseLabel: config.label,
    statusLabel: STATUS_LABELS[config.status],
  }
}

function parseTextResponse(text: string): { taskNumber: number; response: TaskResponse } | null {
  const trimmed = text.trim().toLowerCase()
  const match = trimmed.match(/^#?(\d+)\s+(.+)$/)
  if (!match) return null

  const taskNumber = Number(match[1])
  const phrase = match[2]

  if (Number.isNaN(taskNumber)) return null

  if (phrase.includes('принял')) return { taskNumber, response: 'accept' }
  if (phrase.includes('уточ')) return { taskNumber, response: 'need_info' }
  if (phrase.includes('не могу')) return { taskNumber, response: 'blocked' }
  if (phrase.includes('сделано')) return { taskNumber, response: 'already_done' }
  if (phrase.includes('готов') || phrase.includes('заверш')) return { taskNumber, response: 'complete' }

  return null
}

function getHelpText() {
  return [
    '<b>Как отвечать по задачам</b>',
    '',
    'Нажимайте кнопки под задачей прямо в Telegram.',
    'Если кнопок нет, можно ответить текстом в формате:',
    '<code>#123 принял</code>',
    '<code>#123 нужны уточнения</code>',
    '<code>#123 не могу</code>',
    '<code>#123 уже сделано</code>',
    '<code>#123 готово</code>',
    '',
    'Также ответы по задачам доступны в личном кабинете.',
  ].join('\n')
}

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (secret && secretHeader !== secret) {
      return json({ error: 'Forbidden' }, 403)
    }

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required' }, 500)
    }

    const supabase = createAdminSupabaseClient()
    const update = (await req.json().catch(() => null)) as TelegramUpdate | null
    if (!update) return json({ ok: true })

    if (update.callback_query?.data) {
      const callbackData = update.callback_query.data.trim()
      const callbackQueryId = update.callback_query.id
      const telegramUserId = String(update.callback_query.from?.id || '')
      const chatId = update.callback_query.message?.chat?.id
      const messageId = update.callback_query.message?.message_id

      const match = callbackData.match(/^task:([0-9a-f-]+):(accept|need_info|blocked|already_done|complete)$/i)
      if (!match) {
        await answerCallbackQuery(callbackQueryId, 'Неизвестное действие', true)
        return json({ ok: true })
      }

      await answerCallbackQuery(callbackQueryId, 'Обрабатываю ответ...').catch(() => null)

      try {
        const result = await processTaskResponse({
          supabase,
          taskId: match[1],
          response: match[2] as TaskResponse,
          telegramUserId,
        })

        if (chatId && messageId) {
          await clearCallbackButtons(chatId, messageId).catch(() => null)
        }

        if (chatId) {
          await sendTelegramText(
            chatId,
            `<b>Ответ по задаче #${result.taskNumber} принят</b>\n\n<b>${result.responseLabel}</b>\nНовый статус: <b>${result.statusLabel}</b>`,
          )
        }
      } catch (error: any) {
        if (chatId) {
          await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по задаче.').catch(() => null)
        }
      }

      return json({ ok: true })
    }

    if (update.message?.text && update.message.chat?.id) {
      const chatId = update.message.chat.id
      const telegramUserId = String(update.message.from?.id || chatId)
      const text = update.message.text.trim()

      if (text === '/start' || text === '/help') {
        await sendTelegramText(chatId, getHelpText())
        return json({ ok: true })
      }

      const parsed = parseTextResponse(text)
      if (!parsed) {
        await sendTelegramText(chatId, getHelpText())
        return json({ ok: true })
      }

      const task = await loadTaskByNumberForOperator(supabase, parsed.taskNumber, telegramUserId)
      if (!task?.id) {
        await sendTelegramText(chatId, `Не нашел вашу задачу #${parsed.taskNumber}. Проверь номер задачи или откройте личный кабинет.`)
        return json({ ok: true })
      }

      try {
        const result = await processTaskResponse({
          supabase,
          taskId: String(task.id),
          response: parsed.response,
          telegramUserId,
        })

        await sendTelegramText(
          chatId,
          `<b>Ответ по задаче #${result.taskNumber} принят</b>\n\n<b>${result.responseLabel}</b>\nНовый статус: <b>${result.statusLabel}</b>`,
        )
      } catch (error: any) {
        await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по задаче.')
      }

      return json({ ok: true })
    }

    return json({ ok: true })
  } catch (error: any) {
    console.error('Telegram webhook error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/telegram/webhook',
      message: error?.message || 'Telegram webhook error',
    })
    return json({ error: error?.message || 'Webhook error' }, 500)
  }
}
