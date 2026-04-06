import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import {
  buildInvoiceConfirmationText,
  downloadTelegramFileAsBase64,
  matchInvoiceItems,
  parseInvoiceWithGPT,
} from '@/lib/server/invoice-parser'
import {
  cancelInvoiceSession,
  confirmInvoiceSession,
  createInvoiceSession,
  fetchFirstWarehouseLocation,
  fetchInventoryItemsForMatching,
  fetchInvoiceNameMappings,
  fetchInvoiceSession,
  upsertInvoiceNameMappings,
} from '@/lib/server/repositories/invoice'
import { postInventoryReceipt, decideInventoryRequest } from '@/lib/server/repositories/inventory'
import {
  confirmShiftPublicationWeekByResponse,
  createShiftIssueDraft,
  parseShiftIssuePayload,
  startShiftIssueSelection,
  submitPendingShiftIssueReason,
} from '@/lib/server/shift-workflow'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { SITE_CONTEXT } from '@/lib/ai/site-context'
import { assembleSystemPrompt, wrapDataBlock } from '@/lib/ai/prompts'
import { escapeTelegramHtml, ordaTelegramFrame } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { extractTextFromPdf, parseExpenseFromText, parseExpenseFromImage } from '@/lib/server/expense-receipt-parser'
import { getOperatorSalarySnapshot, buildSalaryTelegramMessage } from '@/lib/server/services/salary'
import { findOperatorByKey } from '@/lib/server/repositories/salary'
import { mondayOfISO } from '@/lib/core/date'

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
      '<b>🤖 AI-ассистент:</b>',
      'Просто напишите вопрос — бот ответит на основе данных бизнеса',
      'Примеры: "сколько заработали на этой неделе?", "где больше всего расходов?", "как дела по точкам?"',
      '/report — детальный недельный отчёт по всем точкам',
      '/reset — сбросить историю диалога',
      '',
      '<b>📊 Быстрые команды:</b>',
      '/today — сводка за сегодня',
      '/yesterday — вчера',
      '/week — последние 7 дней',
      '/month — последние 30 дней',
      '/cashflow — баланс и движение денег',
      '/compare — сравнение этой и прошлой недели',
      '',
      '<b>📦 Склад:</b>',
      'Отправьте фото накладной — бот создаст приёмку автоматически',
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
      lines.push(`${medals[i]} <b>${escapeTelegramHtml(op.name)}</b>`)
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

