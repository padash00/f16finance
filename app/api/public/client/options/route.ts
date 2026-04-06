import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET() {
  if (!hasAdminSupabaseCredentials()) {
    return json({ error: 'registration-service-unavailable' }, 503)
  }

  try {
    const supabase = createAdminSupabaseClient()

    const [{ data: companies, error: companiesError }, { data: projects, error: projectsError }, { data: stations, error: stationsError }] =
      await Promise.all([
        supabase.from('companies').select('id, name, code').order('name', { ascending: true }),
        supabase
          .from('point_projects')
          .select('id, name, is_active, point_project_companies(company_id)')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase.from('arena_stations').select('point_project_id').eq('is_active', true),
      ])

    if (companiesError) throw companiesError
    if (projectsError) throw projectsError
    if (stationsError) throw stationsError

    const stationEnabledProjectIds = new Set((stations || []).map((s: any) => String(s.point_project_id || '')).filter(Boolean))

    const points = (projects || [])
      .filter((project: any) => stationEnabledProjectIds.has(String(project.id)))
      .map((project: any) => ({
        id: String(project.id),
        name: String(project.name || ''),
        companyIds: (Array.isArray(project.point_project_companies) ? project.point_project_companies : [])
          .map((item: any) => String(item.company_id || ''))
          .filter(Boolean),
      }))

    return json({
      ok: true,
      companies: (companies || []).map((company: any) => ({
        id: String(company.id),
        name: String(company.name || ''),
        code: String(company.code || ''),
      })),
      points,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'registration-options-failed' }, 500)
  }
}
