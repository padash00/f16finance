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

// ─── Date helpers ─────────────────────────────────────────────────────────────

const KZ_OFFSET = 5 * 3600_000

function nowKZ() {
  return new Date(Date.now() + KZ_OFFSET)
}

function todayISO() {
  const d = nowKZ()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + diff)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
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

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    timeZone: 'UTC',
  })
}

// ─── Role system ──────────────────────────────────────────────────────────────

type BotUserRole = 'super_admin' | 'owner' | 'manager' | 'marketer' | 'operator' | 'unknown'

type BotUser = {
  role: BotUserRole
  name: string
  entityId: string
  operatorId?: string
}

async function identifyBotUser(telegramUserId: string): Promise<BotUser> {
  const supabase = createAdminSupabaseClient()

  // 1. Check telegram_allowed_users (super_admin)
  try {
    const { data } = await supabase
      .from('telegram_allowed_users')
      .select('id, label, can_finance')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle()
    if (data?.can_finance) {
      return { role: 'super_admin', name: data.label || 'Администратор', entityId: data.id }
    }
  } catch {}

  // 2. Check staff table (owner / manager / marketer)
  try {
    const { data } = await supabase
      .from('staff')
      .select('id, full_name, role')
      .eq('telegram_chat_id', telegramUserId)
      .eq('is_active', true)
      .maybeSingle()
    if (data) {
      const role = (data.role as BotUserRole) || 'unknown'
      return { role, name: data.full_name, entityId: data.id }
    }
  } catch {}

  // 3. Check operators table
  try {
    const { data } = await supabase
      .from('operators')
      .select('id, name, short_name, operator_profiles(full_name)')
      .eq('telegram_chat_id', telegramUserId)
      .eq('is_active', true)
      .maybeSingle()
    if (data) {
      const profiles = data.operator_profiles as Array<{ full_name: string | null }> | null
      const displayName = profiles?.[0]?.full_name || data.name || 'Оператор'
      return { role: 'operator', name: displayName, entityId: data.id, operatorId: data.id }
    }
  } catch {}

  return { role: 'unknown', name: 'Неизвестный', entityId: telegramUserId }
}

function canUseFinance(role: BotUserRole) {
  return ['super_admin', 'owner', 'manager'].includes(role)
}

function canUseForecast(role: BotUserRole) {
  return ['super_admin', 'owner'].includes(role)
}

function canUseTop(role: BotUserRole) {
  return ['super_admin', 'owner', 'manager'].includes(role)
}

// ─── Finance data helpers ─────────────────────────────────────────────────────

async function getFinanceSummary(dateFrom: string, dateTo: string) {
  const supabase = createAdminSupabaseClient()
  const [incomesRes, expensesRes] = await Promise.all([
    supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount').gte('date', dateFrom).lte('date', dateTo),
    supabase.from('expenses').select('cash_amount, kaspi_amount, category').gte('date', dateFrom).lte('date', dateTo),
  ])

  let totalIncome = 0
  let totalExpense = 0
  const categoryMap = new Map<string, number>()

  for (const row of incomesRes.data ?? []) {
    totalIncome += safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
  }
  for (const row of expensesRes.data ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount)
    totalExpense += total
    const cat = row.category || 'Прочее'
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + total)
  }

  const profit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
  const topCategories = Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return { totalIncome, totalExpense, profit, margin, topCategories, dateFrom, dateTo }
}

function formatSummary(data: Awaited<ReturnType<typeof getFinanceSummary>>, title: string) {
  const sign = data.profit >= 0 ? '+' : ''
  const emoji = data.margin >= 20 ? '🟢' : data.margin >= 10 ? '🟡' : '🔴'
  const lines = [
    `<b>📊 ${title}</b>`,
    `<i>${data.dateFrom} — ${data.dateTo}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(data.totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(data.totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(data.profit)}</b>`,
    `${emoji} Маржа: <b>${data.margin.toFixed(1)}%</b>`,
  ]
  if (data.topCategories.length > 0) {
    lines.push('', '<b>Топ расходов:</b>')
    for (const [cat, val] of data.topCategories) lines.push(`  • ${cat}: ${fmtMoney(val)}`)
  }
  return lines.join('\n')
}

// ─── Command handlers ─────────────────────────────────────────────────────────

