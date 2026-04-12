import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/** Станция должна относиться к точке гостя (через point_project_companies) и не к чужой company_id. */
export async function assertArenaStationForCompanyBooking(
  admin: SupabaseClient,
  stationId: string,
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = String(stationId || '').trim()
  const cid = String(companyId || '').trim()
  if (!sid) return { ok: false, error: 'station-invalid' }

  const { data: station, error } = await admin
    .from('arena_stations')
    .select('id, company_id, point_project_id')
    .eq('id', sid)
    .maybeSingle()

  if (error) return { ok: false, error: 'station-lookup-failed' }
  if (!station?.id) return { ok: false, error: 'station-not-found' }

  const stCompany = station.company_id ? String(station.company_id) : ''
  if (stCompany && stCompany !== cid) {
    return { ok: false, error: 'station-not-for-company' }
  }

  const projectId = station.point_project_id ? String(station.point_project_id) : ''
  if (!projectId) return { ok: false, error: 'station-no-project' }

  const { data: link, error: linkError } = await admin
    .from('point_project_companies')
    .select('company_id')
    .eq('project_id', projectId)
    .eq('company_id', cid)
    .maybeSingle()

  if (linkError || !link) {
    return { ok: false, error: 'station-not-in-company-project' }
  }

  return { ok: true }
}
