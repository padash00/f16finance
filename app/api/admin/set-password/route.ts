import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%^&*'
  const all = upper + lower + digits + special
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let result = ''
  result += upper[bytes[0] % upper.length]
  result += lower[bytes[1] % lower.length]
  result += digits[bytes[2] % digits.length]
  result += special[bytes[3] % special.length]
  for (let i = 4; i < 20; i++) result += all[bytes[i] % all.length]
  const arr = result.split('')
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.join('')
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

    // Generate or use provided password (минимум 8 символов, должен содержать буквы и цифры)
    const isStrongPassword = (p: string) =>
      p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p)
    const password = (body.password && isStrongPassword(body.password)) ? body.password : generatePassword()

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
