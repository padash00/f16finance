import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  createInventoryCategory,
  createInventoryItem,
  createInventoryRequest,
  ensureInventoryCompanyAccess,
  ensureInventoryLocationAccess,
  ensureInventoryRequestAccess,
  createInventorySupplier,
  decideInventoryRequest,
  fetchInventoryOverview,
  postInventoryStocktake,
  postInventoryReceipt,
  postInventoryWriteoff,
  syncInventoryItemToPointProducts,
  updateInventoryCategory,
  updateInventoryItem,
  updateInventorySupplier,
} from '@/lib/server/repositories/inventory'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

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
    item_type?: string | null
    low_stock_threshold?: number | null
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

type WriteoffBody = {
  action: 'createWriteoff'
  payload: {
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
}

type StocktakeBody = {
  action: 'createStocktake'
  payload: {
    location_id: string
    counted_at: string
    comment?: string | null
    items: Array<{
      item_id: string
      actual_qty: number
      comment?: string | null
    }>
  }
}

type UpdateCategoryBody = {
  action: 'updateCategory'
  id: string
  payload: { name: string; description?: string | null }
}

type UpdateSupplierBody = {
  action: 'updateSupplier'
  id: string
  payload: { name: string; contact_name?: string | null; phone?: string | null; notes?: string | null }
}

type UpdateItemBody = {
  action: 'updateItem'
  id: string
  payload: {
    name: string
    barcode: string
    category_id?: string | null
    sale_price?: number | null
    default_purchase_price?: number | null
    unit?: string | null
    notes?: string | null
    item_type?: string | null
    low_stock_threshold?: number | null
  }
}

type Body =
  | CategoryBody
  | SupplierBody
  | ItemBody
  | ReceiptBody
  | RequestBody
  | DecideRequestBody
  | WriteoffBody
  | StocktakeBody
  | UpdateCategoryBody
  | UpdateSupplierBody
  | UpdateItemBody

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function notifyManagersAboutRequest(requestId: string, companyName: string, itemCount: number, comment: string | null) {
  try {
    const supabase = createAdminSupabaseClient()
    const { data: staff } = await supabase
      .from('staff')
      .select('telegram_chat_id, full_name')
      .in('role', ['owner', 'manager'])
      .not('telegram_chat_id', 'is', null)

    if (!staff?.length) return

    const cn = escapeTelegramHtml(companyName)
    const text = [
      `<b>📦 Заявка на товар</b>`,
      ``,
      `<b>Точка</b> · ${cn}`,
      `<b>Позиций</b> · <b>${itemCount}</b>`,
      comment ? `💬 <b>Комментарий</b>\n${escapeTelegramHtml(comment)}` : null,
      ``,
      `<i>Выберите действие:</i>`,
    ].filter(Boolean).join('\n')

    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Одобрить всё', callback_data: `ireq:${requestId}:approve` },
        { text: '❌ Отклонить', callback_data: `ireq:${requestId}:reject` },
      ]],
    }

    if (!process.env.TELEGRAM_BOT_TOKEN) return

    for (const s of staff) {
      if (!s.telegram_chat_id) continue
      await sendTelegramMessage(String(s.telegram_chat_id), text, { replyMarkup: keyboard }).catch(() => null)
    }
  } catch { /* silent */ }
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
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const data = await fetchInventoryOverview(supabase as any, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
    })

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

    if (body.action === 'createCategory') {
      const name = String(body.payload?.name || '').trim()
      if (!name) return json({ error: 'category-name-required' }, 400)

      const category = await createInventoryCategory(supabase as any, {
        name,
        description: body.payload?.description || null,
      }, inventoryScope)

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
      }, inventoryScope)

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

      const lstCreate = body.payload?.low_stock_threshold
      const item = await createInventoryItem(supabase as any, {
        name,
        barcode,
        category_id: body.payload?.category_id || null,
        sale_price: salePrice,
        default_purchase_price: defaultPurchasePrice,
        unit: body.payload?.unit || 'шт',
        notes: body.payload?.notes || null,
        item_type: String(body.payload?.item_type || 'product') === 'consumable' ? 'consumable' : 'product',
        low_stock_threshold: lstCreate != null && Number.isFinite(Number(lstCreate)) ? Number(lstCreate) : null,
      }, inventoryScope)

      if ((item as any)?.item_type !== 'consumable') {
        await syncInventoryItemToPointProducts(supabase as any, {
          organizationId: access.activeOrganization?.id || null,
          allowedCompanyIds: companyScope.allowedCompanyIds,
          isSuperAdmin: access.isSuperAdmin,
          name,
          barcode,
          sale_price: salePrice,
          is_active: true,
        })
      }

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
      await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)

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
      await ensureInventoryLocationAccess(supabase as any, sourceLocationId, inventoryScope)
      await ensureInventoryLocationAccess(supabase as any, targetLocationId, inventoryScope)
      await ensureInventoryCompanyAccess(supabase as any, requestingCompanyId, inventoryScope)

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

      // Notify managers via Telegram (fire and forget)
      if (requestId) {
        const { data: companyRow } = await (supabase as any)
          .from('companies')
          .select('name')
          .eq('id', requestingCompanyId)
          .maybeSingle()
        const companyName = companyRow?.name || requestingCompanyId
        notifyManagersAboutRequest(
          String(requestId),
          companyName,
          normalizedItems.length,
          body.payload?.comment || null,
        ).catch(() => null)
      }

      return json({ ok: true, data: { request_id: requestId } })
    }

    if (body.action === 'decideRequest') {
      const requestId = String(body.requestId || '').trim()
      if (!requestId) return json({ error: 'request-id-required' }, 400)
      await ensureInventoryRequestAccess(supabase as any, requestId, inventoryScope)

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

    if (body.action === 'createWriteoff') {
      const locationId = String(body.payload?.location_id || '').trim()
      const writtenAt = String(body.payload?.written_at || '').trim()
      const reason = String(body.payload?.reason || '').trim()
      const items = Array.isArray(body.payload?.items) ? body.payload.items : []

      if (!locationId) return json({ error: 'writeoff-location-required' }, 400)
      if (!writtenAt) return json({ error: 'writeoff-date-required' }, 400)
      if (!reason) return json({ error: 'writeoff-reason-required' }, 400)
      if (items.length === 0) return json({ error: 'writeoff-items-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)

      const normalizedItems = items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          quantity: normalizeMoney(item.quantity),
          comment: item.comment?.trim() || null,
        }))
        .filter((item) => item.item_id && item.quantity > 0)

      if (normalizedItems.length === 0) return json({ error: 'writeoff-items-invalid' }, 400)

      const writeoff = await postInventoryWriteoff(supabase as any, {
        location_id: locationId,
        written_at: writtenAt,
        reason,
        comment: body.payload?.comment || null,
        created_by: actorUserId,
        items: normalizedItems,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-writeoff',
        entityId: String(writeoff?.writeoff_id || ''),
        action: 'create',
        payload: {
          writeoff,
          location_id: locationId,
          item_count: normalizedItems.length,
        },
      })

      return json({ ok: true, data: writeoff })
    }

    if (body.action === 'createStocktake') {
      const locationId = String(body.payload?.location_id || '').trim()
      const countedAt = String(body.payload?.counted_at || '').trim()
      const items = Array.isArray(body.payload?.items) ? body.payload.items : []

      if (!locationId) return json({ error: 'stocktake-location-required' }, 400)
      if (!countedAt) return json({ error: 'stocktake-date-required' }, 400)
      if (items.length === 0) return json({ error: 'stocktake-items-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)

      const normalizedItems = items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          actual_qty: normalizeMoney(item.actual_qty),
          comment: item.comment?.trim() || null,
        }))
        .filter((item) => item.item_id && item.actual_qty >= 0)

      if (normalizedItems.length === 0) return json({ error: 'stocktake-items-invalid' }, 400)

      const stocktake = await postInventoryStocktake(supabase as any, {
        location_id: locationId,
        counted_at: countedAt,
        comment: body.payload?.comment || null,
        created_by: actorUserId,
        items: normalizedItems,
      })

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-stocktake',
        entityId: String(stocktake?.stocktake_id || ''),
        action: 'create',
        payload: {
          stocktake,
          location_id: locationId,
          item_count: normalizedItems.length,
        },
      })

      return json({ ok: true, data: stocktake })
    }

    if (body.action === 'updateCategory') {
      const id = String((body as UpdateCategoryBody).id || '').trim()
      const name = String((body as UpdateCategoryBody).payload?.name || '').trim()
      if (!id) return json({ error: 'category-id-required' }, 400)
      if (!name) return json({ error: 'category-name-required' }, 400)
      const category = await updateInventoryCategory(supabase as any, id, {
        name,
        description: (body as UpdateCategoryBody).payload?.description || null,
      }, inventoryScope)
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-category', entityId: id, action: 'update', payload: category })
      return json({ ok: true, data: category })
    }

    if (body.action === 'updateSupplier') {
      const id = String((body as UpdateSupplierBody).id || '').trim()
      const name = String((body as UpdateSupplierBody).payload?.name || '').trim()
      if (!id) return json({ error: 'supplier-id-required' }, 400)
      if (!name) return json({ error: 'supplier-name-required' }, 400)
      const supplier = await updateInventorySupplier(supabase as any, id, {
        name,
        contact_name: (body as UpdateSupplierBody).payload?.contact_name || null,
        phone: (body as UpdateSupplierBody).payload?.phone || null,
        notes: (body as UpdateSupplierBody).payload?.notes || null,
      }, inventoryScope)
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-supplier', entityId: id, action: 'update', payload: supplier })
      return json({ ok: true, data: supplier })
    }

    if (body.action === 'updateItem') {
      const id = String((body as UpdateItemBody).id || '').trim()
      const name = String((body as UpdateItemBody).payload?.name || '').trim()
      const barcode = String((body as UpdateItemBody).payload?.barcode || '').trim()
      const salePrice = normalizeMoney((body as UpdateItemBody).payload?.sale_price)
      const defaultPurchasePrice = normalizeMoney((body as UpdateItemBody).payload?.default_purchase_price)
      if (!id) return json({ error: 'item-id-required' }, 400)
      if (!name) return json({ error: 'item-name-required' }, 400)
      if (!barcode) return json({ error: 'item-barcode-required' }, 400)
      const lstUpdate = (body as UpdateItemBody).payload?.low_stock_threshold
      const item = await updateInventoryItem(supabase as any, id, {
        name,
        barcode,
        category_id: (body as UpdateItemBody).payload?.category_id || null,
        sale_price: salePrice,
        default_purchase_price: defaultPurchasePrice,
        unit: (body as UpdateItemBody).payload?.unit || 'шт',
        notes: (body as UpdateItemBody).payload?.notes || null,
        item_type: String((body as UpdateItemBody).payload?.item_type || 'product') === 'consumable' ? 'consumable' : 'product',
        low_stock_threshold: lstUpdate != null && Number.isFinite(Number(lstUpdate)) ? Number(lstUpdate) : null,
      }, inventoryScope)

      if ((item as any)?.item_type !== 'consumable') {
        await syncInventoryItemToPointProducts(supabase as any, {
          organizationId: access.activeOrganization?.id || null,
          allowedCompanyIds: companyScope.allowedCompanyIds,
          isSuperAdmin: access.isSuperAdmin,
          name,
          barcode,
          sale_price: salePrice,
          is_active: true,
        })
      }

      await writeAuditLog(supabase as any, { actorUserId, entityType: 'inventory-item', entityId: id, action: 'update', payload: item })
      return json({ ok: true, data: item })
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
