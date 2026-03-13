import { NextResponse } from 'next/server'

import { getDefaultAppPath, normalizeStaffRole } from '@/lib/core/access'
import { isAdminEmail, resolveStaffByUser } from '@/lib/server/admin'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

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

    return NextResponse.json({
      ok: true,
      email: user.email || null,
      isSuperAdmin,
      isStaff: isSuperAdmin || !!staffMember,
      isOperator,
      staffRole,
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
