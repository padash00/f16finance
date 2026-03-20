import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { loadShiftWeekWorkflow, publishShiftWeekForCompany, resolveShiftChangeRequest } from '@/lib/server/shift-workflow'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type ShiftWritePayload = {
  shiftId?: string | null
  companyId: string
  date: string
  shiftType: 'day' | 'night'
  operatorName: string
  comment?: string | null
}

type ShiftMutationBody =
  | {
      action: 'saveShift'
      payload: ShiftWritePayload
    }
  | {
      action: 'bulkAssignWeek'
      payload: {
        companyId: string
        operatorName: string
        shiftType: 'day' | 'night'
        dates: string[]
      }
    }
  | {
      action: 'copyWeekTemplate'
      payload: {
        targetWeekStart: string
      }
    }
  | {
      action: 'publishWeek'
      payload: {
        companyId: string
        weekStart: string
      }
    }
  | {
      action: 'resolveIssue'
      payload: {
        requestId: string
        status: 'resolved' | 'dismissed'
        resolutionAction?: 'keep' | 'remove' | 'replace'
        replacementOperatorName?: string | null
        resolutionNote?: string | null
      }
    }

type ShiftRow = {
  id: string
  company_id: string
  date: string
  shift_type: 'day' | 'night'
  operator_name: string
  comment?: string | null
}

type OperatorMatch = {
  id: string
  name: string
  full_name?: string | null
  short_name: string | null
  operator_profiles?: { full_name?: string | null }[] | null
  telegram_chat_id: string | null
}

type ShiftChangeRequestRow = {
  id: string
  publication_id: string
  company_id: string
  operator_id: string
  shift_date: string
  shift_type: 'day' | 'night'
  status: string
  reason: string | null
}

class RouteError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, (month || 1) - 1, day || 1))
  utcDate.setUTCDate(utcDate.getUTCDate() + days)
  return utcDate.toISOString().slice(0, 10)
}

function normalizeOperatorName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function formatShiftType(shiftType: 'day' | 'night') {
  return shiftType === 'day' ? 'дневную смену' : 'ночную смену'
}

function formatShiftDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

async function findOperatorForShiftName(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  operatorName: string,
) {
  const normalizedTarget = normalizeOperatorName(operatorName)
  if (!normalizedTarget) return null

  const { data, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('is_active', true)

  if (error) throw error

  return ((data || []) as OperatorMatch[]).find((operator) => {
    return (
      normalizeOperatorName(getOperatorDisplayName(operator, '')) === normalizedTarget ||
      normalizeOperatorName(operator.name) === normalizedTarget ||
      normalizeOperatorName(operator.short_name) === normalizedTarget
    )
  }) || null
}

async function getCompanyNameById(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  companyId: string,
) {
  const { data, error } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  return data?.name || 'точку'
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: 'true',
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Telegram не принял сообщение')
  }
}

async function notifySingleShiftAssignment(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  payload: ShiftWritePayload,
) {
  const trimmedName = payload.operatorName.trim()
  if (!trimmedName) return { sent: false, reason: 'empty-operator' as const }

  const operator = await findOperatorForShiftName(supabase, trimmedName)
  if (!operator?.telegram_chat_id) {
    return { sent: false, reason: 'telegram-missing' as const }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { sent: false, reason: 'token-missing' as const }
  }

  const companyName = await getCompanyNameById(supabase, payload.companyId)
  const text =
    `<b>Вам назначена новая смена</b>\n\n` +
    `<b>Точка:</b> ${companyName}\n` +
    `<b>Дата:</b> ${formatShiftDate(payload.date)}\n` +
    `<b>Смена:</b> ${formatShiftType(payload.shiftType)}\n\n` +
    `Проверьте график в кабинете и заранее подтвердите, что вы видели это назначение.`

  await sendTelegramMessage(String(operator.telegram_chat_id), text)
  return { sent: true as const, operatorLabel: getOperatorDisplayName(operator, 'Оператор') }
}