function buildHelpText(user: BotUser): string {
  const roleLabel: Record<BotUserRole, string> = {
    super_admin: 'Супер-администратор',
    owner: 'Владелец',
    manager: 'Руководитель',
    marketer: 'Маркетолог',
    operator: 'Оператор',
    unknown: 'Гость',
  }

  const lines = [
    `<b>👋 ${user.name}</b>`,
    `<i>Роль: ${roleLabel[user.role]}</i>`,
    '',
    '<b>Доступные команды:</b>',
  ]

  if (canUseFinance(user.role)) {
    lines.push(
      '',
      '<b>📊 Финансы:</b>',
      '/today — сводка за сегодня',
      '/yesterday — вчера',
      '/week — последние 7 дней',
      '/month — последние 30 дней',
      '/cashflow — баланс и движение денег',
    )
  }

  if (canUseTop(user.role)) {
    lines.push('/top — рейтинг операторов')
  }

  if (canUseForecast(user.role)) {
    lines.push('/forecast — прогноз на 30 дней')
  }

  if (user.role === 'operator') {
    lines.push(
      '',
      '<b>👤 Личный кабинет:</b>',
      '/mystats — моя статистика за 30 дней',
      '/myshifts — мои ближайшие смены',
    )
  }

  lines.push('', '<b>📋 Задачи:</b>', '#123 принял / готово / не могу — ответ по задаче')

  if (user.role === 'unknown') {
    lines.push('', '<i>⛔ Финансовые команды недоступны. Обратитесь к администратору.</i>')
  }

  return lines.join('\n')
}

async function handleTopOperators(chatId: number) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const dateFrom = addDaysISO(today, -6)

  const [incomesRes, operatorsRes] = await Promise.all([
    supabase
      .from('incomes')
      .select('operator_id, cash_amount, kaspi_amount, online_amount, card_amount')
      .gte('date', dateFrom)
      .lte('date', today)
      .not('operator_id', 'is', null),
    supabase
      .from('operators')
      .select('id, name, short_name, operator_profiles(full_name)')
      .eq('is_active', true),
  ])

  const operatorMap = new Map<string, string>()
  for (const op of operatorsRes.data ?? []) {
    const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
    const name = profiles?.[0]?.full_name || op.name || op.short_name || op.id
    operatorMap.set(op.id, name)
  }

  const stats = new Map<string, { revenue: number; shifts: number }>()
  for (const row of incomesRes.data ?? []) {
    if (!row.operator_id) continue
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    if (!total) continue
    const s = stats.get(row.operator_id) ?? { revenue: 0, shifts: 0 }
    s.revenue += total
    s.shifts += 1
    stats.set(row.operator_id, s)
  }

  const leaderboard = Array.from(stats.entries())
    .map(([id, s]) => ({ name: operatorMap.get(id) || id, ...s }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
  const lines = [`<b>🏆 Рейтинг операторов</b>`, `<i>${dateFrom} — ${today}</i>`, '']

  if (leaderboard.length === 0) {
    lines.push('Данных за период нет')
  } else {
    for (let i = 0; i < leaderboard.length; i++) {
      const op = leaderboard[i]
      lines.push(`${medals[i]} <b>${op.name}</b>`)
      lines.push(`   ${fmtMoney(op.revenue)} · ${op.shifts} смен`)
    }
  }

  await sendTelegramMessage(chatId, lines.join('\n'))
}

async function handleForecast(chatId: number) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const dateFrom = addDaysISO(today, -89)

  const [incomesRes, expensesRes] = await Promise.all([
    supabase.from('incomes').select('date, cash_amount, kaspi_amount, online_amount, card_amount').gte('date', dateFrom).lte('date', today),
    supabase.from('expenses').select('date, cash_amount, kaspi_amount').gte('date', dateFrom).lte('date', today),
  ])

  const weeklyIncome: number[] = Array(13).fill(0)
  const weeklyExpense: number[] = Array(13).fill(0)

  const [fy, fm, fd] = dateFrom.split('-').map(Number)
  const fromMs = Date.UTC(fy, (fm || 1) - 1, fd || 1)

  const getWeek = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const ms = Date.UTC(y, (m || 1) - 1, d || 1)
    return Math.min(12, Math.max(0, Math.floor((ms - fromMs) / (7 * 86400_000))))
  }

  for (const row of incomesRes.data ?? []) {
    weeklyIncome[getWeek(row.date)] += safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
  }
  for (const row of expensesRes.data ?? []) {
    weeklyExpense[getWeek(row.date)] += safeNum(row.cash_amount) + safeNum(row.kaspi_amount)
  }

  const nonZeroInc = weeklyIncome.filter((v) => v > 0)
  const nonZeroExp = weeklyExpense.filter((v) => v > 0)
  const avgInc = nonZeroInc.length ? nonZeroInc.reduce((a, b) => a + b, 0) / nonZeroInc.length : 0
  const avgExp = nonZeroExp.length ? nonZeroExp.reduce((a, b) => a + b, 0) / nonZeroExp.length : 0

  // Simple trend: last 4 weeks vs first 4 weeks
  const firstHalfInc = weeklyIncome.slice(0, 4).reduce((a, b) => a + b, 0) / 4
  const lastHalfInc = weeklyIncome.slice(-4).reduce((a, b) => a + b, 0) / 4
  const weeklyGrowth = firstHalfInc > 0 ? (lastHalfInc - firstHalfInc) / firstHalfInc : 0

  const proj30Inc = avgInc * 4 * (1 + weeklyGrowth * 0.5)
  const proj30Exp = avgExp * 4
  const proj30Profit = proj30Inc - proj30Exp

  const trendEmoji = weeklyGrowth > 0.05 ? '📈' : weeklyGrowth < -0.05 ? '📉' : '➡️'
  const sign = proj30Profit >= 0 ? '+' : ''

  const lines = [
    '<b>🔮 Прогноз на 30 дней</b>',
    `<i>На основе данных за 90 дней</i>`,
    '',
    `${trendEmoji} Тренд выручки: <b>${weeklyGrowth >= 0 ? '+' : ''}${(weeklyGrowth * 100).toFixed(1)}%</b> к периоду`,
    '',
    `💰 Прогноз выручки: <b>${fmtMoney(proj30Inc)}</b>`,
    `📉 Прогноз расходов: <b>${fmtMoney(proj30Exp)}</b>`,
    `💼 Прогноз прибыли: <b>${sign}${fmtMoney(proj30Profit)}</b>`,
    '',
    `<i>Подробный AI-анализ доступен на странице /forecast в системе</i>`,
  ]

  await sendTelegramMessage(chatId, lines.join('\n'))
}

