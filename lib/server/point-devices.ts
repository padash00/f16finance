import 'server-only'

import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type PointDeviceContext = {
  device: {
    id: string
    company_id: string
    company_ids: string[]
    name: string
    device_token: string
    shift_report_chat_id: string | null
    point_mode: string
    feature_flags: Record<string, unknown> | null
    is_active: boolean
    notes: string | null
    company?: {
      id: string
      name: string
      code: string | null
    } | null
  }
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

export async function requirePointDevice(request: Request): Promise<
  | { response: NextResponse }
  | PointDeviceContext
> {
  if (!hasAdminSupabaseCredentials()) {
    return {
      response: NextResponse.json({ error: 'point-api-disabled' }, { status: 503 }),
    }
  }

  const token = request.headers.get('x-point-device-token')?.trim()
  if (!token) {
    return {
      response: NextResponse.json({ error: 'missing-point-device-token' }, { status: 401 }),
    }
  }

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('point_projects')
    .select('id, name, project_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, point_project_companies(company_id, company:company_id(id, name, code))')
    .eq('project_token', token)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    return {
      response: NextResponse.json({ error: 'invalid-point-device' }, { status: 403 }),
    }
  }

  const projectCompanies = Array.isArray(data.point_project_companies)
    ? (data.point_project_companies as any[])
    : []
  const company_ids: string[] = projectCompanies.map((c: any) => c.company_id).filter(Boolean)

  // Determine which company to use for this request
  const requestedCompanyId = request.headers.get('x-point-company-id')?.trim() || ''
  let selectedCompanyId = ''
  let selectedCompany: { id: string; name: string; code: string | null } | null = null

  if (requestedCompanyId && company_ids.includes(requestedCompanyId)) {
    selectedCompanyId = requestedCompanyId
    const match = projectCompanies.find((c: any) => c.company_id === requestedCompanyId)
    if (match?.company) {
      const co = Array.isArray(match.company) ? match.company[0] : match.company
      selectedCompany = co || null
    }
  } else if (company_ids.length > 0) {
    // Fallback to first company (used by bootstrap before company selection)
    selectedCompanyId = company_ids[0]
    const first = projectCompanies[0]
    if (first?.company) {
      const co = Array.isArray(first.company) ? first.company[0] : first.company
      selectedCompany = co || null
    }
  }

  await supabase.from('point_projects').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)

  return {
    supabase,
    device: {
      id: data.id,
      company_id: selectedCompanyId,
      company_ids,
      name: data.name,
      device_token: data.project_token,
      shift_report_chat_id: data.shift_report_chat_id || null,
      point_mode: data.point_mode,
      feature_flags:
        data.feature_flags && typeof data.feature_flags === 'object'
          ? (data.feature_flags as Record<string, unknown>)
          : {},
      is_active: data.is_active,
      notes: data.notes || null,
      company: selectedCompany,
    },
  }
}
