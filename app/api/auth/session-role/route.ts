import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

function getRoleLabel(params: { isSuperAdmin: boolean; staffRole: ReturnType<typeof normalizeStaffRole>; isOperator: boolean }) {
  const { isSuperAdmin, staffRole, isOperator } = params

  if (isSuperAdmin) return 'Супер-администратор'
  if (staffRole === 'manager') return 'Руководитель'
  if (staffRole === 'marketer') return 'Маркетолог'
  if (staffRole === 'owner') return 'Владелец'
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
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
    const isOperator = !!operatorAuth
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
      staffRole,
      roleLabel: getRoleLabel({ isSuperAdmin, staffRole, isOperator }),
      defaultPath: getDefaultAppPath({
        isSuperAdmin,
        isStaff: isSuperAdmin || !!staffMember,
        isOperator,
        staffRole,
      }),
    })
  } catch (error: any) {
    console.error('Session role route error', error)
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