async function handleMyStats(chatId: number, operatorId: string, operatorName: string) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const dateFrom = addDaysISO(today, -29)

  // Get operator's income
  const { data: incomes } = await supabase
    .from('incomes')
    .select('cash_amount, kaspi_amount, online_amount, card_amount, date')
    .eq('operator_id', operatorId)
    .gte('date', dateFrom)
    .lte('date', today)

  let totalRevenue = 0
  let shifts = 0
  const days = new Set<string>()

  for (const row of incomes ?? []) {
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    if (total > 0) {
      totalRevenue += total
      shifts++
      days.add(row.date)
    }
  }

  const avgCheck = shifts > 0 ? totalRevenue / shifts : 0

  // Get rank
  const { data: allIncomes } = await supabase
    .from('incomes')
    .select('operator_id, cash_amount, kaspi_amount, online_amount, card_amount')
    .gte('date', dateFrom)
    .lte('date', today)
    .not('operator_id', 'is', null)

  const revenueMap = new Map<string, number>()
  for (const row of allIncomes ?? []) {
    if (!row.operator_id) continue
    const total = safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount)
    revenueMap.set(row.operator_id, (revenueMap.get(row.operator_id) || 0) + total)
  }

  const sorted = Array.from(revenueMap.entries()).sort((a, b) => b[1] - a[1])
  const rank = sorted.findIndex(([id]) => id === operatorId) + 1
  const total = sorted.length

  const lines = [
    `<b>📊 Ваша статистика</b>`,
    `<i>${operatorName} · ${dateFrom} — ${today}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(totalRevenue)}</b>`,
    `🔢 Смен: <b>${shifts}</b>`,
    `📅 Рабочих дней: <b>${days.size}</b>`,
    `💵 Средний чек: <b>${fmtMoney(avgCheck)}</b>`,
    rank > 0 ? `🏆 Место в рейтинге: <b>${rank} из ${total}</b>` : '',
  ].filter(Boolean)

  await sendTelegramMessage(chatId, lines.join('\n'))
}

