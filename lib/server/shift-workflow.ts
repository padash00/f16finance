import 'server-only'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeNotificationLog } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { escapeTelegramHtml, ordaTelegramFrame } from '@/lib/telegram/message-kit'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type DbClient = ReturnType<typeof createAdminSupabaseClient> | any
type ShiftType = 'day' | 'night'

type ShiftRow = {
  id: string
  company_id: string
  date: string
  shift_type: ShiftType
  operator_name: string
  comment?: string | null
}

type OperatorRow = {
  id: string
  name: string
  short_name: string | null
  telegram_chat_id: string | null
  operator_profiles?: { full_name?: string | null }[] | null
}

type PublicationRow = {
  id: string
  company_id: string
  week_start: string
  week_end: string
  version: number
  status: string
  note: string | null
  published_at: string
}

export type WorkflowPublication = PublicationRow & {
  company_name: string
  pending_count: number
  confirmed_count: number
  issue_count: number
  total_count: number
}

export type WorkflowResponse = {
  id: string
  publication_id: string
  company_id: string
  operator_id: string
  operator_name: string
  status: string
  response_source: string | null
  note: string | null
  responded_at: string | null
  created_at: string
}

export type WorkflowRequest = {
  id: string
  publication_id: string
  company_id: string
  operator_id: string
  operator_name: string
  shift_date: string
  shift_type: ShiftType
  status: string
  source: string | null
  reason: string | null
  lead_status: string | null
  lead_action: string | null
  lead_note: string | null
  lead_operator_id: string | null
  lead_operator_name: string | null
  lead_replacement_operator_id: string | null
  lead_replacement_operator_name: string | null
  lead_updated_at: string | null
  resolution_note: string | null
  responded_at: string | null
  resolved_at: string | null
  created_at: string
}

export function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, (month || 1) - 1, day || 1))
  utcDate.setUTCDate(utcDate.getUTCDate() + days)
  return utcDate.toISOString().slice(0, 10)
}

function normalizeOperatorName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function formatShiftType(shiftType: ShiftType) {
  return shiftType === 'day' ? 'День' : 'Ночь'
}

function formatShiftDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

function compactShiftDate(isoDate: string) {
  return isoDate.replaceAll('-', '').slice(2)
}

function expandShiftDate(compactDate: string) {
  if (!/^\d{6}$/.test(compactDate)) {
    throw new Error('Некорректная дата смены')
  }

  return `20${compactDate.slice(0, 2)}-${compactDate.slice(2, 4)}-${compactDate.slice(4, 6)}`
}

async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: ordaTelegramFrame(text),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Telegram не принял сообщение')
  }

  return payload
}

