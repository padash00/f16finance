import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability, requireStaffCapability } from '@/lib/server/capabilities'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type MutationBody =
  | {
      entity: 'company'
      action: 'create'
      payload: { name: string; code?: string | null; show_in_structure?: boolean | null }
    }
  | {
      entity: 'company'
      action: 'update'
      id: string
      payload: { name: string; code?: string | null; show_in_structure?: boolean | null }
    }
  | {
      entity: 'company'
      action: 'delete'
      id: string
    }
  | {
      entity: 'staff'
      action: 'create'
      payload: { name: string; phone?: string | null; email?: string | null; role?: string | null }
    }
  | {
      entity: 'staff'
      action: 'update'
      id: string
      payload: { name: string; phone?: string | null; email?: string | null; role?: string | null }
    }
  | {
      entity: 'staff'
      action: 'delete'
      id: string
    }
  | {
      entity: 'expense_category'
      action: 'create'
      payload: { name: string; monthly_budget?: number | null; accounting_group?: string | null }
    }
  | {
      entity: 'expense_category'
      action: 'update'
      id: string
      payload: { name: string; monthly_budget?: number | null; accounting_group?: string | null }
    }
  | {
      entity: 'expense_category'
      action: 'delete'
      id: string
    }

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
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

    const supabase = getSupabase(req)

    // Изоляция: не-супер-админ видит только компании/команду/категории своей орг.
    // (service-role обходит RLS → фильтруем явно по organization_id.) NEVER-pattern:
    // без валидной орг — пустой uuid → ничего.
    const orgId = access.activeOrganization?.id || null
    const scopeOrg = access.isSuperAdmin ? null : (orgId || '00000000-0000-0000-0000-000000000000')

    let companiesQuery = supabase.from('companies').select('id, name, code, show_in_structure').order('name')
    let staffQuery = supabase.from('staff').select('id, full_name, phone, email, role, is_active').eq('is_active', true).order('full_name')
    let categoriesQuery = supabase.from('expense_categories').select('id, name, monthly_budget, accounting_group').order('name')
    if (scopeOrg) {
      companiesQuery = companiesQuery.eq('organization_id', scopeOrg)
      staffQuery = staffQuery.eq('organization_id', scopeOrg)
      categoriesQuery = categoriesQuery.eq('organization_id', scopeOrg)
    }

    const [companiesRes, staffRes, categoriesRes] = await Promise.allSettled([
      companiesQuery,
      staffQuery,
      categoriesQuery,
    ])

    const companies =
      companiesRes.status === 'fulfilled' && !companiesRes.value.error
        ? companiesRes.value.data || []
        : []
    const staff =
      staffRes.status === 'fulfilled' && !staffRes.value.error
        ? staffRes.value.data || []
        : []
    const categories =
      categoriesRes.status === 'fulfilled' && !categoriesRes.value.error
        ? categoriesRes.value.data || []
        : []

    const readErrors = [
      companiesRes.status === 'fulfilled' ? companiesRes.value.error : companiesRes.reason,
      staffRes.status === 'fulfilled' ? staffRes.value.error : staffRes.reason,
      categoriesRes.status === 'fulfilled' ? categoriesRes.value.error : categoriesRes.reason,
    ].filter(Boolean)

    if (readErrors.length > 0) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/settings GET partial',
        message: readErrors
          .map((entry: any) => entry?.message || String(entry))
          .join(' | '),
      })
    }

    return NextResponse.json({
      companies,
      staff,
      categories,
    })
  } catch (error: any) {
    console.error('Admin settings read error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/settings GET',
      message: error?.message || 'Admin settings read error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    // Доступ к настройкам — для super_admin или любого staff с нужной capability
    // (capability проверяется ниже per-entity)
    if (!access.isSuperAdmin && !access.staffRole) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.entity || !body?.action) return badRequest('Неверный формат запроса')

    const supabase = getSupabase(req)
    const actorUserId = access.user?.id || null

    if (body.entity === 'company') {
      // Капабилити-проверка зависит от действия
      const capForCompany =
        body.action === 'delete' ? 'settings.delete_company' : 'settings.manage_companies'
      const denied = await requireCapability(access, capForCompany)
      if (denied) return denied as any

      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { data, error } = await supabase.from('companies').insert([
          {
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
            show_in_structure: body.payload.show_in_structure !== false,
            organization_id: access.activeOrganization?.id || null,
          },
        ]).select('id,name,code,show_in_structure').single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'company',
          entityId: String(data.id),
          action: 'create',
          payload: { name: data.name, code: data.code, show_in_structure: data.show_in_structure },
        })
        return NextResponse.json({ ok: true })
      }

      if (!body.id) return badRequest('id обязателен')

      if (body.action === 'update') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { data, error } = await supabase
          .from('companies')
          .update({
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
            show_in_structure: body.payload.show_in_structure !== false,
          })
          .eq('id', body.id)
          .select('id,name,code,show_in_structure')
          .single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'company',
          entityId: String(data.id),
          action: 'update',
          payload: { name: data.name, code: data.code, show_in_structure: data.show_in_structure },
        })
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('companies').delete().eq('id', body.id)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'company',
        entityId: body.id,
        action: 'delete',
      })
      return NextResponse.json({ ok: true })
    }

    if (body.entity === 'staff') {
      // Создание/правка сотрудника (вкл. смену role) — staff + управление ролями.
      const deniedStaff = await requireStaffCapability(access, 'access.manage_staff_roles')
      if (deniedStaff) return deniedStaff
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
        const { data, error } = await supabase.from('staff').insert([
          {
            full_name: body.payload.name.trim(),
            phone: body.payload.phone?.trim() || null,
            email: body.payload.email?.trim() || null,
            role: body.payload.role?.trim() || 'operator',
            organization_id: access.activeOrganization?.id || null,
          },
        ]).select('id,full_name,email,role').single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'staff',
          entityId: String(data.id),
          action: 'create',
          payload: { full_name: data.full_name, email: data.email, role: data.role },
        })
        return NextResponse.json({ ok: true })
      }

      if (!body.id) return badRequest('id обязателен')

      if (body.action === 'update') {
        if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
        const { data, error } = await supabase
          .from('staff')
          .update({
            full_name: body.payload.name.trim(),
            phone: body.payload.phone?.trim() || null,
            email: body.payload.email?.trim() || null,
            role: body.payload.role?.trim() || 'operator',
          })
          .eq('id', body.id)
          .select('id,full_name,email,role')
          .single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'staff',
          entityId: String(data.id),
          action: 'update',
          payload: { full_name: data.full_name, email: data.email, role: data.role },
        })
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('staff').delete().eq('id', body.id)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'staff',
        entityId: body.id,
        action: 'delete',
      })
      return NextResponse.json({ ok: true })
    }

    if (body.entity === 'expense_category') {
      const denied = await requireCapability(access, 'settings.manage_categories')
      if (denied) return denied as any

      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название категории обязательно')
        const { data, error } = await supabase.from('expense_categories').insert([
          {
            name: body.payload.name.trim(),
            monthly_budget: body.payload.monthly_budget ?? null,
            accounting_group: body.payload.accounting_group || null,
          },
        ]).select('id,name,monthly_budget,accounting_group').single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'expense_category',
          entityId: String(data.id),
          action: 'create',
          payload: { name: data.name, monthly_budget: data.monthly_budget, accounting_group: data.accounting_group },
        })
        return NextResponse.json({ ok: true })
      }

      if (!body.id) return badRequest('id обязателен')

      if (body.action === 'update') {
        if (!body.payload.name?.trim()) return badRequest('Название категории обязательно')
        const { data, error } = await supabase
          .from('expense_categories')
          .update({
            name: body.payload.name.trim(),
            monthly_budget: body.payload.monthly_budget ?? null,
            accounting_group: body.payload.accounting_group || null,
          })
          .eq('id', body.id)
          .select('id,name,monthly_budget,accounting_group')
          .single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'expense_category',
          entityId: String(data.id),
          action: 'update',
          payload: { name: data.name, monthly_budget: data.monthly_budget, accounting_group: data.accounting_group },
        })
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase
        .from('expense_categories')
        .delete()
        .eq('id', body.id)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'expense_category',
        entityId: body.id,
        action: 'delete',
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Неизвестный entity' }, { status: 400 })
  } catch (error: any) {
    console.error('Admin settings mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/settings',
      message: error?.message || 'Admin settings mutation error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
