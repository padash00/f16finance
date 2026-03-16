import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function generatePassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'Требуется SUPABASE_SERVICE_ROLE_KEY', code: 'missing_service_role' }, 500)
    }

    const body = await req.json().catch(() => null)
    if (!body?.staffId) return json({ error: 'staffId required' }, 400)

    const supabase = createAdminSupabaseClient()

    // Get staff email
    const { data: staffRow, error: staffError } = await supabase
      .from('staff')
      .select('id, full_name, email, role')
      .eq('id', body.staffId)
      .maybeSingle()
    if (staffError) throw staffError
    if (!staffRow) return json({ error: 'Сотрудник не найден' }, 404)
    if (!staffRow.email) return json({ error: 'У сотрудника не заполнен email', code: 'missing_email' }, 400)

    // Find auth user by email
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) throw usersError

    const authUser = usersData.users.find(u => u.email?.toLowerCase() === staffRow.email!.toLowerCase()) ?? null
    if (!authUser) return json({ error: 'Аккаунт не найден. Сначала отправьте приглашение.', code: 'no_account' }, 404)

    // Generate or use provided password
    const password = (body.password && body.password.length >= 6) ? body.password : generatePassword()

    const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, { password })
    if (updateError) throw updateError

    // Audit log
    const requestClient = createRequestSupabaseClient(req)
    const { data: { user: actor } } = await requestClient.auth.getUser()
    await writeAuditLog(supabase, {
      actorUserId: actor?.id ?? null,
      entityType: 'staff-account',
      entityId: staffRow.id,
      action: 'set-password',
      payload: { email: staffRow.email, staff_role: staffRow.role },
    })

    return json({ ok: true, password, email: staffRow.email, fullName: staffRow.full_name })
  } catch (e: any) {
    return json({ error: e?.message || 'Ошибка сервера' }, 500)
  }
}
