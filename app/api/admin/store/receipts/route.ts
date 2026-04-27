import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { bulkSyncInventoryItemsToPointProducts, ensureInventoryLocationAccess, fetchStoreReceipts, postInventoryReceipt } from '@/lib/server/repositories/inventory'
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
  action: 'createReceipt' | 'saveDraft' | 'deleteDraft'
  payload?: {
    location_id: string
    supplier_id?: string | null
    supplier_create?: {
      name: string
      bin_iin: string
      organization_name: string
    } | null
    received_at: string
    invoice_number?: string | null
    invoice_file_url?: string | null
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_cost: number
      sale_price?: number
      comment?: string | null
    }>
  }
  draft_id?: string
  draft_title?: string | null
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

function normalizeDigits(value: unknown) {
  return String(value || '').replace(/\D/g, '')
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

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
    const data = await fetchStoreReceipts(supabase as any, inventoryScope)
    let draftsQuery: any = supabase
      .from('inventory_receipt_drafts')
      .select('id, title, payload, status, created_at, updated_at')
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(30)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      draftsQuery = draftsQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: drafts, error: draftsError } = await draftsQuery
    if (draftsError) throw draftsError
    const locationType = scope === 'showcase' ? 'point_display' : scope === 'warehouse' ? 'warehouse' : null
    if (locationType) {
      data.locations = (data.locations || []).filter((l: any) => l?.location_type === locationType)
      data.receipts = (data.receipts || []).filter((r: any) => r?.location?.location_type === locationType)
    }
    return json({ ok: true, data: { ...data, drafts: drafts || [] } })
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
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    if (body.action === 'deleteDraft') {
      const draftId = String(body.draft_id || '').trim()
      if (!draftId) return json({ error: 'draft-id-required' }, 400)
      let query: any = supabase
        .from('inventory_receipt_drafts')
        .update({ status: 'cancelled' })
        .eq('id', draftId)
        .eq('status', 'draft')
      if (!access.isSuperAdmin && access.activeOrganization?.id) {
        query = query.eq('organization_id', access.activeOrganization.id)
      }
      const { error: deleteDraftError } = await query
      if (deleteDraftError) throw deleteDraftError
      return json({ ok: true })
    }

    if (body.action === 'saveDraft') {
      const payload = body.payload || ({} as any)
      const draftTitle = String(body.draft_title || payload.invoice_number || 'Черновик приемки').trim()
      const draftId = String(body.draft_id || '').trim()
      const draftPayload = {
        location_id: String(payload.location_id || '').trim(),
        supplier_id: String(payload.supplier_id || '').trim() || null,
        supplier_create: payload.supplier_create || null,
        received_at: String(payload.received_at || '').trim() || null,
        invoice_number: String(payload.invoice_number || '').trim() || null,
        invoice_file_url: String(payload.invoice_file_url || '').trim() || null,
        comment: String(payload.comment || '').trim() || null,
        items: Array.isArray(payload.items) ? payload.items : [],
      }
      if (draftId) {
        let updateQuery: any = supabase
          .from('inventory_receipt_drafts')
          .update({
            title: draftTitle || 'Черновик приемки',
            payload: draftPayload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', draftId)
          .eq('status', 'draft')
        if (!access.isSuperAdmin && access.activeOrganization?.id) {
          updateQuery = updateQuery.eq('organization_id', access.activeOrganization.id)
        }
        const { data: updatedDraft, error: updateDraftError } = await updateQuery.select('id').single()
        if (updateDraftError) throw updateDraftError
        return json({ ok: true, data: { id: updatedDraft.id } })
      }
      const insertPayload: Record<string, unknown> = {
        organization_id: access.activeOrganization?.id || null,
        created_by: actorUserId,
        title: draftTitle || 'Черновик приемки',
        payload: draftPayload,
      }
      const { data: createdDraft, error: createDraftError } = await supabase
        .from('inventory_receipt_drafts')
        .insert([insertPayload])
        .select('id')
        .single()
      if (createDraftError) throw createDraftError
      return json({ ok: true, data: { id: createdDraft.id } })
    }

    if (body.action !== 'createReceipt') return json({ error: 'invalid-action' }, 400)
    if (!body.payload) return json({ error: 'payload-required' }, 400)
    await ensureInventoryLocationAccess(supabase as any, String(body.payload.location_id || '').trim(), inventoryScope)

    const supplierIdRaw = String(body.payload.supplier_id || '').trim()
    const supplierCreate = body.payload.supplier_create || null
    let supplierId: string | null = supplierIdRaw || null

    if (!supplierId && supplierCreate) {
      const binIin = normalizeDigits(supplierCreate.bin_iin)
      const supplierName = String(supplierCreate.name || '').trim()
      const organizationName = String(supplierCreate.organization_name || '').trim()
      if (!supplierName) return json({ error: 'Введите название поставщика' }, 400)
      if (!organizationName) return json({ error: 'Введите название организации' }, 400)
      if (!/^\d{12}$/.test(binIin)) return json({ error: 'ИИН/БИН должен состоять из 12 цифр' }, 400)

      let existingQuery: any = supabase
        .from('inventory_suppliers')
        .select('id')
        .eq('bin_iin', binIin)
        .limit(1)
      if (!access.isSuperAdmin && access.activeOrganization?.id) {
        existingQuery = existingQuery.eq('organization_id', access.activeOrganization.id)
      }
      const { data: existingSupplier, error: existingSupplierError } = await existingQuery.maybeSingle()
      if (existingSupplierError) throw existingSupplierError

      if (existingSupplier?.id) {
        supplierId = String(existingSupplier.id)
      } else {
        const insertPayload: Record<string, unknown> = {
          name: supplierName,
          organization_name: organizationName,
          bin_iin: binIin,
          contact_name: null,
          phone: null,
          notes: null,
        }
        if (!access.isSuperAdmin && access.activeOrganization?.id) {
          insertPayload.organization_id = access.activeOrganization.id
        }
        const { data: createdSupplier, error: createSupplierError } = await supabase
          .from('inventory_suppliers')
          .insert([insertPayload])
          .select('id')
          .single()
        if (createSupplierError) throw createSupplierError
        supplierId = String(createdSupplier.id)
      }
    }
    if (!supplierId) return json({ error: 'Укажите поставщика (или создайте нового с ИИН/БИН и названием организации)' }, 400)

    const invoiceFileUrl = String(body.payload.invoice_file_url || '').trim()
    if (!invoiceFileUrl) return json({ error: 'Загрузите накладную (без документа приемка запрещена)' }, 400)

    const invoiceNumber = String(body.payload.invoice_number || '').trim()
    if (invoiceNumber) {
      let duplicateQuery: any = supabase
        .from('inventory_receipts')
        .select('id')
        .eq('supplier_id', supplierId)
        .eq('invoice_number', invoiceNumber)
        .eq('received_at', body.payload.received_at)
        .limit(1)
      const { data: duplicateReceipt, error: duplicateError } = await duplicateQuery.maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicateReceipt?.id) {
        return json({ error: 'Похоже, такая накладная уже проведена (дубликат БИН/ИИН + номер + дата)' }, 409)
      }
    }

    const result = await postInventoryReceipt(supabase as any, {
      location_id: String(body.payload.location_id || '').trim(),
      supplier_id: supplierId,
      received_at: body.payload.received_at,
      invoice_number: invoiceNumber || null,
      invoice_file_url: invoiceFileUrl,
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

    // Always update sale/default purchase prices globally from receipt lines
    if (Array.isArray(body.payload.items)) {
      const updatesRaw = body.payload.items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          unit_cost: normalizeMoney(item.unit_cost),
          sale_price: normalizeMoney(item.sale_price),
        }))
        .filter((item) => item.item_id && item.sale_price >= 0)

      const updatesMap = new Map<string, { item_id: string; unit_cost: number; sale_price: number }>()
      for (const row of updatesRaw) updatesMap.set(row.item_id, row)
      const updates = [...updatesMap.values()]
      const syncItems: Array<{ name: string; barcode: string; sale_price: number; is_active?: boolean }> = []

      for (const row of updates) {
        let query: any = supabase
          .from('inventory_items')
          .update({
            sale_price: row.sale_price,
            default_purchase_price: row.unit_cost,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.item_id)
          .select('name, barcode, sale_price, is_active')
          .single()
        if (!access.isSuperAdmin && access.activeOrganization?.id) {
          query = query.eq('organization_id', access.activeOrganization.id)
        }
        const { data: itemRow, error: upErr } = await query
        if (upErr) throw upErr
        if (itemRow?.name && itemRow?.barcode) {
          syncItems.push({
            name: String(itemRow.name),
            barcode: String(itemRow.barcode),
            sale_price: Number(itemRow.sale_price || 0),
            is_active: itemRow.is_active !== false,
          })
        }
      }

      if (syncItems.length > 0) {
        await bulkSyncInventoryItemsToPointProducts(supabase as any, syncItems, {
          organizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      }
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'inventory-receipt',
      entityId: String(result?.receipt_id || result?.id || ''),
      action: 'create',
      payload: {
        ...result,
        update_sale_price: true,
      },
    })

    const draftId = String(body.draft_id || '').trim()
    if (draftId) {
      let draftUpdateQuery: any = supabase
        .from('inventory_receipt_drafts')
        .update({
          status: 'posted',
          posted_receipt_id: String(result?.receipt_id || result?.id || '') || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId)
        .eq('status', 'draft')
      if (!access.isSuperAdmin && access.activeOrganization?.id) {
        draftUpdateQuery = draftUpdateQuery.eq('organization_id', access.activeOrganization.id)
      }
      const { error: draftMarkError } = await draftUpdateQuery
      if (draftMarkError) throw draftMarkError
    }

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
