import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type ShiftReportBody = {
  action: 'createShiftReport'
  payload: {
    date: string
    operator_id: string
    shift: 'day' | 'night'
    zone?: string | null
    cash_amount?: number | null
    kaspi_amount?: number | null
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
      .select('id, role_in_company, operator:operator_id(id, name, short_name)')
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
      Number(normalized.card_amount || 0)

    if (totalAmount <= 0) {
      return json({ error: 'amount-required' }, 400)
    }

    const { data: created, error: insertError } = await supabase.from('incomes').insert([normalized]).select('*').single()
    if (insertError) throw insertError

    const operator = Array.isArray((assignment as any).operator) ? (assignment as any).operator[0] || null : (assignment as any).operator || null

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
            }
          : null,
      },
    })

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
