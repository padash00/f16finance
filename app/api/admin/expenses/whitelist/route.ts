import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function getSupabase(req: Request) {
  return hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : createRequestSupabaseClient(req)
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    // Этот endpoint используется страницей /expense-whitelist И формой
    // создания расхода. Любой авторизованный staff/super-admin получает список.
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = getSupabase(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('expense_vendor_whitelist')
      .select('id, organization_id, company_id, vendor_name, default_category_id, notes, created_at, archived_at')
      .is('archived_at', null)
      .order('vendor_name')

    if (companyScope.allowedCompanyIds) {
      if (companyScope.allowedCompanyIds.length === 0) return json({ data: [] })
      query = query.or(`company_id.is.null,company_id.in.(${companyScope.allowedCompanyIds.join(',')})`)
    }

    const { data, error } = await query
    if (error) throw error
    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/whitelist GET',
      message: error?.message || 'whitelist list failed',
    })
    console.error('[expenses/whitelist GET]', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'expense-whitelist.create')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json().catch(() => null) as {
      vendor_name?: string
      company_id?: string | null
      default_category_id?: string | null
      notes?: string | null
    } | null

    const vendorName = String(body?.vendor_name || '').trim()
    if (!vendorName) return json({ error: 'Имя вендора обязательно' }, 400)

    const supabase = getSupabase(req)

    if (body?.company_id) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: body.company_id,
        isSuperAdmin: access.isSuperAdmin,
      })
    }

    const { data, error } = await supabase
      .from('expense_vendor_whitelist')
      .insert([{
        organization_id: access.activeOrganization?.id || null,
        company_id: body?.company_id || null,
        vendor_name: vendorName,
        default_category_id: body?.default_category_id || null,
        notes: body?.notes?.trim() || null,
        created_by: access.user?.id || null,
      }])
      .select('*')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_vendor_whitelist',
      entityId: String(data.id),
      action: 'create',
      payload: { vendor_name: vendorName, company_id: body?.company_id || null },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/whitelist POST',
      message: error?.message || 'whitelist create failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'expense-whitelist.edit')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json().catch(() => null) as {
      id?: string
      vendor_name?: string
      company_id?: string | null
      default_category_id?: string | null
      notes?: string | null
    } | null

    const id = String(body?.id || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)

    const supabase = getSupabase(req)

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body?.vendor_name === 'string') update.vendor_name = body.vendor_name.trim()
    if (body?.company_id !== undefined) {
      if (body.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: body.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }
      update.company_id = body.company_id || null
    }
    if (body?.default_category_id !== undefined) update.default_category_id = body.default_category_id || null
    if (body?.notes !== undefined) update.notes = body.notes?.trim() || null

    const { data, error } = await supabase
      .from('expense_vendor_whitelist')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_vendor_whitelist',
      entityId: String(id),
      action: 'update',
      payload: update,
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/whitelist PATCH',
      message: error?.message || 'whitelist update failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'expense-whitelist.delete')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const id = String(new URL(req.url).searchParams.get('id') || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)

    const supabase = getSupabase(req)
    const { error } = await supabase
      .from('expense_vendor_whitelist')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_vendor_whitelist',
      entityId: String(id),
      action: 'archive',
      payload: { id },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/whitelist DELETE',
      message: error?.message || 'whitelist delete failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