export async function findOperatorForShiftName(supabase: DbClient, operatorName: string) {
  const normalizedTarget = normalizeOperatorName(operatorName)
  if (!normalizedTarget) return null

  const { data, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('is_active', true)

  if (error) throw error

  return ((data || []) as OperatorRow[]).find((operator) => {
    return (
      normalizeOperatorName(getOperatorDisplayName(operator, '')) === normalizedTarget ||
      normalizeOperatorName(operator.name) === normalizedTarget ||
      normalizeOperatorName(operator.short_name) === normalizedTarget
    )
  }) || null
}

async function getActiveOperators(supabase: DbClient) {
  const { data, error } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('is_active', true)

  if (error) throw error
  return (data || []) as OperatorRow[]
}

export async function getCompanyNameById(supabase: DbClient, companyId: string) {
  const { data, error } = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle()
  if (error) throw error
  return data?.name || 'точку'
}

async function getWeekShiftsForCompany(supabase: DbClient, companyId: string, weekStart: string, weekEnd: string) {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, company_id, date, shift_type, operator_name, comment')
    .eq('company_id', companyId)
    .gte('date', weekStart)
    .lte('date', weekEnd)
    .order('date')

  if (error) throw error
  return (data || []) as ShiftRow[]
}

function getOperatorAssignmentsFromShifts(shifts: ShiftRow[], operator: OperatorRow) {
  const displayName = normalizeOperatorName(getOperatorDisplayName(operator, ''))
  const rawName = normalizeOperatorName(operator.name)
  const shortName = normalizeOperatorName(operator.short_name)

  return shifts.filter((shift) => {
    const current = normalizeOperatorName(shift.operator_name)
    return current === displayName || current === rawName || (shortName && current === shortName)
  })
}

function buildPublicationKeyboard(responseId: string) {
  return {
    inline_keyboard: [
      [
        { text: 'Подтверждаю неделю', callback_data: `sw:${responseId}:c` },
        { text: 'Есть проблема', callback_data: `sw:${responseId}:i` },
      ],
    ],
  }
}

function buildIssueSelectionKeyboard(responseId: string, assignments: ShiftRow[]) {
  return {
    inline_keyboard: assignments.map((shift) => [
      {
        text: `${formatShiftDate(shift.date)} · ${formatShiftType(shift.shift_type)}`,
        callback_data: `si:${responseId}:${compactShiftDate(shift.date)}:${shift.shift_type === 'day' ? 'd' : 'n'}`,
      },
    ]),
  }
}

function buildTeamRoster(shifts: ShiftRow[]) {
  const grouped = new Map<string, { day?: string; night?: string }>()

  for (const shift of shifts) {
    const bucket = grouped.get(shift.date) || {}
    bucket[shift.shift_type] = shift.operator_name
    grouped.set(shift.date, bucket)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const dayLabel = row.day ? `день — ${row.day}` : 'день — свободно'
      const nightLabel = row.night ? `ночь — ${row.night}` : 'ночь — свободно'
      return escapeTelegramHtml(`• ${formatShiftDate(date)}: ${dayLabel}; ${nightLabel}`)
    })
    .join('\n')
}

function buildOperatorWeekMessage(params: {
  companyName: string
  weekStart: string
  weekEnd: string
  assignments: ShiftRow[]
  teamRoster: string
}) {
  const personalShifts = params.assignments
    .map((shift) =>
      escapeTelegramHtml(`• ${formatShiftDate(shift.date)} — ${formatShiftType(shift.shift_type)}`),
    )
    .join('\n')

  const company = escapeTelegramHtml(params.companyName)

  return [
    `<b>📅 Недельный график опубликован</b>`,
    '',
    `<b>Точка</b> · ${company}`,
    `<b>Период</b> · ${formatShiftDate(params.weekStart)} — ${formatShiftDate(params.weekEnd)}`,
    '',
    `<b>Ваши смены</b>`,
    personalShifts || '<i>На эту неделю у вас нет смен.</i>',
    '',
    `<b>Команда на неделю</b>`,
    params.teamRoster || '<i>Нет данных по команде.</i>',
    '',
    `Если всё верно — <b>Подтверждаю неделю</b>.`,
    `Если есть вопрос по смене — <b>Есть проблема</b>.`,
  ].join('\n')
}

