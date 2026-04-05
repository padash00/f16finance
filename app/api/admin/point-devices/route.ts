import { NextResponse } from 'next/server'

import { assertOrganizationLimitAvailable, resolveCompanyScope } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type PointFeatureFlags = {
  shift_report: boolean
  income_report: boolean
  debt_report: boolean
  kaspi_daily_split: boolean
  arena_enabled?: boolean
  /** Экран смены подставляет суммы из сессий арены (Electron). */
  arena_shift_auto_totals?: boolean
}

type CompanyAssignment = {
  company_id: string
  point_mode?: string | null
  feature_flags?: Partial<PointFeatureFlags> | null
}

type Body =
  | {
      action: 'createProject'
      payload: {
        name: string
        point_mode: string
        company_assignments: CompanyAssignment[]
        shift_report_chat_id?: string | null
        notes?: string | null
        feature_flags?: Partial<PointFeatureFlags> | null
      }
    }
  | {
      action: 'updateProject'
      projectId: string
      payload: {
        name: string
        point_mode: string
        company_assignments: CompanyAssignment[]
        shift_report_chat_id?: string | null
        notes?: string | null
        feature_flags?: Partial<PointFeatureFlags> | null
      }
    }
  | {
      action: 'toggleProjectActive'
      projectId: string
      is_active: boolean
    }
  | {
      action: 'rotateProjectToken'
      projectId: string
    }
  | {
      action: 'deleteProject'
      projectId: string
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function badRequest(message: string) {
  return json({ error: message }, 400)
}

function normalizeFlags(input: Partial<PointFeatureFlags> | null | undefined): PointFeatureFlags {
  const flags: PointFeatureFlags = {
    shift_report: input?.shift_report !== false,
    income_report: input?.income_report !== false,
    debt_report: input?.debt_report === true,
    kaspi_daily_split: input?.kaspi_daily_split === true,
  }
  // arena_* are per-point flags, store only if explicitly provided
  if (input?.arena_enabled !== undefined) {
    flags.arena_enabled = input.arena_enabled === true
  }
  if (input?.arena_shift_auto_totals !== undefined) {
    flags.arena_shift_auto_totals = input.arena_shift_auto_totals === true
  }
  return flags
}

function normalizeShiftReportChatId(value: string | null | undefined) {
  const chatId = String(value || '').trim()
  if (!chatId) return null
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('Неверный формат Telegram chat ID')
  }
  return chatId
}

function mapProjectRow(row: any) {
  const companies = Array.isArray(row.point_project_companies)
    ? row.point_project_companies.map((c: any) => {
        const co = Array.isArray(c.company) ? c.company[0] || null : c.company || null
        return {
          id: c.company_id,
          name: co?.name || '',
          code: co?.code || null,
          point_mode: c.point_mode || null,
          feature_flags: c.feature_flags || null,
        }
      })
    : []
  return {
    id: row.id,
    name: row.name,
    project_token: row.project_token,
    point_mode: row.point_mode,
    feature_flags: normalizeFlags(row.feature_flags),
    shift_report_chat_id: row.shift_report_chat_id || null,
    is_active: row.is_active,
    notes: row.notes || null,
    last_seen_at: row.last_seen_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    companies,
  }
}

const PROJECT_SELECT = 'id, name, project_token, point_mode, feature_flags, shift_report_chat_id, is_active, notes, last_seen_at, created_at, updated_at, point_project_companies(company_id, point_mode, feature_flags, company:company_id(id, name, code))'

function filterProjectsByCompanyScope(projects: any[], allowedCompanyIds: string[] | null) {
  if (!allowedCompanyIds) return projects
  return projects
    .map((project) => {
      const companies = Array.isArray(project.point_project_companies) ? project.point_project_companies : []
      return {
        ...project,
        point_project_companies: companies.filter((item: any) => allowedCompanyIds.includes(String(item.company_id || ''))),
      }
    })
    .filter((project) => project.point_project_companies.length > 0)
}

async function ensureProjectAccess(supabase: any, projectId: string, allowedCompanyIds: string[] | null) {
  if (!allowedCompanyIds) return
  const { data, error } = await supabase
    .from('point_project_companies')
    .select('company_id')
    .eq('project_id', projectId)

  if (error) throw error
  const hasAccess = (data || []).some((row: any) => allowedCompanyIds.includes(String(row.company_id || '')))
  if (!hasAccess) throw new Error('forbidden-project')
}

