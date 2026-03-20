import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type MutationBody =
  | {
      action: 'createAdjustment'
      payload: {
        operator_id: string
        date: string
        amount: number
        kind: 'debt' | 'fine' | 'bonus' | 'advance'
        comment?: string | null
      }
    }
  | {
      action: 'updateOperatorChatId'
      operatorId: string
      telegram_chat_id: string | null
    }
  | {
      action: 'toggleShiftPayout'
      payload: {
        operator_id: string
        date: string
        shift: 'day' | 'night'
        is_paid: boolean
        paid_at?: string | null
        comment?: string | null
      }
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard

    const url = new URL(req.url)
    const view = url.searchParams.get('view')
    if (view !== 'operatorDetail') {
      return json({ error: 'unsupported-view' }, 400)
    }

    const operatorId = (url.searchParams.get('operatorId') || '').trim()
    const dateFrom = normalizeIsoDate(url.searchParams.get('dateFrom'))
    const dateTo = normalizeIsoDate(url.searchParams.get('dateTo'))

    if (!operatorId || !dateFrom || !dateTo) {
      return json({ error: 'operatorId, dateFrom and dateTo are required' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const [
      { data: operator, error: operatorError },
      { data: companies, error: companiesError },
      { data: rules, error: rulesError },
      { data: assignments, error: assignmentsError },
      { data: incomes, error: incomesError },
      { data: payouts, error: payoutsError },
    ] = await Promise.all([
      supabase
        .from('operators')
        .select('id, name, short_name, is_active, operator_profiles(*)')
        .eq('id', operatorId)
        .maybeSingle(),
      supabase.from('companies').select('id, name, code').order('name'),
      supabase
        .from('operator_salary_rules')
        .select(
          'company_code, shift_type, base_per_shift, senior_operator_bonus, senior_cashier_bonus, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus',
        )
        .eq('is_active', true),
      supabase
        .from('operator_company_assignments')
        .select('operator_id, company_id, role_in_company, is_active')
        .eq('operator_id', operatorId)
        .eq('is_active', true),
      supabase
        .from('incomes')
        .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, card_amount, comment')
        .eq('operator_id', operatorId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false }),
      supabase
        .from('operator_salary_payouts')
        .select('id, operator_id, date, shift, is_paid, paid_at, comment')
        .eq('operator_id', operatorId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
    ])

    if (operatorError) throw operatorError
    if (companiesError) throw companiesError
    if (rulesError) throw rulesError
    if (assignmentsError) throw assignmentsError
    if (incomesError) throw incomesError
    if (payoutsError) throw payoutsError

    if (!operator) {
      return json({ error: 'operator-not-found' }, 404)
    }

    return json({
      ok: true,
      data: {
        operator,
        companies: companies || [],
        rules: rules || [],
        assignments: assignments || [],
        incomes: incomes || [],
        payouts: payouts || [],
      },
    })
  } catch (error: any) {
    console.error('Admin salary GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary:get',
      message: error?.message || 'Admin salary GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.action) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const supabase = createAdminSupabaseClient()

    if (body.action === 'createAdjustment') {
      if (!body.payload.operator_id || !body.payload.date || !Number.isFinite(body.payload.amount)) {
        return json({ error: 'Недостаточно данных для корректировки' }, 400)
      }

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([
          {
            operator_id: body.payload.operator_id,
            date: body.payload.date,
            amount: Math.round(body.payload.amount),
            kind: body.payload.kind,
            comment: body.payload.comment?.trim() || null,
          },
        ])
        .select('id,operator_id,date,amount,kind,comment')
        .single()

      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-adjustment',
        entityId: String(data.id),
        action: 'create',
        payload: data,
      })
      return json({ ok: true, data })
    }

    if (body.action === 'toggleShiftPayout') {
      const { operator_id, date, shift, is_paid, paid_at, comment } = body.payload
      if (!operator_id || !normalizeIsoDate(date) || !['day', 'night'].includes(shift)) {
        return json({ error: 'invalid-shift-payout-payload' }, 400)
      }

      const { data, error } = await supabase
        .from('operator_salary_payouts')
        .upsert(
          {
            operator_id,
            date,
            shift,
            is_paid,
            paid_at: is_paid ? paid_at || new Date().toISOString() : null,
            comment: comment?.trim() || null,
          },
          { onConflict: 'operator_id,date,shift' },
        )
        .select('id, operator_id, date, shift, is_paid, paid_at, comment')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-payout',
        entityId: String(data.id),
        action: is_paid ? 'mark-paid' : 'mark-unpaid',
        payload: {
          operator_id: data.operator_id,
          date: data.date,
          shift: data.shift,
          is_paid: data.is_paid,
          paid_at: data.paid_at,
        },
      })

      return json({ ok: true, data })
    }

    if (!body.operatorId) {
      return json({ error: 'operatorId обязателен' }, 400)
    }

    const chatIdRaw = body.telegram_chat_id?.trim() || null
    if (chatIdRaw !== null && !/^-?\d+$/.test(chatIdRaw)) {
      return json({ error: 'Неверный формат telegram_chat_id' }, 400)
    }

    const { data, error } = await supabase
      .from('operators')
      .update({ telegram_chat_id: chatIdRaw })
      .eq('id', body.operatorId)
      .select('id,name,short_name,is_active,telegram_chat_id')
      .single()

    if (error) throw error
    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'operator',
      entityId: String(data.id),
      action: 'update-telegram-chat-id',
      payload: {
        name: data.name,
        short_name: data.short_name,
        telegram_chat_id: data.telegram_chat_id,
      },
    })
    return json({ ok: true, data })
  } catch (error: any) {
    console.error('Admin salary mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary',
      message: error?.message || 'Admin salary mutation error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
