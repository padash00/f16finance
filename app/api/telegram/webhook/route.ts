import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import {
  confirmShiftPublicationWeekByResponse,
  createShiftIssueDraft,
  parseShiftIssuePayload,
  startShiftIssueSelection,
  submitPendingShiftIssueReason,
} from '@/lib/server/shift-workflow'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

// ─── Finance command helpers ────────────────────────────────────────────────

function todayISO() {
  const now = new Date()
  const t = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  const t = dt.getTime() - dt.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

function safeNum(v: number | null | undefined) {
  return Number(v || 0)
}

function fmtMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return sign + Math.round(abs / 1_000) + ' тыс ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

async function getFinanceSummary(dateFrom: string, dateTo: string) {
  const supabase = createAdminSupabaseClient()

  const [incomesRes, expensesRes] = await Promise.all([
    supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, online_amount, card_amount, date')
      .gte('date', dateFrom)
      .lte('date', dateTo),
    supabase
      .from('expenses')
      .select('cash_amount, kaspi_amount, category, date')
      .gte('date', dateFrom)
      .lte('date', dateTo),
  ])

  let totalIncome = 0
  let totalExpense = 0
  const categoryMap = new Map<string, number>()

  for (const row of incomesRes.data ?? []) {
    totalIncome +=
      safeNum(row.cash_amount) +
      safeNum(row.kaspi_amount) +
      safeNum(row.online_amount) +
      safeNum(row.card_amount)
  }
  for (const row of expensesRes.data ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount)
    totalExpense += total
    const cat = row.category || 'Прочее'
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + total)
  }

  const profit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
  const topCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  return { totalIncome, totalExpense, profit, margin, topCategories, dateFrom, dateTo }
}

function formatSummary(
  data: Awaited<ReturnType<typeof getFinanceSummary>>,
  title: string,
): string {
  const sign = data.profit >= 0 ? '+' : ''
  const marginEmoji = data.margin >= 20 ? '🟢' : data.margin >= 10 ? '🟡' : '🔴'

  const lines = [
    `<b>📊 ${title}</b>`,
    `<i>${data.dateFrom} — ${data.dateTo}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(data.totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(data.totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(data.profit)}</b>`,
    `${marginEmoji} Маржа: <b>${data.margin.toFixed(1)}%</b>`,
  ]

  if (data.topCategories.length > 0) {
    lines.push('')
    lines.push('<b>Топ расходов:</b>')
    for (const [cat, val] of data.topCategories) {
      lines.push(`  • ${cat}: ${fmtMoney(val)}`)
    }
  }

  return lines.join('\n')
}

const FINANCE_HELP_TEXT = `<b>📊 Финансовые команды Orda Control</b>

/today — Сводка за сегодня
/yesterday — Сводка за вчера
/week — Сводка за 7 дней
/month — Сводка за 30 дней
/cashflow — Баланс и движение денег`

async function isAuthorizedForFinance(telegramUserId: string): Promise<boolean> {
  // Check DB table first
  try {
    const supabase = createAdminSupabaseClient()
    const { data } = await supabase
      .from('telegram_allowed_users')
      .select('can_finance')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle()
    if (data) return data.can_finance === true
  } catch {}

  // Fallback: TELEGRAM_ADMIN_IDS env var
  const adminIds = process.env.TELEGRAM_ADMIN_IDS
  if (!adminIds) return false
  return adminIds
    .split(',')
    .map((id) => id.trim())
    .includes(telegramUserId)
}

