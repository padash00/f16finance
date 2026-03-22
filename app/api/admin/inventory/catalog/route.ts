import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

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

      // Fetch existing items by barcode
      const barcodes = rows.map((r) => r.barcode).filter(Boolean)
      const { data: existingItems, error: existingError } = await supabase
        .from('inventory_items')
        .select('id, name, barcode, sale_price, default_purchase_price')
        .in('barcode', barcodes)

      if (existingError) throw existingError

      const existingMap: Record<string, { id: string; name: string; barcode: string; sale_price: number; default_purchase_price: number }> = {}
      for (const item of existingItems || []) {
        existingMap[item.barcode] = item
      }

      // Fetch existing categories
      const { data: existingCategories, error: catError } = await supabase
        .from('inventory_categories')
        .select('id, name')

      if (catError) throw catError

      const existingCatNames = new Set((existingCategories || []).map((c: { id: string; name: string }) => c.name.toLowerCase()))

      const new_items: ImportRow[] = []
      const updated_items: Array<ImportRow & { existing_name: string; price_changed: boolean; name_changed: boolean }> = []
      let unchanged_count = 0
      const newCatSet = new Set<string>()

      for (const row of rows) {
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
        },
      })
    }

    // -----------------------------------------------------------------------
    // confirmImport
    // -----------------------------------------------------------------------
    if (body.action === 'confirmImport') {
      const rows: ImportRow[] = body.rows || []
      if (!Array.isArray(rows)) return json({ error: 'rows-required' }, 400)

      // Ensure all categories exist
      const { data: existingCategories, error: catFetchError } = await supabase
        .from('inventory_categories')
        .select('id, name')

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
        const newCats = Array.from(missingCats).map((name) => ({ name }))
        const { data: insertedCats, error: insertCatError } = await supabase
          .from('inventory_categories')
          .insert(newCats)
          .select('id, name')

        if (insertCatError) throw insertCatError

        for (const cat of insertedCats || []) {
          catNameToId[cat.name.toLowerCase()] = cat.id
        }
      }

      // Fetch existing items by barcode to determine create vs update
      const barcodes = rows.map((r) => r.barcode).filter(Boolean)
      const { data: existingItems, error: existingError } = await supabase
        .from('inventory_items')
        .select('id, barcode')
        .in('barcode', barcodes)

      if (existingError) throw existingError

      const existingBarcodeToId: Record<string, string> = {}
      for (const item of existingItems || []) {
        existingBarcodeToId[item.barcode] = item.id
      }

      let created = 0
      let updated = 0

      // Process in batches
      const toInsert: Array<{
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
        const { error: insertError } = await supabase.from('inventory_items').insert(toInsert)
        if (insertError) throw insertError
        created = toInsert.length
      }

      for (const item of toUpdate) {
        const { id, ...fields } = item
        const { error: updateError } = await supabase.from('inventory_items').update(fields).eq('id', id)
        if (updateError) throw updateError
        updated++
      }

      return json({ ok: true, data: { created, updated } })
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

      return json({ ok: true })
    }

    return json({ error: 'unsupported-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/catalog.POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
