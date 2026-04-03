import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  createRequestSupabaseClient,
  getRequestAccessContext,
  listActiveOperatorLeadAssignments,
} from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function getRoleLabel(params: {
  isSuperAdmin: boolean
  staffRole: ReturnType<typeof normalizeStaffRole>
  isOperator: boolean
  leadAssignmentsCount: number
  leadRoleLabel: string | null
}) {
  const { isSuperAdmin, staffRole, isOperator, leadAssignmentsCount, leadRoleLabel } = params

  if (isSuperAdmin) return 'Супер-администратор'
  if (staffRole === 'manager') return 'Руководитель'
  if (staffRole === 'marketer') return 'Маркетолог'
  if (staffRole === 'owner') return 'Владелец'
  if (leadAssignmentsCount > 0 && leadRoleLabel) return leadRoleLabel
  if (isOperator) return 'Оператор'
  return 'Пользователь'
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = createRequestSupabaseClient(req)
    const adminSupabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : supabase

    const user = access.user!
    const isSuperAdmin = access.isSuperAdmin
    const staffMember = access.staffMember
    const staffRole = normalizeStaffRole(staffMember?.role)
    const operatorAuth = access.operatorAuth
    const isOperator = !!operatorAuth

    const leadAssignments = operatorAuth
      ? await listActiveOperatorLeadAssignments(
          supabase,
          String((operatorAuth as any).operator_id || ''),
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
      user.user_metadata?.name ||
      user.email ||
      null

    let rolePermissionOverrides: Array<{ path: string; enabled: boolean }> = []

    if (!isSuperAdmin && (staffRole === 'manager' || staffRole === 'marketer' || staffRole === 'owner')) {
      const { data: rolePermissions, error: rolePermissionsError } = await adminSupabase
        .from('role_permissions')
        .select('path, enabled')
        .eq('role', staffRole)

      if (!rolePermissionsError) {
        rolePermissionOverrides = (rolePermissions || []).map((item: any) => ({
          path: String(item.path || ''),
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
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