async function notifyBulkShiftAssignment(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  payload: {
    companyId: string
    operatorName: string
    shiftType: 'day' | 'night'
    dates: string[]
  },
) {
  const trimmedName = payload.operatorName.trim()
  if (!trimmedName || payload.dates.length === 0) return { sent: false, reason: 'empty-payload' as const }

  const operator = await findOperatorForShiftName(supabase, trimmedName)
  if (!operator?.telegram_chat_id) {
    return { sent: false, reason: 'telegram-missing' as const }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { sent: false, reason: 'token-missing' as const }
  }

  const sortedDates = [...payload.dates].sort()
  const companyName = await getCompanyNameById(supabase, payload.companyId)
  const periodStart = formatShiftDate(sortedDates[0])
  const periodEnd = formatShiftDate(sortedDates[sortedDates.length - 1])
  const dateList = sortedDates.map((date) => `• ${formatShiftDate(date)}`).join('\n')
  const text =
    `<b>График смен обновлен</b>\n\n` +
    `<b>Точка:</b> ${companyName}\n` +
    `<b>Период:</b> ${periodStart} — ${periodEnd}\n` +
    `<b>Тип смены:</b> ${formatShiftType(payload.shiftType)}\n\n` +
    `<b>Ваши даты выхода:</b>\n${dateList}\n\n` +
    `Если одна из дат вам не подходит, предупредите руководителя заранее.`

  await sendTelegramMessage(String(operator.telegram_chat_id), text)
  return {
    sent: true as const,
    operatorLabel: getOperatorDisplayName(operator, 'Оператор'),
    count: sortedDates.length,
  }
}

async function getExistingShiftForSlot(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  companyId: string,
  date: string,
  shiftType: 'day' | 'night',
) {
  const { data, error } = await supabase
    .from('shifts')
    .select('id')
    .eq('company_id', companyId)
    .eq('date', date)
    .eq('shift_type', shiftType)
    .maybeSingle()

  if (error) throw error
  return data
}

async function getShiftForSlot(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  companyId: string,
  date: string,
  shiftType: 'day' | 'night',
) {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, company_id, date, shift_type, operator_name, comment')
    .eq('company_id', companyId)
    .eq('date', date)
    .eq('shift_type', shiftType)
    .maybeSingle()

  if (error) throw error
  return (data || null) as ShiftRow | null
}

