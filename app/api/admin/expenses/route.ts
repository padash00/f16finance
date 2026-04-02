import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
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
  | {
      action: 'removeAttachment'
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
    const category = url.searchParams.get('category')
    const payFilter = url.searchParams.get('pay_filter') as 'cash' | 'kaspi' | null
    const search = url.searchParams.get('search')
    const sort = (url.searchParams.get('sort') || 'date_desc') as 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'
    const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10))
    const pageSize = Math.min(2000, Math.max(1, parseInt(url.searchParams.get('page_size') || '200', 10)))

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('expenses')
      .select('id, date, company_id, operator_id, category, cash_amount, kaspi_amount, comment, attachment_url')
      .range(page * pageSize, page * pageSize + pageSize - 1)

    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ data: [] })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }
    if (category) query = query.eq('category', category)
    if (payFilter === 'cash') query = query.gt('cash_amount', 0)
    else if (payFilter === 'kaspi') query = query.gt('kaspi_amount', 0)
    if (search && search.length >= 2) {
      // Экранируем спецсимволы LIKE-паттерна и PostgREST-синтаксиса
      const safeSearch = search
        .slice(0, 100)
        .replace(/[%_\\]/g, '\\$&')   // escape LIKE wildcards
        .replace(/[,().]/g, ' ')       // strip PostgREST .or() syntax delimiters
      query = query.or(`comment.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`)
    }

    if (sort === 'date_asc') query = query.order('date', { ascending: true })
    else if (sort === 'amount_desc') query = query.order('cash_amount', { ascending: false }).order('kaspi_amount', { ascending: false })
    else if (sort === 'amount_asc') query = query.order('cash_amount', { ascending: true }).order('kaspi_amount', { ascending: true })
    else query = query.order('date', { ascending: false })

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
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: body.payload.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })

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
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: existing.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })

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

    if (body.action === 'removeAttachment') {
      if (!canManageFinance) return json({ error: 'forbidden' }, 403)
      if (!body.expenseId?.trim()) return json({ error: 'expenseId обязателен' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('expenses')
        .select('id, company_id')
        .eq('id', body.expenseId)
        .single()
      if (existingError) throw existingError
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: existing.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })
      const { error } = await supabase.from('expenses').update({ attachment_url: null }).eq('id', body.expenseId)
      if (error) throw error
      return json({ ok: true })
    }

    if (!canManageFinance) return json({ error: 'forbidden' }, 403)
    if (!body.expenseId?.trim()) return json({ error: 'expenseId обязателен' }, 400)

    const { data: existing, error: existingError } = await supabase.from('expenses').select('*').eq('id', body.expenseId).single()
    if (existingError) throw existingError
    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: existing.company_id,
      isSuperAdmin: access.isSuperAdmin,
    })

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
