import { NextResponse } from 'next/server'

import {
  listOrganizationCompanyIds,
  listOrganizationOperatorIds,
  listOrganizationStaffIds,
} from '@/lib/server/organizations'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operator_structure')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    const [allowedStaffIds, allowedCompanyIds, allowedOperatorIds] = await Promise.all([
      listOrganizationStaffIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
      listOrganizationCompanyIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
      listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
    ])

    if (!access.isSuperAdmin && (
      !allowedStaffIds?.length &&
      !allowedCompanyIds?.length &&
      !allowedOperatorIds?.length
    )) {
      return json({
        ok: true,
        data: {
          staff: [],
          companies: [],
          operators: [],
          assignments: [],
          history: [],
          careerLinks: [],
        },
      })
    }

    let staffQuery = supabase
      .from('staff')
      .select('id, full_name, short_name, role, monthly_salary, phone, email, is_active')
      .eq('is_active', true)
      .in('role', ['owner', 'manager', 'marketer'])
      .order('role', { ascending: true })
      .order('full_name', { ascending: true })
    if (allowedStaffIds) staffQuery = staffQuery.in('id', allowedStaffIds)

    let companiesQuery = supabase
      .from('companies')
      .select('id, name, code, show_in_structure')
      .eq('show_in_structure', true)
      .order('name', { ascending: true })
    if (allowedCompanyIds) companiesQuery = companiesQuery.in('id', allowedCompanyIds)

    let operatorsQuery = supabase
      .from('operators')
      .select('id, name, short_name, is_active, telegram_chat_id, operator_profiles(full_name, phone, email, position, photo_url, hire_date)')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (allowedOperatorIds) operatorsQuery = operatorsQuery.in('id', allowedOperatorIds)

    let assignmentsQuery = supabase
      .from('operator_company_assignments')
      .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes, created_at, updated_at')
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
    if (allowedCompanyIds) assignmentsQuery = assignmentsQuery.in('company_id', allowedCompanyIds)

    let historyQuery = supabase
      .from('audit_log')
      .select('id, actor_user_id, entity_type, entity_id, action, payload, created_at')
      .in('entity_type', ['operator-company-assignment', 'operator-career'])
      .order('created_at', { ascending: false })
      .limit(100)

    let careerLinksQuery = supabase
      .from('operator_staff_links')
      .select(
        'id, operator_id, staff_id, assigned_role, assigned_at, updated_at, operator:operator_id(id, name, short_name, operator_profiles(full_name, hire_date, position)), staff:staff_id(id, full_name, short_name, role, monthly_salary, is_active)',
      )
      .order('updated_at', { ascending: false })
    if (allowedOperatorIds) careerLinksQuery = careerLinksQuery.in('operator_id', allowedOperatorIds)
    if (allowedStaffIds) careerLinksQuery = careerLinksQuery.in('staff_id', allowedStaffIds)

    const [staffRes, companiesRes, operatorsRes, assignmentsRes, historyRes, careerLinksRes] = await Promise.all([
      staffQuery,
      companiesQuery,
      operatorsQuery,
      assignmentsQuery,
      historyQuery,
      careerLinksQuery,
    ])

    if (staffRes.error) throw staffRes.error
    if (companiesRes.error) throw companiesRes.error
    if (operatorsRes.error) throw operatorsRes.error
    if (assignmentsRes.error) throw assignmentsRes.error
    if (historyRes.error) throw historyRes.error
    if (careerLinksRes.error) throw careerLinksRes.error

    return json({
      ok: true,
      data: {
        staff: staffRes.data || [],
        companies: companiesRes.data || [],
        operators: operatorsRes.data || [],
        assignments: assignmentsRes.data || [],
        history: allowedCompanyIds
          ? (historyRes.data || []).filter((item: any) => {
              const companyId = String(item?.payload?.company_id || '')
              return !companyId || allowedCompanyIds.includes(companyId)
            })
          : historyRes.data || [],
        careerLinks: (careerLinksRes.data || []).map((item: any) => ({
          ...item,
          operator: Array.isArray(item.operator) ? item.operator[0] || null : item.operator || null,
          staff: Array.isArray(item.staff) ? item.staff[0] || null : item.staff || null,
        })),
      },
    })
  } catch (error: any) {
    console.error('Structure route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/structure',
      message: error?.message || 'Structure route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