async function handleMyShifts(chatId: number, operatorId: string, operatorName: string) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const dateTo = addDaysISO(today, 14)

  const { data: shifts } = await supabase
    .from('shifts')
    .select('shift_date, shift_type, company:company_id(name)')
    .eq('operator_id', operatorId)
    .gte('shift_date', today)
    .lte('shift_date', dateTo)
    .order('shift_date', { ascending: true })
    .limit(10)

  const shiftTypeLabel: Record<string, string> = {
    day: '☀️ день',
    night: '🌙 ночь',
  }

  const lines = [
    `<b>📅 Ваши ближайшие смены</b>`,
    `<i>${operatorName}</i>`,
    '',
  ]

  if (!shifts || shifts.length === 0) {
    lines.push('Нет запланированных смен на ближайшие 2 недели')
  } else {
    for (const shift of shifts) {
      const company = (shift.company as any)?.name || ''
      const typeLabel = shiftTypeLabel[shift.shift_type] || shift.shift_type
      lines.push(`• ${fmtDate(shift.shift_date)} — ${typeLabel}${company ? `, ${company}` : ''}`)
    }
  }

  await sendTelegramMessage(chatId, lines.join('\n'))
}

async function handleCashFlow(chatId: number) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const dateFrom = addDaysISO(today, -29)

  const [incomesRes, expensesRes] = await Promise.all([
    supabase.from('incomes').select('date, cash_amount, kaspi_amount, online_amount, card_amount').gte('date', dateFrom).lte('date', today),
    supabase.from('expenses').select('date, cash_amount, kaspi_amount').gte('date', dateFrom).lte('date', today),
  ])

  const dailyIncome = new Map<string, number>()
  const dailyExpense = new Map<string, number>()

  for (const row of incomesRes.data ?? []) {
    dailyIncome.set(row.date, (dailyIncome.get(row.date) || 0) + safeNum(row.cash_amount) + safeNum(row.kaspi_amount) + safeNum(row.online_amount) + safeNum(row.card_amount))
  }
  for (const row of expensesRes.data ?? []) {
    dailyExpense.set(row.date, (dailyExpense.get(row.date) || 0) + safeNum(row.cash_amount) + safeNum(row.kaspi_amount))
  }

  const allDates = Array.from(new Set([...dailyIncome.keys(), ...dailyExpense.keys()])).sort()
  let cumBalance = 0
  const negativeDays: string[] = []

  for (const date of allDates) {
    const profit = (dailyIncome.get(date) || 0) - (dailyExpense.get(date) || 0)
    cumBalance += profit
    if (profit < 0) negativeDays.push(date)
  }

  const totalIncome = Array.from(dailyIncome.values()).reduce((a, b) => a + b, 0)
  const totalExpense = Array.from(dailyExpense.values()).reduce((a, b) => a + b, 0)

  const lines = [
    '<b>💹 Cash Flow — 30 дней</b>',
    '',
    `💰 Доходы: <b>${fmtMoney(totalIncome)}</b>`,
    `📉 Расходы: <b>${fmtMoney(totalExpense)}</b>`,
    `📊 Баланс: <b>${fmtMoney(cumBalance)}</b>`,
    `🔴 Убыточных дней: <b>${negativeDays.length}</b> из ${allDates.length}`,
  ]

  if (negativeDays.length > 0) {
    lines.push('', '<b>Убыточные дни:</b>')
    for (const date of negativeDays.slice(0, 5)) {
      const inc = dailyIncome.get(date) || 0
      const exp = dailyExpense.get(date) || 0
      lines.push(`  • ${date}: ${fmtMoney(inc - exp)}`)
    }
  }

  await sendTelegramMessage(chatId, lines.join('\n'))
}

// ─── Task/shift types (unchanged from original) ───────────────────────────────

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