export async function publishShiftWeekForCompany(params: {
  supabase: DbClient
  companyId: string
  weekStart: string
  actorUserId?: string | null
}) {
  const weekEnd = shiftIsoDate(params.weekStart, 6)
  const companyName = await getCompanyNameById(params.supabase, params.companyId)
  const shifts = await getWeekShiftsForCompany(params.supabase, params.companyId, params.weekStart, weekEnd)

  if (shifts.length === 0) {
    throw new Error('На эту неделю по выбранной точке нет назначенных смен.')
  }

  const operators = await getActiveOperators(params.supabase)
  const uniqueAssignments = new Map<string, { operator: OperatorRow; assignments: ShiftRow[] }>()

  for (const operator of operators) {
    const assignments = getOperatorAssignmentsFromShifts(shifts, operator)
    if (assignments.length > 0) {
      uniqueAssignments.set(operator.id, { operator, assignments })
    }
  }

  if (uniqueAssignments.size === 0) {
    throw new Error('Не удалось сопоставить назначенные смены с активными операторами.')
  }

  const { data: latestPublication, error: latestError } = await params.supabase
    .from('shift_week_publications')
    .select('version')
    .eq('company_id', params.companyId)
    .eq('week_start', params.weekStart)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) throw latestError

  const nextVersion = Number(latestPublication?.version || 0) + 1

  const { data: publication, error: publicationError } = await params.supabase
    .from('shift_week_publications')
    .insert([
      {
        company_id: params.companyId,
        week_start: params.weekStart,
        week_end: weekEnd,
        version: nextVersion,
        status: 'published',
        published_by: params.actorUserId || null,
      },
    ])
    .select('*')
    .single()

  if (publicationError) throw publicationError

  const responseRows = [...uniqueAssignments.values()].map(({ operator }) => ({
    publication_id: publication.id,
    company_id: params.companyId,
    operator_id: operator.id,
    status: 'pending',
    response_source: 'system',
  }))

  const { data: insertedResponses, error: responseError } = await params.supabase
    .from('shift_operator_week_responses')
    .insert(responseRows)
    .select('id, operator_id')

  if (responseError) throw responseError

  const responseIdByOperatorId = new Map<string, string>()
  for (const item of insertedResponses || []) {
    responseIdByOperatorId.set(String(item.operator_id), String(item.id))
  }

  const teamRoster = buildTeamRoster(shifts)
  let delivered = 0
  let missingTelegram = 0
  let failed = 0
  const deliveryDetails: Array<{
    operator_id: string
    operator_name: string
    status: 'sent' | 'missing_telegram' | 'failed'
    reason?: string | null
  }> = []

  for (const { operator, assignments } of uniqueAssignments.values()) {
    const operatorLabel = getOperatorDisplayName(operator, 'Оператор')

    if (!operator.telegram_chat_id || !process.env.TELEGRAM_BOT_TOKEN) {
      missingTelegram += 1
      deliveryDetails.push({
        operator_id: operator.id,
        operator_name: operatorLabel,
        status: 'missing_telegram',
        reason: !operator.telegram_chat_id ? 'У оператора не заполнен telegram_chat_id.' : 'TELEGRAM_BOT_TOKEN не настроен.',
      })
      continue
    }

    try {
      const responseId = responseIdByOperatorId.get(operator.id)
      if (!responseId) {
        throw new Error('Не удалось создать response-запись недели для оператора.')
      }

      const text = buildOperatorWeekMessage({
        companyName,
        weekStart: params.weekStart,
        weekEnd,
        assignments,
        teamRoster,
      })

      await sendTelegramMessage(
        String(operator.telegram_chat_id),
        text,
        buildPublicationKeyboard(responseId),
      )

      delivered += 1
      deliveryDetails.push({
        operator_id: operator.id,
        operator_name: operatorLabel,
        status: 'sent',
      })

      await writeNotificationLog(params.supabase, {
        channel: 'telegram',
        recipient: String(operator.telegram_chat_id),
        status: 'sent',
        payload: {
          kind: 'shift-week-publication',
          publication_id: publication.id,
          company_id: params.companyId,
          company_name: companyName,
          operator_id: operator.id,
          operator_name: operatorLabel,
          assignments: assignments.map((assignment) => ({
            date: assignment.date,
            shift_type: assignment.shift_type,
          })),
        },
      })
    } catch (error) {
      failed += 1
      const reason = error instanceof Error ? error.message : 'telegram-send-failed'
      deliveryDetails.push({
        operator_id: operator.id,
        operator_name: operatorLabel,
        status: 'failed',
        reason,
      })
      await writeNotificationLog(params.supabase, {
        channel: 'telegram',
        recipient: String(operator.telegram_chat_id),
        status: 'failed',
        payload: {
          kind: 'shift-week-publication',
          publication_id: publication.id,
          company_id: params.companyId,
          operator_id: operator.id,
          operator_name: operatorLabel,
          error: reason,
        },
      })
    }
  }

  return {
    publication: publication as PublicationRow,
    companyName,
    weekEnd,
    totalOperators: uniqueAssignments.size,
    delivered,
    missingTelegram,
    failed,
    deliveryDetails,
  }
}

