import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { bulkSyncInventoryItemsToPointProducts, ensureInventoryLocationAccess, fetchStoreReceipts, postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { humanizeDbError } from '@/lib/server/db-error-humanize'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

// Оприходование = ручное добавление товара без поставщика. Это чувствительная операция,
// её разрешаем только владельцу/суперадмину, чтобы менеджеры не могли «нарисовать» остатки.
function canPostInventory(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  return access.isSuperAdmin || access.staffRole === 'owner'
}

type Body = {
  action: 'createReceipt' | 'saveDraft' | 'deleteDraft' | 'cancelReceipt' | 'createPosting'
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
    expense_category_id?: string | null
    payment_method?: 'cash' | 'kaspi' | null
    payment_mode?: 'now' | 'deferred' | null
    payment_receipt_file_url?: string | null
    is_consignment?: boolean | null
    due_date?: string | null
    comment?: string | null
    items: Array<{
      item_id: string
      quantity: number
      unit_cost: number
      sale_price?: number
      comment?: string | null
      invoice_name?: string | null
    }>
  }
  posting?: {
    location_id: string
    received_at: string
    comment?: string | null
    items: Array<{ item_id: string; quantity: number; unit_cost?: number; comment?: string | null }>
  }
  receipt_id?: string
  cancel_reason?: string
  draft_id?: string
  draft_title?: string | null
}

