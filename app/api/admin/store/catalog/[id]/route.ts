import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { isStoreManager } from '@/lib/server/store-access'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH карточки товара — точечное сохранение фото/бренда/описания.
//
// Отдельный от updateItem роут: НЕ триггерит sync в point_products (там нужны
// name/barcode), а просто пишет визуальные поля карточки. Скоуп по орг.
// Если колонок image_url/brand ещё нет (миграция не применена) — мягко
// деградируем (description пишем всегда, image_url/brand — по возможности).
// ─────────────────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-catalog.edit')
    if (denied) return denied
    if (!isStoreManager(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await context.params
    const itemId = String(id || '').trim()
    if (!itemId) return json({ error: 'item-id-required' }, 400)

    const body = (await request.json().catch(() => null)) as
      | { image_url?: string | null; brand?: string | null; description?: string | null }
      | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция: редактировать можно только товар своей орг.
    // Не-супер без активной орг — отказ (иначе фильтр по орг отключается и течёт между тенантами).
    const callerOrgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !callerOrgId) return json({ error: 'forbidden' }, 403)

    let lookup = supabase
      .from('inventory_items')
      .select('organization_id')
      .eq('id', itemId)
    if (!access.isSuperAdmin && callerOrgId) lookup = lookup.eq('organization_id', callerOrgId)
    const { data: itemRow } = await lookup.maybeSingle()
    if (!itemRow) return json({ error: 'item-not-found' }, 404)

    // Собираем только переданные поля.
    const full: Record<string, unknown> = {}
    if ('image_url' in body) full.image_url = body.image_url ? String(body.image_url).trim() : null
    if ('brand' in body) full.brand = body.brand ? String(body.brand).trim() : null
    if ('description' in body) full.description = body.description ? String(body.description).trim() : null

    if (Object.keys(full).length === 0) return json({ error: 'no-fields' }, 400)

    // Пытаемся записать все поля. Если image_url/brand-колонок нет (миграция не
    // применена) — повторяем без них, чтобы хотя бы description сохранился.
    let { error } = await supabase.from('inventory_items').update(full).eq('id', itemId)
    if (error) {
      const msg = String((error as any)?.message || '').toLowerCase()
      const missingCol = msg.includes('column') && (msg.includes('image_url') || msg.includes('brand'))
      if (missingCol) {
        const fallback: Record<string, unknown> = {}
        if ('description' in full) fallback.description = full.description
        if (Object.keys(fallback).length > 0) {
          const retry = await supabase.from('inventory_items').update(fallback).eq('id', itemId)
          if (retry.error) throw retry.error
          return json({ ok: true, degraded: true, message: 'Фото/бренд недоступны: примените миграцию product-photos.' })
        }
        return json({ ok: false, degraded: true, error: 'Колонки фото/бренда ещё нет. Примените миграцию.' }, 503)
      }
      throw error
    }

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'inventory-item',
      entityId: itemId,
      action: 'update-card',
      payload: full,
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/catalog/[id].PATCH',
      message: error?.message || 'product card PATCH error',
    })
    return json({ error: error?.message || 'Не удалось сохранить' }, 500)
  }
}
