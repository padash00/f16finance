import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { isStoreManager } from '@/lib/server/store-access'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// PATCH { item_id, pack_size } — задать размер упаковки товара (для плана закупа).
export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-catalog.edit')
    if (denied) return denied
    if (!isStoreManager(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Не-супер без активной орг — отказ (иначе фильтр по орг отключается).
    const orgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !orgId) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => null)) as any
    const itemId = String(body?.item_id || '').trim()
    const packSize = Number(body?.pack_size)
    if (!itemId || !Number.isFinite(packSize) || packSize <= 0) {
      return json({ error: 'item_id и положительный pack_size обязательны' }, 400)
    }

    // Скоуп: товар своей организации. Для не-супера ВСЕГДА фильтруем по орг.
    let q = supabase.from('inventory_items').update({ pack_size: packSize }).eq('id', itemId)
    if (!access.isSuperAdmin) {
      q = q.eq('organization_id', orgId)
    }
    const { error } = await q
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'purchase-plan/pack-size.PATCH', message: error?.message || 'pack-size error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
