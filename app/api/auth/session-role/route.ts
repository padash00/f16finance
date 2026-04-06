import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  createRequestSupabaseClient,
  getRequestAccessContext,
  listActiveOperatorLeadAssignments,
} from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type RolePermissionOverride = {
  path: string
  enabled: boolean
}

function getRoleLabel(params: {
  isSuperAdmin: boolean
  staffRole: ReturnType<typeof normalizeStaffRole>
  isOperator: boolean
  isCustomer: boolean
  leadAssignmentsCount: number
  leadRoleLabel: string | null
}) {
  const { isSuperAdmin, staffRole, isOperator, isCustomer, leadAssignmentsCount, leadRoleLabel } = params

  if (isSuperAdmin) return 'Супер-администратор'
  if (staffRole === 'manager') return 'Руководитель'
  if (staffRole === 'marketer') return 'Маркетолог'
  if (staffRole === 'owner') return 'Владелец'
  if (leadAssignmentsCount > 0 && leadRoleLabel) return leadRoleLabel
  if (isOperator) return 'Оператор'
  if (isCustomer) return 'Гость клуба'
  return 'Пользователь'
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req, { allowCustomer: true })
    if ('response' in access) return access.response

    const supabase = createRequestSupabaseClient(req)
    const adminSupabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : supabase

    const user = access.user!
    const isSuperAdmin = access.isSuperAdmin
    const staffMember = access.staffMember
    const staffRole = normalizeStaffRole(staffMember?.role)
    const operatorAuth = access.operatorAuth
    const isOperator = !!operatorAuth
    const isCustomer = access.isCustomer

    const leadAssignments = operatorAuth
      ? await listActiveOperatorLeadAssignments(
          supabase,
          String((operatorAuth as any)?.operator_id || ''),
        ).catch(() => [])
      : []

    const leadRoleLabel =
      leadAssignments[0]?.role_in_company === 'senior_cashier'
        ? 'Старший кассир'
        : leadAssignments[0]?.role_in_company === 'senior_operator'
          ? 'Старший оператор'
          : null

    const displayName =
      (isSuperAdmin ? null : staffMember?.full_name || staffMember?.short_name) ||
      (isCustomer ? access.linkedCustomers[0]?.name || null : null) ||
      user.user_metadata?.name ||
      user.email ||
      null

    let rolePermissionOverrides: RolePermissionOverride[] = []

    if (!isSuperAdmin && (staffRole === 'manager' || staffRole === 'marketer' || staffRole === 'owner')) {
      const { data, error } = await adminSupabase
        .from('role_permissions')
        .select('path, enabled')
        .eq('role', staffRole)

      if (!error) {
        rolePermissionOverrides = (data || [])
          .filter((item: any) => item?.path)
          .map((item: any) => ({
            path: String(item.path),
            enabled: item.enabled !== false,
          }))
      }
    }

    return NextResponse.json({
      ok: true,
      email: user.email || null,
      displayName,
      isSuperAdmin,
      isStaff: isSuperAdmin || !!staffMember,
      isOperator,
      isCustomer,
      persona: access.persona,
      linkedCustomerIds: access.linkedCustomers.map((c) => c.id),
      isLeadOperator: leadAssignments.length > 0,
      leadAssignments: leadAssignments.map((assignment) => ({
        id: assignment.id,
        companyId: assignment.company_id,
        companyName: assignment.company?.name || null,
        companyCode: assignment.company?.code || null,
        roleInCompany: assignment.role_in_company,
        isPrimary: assignment.is_primary,
      })),
      staffRole,
      roleLabel: getRoleLabel({
        isSuperAdmin,
        staffRole,
        isOperator,
        isCustomer,
        leadAssignmentsCount: leadAssignments.length,
        leadRoleLabel,
      }),
      isTenantContext: false,
      isPlatformContext: false,
      organizationHubRequired: access.organizationHubRequired,
      organizationSelectionRequired: access.organizationSelectionRequired,
      organizations: access.organizations,
      activeOrganization: access.activeOrganization,
      activeSubscription: access.activeSubscription,
      rolePermissionOverrides,
      defaultPath: getDefaultAppPath({
        isSuperAdmin,
        isStaff: isSuperAdmin || !!staffMember,
        isOperator,
        isCustomer,
        staffRole,
        rolePermissionOverrides,
      }),
    })
  } catch (error: any) {
    console.error('Session role route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/session-role',
      message: error?.message || 'Session role route error',
    })
    return NextResponse.json(
      { error: error?.message || 'Ошибка сервера' },
      { status: 500 },
    )
  }
}
