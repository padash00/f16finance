import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

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

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const activeOrgId = access.activeOrganization?.id || null
    if (!activeOrgId) {
      return badRequest('active-organization-required')
    }

    const supabase = createAdminSupabaseClient()
    const [companiesRes, staffRes, categoriesRes] = await Promise.all([
      supabase
        .from('companies')
        .select('id, name, code, show_in_structure')
        .eq('organization_id', activeOrgId)
        .order('name'),
      supabase
        .from('staff')
        .select('id, full_name, phone, email, role')
        .eq('organization_id', activeOrgId)
        .order('full_name'),
      supabase
        .from('expense_categories')
        .select('id, name, monthly_budget, accounting_group, organization_id')
        .eq('organization_id', activeOrgId)
        .order('name'),
    ])

    if (companiesRes.error) throw companiesRes.error
    if (staffRes.error) throw staffRes.error
    if (categoriesRes.error) throw categoriesRes.error

    let companies = companiesRes.data || []
    let staff = staffRes.data || []
    let categories = categoriesRes.data || []

    if (companies.length === 0) {
      const legacyCompanies = await supabase
        .from('companies')
        .select('id, name, code, show_in_structure')
        .order('name')
      if (legacyCompanies.error) throw legacyCompanies.error
      companies = legacyCompanies.data || []
    }

    if (staff.length === 0) {
      const legacyStaff = await supabase
        .from('staff')
        .select('id, full_name, phone, email, role')
        .order('full_name')
      if (legacyStaff.error) throw legacyStaff.error
      staff = legacyStaff.data || []
    }

    if (categories.length === 0) {
      const legacyCategories = await supabase
        .from('expense_categories')
        .select('id, name, monthly_budget, accounting_group, organization_id')
        .order('name')
      if (legacyCategories.error) throw legacyCategories.error
      categories = legacyCategories.data || []
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
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.entity || !body?.action) return badRequest('Неверный формат запроса')

    const supabase = createAdminSupabaseClient()
    const actorUserId = access.user?.id || null
    const activeOrgId = access.activeOrganization?.id || null

    if (!activeOrgId) {
      return badRequest('Сначала выберите организацию в platform dashboard.')
    }

    if (body.entity === 'company') {
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { data, error } = await supabase.from('companies').insert([
          {
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
            show_in_structure: body.payload.show_in_structure !== false,
            organization_id: activeOrgId,
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
          .eq('organization_id', activeOrgId)
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

      const { error } = await supabase.from('companies').delete().eq('id', body.id).eq('organization_id', activeOrgId)
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
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
        const { data, error } = await supabase.from('staff').insert([
          {
            full_name: body.payload.name.trim(),
            phone: body.payload.phone?.trim() || null,
            email: body.payload.email?.trim() || null,
            role: body.payload.role?.trim() || 'operator',
            organization_id: activeOrgId,
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
          .eq('organization_id', activeOrgId)
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

      const { error } = await supabase.from('staff').delete().eq('id', body.id).eq('organization_id', activeOrgId)
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
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название категории обязательно')
        const { data, error } = await supabase.from('expense_categories').insert([
          {
            name: body.payload.name.trim(),
            monthly_budget: body.payload.monthly_budget ?? null,
            accounting_group: body.payload.accounting_group || null,
            organization_id: activeOrgId,
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
          .eq('organization_id', activeOrgId)
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
        .eq('organization_id', activeOrgId)
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