async function handleFinanceCommand(text: string, chatId: number, telegramUserId: string): Promise<boolean> {
  const cmd = text.split(' ')[0]?.toLowerCase()

  // Only handle finance commands — ignore everything else
  const financeCommands = ['/finance', '/stats', '/today', '/yesterday', '/week', '/month', '/cashflow']
  if (!financeCommands.includes(cmd ?? '')) return false

  // Authorization check
  const authorized = await isAuthorizedForFinance(telegramUserId)
  if (!authorized) {
    await sendTelegramMessage(chatId, '⛔ У вас нет доступа к финансовым командам.\n\nЕсли считаете, что это ошибка — обратитесь к администратору системы.')
    return true
  }

  const today = todayISO()

  if (cmd === '/finance' || cmd === '/stats') {
    await sendTelegramMessage(chatId, FINANCE_HELP_TEXT)
    return true
  }

  if (cmd === '/today') {
    const data = await getFinanceSummary(today, today)
    await sendTelegramMessage(chatId, formatSummary(data, 'Сегодня'))
    return true
  }

  if (cmd === '/yesterday') {
    const yesterday = addDaysISO(today, -1)
    const data = await getFinanceSummary(yesterday, yesterday)
    await sendTelegramMessage(chatId, formatSummary(data, 'Вчера'))
    return true
  }

  if (cmd === '/week') {
    const data = await getFinanceSummary(addDaysISO(today, -6), today)
    await sendTelegramMessage(chatId, formatSummary(data, 'Последние 7 дней'))
    return true
  }

  if (cmd === '/month') {
    const data = await getFinanceSummary(addDaysISO(today, -29), today)
    await sendTelegramMessage(chatId, formatSummary(data, 'Последние 30 дней'))
    return true
  }

  if (cmd === '/cashflow') {
    const supabase = createAdminSupabaseClient()
    const dateFrom = addDaysISO(today, -29)
    const [incomesRes, expensesRes] = await Promise.all([
      supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', dateFrom)
        .lte('date', today),
      supabase
        .from('expenses')
        .select('date, cash_amount, kaspi_amount')
        .gte('date', dateFrom)
        .lte('date', today),
    ])

    const dailyIncome = new Map<string, number>()
    const dailyExpense = new Map<string, number>()
    for (const row of incomesRes.data ?? []) {
      dailyIncome.set(
        row.date,
        (dailyIncome.get(row.date) || 0) +
          safeNum(row.cash_amount) +
          safeNum(row.kaspi_amount) +
          safeNum(row.online_amount) +
          safeNum(row.card_amount),
      )
    }
    for (const row of expensesRes.data ?? []) {
      dailyExpense.set(
        row.date,
        (dailyExpense.get(row.date) || 0) + safeNum(row.cash_amount) + safeNum(row.kaspi_amount),
      )
    }

    const allDates = Array.from(
      new Set([...dailyIncome.keys(), ...dailyExpense.keys()]),
    ).sort()
    let cumBalance = 0
    const negativeDays: string[] = []
    for (const date of allDates) {
      const inc = dailyIncome.get(date) || 0
      const exp = dailyExpense.get(date) || 0
      const profit = inc - exp
      cumBalance += profit
      if (profit < 0) negativeDays.push(date)
    }

    const totalIncome = Array.from(dailyIncome.values()).reduce((a, b) => a + b, 0)
    const totalExpense = Array.from(dailyExpense.values()).reduce((a, b) => a + b, 0)

    const lines = [
      '<b>💹 Cash Flow — 30 дней</b>',
      '',
      `💰 Суммарные доходы: <b>${fmtMoney(totalIncome)}</b>`,
      `📉 Суммарные расходы: <b>${fmtMoney(totalExpense)}</b>`,
      `📊 Итоговый баланс: <b>${fmtMoney(cumBalance)}</b>`,
      `🔴 Убыточных дней: <b>${negativeDays.length}</b> из ${allDates.length}`,
    ]

    if (negativeDays.length > 0) {
      lines.push('')
      lines.push('<b>Убыточные дни:</b>')
      for (const date of negativeDays.slice(0, 5)) {
        const inc = dailyIncome.get(date) || 0
        const exp = dailyExpense.get(date) || 0
        lines.push(`  • ${date}: ${fmtMoney(inc - exp)}`)
      }
    }

    await sendTelegramMessage(chatId, lines.join('\n'))
    return true
  }

  return false
}

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

      const shiftWeekMatch = callbackData.match(/^sw:([0-9a-f-]+):(c|i)$/i)
      if (shiftWeekMatch) {
        await answerCallbackQuery(callbackQueryId, 'Обрабатываю ответ...').catch(() => null)

        try {
          if (shiftWeekMatch[2] === 'c') {
            const result = await confirmShiftPublicationWeekByResponse({
              supabase,
              responseId: shiftWeekMatch[1],
              telegramUserId,
              source: 'telegram',
            })

            if (chatId && messageId) {
              await clearCallbackButtons(chatId, messageId).catch(() => null)
            }

            if (chatId) {
              await sendTelegramText(
                chatId,
                `<b>Неделя подтверждена</b>\n\nСпасибо. Руководитель увидит, что вы согласны с графиком.`,
              )
            }

            await writeAuditLog(supabase, {
              entityType: 'shift-week-response',
              entityId: `${result.publicationId}:${result.operatorId}`,
              action: 'telegram-confirm-week',
              payload: {
                company_id: result.companyId,
                operator_id: result.operatorId,
              },
            })
          } else {
            const result = await startShiftIssueSelection({
              supabase,
              responseId: shiftWeekMatch[1],
              telegramUserId,
            })

            if (chatId) {
              await sendTelegramText(
                chatId,
                `<b>Выберите проблемную смену</b>\n\nНажмите на дату, по которой есть проблема. После этого бот попросит написать причину одним сообщением.`,
              )
              await callTelegram('sendMessage', {
                chat_id: String(chatId),
                text: 'Даты ваших смен на эту неделю:',
                reply_markup: result.keyboard,
              })
            }
          }
        } catch (error: any) {
          if (chatId) {
            await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по неделе.').catch(() => null)
          }
        }

        return json({ ok: true })
      }

      const shiftIssueMatch = callbackData.match(/^si:([0-9a-f-]+):(\d{6}):(d|n)$/i)
      if (shiftIssueMatch) {
        await answerCallbackQuery(callbackQueryId, 'Записываю смену...').catch(() => null)

        try {
          const issuePayload = parseShiftIssuePayload(shiftIssueMatch[2], shiftIssueMatch[3])
          const result = await createShiftIssueDraft({
            supabase,
            responseId: shiftIssueMatch[1],
            telegramUserId,
            shiftDate: issuePayload.shiftDate,
            shiftType: issuePayload.shiftType,
            source: 'telegram',
          })

          if (chatId) {
            await sendTelegramText(
              chatId,
              `<b>Смена отмечена как проблемная</b>\n\n${result.operatorName}, теперь одним сообщением напишите, почему вы не можете выйти на <b>${result.shiftDate}</b> (${result.shiftType === 'day' ? 'день' : 'ночь'}).`,
            )
          }
        } catch (error: any) {
          if (chatId) {
            await sendTelegramText(chatId, error?.message || 'Не удалось записать проблемную смену.').catch(() => null)
          }
        }

        return json({ ok: true })
      }

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

      // Finance commands — handle if matched, then return early
      const isFinanceCmd = await handleFinanceCommand(text, Number(chatId), telegramUserId).catch(() => false)
      if (isFinanceCmd) {
        return json({ ok: true })
      }

      const parsed = parseTextResponse(text)
      const pendingShiftIssue = await submitPendingShiftIssueReason({
        supabase,
        telegramUserId,
        reason: text,
        source: 'telegram',
      })

      if (pendingShiftIssue) {
        await writeAuditLog(supabase, {
          entityType: 'shift-change-request',
          entityId: pendingShiftIssue.requestId,
          action: 'telegram-submit-reason',
          payload: {
            operator_name: pendingShiftIssue.operatorName,
            shift_date: pendingShiftIssue.shiftDate,
            shift_type: pendingShiftIssue.shiftType,
          },
        })

        await sendTelegramText(
          chatId,
          `<b>Запрос на изменение смены отправлен</b>\n\n${pendingShiftIssue.operatorName}, руководитель увидит, что вы не согласны с <b>${pendingShiftIssue.shiftDate}</b> (${pendingShiftIssue.shiftType === 'day' ? 'день' : 'ночь'}), и свяжется с вами после пересмотра графика.`,
        )
        return json({ ok: true })
      }

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
