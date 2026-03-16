import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type ExpensePayload = {
  date: string
  company_id: string
  operator_id: string | null
  category: string
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type Body =
  | {
      action: 'createExpense'
      payload: ExpensePayload
    }
  | {
      action: 'updateExpense'
      expenseId: string
      payload: ExpensePayload
    }
  | {
      action: 'deleteExpense'
      expenseId: string
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizePayload(payload: ExpensePayload) {
  return {
    date: payload.date,
    company_id: payload.company_id,
    operator_id: payload.operator_id || null,
    category: payload.category.trim(),
    cash_amount: payload.cash_amount ?? 0,
    kaspi_amount: payload.kaspi_amount ?? 0,
    comment: payload.comment?.trim() || null,
  }
}

function validatePayload(payload: ExpensePayload | null | undefined) {
  if (!payload?.date?.trim()) return 'Дата обязательна'
  if (!payload.company_id?.trim()) return 'Компания обязательна'
  if (!payload.operator_id?.trim()) return 'Оператор обязателен'
  if (!payload.category?.trim()) return 'Категория обязательна'

  const cash = Number(payload.cash_amount || 0)
  const kaspi = Number(payload.kaspi_amount || 0)
  if (cash <= 0 && kaspi <= 0) return 'Сумма расхода обязательна'

  return null
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const companyId = url.searchParams.get('company_id')

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    let query = supabase
      .from('expenses')
      .select('id, date, company_id, operator_id, category, cash_amount, kaspi_amount, comment')
      .order('date', { ascending: false })
      .limit(2000)

    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query
    if (error) throw error

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expenses GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    const canCreateFinance = access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
    const canManageFinance = access.isSuperAdmin || access.staffRole === 'owner'

    if (body.action === 'createExpense') {
      if (!canCreateFinance) return json({ error: 'forbidden' }, 403)
      const validationError = validatePayload(body.payload)
      if (validationError) return json({ error: validationError }, 400)

      const insertPayload = normalizePayload(body.payload)
      const { data, error } = await supabase.from('expenses').insert([insertPayload]).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'expense',
        entityId: String(data.id),
        action: 'create',
        payload: {
          ...insertPayload,
          total_amount: Number(insertPayload.cash_amount || 0) + Number(insertPayload.kaspi_amount || 0),
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'updateExpense') {
      if (!canManageFinance) return json({ error: 'forbidden' }, 403)
      if (!body.expenseId?.trim()) return json({ error: 'expenseId обязателен' }, 400)
      const validationError = validatePayload(body.payload)
      if (validationError) return json({ error: validationError }, 400)

      const { data: existing, error: existingError } = await supabase.from('expenses').select('*').eq('id', body.expenseId).single()
      if (existingError) throw existingError

      const updatePayload = normalizePayload(body.payload)
      const { data, error } = await supabase.from('expenses').update(updatePayload).eq('id', body.expenseId).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'expense',
        entityId: String(body.expenseId),
        action: 'update',
        payload: {
          previous: {
            date: existing.date,
            company_id: existing.company_id,
            operator_id: existing.operator_id,
            category: existing.category,
            cash_amount: existing.cash_amount,
            kaspi_amount: existing.kaspi_amount,
            comment: existing.comment,
          },
          next: updatePayload,
        },
      })

      return json({ ok: true, data })
    }

    if (!canManageFinance) return json({ error: 'forbidden' }, 403)
    if (!body.expenseId?.trim()) return json({ error: 'expenseId обязателен' }, 400)

    const { data: existing, error: existingError } = await supabase.from('expenses').select('*').eq('id', body.expenseId).single()
    if (existingError) throw existingError

    const { error } = await supabase.from('expenses').delete().eq('id', body.expenseId)
    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'expense',
      entityId: String(body.expenseId),
      action: 'delete',
      payload: {
        date: existing.date,
        company_id: existing.company_id,
        operator_id: existing.operator_id,
        category: existing.category,
      },
    })

    return json({ ok: true })
  } catch (error: any) {
    console.error('Admin expenses route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses',
      message: error?.message || 'Admin expenses route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
