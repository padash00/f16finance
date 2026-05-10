import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireOperator } from '@/lib/server/operator-context'

type Body = {
  shift_type?: 'day' | 'night' | 'custom' | null
  opening_cash?: number | null
  opening_notes?: string | null
  handover_from_shift_id?: string | null
  // iOS Phase 1 также шлёт point_id — игнорируем
  point_id?: unknown
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, operatorId, staffId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  const openingCashRaw = (body as any).opening_cash
  const openingCash =
    openingCashRaw === undefined || openingCashRaw === null || String(openingCashRaw).trim() === ''
      ? Number.NaN
      : Number(openingCashRaw)

  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return json(
      {
        error: 'opening-cash-required',
        message: 'Перед открытием смены укажите старт кассы.',
      },
      400,
    )
  }

  // Проверяем что оператор есть в графике на сегодня для этой компании.
  // Если нет — блокируем открытие смены.
  const today = new Date().toISOString().slice(0, 10)
  const { data: scheduledShifts } = await supabase
    .from('shifts')
    .select('id, operator_name, shift_type')
    .eq('company_id', companyId)
    .eq('date', today)
  const operatorOnSchedule = (scheduledShifts || []).some((row: any) => {
    // Сравниваем по operator_name (свободный текст) — нечувствительно к регистру.
    // Если хочешь строже — можно матчить по точному имени.
    return true  // достаточно проверить что есть запись для оператора
  })

  // Получаем имя оператора чтобы сравнить
  const { data: opRow } = await supabase
    .from('operators')
    .select('name, short_name')
    .eq('id', operatorId)
    .maybeSingle()
  const opName = ((opRow as any)?.name || '').toLowerCase().trim()
  const opShort = ((opRow as any)?.short_name || '').toLowerCase().trim()
  const isScheduled = (scheduledShifts || []).some((row: any) => {
    const n = String((row as any).operator_name || '').toLowerCase().trim()
    return n && (n === opName || n === opShort || (opName && n.includes(opName.split(' ')[0])) || (opShort && n.includes(opShort)))
  })

  if (!isScheduled && (scheduledShifts || []).length > 0) {
    return json(
      {
        error: 'not-on-schedule',
        message: 'Сегодня по графику работаешь не ты. Открывать смену может только тот кто в расписании.',
      },
      403,
    )
  }
  if ((scheduledShifts || []).length === 0) {
    return json(
      {
        error: 'no-schedule-today',
        message: 'На сегодня нет опубликованного расписания. Обратись к менеджеру.',
      },
      403,
    )
  }

  const { data, error } = await supabase.rpc('point_shift_open', {
    p_company_id: companyId,
    p_operator_id: staffId,   // RPC принимает staff.id, не operators.id
    p_point_device_id: null,  // iOS не device
    p_shift_type: body.shift_type || 'day',
    p_opening_cash: openingCash,
    p_opening_notes: body.opening_notes || null,
    p_handover_from: body.handover_from_shift_id || null,
  })

  if (error) {
    const code = String((error as any).message || '').toLowerCase()
    if (code.includes('point-shift-already-open')) {
      const { data: existing } = await supabase
        .from('point_shifts')
        .select('id, opened_at, operator_id, shift_type, opening_cash')
        .eq('company_id', companyId)
        .eq('status', 'open')
        .maybeSingle()
      return json({ error: 'point-shift-already-open', shift: existing || null }, 409)
    }
    if (code.includes('point-shift-operator-not-onboarded')) {
      return json(
        { error: 'point-shift-operator-not-onboarded', detail: (error as any).message },
        409,
      )
    }
    return json({ error: 'point-shift-open-failed', detail: (error as any).message }, 400)
  }

  const shiftId = (data as unknown as string) || ''

  await writeAuditLog(supabase as any, {
    action: 'point_shift.open',
    entityType: 'point_shift',
    entityId: shiftId,
    payload: {
      company_id: companyId,
      operator_id: operatorId,
      staff_id: staffId,
      opening_cash: openingCash,
      shift_type: body.shift_type || 'day',
      source: 'ios',
    },
  })

  return json({ shift_id: shiftId, opening_cash: openingCash })
}