async function verifyPublicationOperator(supabase: DbClient, publicationId: string, operatorId: string, telegramUserId: string) {
  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', operatorId)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator) throw new Error('Оператор не найден')
  if (String(operator.telegram_chat_id || '') !== String(telegramUserId)) {
    throw new Error('Это сообщение назначено другому оператору')
  }

  const { data: publication, error: publicationError } = await supabase
    .from('shift_week_publications')
    .select('*')
    .eq('id', publicationId)
    .maybeSingle()

  if (publicationError) throw publicationError
  if (!publication) throw new Error('Публикация недели не найдена')

  return {
    operator: operator as OperatorRow,
    publication: publication as PublicationRow,
  }
}

async function verifyResponseOwnership(supabase: DbClient, responseId: string, operatorId: string) {
  const { data: responseRow, error: responseError } = await supabase
    .from('shift_operator_week_responses')
    .select('id, publication_id, operator_id, company_id')
    .eq('id', responseId)
    .maybeSingle()

  if (responseError) throw responseError
  if (!responseRow) throw new Error('Ответ по неделе не найден')
  if (String(responseRow.operator_id) !== String(operatorId)) {
    throw new Error('Этот ответ по неделе назначен другому оператору')
  }

  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('id', responseRow.operator_id)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator) throw new Error('Оператор не найден')

  const { data: publication, error: publicationError } = await supabase
    .from('shift_week_publications')
    .select('*')
    .eq('id', responseRow.publication_id)
    .maybeSingle()

  if (publicationError) throw publicationError
  if (!publication) throw new Error('Публикация недели не найдена')

  return {
    responseId: String(responseRow.id),
    companyId: String(responseRow.company_id),
    operator: operator as OperatorRow,
    publication: publication as PublicationRow,
  }
}

async function verifyResponseOperator(supabase: DbClient, responseId: string, telegramUserId: string) {
  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('telegram_chat_id', telegramUserId)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator) throw new Error('Оператор не найден')
  if (String(operator.telegram_chat_id || '') !== String(telegramUserId)) {
    throw new Error('Это сообщение назначено другому оператору')
  }

  return verifyResponseOwnership(supabase, responseId, String(operator.id))
}

export async function confirmShiftPublicationWeek(params: {
  supabase: DbClient
  publicationId: string
  operatorId: string
  telegramUserId: string
  source: string
}) {
  const { operator, publication } = await verifyPublicationOperator(
    params.supabase,
    params.publicationId,
    params.operatorId,
    params.telegramUserId,
  )

  const { error } = await params.supabase
    .from('shift_operator_week_responses')
    .update({
      status: 'confirmed',
      response_source: params.source,
      responded_at: new Date().toISOString(),
      note: 'Оператор подтвердил недельный график.',
    })
    .eq('publication_id', params.publicationId)
    .eq('operator_id', params.operatorId)

  if (error) throw error

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    companyId: publication.company_id,
  }
}

export async function confirmShiftPublicationWeekByResponse(params: {
  supabase: DbClient
  responseId: string
  telegramUserId: string
  source: string
}) {
  const { operator, publication, responseId } = await verifyResponseOperator(
    params.supabase,
    params.responseId,
    params.telegramUserId,
  )

  const { error } = await params.supabase
    .from('shift_operator_week_responses')
    .update({
      status: 'confirmed',
      response_source: params.source,
      responded_at: new Date().toISOString(),
      note: 'Оператор подтвердил недельный график.',
    })
    .eq('id', responseId)

  if (error) throw error

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    companyId: publication.company_id,
    operatorId: operator.id,
    publicationId: publication.id,
  }
}

export async function confirmShiftPublicationWeekByOperator(params: {
  supabase: DbClient
  responseId: string
  operatorId: string
  source: string
}) {
  const { operator, publication, responseId } = await verifyResponseOwnership(
    params.supabase,
    params.responseId,
    params.operatorId,
  )

  const { error } = await params.supabase
    .from('shift_operator_week_responses')
    .update({
      status: 'confirmed',
      response_source: params.source,
      responded_at: new Date().toISOString(),
      note: 'Оператор подтвердил недельный график.',
    })
    .eq('id', responseId)

  if (error) throw error

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    companyId: publication.company_id,
    operatorId: operator.id,
    publicationId: publication.id,
  }
}

