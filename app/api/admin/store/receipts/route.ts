import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { ensureInventoryLocationAccess, fetchStoreReceipts, postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

type Body = {
  action: 'createReceipt'
  payload: {
    location_id: string
    supplier_id?: string | null
    received_at: string
    invoice_number?: string | null
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_cost: number
      comment?: string | null
    }>
  }
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

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const inventoryScope = {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    }
    const data = await fetchStoreReceipts(supabase as any, inventoryScope)
    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts.GET',
      message: error?.message || 'Store receipts GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить приемку магазина' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

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
    if (!body?.action || body.action !== 'createReceipt') return json({ error: 'invalid-action' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const result = await postInventoryReceipt(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      supplier_id: body.payload.supplier_id || null,
      received_at: body.payload.received_at,
      invoice_number: body.payload.invoice_number || null,
      comment: body.payload.comment || null,
      created_by: actorUserId,
      items: Array.isArray(body.payload.items)
        ? body.payload.items.map((item) => ({
            item_id: String(item.item_id || '').trim(),
            quantity: normalizeQty(item.quantity),
            unit_cost: normalizeMoney(item.unit_cost),
            comment: item.comment || null,
          }))
        : [],
    })

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-receipt',
      entityId: String(result?.receipt_id || result?.id || ''),
      action: 'create',
      payload: result,
    })

    return json({ ok: true, data: result })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts.POST',
      message: error?.message || 'Store receipts POST error',
    })
    return json({ error: error?.message || 'Не удалось провести приемку' }, 500)
  }
}
