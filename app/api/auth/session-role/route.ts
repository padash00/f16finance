import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, listActiveOperatorLeadAssignments } from '@/lib/server/request-auth'

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
    const supabase = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const isSuperAdmin = isAdminEmail(user.email)
    const staffMember = isSuperAdmin ? null : await resolveStaffByUser(supabase, user)
    const staffRole = normalizeStaffRole(staffMember?.role)
    const { data: operatorAuth } = await supabase
      .from('operator_auth')
      .select('id, operator_id')
      .eq('user_id', user.id)
      .maybeSingle()
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
      user.user_metadata?.name ||
      user.email ||
      null

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