export async function startShiftIssueSelection(params: {
  supabase: DbClient
  responseId: string
  telegramUserId: string
}) {
  const { operator, publication, responseId } = await verifyResponseOperator(params.supabase, params.responseId, params.telegramUserId)

  const shifts = await getWeekShiftsForCompany(
    params.supabase,
    publication.company_id,
    publication.week_start,
    publication.week_end,
  )
  const assignments = getOperatorAssignmentsFromShifts(shifts, operator)

  if (assignments.length === 0) {
    throw new Error('По этой неделе для вас не найдено назначенных смен.')
  }

  await params.supabase
    .from('shift_operator_week_responses')
    .update({
      status: 'issue_reported',
      response_source: 'telegram',
      responded_at: new Date().toISOString(),
      note: 'Оператор открыл запрос на изменение недели.',
    })
    .eq('id', responseId)

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    publication,
    assignments,
    keyboard: buildIssueSelectionKeyboard(responseId, assignments),
  }
}

export async function createShiftIssueDraft(params: {
  supabase: DbClient
  responseId: string
  telegramUserId: string
  shiftDate: string
  shiftType: ShiftType
  source: string
}) {
  const { operator, publication } = await verifyResponseOperator(params.supabase, params.responseId, params.telegramUserId)

  const { data: existing, error: existingError } = await params.supabase
    .from('shift_change_requests')
    .select('id')
    .eq('publication_id', publication.id)
    .eq('operator_id', operator.id)
    .eq('shift_date', params.shiftDate)
    .eq('shift_type', params.shiftType)
    .in('status', ['awaiting_reason', 'open'])
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    await params.supabase
      .from('shift_change_requests')
      .update({
        status: 'awaiting_reason',
        reason: null,
        source: params.source,
        responded_at: null,
        lead_status: null,
        lead_action: null,
        lead_note: null,
        lead_operator_id: null,
        lead_replacement_operator_id: null,
        lead_updated_at: null,
        resolution_note: null,
        resolved_at: null,
        resolved_by: null,
      })
      .eq('id', existing.id)
  } else {
    const { error } = await params.supabase.from('shift_change_requests').insert([
      {
        publication_id: publication.id,
        company_id: publication.company_id,
        operator_id: operator.id,
        shift_date: params.shiftDate,
        shift_type: params.shiftType,
        status: 'awaiting_reason',
        source: params.source,
        lead_status: null,
        lead_action: null,
        lead_note: null,
        lead_operator_id: null,
        lead_replacement_operator_id: null,
        lead_updated_at: null,
      },
    ])

    if (error) throw error
  }

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    shiftDate: params.shiftDate,
    shiftType: params.shiftType,
  }
}

export async function createShiftIssueByOperator(params: {
  supabase: DbClient
  responseId: string
  operatorId: string
  shiftDate: string
  shiftType: ShiftType
  reason: string
  source: string
}) {
  const { operator, publication, responseId } = await verifyResponseOwnership(
    params.supabase,
    params.responseId,
    params.operatorId,
  )

  const normalizedReason = params.reason.trim()
  if (!normalizedReason) {
    throw new Error('Нужно указать причину проблемы по смене')
  }

  const { data: existing, error: existingError } = await params.supabase
    .from('shift_change_requests')
    .select('id')
    .eq('publication_id', publication.id)
    .eq('operator_id', operator.id)
    .eq('shift_date', params.shiftDate)
    .eq('shift_type', params.shiftType)
    .in('status', ['awaiting_reason', 'open'])
    .maybeSingle()

  if (existingError) throw existingError

  if (existing?.id) {
    const { error } = await params.supabase
      .from('shift_change_requests')
      .update({
        status: 'open',
        source: params.source,
        reason: normalizedReason,
        responded_at: new Date().toISOString(),
        lead_status: null,
        lead_action: null,
        lead_note: null,
        lead_operator_id: null,
        lead_replacement_operator_id: null,
        lead_updated_at: null,
      })
      .eq('id', existing.id)

    if (error) throw error
  } else {
    const { error } = await params.supabase.from('shift_change_requests').insert([
      {
        publication_id: publication.id,
        company_id: publication.company_id,
        operator_id: operator.id,
        shift_date: params.shiftDate,
        shift_type: params.shiftType,
        status: 'open',
        source: params.source,
        reason: normalizedReason,
        responded_at: new Date().toISOString(),
        lead_status: null,
        lead_action: null,
        lead_note: null,
        lead_operator_id: null,
        lead_replacement_operator_id: null,
        lead_updated_at: null,
      },
    ])

    if (error) throw error
  }

  const { error: responseError } = await params.supabase
    .from('shift_operator_week_responses')
    .update({
      status: 'issue_reported',
      response_source: params.source,
      responded_at: new Date().toISOString(),
      note: 'Оператор сообщил о проблемной смене в кабинете.',
    })
    .eq('id', responseId)

  if (responseError) throw responseError

  return {
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    publicationId: publication.id,
    companyId: publication.company_id,
  }
}

