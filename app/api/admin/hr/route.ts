import { NextResponse } from 'next/server'

import { listOrganizationOperatorIds, listOrganizationStaffIds } from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type HrEmployee = {
  kind: 'staff' | 'operator'
  id: string
  full_name: string
  short_name: string | null
  position: string | null
  role: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  dismissed_at: string | null
  dismissal_date: string | null
  dismissal_type: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  monthly_salary: number | null
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'hr.view')
    if (denied) return denied as any

    if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const [allowedStaffIds, allowedOperatorIds] = await Promise.all([
      listOrganizationStaffIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
      listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
    ])

    let staffQuery = supabase
      .from('staff')
      .select('id, full_name, short_name, role, monthly_salary, phone, email, is_active, dismissed_at, dismissal_date, dismissal_type, dismissal_reason, dismissed_by')
      .order('full_name')

    if (allowedStaffIds) {
      if (allowedStaffIds.length === 0) {
        staffQuery = staffQuery.in('id', ['00000000-0000-0000-0000-000000000000'])
      } else {
        staffQuery = staffQuery.in('id', allowedStaffIds)
      }
    }

    let operatorsQuery = supabase
      .from('operators')
      .select('id, name, short_name, role, is_active, dismissed_at, dismissal_date, dismissal_type, dismissal_reason, dismissed_by, operator_profiles(full_name, position, phone, email)')
      .order('name')

    if (allowedOperatorIds) {
      if (allowedOperatorIds.length === 0) {
        operatorsQuery = operatorsQuery.in('id', ['00000000-0000-0000-0000-000000000000'])
      } else {
        operatorsQuery = operatorsQuery.in('id', allowedOperatorIds)
      }
    }

    const [staffRes, operatorsRes] = await Promise.all([staffQuery, operatorsQuery])
    if (staffRes.error) throw staffRes.error
    if (operatorsRes.error) throw operatorsRes.error

    const staffEmployees: HrEmployee[] = (staffRes.data || []).map((row: any) => ({
      kind: 'staff',
      id: String(row.id),
      full_name: row.full_name || '',
      short_name: row.short_name || null,
      position: null,
      role: row.role || null,
      phone: row.phone || null,
      email: row.email || null,
      is_active: row.is_active !== false,
      dismissed_at: row.dismissed_at || null,
      dismissal_date: row.dismissal_date || null,
      dismissal_type: row.dismissal_type || null,
      dismissal_reason: row.dismissal_reason || null,
      dismissed_by: row.dismissed_by || null,
      monthly_salary: row.monthly_salary != null ? Number(row.monthly_salary) : null,
    }))

    const operatorEmployees: HrEmployee[] = (operatorsRes.data || []).map((row: any) => {
      const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] : row.operator_profiles
      return {
        kind: 'operator' as const,
        id: String(row.id),
        full_name: profile?.full_name?.trim() || row.name || '',
        short_name: row.short_name || null,
        position: profile?.position || null,
        role: row.role || 'operator',
        phone: profile?.phone || null,
        email: profile?.email || null,
        is_active: row.is_active !== false,
        dismissed_at: row.dismissed_at || null,
        dismissal_date: row.dismissal_date || null,
        dismissal_type: row.dismissal_type || null,
        dismissal_reason: row.dismissal_reason || null,
        dismissed_by: row.dismissed_by || null,
        monthly_salary: null,
      }
    })

    const dismisserIds = Array.from(new Set([...staffEmployees, ...operatorEmployees]
      .map((e) => e.dismissed_by)
      .filter((v): v is string => !!v)))
    const dismissers: Record<string, string> = {}
    if (dismisserIds.length > 0) {
      const { data: dismisserRows } = await supabase
        .from('staff')
        .select('id, full_name, short_name')
        .in('id', dismisserIds)
      for (const row of (dismisserRows || []) as any[]) {
        dismissers[String(row.id)] = String(row.full_name || row.short_name || row.id)
      }
    }

    const items = [...staffEmployees, ...operatorEmployees].map((e) => ({
      ...e,
      dismissed_by_name: e.dismissed_by ? dismissers[e.dismissed_by] || null : null,
    }))

    return json({ data: items })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr GET',
      message: error?.message || 'hr list failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
