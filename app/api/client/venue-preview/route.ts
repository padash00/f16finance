import { NextResponse } from 'next/server'

import { getRequestCustomerContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type ArenaRow = Record<string, unknown>

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))]
}

export async function GET(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'client-api-requires-admin-credentials' }, 503)
    }

    const url = new URL(request.url)
    const requestedCompany = url.searchParams.get('companyId')?.trim() || null
    const linkedCompanyIds = uniqueStrings(context.linkedCompanyIds)
    const multiCompany = linkedCompanyIds.length > 1

    /** Без выбора точки: отдаём схемы по всем клубам профиля сразу. */
    const scopedCompanyIds =
      requestedCompany && linkedCompanyIds.includes(requestedCompany) ? [requestedCompany] : linkedCompanyIds

    if (!scopedCompanyIds.length) {
      return json({
        ok: true,
        companies: [],
        projects: [],
        multiCompany: false,
      })
    }

    const admin = createAdminSupabaseClient()

    const [{ data: companyRows, error: companiesError }, { data: linkRows, error: linksError }] = await Promise.all([
      admin.from('companies').select('id, name').in('id', scopedCompanyIds),
      admin.from('point_project_companies').select('project_id, company_id, feature_flags').in('company_id', scopedCompanyIds),
    ])

    if (companiesError) throw companiesError
    if (linksError) throw linksError

    const projectIds = uniqueStrings((linkRows || []).map((r: any) => String(r.project_id || '')))
    if (!projectIds.length) {
      return json({
        ok: true,
        companies: (companyRows || []).map((c: any) => ({
          id: c.id,
          name: c.name,
        })),
        projects: [],
        multiCompany,
      })
    }

    const { data: projectRows, error: projectsError } = await admin
      .from('point_projects')
      .select('id, name, feature_flags')
      .in('id', projectIds)

    if (projectsError) throw projectsError

    const projectsOut: {
      id: string
      name: string
      companyIds: string[]
      zones: ArenaRow[]
      stations: ArenaRow[]
      decorations: ArenaRow[]
    }[] = []

    for (const project of projectRows || []) {
      const projectId = String((project as any).id || '')
      if (!projectId) continue

      const projectCompanyLinks = (linkRows || []).filter((r: any) => String(r.project_id || '') === projectId)
      const projectCompanyIds = uniqueStrings(projectCompanyLinks.map((r: any) => String(r.company_id || ''))).filter((id) =>
        scopedCompanyIds.includes(id),
      )

      const [{ data: zones }, { data: stations }, { data: decorations }] = await Promise.all([
        admin
          .from('arena_zones')
          .select('id, name, grid_x, grid_y, grid_w, grid_h, color, company_id, point_project_id')
          .eq('point_project_id', projectId),
        admin
          .from('arena_stations')
          .select('id, name, grid_x, grid_y, order_index, is_active, company_id, point_project_id')
          .eq('point_project_id', projectId),
        admin
          .from('arena_map_decorations')
          .select('id, type, grid_x, grid_y, grid_w, grid_h, label, rotation, company_id, point_project_id')
          .eq('point_project_id', projectId),
      ])

      const filterForProject = (rows: ArenaRow[] | null) =>
        (rows || []).filter((row: any) => {
          const cid = row.company_id ? String(row.company_id) : ''
          if (!cid) return true
          return scopedCompanyIds.includes(cid)
        })

      projectsOut.push({
        id: projectId,
        name: String((project as any).name || 'Проект'),
        companyIds: projectCompanyIds,
        zones: filterForProject(zones as ArenaRow[] | null),
        stations: filterForProject(stations as ArenaRow[] | null),
        decorations: filterForProject(decorations as ArenaRow[] | null),
      })
    }

    return json({
      ok: true,
      companies: (companyRows || []).map((c: any) => ({
        id: c.id,
        name: c.name,
      })),
      projects: projectsOut,
      multiCompany,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'client-venue-preview-failed' }, 500)
  }
}