function normalizeMoney(value: unknown) {
  const numeric = Number(String(value ?? 0).replace(',', '.'))
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

function normalizeUnitCost(value: unknown) {
  const numeric = Number(String(value ?? 0).replace(',', '.'))
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000
}

function normalizeQty(value: unknown) {
  const amount = Number(String(value ?? 0).replace(',', '.'))
  if (!Number.isFinite(amount)) return 0
  return Math.round((amount + Number.EPSILON) * 1000) / 1000
}

function normalizeDigits(value: unknown) {
  return String(value || '').replace(/\D/g, '')
}

function isUniqueViolation(error: any) {
  return String(error?.code || '') === '23505'
}

async function resolveLocationOrganizationId(
  supabase: any,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, organization_id, company:company_id(organization_id)')
    .eq('id', locationId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const orgFromLocation = (data as any)?.organization_id
  const orgFromCompany = (data as any)?.company?.organization_id
  return orgFromLocation ? String(orgFromLocation) : orgFromCompany ? String(orgFromCompany) : null
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
    const { data: expenseCategories, error: expenseCategoriesError } = await supabase
      .from('expense_categories')
      .select('id, name, accounting_group')
      .order('name', { ascending: true })
    if (expenseCategoriesError) throw expenseCategoriesError
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
    return json({ ok: true, data: { ...data, drafts: drafts || [], expense_categories: expenseCategories || [] } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts.GET',
      message: error?.message || 'Store receipts GET error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить приемку магазина') }, 500)
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
      const denied = await requireCapability(access, 'store-receipts.delete')
      if (denied) return denied as any
      const draftId = String(body.draft_id || '').trim()
      if (!draftId) return json({ error: 'draft-id-required' }, 400)
      let currentDraftQuery: any = supabase
        .from('inventory_receipt_drafts')
        .select('id, title, payload, updated_at')
        .eq('id', draftId)
        .eq('status', 'draft')
        .maybeSingle()
      if (!access.isSuperAdmin && access.activeOrganization?.id) {
        currentDraftQuery = currentDraftQuery.eq('organization_id', access.activeOrganization.id)
      }
      const { data: currentDraft, error: currentDraftError } = await currentDraftQuery
      if (currentDraftError) throw currentDraftError
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
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-receipt-draft',
        entityId: draftId,
        action: 'delete',
        payload: {
          title: currentDraft?.title || null,
          invoice_number: (currentDraft?.payload as any)?.invoice_number || null,
          received_at: (currentDraft?.payload as any)?.received_at || null,
          item_count: Array.isArray((currentDraft?.payload as any)?.items) ? (currentDraft?.payload as any).items.length : 0,
          updated_at: currentDraft?.updated_at || null,
        },
      })
      return json({ ok: true })
    }

    if (body.action === 'cancelReceipt') {
      const denied = await requireCapability(access, 'store-receipts.cancel')
      if (denied) return denied as any
      const receiptId = String(body.receipt_id || '').trim()
      if (!receiptId) return json({ error: 'receipt-id-required' }, 400)
      const reason = String(body.cancel_reason || '').trim() || null

      // Authorize against location scope (organization/company access)
      const { data: receiptRow, error: receiptErr } = await supabase
        .from('inventory_receipts')
        .select('id, status, location_id, supplier_id, total_amount, received_at, kind')
        .eq('id', receiptId)
        .maybeSingle()
      if (receiptErr) throw receiptErr
      if (!receiptRow) return json({ error: 'receipt-not-found' }, 404)
      await ensureInventoryLocationAccess(supabase as any, String(receiptRow.location_id), inventoryScope)

      const { error: rpcErr } = await supabase.rpc('inventory_cancel_receipt', {
        p_receipt_id: receiptId,
        p_reason: reason,
        p_actor_user_id: actorUserId,
      })
      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('inventory-receipt-already-cancelled')) {
          return json({ error: 'Приёмка уже отменена' }, 409)
        }
        if (msg.includes('inventory-receipt-cancel-insufficient-stock')) {
          return json(
            {
              error: 'cancel-insufficient-stock',
              message:
                'Нельзя отменить: часть полученного товара уже выдана/продана. Сначала верните товар на склад.',
            },
            409,
          )
        }
        throw rpcErr
      }

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-receipt',
        entityId: receiptId,
        action: 'cancel',
        payload: {
          reason,
          location_id: receiptRow.location_id,
          supplier_id: receiptRow.supplier_id,
          received_at: receiptRow.received_at,
          total_amount: receiptRow.total_amount,
          kind: (receiptRow as any).kind || 'supplier',
        },
      })

      return json({ ok: true })
    }

    if (body.action === 'createPosting') {
      if (!canPostInventory(access)) {
        return json(
          { error: 'forbidden', message: 'Оприходование разрешено только владельцу или суперадминистратору' },
          403,
        )
      }
      const posting = body.posting
      if (!posting) return json({ error: 'posting-required' }, 400)
      const locationId = String(posting.location_id || '').trim()
      if (!locationId) return json({ error: 'location-required' }, 400)
      await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)

      // Разрешаем оприходование на склад или на витрину; запрещаем catalog_total и любые другие
      const { data: locRow, error: locErr } = await supabase
        .from('inventory_locations')
        .select('id, location_type, name')
        .eq('id', locationId)
        .maybeSingle()
      if (locErr) throw locErr
      if (!locRow) return json({ error: 'location-not-found' }, 404)
      if (locRow.location_type !== 'warehouse' && locRow.location_type !== 'point_display') {
        return json({ error: 'Оприходовать можно только на склад или на витрину' }, 400)
      }

      const items = (posting.items || [])
        .map((i) => ({
          item_id: String(i.item_id || '').trim(),
          quantity: normalizeQty(i.quantity),
          unit_cost: normalizeUnitCost(i.unit_cost ?? 0),
          comment: i.comment || null,
        }))
        .filter((i) => i.item_id && i.quantity > 0)

      if (items.length === 0) return json({ error: 'items-required' }, 400)

      const receivedAt = String(posting.received_at || '').trim() || new Date().toISOString().slice(0, 10)
      const comment = String(posting.comment || '').trim() || 'Оприходование'

      const result: any = await postInventoryReceipt(supabase as any, {
        location_id: locationId,
        received_at: receivedAt,
        supplier_id: null,
        comment,
        created_by: actorUserId,
        items,
      })
      const newReceiptId = String(result?.receipt_id || result?.id || '')
      if (newReceiptId) {
        const { error: kindErr } = await supabase
          .from('inventory_receipts')
          .update({ kind: 'posting' })
          .eq('id', newReceiptId)
        if (kindErr) throw kindErr
      }

      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-receipt',
        entityId: newReceiptId,
        action: 'create_posting',
        payload: {
          location_id: locationId,
          received_at: receivedAt,
          comment,
          item_count: items.length,
          kind: 'posting',
        },
      })

      return json({ ok: true, data: { receipt_id: newReceiptId, kind: 'posting' } })
    }

    if (body.action === 'saveDraft') {
      const denied = await requireCapability(access, 'store-receipts.create')
      if (denied) return denied as any
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
        expense_category_id: String(payload.expense_category_id || '').trim() || null,
        payment_method: payload.payment_method === 'kaspi' ? 'kaspi' : 'cash',
        payment_mode: payload.payment_mode === 'deferred' ? 'deferred' : 'now',
        payment_receipt_file_url: String(payload.payment_receipt_file_url || '').trim() || null,
        is_consignment: Boolean(payload.is_consignment),
        due_date: String(payload.due_date || '').trim() || null,
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
        await writeAuditLog(supabase as any, {
          actorUserId,
          entityType: 'inventory-receipt-draft',
          entityId: String(updatedDraft.id),
          action: 'update',
          payload: {
            title: draftTitle || 'Черновик приемки',
            invoice_number: draftPayload.invoice_number,
            received_at: draftPayload.received_at,
            supplier_id: draftPayload.supplier_id,
            item_count: draftPayload.items.length,
            payment_mode: draftPayload.payment_mode,
          },
        })
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
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'inventory-receipt-draft',
        entityId: String(createdDraft.id),
        action: 'create',
        payload: {
          title: draftTitle || 'Черновик приемки',
          invoice_number: draftPayload.invoice_number,
          received_at: draftPayload.received_at,
          supplier_id: draftPayload.supplier_id,
          item_count: draftPayload.items.length,
          payment_mode: draftPayload.payment_mode,
        },
      })
      return json({ ok: true, data: { id: createdDraft.id } })
    }

    if (body.action !== 'createReceipt') return json({ error: 'invalid-action' }, 400)
    {
      const denied = await requireCapability(access, 'store-receipts.create')
      if (denied) return denied as any
    }
    if (!body.payload) return json({ error: 'payload-required' }, 400)
    const locationId = String(body.payload.location_id || '').trim()
    await ensureInventoryLocationAccess(supabase as any, locationId, inventoryScope)
    const locationOrganizationId =
      (await resolveLocationOrganizationId(supabase as any, locationId)) || access.activeOrganization?.id || null

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
        let existingByNameQuery: any = supabase
          .from('inventory_suppliers')
          .select('id, organization_id')
          .ilike('name', supplierName)
          .limit(1)
        if (!access.isSuperAdmin && locationOrganizationId) {
          existingByNameQuery = existingByNameQuery.eq('organization_id', locationOrganizationId)
        }
        const { data: existingByName, error: existingByNameError } = await existingByNameQuery.maybeSingle()
        if (existingByNameError) throw existingByNameError
        if (existingByName?.id) {
          supplierId = String(existingByName.id)
        } else {
          const insertPayload: Record<string, unknown> = {
            name: supplierName,
            organization_name: organizationName,
            bin_iin: binIin,
            organization_id: locationOrganizationId,
            contact_name: null,
            phone: null,
            notes: null,
          }
          if (!insertPayload.organization_id) {
            return json({ error: 'Не удалось определить организацию поставщика по выбранной точке приемки' }, 400)
          }
          const { data: createdSupplier, error: createSupplierError } = await supabase
            .from('inventory_suppliers')
            .insert([insertPayload])
            .select('id')
            .single()
          if (createSupplierError) {
            if (!isUniqueViolation(createSupplierError)) throw createSupplierError
            let conflictedByNameQuery: any = supabase
              .from('inventory_suppliers')
              .select('id, organization_id')
              .ilike('name', supplierName)
              .limit(1)
            if (!access.isSuperAdmin && locationOrganizationId) {
              conflictedByNameQuery = conflictedByNameQuery.eq('organization_id', locationOrganizationId)
            }
            const { data: conflictedByName, error: conflictedByNameError } = await conflictedByNameQuery.maybeSingle()
            if (conflictedByNameError) throw conflictedByNameError
            if (!conflictedByName?.id) {
              throw createSupplierError
            }
            supplierId = String(conflictedByName.id)
          } else {
            supplierId = String(createdSupplier.id)
          }
        }
      }
    }
    if (!supplierId) return json({ error: 'Укажите поставщика (или создайте нового с ИИН/БИН и названием организации)' }, 400)

    const invoiceFileUrl = String(body.payload.invoice_file_url || '').trim()
    if (!invoiceFileUrl) return json({ error: 'Загрузите накладную (без документа приемка запрещена)' }, 400)
    const expenseCategoryId = String(body.payload.expense_category_id || '').trim()
    if (!expenseCategoryId) return json({ error: 'Выберите категорию расхода (COGS) для автодобавления' }, 400)

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
            unit_cost: normalizeUnitCost(item.unit_cost),
            comment: item.comment || null,
          }))
        : [],
    })
    const receiptId = String(result?.receipt_id || result?.id || '').trim()
    if (!receiptId) throw new Error('Не удалось получить id приемки')

    const { data: expenseCategory, error: expenseCategoryError } = await supabase
      .from('expense_categories')
      .select('id, name, accounting_group')
      .eq('id', expenseCategoryId)
      .maybeSingle()
    if (expenseCategoryError) throw expenseCategoryError
    if (!expenseCategory?.id || String(expenseCategory.accounting_group || '').trim().toLowerCase() !== 'cogs') {
      return json({ error: 'Категория расхода должна быть из финансовой группы COGS' }, 400)
    }

    const { data: locationRow, error: locationError } = await supabase
      .from('inventory_locations')
      .select('id, name, location_type, company_id, company:company_id(name, code)')
      .eq('id', String(body.payload.location_id || '').trim())
      .maybeSingle()
    if (locationError) throw locationError
    const companyId = String(locationRow?.company_id || '').trim()
    if (!companyId) {
      return json({ error: 'Для автодобавления расхода нужна локация с привязкой к точке (company_id)' }, 400)
    }

    const { data: supplierRow, error: supplierError } = await supabase
      .from('inventory_suppliers')
      .select('id, name, organization_name, bin_iin')
      .eq('id', supplierId)
      .maybeSingle()
    if (supplierError) throw supplierError

    const autoExpenseCommentParts = [
      `Авто из приемки №${invoiceNumber || receiptId}`,
      supplierCreate?.organization_name ? `Организация: ${supplierCreate.organization_name}` : null,
      supplierCreate?.bin_iin ? `БИН/ИИН: ${normalizeDigits(supplierCreate.bin_iin)}` : null,
      body.payload.comment ? `Комментарий приемки: ${String(body.payload.comment || '').trim()}` : null,
    ].filter(Boolean)
    const autoExpenseComment = autoExpenseCommentParts.join('\n')

    const receiptTotal = Number(result?.total_amount || 0)
    const paymentMode = body.payload.payment_mode === 'deferred' ? 'deferred' : 'now'
    const paymentMethod = body.payload.payment_method === 'kaspi' ? 'kaspi' : 'cash'
    const paymentReceiptFileUrl = String(body.payload.payment_receipt_file_url || '').trim() || null
    const isConsignment = Boolean(body.payload.is_consignment)
    const dueDate = String(body.payload.due_date || '').trim() || null

    if (paymentMode === 'now' && !paymentReceiptFileUrl) {
      return json({ error: 'Загрузите чек об оплате (для приемки с оплатой сразу)' }, 400)
    }

    let createdExpenseId: string | null = null
    if (paymentMode === 'now') {
      const existingExpenseQuery: any = supabase
        .from('expenses')
        .select('id')
        .eq('source_type', 'inventory_receipt')
        .eq('source_id', receiptId)
        .limit(1)
      const { data: existingExpense, error: existingExpenseError } = await existingExpenseQuery.maybeSingle()
      if (existingExpenseError) throw existingExpenseError
      if (existingExpense?.id) {
        createdExpenseId = String(existingExpense.id)
      } else {
        const expenseInsertPayload: Record<string, unknown> = {
          date: body.payload.received_at,
          company_id: companyId,
          operator_id: null,
          category: String(expenseCategory.name || '').trim(),
          cash_amount: paymentMethod === 'cash' ? receiptTotal : 0,
          kaspi_amount: paymentMethod === 'kaspi' ? receiptTotal : 0,
          comment: autoExpenseComment || 'Авто из приемки',
          attachment_url: paymentReceiptFileUrl,
          document_kind: 'receipt',
          document_url: paymentReceiptFileUrl,
          status: 'confirmed',
          source_type: 'inventory_receipt',
          source_id: receiptId,
        }
        const { data: insertedExpense, error: autoExpenseError } = await supabase
          .from('expenses')
          .insert([expenseInsertPayload])
          .select('id')
          .single()
        if (autoExpenseError) throw autoExpenseError
        createdExpenseId = String(insertedExpense?.id || '')
      }
    }

    // upsert supplier_debts for this receipt (one debt per receipt)
    const debtPayload: Record<string, unknown> = {
      receipt_id: receiptId,
      supplier_id: supplierId,
      company_id: companyId,
      organization_id: locationOrganizationId,
      expense_category_id: expenseCategory.id,
      total_amount: receiptTotal,
      status: paymentMode === 'now' ? 'paid' : 'open',
      due_date: dueDate,
      is_consignment: isConsignment,
      payment_paid_at: paymentMode === 'now' ? body.payload.received_at : null,
      payment_cash_amount: paymentMode === 'now' && paymentMethod === 'cash' ? receiptTotal : 0,
      payment_kaspi_amount: paymentMode === 'now' && paymentMethod === 'kaspi' ? receiptTotal : 0,
      payment_receipt_file_url: paymentMode === 'now' ? paymentReceiptFileUrl : null,
      payment_comment: paymentMode === 'now' ? body.payload.comment || null : null,
      expense_id: createdExpenseId,
      created_by: actorUserId,
    }
    const { error: debtError } = await supabase
      .from('supplier_debts')
      .upsert([debtPayload], { onConflict: 'receipt_id' })
    if (debtError) throw debtError

    // Remember this COGS category as the supplier's preferred for next time.
    if (supplierId && expenseCategory.id) {
      await supabase
        .from('inventory_suppliers')
        .update({ preferred_expense_category_id: expenseCategory.id })
        .eq('id', supplierId)
        .then(() => null, () => null)
    }

    // Learn supplier→item aliases from this receipt for the next AI parse run.
    if (locationOrganizationId && Array.isArray(body.payload.items)) {
      const aliasUpserts: Array<{
        invoice_name: string
        item_id: string
        organization_id: string
        supplier_id?: string | null
        last_unit_cost?: number | null
        last_sale_price?: number | null
      }> = []
      for (const line of body.payload.items) {
        const rawName = String(line.invoice_name || '').trim()
        const itemId = String(line.item_id || '').trim()
        if (!rawName || !itemId) continue
        aliasUpserts.push({
          invoice_name: rawName,
          item_id: itemId,
          organization_id: locationOrganizationId,
          supplier_id: supplierId,
          last_unit_cost: normalizeUnitCost(line.unit_cost),
          last_sale_price: line.sale_price != null ? normalizeMoney(line.sale_price) : null,
        })
      }
      if (aliasUpserts.length > 0) {
        try {
          const { upsertInvoiceNameMappings } = await import('@/lib/server/repositories/invoice')
          await upsertInvoiceNameMappings(supabase as any, aliasUpserts)
        } catch (aliasError: any) {
          // Non-fatal: receipt is already posted.
          await writeSystemErrorLogSafe({
            scope: 'server',
            area: 'api/admin/store/receipts.alias_upsert',
            message: aliasError?.message || 'alias upsert failed',
          })
        }
      }
    }

    // Always update sale/default purchase prices globally from receipt lines
    if (Array.isArray(body.payload.items)) {
      const updatesRaw = body.payload.items
        .map((item) => ({
          item_id: String(item.item_id || '').trim(),
          unit_cost: normalizeUnitCost(item.unit_cost),
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
        receipt_id: receiptId,
        invoice_number: invoiceNumber || null,
        received_at: body.payload.received_at,
        supplier_id: supplierId,
        supplier_name: supplierRow?.name || supplierCreate?.name || null,
        supplier_organization_name: supplierRow?.organization_name || supplierCreate?.organization_name || null,
        supplier_bin_iin: supplierRow?.bin_iin || supplierCreate?.bin_iin || null,
        location_id: locationId,
        location_name: locationRow?.name || null,
        location_type: locationRow?.location_type || null,
        company_id: companyId,
        company_name: (locationRow?.company as any)?.name || (locationRow?.company as any)?.code || null,
        item_count: Array.isArray(body.payload.items) ? body.payload.items.length : 0,
        items_preview: Array.isArray(body.payload.items)
          ? body.payload.items.slice(0, 8).map((item) => ({
              invoice_name: item.invoice_name || null,
              item_id: item.item_id,
              quantity: normalizeQty(item.quantity),
              unit_cost: normalizeUnitCost(item.unit_cost),
              sale_price: item.sale_price != null ? normalizeMoney(item.sale_price) : null,
            }))
          : [],
        payment_mode: paymentMode,
        payment_method: paymentMethod,
        supplier_debt_status: paymentMode === 'now' ? 'paid' : 'open',
        due_date: dueDate,
        is_consignment: isConsignment,
        auto_expense_id: createdExpenseId,
        auto_expense: true,
        auto_expense_category_id: expenseCategoryId,
        auto_expense_category_name: expenseCategory.name || null,
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
    return json({ error: humanizeDbError(error, 'Не удалось провести приемку') }, 500)
  }
}
