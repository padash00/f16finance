import 'server-only'

import { addDaysISO, mondayOfISO } from '@/lib/core/date'
import { escapeHtml, formatMoney } from '@/lib/core/format'
import { calculateOperatorSalarySummary } from '@/lib/domain/salary'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import type { AdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegram } from '@/lib/server/telegram'

export async function getOperatorSalarySnapshot(
  supabase: AdminSupabaseClient,
  params: {
    operatorId: string
    dateFrom: string
    dateTo: string
    weekStart?: string
    companyCode?: string
  },
) {
  const normalizedWeekStart = mondayOfISO(params.weekStart || params.dateFrom)
  const [reference, payload] = await Promise.all([
    listSalaryReferenceData(supabase),
    listOperatorSalaryData(supabase, {
      operatorId: params.operatorId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      weekStart: normalizedWeekStart,
      companyCode: params.companyCode,
    }),
  ])

  const summary = calculateOperatorSalarySummary({
    operatorId: params.operatorId,
    companies: reference.companies,
    rules: reference.rules,
    assignments: reference.assignments,
    incomes: payload.incomes,
    adjustments: payload.adjustments,
    debts: payload.debts,
    options: params.companyCode ? { companyCodes: [params.companyCode] } : undefined,
  })

  return {
    ...summary,
    weekStart: normalizedWeekStart,
    weekEnd: addDaysISO(normalizedWeekStart, 6),
  }
}

export function buildSalaryTelegramMessage(params: {
  operatorName: string
  dateFrom: string
  dateTo: string
  weekStart: string
  weekEnd: string
  summary: Awaited<ReturnType<typeof getOperatorSalarySnapshot>>
  lastItem?: {
    name: string
    qty: number
    total: number
    pointName?: string | null
    companyName?: string | null
  } | null
}): string {
  const { operatorName, dateFrom, dateTo, weekStart, weekEnd, summary, lastItem } = params

  let text = `<b>💰 Зарплата · сводка</b>\n\n`
  text += `👤 <b>${escapeHtml(operatorName)}</b>\n`
  text += `📆 Период: <code>${escapeHtml(`${dateFrom} — ${dateTo}`)}</code>\n`
  text += `🗓 Неделя (пн-вс): <code>${escapeHtml(`${weekStart} — ${weekEnd}`)}</code>\n\n`

  if (lastItem?.name) {
    text += `🛒 Сегодня в долг: <b>${escapeHtml(lastItem.name)}</b> x${lastItem.qty} = <b>${formatMoney(lastItem.total)}</b>\n`
    if (lastItem.pointName || lastItem.companyName) {
      text += `📍 Где: <b>${escapeHtml(lastItem.pointName || lastItem.companyName || '')}</b>\n`
    }
    text += '\n'
  }

  text += `📌 Смен: <b>${summary.shifts}</b>\n`
  text += `💼 База: <b>${formatMoney(summary.baseSalary)}</b>\n`
  text += `✅ Авто-бонусы: <b>${formatMoney(summary.autoBonuses)}</b>\n`
  if (summary.roleBonuses > 0) text += `⭐ Надбавка за роль: <b>${formatMoney(summary.roleBonuses)}</b>\n`
  if (summary.autoDebts > 0) text += `🧾 Долги недели: <b>${formatMoney(summary.autoDebts)}</b>\n`
  if (summary.totalFines > 0) text += `➖ Штрафы: <b>${formatMoney(summary.totalFines)}</b>\n`
  if (summary.advances > 0) text += `💸 Авансы: <b>${formatMoney(summary.advances)}</b>\n`
  if (summary.manualPlus > 0) text += `🎁 Премии: <b>${formatMoney(summary.manualPlus)}</b>\n`
  text += `\n💰 <b>К выплате: ${formatMoney(summary.remainingAmount)}</b>`

  return text
}

export async function sendOperatorDebtTelegramSnapshot(
  supabase: AdminSupabaseClient,
  params: {
    operatorId: string
    operatorName: string
    operatorChatId: string | null
    weekStart: string
    lastItem: {
      name: string
      qty: number
      total: number
      pointName?: string | null
      companyName?: string | null
    }
  },
) {
  if (!params.operatorChatId) {
    return { sent: false as const, reason: 'telegram-missing' }
  }

  const snapshot = await getOperatorSalarySnapshot(supabase, {
    operatorId: params.operatorId,
    dateFrom: params.weekStart,
    dateTo: addDaysISO(params.weekStart, 6),
    weekStart: params.weekStart,
  })

  const text = buildSalaryTelegramMessage({
    operatorName: params.operatorName,
    dateFrom: params.weekStart,
    dateTo: addDaysISO(params.weekStart, 6),
    weekStart: snapshot.weekStart,
    weekEnd: snapshot.weekEnd,
    summary: snapshot,
    lastItem: params.lastItem,
  })

  await sendTelegram(text, params.operatorChatId)
  return { sent: true as const }
}
