import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  createInventoryCategory,
  createInventoryItem,
  createInventoryRequest,
  createInventorySupplier,
  decideInventoryRequest,
  fetchInventoryOverview,
  postInventoryReceipt,
} from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type CategoryBody = {
  action: 'createCategory'
  payload: {
    name: string
    description?: string | null
  }
}

type SupplierBody = {
  action: 'createSupplier'
  payload: {
    name: string
    contact_name?: string | null
    phone?: string | null
    notes?: string | null
  }
}

type ItemBody = {
  action: 'createItem'
  payload: {
    name: string
    barcode: string
    category_id?: string | null
    sale_price?: number | null
    default_purchase_price?: number | null
    unit?: string | null
    notes?: string | null
  }
}

type ReceiptBody = {
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

type RequestBody = {
  action: 'createRequest'
  payload: {
    source_location_id: string
    target_location_id: string
    requesting_company_id: string
    comment?: string | null
    items: Array<{
      item_id: string
      requested_qty: number
      comment?: string | null
    }>
  }
}

type DecideRequestBody = {
  action: 'decideRequest'
  requestId: string
  approved: boolean
  decision_comment?: string | null
  items?: Array<{
    request_item_id: string
    approved_qty: number
  }>
}

type Body = CategoryBody | SupplierBody | ItemBody | ReceiptBody | RequestBody | DecideRequestBody

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMoney(value: unknown) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

function canManageInventory(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const data = await fetchInventoryOverview(supabase as any)

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory.GET',
      message: error?.message || 'Inventory GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить складской контур' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null
    const body = (await request.json().catch(() => null)) as Body | null

    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    if (body.action === 'createCategory') {
      const name = String(body.payload?.name || '').trim()
      if (!name) return json({ error: 'category-name-required' }, 400)

      const category = await createInventoryCategory(supabase as any, {
        name,
        description: body.payload?.description || null,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-category',
        entityId: String(category.id),
        action: 'create',
        payload: category,
      })

      return json({ ok: true, data: category })
    }

    if (body.action === 'createSupplier') {
      const name = String(body.payload?.name || '').trim()
      if (!name) return json({ error: 'supplier-name-required' }, 400)

      const supplier = await createInventorySupplier(supabase as any, {
        name,
        contact_name: body.payload?.contact_name || null,
        phone: body.payload?.phone || null,
        notes: body.payload?.notes || null,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-supplier',
        entityId: String(supplier.id),
        action: 'create',
        payload: supplier,
      })

      return json({ ok: true, data: supplier })
    }

    if (body.action === 'createItem') {
      const name = String(body.payload?.name || '').trim()
      const barcode = String(body.payload?.barcode || '').trim()
      const salePrice = normalizeMoney(body.payload?.sale_price)
      const defaultPurchasePrice = normalizeMoney(body.payload?.default_purchase_price)

      if (!name) return json({ error: 'item-name-required' }, 400)
      if (!barcode) return json({ error: 'item-barcode-required' }, 400)
      if (salePrice < 0) return json({ error: 'item-sale-price-invalid' }, 400)

      const item = await createInventoryItem(supabase as any, {
        name,
        barcode,
        category_id: body.payload?.category_id || null,
        sale_price: salePrice,
        default_purchase_price: defaultPurchasePrice,
        unit: body.payload?.unit || 'шт',
        notes: body.payload?.notes || null,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-item',
        entityId: String(item.id),
        action: 'create',
        payload: item,
      })

      return json({ ok: true, data: item })
    }

    if (body.action === 'createReceipt') {
      const locationId = String(body.payload?.location_id || '').trim()
      const receivedAt = String(body.payload?.received_at || '').trim()
      const items = Array.isArray(body.payload?.items) ? body.payload.items : []

      if (!locationId) return json({ error: 'receipt-location-required' }, 400)
      if (!receivedAt) return json({ error: 'receipt-date-required' }, 400)
      if (items.length === 0) return json({ error: 'receipt-items-required' }, 400)

      const normalizedItems = items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          quantity: normalizeMoney(item.quantity),
          unit_cost: normalizeMoney(item.unit_cost),
          comment: item.comment?.trim() || null,
        }))
        .filter((item) => item.item_id && item.quantity > 0)

      if (normalizedItems.length === 0) return json({ error: 'receipt-items-invalid' }, 400)

      const receipt = await postInventoryReceipt(supabase as any, {
        location_id: locationId,
        supplier_id: body.payload?.supplier_id || null,
        received_at: receivedAt,
        invoice_number: body.payload?.invoice_number || null,
        comment: body.payload?.comment || null,
        created_by: actorUserId,
        items: normalizedItems,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-receipt',
        entityId: String(receipt?.receipt_id || ''),
        action: 'create',
        payload: {
          receipt,
          item_count: normalizedItems.length,
          location_id: locationId,
        },
      })

      return json({ ok: true, data: receipt })
    }

    if (body.action === 'createRequest') {
      const sourceLocationId = String(body.payload?.source_location_id || '').trim()
      const targetLocationId = String(body.payload?.target_location_id || '').trim()
      const requestingCompanyId = String(body.payload?.requesting_company_id || '').trim()
      const items = Array.isArray(body.payload?.items) ? body.payload.items : []

      if (!sourceLocationId) return json({ error: 'request-source-location-required' }, 400)
      if (!targetLocationId) return json({ error: 'request-target-location-required' }, 400)
      if (!requestingCompanyId) return json({ error: 'request-company-required' }, 400)
      if (items.length === 0) return json({ error: 'request-items-required' }, 400)

      const normalizedItems = items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          requested_qty: normalizeMoney(item.requested_qty),
          comment: item.comment?.trim() || null,
        }))
        .filter((item) => item.item_id && item.requested_qty > 0)

      if (normalizedItems.length === 0) return json({ error: 'request-items-invalid' }, 400)

      const requestId = await createInventoryRequest(supabase as any, {
        source_location_id: sourceLocationId,
        target_location_id: targetLocationId,
        requesting_company_id: requestingCompanyId,
        comment: body.payload?.comment || null,
        created_by: actorUserId,
        items: normalizedItems,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-request',
        entityId: String(requestId || ''),
        action: 'create',
        payload: {
          request_id: requestId,
          source_location_id: sourceLocationId,
          target_location_id: targetLocationId,
          requesting_company_id: requestingCompanyId,
          item_count: normalizedItems.length,
        },
      })

      return json({ ok: true, data: { request_id: requestId } })
    }

    if (body.action === 'decideRequest') {
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)

      const decision = await decideInventoryRequest(supabase as any, {
        request_id: requestId,
        approved: body.approved === true,
        decision_comment: body.decision_comment || null,
        actor_user_id: actorUserId,
        items: Array.isArray(body.items)
          ? body.items.map((item) => ({
              request_item_id: String(item.request_item_id || '').trim(),
              approved_qty: normalizeMoney(item.approved_qty),
            }))
          : [],
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-request',
        entityId: requestId,
        action: body.approved ? 'approve' : 'reject',
        payload: {
          request_id: requestId,
          approved: body.approved === true,
          decision,
        },
      })

      return json({ ok: true, data: decision })
    }

    return json({ error: 'unsupported-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/inventory.POST',
      message: error?.message || 'Inventory POST error',
    })
    return json({ error: error?.message || 'Не удалось выполнить складскую операцию' }, 500)
  }
}