const RESPONSE_CONFIG: Record<TaskResponse, { label: string; status: TaskStatus; emoji: string; comment: string }> = {
  accept: { label: 'Принял в работу', status: 'in_progress', emoji: '✅', comment: 'Оператор подтвердил, что взял задачу в работу.' },
  need_info: { label: 'Нужны уточнения', status: 'backlog', emoji: '❓', comment: 'Оператор запросил уточнения по задаче.' },
  blocked: { label: 'Не могу выполнить', status: 'backlog', emoji: '⛔', comment: 'Оператор сообщил, что не может выполнить задачу.' },
  already_done: { label: 'Уже сделано', status: 'review', emoji: '📨', comment: 'Оператор сообщил, что задача уже выполнена и передана на проверку.' },
  complete: { label: 'Завершил задачу', status: 'done', emoji: '🏁', comment: 'Оператор завершил задачу через Telegram.' },
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
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram method ${method} failed`)
  return data
}

async function answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false) {
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert })
}

async function sendTelegramText(chatId: string | number, text: string) {
  await callTelegram('sendMessage', { chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true })
}

async function clearCallbackButtons(chatId: string | number, messageId: number) {
  await callTelegram('editMessageReplyMarkup', { chat_id: String(chatId), message_id: messageId, reply_markup: { inline_keyboard: [] } })
}

async function loadTaskById(supabase: ReturnType<typeof createAdminSupabaseClient>, taskId: string) {
  const { data, error } = await supabase.from('tasks').select('id, task_number, title, status, operator_id').eq('id', taskId).maybeSingle()
  if (error) throw error
  return data
}

async function loadTaskByNumberForOperator(supabase: ReturnType<typeof createAdminSupabaseClient>, taskNumber: number, telegramUserId: string) {
  const { data: operator, error: operatorError } = await supabase.from('operators').select('id').eq('telegram_chat_id', telegramUserId).maybeSingle()
  if (operatorError) throw operatorError
  if (!operator?.id) return null
  const { data, error } = await supabase.from('tasks').select('id, task_number, title, status, operator_id').eq('task_number', taskNumber).eq('operator_id', operator.id).maybeSingle()
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
  if (!task) throw new Error('Задача не найдена')
  if (!task.operator_id) throw new Error('У задачи не назначен оператор')

  const { data: operator, error: operatorError } = await params.supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', task.operator_id)
    .maybeSingle()
  if (operatorError) throw operatorError
  if (!operator) throw new Error('Оператор не найден')
  if (String(operator.telegram_chat_id || '') !== String(params.telegramUserId)) throw new Error('Эта задача назначена другому сотруднику')

  const config = RESPONSE_CONFIG[params.response]
  const payload = { status: config.status, completed_at: config.status === 'done' ? new Date().toISOString() : null }
  const { error: updateError } = await params.supabase.from('tasks').update(payload).eq('id', task.id)
  if (updateError) throw updateError

  const commentText = [config.emoji, config.comment, params.note?.trim() ? `Комментарий: ${params.note.trim()}` : ''].filter(Boolean).join(' ')
  let comment: { id: string } | null = null

  const primaryInsert = await params.supabase.from('task_comments').insert([{ task_id: task.id, operator_id: operator.id, content: commentText }]).select('id').single()
  if (!primaryInsert.error) {
    comment = primaryInsert.data
  } else if (String(primaryInsert.error?.message || '').includes("Could not find the 'operator_id' column") || String(primaryInsert.error?.message || '').includes('schema cache')) {
    const fallbackInsert = await params.supabase.from('task_comments').insert([{ task_id: task.id, content: `${getOperatorDisplayName(operator, 'Оператор')}: ${commentText}` }]).select('id').single()
    if (fallbackInsert.error) throw fallbackInsert.error
    comment = fallbackInsert.data
  } else {
    throw primaryInsert.error
  }

  await writeAuditLog(params.supabase, {
    entityType: 'task', entityId: String(task.id), action: `telegram-response-${params.response}`,
    payload: { task_number: task.task_number, operator_id: operator.id, operator_name: getOperatorDisplayName(operator, 'Оператор'), response: params.response, status: config.status, note: params.note?.trim() || null, comment_id: comment?.id || null },
  })
  await writeNotificationLog(params.supabase, {
    channel: 'telegram', recipient: String(params.telegramUserId), status: 'received',
    payload: { kind: 'task-response', task_id: task.id, task_number: task.task_number, operator_id: operator.id, operator_name: getOperatorDisplayName(operator, 'Оператор'), response: params.response, status: config.status },
  })

  return { taskNumber: task.task_number, title: task.title, responseLabel: config.label, statusLabel: STATUS_LABELS[config.status] }
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

// ─── Main handler ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (secret && secretHeader !== secret) return json({ error: 'Forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required' }, 500)

    const supabase = createAdminSupabaseClient()
    const update = (await req.json().catch(() => null)) as TelegramUpdate | null
    if (!update) return json({ ok: true })

    // ── Callback queries (unchanged) ──
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
            const result = await confirmShiftPublicationWeekByResponse({ supabase, responseId: shiftWeekMatch[1], telegramUserId, source: 'telegram' })
            if (chatId && messageId) await clearCallbackButtons(chatId, messageId).catch(() => null)
            if (chatId) await sendTelegramText(chatId, `<b>Неделя подтверждена</b>\n\nСпасибо. Руководитель увидит, что вы согласны с графиком.`)
            await writeAuditLog(supabase, { entityType: 'shift-week-response', entityId: `${result.publicationId}:${result.operatorId}`, action: 'telegram-confirm-week', payload: { company_id: result.companyId, operator_id: result.operatorId } })
          } else {
            const result = await startShiftIssueSelection({ supabase, responseId: shiftWeekMatch[1], telegramUserId })
            if (chatId) {
              await sendTelegramText(chatId, `<b>Выберите проблемную смену</b>\n\nНажмите на дату, по которой есть проблема.`)
              await callTelegram('sendMessage', { chat_id: String(chatId), text: 'Даты ваших смен на эту неделю:', reply_markup: result.keyboard })
            }
          }
        } catch (error: any) {
          if (chatId) await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по неделе.').catch(() => null)
        }
        return json({ ok: true })
      }

      const shiftIssueMatch = callbackData.match(/^si:([0-9a-f-]+):(\d{6}):(d|n)$/i)
      if (shiftIssueMatch) {
        await answerCallbackQuery(callbackQueryId, 'Записываю смену...').catch(() => null)
        try {
          const issuePayload = parseShiftIssuePayload(shiftIssueMatch[2], shiftIssueMatch[3])
          const result = await createShiftIssueDraft({ supabase, responseId: shiftIssueMatch[1], telegramUserId, shiftDate: issuePayload.shiftDate, shiftType: issuePayload.shiftType, source: 'telegram' })
          if (chatId) await sendTelegramText(chatId, `<b>Смена отмечена как проблемная</b>\n\n${result.operatorName}, теперь одним сообщением напишите причину.`)
        } catch (error: any) {
          if (chatId) await sendTelegramText(chatId, error?.message || 'Не удалось записать проблемную смену.').catch(() => null)
        }
        return json({ ok: true })
      }

      const taskMatch = callbackData.match(/^task:([0-9a-f-]+):(accept|need_info|blocked|already_done|complete)$/i)
      if (!taskMatch) {
        await answerCallbackQuery(callbackQueryId, 'Неизвестное действие', true)
        return json({ ok: true })
      }
      await answerCallbackQuery(callbackQueryId, 'Обрабатываю ответ...').catch(() => null)
      try {
        const result = await processTaskResponse({ supabase, taskId: taskMatch[1], response: taskMatch[2] as TaskResponse, telegramUserId })
        if (chatId && messageId) await clearCallbackButtons(chatId, messageId).catch(() => null)
        if (chatId) await sendTelegramText(chatId, `<b>Ответ по задаче #${result.taskNumber} принят</b>\n\n<b>${result.responseLabel}</b>\nНовый статус: <b>${result.statusLabel}</b>`)
      } catch (error: any) {
        if (chatId) await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по задаче.').catch(() => null)
      }
      return json({ ok: true })
    }

    // ── Text messages ──
    if (update.message?.text && update.message.chat?.id) {
      const chatId = update.message.chat.id
      const telegramUserId = String(update.message.from?.id || chatId)
      const text = update.message.text.trim()
      const cmd = text.split(' ')[0]?.toLowerCase()

      // Identify user role
      const botUser = await identifyBotUser(telegramUserId)

      // /start and /help — personalized
      if (cmd === '/start' || cmd === '/help') {
        await sendTelegramText(chatId, buildHelpText(botUser))
        return json({ ok: true })
      }

      // Finance commands
      if (['/today', '/yesterday', '/week', '/month'].includes(cmd ?? '')) {
        if (!canUseFinance(botUser.role)) {
          await sendTelegramText(chatId, '⛔ У вас нет доступа к финансовым командам.\n\nОбратитесь к администратору системы.')
          return json({ ok: true })
        }
        const today = todayISO()
        const ranges: Record<string, [string, string, string]> = {
          '/today': [today, today, 'Сегодня'],
          '/yesterday': [addDaysISO(today, -1), addDaysISO(today, -1), 'Вчера'],
          '/week': [addDaysISO(today, -6), today, 'Последние 7 дней'],
          '/month': [addDaysISO(today, -29), today, 'Последние 30 дней'],
        }
        const [from, to, title] = ranges[cmd ?? ''] ?? [today, today, 'Сегодня']
        const data = await getFinanceSummary(from, to)
        await sendTelegramText(chatId, formatSummary(data, title))
        return json({ ok: true })
      }

      if (cmd === '/cashflow') {
        if (!canUseFinance(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Нет доступа к финансовым командам.')
          return json({ ok: true })
        }
        await handleCashFlow(Number(chatId))
        return json({ ok: true })
      }

      if (cmd === '/top') {
        if (!canUseTop(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Нет доступа к рейтингу операторов.')
          return json({ ok: true })
        }
        await handleTopOperators(Number(chatId))
        return json({ ok: true })
      }

      if (cmd === '/forecast') {
        if (!canUseForecast(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Прогноз доступен только владельцу и администратору.')
          return json({ ok: true })
        }
        await handleForecast(Number(chatId))
        return json({ ok: true })
      }

      if (cmd === '/mystats') {
        if (botUser.role !== 'operator' || !botUser.operatorId) {
          await sendTelegramText(chatId, '⛔ Эта команда доступна только операторам.')
          return json({ ok: true })
        }
        await handleMyStats(Number(chatId), botUser.operatorId, botUser.name)
        return json({ ok: true })
      }

      if (cmd === '/myshifts') {
        if (botUser.role !== 'operator' || !botUser.operatorId) {
          await sendTelegramText(chatId, '⛔ Эта команда доступна только операторам.')
          return json({ ok: true })
        }
        await handleMyShifts(Number(chatId), botUser.operatorId, botUser.name)
        return json({ ok: true })
      }

      // Shift issue pending response
      const pendingShiftIssue = await submitPendingShiftIssueReason({ supabase, telegramUserId, reason: text, source: 'telegram' })
      if (pendingShiftIssue) {
        await writeAuditLog(supabase, {
          entityType: 'shift-change-request', entityId: pendingShiftIssue.requestId, action: 'telegram-submit-reason',
          payload: { operator_name: pendingShiftIssue.operatorName, shift_date: pendingShiftIssue.shiftDate, shift_type: pendingShiftIssue.shiftType },
        })
        await sendTelegramText(chatId, `<b>Запрос на изменение смены отправлен</b>\n\n${pendingShiftIssue.operatorName}, руководитель увидит ваш запрос и свяжется с вами.`)
        return json({ ok: true })
      }

      // Task text response
      const parsed = parseTextResponse(text)
      if (parsed) {
        const task = await loadTaskByNumberForOperator(supabase, parsed.taskNumber, telegramUserId)
        if (!task?.id) {
          await sendTelegramText(chatId, `Не нашел вашу задачу #${parsed.taskNumber}. Проверьте номер или откройте личный кабинет.`)
          return json({ ok: true })
        }
        try {
          const result = await processTaskResponse({ supabase, taskId: String(task.id), response: parsed.response, telegramUserId })
          await sendTelegramText(chatId, `<b>Ответ по задаче #${result.taskNumber} принят</b>\n\n<b>${result.responseLabel}</b>\nНовый статус: <b>${result.statusLabel}</b>`)
        } catch (error: any) {
          await sendTelegramText(chatId, error?.message || 'Не удалось обработать ответ по задаче.')
        }
        return json({ ok: true })
      }

      // Fallback
      await sendTelegramText(chatId, buildHelpText(botUser))
      return json({ ok: true })
    }

    return json({ ok: true })
  } catch (error: any) {
    console.error('Telegram webhook error', error)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/telegram/webhook', message: error?.message || 'Telegram webhook error' })
    return json({ error: error?.message || 'Webhook error' }, 500)
  }
}