async function getContext(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access

  if (!access.isSuperAdmin && access.staffRole !== 'owner') {
    return {
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return access
}

export async function GET(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const [{ data: companies, error: companiesError }, { data: projects, error: projectsError }] = await Promise.all([
      companyScope.allowedCompanyIds
        ? supabase.from('companies').select('id, name, code').in('id', companyScope.allowedCompanyIds).order('name', { ascending: true })
        : supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
      supabase
        .from('point_projects')
        .select(PROJECT_SELECT)
        .order('created_at', { ascending: false }),
    ])

    if (companiesError) throw companiesError
    if (projectsError) throw projectsError

    return json({
      ok: true,
      data: {
        companies: companies || [],
        projects: filterProjectsByCompanyScope((projects || []) as any[], companyScope.allowedCompanyIds).map(mapProjectRow),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-devices:get',
      message: error?.message || 'Point projects GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить проекты' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action) return badRequest('Неверный формат запроса')
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    if (body.action === 'createProject') {
      if (!body.payload.name?.trim()) return badRequest('Название проекта обязательно')
      if (!body.payload.point_mode?.trim()) return badRequest('Режим точки обязателен')
      const assignments: CompanyAssignment[] = Array.isArray(body.payload.company_assignments)
        ? body.payload.company_assignments
        : []
      if (assignments.length === 0) return badRequest('Нужно добавить хотя бы одну точку в проект')
      for (const assignment of assignments) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: assignment.company_id,
        })
      }

      await assertOrganizationLimitAvailable({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        activeSubscription: access.activeSubscription,
        key: 'point_projects',
      })

      const initialToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const { data: project, error: projectError } = await supabase
        .from('point_projects')
        .insert([{
          name: body.payload.name.trim(),
          project_token: initialToken,
          point_mode: body.payload.point_mode.trim(),
          shift_report_chat_id: normalizeShiftReportChatId(body.payload.shift_report_chat_id),
          notes: body.payload.notes?.trim() || null,
          feature_flags: normalizeFlags(body.payload.feature_flags),
        }])
        .select('id, name')
        .single()

      if (projectError) throw projectError

      const companyRows = assignments.map((a) => ({
        project_id: project.id,
        company_id: a.company_id,
        point_mode: a.point_mode?.trim() || null,
        feature_flags: a.feature_flags ? normalizeFlags(a.feature_flags) : null,
      }))
      const { error: companiesError } = await supabase
        .from('point_project_companies')
        .insert(companyRows)

      if (companiesError) throw companiesError

      const { data: full, error: fullError } = await supabase
        .from('point_projects')
        .select(PROJECT_SELECT)
        .eq('id', project.id)
        .single()

      if (fullError) throw fullError
      const scopedProject = filterProjectsByCompanyScope([full], companyScope.allowedCompanyIds)[0]
      if (!scopedProject) return json({ error: 'forbidden-project' }, 403)

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-project',
        entityId: String(project.id),
        action: 'create',
        payload: { name: project.name, company_ids: assignments.map((a) => a.company_id) },
      })

      return json({ ok: true, data: mapProjectRow(scopedProject) })
    }

    if (!('projectId' in body) || !body.projectId?.trim()) return badRequest('projectId обязателен')
    const projectId = body.projectId
    await ensureProjectAccess(supabase, projectId, companyScope.allowedCompanyIds)

    if (body.action === 'updateProject') {
      if (!body.payload.name?.trim()) return badRequest('Название проекта обязательно')
      if (!body.payload.point_mode?.trim()) return badRequest('Режим точки обязателен')
      const assignments: CompanyAssignment[] = Array.isArray(body.payload.company_assignments)
        ? body.payload.company_assignments
        : []
      if (assignments.length === 0) return badRequest('Нужно добавить хотя бы одну точку в проект')
      for (const assignment of assignments) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: assignment.company_id,
        })
      }

      const { error: updateError } = await supabase
        .from('point_projects')
        .update({
          name: body.payload.name.trim(),
          point_mode: body.payload.point_mode.trim(),
          shift_report_chat_id: normalizeShiftReportChatId(body.payload.shift_report_chat_id),
          notes: body.payload.notes?.trim() || null,
          feature_flags: normalizeFlags(body.payload.feature_flags),
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId)

      if (updateError) throw updateError

      await supabase.from('point_project_companies').delete().eq('project_id', projectId)
      const companyRows = assignments.map((a) => ({
        project_id: projectId,
        company_id: a.company_id,
        point_mode: a.point_mode?.trim() || null,
        feature_flags: a.feature_flags ? normalizeFlags(a.feature_flags) : null,
      }))
      const { error: insertError } = await supabase.from('point_project_companies').insert(companyRows)
      if (insertError) throw insertError

      const { data: full, error: fullError } = await supabase
        .from('point_projects')
        .select(PROJECT_SELECT)
        .eq('id', projectId)
        .single()

      if (fullError) throw fullError

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-project',
        entityId: projectId,
        action: 'update',
        payload: { name: body.payload.name, company_ids: assignments.map((a) => a.company_id) },
      })

      const scopedProject = filterProjectsByCompanyScope([full], companyScope.allowedCompanyIds)[0]
      if (!scopedProject) return json({ error: 'forbidden-project' }, 403)
      return json({ ok: true, data: mapProjectRow(scopedProject) })
    }

    if (body.action === 'toggleProjectActive') {
      const { data, error } = await supabase
        .from('point_projects')
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq('id', projectId)
        .select(PROJECT_SELECT)
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-project',
        entityId: projectId,
        action: body.is_active ? 'activate' : 'deactivate',
        payload: { name: data.name },
      })

      const scopedProject = filterProjectsByCompanyScope([data], companyScope.allowedCompanyIds)[0]
      if (!scopedProject) return json({ error: 'forbidden-project' }, 403)
      return json({ ok: true, data: mapProjectRow(scopedProject) })
    }

    if (body.action === 'rotateProjectToken') {
      const nextToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const { data, error } = await supabase
        .from('point_projects')
        .update({ project_token: nextToken, updated_at: new Date().toISOString() })
        .eq('id', projectId)
        .select(PROJECT_SELECT)
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'point-project',
        entityId: projectId,
        action: 'rotate-token',
        payload: { name: data.name },
      })

      const scopedProject = filterProjectsByCompanyScope([data], companyScope.allowedCompanyIds)[0]
      if (!scopedProject) return json({ error: 'forbidden-project' }, 403)
      return json({ ok: true, data: mapProjectRow(scopedProject) })
    }

    const { error: deleteError } = await supabase.from('point_projects').delete().eq('id', projectId)
    if (deleteError) throw deleteError

    await writeAuditLog(supabase, {
      actorUserId,
      entityType: 'point-project',
      entityId: projectId,
      action: 'delete',
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/point-devices:post',
      message: error?.message || 'Point projects POST error',
    })
    return json({ error: error?.message || 'Не удалось сохранить проект точки' }, 500)
  }
}
