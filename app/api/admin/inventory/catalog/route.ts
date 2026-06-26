import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveEffectiveOrganizationId } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { bulkSyncInventoryItemsToPointProducts, syncInventoryItemToPointProducts } from '@/lib/server/repositories/inventory'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/** Импорт больших каталогов может занимать десятки секунд — поднимаем лимит на Vercel. */
export const maxDuration = 300

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/** Остаток из импорта всегда на company catalog_total: код CT-* → имя с «катал» → первый по алфавиту (ru). */
function pickCentralCatalogId(
  rows: Array<{ id: string; name?: string | null; code?: string | null }> | null | undefined,
): string | undefined {
  const list = rows || []
  if (!list.length) return undefined
  const byCode = list.find((r) => String(r.code || '').toLowerCase().startsWith('ct-'))
  if (byCode?.id) return String(byCode.id)
  const byName = list.find((r) => /катал/i.test(String(r.name || '')))
  if (byName?.id) return String(byName.id)
  const sorted = [...list].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' }),
  )
  return sorted[0]?.id ? String(sorted[0].id) : undefined
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageCatalog(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

type ImportRow = {
  name: string
  barcode: string
  unit: string
  sale_price: number
  purchase_price: number
  category: string | null
  item_type: 'product' | 'service' | 'consumable'
  article: string | null
  /** Если задано — после импорта выставляется остаток на центральном складе */
  stock_qty?: number
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageCatalog(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция: каталог только своей орг (inventory_items.organization_id).
    // NEVER-pattern: не-супер-админ без орг → пустой uuid → ничего.
    const orgId = access.activeOrganization?.id || null
    const scopeOrg = access.isSuperAdmin ? null : (orgId || '00000000-0000-0000-0000-000000000000')

    // Fetch all inventory items with their category. image_url читаем МЯГКО —
    // колонки может не быть, если миграция карточки не применена.
    const ITEM_COLS = 'id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, item_type, low_stock_threshold, requires_expiry, category:inventory_categories(id, name)'
    let items: any[] | null = null
    try {
      let q = supabase.from('inventory_items').select(`${ITEM_COLS}, image_url`).order('name', { ascending: true })
      if (scopeOrg) q = q.eq('organization_id', scopeOrg)
      const r = await q
      if (r.error) throw r.error
      items = r.data as any[]
    } catch {
      let q = supabase.from('inventory_items').select(ITEM_COLS).order('name', { ascending: true })
      if (scopeOrg) q = q.eq('organization_id', scopeOrg)
      const r = await q
      if (r.error) throw r.error
      items = (r.data || []).map((i: any) => ({ ...i, image_url: null }))
    }

    // v8: total = warehouse + showcase. catalog_total больше не используется.
    const itemIds = (items || []).map((i: any) => String(i.id))
    let balancesQuery = supabase
      .from('inventory_balances')
      .select('item_id, quantity, loc:inventory_locations(location_type)')
    // Балансы только по товарам своей орг (inventory_balances не имеет org-колонки).
    if (scopeOrg) balancesQuery = balancesQuery.in('item_id', itemIds.length ? itemIds : ['00000000-0000-0000-0000-000000000000'])
    const { data: balances, error: balancesError } = await balancesQuery

    if (balancesError) throw balancesError

    const warehouseMap: Record<string, number> = {}
    const showcaseMap: Record<string, number> = {}
    for (const b of balances || []) {
      const locType = (Array.isArray(b.loc) ? b.loc[0] : b.loc)?.location_type
      const qty = b.quantity || 0
      if (locType === 'warehouse') {
        warehouseMap[b.item_id] = (warehouseMap[b.item_id] || 0) + qty
      } else if (locType === 'point_display') {
        showcaseMap[b.item_id] = (showcaseMap[b.item_id] || 0) + qty
      }
    }

    // Normalize items (category may come back as array from supabase joins)
    const normalized = (items || []).map((item: any) => {
      const wh = warehouseMap[item.id] || 0
      const sh = showcaseMap[item.id] || 0
      const cat = wh + sh
      return {
        ...item,
        category: Array.isArray(item.category) ? item.category[0] || null : item.category || null,
        catalog_qty: cat,
        warehouse_qty: wh,
        showcase_qty: sh,
        total_balance: cat,
      }
    })

    return json({ ok: true, data: normalized })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/catalog.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageCatalog(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    // -----------------------------------------------------------------------
    // previewImport
    // -----------------------------------------------------------------------
    if (body.action === 'previewImport') {
      const denied = await requireCapability(access, 'store-catalog.import')
      if (denied) return denied as any
      const rows: ImportRow[] = body.rows || []
      if (!Array.isArray(rows)) return json({ error: 'rows-required' }, 400)

      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) {
        return json(
          {
            error:
              'Укажите организацию в шапке или оставьте в системе одну организацию (режим без SaaS-переключателя).',
          },
          400,
        )
      }

      // Fetch existing items by barcode (чанки — лимит длины IN в PostgREST)
      const barcodes = rows.map((r) => r.barcode).filter(Boolean)
      const existingMap: Record<string, { id: string; name: string; barcode: string; sale_price: number; default_purchase_price: number }> = {}
      for (const bcChunk of chunkArray(barcodes, 200)) {
        if (!bcChunk.length) continue
        const { data: part, error: existingError } = await supabase
          .from('inventory_items')
          .select('id, name, barcode, sale_price, default_purchase_price')
          .eq('organization_id', orgId)
          .in('barcode', bcChunk)

        if (existingError) throw existingError
        for (const item of part || []) {
          existingMap[item.barcode] = item
        }
      }

      // Fetch existing categories этой организации
      const { data: existingCategories, error: catError } = await supabase
        .from('inventory_categories')
        .select('id, name')
        .eq('organization_id', orgId)

      if (catError) throw catError

      const existingCatNames = new Set((existingCategories || []).map((c: { id: string; name: string }) => c.name.toLowerCase()))

      const new_items: ImportRow[] = []
      const updated_items: Array<ImportRow & { existing_name: string; price_changed: boolean; name_changed: boolean }> = []
      let unchanged_count = 0
      const newCatSet = new Set<string>()
      let stock_rows = 0

      for (const row of rows) {
        if (typeof row.stock_qty === 'number' && Number.isFinite(row.stock_qty)) {
          stock_rows++
        }
        if (row.category && !existingCatNames.has(row.category.toLowerCase())) {
          newCatSet.add(row.category)
        }

        const existing = existingMap[row.barcode]
        if (!existing) {
          new_items.push(row)
        } else {
          const price_changed =
            Math.abs((existing.sale_price || 0) - (row.sale_price || 0)) > 0.001 ||
            Math.abs((existing.default_purchase_price || 0) - (row.purchase_price || 0)) > 0.001
          const name_changed = existing.name !== row.name

          if (price_changed || name_changed) {
            updated_items.push({
              ...row,
              existing_name: existing.name,
              price_changed,
              name_changed,
            })
          } else {
            unchanged_count++
          }
        }
      }

      // ─── Stock diff: считаем как изменится остаток в каталоге для уже существующих товаров ───
      type StockDiff = {
        barcode: string
        name: string
        current_catalog: number
        current_warehouse: number
        current_showcase: number
        new_catalog: number
        new_showcase: number
        delta_catalog: number
        warehouse_exceeds_new_catalog: boolean
      }
      const stock_changes: StockDiff[] = []
      const stock_warnings: StockDiff[] = []
      let stock_total_delta_negative = 0
      let stock_total_delta_positive = 0

      const rowsWithStockBC = rows.filter(
        (r) => typeof r.stock_qty === 'number' && Number.isFinite(r.stock_qty) && r.stock_qty >= 0,
      )
      if (rowsWithStockBC.length > 0) {
        const requestedCompanyId = String(body.company_id || '').trim() || null

        // v8: импорт остатков идёт на point_display
        const { data: pdList } = await supabase
          .from('inventory_locations')
          .select('id, company_id')
          .eq('location_type', 'point_display')
          .eq('is_active', true)
          .eq('organization_id', orgId)
          .not('company_id', 'is', null)

        // warehouse-локации тех же компаний (для отображения current_warehouse в превью)
        const { data: whList } = await supabase
          .from('inventory_locations')
          .select('id, company_id')
          .eq('location_type', 'warehouse')
          .eq('is_active', true)
          .eq('organization_id', orgId)

        let catalogId: string | undefined  // имя оставлено для совместимости — теперь это point_display
        let warehouseId: string | undefined
        if (requestedCompanyId) {
          const c = (pdList || []).find((r: any) => String(r.company_id) === requestedCompanyId)
          if (c?.id) catalogId = String(c.id)
          const w = (whList || []).find((r: any) => String(r.company_id) === requestedCompanyId)
          if (w?.id) warehouseId = String(w.id)
        } else if ((pdList || []).length === 1) {
          catalogId = String(pdList![0].id)
          const cmp = String(pdList![0].company_id)
          const w = (whList || []).find((r: any) => String(r.company_id) === cmp)
          if (w?.id) warehouseId = String(w.id)
        }

        if (catalogId) {
          // существующие товары организации, для которых есть строки с stock_qty
          const knownItems: Array<{ id: string; barcode: string; name: string }> = []
          for (const row of rowsWithStockBC) {
            const ex = existingMap[row.barcode]
            if (ex) knownItems.push({ id: ex.id, barcode: ex.barcode, name: ex.name })
          }
          if (knownItems.length > 0) {
            const itemIds = knownItems.map((i) => i.id)
            const locIds = warehouseId ? [catalogId, warehouseId] : [catalogId]
            const balByItemLoc = new Map<string, number>()
            for (const slice of chunkArray(itemIds, 200)) {
              const { data: bal } = await supabase
                .from('inventory_balances')
                .select('location_id, item_id, quantity')
                .in('location_id', locIds)
                .in('item_id', slice)
              for (const b of bal || []) {
                balByItemLoc.set(`${(b as any).location_id}:${(b as any).item_id}`, Number((b as any).quantity || 0))
              }
            }

            const rowByBarcode = new Map<string, ImportRow>()
            for (const row of rowsWithStockBC) rowByBarcode.set(row.barcode, row)

            for (const it of knownItems) {
              const row = rowByBarcode.get(it.barcode)
              if (!row) continue
              const newCat = Math.round(((row.stock_qty as number) + Number.EPSILON) * 1000) / 1000
              const curCat = balByItemLoc.get(`${catalogId}:${it.id}`) || 0
              const curWh = warehouseId ? (balByItemLoc.get(`${warehouseId}:${it.id}`) || 0) : 0
              const curShowcase = Math.max(0, curCat - curWh)
              const newShowcase = Math.max(0, newCat - curWh)
              const delta = newCat - curCat
              const warn = warehouseId !== undefined && newCat < curWh
              const diff: StockDiff = {
                barcode: it.barcode,
                name: it.name,
                current_catalog: curCat,
                current_warehouse: curWh,
                current_showcase: curShowcase,
                new_catalog: newCat,
                new_showcase: newShowcase,
                delta_catalog: delta,
                warehouse_exceeds_new_catalog: warn,
              }
              if (Math.abs(delta) > 0.0005 || warn) stock_changes.push(diff)
              if (warn) stock_warnings.push(diff)
              if (delta < 0) stock_total_delta_negative += Math.abs(delta)
              else if (delta > 0) stock_total_delta_positive += delta
            }
          }
        }
      }

      return json({
        ok: true,
        data: {
          new_items,
          updated_items,
          unchanged_count,
          categories_to_create: Array.from(newCatSet),
          stock_rows,
          stock_changes,
          stock_warnings,
          stock_total_delta_positive: Math.round((stock_total_delta_positive + Number.EPSILON) * 1000) / 1000,
          stock_total_delta_negative: Math.round((stock_total_delta_negative + Number.EPSILON) * 1000) / 1000,
        },
      })
    }

    // -----------------------------------------------------------------------
    // confirmImport
    // -----------------------------------------------------------------------
    if (body.action === 'confirmImport') {
      const denied = await requireCapability(access, 'store-catalog.import')
      if (denied) return denied as any
      const rows: ImportRow[] = body.rows || []
      if (!Array.isArray(rows)) return json({ error: 'rows-required' }, 400)

      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) {
        return json(
          {
            error:
              'Укажите организацию в шапке или оставьте в системе одну организацию (режим без SaaS-переключателя).',
          },
          400,
        )
      }

      // Ensure all categories exist (с organization_id)
      const { data: existingCategories, error: catFetchError } = await supabase
        .from('inventory_categories')
        .select('id, name')
        .eq('organization_id', orgId)

      if (catFetchError) throw catFetchError

      const catNameToId: Record<string, string> = {}
      for (const cat of existingCategories || []) {
        catNameToId[cat.name.toLowerCase()] = cat.id
      }

      // Create missing categories
      const missingCats = new Set<string>()
      for (const row of rows) {
        if (row.category && !catNameToId[row.category.toLowerCase()]) {
          missingCats.add(row.category)
        }
      }

      if (missingCats.size > 0) {
        const newCats = Array.from(missingCats).map((name) => ({ name, organization_id: orgId }))
        const { data: insertedCats, error: insertCatError } = await supabase
          .from('inventory_categories')
          .insert(newCats)
          .select('id, name')

        if (insertCatError) throw insertCatError

        for (const cat of insertedCats || []) {
          catNameToId[cat.name.toLowerCase()] = cat.id
        }
      }

      // Fetch existing items by barcode (в организации), чанками
      const barcodes = rows.map((r) => r.barcode).filter(Boolean)
      const existingBarcodeToId: Record<string, string> = {}
      for (const bcChunk of chunkArray(barcodes, 200)) {
        if (!bcChunk.length) continue
        const { data: part, error: existingError } = await supabase
          .from('inventory_items')
          .select('id, barcode')
          .eq('organization_id', orgId)
          .in('barcode', bcChunk)

        if (existingError) throw existingError
        for (const item of part || []) {
          existingBarcodeToId[item.barcode] = item.id
        }
      }

      let created = 0
      let updated = 0

      // Process in batches
      const toInsert: Array<{
        organization_id: string
        name: string
        barcode: string
        unit: string
        sale_price: number
        default_purchase_price: number
        category_id: string | null
        item_type: string
        notes: string | null
        is_active: boolean
      }> = []
      const toUpdate: Array<{
        id: string
        name: string
        barcode: string
        unit: string
        sale_price: number
        default_purchase_price: number
        category_id: string | null
        item_type: string
      }> = []

      for (const row of rows) {
        const categoryId = row.category ? catNameToId[row.category.toLowerCase()] || null : null
        const existingId = existingBarcodeToId[row.barcode]
        // DB allows only 'product' or 'consumable'; map 'service' → 'product'
        const itemType: 'product' | 'consumable' = (row.item_type as string) === 'consumable' ? 'consumable' : 'product'

        if (existingId) {
          toUpdate.push({
            id: existingId,
            name: row.name,
            barcode: row.barcode,
            unit: row.unit,
            sale_price: row.sale_price,
            default_purchase_price: row.purchase_price,
            category_id: categoryId,
            item_type: itemType,
          })
        } else {
          toInsert.push({
            organization_id: orgId,
            name: row.name,
            barcode: row.barcode,
            unit: row.unit,
            sale_price: row.sale_price,
            default_purchase_price: row.purchase_price,
            category_id: categoryId,
            item_type: itemType,
            notes: row.article || null,
            is_active: true,
          })
        }
      }

      if (toInsert.length > 0) {
        for (const slice of chunkArray(toInsert, 400)) {
          const { error: insertError } = await supabase.from('inventory_items').insert(slice)
          if (insertError) throw insertError
          created += slice.length
        }
      }

      const UPDATE_PARALLEL = 32
      for (const slice of chunkArray(toUpdate, UPDATE_PARALLEL)) {
        const results = await Promise.all(
          slice.map((item) => {
            const { id, ...fields } = item
            return supabase.from('inventory_items').update(fields).eq('id', id)
          }),
        )
        for (const r of results) {
          if (r.error) throw r.error
        }
        updated += slice.length
      }

      const syncRows = rows.filter((row) => row.item_type !== 'consumable')
      if (syncRows.length > 0) {
        await bulkSyncInventoryItemsToPointProducts(
          supabase as any,
          syncRows.map((row) => ({
            name: row.name,
            barcode: row.barcode,
            sale_price: row.sale_price,
            is_active: true,
          })),
          { organizationId: orgId, isSuperAdmin: access.isSuperAdmin },
        )
      }

      let stock_updated = 0
      let stock_warnings_count = 0
      const rowsWithStock = rows.filter(
        (row) => typeof row.stock_qty === 'number' && Number.isFinite(row.stock_qty) && row.stock_qty >= 0,
      )
      if (rowsWithStock.length > 0 && orgId) {
        // v8: Excel-импорт остатков идёт на point_display активной компании.
        const { data: pdList, error: pdLocErr } = await supabase
          .from('inventory_locations')
          .select('id, name, code, company_id')
          .eq('location_type', 'point_display')
          .eq('is_active', true)
          .eq('organization_id', orgId)
          .not('company_id', 'is', null)

        if (pdLocErr) throw pdLocErr

        const requestedCompanyId = String(body.company_id || '').trim() || null

        let catalogId: string | undefined  // location_id куда писать остатки (теперь point_display)
        let catalogCompanyId: string | undefined
        if (requestedCompanyId) {
          const picked = (pdList || []).find((c: any) => String(c?.company_id || '') === requestedCompanyId)
          if (!picked?.id) {
            return json({ error: 'showcase-not-enabled-for-company' }, 400)
          }
          catalogId = String(picked.id)
          catalogCompanyId = requestedCompanyId
        } else if ((pdList || []).length === 1) {
          catalogId = String(pdList![0].id)
          catalogCompanyId = String(pdList![0].company_id)
        } else if ((pdList || []).length === 0) {
          return json(
            {
              error:
                'Нет точек с включённой витриной. Включите магазин в нужной точке или уберите колонку «Остаток» из файла.',
            },
            400,
          )
        } else {
          return json(
            {
              error: 'store-ambiguous-company-required',
              companies: (pdList || []).map((c: any) => ({ id: String(c.company_id), name: String(c.name || '') })),
            },
            400,
          )
        }

        const bc = rowsWithStock.map((r) => r.barcode)
        const barcodeToId = new Map<string, string>()
        for (const bcChunk of chunkArray(bc, 200)) {
          if (!bcChunk.length) continue
          const { data: idRows, error: idErr } = await supabase
            .from('inventory_items')
            .select('id, barcode')
            .eq('organization_id', orgId)
            .in('barcode', bcChunk)

          if (idErr) throw idErr
          for (const r of idRows || []) {
            barcodeToId.set((r as { barcode: string }).barcode, (r as { id: string }).id)
          }
        }

        // ─── Текущие балансы (catalog + warehouse) для diff и валидации ───
        const targetItemIds: string[] = []
        const itemsWithStock: Array<{ itemId: string; barcode: string; newQty: number }> = []
        for (const row of rowsWithStock) {
          const itemId = barcodeToId.get(row.barcode)
          if (!itemId) continue
          const newQty = Math.round((row.stock_qty as number + Number.EPSILON) * 1000) / 1000
          itemsWithStock.push({ itemId, barcode: row.barcode, newQty })
          targetItemIds.push(itemId)
        }

        let warehouseLocId: string | null = null
        if (catalogCompanyId) {
          const { data: whLoc } = await supabase
            .from('inventory_locations')
            .select('id')
            .eq('company_id', catalogCompanyId)
            .eq('location_type', 'warehouse')
            .eq('is_active', true)
            .maybeSingle()
          warehouseLocId = whLoc?.id ? String(whLoc.id) : null
        }

        const balByItemLoc = new Map<string, number>()
        if (targetItemIds.length > 0) {
          const locIds = warehouseLocId ? [catalogId, warehouseLocId] : [catalogId]
          for (const slice of chunkArray(targetItemIds, 200)) {
            const { data: bal } = await supabase
              .from('inventory_balances')
              .select('location_id, item_id, quantity')
              .in('location_id', locIds)
              .in('item_id', slice)
            for (const b of bal || []) {
              balByItemLoc.set(`${(b as any).location_id}:${(b as any).item_id}`, Number((b as any).quantity || 0))
            }
          }
        }

        // v8: склад и витрина независимы. Валидация warehouse vs new_showcase больше не нужна.
        stock_warnings_count = 0

        // ─── Upsert балансов каталога ───
        const upserts: Array<{ location_id: string; item_id: string; quantity: number }> = itemsWithStock.map((it) => ({
          location_id: catalogId!,
          item_id: it.itemId,
          quantity: it.newQty,
        }))
        if (upserts.length > 0) {
          for (const slice of chunkArray(upserts, 500)) {
            const { error: balErr } = await supabase.from('inventory_balances').upsert(slice, {
              onConflict: 'location_id,item_id',
            })
            if (balErr) throw balErr
            stock_updated += slice.length
          }
        }

        // ─── Movements: фиксируем дельту каждого изменения ───
        const actorUserId = access.staffMember?.id || null
        const nowIso = new Date().toISOString()
        const movements: any[] = []
        for (const it of itemsWithStock) {
          const prev = balByItemLoc.get(`${catalogId}:${it.itemId}`) || 0
          const delta = Math.round((it.newQty - prev + Number.EPSILON) * 1000) / 1000
          if (Math.abs(delta) < 0.0005) continue
          movements.push({
            item_id: it.itemId,
            movement_type: 'inventory_adjustment',
            quantity: Math.abs(delta),
            from_location_id: delta < 0 ? catalogId : null,
            to_location_id: delta > 0 ? catalogId : null,
            reference_type: 'showcase_excel_import',
            reference_id: null,
            comment: `Импорт Excel остатков на витрину: ${prev} → ${it.newQty}`,
            actor_user_id: actorUserId,
            created_at: nowIso,
          })
        }
        if (movements.length > 0) {
          for (const slice of chunkArray(movements, 500)) {
            const { error: mvErr } = await supabase.from('inventory_movements').insert(slice)
            if (mvErr) throw mvErr
          }
        }

        // ─── Audit ───
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'inventory-catalog',
          entityId: catalogId,
          action: 'excel_import_stock',
          payload: {
            company_id: catalogCompanyId || null,
            rows_with_stock: rowsWithStock.length,
            stock_updated,
            movements_written: movements.length,
            warnings_count: stock_warnings_count,
          },
        })
      }

      return json({ ok: true, data: { created, updated, stock_updated, stock_warnings: stock_warnings_count } })
    }

    // -----------------------------------------------------------------------
    // resetAllBalances — обнулить ВСЕ остатки (inventory_balances) организации,
    // не трогая сами товары. Используется чтобы перезалить Excel без мусора
    // и FK-проблем (inventory_movements/point_sale_items блокируют delete items).
    // -----------------------------------------------------------------------
    if (body.action === 'resetAllBalances') {
      const denied = await requireCapability(access, 'store-catalog.bulk_zero_stock')
      if (denied) return denied as any
      const confirm = String(body.confirm || '').trim()
      if (confirm !== 'ОБНУЛИТЬ ОСТАТКИ') {
        return json({ error: 'Введите фразу подтверждения: ОБНУЛИТЬ ОСТАТКИ' }, 400)
      }

      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) return json({ error: 'Укажите организацию' }, 400)

      const { data: locRows, error: locErr } = await supabase
        .from('inventory_locations')
        .select('id')
        .eq('organization_id', orgId)
        .in('location_type', ['warehouse', 'point_display', 'catalog_total'])

      if (locErr) throw locErr

      const locIds = (locRows || []).map((r: { id: string }) => r.id)
      if (locIds.length === 0) return json({ ok: true, data: { deleted: 0 } })

      let deleted = 0
      for (const slice of chunkArray(locIds, 100)) {
        const { count, error: delErr } = await supabase
          .from('inventory_balances')
          .delete({ count: 'exact' })
          .in('location_id', slice)
        if (delErr) throw delErr
        deleted += Number(count || 0)
      }

      return json({ ok: true, data: { deleted, locations: locIds.length } })
    }

    // -----------------------------------------------------------------------
    // deactivateAllItems — скрыть все позиции каталога (is_active = false)
    // -----------------------------------------------------------------------
    if (body.action === 'deactivateAllItems') {
      const denied = await requireCapability(access, 'store-catalog.bulk_deactivate')
      if (denied) return denied as any
      const confirm = String(body.confirm || '').trim()
      if (confirm !== 'ОТКЛЮЧИТЬ ВСЕ') {
        return json({ error: 'Введите фразу подтверждения: ОТКЛЮЧИТЬ ВСЕ' }, 400)
      }
      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) {
        return json({ error: 'Укажите организацию в шапке или одну организацию в БД' }, 400)
      }

      const { data: updatedRows, error: deactErr } = await supabase
        .from('inventory_items')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('organization_id', orgId)
        .select('id')

      if (deactErr) throw deactErr

      return json({ ok: true, data: { count: (updatedRows || []).length } })
    }

    // -----------------------------------------------------------------------
    // deleteAllItems — удалить ВСЕ товары организации (сначала остатки, потом товары)
    // -----------------------------------------------------------------------
    if (body.action === 'deleteAllItems') {
      const denied = await requireCapability(access, 'store-catalog.bulk_delete_all')
      if (denied) return denied as any
      const confirm = String(body.confirm || '').trim()
      if (confirm !== 'УДАЛИТЬ ВСЁ') {
        return json({ error: 'Введите фразу подтверждения: УДАЛИТЬ ВСЁ' }, 400)
      }
      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) return json({ error: 'Укажите организацию' }, 400)

      // Fetch all item ids for this org
      const { data: orgItems, error: listErr } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('organization_id', orgId)
      if (listErr) throw listErr

      const itemIds = (orgItems || []).map((r: { id: string }) => r.id)
      if (itemIds.length === 0) return json({ ok: true, data: { deleted: 0 } })

      // Delete balances first (in case FK doesn't CASCADE)
      const { error: balErr } = await supabase
        .from('inventory_balances')
        .delete()
        .in('item_id', itemIds)
      if (balErr) throw balErr

      // Пробуем удалить все товары. Если у части есть история движений —
      // FK заблокирует весь delete. В этом случае удаляем только товары
      // без истории, а остальные переводим в архив (is_active=false).
      const { error: delErr } = await supabase
        .from('inventory_items')
        .delete()
        .eq('organization_id', orgId)
      if (delErr) {
        const code = String((delErr as any)?.code || '')
        const isFk = code === '23503' || String(delErr.message || '').toLowerCase().includes('foreign key')
        if (!isFk) throw delErr

        // Находим товары, на которые есть ссылки в inventory_movements.
        const { data: referenced, error: refErr } = await supabase
          .from('inventory_movements')
          .select('item_id')
          .in('item_id', itemIds)
        if (refErr) throw refErr
        const referencedIds = new Set<string>((referenced || []).map((r: any) => String(r.item_id)))
        const deletableIds = itemIds.filter((id) => !referencedIds.has(id))
        const archiveIds = itemIds.filter((id) => referencedIds.has(id))

        if (deletableIds.length > 0) {
          const { error: hardErr } = await supabase
            .from('inventory_items')
            .delete()
            .in('id', deletableIds)
          if (hardErr) throw hardErr
        }
        if (archiveIds.length > 0) {
          const { error: archErr } = await supabase
            .from('inventory_items')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .in('id', archiveIds)
          if (archErr) throw archErr
        }
        return json({
          ok: true,
          data: { deleted: deletableIds.length, archived: archiveIds.length },
          message: archiveIds.length > 0
            ? `Удалено полностью: ${deletableIds.length}. Перенесено в архив (есть история движений): ${archiveIds.length}.`
            : undefined,
        })
      }

      return json({ ok: true, data: { deleted: itemIds.length, archived: 0 } })
    }

    // -----------------------------------------------------------------------
    // deleteEmptyBalanceItems — удалить товары без остатков (как одиночное удаление)
    // -----------------------------------------------------------------------
    if (body.action === 'deleteEmptyBalanceItems') {
      const denied = await requireCapability(access, 'store-catalog.bulk_delete_empty')
      if (denied) return denied as any
      const confirm = String(body.confirm || '').trim()
      if (confirm !== 'УДАЛИТЬ ПУСТЫЕ') {
        return json({ error: 'Введите фразу подтверждения: УДАЛИТЬ ПУСТЫЕ' }, 400)
      }
      const orgId = await resolveEffectiveOrganizationId({
        supabase,
        activeOrganizationId: access.activeOrganization?.id || null,
      })
      if (!orgId) {
        return json({ error: 'Укажите организацию в шапке или одну организацию в БД' }, 400)
      }

      const { data: orgItems, error: listErr } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('organization_id', orgId)

      if (listErr) throw listErr

      let deleted = 0
      const failed: string[] = []

      for (const row of orgItems || []) {
        const itemId = String(row.id)
        const { data: balances, error: balanceError } = await supabase
          .from('inventory_balances')
          .select('quantity')
          .eq('item_id', itemId)

        if (balanceError) {
          failed.push(itemId)
          continue
        }

        const totalBalance = (balances || []).reduce((sum: number, b: { quantity: number }) => sum + (b.quantity || 0), 0)
        if (totalBalance > 0) continue

        const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', itemId)
        if (deleteError) {
          failed.push(itemId)
          continue
        }
        deleted++
      }

      return json({ ok: true, data: { deleted, failed: failed.length } })
    }

    // -----------------------------------------------------------------------
    // deleteItem
    // -----------------------------------------------------------------------
    if (body.action === 'deleteItem') {
      const denied = await requireCapability(access, 'store-catalog.delete')
      if (denied) return denied as any
      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)

      // Изоляция: товар обязан принадлежать орг вызывающего.
      {
        const callerOrgId = access.activeOrganization?.id || null
        const { data: itemRow } = await supabase.from('inventory_items').select('organization_id').eq('id', itemId).maybeSingle()
        if (!itemRow) return json({ error: 'item-not-found' }, 404)
        if (!access.isSuperAdmin && callerOrgId && String((itemRow as any).organization_id) !== String(callerOrgId)) {
          return json({ error: 'forbidden' }, 403)
        }
      }

      // Check if item has non-zero balance
      const { data: balances, error: balanceError } = await supabase
        .from('inventory_balances')
        .select('quantity')
        .eq('item_id', itemId)

      if (balanceError) throw balanceError

      const totalBalance = (balances || []).reduce((sum: number, b: { quantity: number }) => sum + (b.quantity || 0), 0)
      if (totalBalance > 0) {
        return json({ error: 'Нельзя удалить товар с ненулевым остатком' }, 400)
      }

      // Пробуем жёсткое удаление. Если у товара есть история (движения,
      // приёмки, продажи) — FK не даст удалить. В этом случае переводим
      // товар в архив (is_active=false): история сохраняется, товар
      // пропадает из активных списков.
      const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', itemId)
      if (deleteError) {
        const code = String((deleteError as any)?.code || '')
        const isFk = code === '23503' || String(deleteError.message || '').toLowerCase().includes('foreign key')
        if (!isFk) throw deleteError
        const { error: archiveError } = await supabase
          .from('inventory_items')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', itemId)
        if (archiveError) throw archiveError
        return json({
          ok: true,
          data: { archived: true },
          message: 'У товара есть история движений — он перенесён в архив (скрыт из списков), а не удалён полностью. История сохранена.',
        })
      }

      return json({ ok: true, data: { archived: false } })
    }

    // -----------------------------------------------------------------------
    // updateItem
    // -----------------------------------------------------------------------
    if (body.action === 'updateItem') {
      const denied = await requireCapability(access, 'store-catalog.edit')
      if (denied) return denied as any
      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)

      const fields = body.fields || {}
      if (Object.keys(fields).length === 0) return json({ error: 'fields-required' }, 400)

      // Изоляция: редактировать можно только товар своей орг.
      {
        const callerOrgId = access.activeOrganization?.id || null
        const { data: itemRow } = await supabase.from('inventory_items').select('organization_id').eq('id', itemId).maybeSingle()
        if (!itemRow) return json({ error: 'item-not-found' }, 404)
        if (!access.isSuperAdmin && callerOrgId && String((itemRow as any).organization_id) !== String(callerOrgId)) {
          return json({ error: 'forbidden' }, 403)
        }
      }

      const { error: updateError } = await supabase.from('inventory_items').update(fields).eq('id', itemId)
      if (updateError) throw updateError

      if (String(fields.item_type || 'product') !== 'consumable') {
        await syncInventoryItemToPointProducts(supabase as any, {
          name: String(fields.name || '').trim(),
          barcode: String(fields.barcode || '').trim(),
          sale_price: Number(fields.sale_price || 0),
          is_active: true,
        })
      }

      return json({ ok: true })
    }

    return json({ error: 'unsupported-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/catalog.POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
