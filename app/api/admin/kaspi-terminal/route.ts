import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body =
  | { action: 'create'; payload: { date: string; company_id: string; amount: number; note?: string | null } }
  | { action: 'update'; id: string; payload: { date: string; company_id: string; amount: number; note?: string | null } }
  | { action: 'delete'; id: string }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const companyId = url.searchParams.get('company_id')

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('kaspi_terminal_daily')
      .select('id, date, company_id, amount, note, created_at')
      .order('date', { ascending: false })
      .limit(1000)

    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ data: [] })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kaspi-terminal GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const canManage = access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
    if (!canManage) return json({ error: 'forbidden' }, 403)

    const requestClient = createRequestSupabaseClient(req)
    const { data: { user } } = await requestClient.auth.getUser()
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'create') {
      const { date, company_id, amount, note } = body.payload
      if (!date?.trim()) return json({ error: 'Дата обязательна' }, 400)
      if (!company_id?.trim()) return json({ error: 'Компания обязательна' }, 400)
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Сумма должна быть больше 0' }, 400)
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: company_id,
        isSuperAdmin: access.isSuperAdmin,
      })

      const { data, error } = await supabase
        .from('kaspi_terminal_daily')
        .insert([{ date, company_id, amount, note: note?.trim() || null }])
        .select('*')
        .single()
      if (error) throw error

      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'kaspi_terminal', entityId: String(data.id), action: 'create', payload: { date, company_id, amount } })
      return json({ ok: true, data })
    }

    if (body.action === 'update') {
      if (!body.id?.trim()) return json({ error: 'id обязателен' }, 400)
      const { date, company_id, amount, note } = body.payload
      if (!date?.trim()) return json({ error: 'Дата обязательна' }, 400)
      if (!company_id?.trim()) return json({ error: 'Компания обязательна' }, 400)
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Сумма должна быть больше 0' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('kaspi_terminal_daily')
        .select('id, company_id')
        .eq('id', body.id)
        .single()
      if (existingError || !existing) return json({ error: 'not-found' }, 404)
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: existing.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: company_id,
        isSuperAdmin: access.isSuperAdmin,
      })

      const { data, error } = await supabase
        .from('kaspi_terminal_daily')
        .update({ date, company_id, amount, note: note?.trim() || null })
        .eq('id', body.id)
        .select('*')
        .single()
      if (error) throw error

      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'kaspi_terminal', entityId: body.id, action: 'update', payload: { date, company_id, amount } })
      return json({ ok: true, data })
    }

    if (body.action === 'delete') {
      if (!body.id?.trim()) return json({ error: 'id обязателен' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('kaspi_terminal_daily')
        .select('id, company_id')
        .eq('id', body.id)
        .single()
      if (existingError || !existing) return json({ error: 'not-found' }, 404)
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: existing.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })
      const { error } = await supabase.from('kaspi_terminal_daily').delete().eq('id', body.id)
      if (error) throw error

      await writeAuditLog(supabase, { actorUserId: user?.id || null, entityType: 'kaspi_terminal', entityId: body.id, action: 'delete' })
      return json({ ok: true })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kaspi-terminal POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
