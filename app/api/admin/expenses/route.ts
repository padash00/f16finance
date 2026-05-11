import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
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
      force?: boolean
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
    const status = url.searchParams.get('status')
    const documentKind = url.searchParams.get('document_kind')
    const search = url.searchParams.get('search')
    const sort = (url.searchParams.get('sort') || 'date_desc') as 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'
    const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10))
    // Supabase / PostgREST имеет лимит `db-max-rows` (часто 1000). Запросы выше
    // упираются в 400 «Bad Request» без подробностей. Поэтому хочешь >1000 —
    // дробим на чанки по 1000 и склеиваем (ниже в while-цикле).
    const pageSize = Math.min(50000, Math.max(1, parseInt(url.searchParams.get('page_size') || '1000', 10)))

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Билдер с одинаковыми фильтрами — переиспользуем для пагинации >1000
    const buildBaseQuery = () => {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, operator_id, category, cash_amount, kaspi_amount, comment, attachment_url, status, document_kind, one_off_payee, created_at')
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      if (companyScope.allowedCompanyIds !== null) {
        q = q.in('company_id', companyScope.allowedCompanyIds!)
      }
      if (category) q = q.eq('category', category)
      if (status) q = q.eq('status', status)
      if (documentKind) q = q.eq('document_kind', documentKind)
      if (payFilter === 'cash') q = q.gt('cash_amount', 0)
      else if (payFilter === 'kaspi') q = q.gt('kaspi_amount', 0)
      if (search && search.length >= 2) {
        const safeSearch = search
          .slice(0, 100)
          .replace(/[%_\\]/g, '\\$&')
          .replace(/[,().]/g, ' ')
        q = q.or(`comment.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`)
      }
      if (sort === 'date_asc') q = q.order('date', { ascending: true })
      else if (sort === 'amount_desc') q = q.order('cash_amount', { ascending: false }).order('kaspi_amount', { ascending: false })
      else if (sort === 'amount_asc') q = q.order('cash_amount', { ascending: true }).order('kaspi_amount', { ascending: true })
      else q = q.order('date', { ascending: false })
      return q
    }

    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ data: [] })
    }

    // Подтягиваем чанками по 1000 чтобы не упереться в PostgREST max-rows.
    const CHUNK = 1000
    const startIdx = page * pageSize
    const rows: any[] = []
    let cursor = startIdx
    while (rows.length < pageSize) {
      const remaining = pageSize - rows.length
      const upper = cursor + Math.min(CHUNK, remaining) - 1
      const { data, error } = await buildBaseQuery().range(cursor, upper)
      if (error) throw error
      const batch = data ?? []
      rows.push(...batch)
      if (batch.length < CHUNK) break
      cursor += CHUNK
    }
    const expenseIds = rows.map((row: any) => String(row.id)).filter(Boolean)
    if (expenseIds.length === 0) return json({ data: rows })

    // Чанкуем .in() — длинный URL (>8KB) с сотнями UUID валит Vercel/PostgREST
    // в generic 400 «Bad Request» без подробностей. По 200 UUID на запрос — безопасно.
    const ATTACH_IN_CHUNK = 200
    const attachments: any[] = []
    for (let i = 0; i < expenseIds.length; i += ATTACH_IN_CHUNK) {
      const slice = expenseIds.slice(i, i + ATTACH_IN_CHUNK)
      const { data: chunkData, error: chunkError } = await supabase
        .from('expense_attachments')
        .select('id, expense_id, document_url, file_name, mime_type, file_size, sort_order, created_at')
        .in('expense_id', slice)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (chunkError) {
        if (chunkError.code === '42P01') break  // нет таблицы attachments — пропускаем целиком
        throw chunkError
      }
      if (chunkData) attachments.push(...chunkData)
    }

    const attachmentsByExpense = new Map<string, any[]>()
    for (const attachment of attachments || []) {
      const key = String((attachment as any).expense_id || '')
      if (!key) continue
      const list = attachmentsByExpense.get(key) || []
      list.push(attachment)
      attachmentsByExpense.set(key, list)
    }

    return json({
      data: rows.map((row: any) => {
        const rowAttachments = attachmentsByExpense.get(String(row.id)) || []
        return {
          ...row,
          attachments: rowAttachments,
          attachment_url: row.attachment_url || rowAttachments[0]?.document_url || null,
        }
      }),
    })
  } catch (error: any) {
    // Дамп всех свойств ошибки — Supabase иногда отдаёт «Bad Request» без detail/hint/code,
    // и реальные данные сидят в нестандартных полях. Сериализуем всё что есть.
    let fullDump: string | null = null
    try {
      fullDump = JSON.stringify(error, Object.getOwnPropertyNames(error || {}))
    } catch { fullDump = null }
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses GET',
      message: `${error?.message || 'error'} | dump=${fullDump || 'n/a'}`,
    })
    return json({
      error: humanizeDbError(error, error?.message || error?.details || error?.hint || error?.code || 'Ошибка сервера'),
      detail: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
      raw_message: error?.message || null,
      raw_dump: fullDump,
      raw_status: error?.status || error?.statusCode || null,
    }, 500)
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

    // Capability checks выше уже отсеивают; здесь — любой staff
    const canUpdateFinance = access.isSuperAdmin || !!access.staffRole
    const canDeleteFinance = access.isSuperAdmin || !!access.staffRole

    if (body.action === 'createExpense') {
      return json({
        error: 'Создание расхода доступно только через мастер. Откройте /expenses/new.',
        code: 'wizard-required',
      }, 410)
    }

    if (body.action === 'updateExpense') {
      const denied = await requireCapability(access, 'expenses.edit')
      if (denied) return denied as any
      if (!canUpdateFinance) return json({ error: 'forbidden' }, 403)
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
      if (!canUpdateFinance) return json({ error: 'forbidden' }, 403)
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

      const { error: attachmentDeleteError } = await supabase
        .from('expense_attachments')
        .delete()
        .eq('expense_id', body.expenseId)
      if (attachmentDeleteError && attachmentDeleteError.code !== '42P01') throw attachmentDeleteError

      return json({ ok: true })
    }

    // Дошли сюда — это deleteExpense (другие actions обработаны выше)
    const denied = await requireCapability(access, 'expenses.delete')
    if (denied) return denied as any
    if (!canDeleteFinance) return json({ error: 'forbidden' }, 403)
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
    return json({ error: humanizeDbError(error, 'Ошибка сервера') }, 500)
  }
}
