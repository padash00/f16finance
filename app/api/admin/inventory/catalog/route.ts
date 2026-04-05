import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
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

/** Остаток из импорта всегда на центральный склад: main-warehouse → имя с «централ» → первый по алфавиту (ru). */
function pickCentralWarehouseId(
  rows: Array<{ id: string; name?: string | null; code?: string | null }> | null | undefined,
): string | undefined {
  const list = rows || []
  if (!list.length) return undefined
  const byCode = list.find((r) => String(r.code || '').toLowerCase() === 'main-warehouse')
  if (byCode?.id) return String(byCode.id)
  const byName = list.find((r) => /централ/i.test(String(r.name || '')))
  if (byName?.id) return String(byName.id)
  const sorted = [...list].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' }),
  )
  return sorted[0]?.id ? String(sorted[0].id) : undefined
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageCatalog(access: { isSuperAdmin: boolean; staffRole: 'manager' | 'marketer' | 'owner' | 'other' }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
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

    // Fetch all inventory items with their category
    const { data: items, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, category_id, sale_price, default_purchase_price, unit, notes, is_active, item_type, category:inventory_categories(id, name)')
      .order('name', { ascending: true })

    if (itemsError) throw itemsError

    // Fetch all balances to compute totals
    const { data: balances, error: balancesError } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')

    if (balancesError) throw balancesError

    // Sum balances per item
    const balanceMap: Record<string, number> = {}
    for (const b of balances || []) {
      balanceMap[b.item_id] = (balanceMap[b.item_id] || 0) + (b.quantity || 0)
    }

    // Normalize items (category may come back as array from supabase joins)
    const normalized = (items || []).map((item: any) => ({
      ...item,
      category: Array.isArray(item.category) ? item.category[0] || null : item.category || null,
      total_balance: balanceMap[item.id] || 0,
    }))

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

      return json({
        ok: true,
        data: {
          new_items,
          updated_items,
          unchanged_count,
          categories_to_create: Array.from(newCatSet),
          stock_rows,
        },
      })
    }

    // -----------------------------------------------------------------------
    // confirmImport
    // -----------------------------------------------------------------------
    if (body.action === 'confirmImport') {
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
      const rowsWithStock = rows.filter(
        (row) => typeof row.stock_qty === 'number' && Number.isFinite(row.stock_qty) && row.stock_qty >= 0,
      )
      if (rowsWithStock.length > 0 && orgId) {
        const { data: whList, error: whErr } = await supabase
          .from('inventory_locations')
          .select('id, name, code')
          .eq('location_type', 'warehouse')
          .eq('is_active', true)
          .eq('organization_id', orgId)

        if (whErr) throw whErr
        const warehouseId = pickCentralWarehouseId(whList)
        if (!warehouseId) {
          return json(
            {
              error:
                'В организации нет активного центрального склада (warehouse) — добавьте склад или включите существующий, чтобы записать остатки из Excel.',
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
        const upserts: Array<{ location_id: string; item_id: string; quantity: number }> = []
        for (const row of rowsWithStock) {
          const itemId = barcodeToId.get(row.barcode)
          if (!itemId) continue
          upserts.push({
            location_id: warehouseId,
            item_id: itemId,
            quantity: Math.round((row.stock_qty as number + Number.EPSILON) * 1000) / 1000,
          })
        }
        if (upserts.length > 0) {
          for (const slice of chunkArray(upserts, 500)) {
            const { error: balErr } = await supabase.from('inventory_balances').upsert(slice, {
              onConflict: 'location_id,item_id',
            })
            if (balErr) throw balErr
            stock_updated += slice.length
          }
        }
      }

      return json({ ok: true, data: { created, updated, stock_updated } })
    }

    // -----------------------------------------------------------------------
    // deactivateAllItems — скрыть все позиции каталога (is_active = false)
    // -----------------------------------------------------------------------
    if (body.action === 'deactivateAllItems') {
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
    // deleteEmptyBalanceItems — удалить товары без остатков (как одиночное удаление)
    // -----------------------------------------------------------------------
    if (body.action === 'deleteEmptyBalanceItems') {
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
      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)

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

      const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', itemId)
      if (deleteError) throw deleteError

      return json({ ok: true })
    }

    // -----------------------------------------------------------------------
    // updateItem
    // -----------------------------------------------------------------------
    if (body.action === 'updateItem') {
      const itemId = String(body.item_id || '').trim()
      if (!itemId) return json({ error: 'item-id-required' }, 400)

      const fields = body.fields || {}
      if (Object.keys(fields).length === 0) return json({ error: 'fields-required' }, 400)

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
