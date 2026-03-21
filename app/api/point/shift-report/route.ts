import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { buildPointDailyKaspiReport } from '@/lib/server/services/point-kaspi'
import { notifyShiftReport } from '@/lib/server/telegram'

type ShiftReportBody = {
  action: 'createShiftReport'
  payload: {
    date: string
    operator_id: string
    shift: 'day' | 'night'
    zone?: string | null
    cash_amount?: number | null
    kaspi_amount?: number | null
    kaspi_before_midnight?: number | null
    online_amount?: number | null
    card_amount?: number | null
    comment?: string | null
    source?: string | null
    local_ref?: string | null
    meta?: {
      coins?: number | null
      debts?: number | null
      start_cash?: number | null
      wipon?: number | null
      diff?: number | null
      split_mode?: boolean | null
      split_part?: 'before-midnight' | 'after-midnight' | null
      original_date?: string | null
    } | null
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canShiftReport(input: Record<string, unknown> | null | undefined) {
  return input?.shift_report !== false
}

function isKaspiDailySplitEnabled(input: Record<string, unknown> | null | undefined) {
  return input?.kaspi_daily_split === true
}

function resolveIncomeZone(params: {
  requestedZone?: string | null
  companyCode?: string | null
  pointMode?: string | null
}) {
  const requested = params.requestedZone?.trim().toLowerCase()
  if (requested) return requested

  const companyCode = (params.companyCode || '').trim().toLowerCase()
  if (companyCode === 'arena') return 'pc'
  if (companyCode === 'ramen') return 'ramen'
  if (companyCode === 'extra') return 'extra'

  const pointMode = (params.pointMode || '').trim().toLowerCase()
  if (pointMode === 'cash-desk' || pointMode === 'shift-report') return 'pc'
  if (pointMode === 'debts') return 'ramen'
  if (pointMode === 'universal') return 'pc'

  return 'pc'
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    if (!canShiftReport(device.feature_flags || {})) {
      return json({ error: 'shift-report-disabled-for-device' }, 403)
    }

    const body = (await request.json().catch(() => null)) as ShiftReportBody | null

    if (body?.action !== 'createShiftReport') {
      return json({ error: 'invalid-action' }, 400)
    }

    const payload = body.payload
    if (!payload?.date?.trim()) return json({ error: 'date-required' }, 400)
    if (!payload?.operator_id?.trim()) return json({ error: 'operator-required' }, 400)
    if (payload.shift !== 'day' && payload.shift !== 'night') return json({ error: 'shift-invalid' }, 400)

    const { data: assignment, error: assignmentError } = await supabase
      .from('operator_company_assignments')
      .select('id, role_in_company, operator:operator_id(id, name, short_name, telegram_chat_id)')
      .eq('company_id', device.company_id)
      .eq('operator_id', payload.operator_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (assignmentError) throw assignmentError
    if (!assignment) return json({ error: 'operator-not-assigned-to-point' }, 403)

    const normalized = {
      date: payload.date,
      company_id: device.company_id,
      operator_id: payload.operator_id,
      shift: payload.shift,
      zone: resolveIncomeZone({
        requestedZone: payload.zone,
        companyCode: device.company?.code || null,
        pointMode: device.point_mode,
      }),
      cash_amount: payload.cash_amount ?? 0,
      kaspi_amount: payload.kaspi_amount ?? 0,
      kaspi_before_midnight:
        payload.shift === 'night' && payload.kaspi_before_midnight != null
          ? payload.kaspi_before_midnight
          : null,
      online_amount: payload.online_amount ?? 0,
      card_amount: payload.card_amount ?? 0,
      comment: payload.comment?.trim() || null,
      is_virtual: false,
    }

    const meta = payload.meta || null

    const totalAmount =
      Number(normalized.cash_amount || 0) +
      Number(normalized.kaspi_amount || 0) +
      Number(normalized.online_amount || 0) +
      Number(normalized.card_amount || 0) +
      Number(meta?.coins || 0) +
      Number(meta?.debts || 0)

    if (totalAmount <= 0) {
      return json({ error: 'amount-required' }, 400)
    }

    const { data: created, error: insertError } = await supabase
      .from('incomes')
      .insert([normalized])
      .select('*')
      .single()
    if (insertError) throw insertError

    const operator = Array.isArray((assignment as any).operator)
      ? (assignment as any).operator[0] || null
      : (assignment as any).operator || null

    await writeAuditLog(supabase, {
      entityType: 'point-shift-report',
      entityId: String(created.id),
      action: 'create',
      payload: {
        point_device_id: device.id,
        point_device_name: device.name,
        point_mode: device.point_mode,
        company_id: device.company_id,
        company_code: device.company?.code || null,
        operator_id: payload.operator_id,
        operator_name: operator?.name || null,
        role_in_company: assignment.role_in_company,
        date: payload.date,
        shift: payload.shift,
        zone: normalized.zone,
        total_amount: totalAmount,
        source: payload.source || 'point-client',
        local_ref: payload.local_ref || null,
        meta: meta
          ? {
              coins: meta.coins ?? null,
              debts: meta.debts ?? null,
              start_cash: meta.start_cash ?? null,
              wipon: meta.wipon ?? null,
              diff: meta.diff ?? null,
              split_mode: meta.split_mode === true,
              split_part: meta.split_part || null,
              original_date: meta.original_date || null,
              kaspi_before_midnight: normalized.kaspi_before_midnight,
            }
          : null,
      },
    })

    notifyShiftReport({
      companyName: device.company?.name || 'Точка',
      pointName: device.name,
      reportChatId: device.shift_report_chat_id || null,
      operatorName: operator?.name || null,
      operatorChatId: operator?.telegram_chat_id || null,
      date: payload.date,
      shift: payload.shift,
      cashAmount: normalized.cash_amount,
      kaspiAmount: normalized.kaspi_amount,
      onlineAmount: normalized.online_amount,
      coins: meta?.coins ?? null,
      debts: meta?.debts ?? null,
      startCash: meta?.start_cash ?? null,
      wipon: meta?.wipon ?? null,
      diff: meta?.diff ?? null,
    }).catch(() => null)

    return json({
      ok: true,
      data: {
        id: created.id,
        company_id: created.company_id,
        operator_id: created.operator_id,
        date: created.date,
        shift: created.shift,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-shift-report',
      message: error?.message || 'Unknown point shift report error',
    })
    return json({ error: error?.message || 'Не удалось сохранить сменный отчёт' }, 500)
  }
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const url = new URL(request.url)
    const view = url.searchParams.get('view')
    const date = String(url.searchParams.get('date') || '').trim()

    if (view !== 'daily-kaspi') {
      return json({ error: 'invalid-view' }, 400)
    }

    if (!date) {
      return json({ error: 'date-required' }, 400)
    }

    if (!isKaspiDailySplitEnabled(device.feature_flags || {})) {
      return json({ error: 'kaspi-daily-split-disabled-for-device' }, 403)
    }

    const report = await buildPointDailyKaspiReport({
      supabase,
      companyId: device.company_id,
      date,
    })

    return json({
      ok: true,
      data: report,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-shift-report:get',
      message: error?.message || 'Unknown point shift report GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить суточный Kaspi отчёт' }, 500)
  }
}