export function parseShiftIssuePayload(compactDate: string, shiftCode: string) {
  return {
    shiftDate: expandShiftDate(compactDate),
    shiftType: shiftCode === 'd' ? 'day' : 'night',
  } as const
}

export async function submitPendingShiftIssueReason(params: {
  supabase: DbClient
  telegramUserId: string
  reason: string
  source: string
}) {
  const { data: operator, error: operatorError } = await params.supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, operator_profiles(*)')
    .eq('telegram_chat_id', params.telegramUserId)
    .maybeSingle()

  if (operatorError) throw operatorError
  if (!operator) return null

  const { data: draft, error: draftError } = await params.supabase
    .from('shift_change_requests')
    .select('id, publication_id, shift_date, shift_type')
    .eq('operator_id', operator.id)
    .eq('status', 'awaiting_reason')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (draftError) throw draftError
  if (!draft) return null

  const { error: updateError } = await params.supabase
    .from('shift_change_requests')
    .update({
      status: 'open',
      source: params.source,
      reason: params.reason.trim(),
      responded_at: new Date().toISOString(),
      lead_status: null,
      lead_action: null,
      lead_note: null,
      lead_operator_id: null,
      lead_replacement_operator_id: null,
      lead_updated_at: null,
    })
    .eq('id', draft.id)

  if (updateError) throw updateError

  return {
    requestId: draft.id,
    operatorName: getOperatorDisplayName(operator, 'Оператор'),
    shiftDate: draft.shift_date,
    shiftType: draft.shift_type,
  }
}

