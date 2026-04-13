import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { LinkedCustomerRow } from '@/lib/server/linked-customers'

/**
 * По выбранной станции арены находим точку (company) из профиля гостя и соответствующую строку customers.
 * Если проект привязан к нескольким клубам гостя — берём детерминированно первый по id (редкий случай).
 */
export async function resolveBookingCustomerFromStation(
  admin: SupabaseClient,
  linkedCustomers: LinkedCustomerRow[],
  stationId: string,
  explicitCompanyId?: string | null,
): Promise<{ ok: true; customerId: string; companyId: string } | { ok: false; error: string }> {
  const sid = String(stationId || '').trim()
  if (!sid) return { ok: false, error: 'station-invalid' }

  const profileCompanies = new Map(
    linkedCustomers
      .filter((c) => c.company_id)
      .map((c) => [String(c.company_id), { id: String(c.id), companyId: String(c.company_id) }]),
  )
  if (!profileCompanies.size) return { ok: false, error: 'customer-company-not-found' }

  const { data: station, error } = await admin
    .from('arena_stations')
    .select('id, company_id, point_project_id')
    .eq('id', sid)
    .maybeSingle()

  if (error) return { ok: false, error: 'station-lookup-failed' }
  if (!station?.id) return { ok: false, error: 'station-not-found' }

  let candidates: string[] = []
  const stCo = station.company_id ? String(station.company_id) : ''
  if (stCo && profileCompanies.has(stCo)) {
    candidates = [stCo]
  } else {
    const projectId = station.point_project_id ? String(station.point_project_id) : ''
    if (!projectId) return { ok: false, error: 'station-no-project' }

    const { data: links, error: linkErr } = await admin
      .from('point_project_companies')
      .select('company_id')
      .eq('project_id', projectId)

    if (linkErr) return { ok: false, error: 'station-project-lookup-failed' }

    const fromProject = uniqueCompanyIds((links || []).map((r: any) => String(r.company_id || '')))
    candidates = fromProject.filter((id) => profileCompanies.has(id)).sort()
  }

  if (!candidates.length) return { ok: false, error: 'station-not-in-profile' }

  const req = explicitCompanyId?.trim()
  if (req) {
    if (!candidates.includes(req)) {
      return { ok: false, error: 'company-not-in-profile' }
    }
    candidates = [req]
  }

  candidates.sort((a, b) => a.localeCompare(b))
  const chosenCompanyId = candidates[0]
  const hit = profileCompanies.get(chosenCompanyId)
  if (!hit) return { ok: false, error: 'customer-company-not-found' }

  return { ok: true, customerId: hit.id, companyId: hit.companyId }
}

function uniqueCompanyIds(ids: string[]) {
  return [...new Set(ids.map((v) => String(v || '').trim()).filter(Boolean))]
}