async function getOperatorById(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  operatorId: string,
) {
  const { data, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', operatorId)
    .maybeSingle()

  if (error) throw error
  return (data || null) as OperatorMatch | null
}

async function ensureNoOperatorConflict(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  payload: ShiftWritePayload,
  ignoredShiftIds: string[],
) {
  const trimmedName = payload.operatorName.trim()
  if (!trimmedName) return

  let query = supabase
    .from('shifts')
    .select('id, company_id, shift_type')
    .eq('date', payload.date)
    .ilike('operator_name', trimmedName)

  for (const ignoredShiftId of ignoredShiftIds.filter(Boolean)) {
    query = query.neq('id', ignoredShiftId)
  }

  const { data, error } = await query.limit(1)
  if (error) throw error

  const conflict = data?.[0]
  if (conflict) {
    throw new RouteError(
      `Оператор "${trimmedName}" уже назначен на ${payload.date}. Сначала убери его из другой смены в этот день.`,
      409,
    )
  }
}

async function upsertShift(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  payload: ShiftWritePayload,
) {
  const { shiftId, companyId, date, shiftType, operatorName, comment } = payload
  if (!companyId || !date || !shiftType) {
    throw new Error('companyId, date и shiftType обязательны')
  }

  const trimmedName = operatorName.trim()
  const existingForSlot = await getExistingShiftForSlot(supabase, companyId, date, shiftType)
  const ignoredShiftIds = [shiftId || '', existingForSlot?.id || '']

  if (shiftId && !trimmedName) {
    const { error } = await supabase.from('shifts').delete().eq('id', shiftId)
    if (error) throw error
    return { ok: true, mode: 'deleted' as const }
  }

  await ensureNoOperatorConflict(supabase, payload, ignoredShiftIds)

  if (shiftId && trimmedName) {
    const { error } = await supabase
      .from('shifts')
      .update({
        operator_name: trimmedName,
        comment: comment?.trim() || null,
      })
      .eq('id', shiftId)

    if (error) throw error
    return { ok: true, mode: 'updated' as const }
  }

  if (!trimmedName) {
    return { ok: true, mode: 'noop' as const }
  }

  if (existingForSlot?.id) {
    const { error } = await supabase
      .from('shifts')
      .update({
          operator_name: trimmedName,
          comment: comment?.trim() || null,
        })
        .eq('id', existingForSlot.id)

      if (error) throw error
      return { ok: true, mode: 'updated-existing' as const }
    }

  const { error } = await supabase.from('shifts').insert({
    company_id: companyId,
    date,
    shift_type: shiftType,
    operator_name: trimmedName,
    cash_amount: 0,
    kaspi_amount: 0,
    card_amount: 0,
    debt_amount: 0,
    comment: comment?.trim() || null,
  })

  if (error) throw error

  return { ok: true, mode: 'created' as const }
}

async function applyShiftIssueResolution(
  supabase: ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>,
  params: {
    requestId: string
    status: 'resolved' | 'dismissed'
    resolutionAction: 'keep' | 'remove' | 'replace'
    replacementOperatorName?: string | null
    resolutionNote?: string | null
    actorUserId?: string | null
  },
) {
  const { data: request, error: requestError } = await supabase
    .from('shift_change_requests')
    .select('id, publication_id, company_id, operator_id, shift_date, shift_type, status, reason')
    .eq('id', params.requestId)
    .maybeSingle()

  if (requestError) throw requestError
  if (!request) {
    throw new Error('Запрос на изменение смены не найден')
  }

  const requestRow = request as ShiftChangeRequestRow
  const requester = await getOperatorById(supabase, requestRow.operator_id)
  const companyName = await getCompanyNameById(supabase, requestRow.company_id)
  const currentShift = await getShiftForSlot(supabase, requestRow.company_id, requestRow.shift_date, requestRow.shift_type)

  let effectiveAction = params.resolutionAction
  let effectiveNote = params.resolutionNote?.trim() || ''
  let replacementLabel: string | null = null
  let replacementOperator: OperatorMatch | null = null

  if (params.status === 'resolved') {
    if (params.resolutionAction === 'remove') {
      if (currentShift?.id) {
        const { error } = await supabase.from('shifts').delete().eq('id', currentShift.id)
        if (error) throw error
      }

      if (!effectiveNote) {
        effectiveNote = `Оператор снят со смены ${formatShiftDate(requestRow.shift_date)} (${requestRow.shift_type === 'day' ? 'день' : 'ночь'}).`
      }
    }

    if (params.resolutionAction === 'replace') {
      const nextName = params.replacementOperatorName?.trim()
      if (!nextName) {
        throw new Error('Для замены выбери нового оператора')
      }

      replacementOperator = await findOperatorForShiftName(supabase, nextName)
      if (!replacementOperator) {
        throw new Error('Не удалось найти выбранного оператора для замены')
      }

      replacementLabel = getOperatorDisplayName(replacementOperator, nextName)
      await upsertShift(supabase, {
        shiftId: currentShift?.id || null,
        companyId: requestRow.company_id,
        date: requestRow.shift_date,
        shiftType: requestRow.shift_type,
        operatorName: replacementLabel,
        comment: currentShift?.comment || null,
      })

      if (!effectiveNote) {
        effectiveNote = `На смену назначен ${replacementLabel} вместо прежнего оператора.`
      }
    }

    if (params.resolutionAction === 'keep') {
      if (!effectiveNote) {
        effectiveNote = 'График оставлен без изменений после рассмотрения запроса.'
      }
    }
  } else {
    effectiveAction = 'keep'
    if (!effectiveNote) {
      effectiveNote = 'Запрос закрыт без изменения графика.'
    }
  }

  const resolvedRequest = await resolveShiftChangeRequest({
    supabase,
    requestId: params.requestId,
    status: params.status,
    resolutionNote: effectiveNote,
    actorUserId: params.actorUserId || null,
  })

  const shiftLabel = `${formatShiftDate(requestRow.shift_date)} (${requestRow.shift_type === 'day' ? 'день' : 'ночь'})`

  if (requester?.telegram_chat_id && process.env.TELEGRAM_BOT_TOKEN) {
    const requesterText =
      params.status === 'resolved'
        ? `<b>Запрос по смене обработан</b>\n\n<b>Точка:</b> ${companyName}\n<b>Дата:</b> ${shiftLabel}\n<b>Решение:</b> ${effectiveNote}`
        : `<b>Запрос по смене закрыт</b>\n\n<b>Точка:</b> ${companyName}\n<b>Дата:</b> ${shiftLabel}\n<b>Комментарий:</b> ${effectiveNote}`

    try {
      await sendTelegramMessage(String(requester.telegram_chat_id), requesterText)
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: String(requester.telegram_chat_id),
        status: 'sent',
        payload: {
          kind: 'shift-request-resolution',
          request_id: params.requestId,
          operator_id: requester.id,
          operator_name: getOperatorDisplayName(requester, 'Оператор'),
          action: effectiveAction,
          status: params.status,
          resolution_note: effectiveNote,
        },
      })
    } catch (error) {
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: String(requester.telegram_chat_id),
        status: 'failed',
        payload: {
          kind: 'shift-request-resolution',
          request_id: params.requestId,
          operator_id: requester.id,
          operator_name: getOperatorDisplayName(requester, 'Оператор'),
          action: effectiveAction,
          status: params.status,
          resolution_note: effectiveNote,
          error: error instanceof Error ? error.message : 'telegram-send-failed',
        },
      })
    }
  }

  if (
    params.status === 'resolved' &&
    effectiveAction === 'replace' &&
    replacementOperator?.telegram_chat_id &&
    process.env.TELEGRAM_BOT_TOKEN
  ) {
    try {
      await sendTelegramMessage(
        String(replacementOperator.telegram_chat_id),
        `<b>Вам назначена смена после замены</b>\n\n<b>Точка:</b> ${companyName}\n<b>Дата:</b> ${shiftLabel}\nПроверьте обновлённый график.`,
      )
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: String(replacementOperator.telegram_chat_id),
        status: 'sent',
        payload: {
          kind: 'shift-reassignment',
          request_id: params.requestId,
          operator_id: replacementOperator.id,
          operator_name: replacementLabel,
          company_id: requestRow.company_id,
          shift_date: requestRow.shift_date,
          shift_type: requestRow.shift_type,
        },
      })
    } catch (error) {
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: String(replacementOperator.telegram_chat_id),
        status: 'failed',
        payload: {
          kind: 'shift-reassignment',
          request_id: params.requestId,
          operator_id: replacementOperator.id,
          operator_name: replacementLabel,
          company_id: requestRow.company_id,
          shift_date: requestRow.shift_date,
          shift_type: requestRow.shift_type,
          error: error instanceof Error ? error.message : 'telegram-send-failed',
        },
      })
    }
  }

  return {
    request: resolvedRequest,
    action: effectiveAction,
    resolutionNote: effectiveNote,
    replacementOperatorName: replacementLabel,
  }
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'shifts')
    if (guard) return guard

    const body = (await req.json().catch(() => null)) as ShiftMutationBody | null
    if (!body) {
      return badRequest('Неверный формат запроса')
    }

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : requestClient

    if (body.action === 'saveShift') {
      const result = await upsertShift(supabase, body.payload)

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'shift',
        entityId: `${body.payload.companyId}:${body.payload.date}:${body.payload.shiftType}`,
        action: result.mode,
        payload: {
          company_id: body.payload.companyId,
          date: body.payload.date,
          shift_type: body.payload.shiftType,
          operator_name: body.payload.operatorName.trim() || null,
          publication_required: !!body.payload.operatorName.trim(),
        },
      })

      return NextResponse.json({ ...result })
    }

    if (body.action === 'bulkAssignWeek') {
      const { companyId, operatorName, shiftType, dates } = body.payload
      if (!companyId || !operatorName?.trim() || !shiftType || !Array.isArray(dates) || dates.length === 0) {
        return badRequest('companyId, operatorName, shiftType и dates обязательны')
      }

      let created = 0
      let updated = 0
      let skipped = 0
      const conflicts: string[] = []
      const assignedDates: string[] = []

      for (const date of dates) {
        try {
          const result = await upsertShift(supabase, {
            companyId,
            date,
            shiftType,
            operatorName,
          })

          if (result.mode === 'created') created += 1
          else if (result.mode === 'updated' || result.mode === 'updated-existing') updated += 1
          else skipped += 1

          if (result.mode === 'created' || result.mode === 'updated' || result.mode === 'updated-existing') {
            assignedDates.push(date)
          }
        } catch (error) {
          if (error instanceof RouteError && error.status === 409) {
            conflicts.push(`${date}: ${error.message}`)
            skipped += 1
            continue
          }

          throw error
        }
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'shift',
        entityId: `${companyId}:${shiftType}:${dates[0] || 'bulk'}`,
        action: 'bulk-assign-week',
        payload: {
          company_id: companyId,
          operator_name: operatorName.trim(),
          shift_type: shiftType,
          dates,
          created,
          updated,
          skipped,
          conflicts,
          publication_required: assignedDates.length > 0,
        },
      })

      return NextResponse.json({
        ok: true,
        mode: 'bulk-assigned-week',
        created,
        updated,
        skipped,
        conflicts,
      })
    }

    if (body.action === 'copyWeekTemplate') {
      const { targetWeekStart } = body.payload
      if (!targetWeekStart) {
        return badRequest('targetWeekStart обязателен')
      }

      const sourceWeekStart = shiftIsoDate(targetWeekStart, -7)
      const sourceWeekEnd = shiftIsoDate(targetWeekStart, -1)
      const targetWeekEnd = shiftIsoDate(targetWeekStart, 6)

      const { data: sourceShifts, error: sourceError } = await supabase
        .from('shifts')
        .select('id, company_id, date, shift_type, operator_name, comment')
        .gte('date', sourceWeekStart)
        .lte('date', sourceWeekEnd)
        .order('date')

      if (sourceError) throw sourceError

      const { data: targetShifts, error: targetError } = await supabase
        .from('shifts')
        .select('id, company_id, date, shift_type, operator_name, comment')
        .gte('date', targetWeekStart)
        .lte('date', targetWeekEnd)

      if (targetError) throw targetError

      const targetMap = new Map<string, ShiftRow>()
      for (const shift of (targetShifts || []) as ShiftRow[]) {
        targetMap.set(`${shift.company_id}|${shift.date}|${shift.shift_type}`, shift)
      }

      let created = 0
      let updated = 0
      let skipped = 0
      const conflicts: string[] = []

      for (const shift of (sourceShifts || []) as ShiftRow[]) {
        const targetDate = shiftIsoDate(shift.date, 7)
        const key = `${shift.company_id}|${targetDate}|${shift.shift_type}`
        const existing = targetMap.get(key)

        if (existing?.operator_name?.trim()) {
          skipped += 1
          continue
        }

        let result: Awaited<ReturnType<typeof upsertShift>>
        try {
          result = await upsertShift(supabase, {
            shiftId: existing?.id || null,
            companyId: shift.company_id,
            date: targetDate,
            shiftType: shift.shift_type,
            operatorName: shift.operator_name,
            comment: shift.comment || null,
          })
        } catch (error) {
          if (error instanceof RouteError && error.status === 409) {
            conflicts.push(`${targetDate}: ${error.message}`)
            skipped += 1
            continue
          }

          throw error
        }

        if (result.mode === 'created') {
          created += 1
        } else if (result.mode === 'updated' || result.mode === 'updated-existing') {
          updated += 1
        } else {
          skipped += 1
        }
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'shift',
        entityId: `${targetWeekStart}:copy-week-template`,
        action: 'copy-week-template',
        payload: {
          sourceWeekStart,
          targetWeekStart,
          created,
          updated,
          skipped,
          conflicts,
        },
      })

      return NextResponse.json({
        ok: true,
        mode: 'copied-week-template',
        created,
        updated,
        skipped,
        conflicts,
        sourceWeekStart,
        targetWeekStart,
      })
    }

    if (body.action === 'publishWeek') {
      const { companyId, weekStart } = body.payload
      if (!companyId || !weekStart) {
        return badRequest('companyId и weekStart обязательны')
      }

      const result = await publishShiftWeekForCompany({
        supabase,
        companyId,
        weekStart,
        actorUserId: user?.id || null,
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'shift-publication',
        entityId: result.publication.id,
        action: 'publish-week',
        payload: {
          company_id: companyId,
          week_start: weekStart,
          week_end: result.weekEnd,
          delivered: result.delivered,
          missing_telegram: result.missingTelegram,
          failed: result.failed,
          total_operators: result.totalOperators,
          version: result.publication.version,
          delivery_details: result.deliveryDetails,
        },
      })

      return NextResponse.json({
        ok: true,
        mode: 'published-week',
        publication: result.publication,
        companyName: result.companyName,
        delivered: result.delivered,
        missingTelegram: result.missingTelegram,
        failed: result.failed,
        totalOperators: result.totalOperators,
        deliveryDetails: result.deliveryDetails,
      })
    }

    if (body.action === 'resolveIssue') {
      const {
        requestId,
        status,
        resolutionAction = status === 'dismissed' ? 'keep' : 'keep',
        replacementOperatorName,
        resolutionNote,
      } = body.payload
      if (!requestId || !status) {
        return badRequest('requestId и status обязательны')
      }

      const result = await applyShiftIssueResolution(supabase, {
        requestId,
        status,
        resolutionAction,
        replacementOperatorName,
        resolutionNote,
        actorUserId: user?.id || null,
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'shift-change-request',
        entityId: requestId,
        action: status,
        payload: {
          resolution_action: result.action,
          resolution_note: result.resolutionNote,
          replacement_operator_name: result.replacementOperatorName,
        },
      })

      return NextResponse.json({ ok: true, data: result })
    }

    return badRequest('Неизвестное действие')
  } catch (error: any) {
    console.error('Admin shifts mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/shifts',
      message: error?.message || 'Admin shifts mutation error',
    })
    const rawMessage =
      error?.message ||
      error?.details ||
      error?.hint ||
      'Ошибка при сохранении смены'

    const message = String(rawMessage).includes('row-level security policy')
      ? 'У текущего пользователя нет прав на запись в shifts. Нужно применить SQL-миграцию RLS для shifts.'
      : rawMessage

    return NextResponse.json(
      {
        error: message,
      },
      { status: error instanceof RouteError ? error.status : 500 },
    )
  }
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'shifts')
    if (guard) return guard

    const url = new URL(req.url)
    const weekStart = url.searchParams.get('weekStart')?.trim()
    if (!weekStart) {
      return badRequest('weekStart обязателен')
    }

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const workflow = await loadShiftWeekWorkflow(supabase, weekStart)

    return NextResponse.json({ ok: true, ...workflow })
  } catch (error: any) {
    console.error('Admin shifts workflow GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/shifts:get',
      message: error?.message || 'Admin shifts workflow GET error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
