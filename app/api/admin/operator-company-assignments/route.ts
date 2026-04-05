import { NextResponse } from 'next/server'

import {
  assertOrganizationLimitAvailable,
  ensureOrganizationOperatorAccess,
  listOrganizationOperatorIds,
  resolveCompanyScope,
} from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type CompanyRole = 'operator' | 'senior_operator' | 'senior_cashier'

type AssignmentPayload = {
  id?: string
  company_id: string
  role_in_company: CompanyRole
  is_primary?: boolean
  is_active?: boolean
  notes?: string | null
}

type Body = {
  action: 'saveAssignments'
  operatorId: string
  assignments: AssignmentPayload[]
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeAssignments(assignments: AssignmentPayload[]) {
  const normalized = assignments
    .filter((item) => item.company_id?.trim())
    .map((item) => ({
      id: item.id?.trim() || null,
      company_id: item.company_id.trim(),
      role_in_company: item.role_in_company,
      is_primary: !!item.is_primary,
      is_active: item.is_active !== false,
      notes: item.notes?.trim() || null,
    }))

  const uniqueCompanyIds = new Set<string>()
  for (const item of normalized) {
    if (uniqueCompanyIds.has(item.company_id)) {
      throw new Error('Нельзя назначить одну и ту же компанию дважды')
    }
    uniqueCompanyIds.add(item.company_id)
  }

  const activeItems = normalized.filter((item) => item.is_active)
  if (activeItems.length > 2) {
    throw new Error('Оператор может быть назначен максимум на 2 активные компании')
  }

  if (activeItems.length > 0 && !activeItems.some((item) => item.is_primary)) {
    activeItems[0].is_primary = true
  }

  let primaryUsed = false
  for (const item of normalized) {
    if (!item.is_active) {
      item.is_primary = false
      continue
    }

    if (item.is_primary && !primaryUsed) {
      primaryUsed = true
      continue
    }

    if (item.is_primary && primaryUsed) {
      item.is_primary = false
    }
  }

  return normalized
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operator_structure')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    const { searchParams } = new URL(req.url)
    const operatorId = searchParams.get('operatorId')?.trim()
    if (!operatorId) return json({ error: 'operatorId обязателен' }, 400)

    let query = supabase
      .from('operator_company_assignments')
      .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes, created_at, updated_at, company:company_id(id, name, code)')
      .eq('operator_id', operatorId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds) {
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query

    if (error) throw error

    return json({ ok: true, data: data || [] })
  } catch (error: any) {
    console.error('Operator company assignments GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operator-company-assignments:get',
      message: error?.message || 'Operator company assignments GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operator_structure')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const body = (await req.json().catch(() => null)) as Body | null

    if (body?.action !== 'saveAssignments') {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const operatorId = body.operatorId?.trim()
    if (!operatorId) return json({ error: 'operatorId обязателен' }, 400)

    const normalized = normalizeAssignments(Array.isArray(body.assignments) ? body.assignments : [])
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    for (const item of normalized) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: item.company_id,
      })
    }

    const { data: existingRows, error: existingError } = await supabase
      .from('operator_company_assignments')
      .select('id, company_id, role_in_company, is_primary, is_active, notes, company:company_id(organization_id)')
      .eq('operator_id', operatorId)

    if (existingError) throw existingError

    const existingCompanyRows = (existingRows || []) as any[]
    const foreignRow = companyScope.allowedCompanyIds
      ? existingCompanyRows.find((row) => {
          const company = Array.isArray(row.company) ? row.company[0] || null : row.company || null
          const organizationId = String(company?.organization_id || '')
          return organizationId && organizationId !== String(access.activeOrganization?.id || '')
        })
      : null
    if (foreignRow) {
      return json({ error: 'forbidden-operator' }, 403)
    }

    if (existingCompanyRows.length > 0) {
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId,
      })
    }

    const nextHasActiveAssignments = normalized.some((item) => item.is_active)
    if (nextHasActiveAssignments) {
      const organizationOperatorIds = await listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      })
      const alreadyCountedInOrganization = organizationOperatorIds?.includes(operatorId) ?? true

      if (!alreadyCountedInOrganization) {
        await assertOrganizationLimitAvailable({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          activeSubscription: access.activeSubscription,
          key: 'operators',
        })
      }
    }

    const existingById = new Map((existingRows || []).map((row) => [row.id as string, row]))
    const keepIds = new Set(normalized.map((item) => item.id).filter(Boolean) as string[])
    const deleteIds = (existingRows || [])
      .filter((row) => !keepIds.has(String(row.id)))
      .map((row) => String(row.id))

    const { error: resetPrimaryError } = await supabase
      .from('operator_company_assignments')
      .update({ is_primary: false })
      .eq('operator_id', operatorId)

    if (resetPrimaryError) throw resetPrimaryError

    for (const item of normalized) {
      const payload = {
        operator_id: operatorId,
        company_id: item.company_id,
        role_in_company: item.role_in_company,
        is_primary: item.is_primary,
        is_active: item.is_active,
        notes: item.notes,
        assigned_by: user?.id || null,
      }

      if (item.id && existingById.has(item.id)) {
        const { error } = await supabase.from('operator_company_assignments').update(payload).eq('id', item.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('operator_company_assignments').insert([payload])
        if (error) throw error
      }
    }

    if (deleteIds.length > 0) {
      const { error } = await supabase.from('operator_company_assignments').delete().in('id', deleteIds)
      if (error) throw error
    }

    const { data: freshRows, error: freshError } = await supabase
      .from('operator_company_assignments')
      .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes, created_at, updated_at, company:company_id(id, name, code)')
      .eq('operator_id', operatorId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (freshError) throw freshError

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'operator-company-assignment',
      entityId: operatorId,
      action: 'save',
      payload: {
        operator_id: operatorId,
        previous_count: existingRows?.length || 0,
        next_count: freshRows?.length || 0,
        removed_ids: deleteIds,
        assignments: (freshRows || []).map((row: any) => ({
          id: row.id,
          company_id: row.company_id,
          company_name: row.company?.name || null,
          role_in_company: row.role_in_company,
          is_primary: row.is_primary,
          is_active: row.is_active,
        })),
      },
    })

    return json({ ok: true, data: freshRows || [] })
  } catch (error: any) {
    console.error('Operator company assignments POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operator-company-assignments:post',
      message: error?.message || 'Operator company assignments POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
