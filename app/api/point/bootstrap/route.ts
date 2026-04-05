import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeFlags(input: Record<string, unknown> | null | undefined) {
  return {
    shift_report: input?.shift_report !== false,
    income_report: input?.income_report !== false,
    debt_report: input?.debt_report === true,
    kaspi_daily_split: input?.kaspi_daily_split === true,
    start_cash_prompt: input?.start_cash_prompt === true,
    arena_enabled: input?.arena_enabled === true,
    /** Если true — вкладка «Смена» подставляет суммы из сессий арены; иначе классический ручной отчёт. */
    arena_shift_auto_totals: input?.arena_shift_auto_totals === true,
  }
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const featureFlags = normalizeFlags(device.feature_flags || {})

    // Fetch operators for ALL companies in the project
    const { data: assignments, error: assignmentsError } = await supabase
      .from('operator_company_assignments')
      .select(
        'id, operator_id, company_id, role_in_company, is_primary, is_active, operator:operator_id(id, name, short_name, telegram_chat_id, is_active, operator_profiles(*))',
      )
      .in('company_id', device.company_ids.length > 0 ? device.company_ids : ['__none__'])
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (assignmentsError) throw assignmentsError

    // Deduplicate operators across companies (keep first occurrence which is primary-first)
    const seenOperatorIds = new Set<string>()
    const operators = ((assignments || []) as any[])
      .map((row) => {
        const operator = Array.isArray(row.operator) ? row.operator[0] || null : row.operator || null
        if (!operator?.id) return null
        if (seenOperatorIds.has(operator.id)) return null
        seenOperatorIds.add(operator.id)
        const profile = Array.isArray(operator.operator_profiles) ? operator.operator_profiles[0] || null : null

        return {
          id: operator.id,
          name: operator.name,
          short_name: operator.short_name || null,
          full_name: profile?.full_name || null,
          telegram_chat_id: operator.telegram_chat_id || null,
          is_active: operator.is_active !== false,
          role_in_company: row.role_in_company,
          is_primary: !!row.is_primary,
        }
      })
      .filter(Boolean)

    // Fetch company info for all project companies
    const { data: companiesData } = await supabase
      .from('companies')
      .select('id, name, code')
      .in('id', device.company_ids.length > 0 ? device.company_ids : ['__none__'])

    const companies = (companiesData || []).map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code || null,
    }))

    await writeAuditLog(supabase, {
      entityType: 'point-device',
      entityId: device.id,
      action: 'bootstrap',
      payload: {
        company_ids: device.company_ids,
        operator_count: operators.length,
        point_mode: device.point_mode,
      },
    })

    // company field: selected company or first in list (for backward compat)
    const primaryCompany = device.company || companies[0] || { id: '', name: device.name, code: null }

    return json({
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        point_mode: device.point_mode,
        feature_flags: featureFlags,
      },
      company: primaryCompany,
      companies,
      operators,
      sync: {
        mode: 'server-api',
        supports_shift_report: featureFlags.shift_report,
        supports_income_report: featureFlags.income_report,
        supports_debt_report: featureFlags.debt_report,
        supports_kaspi_daily_split: featureFlags.kaspi_daily_split,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-bootstrap',
      message: error?.message || 'Unknown point bootstrap error',
    })
    return json({ error: error?.message || 'Не удалось загрузить точку' }, 500)
  }
}
