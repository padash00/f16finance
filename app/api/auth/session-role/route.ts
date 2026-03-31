import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext, listActiveOperatorLeadAssignments } from '@/lib/server/request-auth'
import { resolveOrganizationByHost } from '@/lib/server/tenant-hosts'

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
    const hostOrganization = await resolveOrganizationByHost(req.headers.get('host'))
    const isTenantContext = Boolean(hostOrganization?.id)

    const {
      supabase,
      user,
      isSuperAdmin,
      staffMember,
      staffRole,
      operatorAuth,
      organizations,
      activeOrganization,
      activeSubscription,
      organizationHubRequired,
      organizationSelectionRequired,
    } = access
    const isOperator = !!operatorAuth
    const leadAssignments = operatorAuth
      ? await listActiveOperatorLeadAssignments(supabase, String((operatorAuth as any).operator_id || ''))
          .catch(() => [])
      : []
    const leadRoleLabel =
      leadAssignments[0]?.role_in_company === 'senior_cashier'
        ? 'Старший кассир'
        : leadAssignments[0]?.role_in_company === 'senior_operator'
          ? 'Старший оператор'
          : null
    const displayName =
      (isSuperAdmin ? null : staffMember?.full_name || staffMember?.short_name) ||
      user?.user_metadata?.name ||
      user?.email ||
      null

    return NextResponse.json({
      ok: true,
      email: user?.email || null,
      displayName,
      isSuperAdmin,
      isTenantContext,
      isPlatformContext: isSuperAdmin && !isTenantContext,
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
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        accessRole: organization.accessRole,
        isDefault: organization.isDefault,
      })),
      activeOrganization: activeOrganization
        ? {
            id: activeOrganization.id,
            name: activeOrganization.name,
            slug: activeOrganization.slug,
            status: activeOrganization.status,
            accessRole: activeOrganization.accessRole,
          }
        : null,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            status: activeSubscription.status,
            billingPeriod: activeSubscription.billingPeriod,
            startsAt: activeSubscription.startsAt,
            endsAt: activeSubscription.endsAt,
            plan: activeSubscription.plan
              ? {
                  id: activeSubscription.plan.id,
                  code: activeSubscription.plan.code,
                  name: activeSubscription.plan.name,
                  features: activeSubscription.plan.features,
                  limits: activeSubscription.plan.limits,
                }
              : null,
          }
        : null,
      organizationHubRequired,
      organizationSelectionRequired,
      defaultPath: getDefaultAppPath({
        isSuperAdmin,
        isStaff: isSuperAdmin || !!staffMember,
        isOperator,
        staffRole,
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
