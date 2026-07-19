import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
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

// PostgREST молча режет ответ до 1000 строк — продажи/приёмки товара постранично.
const PAGE_SIZE = 1000
async function fetchAllPages<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-catalog.view')
    if (denied) return denied
    if (!canManageCatalog(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

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
      // Ходовой товар может иметь >1000 продаж за 30 дней — это сумма, забираем всё.
      const saleRows = await fetchAllPages((from, to) =>
        supabase
          .from('inventory_movements')
          .select('quantity')
          .eq('movement_type', 'sale')
          .eq('item_id', itemId)
          .in('from_location_id', locationIds)
          .gte('created_at', since30)
          .order('id')
          .range(from, to),
      )
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
    let purchaseRows: any[] = []
    {
      // История приёмок товара растёт без ограничения — постранично, иначе
      // «последняя закупочная» берётся из усечённой выборки.
      const recRows = await fetchAllPages((from, to) =>
        supabase
          .from('inventory_receipt_items')
          .select('quantity, unit_cost, receipt:receipt_id(received_at, status, supplier:supplier_id(name, organization_name))')
          .eq('item_id', itemId)
          .order('id')
          .range(from, to),
      )
      purchaseRows = recRows as any[]
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

    // 7. История продаж — последние 30 движений-продаж
    let salesHistory: Array<{ date: string; quantity: number; amount: number; location: string }> = []
    if (locationIds.length > 0) {
      const { data: shRows } = await supabase
        .from('inventory_movements')
        .select('quantity, total_amount, created_at, from_location:from_location_id(name, company:company_id(name))')
        .eq('movement_type', 'sale')
        .eq('item_id', itemId)
        .in('from_location_id', locationIds)
        .order('created_at', { ascending: false })
        .limit(30)
      salesHistory = ((shRows || []) as any[]).map((r) => {
        const loc = Array.isArray(r.from_location) ? r.from_location[0] : r.from_location
        const comp = loc ? (Array.isArray(loc.company) ? loc.company[0] : loc.company) : null
        return {
          date: String(r.created_at || ''),
          quantity: round2(Number(r.quantity || 0)),
          amount: round2(Number(r.total_amount || 0)),
          location: String(comp?.name || loc?.name || '—'),
        }
      })
    }

    // 8. История закупок — из уже загруженных приёмок (без отменённых)
    const purchaseHistory = purchaseRows
      .map((r) => {
        const receipt = (Array.isArray(r.receipt) ? r.receipt[0] : r.receipt) || {}
        const supplier = (Array.isArray(receipt.supplier) ? receipt.supplier[0] : receipt.supplier) || {}
        return {
          date: String(receipt.received_at || ''),
          status: String(receipt.status || ''),
          quantity: round2(Number(r.quantity || 0)),
          unit_cost: round2(Number(r.unit_cost || 0)),
          supplier: String(supplier.organization_name || '').trim() || String(supplier.name || '').trim() || 'Оприходование',
        }
      })
      .filter((r) => r.date && r.status !== 'cancelled')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map(({ status: _status, ...rest }) => rest)

    // 9. История долгов — point_debt_items связаны с товаром только по имени
    // (item_name пишется кассой из каталога) — матчим точным именем.
    let debtHistory: Array<{ date: string; client: string; quantity: number; amount: number; status: string; company: string }> = []
    {
      let debtQuery = supabase
        .from('point_debt_items')
        .select('client_name, quantity, total_amount, created_at, status, company:company_id(name)')
        .ilike('item_name', String(item.name || ''))
        .order('created_at', { ascending: false })
        .limit(30)
      if (allowedCompanyIds) debtQuery = debtQuery.in('company_id', allowedCompanyIds)
      const { data: debtRows } = await debtQuery
      debtHistory = ((debtRows || []) as any[]).map((r) => {
        const comp = Array.isArray(r.company) ? r.company[0] : r.company
        return {
          date: String(r.created_at || ''),
          client: String(r.client_name || '—'),
          quantity: round2(Number(r.quantity || 0)),
          amount: round2(Number(r.total_amount || 0)),
          status: String(r.status || 'active'),
          company: String(comp?.name || '—'),
        }
      })
    }

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
        // Истории (последние 30 записей каждая)
        sales_history: salesHistory,
        purchase_history: purchaseHistory,
        debt_history: debtHistory,
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
