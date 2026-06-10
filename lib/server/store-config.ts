import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Точка-магазин для активной организации (store_settings.store_company_id).
 * Весь модуль /store/* скоупится на неё. null — точка ещё не выбрана.
 */
export async function getStoreCompanyId(access: {
  activeOrganization?: { id: string } | null
  supabase: any
}): Promise<string | null> {
  const orgId = access.activeOrganization?.id || null
  if (!orgId) return null
  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { data, error } = await supabase
    .from('store_settings')
    .select('store_company_id')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) return null
  return (data?.store_company_id as string | null) || null
}
