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
      brand_color?: string | null
      brand_logo_url?: string | null
      payment_provider?: {
        id: string
        code: string
        name: string
        country_code: string | null
        supports_midnight_split: boolean
      } | null
    } | null
  }
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

const POINT_PROJECT_SELECT =
  'id, name, project_token, shift_report_chat_id, point_mode, feature_flags, is_active, notes, point_project_companies(company_id, point_mode, feature_flags, company:company_id(id, name, code, brand_color, brand_logo_url, payment_provider:payment_provider_id(id, code, name, country_code, supports_midnight_split)))'

/** Company JSONB flags override project; `null` / missing per key inherits from project (empty `{}` does not wipe project). */
function mergePointFeatureFlags(
  projectFlags: Record<string, unknown>,
  companyFlagsRaw: unknown,
): Record<string, unknown> {
  const base =
    projectFlags && typeof projectFlags === 'object' && !Array.isArray(projectFlags) ? { ...projectFlags } : {}
  if (!companyFlagsRaw || typeof companyFlagsRaw !== 'object' || Array.isArray(companyFlagsRaw)) {
    return base
  }
  const company = companyFlagsRaw as Record<string, unknown>
  const out = { ...base }
  for (const [k, v] of Object.entries(company)) {
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return out
}

function deviceFromPointProjectRow(data: any, requestedCompanyId: string): PointDeviceContext['device'] {
  const projectCompanies = Array.isArray(data.point_project_companies) ? (data.point_project_companies as any[]) : []
  const company_ids: string[] = projectCompanies.map((c: any) => c.company_id).filter(Boolean)

  let selectedCompanyId = ''
  let selectedCompany: {
    id: string
    name: string
    code: string | null
    brand_color?: string | null
    brand_logo_url?: string | null
    payment_provider?: { id: string; code: string; name: string; country_code: string | null; supports_midnight_split: boolean } | null
  } | null = null
  let selectedCompanyRow: any = null

  function unwrapCompany(co: any) {
    if (!co) return null
    const company = Array.isArray(co) ? co[0] : co
    if (!company) return null
    // payment_provider может прийти как объект или массив (зависит от Supabase)
    const pp = Array.isArray(company.payment_provider) ? company.payment_provider[0] : company.payment_provider
    return { ...company, payment_provider: pp || null }
  }

  if (requestedCompanyId && company_ids.includes(requestedCompanyId)) {
    selectedCompanyId = requestedCompanyId
    const match = projectCompanies.find((c: any) => c.company_id === requestedCompanyId)
    if (match) {
      selectedCompanyRow = match
      selectedCompany = unwrapCompany(match.company)
    }
  } else if (company_ids.length > 0) {
    selectedCompanyId = company_ids[0]
    selectedCompanyRow = projectCompanies[0]
    const first = projectCompanies[0]
    if (first?.company) {
      selectedCompany = unwrapCompany(first.company)
    }
  }

  const projectFlags: Record<string, unknown> =
    data.feature_flags && typeof data.feature_flags === 'object' ? (data.feature_flags as Record<string, unknown>) : {}

  const effectivePointMode: string = selectedCompanyRow?.point_mode || data.point_mode

  const effectiveFeatureFlags = mergePointFeatureFlags(projectFlags, selectedCompanyRow?.feature_flags)

  return {
    id: data.id,
    company_id: selectedCompanyId,
    company_ids,
    name: data.name,
    device_token: data.project_token,
    shift_report_chat_id: data.shift_report_chat_id || null,
    point_mode: effectivePointMode,
    feature_flags: effectiveFeatureFlags,
    is_active: data.is_active,
    notes: data.notes || null,
    company: selectedCompany,
  }
}

/** Load project device context by primary key (admin client). Used for QR login approval. */
export async function loadPointProjectContext(projectId: string): Promise<PointDeviceContext | null> {
  if (!hasAdminSupabaseCredentials()) return null

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.from('point_projects').select(POINT_PROJECT_SELECT).eq('id', projectId).maybeSingle()

  if (error || !data || !data.is_active) return null

  return {
    supabase,
    device: deviceFromPointProjectRow(data, ''),
  }
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
  const { data, error } = await supabase.from('point_projects').select(POINT_PROJECT_SELECT).eq('project_token', token).maybeSingle()

  if (error || !data || !data.is_active) {
    return {
      response: NextResponse.json({ error: 'invalid-point-device' }, { status: 403 }),
    }
  }

  const requestedCompanyId = request.headers.get('x-point-company-id')?.trim() || ''

  await supabase.from('point_projects').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)

  return {
    supabase,
    device: deviceFromPointProjectRow(data, requestedCompanyId),
  }
}

/**
 * organization_id компании точки — для изоляции каталога арендатора в point-API.
 * NEVER-паттерн: компании нет / орг не проставлена → нулевой uuid, чтобы
 * скоуп-фильтр .eq('organization_id', …) дал пустой список, а не чужой каталог.
 */
export async function resolveCompanyOrganizationId(
  supabase: { from: (t: string) => any },
  companyId: string | null | undefined,
): Promise<string> {
  const id = String(companyId || '').trim()
  if (!id) return '00000000-0000-0000-0000-000000000000'
  const { data } = await supabase.from('companies').select('organization_id').eq('id', id).maybeSingle()
  return String((data as any)?.organization_id || '') || '00000000-0000-0000-0000-000000000000'
}
