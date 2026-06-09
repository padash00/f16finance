import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess, fetchStoreWriteoffs, postInventoryWriteoff } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { requireCapability } from '@/lib/server/capabilities'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

type Body = {
  action: 'createWriteoff' | 'cancelWriteoff'
  payload?: {
    location_id: string
    written_at: string
    reason: string
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
      comment?: string | null
    }>
  }
  writeoff_id?: string
  cancel_reason?: string | null
}

function normalizeMoney(value: unknown) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

function normalizeQty(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const denied = await requireCapability(access, 'store-writeoffs.view')
    if (denied) return denied as any

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const scopeParam = String(url.searchParams.get('scope') || 'all')
    const scope: 'all' | 'warehouse' | 'showcase' =
      scopeParam === 'warehouse' || scopeParam === 'showcase' ? scopeParam : 'all'
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const data = await fetchStoreWriteoffs(supabase as any, inventoryScope)
    const locationType = scope === 'showcase' ? 'point_display' : scope === 'warehouse' ? 'warehouse' : null
    if (locationType) {
      data.locations = (data.locations || []).filter((l: any) => l?.location_type === locationType)
      data.balances = (data.balances || []).filter((b: any) => b?.location?.location_type === locationType)
      data.writeoffs = (data.writeoffs || []).filter((w: any) => w?.location?.location_type === locationType)
    }
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/writeoffs.GET',
      message: error?.message || 'Store writeoffs GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить списания магазина' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const denied = await requireCapability(access, 'store-writeoffs.create')
    if (denied) return denied as any

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    // ── Отмена списания: возвращаем товар на локацию, акт → cancelled ──────
    if (body.action === 'cancelWriteoff') {
      const cancelDenied = await requireCapability(access, 'store-writeoffs.cancel')
      if (cancelDenied) return cancelDenied
      const writeoffId = String(body.writeoff_id || '').trim()
      if (!writeoffId) return json({ error: 'writeoff-id-required' }, 400)
      const reason = String(body.cancel_reason || '').trim() || null

      const { data: writeoffRow, error: writeoffErr } = await supabase
        .from('inventory_writeoffs')
        .select('id, status, location_id, written_at, reason, total_amount')
        .eq('id', writeoffId)
        .maybeSingle()
      if (writeoffErr) throw writeoffErr
      if (!writeoffRow) return json({ error: 'Списание не найдено' }, 404)
      await ensureInventoryLocationAccess(supabase as any, String(writeoffRow.location_id), inventoryScope)

      const { error: rpcErr } = await supabase.rpc('inventory_cancel_writeoff', {
        p_writeoff_id: writeoffId,
        p_reason: reason,
        p_actor_user_id: actorUserId,
      })
      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('inventory-writeoff-already-cancelled')) {
          return json({ error: 'Списание уже отменено' }, 409)
        }
        if (msg.includes('inventory-writeoff-not-found')) {
          return json({ error: 'Списание не найдено' }, 404)
        }
        throw rpcErr
      }

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-writeoff',
        entityId: writeoffId,
        action: 'cancel',
        payload: {
          reason,
          location_id: writeoffRow.location_id,
          written_at: writeoffRow.written_at,
          total_amount: writeoffRow.total_amount,
        },
      })

      return json({ ok: true })
    }

    if (body.action !== 'createWriteoff') return json({ error: 'invalid-action' }, 400)
    if (!body.payload) return json({ error: 'payload-required' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const result = await postInventoryWriteoff(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      written_at: body.payload.written_at,
      reason: String(body.payload.reason || '').trim(),
      comment: body.payload.comment || null,
      created_by: actorUserId,
      items: Array.isArray(body.payload.items)
        ? body.payload.items.map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            comment: item.comment || null,
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-writeoff',
      entityId: String(result?.writeoff_id || result?.id || ''),
      action: 'create',
      payload: result,
    })

    return json({ ok: true, data: result })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/writeoffs.POST',
      message: error?.message || 'Store writeoffs POST error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось выполнить операцию со списанием') }, 500)
  }
}
