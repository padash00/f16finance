import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function canViewWarehouse(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function normalizeQty(v: unknown) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

async function ensureCompanyLocation(
  supabase: any,
  companyId: string,
  locationType: 'warehouse' | 'point_display',
) {
  const { data: existing, error: fetchErr } = await supabase
    .from('inventory_locations')
    .select('id, name, code, location_type, is_active')
    .eq('company_id', companyId)
    .eq('location_type', locationType)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (existing?.id) return existing

  const { data: company, error: compErr } = await supabase
    .from('companies')
    .select('id, name, code, organization_id')
    .eq('id', companyId)
    .maybeSingle()
  if (compErr) throw compErr
  if (!company?.id) throw new Error('company-not-found')

  const prefix = locationType === 'warehouse' ? 'WH' : locationType === 'point_display' ? 'PD' : 'CT'
  const namePrefix = locationType === 'warehouse' ? 'Склад' : locationType === 'point_display' ? 'Витрина' : 'Каталог'
  const { data: created, error: insErr } = await supabase
    .from('inventory_locations')
    .insert({
      company_id: companyId,
      organization_id: company.organization_id,
      name: `${namePrefix} — ${company.name}`,
      code: company.code ? `${prefix}-${company.code}` : null,
      location_type: locationType,
      is_active: true,
    })
    .select('id, name, code, location_type, is_active')
    .single()

  if (insErr) throw insErr
  return created
}

// ─── GET: warehouse + showcase balances for a company ───────────────────────

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canViewWarehouse(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Только точки с включённым магазином (активная локация point_display)
    const { data: enabledLocs, error: enabledErr } = await supabase
      .from('inventory_locations')
      .select('company_id')
      .eq('location_type', 'point_display')
      .eq('is_active', true)
      .not('company_id', 'is', null)
    if (enabledErr) throw enabledErr
    const storeEnabledCompanyIds = [...new Set((enabledLocs || []).map((r: any) => String(r.company_id)))]

    if (storeEnabledCompanyIds.length === 0) {
      return json({
        ok: true,
        data: {
          catalog: null,
          warehouse: null,
          showcase: null,
          companies: [],
          balances: [],
          categories: [],
          selectedCompanyId: null,
        },
      })
    }

    const companiesQuery = supabase
      .from('companies')
      .select('id, name, code')
      .eq('show_in_structure', true)
      .in('id', storeEnabledCompanyIds)
      .order('name')
    if (companyScope.allowedCompanyIds) companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies, error: companiesErr } = await companiesQuery
    if (companiesErr) throw companiesErr

    let companyId = url.searchParams.get('company_id') || null
    if (!companyId) {
      companyId = (companies || [])[0]?.id || null
    }
    if (!companyId) {
      return json({
        ok: true,
        data: {
          catalog: null,
          warehouse: null,
          showcase: null,
          companies: companies || [],
          balances: [],
          categories: [],
          selectedCompanyId: null,
        },
      })
    }

    if (!storeEnabledCompanyIds.includes(companyId)) {
      return json({ error: 'store-not-enabled-for-company' }, 400)
    }

    if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
      if (!companyScope.allowedCompanyIds.includes(companyId)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    const [warehouse, showcase] = await Promise.all([
      ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ensureCompanyLocation(supabase, companyId, 'point_display'),
    ])

    const { data: balanceRows, error: balErr } = await supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, quantity_reserved, updated_at, item:item_id(id, name, barcode, unit, sale_price, default_purchase_price, category_id, category:category_id(id, name))')
      .in('location_id', [warehouse.id, showcase.id])
    if (balErr) throw balErr

    // v8: только склад и витрина. Каталог вычисляется как сумма (warehouse + showcase).
    const byItem = new Map<string, any>()
    for (const row of balanceRows || []) {
      const itemId = row.item_id
      if (!itemId) continue
      let bucket = byItem.get(itemId)
      if (!bucket) {
        bucket = {
          item_id: itemId,
          item: row.item,
          showcase_quantity: 0,
          warehouse_quantity: 0,
          warehouse_reserved: 0,
          updated_at: row.updated_at,
        }
        byItem.set(itemId, bucket)
      }
      if (row.location_id === warehouse.id) {
        bucket.warehouse_quantity = Number(row.quantity) || 0
        bucket.warehouse_reserved = Number((row as any).quantity_reserved) || 0
      } else if (row.location_id === showcase.id) {
        bucket.showcase_quantity = Number(row.quantity) || 0
      }
      if (row.updated_at > bucket.updated_at) bucket.updated_at = row.updated_at
    }

    const balances = Array.from(byItem.values())
      .map((b) => {
        const wh = Number(b.warehouse_quantity || 0)
        const sh = Number(b.showcase_quantity || 0)
        return {
          ...b,
          showcase_quantity: sh,
          warehouse_available: Math.max(0, wh - Number(b.warehouse_reserved || 0)),
          catalog_quantity: wh + sh,
          quantity: wh + sh,
        }
      })
      // Страница склада показывает только товары, которые есть на складе
      .filter((b) => Number(b.warehouse_quantity || 0) > 0 || Number(b.warehouse_reserved || 0) > 0)
      .sort((a, b) => Number(b.warehouse_quantity || 0) - Number(a.warehouse_quantity || 0))

    const { data: categories } = await supabase
      .from('inventory_categories')
      .select('id, name')
      .order('name')

    return json({
      ok: true,
      data: {
        catalog: null,
        warehouse,
        showcase,
        companies: companies || [],
        balances,
        categories: categories || [],
        selectedCompanyId: companyId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.GET', message: error?.message })
    return json({ error: humanizeDbError(error, 'Ошибка загрузки склада') }, 500)
  }
}

// ─── POST: add stock / lookup barcode / create item / set warehouse ─────────

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action-required' }, 400)

    if (body.action === 'lookupBarcode') {
      const barcode = String(body.barcode || '').trim()
      if (!barcode) return json({ error: 'barcode-required' }, 400)

      const { data: item } = await supabase
        .from('inventory_items')
        .select('id, name, barcode, unit, sale_price, default_purchase_price, category_id, category:category_id(id, name)')
        .eq('barcode', barcode)
        .eq('is_active', true)
        .maybeSingle()

      return json({ ok: true, data: { item: item || null } })
    }

    if (body.action === 'createItem') {
      const denied = await requireCapability(access, 'store-warehouse.create_item')
      if (denied) return denied as any
      const name = String(body.name || '').trim()
      const barcode = String(body.barcode || '').trim()
      if (!name) return json({ error: 'name-required' }, 400)
      if (!barcode) return json({ error: 'barcode-required' }, 400)

      const orgId = access.activeOrganization?.id || null

      const { data: item, error: insErr } = await supabase
        .from('inventory_items')
        .insert({
          name,
          barcode,
          unit: String(body.unit || 'шт'),
          sale_price: normalizeQty(body.sale_price),
          default_purchase_price: normalizeQty(body.purchase_price),
          organization_id: orgId,
          is_active: true,
        })
        .select('id, name, barcode, unit, sale_price, default_purchase_price')
        .single()

      if (insErr) {
        if (insErr.code === '23505') return json({ error: 'barcode-already-exists' }, 409)
        throw insErr
      }

      return json({ ok: true, data: { item } })
    }

    // ── addStock: add/set stock in physical warehouse ─────────────────────────
    if (body.action === 'addStock') {
      const denied = await requireCapability(access, 'store-warehouse.edit')
      if (denied) return denied as any
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      type RawItem = { item_id?: string; barcode?: string; name?: string; unit?: string; quantity: number; unit_cost: number }
      const rawItems: RawItem[] = (body.items || [])
        .map((i: any) => ({
          item_id: String(i.item_id || '').trim() || undefined,
          barcode: String(i.barcode || '').trim() || undefined,
          name: String(i.name || '').trim() || undefined,
          unit: String(i.unit || 'шт').trim() || 'шт',
          quantity: normalizeQty(i.quantity),
          unit_cost: normalizeQty(i.unit_cost),
        }))
        .filter((i: RawItem) => i.quantity > 0 && (i.item_id || i.barcode || i.name))

      if (rawItems.length === 0) return json({ error: 'items-required' }, 400)

      const needLookup = rawItems.filter((i) => !i.item_id && i.barcode)
      const barcodes = [...new Set(needLookup.map((i) => i.barcode!))]

      let itemByBarcode: Record<string, string> = {}
      if (barcodes.length > 0) {
        const { data: found } = await supabase
          .from('inventory_items')
          .select('id, barcode')
          .in('barcode', barcodes)
          .eq('is_active', true)
        ;(found || []).forEach((row: any) => { itemByBarcode[row.barcode] = row.id })
      }

      const orgId = access.activeOrganization?.id || null
      const toCreate = needLookup.filter((i) => i.barcode && !itemByBarcode[i.barcode!] && i.name)

      if (toCreate.length > 0) {
        const inserts = toCreate.map((i) => ({
          name: i.name!,
          barcode: i.barcode!,
          unit: i.unit || 'шт',
          sale_price: 0,
          default_purchase_price: i.unit_cost || 0,
          organization_id: orgId,
          is_active: true,
        }))
        const { data: created } = await supabase
          .from('inventory_items')
          .upsert(inserts, { onConflict: 'barcode', ignoreDuplicates: false })
          .select('id, barcode')
        ;(created || []).forEach((row: any) => { itemByBarcode[row.barcode] = row.id })
      }

      const resolvedItems: Array<{ item_id: string; quantity: number; unit_cost: number }> = []
      for (const raw of rawItems) {
        const itemId = raw.item_id || (raw.barcode ? itemByBarcode[raw.barcode] : undefined)
        if (!itemId) continue
        resolvedItems.push({ item_id: itemId, quantity: raw.quantity, unit_cost: raw.unit_cost })
      }

      if (resolvedItems.length === 0) return json({ error: 'no-items-resolved' }, 400)

      const warehouse = await ensureCompanyLocation(supabase, companyId, 'warehouse')
      const actorUserId = access.staffMember?.id || null
      const mode = String(body.mode || 'add') === 'set' ? 'set' : 'add'
      const now = new Date().toISOString()

      if (mode === 'set') {
        // v8: склад и витрина независимы. Валидация warehouse vs catalog больше не имеет смысла.

        // SET mode: upsert warehouse to exact quantities
        const upserts = resolvedItems.map((item) => ({
          location_id: warehouse.id,
          item_id: item.item_id,
          quantity: item.quantity,
          updated_at: now,
        }))

        const { error: upsertErr } = await supabase
          .from('inventory_balances')
          .upsert(upserts, { onConflict: 'location_id,item_id' })
        if (upsertErr) throw upsertErr

        const movements = resolvedItems
          .filter((item) => item.quantity > 0)
          .map((item) => ({
            item_id: item.item_id,
            movement_type: 'set_stock',
            quantity: item.quantity,
            unit_cost: item.unit_cost,
            to_location_id: warehouse.id,
            reference_type: 'warehouse_set',
            reference_id: null,
            comment: String(body.comment || '').trim() || 'Синхронизация подсобки',
            actor_user_id: actorUserId,
            created_at: now,
          }))
        if (movements.length) {
          const { error: mErr } = await supabase.from('inventory_movements').insert(movements)
          if (mErr) await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.set:movements', message: mErr.message })
        }

        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'inventory-warehouse-stock',
          entityId: warehouse.id,
          action: 'set_stock',
          payload: { company_id: companyId, items_count: resolvedItems.length },
        })

        return json({ ok: true, data: { mode: 'set', resolved: resolvedItems.length, skipped: rawItems.length - resolvedItems.length } })
      }

      // ADD mode: receipt-style add to warehouse
      const result = await postInventoryReceipt(supabase, {
        location_id: warehouse.id,
        received_at: now,
        supplier_id: null,
        comment: String(body.comment || '').trim() || 'Добавлено в подсобку',
        created_by: actorUserId,
        items: resolvedItems,
      })

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-stock',
        entityId: warehouse.id,
        action: 'add_stock',
        payload: { company_id: companyId, items_count: resolvedItems.length },
      })

      return json({ ok: true, data: { receipt: result, resolved: resolvedItems.length, skipped: rawItems.length - resolvedItems.length } })
    }

    // ── setWarehouse: set physical warehouse allocation for items ──────────────
    if (body.action === 'setWarehouse') {
      const denied = await requireCapability(access, 'store-warehouse.edit')
      if (denied) return denied as any
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)
      const qty = normalizeQty(body.quantity)
      if (qty < 0) return json({ error: 'quantity-invalid' }, 400)

      const warehouse = await ensureCompanyLocation(supabase, companyId, 'warehouse')

      const actorUserId = access.staffMember?.id || null
      const now = new Date().toISOString()

      // v8: склад и витрина независимы. Валидация warehouse vs catalog больше не нужна.

      const { error: upsertErr } = await supabase
        .from('inventory_balances')
        .upsert({ location_id: warehouse.id, item_id: itemId, quantity: qty, updated_at: now }, { onConflict: 'location_id,item_id' })
      if (upsertErr) throw upsertErr

      if (qty > 0) {
        const { error: mErr } = await supabase.from('inventory_movements').insert({
          item_id: itemId,
          movement_type: 'inventory_adjustment',
          quantity: qty,
          to_location_id: warehouse.id,
          reference_type: 'warehouse_set',
          reference_id: null,
          comment: String(body.comment || '').trim() || 'Установка остатка подсобки',
          actor_user_id: actorUserId,
          created_at: now,
        })
        if (mErr) await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.setWarehouse:movement', message: mErr.message })
      }

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-alloc',
        entityId: warehouse.id,
        action: 'set_warehouse',
        payload: { company_id: companyId, item_id: itemId, quantity: qty },
      })

      return json({ ok: true })
    }

    // ── previewBackroomUpload: match Excel barcodes and warehouse diff ─────────
    // Input: { action, company_id, items: [{barcode, quantity, name?}] }
    // Output: { matched: [...], unmatched: [...] } — ничего не меняет в БД.
    if (body.action === 'previewBackroomUpload') {
      const denied = await requireCapability(access, 'store-warehouse.upload_backroom')
      if (denied) return denied as any
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      type InRow = { barcode: string; quantity: number; name?: string }
      const rawItems: InRow[] = (body.items || [])
        .map((i: any) => ({
          barcode: String(i.barcode || '').trim(),
          quantity: normalizeQty(i.quantity),
          name: String(i.name || '').trim() || undefined,
        }))
        .filter((i: InRow) => i.barcode && i.quantity > 0)

      if (rawItems.length === 0) return json({ error: 'items-required' }, 400)

      // Get company org for filtering items
      const { data: company } = await supabase
        .from('companies')
        .select('organization_id')
        .eq('id', companyId)
        .maybeSingle()
      const orgId = company?.organization_id || access.activeOrganization?.id || null

      const barcodes = [...new Set(rawItems.map((i) => i.barcode))]
      let itemsQuery = supabase
        .from('inventory_items')
        .select('id, name, barcode, unit')
        .eq('is_active', true)
        .in('barcode', barcodes)
      if (orgId) itemsQuery = itemsQuery.eq('organization_id', orgId)
      const { data: foundItems, error: itemsErr } = await itemsQuery
      if (itemsErr) throw itemsErr

      const byBarcode = new Map<string, { id: string; name: string; barcode: string; unit: string }>()
      for (const it of foundItems || []) {
        byBarcode.set(String(it.barcode), {
          id: String(it.id),
          name: String(it.name),
          barcode: String(it.barcode),
          unit: String(it.unit || 'шт'),
        })
      }

      const [warehouse, showcase] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
        ensureCompanyLocation(supabase, companyId, 'point_display'),
      ])

      const matchedItemIds = [...byBarcode.values()].map((v) => v.id)
      const curWarehouse = new Map<string, number>()
      const curShowcase = new Map<string, number>()
      if (matchedItemIds.length) {
        const { data: bal } = await supabase
          .from('inventory_balances')
          .select('location_id, item_id, quantity')
          .in('location_id', [warehouse.id, showcase.id])
          .in('item_id', matchedItemIds)
        for (const row of bal || []) {
          const q = Number((row as any).quantity || 0)
          const iid = String((row as any).item_id)
          if ((row as any).location_id === warehouse.id) curWarehouse.set(iid, q)
          else if ((row as any).location_id === showcase.id) curShowcase.set(iid, q)
        }
      }

      const matched: any[] = []
      const unmatched: any[] = []
      for (const r of rawItems) {
        const item = byBarcode.get(r.barcode)
        if (!item) {
          unmatched.push({ barcode: r.barcode, name: r.name || '', quantity: r.quantity })
          continue
        }
        const curW = curWarehouse.get(item.id) || 0
        const curS = curShowcase.get(item.id) || 0
        const newW = r.quantity
        matched.push({
          item_id: item.id,
          barcode: item.barcode,
          catalog_name: item.name,
          excel_name: r.name || null,
          unit: item.unit,
          current_total: curW + curS,
          current_warehouse: curW,
          current_showcase: curS,
          new_warehouse: newW,
          new_total: newW + curS,
        })
      }

      return json({
        ok: true,
        data: {
          matched,
          unmatched,
          totals: {
            matched_count: matched.length,
            unmatched_count: unmatched.length,
          },
        },
      })
    }

    // ── applyBackroomUpload: set warehouse from parsed file ────────────────────
    if (body.action === 'applyBackroomUpload') {
      const denied = await requireCapability(access, 'store-warehouse.apply_backroom')
      if (denied) return denied as any
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      type InRow = { item_id: string; new_warehouse: number }
      const rows: InRow[] = (body.items || [])
        .map((i: any) => ({
          item_id: String(i.item_id || '').trim(),
          new_warehouse: normalizeQty(i.new_warehouse),
        }))
        .filter((i: InRow) => i.item_id && i.new_warehouse >= 0)

      // v8: склад и витрина независимы. Никакой валидации vs catalog.

      if (rows.length === 0) return json({ error: 'items-required' }, 400)

      const warehouse = await ensureCompanyLocation(supabase, companyId, 'warehouse')
      const actorUserId = access.staffMember?.id || null
      const now = new Date().toISOString()

      // Upsert warehouse balances
      const warehouseUpserts = rows.map((r) => ({
        location_id: warehouse.id,
        item_id: r.item_id,
        quantity: r.new_warehouse,
        updated_at: now,
      }))
      const { error: whErr } = await supabase
        .from('inventory_balances')
        .upsert(warehouseUpserts, { onConflict: 'location_id,item_id' })
      if (whErr) throw whErr

      // Audit movements
      const movements = rows
        .filter((r) => r.new_warehouse > 0)
        .map((r) => ({
          item_id: r.item_id,
          movement_type: 'inventory_adjustment',
          quantity: r.new_warehouse,
          to_location_id: warehouse.id,
          reference_type: 'backroom_bulk',
          reference_id: null,
          comment: 'Загрузка подсобки из Excel',
          actor_user_id: actorUserId,
          created_at: now,
        }))
      if (movements.length) {
        const { error: mErr } = await supabase.from('inventory_movements').insert(movements)
        if (mErr) await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.backroom:movements', message: mErr.message })
      }

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-alloc',
        entityId: warehouse.id,
        action: 'backroom_bulk_upload',
        payload: { company_id: companyId, rows: rows.length },
      })

      return json({ ok: true, data: { updated: rows.length } })
    }

    // ── deleteStock: remove item from warehouse + showcase ────────────────────
    if (body.action === 'deleteStock') {
      const denied = await requireCapability(access, 'store-warehouse.edit')
      if (denied) return denied as any
      const companyId = String(body.company_id || '').trim()
      if (!companyId) return json({ error: 'company-id-required' }, 400)

      if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
        if (!companyScope.allowedCompanyIds.includes(companyId)) return json({ error: 'forbidden' }, 403)
      }

      const itemIds: string[] = (body.item_ids || [])
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)

      const deleteAll = body.delete_all === true

      if (!deleteAll && itemIds.length === 0) return json({ error: 'item-ids-required' }, 400)

      const [warehouse, showcase] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
        ensureCompanyLocation(supabase, companyId, 'point_display'),
      ])
      const actorUserId = access.staffMember?.id || null

      let deleteQuery = supabase.from('inventory_balances').delete().in('location_id', [warehouse.id, showcase.id])
      if (!deleteAll) deleteQuery = deleteQuery.in('item_id', itemIds)
      const { error: delErr } = await deleteQuery
      if (delErr) throw delErr

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-stock',
        entityId: warehouse.id,
        action: 'delete_stock',
        payload: { company_id: companyId, delete_all: deleteAll, item_ids: deleteAll ? [] : itemIds },
      })

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.POST', message: error?.message })
    return json({ error: humanizeDbError(error, 'Ошибка') }, 500)
  }
}
