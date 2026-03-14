import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body =
  | {
      action: 'createIncome'
      payload: {
        date: string
        company_id: string
        operator_id: string | null
        shift: 'day' | 'night'
        zone: string | null
        cash_amount: number | null
        kaspi_amount: number | null
        online_amount: number | null
        card_amount: number | null
        comment: string | null
        is_virtual?: boolean | null
      }
    }
  | {
      action: 'createIncomeBatch'
      payload: Array<{
        date: string
        company_id: string
        operator_id: string | null
        shift: 'day' | 'night'
        zone: string | null
        cash_amount: number | null
        kaspi_amount: number | null
        online_amount: number | null
        card_amount: number | null
        comment: string | null
        is_virtual?: boolean | null
      }>
    }
  | {
      action: 'updateOnlineAmount'
      incomeId: string
      online_amount: number | null
    }
  | {
      action: 'updateIncome'
      incomeId: string
      payload: {
        date: string
        operator_id: string | null
        cash_amount: number | null
        kaspi_amount: number | null
        online_amount: number | null
        card_amount: number | null
        comment: string | null
      }
    }
  | {
      action: 'deleteIncome'
      incomeId: string
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeIncomePayload(payload: {
  date: string
  company_id: string
  operator_id: string | null
  shift: 'day' | 'night'
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
  is_virtual?: boolean | null
}) {
  return {
    date: payload.date,
    company_id: payload.company_id,
    operator_id: payload.operator_id || null,
    shift: payload.shift,
    zone: payload.zone?.trim() || null,
    cash_amount: payload.cash_amount ?? 0,
    kaspi_amount: payload.kaspi_amount ?? 0,
    online_amount: payload.online_amount ?? 0,
    card_amount: payload.card_amount ?? 0,
    comment: payload.comment?.trim() || null,
    is_virtual: !!payload.is_virtual,
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'finance')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'createIncome') {
      if (!body.payload.date?.trim()) return json({ error: 'Дата обязательна' }, 400)
      if (!body.payload.company_id?.trim()) return json({ error: 'Компания обязательна' }, 400)
      if (!body.payload.operator_id?.trim()) return json({ error: 'Оператор обязателен' }, 400)

      const insertPayload = normalizeIncomePayload(body.payload)
      const totalAmount =
        Number(insertPayload.cash_amount || 0) +
        Number(insertPayload.kaspi_amount || 0) +
        Number(insertPayload.online_amount || 0) +
        Number(insertPayload.card_amount || 0)
      if (totalAmount <= 0) return json({ error: 'Сумма дохода обязательна' }, 400)

      const { data, error } = await supabase.from('incomes').insert([insertPayload]).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'income',
        entityId: String(data.id),
        action: 'create',
        payload: {
          ...insertPayload,
          total_amount: totalAmount,
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'createIncomeBatch') {
      const rows = Array.isArray(body.payload) ? body.payload : []
      if (rows.length === 0) return json({ error: 'Нужен список доходов' }, 400)

      const normalizedRows = rows.map((row) => normalizeIncomePayload(row))
      for (const row of normalizedRows) {
        const totalAmount =
          Number(row.cash_amount || 0) +
          Number(row.kaspi_amount || 0) +
          Number(row.online_amount || 0) +
          Number(row.card_amount || 0)
        if (!row.date?.trim()) return json({ error: 'Дата обязательна' }, 400)
        if (!row.company_id?.trim()) return json({ error: 'Компания обязательна' }, 400)
        if (!row.operator_id?.trim()) return json({ error: 'Оператор обязателен' }, 400)
        if (totalAmount <= 0) return json({ error: 'Сумма дохода обязательна' }, 400)
      }

      const { data, error } = await supabase.from('incomes').insert(normalizedRows).select('id, date, company_id, operator_id, shift, zone')
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'income',
        entityId: 'batch',
        action: 'create-batch',
        payload: {
          count: normalizedRows.length,
          ids: (data || []).map((item) => item.id),
          rows: normalizedRows.map((row) => ({
            date: row.date,
            company_id: row.company_id,
            operator_id: row.operator_id,
            shift: row.shift,
            zone: row.zone,
            total_amount:
              Number(row.cash_amount || 0) +
              Number(row.kaspi_amount || 0) +
              Number(row.online_amount || 0) +
              Number(row.card_amount || 0),
          })),
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'updateOnlineAmount') {
      if (!body.incomeId?.trim()) return json({ error: 'incomeId обязателен' }, 400)

      const { data: existing, error: existingError } = await supabase
        .from('incomes')
        .select('id, date, company_id, online_amount')
        .eq('id', body.incomeId)
        .single()

      if (existingError) throw existingError

      const { error } = await supabase
        .from('incomes')
        .update({ online_amount: body.online_amount })
        .eq('id', body.incomeId)

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'income',
        entityId: String(body.incomeId),
        action: 'update-online',
        payload: {
          previous: existing.online_amount ?? null,
          next: body.online_amount,
          date: existing.date,
          company_id: existing.company_id,
        },
      })

      return json({ ok: true })
    }

    if (body.action === 'updateIncome') {
      if (!body.incomeId?.trim()) return json({ error: 'incomeId обязателен' }, 400)
      if (!body.payload.date?.trim()) return json({ error: 'Дата обязательна' }, 400)

      const { data: existing, error: existingError } = await supabase.from('incomes').select('*').eq('id', body.incomeId).single()
      if (existingError) throw existingError

      const updatePayload = {
        date: body.payload.date,
        operator_id: body.payload.operator_id || null,
        cash_amount: body.payload.cash_amount ?? 0,
        kaspi_amount: body.payload.kaspi_amount ?? 0,
        online_amount: body.payload.online_amount ?? 0,
        card_amount: body.payload.card_amount ?? 0,
        comment: body.payload.comment?.trim() || null,
      }

      const { data, error } = await supabase.from('incomes').update(updatePayload).eq('id', body.incomeId).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'income',
        entityId: String(body.incomeId),
        action: 'update',
        payload: {
          previous: {
            date: existing.date,
            operator_id: existing.operator_id,
            cash_amount: existing.cash_amount,
            kaspi_amount: existing.kaspi_amount,
            online_amount: existing.online_amount,
            card_amount: existing.card_amount,
            comment: existing.comment,
          },
          next: updatePayload,
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'deleteIncome') {
      if (!body.incomeId?.trim()) return json({ error: 'incomeId обязателен' }, 400)

      const { data: existing, error: existingError } = await supabase.from('incomes').select('*').eq('id', body.incomeId).single()
      if (existingError) throw existingError

      const { error } = await supabase.from('incomes').delete().eq('id', body.incomeId)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'income',
        entityId: String(body.incomeId),
        action: 'delete',
        payload: {
          date: existing.date,
          operator_id: existing.operator_id,
          company_id: existing.company_id,
          shift: existing.shift,
        },
      })

      return json({ ok: true })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    console.error('Admin incomes route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/incomes',
      message: error?.message || 'Admin incomes route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