async function handleCompare(chatId: number) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const thisWeekFrom = addDaysISO(today, -6)
  const lastWeekFrom = addDaysISO(today, -13)
  const lastWeekTo = addDaysISO(today, -7)

  const [thisRes, lastRes] = await Promise.all([
    supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount').gte('date', thisWeekFrom).lte('date', today),
    supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount').gte('date', lastWeekFrom).lte('date', lastWeekTo),
  ])

  const sum = (rows: any[]) => rows.reduce((s: number, r: any) => s + safeNum(r.cash_amount) + safeNum(r.kaspi_amount) + safeNum(r.online_amount) + safeNum(r.card_amount), 0)

  const thisWeek = sum(thisRes.data ?? [])
  const lastWeek = sum(lastRes.data ?? [])
  const diff = thisWeek - lastWeek
  const pct = lastWeek > 0 ? ((diff / lastWeek) * 100) : 0
  const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️'
  const sign = diff >= 0 ? '+' : ''

  const lines = [
    `<b>${arrow} Сравнение недель</b>`,
    '',
    `<b>Эта неделя</b> (${thisWeekFrom} — ${today})`,
    `  💰 ${fmtMoney(thisWeek)}`,
    '',
    `<b>Прошлая неделя</b> (${lastWeekFrom} — ${lastWeekTo})`,
    `  💰 ${fmtMoney(lastWeek)}`,
    '',
    `Изменение: <b>${sign}${fmtMoney(diff)}</b> (${sign}${pct.toFixed(1)}%)`,
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
    `<i>${escapeTelegramHtml(operatorName)} · ${dateFrom} — ${today}</i>`,
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
    `<i>${escapeTelegramHtml(operatorName)}</i>`,
    '',
  ]

  if (!shifts || shifts.length === 0) {
    lines.push('Нет запланированных смен на ближайшие 2 недели')
  } else {
    for (const shift of shifts) {
      const company = (shift.company as any)?.name || ''
      const typeLabel = shiftTypeLabel[shift.shift_type] || shift.shift_type
      lines.push(
        `• ${fmtDate(shift.shift_date)} — ${typeLabel}${company ? `, ${escapeTelegramHtml(company)}` : ''}`,
      )
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

type TelegramPhotoSize = {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

type TelegramUpdate = {
  callback_query?: {
    id: string
    data?: string
    from?: { id?: number; first_name?: string; username?: string }
    message?: { message_id?: number; chat?: { id?: number | string } }
  }
  message?: {
    text?: string
    photo?: TelegramPhotoSize[]
    voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number }
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    caption?: string
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
  await callTelegram('sendMessage', {
    chat_id: String(chatId),
    text: ordaTelegramFrame(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
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

// ─── Invoice photo handler ────────────────────────────────────────────────────

async function handleInvoicePhoto(chatId: number, messageId: number, telegramUserId: string, fileId: string) {
  const supabase = createAdminSupabaseClient()
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')

  // 1. Acknowledge — let user know we're processing
  await sendTelegramText(chatId, '⏳ Обрабатываю накладную, подождите...')

  // 2. Get file path from Telegram
  const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
  const fileData = await fileRes.json()
  const filePath: string = fileData?.result?.file_path
  if (!filePath) throw new Error('Не удалось получить файл из Telegram')

  // 3. Download and encode photo
  const imageDataUrl = await downloadTelegramFileAsBase64(filePath)

  // 4. Fetch inventory items and learned mappings in parallel
  const [inventoryItems, mappings, warehouse] = await Promise.all([
    fetchInventoryItemsForMatching(supabase),
    fetchInvoiceNameMappings(supabase),
    fetchFirstWarehouseLocation(supabase),
  ])

  if (!warehouse) {
    await sendTelegramText(chatId, '⚠️ Нет активных складов в системе. Создайте склад в разделе «Магазин».')
    return
  }

  if (inventoryItems.length === 0) {
    await sendTelegramText(chatId, '⚠️ Каталог товаров пуст. Добавьте товары в разделе «Магазин → Каталог».')
    return
  }

  // 5. Parse with GPT-4o
  const parsed = await parseInvoiceWithGPT(imageDataUrl, inventoryItems)

  if (!parsed.items || parsed.items.length === 0) {
    await sendTelegramText(chatId, '❌ Не удалось распознать товары на фото. Убедитесь, что фото чёткое и содержит накладную или чек.')
    return
  }

  // 6. Match items to inventory
  const matchedItems = matchInvoiceItems(parsed.items, inventoryItems, mappings)
  const hasAnyMatch = matchedItems.some((it) => it.matched_item_id)

  // 7. Save session to DB
  const sessionId = await createInvoiceSession(supabase, {
    telegram_user_id: telegramUserId,
    chat_id: String(chatId),
    message_id: messageId,
    parsed_data: { invoice: parsed, items: matchedItems },
    warehouse_location_id: warehouse.id,
  })

  // 8. Build confirmation message
  const confirmText = buildInvoiceConfirmationText(matchedItems, parsed, warehouse.name)

  // 9. Send with inline keyboard
  const keyboard = hasAnyMatch
    ? {
        inline_keyboard: [
          [
            { text: '✅ Создать приёмку', callback_data: `invoice:${sessionId}:confirm` },
            { text: '❌ Отмена', callback_data: `invoice:${sessionId}:cancel` },
          ],
        ],
      }
    : {
        inline_keyboard: [
          [{ text: '❌ Отмена', callback_data: `invoice:${sessionId}:cancel` }],
        ],
      }

  await callTelegram('sendMessage', {
    chat_id: String(chatId),
    text: ordaTelegramFrame(confirmText),
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

async function handleInvoiceConfirm(
  callbackQueryId: string,
  chatId: string | number,
  messageId: number | undefined,
  telegramUserId: string,
  sessionId: string,
) {
  const supabase = createAdminSupabaseClient()

  const session = await fetchInvoiceSession(supabase, sessionId)
  if (!session) {
    await answerCallbackQuery(callbackQueryId, 'Сессия не найдена или истекла', true)
    return
  }

  if (session.status !== 'pending') {
    await answerCallbackQuery(callbackQueryId, session.status === 'confirmed' ? 'Приёмка уже создана' : 'Операция отменена', true)
    return
  }

  if (session.telegram_user_id !== telegramUserId) {
    await answerCallbackQuery(callbackQueryId, 'Нет доступа к этой операции', true)
    return
  }

  const now = new Date()
  if (new Date(session.expires_at) < now) {
    await answerCallbackQuery(callbackQueryId, 'Сессия истекла. Отправьте накладную заново.', true)
    await cancelInvoiceSession(supabase, sessionId)
    return
  }

  if (!session.warehouse_location_id) {
    await answerCallbackQuery(callbackQueryId, 'Склад не найден', true)
    return
  }

  const sessionData = session.parsed_data as { invoice: any; items: any[] }
  const matchedItems = (sessionData.items || []).filter((it: any) => it.matched_item_id)

  if (matchedItems.length === 0) {
    await answerCallbackQuery(callbackQueryId, 'Нет сопоставленных товаров для приёмки', true)
    return
  }

  await answerCallbackQuery(callbackQueryId, 'Создаю приёмку...')

  const today = todayISO()
  const receipt = await postInventoryReceipt(supabase, {
    location_id: session.warehouse_location_id,
    received_at: sessionData.invoice?.invoice_date || today,
    supplier_id: null,
    invoice_number: sessionData.invoice?.invoice_number || null,
    comment: `Приёмка из Telegram (накладная ${sessionData.invoice?.supplier_name || 'неизв.'})`,
    created_by: null,
    items: matchedItems.map((it: any) => ({
      item_id: it.matched_item_id,
      quantity: it.quantity,
      unit_cost: it.unit_cost || 0,
      comment: it.invoice_name !== it.matched_item_name ? `Из накладной: «${it.invoice_name}»` : null,
    })),
  })

  // Save learned name mappings for matched items
  const newMappings = matchedItems
    .filter((it: any) => it.match_source !== 'mapping' && it.invoice_name && it.matched_item_id)
    .map((it: any) => ({ invoice_name: it.invoice_name, item_id: it.matched_item_id }))
  await upsertInvoiceNameMappings(supabase, newMappings).catch(() => null)

  await confirmInvoiceSession(supabase, sessionId, receipt?.receipt_id || receipt?.id || '')

  // Update the message to remove buttons
  if (messageId) await clearCallbackButtons(chatId, messageId).catch(() => null)

  const totalAmount = matchedItems.reduce((sum: number, it: any) => sum + (it.total_cost || it.quantity * it.unit_cost), 0)
  await sendTelegramText(
    chatId,
    `<b>✅ Приёмка создана!</b>\n\n` +
      `Принято товаров: <b>${matchedItems.length}</b>\n` +
      `Сумма: <b>${totalAmount.toLocaleString('ru-RU')} ₸</b>\n` +
      `Склад: <b>${session.warehouse_location_id}</b>\n\n` +
      `<i>Остатки обновлены. Проверьте раздел «Магазин → Приёмки» на сайте.</i>`,
  )
}

async function handleInvoiceCancel(
  callbackQueryId: string,
  chatId: string | number,
  messageId: number | undefined,
  telegramUserId: string,
  sessionId: string,
) {
  const supabase = createAdminSupabaseClient()

  const session = await fetchInvoiceSession(supabase, sessionId)
  if (session?.telegram_user_id !== telegramUserId) {
    await answerCallbackQuery(callbackQueryId, 'Нет доступа', true)
    return
  }

  await cancelInvoiceSession(supabase, sessionId)
  await answerCallbackQuery(callbackQueryId, 'Отменено')
  if (messageId) await clearCallbackButtons(chatId, messageId).catch(() => null)
  await sendTelegramText(chatId, '❌ Создание приёмки отменено.')
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const MAX_HISTORY = 12

// ─── Snapshot cache (in-memory, TTL 3 min) ───────────────────────────────────
type SnapshotCache = { data: any; expires: number }
const snapshotCache = new Map<string, SnapshotCache>()
const SNAPSHOT_TTL = 3 * 60 * 1000

function getCachedSnapshot(key: string) {
  const entry = snapshotCache.get(key)
  if (entry && entry.expires > Date.now()) return entry.data
  return null
}
function setCachedSnapshot(key: string, data: any) {
  snapshotCache.set(key, { data, expires: Date.now() + SNAPSHOT_TTL })
}

// ─── AI response validation ───────────────────────────────────────────────────
// Checks for wrong currency symbols ($/€/₽) in final reply and warns the user
function validateAIReply(reply: string): string {
  const wrongCurrency = /\$\s?\d|\d\s?\$|€\s?\d|\d\s?€|₽\s?\d|\d\s?₽/
  if (wrongCurrency.test(reply)) {
    return reply + '\n\n<i>⚠️ Замечена нестандартная валюта в ответе — все суммы должны быть в ₸.</i>'
  }
  return reply
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

async function loadChatHistory(supabase: ReturnType<typeof createAdminSupabaseClient>, chatId: string): Promise<ChatMessage[]> {
  try {
    const { data } = await supabase.from('telegram_chat_history').select('history').eq('chat_id', chatId).maybeSingle()
    return (data?.history as ChatMessage[]) || []
  } catch { return [] }
}

async function saveChatHistory(supabase: ReturnType<typeof createAdminSupabaseClient>, chatId: string, history: ChatMessage[]) {
  const trimmed = history.slice(-MAX_HISTORY)
  await supabase.from('telegram_chat_history').upsert({ chat_id: chatId, history: trimmed, updated_at: new Date().toISOString() })
}

// Long-term memory — stored separately from conversation history
async function loadMemory(supabase: ReturnType<typeof createAdminSupabaseClient>, chatId: string): Promise<string> {
  try {
    const { data } = await supabase.from('telegram_chat_history').select('history').eq('chat_id', `memory_${chatId}`).maybeSingle()
    const mem = (data?.history as Array<{ content: string }>) || []
    return mem.map(m => m.content).join('\n')
  } catch { return '' }
}

async function saveMemory(supabase: ReturnType<typeof createAdminSupabaseClient>, chatId: string, newFact: string) {
  try {
    const existing = await loadMemory(supabase, chatId)
    const lines = existing ? existing.split('\n').filter(Boolean) : []
    lines.push(`[${new Date().toISOString().slice(0, 10)}] ${newFact}`)
    const trimmed = lines.slice(-50) // keep last 50 facts
    await supabase.from('telegram_chat_history').upsert({
      chat_id: `memory_${chatId}`,
      history: trimmed.map(l => ({ content: l })),
      updated_at: new Date().toISOString(),
    })
  } catch { /* ignore */ }
}

// Transcribe voice message via OpenAI Whisper (auto language detection)
async function transcribeVoice(fileId: string, botToken: string, apiKey: string): Promise<{ text: string; language: string } | null> {
  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json()
    const filePath = fileData?.result?.file_path
    if (!filePath) return null

    const audioRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
    if (!audioRes.ok) return null
    const audioBuffer = await audioRes.arrayBuffer()

    // Detect MIME from file path (.oga/.ogg → ogg, .mp4 → mp4, etc.)
    const ext = filePath.split('.').pop()?.toLowerCase() || 'ogg'
    const mimeMap: Record<string, string> = { oga: 'audio/ogg', ogg: 'audio/ogg', mp4: 'audio/mp4', m4a: 'audio/mp4', webm: 'audio/webm', wav: 'audio/wav' }
    const mime = mimeMap[ext] || 'audio/ogg'

    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mime }), `voice.${ext}`)
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json') // get language detection

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    const whisperData = await whisperRes.json()
    const text = whisperData?.text?.trim()
    if (!text) return null
    return { text, language: whisperData?.language || 'unknown' }
  } catch { return null }
}

// Language emoji/label
function langLabel(lang: string): string {
  const map: Record<string, string> = { russian: '🇷🇺', kazakh: '🇰🇿', english: '🇺🇸', unknown: '🌐' }
  return map[lang] || '🌐'
}

// Text-to-speech via OpenAI TTS → send as voice to Telegram
async function sendVoiceReply(chatId: number, text: string, apiKey: string, botToken: string) {
  try {
    // Limit TTS to 4096 chars
    const ttsText = text.replace(/<[^>]+>/g, '').slice(0, 4096)

    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: ttsText, response_format: 'opus' }),
    })
    if (!ttsRes.ok) return

    const audioBuffer = await ttsRes.arrayBuffer()
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('voice', new Blob([audioBuffer], { type: 'audio/ogg' }), 'reply.ogg')

    await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, { method: 'POST', body: form })
  } catch { /* TTS is optional, don't fail */ }
}

async function handleAIChat(chatId: number, chatIdStr: string, userText: string, supabase: ReturnType<typeof createAdminSupabaseClient>, onReply?: (reply: string) => Promise<void>, botUser?: BotUser) {
  const today = todayISO()
  const weekFrom = addDaysISO(today, -6)
  const prevWeekFrom = addDaysISO(today, -13)
  const prevWeekTo = addDaysISO(today, -7)
  const monthFrom = addDaysISO(today, -29)
  const quarterFrom = addDaysISO(today, -89)

  // Загружаем максимум данных для глубокого анализа (с кэшем 3 мин)
  const cacheKey = `ai_snapshot_${today}`
  const cached = getCachedSnapshot(cacheKey)
  const [incomesWeekRes, expensesWeekRes, incomesPrevWeekRes, incomesMonthRes, incomesQuarterRes, expensesMonthRes, companiesRes, operatorsRes, staffRes, operatorProfilesRes] = cached ?? await (async () => {
    const results = await Promise.all([
      supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, date, company_id, zone').gte('date', weekFrom).lte('date', today),
      supabase.from('expenses').select('cash_amount, kaspi_amount, category, date, company_id').gte('date', weekFrom).lte('date', today),
      supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, date').gte('date', prevWeekFrom).lte('date', prevWeekTo),
      supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, date, company_id').gte('date', monthFrom).lte('date', today),
      supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, date').gte('date', quarterFrom).lte('date', today),
      supabase.from('expenses').select('cash_amount, kaspi_amount, category, date, company_id').gte('date', monthFrom).lte('date', today),
      supabase.from('companies').select('id, name, code'),
      supabase.from('operators').select('id, name, short_name, operator_profiles(full_name)').eq('is_active', true).limit(200),
      supabase.from('staff').select('id, full_name, role').eq('is_active', true),
      supabase.from('operator_profiles').select('operator_id, full_name, birth_date').not('birth_date', 'is', null),
    ])
    setCachedSnapshot(cacheKey, results)
    return results
  })()

  const safeN = (v: any) => Number(v || 0)
  const rowTotal = (r: any) => safeN(r.cash_amount) + safeN(r.kaspi_amount) + safeN(r.online_amount) + safeN(r.card_amount)

  // --- Текущая неделя ---
  let weekIncome = 0, weekCash = 0, weekKaspi = 0, weekOnline = 0, weekExpense = 0
  const catMapWeek = new Map<string, number>()
  const companyIncomeMap = new Map<string, number>()
  const companyExpenseMap = new Map<string, number>()
  const dailyIncomeMap = new Map<string, number>()

  for (const r of incomesWeekRes.data ?? []) {
    const t = rowTotal(r)
    weekIncome += t; weekCash += safeN(r.cash_amount); weekKaspi += safeN(r.kaspi_amount); weekOnline += safeN(r.online_amount)
    if (r.company_id) companyIncomeMap.set(r.company_id, (companyIncomeMap.get(r.company_id) || 0) + t)
    dailyIncomeMap.set(r.date, (dailyIncomeMap.get(r.date) || 0) + t)
  }
  for (const r of expensesWeekRes.data ?? []) {
    const t = safeN(r.cash_amount) + safeN(r.kaspi_amount)
    weekExpense += t
    catMapWeek.set(r.category || 'Прочее', (catMapWeek.get(r.category || 'Прочее') || 0) + t)
    if (r.company_id) companyExpenseMap.set(r.company_id, (companyExpenseMap.get(r.company_id) || 0) + t)
  }

  // --- Прошлая неделя ---
  let prevWeekIncome = 0
  for (const r of incomesPrevWeekRes.data ?? []) prevWeekIncome += rowTotal(r)

  // --- Месяц ---
  let monthIncome = 0, monthExpense = 0
  const monthExpCatMap = new Map<string, number>()
  const monthCompanyIncomeMap = new Map<string, number>()
  const monthCompanyExpenseMap = new Map<string, number>()
  for (const r of incomesMonthRes.data ?? []) {
    const t = rowTotal(r)
    monthIncome += t
    if (r.company_id) monthCompanyIncomeMap.set(r.company_id, (monthCompanyIncomeMap.get(r.company_id) || 0) + t)
  }
  for (const r of expensesMonthRes.data ?? []) {
    const t = safeN(r.cash_amount) + safeN(r.kaspi_amount)
    monthExpense += t
    monthExpCatMap.set(r.category || 'Прочее', (monthExpCatMap.get(r.category || 'Прочее') || 0) + t)
    if (r.company_id) monthCompanyExpenseMap.set(r.company_id, (monthCompanyExpenseMap.get(r.company_id) || 0) + t)
  }

  // --- Квартал: недельный тренд ---
  const weeklyTrend: number[] = Array(13).fill(0)
  const [qy, qm, qd] = quarterFrom.split('-').map(Number)
  const qFromMs = Date.UTC(qy, (qm || 1) - 1, qd || 1)
  for (const r of incomesQuarterRes.data ?? []) {
    const [ry, rm, rd] = r.date.split('-').map(Number)
    const ms = Date.UTC(ry, (rm || 1) - 1, rd || 1)
    const wi = Math.min(12, Math.max(0, Math.floor((ms - qFromMs) / (7 * 86400_000))))
    weeklyTrend[wi] += rowTotal(r)
  }
  const nonZeroWeeks = weeklyTrend.filter(v => v > 0)
  const avgWeeklyIncome = nonZeroWeeks.length ? nonZeroWeeks.reduce((a, b) => a + b, 0) / nonZeroWeeks.length : 0
  const firstHalf = weeklyTrend.slice(0, 6).filter(v => v > 0)
  const secondHalf = weeklyTrend.slice(7).filter(v => v > 0)
  const firstAvg = firstHalf.length ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0
  const secondAvg = secondHalf.length ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0
  const quarterGrowth = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0

  // --- Производные метрики ---
  const weekProfit = weekIncome - weekExpense
  const weekMargin = weekIncome > 0 ? (weekProfit / weekIncome * 100) : 0
  const weekVsPrev = prevWeekIncome > 0 ? ((weekIncome - prevWeekIncome) / prevWeekIncome * 100) : 0
  const kaspiShare = weekIncome > 0 ? (weekKaspi / weekIncome * 100) : 0
  const cashShare = weekIncome > 0 ? (weekCash / weekIncome * 100) : 0

  // Лучший и худший день недели
  const dailyEntries = Array.from(dailyIncomeMap.entries()).sort((a, b) => b[1] - a[1])
  const bestDay = dailyEntries[0]
  const worstDay = dailyEntries[dailyEntries.length - 1]

  // Все расходы за месяц по категориям
  const allMonthExpenses = Array.from(monthExpCatMap.entries()).sort((a, b) => b[1] - a[1])
  const totalMonthExpense = monthExpense

  // Компании
  const companies = (companiesRes.data || []) as Array<{ id: string; name: string; code: string }>
  const companyNames = companies.map(c => c.name).join(', ') || '—'

  // Реальные имена операторов
  const operatorsList = (operatorsRes.data || []).map((op: any) => {
    const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
    return profiles?.[0]?.full_name || op.name || op.short_name || '—'
  })
  const operatorCount = operatorsList.length

  // Стафф по ролям
  const roleLabel: Record<string, string> = { owner: 'Владелец', manager: 'Руководитель', marketer: 'Маркетолог', super_admin: 'Супер-админ' }
  const staffByRole = new Map<string, string[]>()
  for (const s of (staffRes.data || []) as Array<{ full_name: string; role: string }>) {
    const role = roleLabel[s.role] || s.role
    if (!staffByRole.has(role)) staffByRole.set(role, [])
    staffByRole.get(role)!.push(s.full_name)
  }
  const staffLines = Array.from(staffByRole.entries()).map(([role, names]) => `  • ${role}: ${names.join(', ')}`).join('\n')
  const operatorsLines = operatorsList.length > 0 ? `  • Операторы (${operatorCount}): ${operatorsList.join(', ')}` : ''

  // --- Дни рождения ---
  const allProfiles = (operatorProfilesRes.data || []) as Array<{ operator_id: string; full_name: string | null; birth_date: string | null }>
  const upcomingBirthdays: string[] = []
  const todayParts = today.split('-').map(Number)
  const todayMD = todayParts[1] * 100 + todayParts[2]
  for (const p of allProfiles) {
    if (!p.birth_date || !p.full_name) continue
    const [, bm, bd] = p.birth_date.split('-').map(Number)
    const bMD = bm * 100 + bd
    // Check if birthday is in next 14 days (handle year wrap)
    const diff = bMD >= todayMD ? bMD - todayMD : 1200 - todayMD + bMD
    if (diff <= 14) {
      const daysLeft = diff === 0 ? 'сегодня! 🎂' : `через ${diff} дн.`
      upcomingBirthdays.push(`  • ${p.full_name}: ${bd}.${String(bm).padStart(2, '0')} (${daysLeft})`)
    }
  }
  const birthdayContext = upcomingBirthdays.length > 0
    ? `БЛИЖАЙШИЕ ДНИ РОЖДЕНИЯ (14 дней):\n${upcomingBirthdays.join('\n')}`
    : ''

  // Контекст текущего пользователя (кто пишет боту)
  const callerContext = botUser && botUser.role !== 'unknown'
    ? `СЕЙЧАС ПИШЕТ: ${botUser.name} (роль: ${botUser.role === 'super_admin' ? 'Администратор' : botUser.role === 'owner' ? 'Владелец' : botUser.role === 'manager' ? 'Руководитель' : botUser.role === 'marketer' ? 'Маркетолог' : 'Оператор'}${botUser.operatorId ? `, operator_id: ${botUser.operatorId}` : ''})`
    : ''

  // По точкам за неделю
  const companyWeekStats = companies.map(c => ({ name: c.name, inc: companyIncomeMap.get(c.id) || 0, exp: companyExpenseMap.get(c.id) || 0 })).filter(c => c.inc > 0 || c.exp > 0).sort((a, b) => b.inc - a.inc)
  const topCompanyShare = weekIncome > 0 && companyWeekStats[0] ? (companyWeekStats[0].inc / weekIncome * 100) : 0

  // По точкам за месяц
  const companyMonthStats = companies.map(c => ({
    name: c.name,
    inc: monthCompanyIncomeMap.get(c.id) || 0,
    exp: monthCompanyExpenseMap.get(c.id) || 0,
  })).filter(c => c.inc > 0 || c.exp > 0).sort((a, b) => b.inc - a.inc)

  const companyWeekLines = companyWeekStats.map(c => {
    const profit = c.inc - c.exp
    const margin = c.inc > 0 ? (profit / c.inc * 100).toFixed(1) : '0'
    const share = weekIncome > 0 ? (c.inc / weekIncome * 100).toFixed(1) : '0'
    return `  • ${c.name}: выручка ${c.inc.toLocaleString('ru-RU')} ₸ (${share}%), расходы ${c.exp.toLocaleString('ru-RU')} ₸, прибыль ${profit.toLocaleString('ru-RU')} ₸, маржа ${margin}%`
  }).join('\n')

  const companyMonthLines = companyMonthStats.map(c => {
    const profit = c.inc - c.exp
    const margin = c.inc > 0 ? (profit / c.inc * 100).toFixed(1) : '0'
    const share = monthIncome > 0 ? (c.inc / monthIncome * 100).toFixed(1) : '0'
    return `  • ${c.name}: выручка ${c.inc.toLocaleString('ru-RU')} ₸ (${share}%), расходы ${c.exp.toLocaleString('ru-RU')} ₸, прибыль ${profit.toLocaleString('ru-RU')} ₸, маржа ${margin}%`
  }).join('\n')

  // ─── Серверные триггеры (считаются здесь, НЕ в промпте) ──────────────────
  const negativeDays = Array.from(dailyIncomeMap.entries()).filter(([date]) => {
    const dayIncome = dailyIncomeMap.get(date) || 0
    // Day is "negative" if expenses exceed income for that date
    const dayExpense = Array.from(expensesWeekRes.data ?? [])
      .filter((r: any) => r.date === date)
      .reduce((s: number, r: any) => s + safeN(r.cash_amount) + safeN(r.kaspi_amount), 0)
    return dayExpense > dayIncome
  })

  const actionFlags = {
    lowMargin: weekIncome > 0 && weekMargin < 10,
    expenseTrendUp: (() => {
      const half = Math.floor(weeklyTrend.length / 2)
      const first = weeklyTrend.slice(0, half).filter(v => v > 0)
      const second = weeklyTrend.slice(half).filter(v => v > 0)
      const fAvg = first.length ? first.reduce((a, b) => a + b, 0) / first.length : 0
      const sAvg = second.length ? second.reduce((a, b) => a + b, 0) / second.length : 0
      // Упрощённый тренд расходов: последние 4 недели vs предыдущие 4
      return sAvg > fAvg * 1.1
    })(),
    highConcentration: topCompanyShare > 60,
    negativeDaysCount: negativeDays.length,
  }

  // ─── JSON Data Block (сырые числа — без форматирования) ───────────────────
  const dataBlock = {
    as_of: new Date().toISOString(),
    timezone: 'Asia/Almaty',
    currency: 'KZT',
    business: {
      type: 'gaming_clubs_network',
      companies: companies.map(c => ({ id: c.id, name: c.name, code: c.code })),
      shift_types: ['day', 'night'],
      income_zones: ['PC', 'arena', 'ramen', 'extra'],
      payment_methods: ['cash', 'kaspi', 'online', 'card'],
      salary_formula: 'base + auto_bonuses - fines - debts - advances',
    },
    week: {
      period: { from: weekFrom, to: today },
      income_kzt: Math.round(weekIncome),
      expense_kzt: Math.round(weekExpense),
      profit_kzt: Math.round(weekProfit),
      margin_bp: weekIncome > 0 ? Math.round((weekProfit / weekIncome) * 10000) : 0,
      payments: {
        cash_kzt: Math.round(weekCash),
        kaspi_kzt: Math.round(weekKaspi),
        online_kzt: Math.round(weekOnline),
        cashless_share_bp: weekIncome > 0 ? Math.round(((weekKaspi + weekOnline) / weekIncome) * 10000) : 0,
      },
      vs_prev_week_bp: prevWeekIncome > 0 ? Math.round(((weekIncome - prevWeekIncome) / prevWeekIncome) * 10000) : 0,
      best_day: bestDay ? { date: bestDay[0], income_kzt: Math.round(bestDay[1]) } : null,
      worst_day: worstDay ? { date: worstDay[0], income_kzt: Math.round(worstDay[1]) } : null,
      by_company: companyWeekStats.map(c => ({
        name: c.name,
        income_kzt: Math.round(c.inc),
        expense_kzt: Math.round(c.exp),
        profit_kzt: Math.round(c.inc - c.exp),
        margin_bp: c.inc > 0 ? Math.round(((c.inc - c.exp) / c.inc) * 10000) : 0,
        share_bp: weekIncome > 0 ? Math.round((c.inc / weekIncome) * 10000) : 0,
      })),
      expense_by_category: Array.from(catMapWeek.entries()).sort((a, b) => b[1] - a[1]).map(([cat, v]) => ({
        category: cat,
        expense_kzt: Math.round(v),
        share_bp: weekExpense > 0 ? Math.round((v / weekExpense) * 10000) : 0,
      })),
    },
    month: {
      period: { from: monthFrom, to: today },
      income_kzt: Math.round(monthIncome),
      expense_kzt: Math.round(monthExpense),
      profit_kzt: Math.round(monthIncome - monthExpense),
      margin_bp: monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 10000) : 0,
      by_company: companyMonthStats.map(c => ({
        name: c.name,
        income_kzt: Math.round(c.inc),
        expense_kzt: Math.round(c.exp),
        profit_kzt: Math.round(c.inc - c.exp),
        margin_bp: c.inc > 0 ? Math.round(((c.inc - c.exp) / c.inc) * 10000) : 0,
        share_bp: monthIncome > 0 ? Math.round((c.inc / monthIncome) * 10000) : 0,
      })),
      expense_by_category: Array.from(monthExpCatMap.entries()).sort((a, b) => b[1] - a[1]).map(([cat, v]) => ({
        category: cat,
        expense_kzt: Math.round(v),
        share_bp: monthExpense > 0 ? Math.round((v / monthExpense) * 10000) : 0,
      })),
      unassigned_income_kzt: Math.round(Math.max(0, monthIncome - companyMonthStats.reduce((s, c) => s + c.inc, 0))),
    },
    prev_week: {
      period: { from: prevWeekFrom, to: prevWeekTo },
      income_kzt: Math.round(prevWeekIncome),
    },
    quarter: {
      period: { from: quarterFrom, to: today },
      avg_weekly_income_kzt: Math.round(avgWeeklyIncome),
      growth_bp: Math.round(quarterGrowth * 100),
      weekly_trend_kzt: weeklyTrend.map(v => Math.round(v)),
    },
    triggers: {
      low_margin: actionFlags.lowMargin,
      expense_trend_up: actionFlags.expenseTrendUp,
      high_concentration: actionFlags.highConcentration,
      concentration_leader: companyWeekStats[0]?.name || null,
      concentration_bp: weekIncome > 0 && companyWeekStats[0] ? Math.round((companyWeekStats[0].inc / weekIncome) * 10000) : 0,
      negative_days_count: actionFlags.negativeDaysCount,
    },
    data_quality: {
      missing_company_id_income_rows: monthIncome > 0 ? (Math.round(Math.max(0, monthIncome - companyMonthStats.reduce((s, c) => s + c.inc, 0))) > 100 ? 'yes' : 'no') : 'no',
    },
  }

  const pagesContext = SITE_CONTEXT.pages.map(p => `${p.title} (${p.route}): ${p.description}`).join('\n')
  const teamContext = [
    staffLines || '(нет данных о стаффе)',
    operatorsLines || `Операторов: ${operatorCount}`,
  ].join('\n')

  // Long-term memory
  const longTermMemory = await loadMemory(supabase, chatIdStr)

  const promptRole = botUser?.role === 'operator' ? 'operator' : 'finance'

  const systemPrompt = [
    assembleSystemPrompt({
      role: promptRole,
      today,
      callerContext,
      longTermMemory,
      pagesContext,
      teamContext,
      birthdayContext,
      actionFlags,
    }),
    wrapDataBlock(dataBlock),
  ].join('\n\n')

  // ─── Agent tools definition ───────────────────────────────────────────────
  const tools = [
    {
      type: 'function',
      function: {
        name: 'send_message_to_operator',
        description: 'Отправить сообщение конкретному оператору в Telegram по имени. Используй когда пользователь хочет что-то передать оператору.',
        parameters: {
          type: 'object',
          properties: {
            operator_name: { type: 'string', description: 'Имя оператора (можно частичное, например "Улан")' },
            message: { type: 'string', description: 'Текст сообщения для оператора' },
          },
          required: ['operator_name', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_task_for_operator',
        description: 'Создать задачу в системе для конкретного оператора.',
        parameters: {
          type: 'object',
          properties: {
            operator_name: { type: 'string', description: 'Имя оператора' },
            title: { type: 'string', description: 'Название задачи' },
            description: { type: 'string', description: 'Подробное описание задачи (необязательно)' },
          },
          required: ['operator_name', 'title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_operator_info',
        description: 'Получить информацию о конкретном операторе: статистику, ближайшие смены.',
        parameters: {
          type: 'object',
          properties: {
            operator_name: { type: 'string', description: 'Имя оператора' },
          },
          required: ['operator_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_message_to_all_operators',
        description: 'Отправить одно сообщение всем активным операторам у которых есть Telegram.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Текст сообщения' },
          },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_financials',
        description: 'Запросить точные финансовые данные за любой период — по всем точкам или по конкретной. Используй ВСЕГДА когда пользователь спрашивает цифры за конкретный период (день, неделю, месяц, произвольные даты). Не используй данные из системного промпта для ответа на вопросы о конкретных периодах — всегда вызывай этот инструмент.',
        parameters: {
          type: 'object',
          properties: {
            date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD' },
            date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
            company_name: { type: 'string', description: 'Название точки (например "F16 Arena"). Пусто = все точки.' },
          },
          required: ['date_from', 'date_to'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_to_memory',
        description: 'Сохранить важный факт в долговременную память. Используй когда пользователь говорит "запомни", "не забудь", или сообщает важную информацию которая пригодится в будущих разговорах.',
        parameters: {
          type: 'object',
          properties: {
            fact: { type: 'string', description: 'Факт для сохранения (коротко и конкретно)' },
          },
          required: ['fact'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_operator_salary',
        description: 'Получить расчёт зарплаты оператора за неделю: база, бонусы, штрафы, авансы, к выплате. Используй когда оператор или администратор спрашивает "сколько получу", "моя зарплата", "зарплата за неделю", "мои достижения". Если operator_id не указан — ищи оператора по имени.',
        parameters: {
          type: 'object',
          properties: {
            operator_id: { type: 'string', description: 'UUID оператора из системы (если известен)' },
            operator_name: { type: 'string', description: 'Имя оператора (если operator_id неизвестен)' },
            week_start: { type: 'string', description: 'Понедельник недели YYYY-MM-DD (если не указан — текущая неделя)' },
          },
          required: [],
        },
      },
    },
  ]

  // ─── Tool executor ────────────────────────────────────────────────────────
  async function executeTool(name: string, args: any): Promise<string> {
    if (name === 'send_message_to_operator') {
      const { data: ops } = await supabase.from('operators').select('id, name, short_name, telegram_chat_id, operator_profiles(full_name)').eq('is_active', true)
      if (!ops?.length) return 'Операторы не найдены в системе.'
      const query = (args.operator_name as string).toLowerCase()
      const found = ops.find((op: any) => {
        const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
        const fullName = (profiles?.[0]?.full_name || op.name || '').toLowerCase()
        const shortName = (op.short_name || '').toLowerCase()
        return fullName.includes(query) || shortName.includes(query) || query.includes(fullName.split(' ')[0] || '')
      })
      if (!found) return `Оператор "${args.operator_name}" не найден. Доступные: ${ops.map((o: any) => { const p = o.operator_profiles as any; return p?.[0]?.full_name || o.name }).join(', ')}`
      if (!found.telegram_chat_id) return `Оператор найден, но у него нет Telegram в системе.`
      const profiles = found.operator_profiles as Array<{ full_name: string | null }> | null
      const displayName = profiles?.[0]?.full_name || found.name
      const msgText = `📨 <b>Сообщение от руководства:</b>\n\n${args.message}`
      await sendTelegramText(found.telegram_chat_id, msgText)
      return `✅ Сообщение отправлено оператору ${displayName}.`
    }

    if (name === 'create_task_for_operator') {
      const { data: ops } = await supabase.from('operators').select('id, name, short_name, operator_profiles(full_name)').eq('is_active', true)
      if (!ops?.length) return 'Операторы не найдены.'
      const query = (args.operator_name as string).toLowerCase()
      const found = ops.find((op: any) => {
        const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
        const fullName = (profiles?.[0]?.full_name || op.name || '').toLowerCase()
        const shortName = (op.short_name || '').toLowerCase()
        return fullName.includes(query) || shortName.includes(query) || query.includes(fullName.split(' ')[0] || '')
      })
      if (!found) return `Оператор "${args.operator_name}" не найден.`
      const profiles = found.operator_profiles as Array<{ full_name: string | null }> | null
      const displayName = profiles?.[0]?.full_name || found.name
      // Получаем следующий номер задачи
      const { data: lastTask } = await supabase.from('tasks').select('task_number').order('task_number', { ascending: false }).limit(1).maybeSingle()
      const nextNumber = (lastTask?.task_number || 0) + 1
      const { error } = await supabase.from('tasks').insert({
        task_number: nextNumber,
        title: args.title,
        description: args.description || null,
        operator_id: found.id,
        status: 'todo',
        created_at: new Date().toISOString(),
      })
      if (error) return `Ошибка создания задачи: ${error.message}`
      return `✅ Задача #${nextNumber} "${args.title}" создана для ${displayName}.`
    }

    if (name === 'get_operator_info') {
      const { data: ops } = await supabase.from('operators').select('id, name, short_name, operator_profiles(full_name)').eq('is_active', true)
      if (!ops?.length) return 'Операторы не найдены.'
      const query = (args.operator_name as string).toLowerCase()
      const found = ops.find((op: any) => {
        const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
        const fullName = (profiles?.[0]?.full_name || op.name || '').toLowerCase()
        return fullName.includes(query) || query.includes(fullName.split(' ')[0] || '')
      })
      if (!found) return `Оператор "${args.operator_name}" не найден.`
      const today2 = todayISO()
      const dateFrom2 = addDaysISO(today2, -29)
      const [incomesR, shiftsR] = await Promise.all([
        supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, date').eq('operator_id', found.id).gte('date', dateFrom2).lte('date', today2),
        supabase.from('shifts').select('shift_date, shift_type, company:company_id(name)').eq('operator_id', found.id).gte('shift_date', today2).lte('shift_date', addDaysISO(today2, 14)).order('shift_date'),
      ])
      const profiles = found.operator_profiles as Array<{ full_name: string | null }> | null
      const displayName = profiles?.[0]?.full_name || found.name
      let revenue = 0; let shifts2 = 0
      for (const r of incomesR.data ?? []) { const t = safeN(r.cash_amount) + safeN(r.kaspi_amount) + safeN(r.online_amount) + safeN(r.card_amount); if (t) { revenue += t; shifts2++ } }
      const upcomingShifts = (shiftsR.data || []).slice(0, 5).map((s: any) => `${s.shift_date} ${s.shift_type === 'night' ? '🌙' : '☀️'} ${(s.company as any)?.name || ''}`).join(', ')
      return `${displayName}: выручка за 30 дней ${revenue.toLocaleString('ru-RU')} ₸, смен ${shifts2}. Ближайшие смены: ${upcomingShifts || 'нет'}.`
    }

    if (name === 'send_message_to_all_operators') {
      const { data: ops } = await supabase.from('operators').select('name, telegram_chat_id, operator_profiles(full_name)').eq('is_active', true).not('telegram_chat_id', 'is', null)
      if (!ops?.length) return 'Нет операторов с Telegram.'
      const msgText = `📨 <b>Сообщение от руководства:</b>\n\n${args.message}`
      let sent = 0
      for (const op of ops) {
        if (op.telegram_chat_id) { await sendTelegramText(op.telegram_chat_id, msgText).catch(() => null); sent++ }
      }
      return `✅ Сообщение отправлено ${sent} операторам.`
    }

    if (name === 'query_financials') {
      const { date_from, date_to, company_name } = args as { date_from: string; date_to: string; company_name?: string }

      // Find company if specified
      let companyFilter: { id: string; name: string } | null = null
      if (company_name) {
        const { data: allCompanies } = await supabase.from('companies').select('id, name')
        const q = company_name.toLowerCase()
        const found = (allCompanies || []).find((c: any) =>
          c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase())
        )
        if (!found) return `Точка "${company_name}" не найдена. Доступные: ${(allCompanies || []).map((c: any) => c.name).join(', ')}`
        companyFilter = found
      }

      // Query incomes
      let incomeQuery = supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, online_amount, card_amount, company_id, companies(name)')
        .gte('date', date_from)
        .lte('date', date_to)
      if (companyFilter) incomeQuery = incomeQuery.eq('company_id', companyFilter.id)

      // Query expenses
      let expenseQuery = supabase
        .from('expenses')
        .select('cash_amount, kaspi_amount, category, company_id')
        .gte('date', date_from)
        .lte('date', date_to)
      if (companyFilter) expenseQuery = expenseQuery.eq('company_id', companyFilter.id)

      const [{ data: incomes }, { data: expenses }] = await Promise.all([incomeQuery, expenseQuery])

      let totalIncome = 0, totalCash = 0, totalKaspi = 0, totalOnline = 0, totalCard = 0
      const byCompanyIncome = new Map<string, number>()
      for (const r of incomes ?? []) {
        const cash = safeN(r.cash_amount), kaspi = safeN(r.kaspi_amount)
        const online = safeN(r.online_amount), card = safeN(r.card_amount)
        const t = cash + kaspi + online + card
        totalIncome += t; totalCash += cash; totalKaspi += kaspi; totalOnline += online; totalCard += card
        const cName = (r as any).companies?.name || r.company_id || 'Без точки'
        byCompanyIncome.set(cName, (byCompanyIncome.get(cName) || 0) + t)
      }

      let totalExpense = 0
      const byCat = new Map<string, number>()
      const byCompanyExpense = new Map<string, number>()
      for (const r of expenses ?? []) {
        const t = safeN(r.cash_amount) + safeN(r.kaspi_amount)
        totalExpense += t
        byCat.set(r.category || 'Прочее', (byCat.get(r.category || 'Прочее') || 0) + t)
        const cid = r.company_id || 'Без точки'
        byCompanyExpense.set(cid, (byCompanyExpense.get(cid) || 0) + t)
      }

      const profit = totalIncome - totalExpense
      const margin = totalIncome > 0 ? (profit / totalIncome * 100).toFixed(1) : '0'

      const fmt = (v: number) => v.toLocaleString('ru-RU') + ' ₸'
      const lines: string[] = [
        `Период: ${date_from} — ${date_to}${companyFilter ? ` | Точка: ${companyFilter.name}` : ' | Все точки'}`,
        `Доходы: ${fmt(totalIncome)} (нал ${fmt(totalCash)}, Kaspi ${fmt(totalKaspi)}, онлайн ${fmt(totalOnline)}, карта ${fmt(totalCard)})`,
        `Расходы: ${fmt(totalExpense)}`,
        `Прибыль: ${fmt(profit)} | Маржа: ${margin}%`,
      ]

      if (!companyFilter && byCompanyIncome.size > 0) {
        lines.push('По точкам (доход):')
        Array.from(byCompanyIncome.entries()).sort((a, b) => b[1] - a[1])
          .forEach(([name, v]) => lines.push(`  • ${name}: ${fmt(v)} (${totalIncome > 0 ? (v/totalIncome*100).toFixed(1) : 0}%)`))
      }

      if (byCat.size > 0) {
        lines.push('Расходы по категориям:')
        Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])
          .forEach(([cat, v]) => lines.push(`  • ${cat}: ${fmt(v)}`))
      }

      return lines.join('\n')
    }

    if (name === 'save_to_memory') {
      await saveMemory(supabase, chatIdStr, args.fact)
      return `✅ Запомнил: ${args.fact}`
    }

    if (name === 'get_operator_salary') {
      const weekStartArg = (args.week_start as string | undefined)?.trim()
      const weekStart = weekStartArg ? mondayOfISO(weekStartArg) : mondayOfISO(todayISO())
      const weekEnd = addDaysISO(weekStart, 6)

      // Find operator
      let operatorId = (args.operator_id as string | undefined)?.trim()
      let operatorName = 'Оператор'

      if (!operatorId && args.operator_name) {
        // Search by name
        const { data: ops } = await supabase.from('operators').select('id, name, short_name, operator_profiles(full_name)').eq('is_active', true)
        const query = (args.operator_name as string).toLowerCase()
        const found = (ops || []).find((op: any) => {
          const profiles = op.operator_profiles as Array<{ full_name: string | null }> | null
          const fullName = (profiles?.[0]?.full_name || op.name || '').toLowerCase()
          const shortName = (op.short_name || '').toLowerCase()
          return fullName.includes(query) || shortName.includes(query) || query.includes(fullName.split(' ')[0] || '')
        })
        if (!found) return `Оператор "${args.operator_name}" не найден.`
        operatorId = found.id
        const profiles = found.operator_profiles as Array<{ full_name: string | null }> | null
        operatorName = profiles?.[0]?.full_name || found.name || 'Оператор'
      } else if (operatorId) {
        const op = await findOperatorByKey(supabase, operatorId)
        operatorName = op?.short_name || op?.name || 'Оператор'
      }

      if (!operatorId) return 'Укажи имя оператора или operator_id.'

      try {
        const snapshot = await getOperatorSalarySnapshot(supabase, {
          operatorId,
          dateFrom: weekStart,
          dateTo: weekEnd,
          weekStart,
        })
        return buildSalaryTelegramMessage({
          operatorName,
          dateFrom: weekStart,
          dateTo: weekEnd,
          weekStart: snapshot.weekStart,
          weekEnd: snapshot.weekEnd,
          summary: snapshot,
        })
      } catch (e: any) {
        return `Ошибка расчёта зарплаты: ${e?.message || 'неизвестная ошибка'}`
      }
    }

    return 'Неизвестный инструмент.'
  }

  // ─── Agentic loop ─────────────────────────────────────────────────────────
  const history = await loadChatHistory(supabase, chatIdStr)
  history.push({ role: 'user', content: userText })

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { await sendTelegramText(chatId, '⚠️ OpenAI API не настроен.'); return }

  let thinkingMsgId: number | null = null
  try {
    const sentMsg = await callTelegram('sendMessage', { chat_id: String(chatId), text: '💭 Думаю...', parse_mode: 'HTML' })
    thinkingMsgId = sentMsg?.result?.message_id ?? null
  } catch { /* ignore */ }

  const editOrSend = async (text: string) => {
    if (thinkingMsgId) {
      const ok = await callTelegram('editMessageText', { chat_id: String(chatId), message_id: thinkingMsgId, text, parse_mode: 'HTML', disable_web_page_preview: true }).then(() => true).catch(() => false)
      thinkingMsgId = null
      if (!ok) await sendTelegramText(chatId, text)
    } else {
      await sendTelegramText(chatId, text)
    }
  }

  try {
    // Agentic loop — max 5 iterations to prevent infinite loops
    for (let iter = 0; iter < 5; iter++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: 1800, temperature: 0.7, messages, tools, tool_choice: 'auto' }),
      })
      const data = await res.json().catch(() => null)
      const choice = data?.choices?.[0]
      if (!choice) { await editOrSend('❌ Нет ответа от AI.'); return }

      const msg = choice.message
      messages.push(msg)

      // AI wants to call tools
      if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length) {
        // Show user what we're doing
        const actionNames = msg.tool_calls.map((tc: any) => {
          const n = tc.function.name
          if (n === 'send_message_to_operator') return '📤 Отправляю сообщение оператору...'
          if (n === 'create_task_for_operator') return '📋 Создаю задачу...'
          if (n === 'get_operator_info') return '🔍 Ищу данные по оператору...'
          if (n === 'send_message_to_all_operators') return '📢 Рассылаю сообщение...'
          if (n === 'save_to_memory') return '🧠 Запоминаю...'
          if (n === 'query_financials') return '🔍 Запрашиваю данные из базы...'
          return '⚙️ Выполняю действие...'
        })
        if (thinkingMsgId) {
          await callTelegram('editMessageText', { chat_id: String(chatId), message_id: thinkingMsgId, text: actionNames[0], parse_mode: 'HTML' }).catch(() => null)
        }

        // Execute all tool calls
        for (const tc of msg.tool_calls) {
          let toolArgs: any = {}
          try { toolArgs = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
          const result = await executeTool(tc.function.name, toolArgs)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue // loop back to get AI's final response
      }

      // Final text response
      const rawReply = msg.content?.trim() || ''
      if (!rawReply) { await editOrSend('❌ Не удалось получить ответ.'); return }
      const reply = validateAIReply(rawReply)

      history.push({ role: 'assistant', content: rawReply })
      await Promise.all([
        editOrSend(reply),
        saveChatHistory(supabase, chatIdStr, history),
        onReply ? onReply(reply) : Promise.resolve(),
      ])
      return
    }

    await editOrSend('❌ Слишком много шагов — попробуй переформулировать запрос.')
  } catch (e: any) {
    await editOrSend(`❌ Ошибка: ${e?.message || 'Неизвестная ошибка'}`)
  }
}

async function handleDetailedReport(chatId: number) {
  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const weekFrom = addDaysISO(today, -6)

  const [incomesRes, expensesRes, companiesRes] = await Promise.all([
    supabase.from('incomes').select('cash_amount, kaspi_amount, online_amount, card_amount, company_id').gte('date', weekFrom).lte('date', today),
    supabase.from('expenses').select('cash_amount, kaspi_amount, category, company_id').gte('date', weekFrom).lte('date', today),
    supabase.from('companies').select('id, name').eq('is_active', true),
  ])

  const safeN = (v: any) => Number(v || 0)
  const companies = (companiesRes.data || []) as Array<{ id: string; name: string }>

  // Итоги
  let totalIncome = 0, totalCash = 0, totalKaspi = 0, totalOnline = 0, totalExpense = 0
  const byCompany = new Map<string, { income: number; expense: number }>()
  const catMap = new Map<string, number>()

  for (const r of incomesRes.data ?? []) {
    const inc = safeN(r.cash_amount) + safeN(r.kaspi_amount) + safeN(r.online_amount) + safeN(r.card_amount)
    totalIncome += inc; totalCash += safeN(r.cash_amount); totalKaspi += safeN(r.kaspi_amount); totalOnline += safeN(r.online_amount)
    const c = byCompany.get(r.company_id) || { income: 0, expense: 0 }
    c.income += inc; byCompany.set(r.company_id, c)
  }
  for (const r of expensesRes.data ?? []) {
    const exp = safeN(r.cash_amount) + safeN(r.kaspi_amount)
    totalExpense += exp
    catMap.set(r.category || 'Прочее', (catMap.get(r.category || 'Прочее') || 0) + exp)
    const c = byCompany.get(r.company_id) || { income: 0, expense: 0 }
    c.expense += exp; byCompany.set(r.company_id, c)
  }

  const profit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? (profit / totalIncome * 100) : 0
  const sign = profit >= 0 ? '+' : ''
  const marginEmoji = margin >= 20 ? '🟢' : margin >= 10 ? '🟡' : '🔴'

  const lines = [
    `<b>📊 Недельный отчёт</b>`,
    `<i>${weekFrom} — ${today}</i>`,
    '',
    `💰 Выручка: <b>${fmtMoney(totalIncome)}</b>`,
    `  • Нал: ${fmtMoney(totalCash)}`,
    `  • Kaspi: ${fmtMoney(totalKaspi)}`,
    `  • Online: ${fmtMoney(totalOnline)}`,
    `📉 Расходы: <b>${fmtMoney(totalExpense)}</b>`,
    `💼 Прибыль: <b>${sign}${fmtMoney(profit)}</b>`,
    `${marginEmoji} Маржа: <b>${margin.toFixed(1)}%</b>`,
  ]

  // По точкам
  if (companies.length > 0) {
    lines.push('', '<b>По точкам:</b>')
    for (const c of companies) {
      const s = byCompany.get(c.id)
      if (!s || s.income === 0) continue
      const p = s.income - s.expense
      const ps = p >= 0 ? '+' : ''
      lines.push(`  📍 <b>${c.name}</b>: ${fmtMoney(s.income)} → прибыль ${ps}${fmtMoney(p)}`)
    }
  }

  // Расходы по категориям
  const topCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1])
  if (topCats.length > 0) {
    lines.push('', '<b>Расходы по категориям:</b>')
    for (const [cat, val] of topCats.slice(0, 6)) {
      const pct = totalExpense > 0 ? ((val / totalExpense) * 100).toFixed(0) : '0'
      lines.push(`  • ${cat}: ${fmtMoney(val)} (${pct}%)`)
    }
  }

  lines.push('', `<i>💬 Задайте вопрос боту — я проанализирую данные</i>`)

  await sendTelegramText(chatId, lines.join('\n'))
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs'

export async function GET() {
  return json({ ok: true })
}

export async function POST(req: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    // Если TELEGRAM_WEBHOOK_SECRET задан — проверяем. Если не задан — пропускаем (webhook open).
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

      // ── PDF expense: company selection ──
      const pdfCompanyMatch = callbackData.match(/^pdf_company_(\d+)_(.+)$/)
      if (pdfCompanyMatch && chatId) {
        const sessionChatId = pdfCompanyMatch[1]
        const companyId = pdfCompanyMatch[2]
        await answerCallbackQuery(callbackQueryId, '').catch(() => null)
        const { data: sessionRow } = await supabase.from('telegram_chat_history').select('history').eq('chat_id', `pdf_expense_${sessionChatId}`).maybeSingle()
        if (sessionRow?.history?.[0]?.content) {
          const session = JSON.parse(sessionRow.history[0].content)
          session.selectedCompanyId = companyId
          await supabase.from('telegram_chat_history').upsert({ chat_id: `pdf_expense_${sessionChatId}`, history: [{ content: JSON.stringify(session) }], updated_at: new Date().toISOString() })
          const { parsed, companies } = session
          const payMethod = parsed.payment_method === 'kaspi' ? 'Kaspi' : parsed.payment_method === 'card' ? 'Карта' : 'Наличные'
          const selectedCompany = companies.find((c: any) => c.id === companyId)
          const companyButtons = companies.map((c: any) => [{ text: (c.id === companyId ? '✅ ' : '') + c.name, callback_data: `pdf_company_${sessionChatId}_${c.id}` }])
          const confirmText = [`📄 <b>Распознан чек</b>`, ``, `💰 Сумма: <b>${parsed.amount.toLocaleString('ru-RU')} ₸</b>`, `📁 Категория: <b>${parsed.category}</b>`, `📅 Дата: <b>${parsed.date}</b>`, `💳 Оплата: <b>${payMethod}</b>`, parsed.vendor ? `🏪 Поставщик: <b>${parsed.vendor}</b>` : '', `🏢 Точка: <b>${selectedCompany?.name || companyId}</b>`, ``, `Подтверди добавление:`].filter(Boolean).join('\n')
          await callTelegram('editMessageText', { chat_id: String(chatId), message_id: messageId, text: confirmText, parse_mode: 'HTML', reply_markup: { inline_keyboard: [...companyButtons, [{ text: '✅ Добавить в расходы', callback_data: `pdf_confirm_${sessionChatId}` }, { text: '❌ Отмена', callback_data: `pdf_cancel_${sessionChatId}` }]] } }).catch(() => null)
        }
        return json({ ok: true })
      }

      // ── PDF expense: confirm ──
      const pdfConfirmMatch = callbackData.match(/^pdf_confirm_(\d+)$/)
      if (pdfConfirmMatch && chatId) {
        const sessionChatId = pdfConfirmMatch[1]
        await answerCallbackQuery(callbackQueryId, 'Добавляю...').catch(() => null)
        const { data: sessionRow } = await supabase.from('telegram_chat_history').select('history').eq('chat_id', `pdf_expense_${sessionChatId}`).maybeSingle()
        if (!sessionRow?.history?.[0]?.content) { await sendTelegramText(chatId, '❌ Сессия истекла.'); return json({ ok: true }) }
        const { parsed, selectedCompanyId } = JSON.parse(sessionRow.history[0].content)
        if (!selectedCompanyId) { await sendTelegramText(chatId, '❌ Выбери точку.'); return json({ ok: true }) }
        const isKaspi = parsed.payment_method === 'kaspi' || parsed.payment_method === 'card'
        const { error } = await supabase.from('expenses').insert({
          date: parsed.date,
          company_id: selectedCompanyId,
          operator_id: null,
          category: parsed.category,
          cash_amount: isKaspi ? 0 : parsed.amount,
          kaspi_amount: isKaspi ? parsed.amount : 0,
          comment: [parsed.vendor, parsed.comment].filter(Boolean).join(' — ') || null,
        })
        if (error) { await sendTelegramText(chatId, `❌ Ошибка записи: ${error.message}`); return json({ ok: true }) }
        await callTelegram('editMessageText', { chat_id: String(chatId), message_id: messageId, text: `✅ <b>Расход добавлен!</b>\n\n💰 ${parsed.amount.toLocaleString('ru-RU')} ₸ — ${parsed.category}\n📅 ${parsed.date}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(() => null)
        await supabase.from('telegram_chat_history').delete().eq('chat_id', `pdf_expense_${sessionChatId}`)
        return json({ ok: true })
      }

      // ── PDF expense: cancel ──
      const pdfCancelMatch = callbackData.match(/^pdf_cancel_(\d+)$/)
      if (pdfCancelMatch && chatId) {
        await answerCallbackQuery(callbackQueryId, 'Отменено').catch(() => null)
        await callTelegram('editMessageText', { chat_id: String(chatId), message_id: messageId, text: '❌ Добавление отменено.', parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }).catch(() => null)
        await supabase.from('telegram_chat_history').delete().eq('chat_id', `pdf_expense_${pdfCancelMatch[1]}`)
        return json({ ok: true })
      }

      // Invoice confirm / cancel
      const invoiceMatch = callbackData.match(/^invoice:([0-9a-f-]+):(confirm|cancel)$/i)
      if (invoiceMatch) {
        const sessionId = invoiceMatch[1]
        const action = invoiceMatch[2]
        try {
          if (action === 'confirm') {
            await handleInvoiceConfirm(callbackQueryId, chatId ?? 0, messageId, telegramUserId, sessionId)
          } else {
            await handleInvoiceCancel(callbackQueryId, chatId ?? 0, messageId, telegramUserId, sessionId)
          }
        } catch (error: any) {
          if (chatId) await sendTelegramText(chatId, `❌ Ошибка: ${error?.message || 'Не удалось обработать запрос'}`).catch(() => null)
        }
        return json({ ok: true })
      }

      // Inventory request approve / reject
      const ireqMatch = callbackData.match(/^ireq:([0-9a-f-]+):(approve|reject)$/i)
      if (ireqMatch) {
        const requestId = ireqMatch[1]
        const action = ireqMatch[2]

        await answerCallbackQuery(callbackQueryId, 'Обрабатываю...').catch(() => null)

        try {
          // Verify user is owner/manager
          const botUser = await identifyBotUser(telegramUserId)
          if (!canUseFinance(botUser.role)) {
            await answerCallbackQuery(callbackQueryId, '⛔ Нет доступа', true)
            return json({ ok: true })
          }

          await decideInventoryRequest(supabase, {
            request_id: requestId,
            approved: action === 'approve',
            decision_comment: action === 'approve' ? 'Одобрено через Telegram' : 'Отклонено через Telegram',
            actor_user_id: null,
          })

          if (chatId && messageId) await clearCallbackButtons(chatId, messageId).catch(() => null)

          const resultText = action === 'approve'
            ? '✅ Заявка одобрена. Товар будет переведён на точку.'
            : '❌ Заявка отклонена.'

          if (chatId) await sendTelegramText(chatId, resultText)
        } catch (error: any) {
          if (chatId) await sendTelegramText(chatId, `❌ Ошибка: ${error?.message || 'Не удалось обработать заявку'}`).catch(() => null)
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

    // ── Photo messages ──
    if (update.message?.photo && update.message.chat?.id) {
      const chatId = update.message.chat.id
      const telegramUserId = String(update.message.from?.id || chatId)
      const messageId = update.message.message_id ?? 0
      const caption = (update.message.caption || '').toLowerCase()

      const botUser = await identifyBotUser(telegramUserId)
      if (!canUseFinance(botUser.role)) {
        await sendTelegramText(chatId, '⛔ Нет доступа.')
        return json({ ok: true })
      }

      const photos = update.message.photo
      const bestPhoto = photos[photos.length - 1]

      // If caption says "расход/чек/шығын" → expense receipt flow
      const isExpenseReceipt = /расход|чек|шығын|receipt|expense/i.test(caption)
      if (isExpenseReceipt) {
        const apiKey = process.env.OPENAI_API_KEY
        const botToken = process.env.TELEGRAM_BOT_TOKEN || ''
        if (!apiKey) { await sendTelegramText(chatId, '⚠️ OpenAI API не настроен.'); return json({ ok: true }) }

        const processingMsg = await callTelegram('sendMessage', { chat_id: String(chatId), text: '🧾 Читаю чек...', parse_mode: 'HTML' }).catch(() => null)
        const processingId = processingMsg?.result?.message_id ?? null
        const editMsg = async (text: string) => {
          if (processingId) await callTelegram('editMessageText', { chat_id: String(chatId), message_id: processingId, text, parse_mode: 'HTML' }).catch(() => sendTelegramText(chatId, text))
          else await sendTelegramText(chatId, text)
        }

        try {
          const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${bestPhoto.file_id}`)
          const fileData = await fileRes.json()
          const filePath = fileData?.result?.file_path
          if (!filePath) { await editMsg('❌ Не удалось скачать фото.'); return json({ ok: true }) }

          const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
          const imgBuffer = await imgRes.arrayBuffer()
          const base64 = Buffer.from(imgBuffer).toString('base64')
          const imageDataUrl = `data:image/jpeg;base64,${base64}`

          const today = todayISO()
          const parsed = await parseExpenseFromImage(imageDataUrl, apiKey, today)
          if (!parsed) { await editMsg('❌ Не удалось распознать чек. Попробуй другое фото.'); return json({ ok: true }) }

          const { data: companiesData } = await supabase.from('companies').select('id, name')
          const companiesList = (companiesData || []) as Array<{ id: string; name: string }>
          const session = { parsed, companies: companiesList, selectedCompanyId: companiesList[0]?.id || null }
          await supabase.from('telegram_chat_history').upsert({ chat_id: `pdf_expense_${chatId}`, history: [{ content: JSON.stringify(session) }], updated_at: new Date().toISOString() })

          const payMethod = parsed.payment_method === 'kaspi' ? 'Kaspi' : parsed.payment_method === 'card' ? 'Карта' : 'Наличные'
          const companyButtons = companiesList.map((c) => [{ text: (c.id === session.selectedCompanyId ? '✅ ' : '') + c.name, callback_data: `pdf_company_${chatId}_${c.id}` }])
          const confirmText = [`🧾 <b>Распознан чек</b>`, ``, `💰 Сумма: <b>${parsed.amount.toLocaleString('ru-RU')} ₸</b>`, `📁 Категория: <b>${parsed.category}</b>`, `📅 Дата: <b>${parsed.date}</b>`, `💳 Оплата: <b>${payMethod}</b>`, parsed.vendor ? `🏪 ${parsed.vendor}` : '', parsed.comment ? `📝 ${parsed.comment}` : '', ``, `Выбери точку:`].filter(Boolean).join('\n')
          await callTelegram('editMessageText', { chat_id: String(chatId), message_id: processingId, text: confirmText, parse_mode: 'HTML', reply_markup: { inline_keyboard: [...companyButtons, [{ text: '✅ Добавить в расходы', callback_data: `pdf_confirm_${chatId}` }, { text: '❌ Отмена', callback_data: `pdf_cancel_${chatId}` }]] } }).catch(() => null)
        } catch (e: any) {
          await editMsg(`❌ Ошибка: ${e?.message || 'Неизвестная ошибка'}`)
        }
        return json({ ok: true })
      }

      // Default: invoice scanning
      try {
        await handleInvoicePhoto(Number(chatId), messageId, telegramUserId, bestPhoto.file_id)
      } catch (error: any) {
        await sendTelegramText(chatId, `❌ Ошибка при обработке накладной: ${error?.message || 'Неизвестная ошибка'}`).catch(() => null)
      }
      return json({ ok: true })
    }

    // ── PDF document → expense receipt parser ──
    if (update.message?.document && update.message.chat?.id) {
      const doc = update.message.document
      if (doc.mime_type === 'application/pdf') {
        const chatId = update.message.chat.id
        const messageId = update.message.message_id ?? 0
        const telegramUserId = String(update.message.from?.id || chatId)

        // Deduplication: skip if already processed this message
        const dedupKey = `pdf_dedup_${chatId}_${messageId}`
        const { data: dedupRow } = await supabase.from('telegram_chat_history').select('chat_id').eq('chat_id', dedupKey).maybeSingle()
        if (dedupRow) return json({ ok: true }) // already handled
        await supabase.from('telegram_chat_history').upsert({ chat_id: dedupKey, history: [], updated_at: new Date().toISOString() })

        const botUser = await identifyBotUser(telegramUserId)

        if (!canUseFinance(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Добавление расходов доступно только администраторам.')
          return json({ ok: true })
        }

        const apiKey = process.env.OPENAI_API_KEY
        const botToken = process.env.TELEGRAM_BOT_TOKEN || ''
        if (!apiKey) { await sendTelegramText(chatId, '⚠️ OpenAI API не настроен.'); return json({ ok: true }) }

        await sendTelegramText(chatId, '📷 PDF не поддерживается.\n\nОтправь <b>фото чека</b> с подписью <code>расход</code> — GPT-4o распознает любой чек.')
        return json({ ok: true })
      }
    }

    // ── Voice messages (Whisper transcription → AI chat) ──
    if (update.message?.voice && update.message.chat?.id) {
      const chatId = update.message.chat.id
      const telegramUserId = String(update.message.from?.id || chatId)
      const botUser = await identifyBotUser(telegramUserId)

      if (!canUseFinance(botUser.role)) {
        await sendTelegramText(chatId, '⛔ Голосовые сообщения доступны только администраторам.')
        return json({ ok: true })
      }

      const apiKey = process.env.OPENAI_API_KEY
      const botToken = process.env.TELEGRAM_BOT_TOKEN || ''
      if (!apiKey) { await sendTelegramText(chatId, '⚠️ OpenAI API не настроен.'); return json({ ok: true }) }

      const duration = update.message.voice.duration || 0
      const thinkingMsg = await callTelegram('sendMessage', {
        chat_id: String(chatId),
        text: `🎤 Распознаю голос${duration > 30 ? ` (${duration}с, может занять немного)` : ''}...`,
        parse_mode: 'HTML',
      }).catch(() => null)
      const thinkingId = thinkingMsg?.result?.message_id ?? null

      const result = await transcribeVoice(update.message.voice.file_id, botToken, apiKey)
      if (!result) {
        const err = '❌ Не удалось распознать голосовое сообщение.'
        if (thinkingId) await callTelegram('editMessageText', { chat_id: String(chatId), message_id: thinkingId, text: err, parse_mode: 'HTML' }).catch(() => sendTelegramText(chatId, err))
        else await sendTelegramText(chatId, err)
        return json({ ok: true })
      }

      const { text: transcript, language } = result
      const langEmoji = langLabel(language)
      const durationStr = duration > 0 ? ` · ${duration}с` : ''

      // Beautiful transcription display
      const transcriptDisplay = `${langEmoji} <i>"${transcript}"</i>\n<code>${durationStr.trim()}</code>`
      if (thinkingId) await callTelegram('editMessageText', { chat_id: String(chatId), message_id: thinkingId, text: transcriptDisplay, parse_mode: 'HTML' }).catch(() => null)
      else await sendTelegramText(chatId, transcriptDisplay)

      // Process through AI and get reply
      await handleAIChat(Number(chatId), String(chatId), transcript, supabase, async (aiReply: string) => {
        // Send voice reply back after text reply
        await sendVoiceReply(Number(chatId), aiReply, apiKey, botToken)
      }, botUser)
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

      if (cmd === '/compare') {
        if (!canUseFinance(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Нет доступа к финансовым командам.')
          return json({ ok: true })
        }
        await handleCompare(Number(chatId))
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

      // /report — детальный недельный отчёт для владельца
      if (cmd === '/report' || cmd === '/weekly') {
        if (!canUseFinance(botUser.role)) {
          await sendTelegramText(chatId, '⛔ Нет доступа.')
          return json({ ok: true })
        }
        await handleDetailedReport(Number(chatId))
        return json({ ok: true })
      }

      // /reset — очистить историю AI диалога
      if (cmd === '/reset') {
        await supabase.from('telegram_chat_history').delete().eq('chat_id', String(chatId))
        await sendTelegramText(chatId, '🔄 История диалога очищена. Начинаем с чистого листа.')
        return json({ ok: true })
      }

      // AI-чат для владельца/менеджера/администратора
      if (canUseFinance(botUser.role)) {
        await handleAIChat(Number(chatId), String(chatId), text, supabase, undefined, botUser)
        return json({ ok: true })
      }

      // AI-чат для операторов (только про себя: зарплата, смены, достижения)
      if (botUser.role === 'operator') {
        await handleAIChat(Number(chatId), String(chatId), text, supabase, undefined, botUser)
        return json({ ok: true })
      }

      // Fallback для остальных
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