export async function resolveShiftChangeRequest(params: {
  supabase: DbClient
  requestId: string
  status: 'resolved' | 'dismissed'
  actorUserId?: string | null
  resolutionNote?: string | null
}) {
  const { data, error } = await params.supabase
    .from('shift_change_requests')
    .update({
      status: params.status,
      lead_status: params.status === 'resolved' || params.status === 'dismissed' ? 'reviewed' : null,
      resolution_note: params.resolutionNote?.trim() || null,
      resolved_at: new Date().toISOString(),
      resolved_by: params.actorUserId || null,
    })
    .eq('id', params.requestId)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function submitShiftLeadReview(params: {
  supabase: DbClient
  requestId: string
  leadOperatorId: string
  proposalAction: 'keep' | 'remove' | 'replace'
  proposalNote?: string | null
  replacementOperatorId?: string | null
}) {
  const { data, error } = await params.supabase
    .from('shift_change_requests')
    .update({
      lead_status: 'proposed',
      lead_action: params.proposalAction,
      lead_note: params.proposalNote?.trim() || null,
      lead_operator_id: params.leadOperatorId,
      lead_replacement_operator_id: params.proposalAction === 'replace' ? params.replacementOperatorId || null : null,
      lead_updated_at: new Date().toISOString(),
    })
    .eq('id', params.requestId)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function loadShiftWeekWorkflow(supabase: DbClient, weekStart: string) {
  const { data: publicationsRaw, error: publicationsError } = await supabase
    .from('shift_week_publications')
    .select('*')
    .eq('week_start', weekStart)
    .order('published_at', { ascending: false })

  if (publicationsError) throw publicationsError

  const publicationsList = (publicationsRaw || []) as PublicationRow[]
  const publicationIds = publicationsList.map((item) => item.id)
  const companyIds = [...new Set(publicationsList.map((item) => item.company_id))]

  const [companiesRes, responsesRes, requestsRes] = await Promise.all([
    companyIds.length > 0
      ? supabase.from('companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [], error: null }),
    publicationIds.length > 0
      ? supabase
          .from('shift_operator_week_responses')
          .select('id, publication_id, company_id, operator_id, status, response_source, note, responded_at, created_at')
          .in('publication_id', publicationIds)
      : Promise.resolve({ data: [], error: null }),
    publicationIds.length > 0
      ? supabase
          .from('shift_change_requests')
          .select(
            'id, publication_id, company_id, operator_id, shift_date, shift_type, status, source, reason, lead_status, lead_action, lead_note, lead_operator_id, lead_replacement_operator_id, lead_updated_at, resolution_note, responded_at, resolved_at, created_at',
          )
          .in('publication_id', publicationIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (companiesRes.error) throw companiesRes.error
  if (responsesRes.error) throw responsesRes.error
  if (requestsRes.error) throw requestsRes.error

  const responses = (responsesRes.data || []) as Array<{
    id: string
    publication_id: string
    company_id: string
    operator_id: string
    status: string
    response_source: string | null
    note: string | null
    responded_at: string | null
    created_at: string
  }>
  const requests = (requestsRes.data || []) as Array<{
    id: string
    publication_id: string
    company_id: string
    operator_id: string
    shift_date: string
    shift_type: ShiftType
    status: string
    source: string | null
    reason: string | null
    lead_status: string | null
    lead_action: string | null
    lead_note: string | null
    lead_operator_id: string | null
    lead_replacement_operator_id: string | null
    lead_updated_at: string | null
    resolution_note: string | null
    responded_at: string | null
    resolved_at: string | null
    created_at: string
  }>

  const operatorIds = [
    ...new Set(
      [
        ...responses.map((item) => item.operator_id),
        ...requests.map((item) => item.operator_id),
        ...requests.map((item) => item.lead_operator_id).filter(Boolean),
        ...requests.map((item) => item.lead_replacement_operator_id).filter(Boolean),
      ].filter(Boolean),
    ),
  ]
  const { data: operatorsRes, error: operatorsError } =
    operatorIds.length > 0
      ? await supabase.from('operators').select('id, name, short_name, operator_profiles(*)').in('id', operatorIds)
      : { data: [], error: null }

  if (operatorsError) throw operatorsError

  const companyMap = new Map(((companiesRes.data || []) as Array<{ id: string; name: string }>).map((item) => [item.id, item.name]))
  const operatorMap = new Map(((operatorsRes || []) as OperatorRow[]).map((item) => [item.id, getOperatorDisplayName(item, 'Оператор')]))

  const publications: WorkflowPublication[] = publicationsList.map((publication) => {
    const publicationResponses = responses.filter((item) => item.publication_id === publication.id)
    return {
      ...publication,
      company_name: companyMap.get(publication.company_id) || 'Неизвестная точка',
      pending_count: publicationResponses.filter((item) => item.status === 'pending').length,
      confirmed_count: publicationResponses.filter((item) => item.status === 'confirmed').length,
      issue_count: requests.filter((item) => item.publication_id === publication.id && item.status === 'open').length,
      total_count: publicationResponses.length,
    }
  })

  const enrichedResponses: WorkflowResponse[] = responses.map((item) => ({
    ...item,
    operator_name: operatorMap.get(item.operator_id) || 'Оператор',
  }))

  const enrichedRequests: WorkflowRequest[] = requests.map((item) => ({
    ...item,
    operator_name: operatorMap.get(item.operator_id) || 'Оператор',
    lead_operator_name: item.lead_operator_id ? operatorMap.get(item.lead_operator_id) || 'Старший' : null,
    lead_replacement_operator_name: item.lead_replacement_operator_id
      ? operatorMap.get(item.lead_replacement_operator_id) || 'Оператор'
      : null,
  }))

  return {
    publications,
    responses: enrichedResponses,
    requests: enrichedRequests,
  }
}
