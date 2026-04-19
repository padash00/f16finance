import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { postInventoryReceipt } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

function canViewWarehouse(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

function normalizeQty(v: unknown) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

async function ensureCompanyLocation(supabase: any, companyId: string, locationType: 'warehouse' | 'catalog') {
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

  const isWarehouse = locationType === 'warehouse'
  const { data: created, error: insErr } = await supabase
    .from('inventory_locations')
    .insert({
      company_id: companyId,
      organization_id: company.organization_id,
      name: isWarehouse ? `Склад — ${company.name}` : `Каталог — ${company.name}`,
      code: company.code ? `${isWarehouse ? 'WH' : 'CAT'}-${company.code}` : null,
      location_type: locationType,
      is_active: true,
    })
    .select('id, name, code, location_type, is_active')
    .single()

  if (insErr) throw insErr
  return created
}

/** @deprecated use ensureCompanyLocation(supabase, companyId, 'warehouse') */
async function ensureCompanyWarehouse(supabase: any, companyId: string) {
  return ensureCompanyLocation(supabase, companyId, 'warehouse')
}

// ─── GET: warehouse balances for a company ───────────────────────────────────

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

    // Only show companies with store enabled (show_in_structure = true)
    const companiesQuery = supabase.from('companies').select('id, name, code').eq('show_in_structure', true).order('name')
    if (companyScope.allowedCompanyIds) companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies, error: companiesErr } = await companiesQuery
    if (companiesErr) throw companiesErr

    // Determine which company to show
    let companyId = url.searchParams.get('company_id') || null
    if (!companyId) {
      companyId = (companies || [])[0]?.id || null
    }
    if (!companyId) return json({ error: 'company-required' }, 400)

    // Access check (when scope is limited)
    if (!access.isSuperAdmin && companyScope.allowedCompanyIds?.length) {
      if (!companyScope.allowedCompanyIds.includes(companyId)) {
        return json({ error: 'forbidden' }, 403)
      }
    }

    // Ensure both warehouse and catalog locations exist
    const [warehouse, catalog] = await Promise.all([
      ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ensureCompanyLocation(supabase, companyId, 'catalog'),
    ])

    // Fetch balances for both locations in one query
    const { data: allBalances, error: balErr } = await supabase
      .from('inventory_balances')
      .select('location_id, item_id, quantity, updated_at, item:item_id(id, name, barcode, unit, sale_price, default_purchase_price, category_id, category:category_id(id, name))')
      .in('location_id', [warehouse.id, catalog.id])
    if (balErr) throw balErr

    // Split into catalog and warehouse maps, then build unified list
    const catalogMap = new Map<string, any>()
    const warehouseMap = new Map<string, any>()
    ;(allBalances || []).forEach((b: any) => {
      if (b.location_id === catalog.id) catalogMap.set(b.item_id, b)
      else if (b.location_id === warehouse.id) warehouseMap.set(b.item_id, b)
    })

    // Union of all items across both locations
    const itemIds = new Set([...catalogMap.keys(), ...warehouseMap.keys()])
    const balances = Array.from(itemIds).map((itemId) => {
      const cat = catalogMap.get(itemId)
      const wh = warehouseMap.get(itemId)
      const item = cat?.item || wh?.item
      const catalogQty = Number(cat?.quantity || 0)
      const warehouseQty = Number(wh?.quantity || 0)
      return {
        item_id: itemId,
        item,
        catalog_quantity: catalogQty,
        warehouse_quantity: warehouseQty,
        showcase_quantity: Math.max(0, catalogQty - warehouseQty),
        quantity: catalogQty, // keep for backwards compat
        updated_at: cat?.updated_at || wh?.updated_at,
      }
    }).sort((a, b) => b.catalog_quantity - a.catalog_quantity)

    // Categories for filter
    const { data: categories } = await supabase
      .from('inventory_categories')
      .select('id, name')
      .order('name')

    return json({
      ok: true,
      data: {
        warehouse,
        catalog,
        companies: companies || [],
        balances: balances || [],
        categories: categories || [],
        selectedCompanyId: companyId,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.GET', message: error?.message })
    return json({ error: error?.message || 'Ошибка загрузки склада' }, 500)
  }
}

// ─── POST: add stock / lookup barcode / create item ──────────────────────────

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

    // ── lookupBarcode ──────────────────────────────────────────────────────────
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

    // ── createItem (new item not in catalog) ───────────────────────────────────
    if (body.action === 'createItem') {
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

    // ── addStock (receipt-style add to warehouse) ──────────────────────────────
    // Accepts items with either { item_id } or { barcode, name, unit } — resolves barcodes server-side in bulk
    if (body.action === 'addStock') {
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

      // ── Batch-resolve barcodes → item_ids ──────────────────────────────────
      const needLookup = rawItems.filter((i) => !i.item_id && i.barcode)
      const barcodes = [...new Set(needLookup.map((i) => i.barcode!))]

      let catalogByBarcode: Record<string, string> = {}
      if (barcodes.length > 0) {
        const { data: found } = await supabase
          .from('inventory_items')
          .select('id, barcode')
          .in('barcode', barcodes)
          .eq('is_active', true)
        ;(found || []).forEach((row: any) => { catalogByBarcode[row.barcode] = row.id })
      }

      // ── Create missing items (batch) ───────────────────────────────────────
      const orgId = access.activeOrganization?.id || null
      const toCreate = needLookup.filter((i) => i.barcode && !catalogByBarcode[i.barcode!] && i.name)

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
        // upsert to handle duplicate barcodes gracefully
        const { data: created } = await supabase
          .from('inventory_items')
          .upsert(inserts, { onConflict: 'barcode', ignoreDuplicates: false })
          .select('id, barcode')
        ;(created || []).forEach((row: any) => { catalogByBarcode[row.barcode] = row.id })
      }

      // ── Build final items list ─────────────────────────────────────────────
      const resolvedItems: Array<{ item_id: string; quantity: number; unit_cost: number }> = []
      for (const raw of rawItems) {
        const itemId = raw.item_id || (raw.barcode ? catalogByBarcode[raw.barcode] : undefined)
        if (!itemId) continue // couldn't resolve — skip
        resolvedItems.push({ item_id: itemId, quantity: raw.quantity, unit_cost: raw.unit_cost })
      }

      if (resolvedItems.length === 0) return json({ error: 'no-items-resolved' }, 400)

      // addStock always writes to CATALOG (total stock), not warehouse
      const catalog = await ensureCompanyLocation(supabase, companyId, 'catalog')
      const actorUserId = access.staffMember?.id || null
      const mode = String(body.mode || 'add') === 'set' ? 'set' : 'add'
      const now = new Date().toISOString()

      if (mode === 'set') {
        // ── SET mode: upsert catalog to exact quantities (Wipon sync) ─────────────
        const upserts = resolvedItems.map((item) => ({
          location_id: catalog.id,
          item_id: item.item_id,
          quantity: item.quantity,
          updated_at: now,
        }))

        const { error: upsertErr } = await supabase
          .from('inventory_balances')
          .upsert(upserts, { onConflict: 'location_id,item_id' })
        if (upsertErr) throw upsertErr

        const movements = resolvedItems.map((item) => ({
          item_id: item.item_id,
          movement_type: 'set_stock',
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          to_location_id: catalog.id,
          reference_type: 'catalog_set',
          reference_id: null,
          comment: String(body.comment || '').trim() || 'Синхронизация каталога',
          created_by: actorUserId,
          created_at: now,
        }))
        await supabase.from('inventory_movements').insert(movements)

        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'inventory-catalog-stock',
          entityId: catalog.id,
          action: 'set_catalog',
          payload: { company_id: companyId, items_count: resolvedItems.length },
        })

        return json({ ok: true, data: { mode: 'set', resolved: resolvedItems.length, skipped: rawItems.length - resolvedItems.length } })
      }

      // ── ADD mode: add to catalog total ────────────────────────────────────────
      const result = await postInventoryReceipt(supabase, {
        location_id: catalog.id,
        received_at: now,
        supplier_id: null,
        comment: String(body.comment || '').trim() || 'Добавлено через каталог',
        created_by: actorUserId,
        items: resolvedItems,
      })

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-catalog-stock',
        entityId: catalog.id,
        action: 'add_catalog',
        payload: { company_id: companyId, items_count: resolvedItems.length },
      })

      return json({ ok: true, data: { receipt: result, resolved: resolvedItems.length, skipped: rawItems.length - resolvedItems.length } })
    }

    // ── deleteStock (remove balance rows for given item_ids) ──────────────────
    if (body.action === 'deleteStock') {
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

      // Delete from both catalog AND warehouse so everything is cleared
      const [catalog, warehouse] = await Promise.all([
        ensureCompanyLocation(supabase, companyId, 'catalog'),
        ensureCompanyLocation(supabase, companyId, 'warehouse'),
      ])
      const actorUserId = access.staffMember?.id || null

      for (const locId of [catalog.id, warehouse.id]) {
        let deleteQuery = supabase.from('inventory_balances').delete().eq('location_id', locId)
        if (!deleteAll) deleteQuery = deleteQuery.in('item_id', itemIds)
        const { error: delErr } = await deleteQuery
        if (delErr) throw delErr
      }

      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'inventory-warehouse-stock',
        entityId: catalog.id,
        action: 'delete_stock',
        payload: { company_id: companyId, delete_all: deleteAll, item_ids: deleteAll ? [] : itemIds },
      })

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/store/warehouse.POST', message: error?.message })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
