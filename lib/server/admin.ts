import 'server-only'

export function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS
  if (!raw) {
    console.error('[SECURITY] ADMIN_EMAILS env var is not set. Super-admin access is disabled.')
    return []
  }
  return raw
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
  user: { id: string; email?: string | null; user_metadata?: Record<string, any> | null } | null,
) {
  if (!user?.id) return null

  const metadataStaffId = typeof user.user_metadata?.staff_id === 'string' ? user.user_metadata.staff_id : null
  if (metadataStaffId) {
    const { data, error } = await supabase
      .from('staff')
      .select('id, email, full_name, short_name, role, is_active')
      .eq('id', metadataStaffId)
      .maybeSingle()

    if (!error && data) return data
  }

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
