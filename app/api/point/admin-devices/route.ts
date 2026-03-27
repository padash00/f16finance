import { NextResponse } from 'next/server'

import { validateAdminToken } from '@/lib/server/admin-tokens'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  token?: string
  action?: 'updateShiftReportChatId' | 'updateDeviceSettings'
  deviceId?: string
  shift_report_chat_id?: string | null
  feature_flags?: {
    kaspi_daily_split?: boolean
    debt_report?: boolean
    start_cash_prompt?: boolean
  } | null
}

function normalizeFlags(input: Record<string, unknown> | null | undefined) {
  return {
    shift_report: input?.shift_report !== false,
    income_report: input?.income_report !== false,
    debt_report: input?.debt_report === true,
    kaspi_daily_split: input?.kaspi_daily_split === true,
    start_cash_prompt: input?.start_cash_prompt === true,
  }
}

function normalizeShiftReportChatId(value: string | null | undefined) {
  const chatId = String(value || '').trim()
  if (!chatId) return null
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('invalid-shift-report-chat-id')
  }
  return chatId
}

function requireSuperAdmin(token: string): void {
  const email = validateAdminToken(token)
  if (!email) throw new Error('invalid-or-expired-token')
}

const PROJECT_SELECT = 'id, name, project_token, shift_report_chat_id, point_mode, feature_flags, is_active, last_seen_at, created_at, updated_at, point_project_companies(company_id, company:company_id(id, name, code))'

function mapProject(row: any) {
  const projectCompanies = Array.isArray(row.point_project_companies) ? row.point_project_companies : []
  const companies = projectCompanies.map((c: any) => {
    const co = Array.isArray(c.company) ? c.company[0] : c.company
    return { id: c.company_id, name: co?.name || '', code: co?.code || null }
  })
  return {
    id: row.id,
    name: row.name,
    company_id: companies[0]?.id || '',
    company_name: companies.map((c: any) => c.name).filter(Boolean).join(', ') || '—',
    companies,
    point_mode: row.point_mode || '—',
    is_active: row.is_active !== false,
    device_token: row.project_token || '',
    shift_report_chat_id: row.shift_report_chat_id || null,
    feature_flags: normalizeFlags(row.feature_flags),
    last_seen_at: row.last_seen_at || null,
  }
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'point-api-disabled' }, 503)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    const token = String(body?.token || '').trim()

    if (!token) return json({ error: 'token-required' }, 400)

    requireSuperAdmin(token)

    const supabase = createAdminSupabaseClient()

    if (body?.action === 'updateShiftReportChatId' || body?.action === 'updateDeviceSettings') {
      const deviceId = String(body.deviceId || '').trim()
      if (!deviceId) return json({ error: 'device-id-required' }, 400)

      const { data: existing, error: existingError } = await supabase
        .from('point_projects')
        .select('feature_flags')
        .eq('id', deviceId)
        .single()

      if (existingError) throw existingError

      const nextFlags = normalizeFlags((existing as any)?.feature_flags)
      if (body.feature_flags && typeof body.feature_flags.kaspi_daily_split === 'boolean') {
        nextFlags.kaspi_daily_split = body.feature_flags.kaspi_daily_split === true
      }
      if (body.feature_flags && typeof body.feature_flags.debt_report === 'boolean') {
        nextFlags.debt_report = body.feature_flags.debt_report === true
      }
      if (body.feature_flags && typeof body.feature_flags.start_cash_prompt === 'boolean') {
        nextFlags.start_cash_prompt = body.feature_flags.start_cash_prompt === true
      }

      const { data, error } = await supabase
        .from('point_projects')
        .update({
          shift_report_chat_id: normalizeShiftReportChatId(body.shift_report_chat_id),
          feature_flags: nextFlags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deviceId)
        .select(PROJECT_SELECT)
        .single()

      if (error) throw error

      return json({ ok: true, data: { device: mapProject(data) } })
    }

    // GET all projects
    const { data, error } = await supabase
      .from('point_projects')
      .select(PROJECT_SELECT)
      .order('created_at', { ascending: false })

    if (error) throw error

    return json({
      ok: true,
      data: {
        devices: ((data || []) as any[]).map(mapProject),
      },
    })
  } catch (error: any) {
    const message = error?.message || 'Point admin devices error'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-admin-devices',
      message,
    })
    if (message === 'invalid-shift-report-chat-id') return json({ error: message }, 400)
    if (message === 'invalid-credentials') return json({ error: message }, 401)
    if (message === 'super-admin-only') return json({ error: message }, 403)
    return json({ error: message }, 500)
  }
}
