import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Карточка товара (GET).
//
// Возвращает всё для красивой карточки: поля товара, маржу, остатки по точкам,
// продажи за 30 дней + скорость/нед, последнего поставщика и его цену.
//
// Источники данных по образцу lib/server/purchase-plan.ts:
//   • продажи     — inventory_movements (movement_type='sale', from_location_id ∈ локации)
//   • остатки     — inventory_balances (location_id ∈ локации орг/allowed)
//   • поставщик   — inventory_receipt_items + receipt(received_at, supplier(...))
//
// ФОРМУЛА маржи (денежный путь — как в purchase-plan):
//   purchase = последняя закупочная (из приёмки) || default_purchase_price
//   margin%  = (sale_price − purchase) / sale_price × 100
//   velocity = sum(qty за 30д) / 4.3   (продаж в неделю)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageCatalog(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-catalog.view')
    if (denied) return denied
    if (!canManageCatalog(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await context.params
    const itemId = String(id || '').trim()
    if (!itemId) return json({ error: 'item-id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const orgId = access.activeOrganization?.id || null
    const scopeOrg = access.isSuperAdmin ? null : (orgId || '00000000-0000-0000-0000-000000000000')

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedCompanyIds = companyScope.allowedCompanyIds // null = супер-админ (все)

    // 1. Сам товар. description/image_url/brand читаем МЯГКО (try/catch) —
    //    эти колонки могут отсутствовать, если миграция не применена.
    const baseCols = 'id, name, barcode, unit, sale_price, default_purchase_price, category_id, low_stock_threshold, pack_size, organization_id, category:inventory_categories(id, name)'
    let item: any = null
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select(`${baseCols}, description, image_url, brand`)
        .eq('id', itemId)
        .maybeSingle()
      if (error) throw error
      item = data
    } catch {
      // Доп. колонок ещё нет (миграция не применена) — читаем без них.
      const { data, error } = await supabase
        .from('inventory_items')
        .select(baseCols)
        .eq('id', itemId)
        .maybeSingle()
      if (error) throw error
      item = data ? { ...data, description: null, image_url: null, brand: null } : null
    }
    if (!item) return json({ error: 'item-not-found' }, 404)

    // Изоляция: товар обязан принадлежать орг вызывающего.
    if (scopeOrg && String(item.organization_id || '') !== String(scopeOrg)) {
      return json({ error: 'forbidden' }, 403)
    }

    const category = Array.isArray(item.category) ? item.category[0] || null : item.category || null

    // 2. Локации, доступные вызывающему (своя орг + скоуп company).
    let locQuery = supabase
      .from('inventory_locations')
      .select('id, name, location_type, company_id, company:companies(name)')
    if (scopeOrg) locQuery = locQuery.eq('organization_id', scopeOrg)
    if (allowedCompanyIds) locQuery = locQuery.in('company_id', allowedCompanyIds)
    const { data: locRows, error: locErr } = await locQuery
    if (locErr) throw locErr

    const locations = (locRows || []) as Array<{
      id: string
      name: string
      location_type: string
      company_id: string | null
      company: any
    }>
    const locById = new Map(locations.map((l) => [String(l.id), l]))
    const locationIds = locations.map((l) => String(l.id)).filter(Boolean)

    // 3. Остатки по этим локациям для товара.
    const stockByLocation: Array<{
      location_id: string
      location: string
      location_type: string
      company: string | null
      quantity: number
    }> = []
    let totalStock = 0
    if (locationIds.length > 0) {
      const { data: balRows, error: balErr } = await supabase
        .from('inventory_balances')
        .select('location_id, quantity')
        .eq('item_id', itemId)
        .in('location_id', locationIds)
      if (balErr) throw balErr
      for (const b of balRows || []) {
        const loc = locById.get(String((b as any).location_id))
        if (!loc) continue
        const qty = Number((b as any).quantity || 0)
        totalStock += qty
        const companyName = Array.isArray(loc.company)
          ? (loc.company[0]?.name || null)
          : (loc.company?.name || null)
        stockByLocation.push({
          location_id: String(loc.id),
          location: String(loc.name || '—'),
          location_type: String(loc.location_type || ''),
          company: companyName,
          quantity: round2(qty),
        })
      }
    }
    // Показываем сначала с остатком, потом нулевые; внутри — по названию.
    stockByLocation.sort((a, b) => (b.quantity - a.quantity) || a.location.localeCompare(b.location, 'ru'))

    // 4. Продажи за 30 дней (movement_type='sale', from_location_id ∈ доступные локации).
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString()
    let sold30 = 0
    if (locationIds.length > 0) {
      const { data: saleRows, error: saleErr } = await supabase
        .from('inventory_movements')
        .select('quantity')
        .eq('movement_type', 'sale')
        .eq('item_id', itemId)
        .in('from_location_id', locationIds)
        .gte('created_at', since30)
      if (saleErr) throw saleErr
      for (const s of saleRows || []) {
        const q = Number((s as any).quantity || 0)
        if (q > 0) sold30 += q
      }
    }
    const velocityPerWeek = round1(sold30 / 4.3) // ~4.3 недели в 30 днях

    // 5. Последняя приёмка → последняя закупочная цена + поставщик.
    let lastPurchasePrice: number | null = null
    let lastSupplier: string | null = null
    let lastReceivedAt: string | null = null
    {
      const { data: recRows, error: recErr } = await supabase
        .from('inventory_receipt_items')
        .select('unit_cost, receipt:receipt_id(received_at, supplier:supplier_id(name, organization_name))')
        .eq('item_id', itemId)
      if (recErr) throw recErr
      for (const r of (recRows || []) as any[]) {
        const receipt = r.receipt || {}
        const receivedAt = String(receipt.received_at || '')
        if (lastReceivedAt && lastReceivedAt >= receivedAt) continue
        lastReceivedAt = receivedAt
        lastPurchasePrice = Number(r.unit_cost || 0)
        const supplier = receipt.supplier || {}
        lastSupplier =
          String(supplier.organization_name || '').trim() ||
          String(supplier.name || '').trim() ||
          null
      }
    }

    // 6. Маржа: закуп = последняя приёмка || default_purchase_price.
    const salePrice = Number(item.sale_price || 0)
    const defaultPurchase = Number(item.default_purchase_price || 0)
    const purchase = lastPurchasePrice != null && lastPurchasePrice > 0 ? lastPurchasePrice : defaultPurchase
    const marginPct = salePrice > 0 ? round1(((salePrice - purchase) / salePrice) * 100) : 0
    const marginAbs = round2(salePrice - purchase)

    return json({
      ok: true,
      data: {
        id: String(item.id),
        name: String(item.name || ''),
        barcode: String(item.barcode || ''),
        unit: String(item.unit || 'шт'),
        brand: item.brand || null,
        description: item.description || null,
        image_url: item.image_url || null,
        category: category ? String(category.name || '') : null,
        pack_size: Number(item.pack_size || 1) || 1,
        low_stock_threshold: item.low_stock_threshold != null ? Number(item.low_stock_threshold) : null,
        // Цены / маржа
        sale_price: round2(salePrice),
        default_purchase_price: round2(defaultPurchase),
        purchase_price: round2(purchase),
        margin_pct: marginPct,
        margin_abs: marginAbs,
        // Остатки
        total_stock: round2(totalStock),
        stock_by_location: stockByLocation,
        // Продажи
        sold_30d: round2(sold30),
        velocity_per_week: velocityPerWeek,
        // Поставщик
        last_supplier: lastSupplier,
        last_purchase_price: lastPurchasePrice != null ? round2(lastPurchasePrice) : null,
        last_received_at: lastReceivedAt || null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/catalog/[id]/card.GET',
      message: error?.message || 'product card GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить карточку товара' }, 500)
  }
}
