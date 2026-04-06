import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type LinkedCustomerRow = {
  id: string
  company_id: string | null
  name: string
  email: string | null
}

export async function fetchLinkedCustomersForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<LinkedCustomerRow[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, company_id, name, email')
    .eq('auth_user_id', userId)
    .eq('is_active', true)

  if (error) {
    console.warn('[linked-customers] fetch failed', error.message)
    return []
  }

  return ((data || []) as LinkedCustomerRow[]).filter((row) => row.id)
}
