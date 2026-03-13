import 'server-only'

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || 'padash00@gmail.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false
  return getAdminEmails().includes(email.trim().toLowerCase())
}

export async function resolveStaffByUser(
  supabase: any,
  user: { id: string; email?: string | null } | null,
) {
  if (!user?.id) return null

  if (user.email) {
    const { data, error } = await supabase
      .from('staff')
      .select('id, email, full_name, short_name, role, is_active')
      .ilike('email', user.email)
      .maybeSingle()

    if (!error && data) return data
  }

  const { data: authRow, error: authError } = await supabase
    .from('operator_auth')
    .select('operator_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (authError || !authRow?.operator_id) return null

  const { data: linkRow, error: linkError } = await supabase
    .from('operator_staff_links')
    .select('staff:staff_id(id, email, full_name, short_name, role, is_active)')
    .eq('operator_id', authRow.operator_id)
    .maybeSingle()

  if (linkError || !linkRow?.staff) return null
  return linkRow.staff
}
