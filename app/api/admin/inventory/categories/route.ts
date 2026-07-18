import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * GET — полный список категорий товаров организации (для селектов и управления
 * категориями в каталоге). Мутации идут через /api/admin/inventory
 * (createCategory / updateCategory / deleteCategory).
 */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция как в каталоге: только своя организация (NEVER-pattern без орг).
    const orgId = access.activeOrganization?.id || null
    const scopeOrg = access.isSuperAdmin ? null : (orgId || '00000000-0000-0000-0000-000000000000')

    let query = supabase
      .from('inventory_categories')
      .select('id, name, description')
      .order('name', { ascending: true })
    if (scopeOrg) query = query.eq('organization_id', scopeOrg)

    const { data, error } = await query
    if (error) throw error

    return json({ ok: true, data: data || [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/categories.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}
