import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}
const round = (n: number) => Math.round(Number(n) || 0)

/**
 * Аналитика по товарам (как Wipon): продаваемые, доходные, остатки.
 * Одна выборка → строки по товарам с qty/revenue/profit/stock + цены/категория.
 * Период по реальному времени sold_at в границах дней по Алматы (UTC+5).
 */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-analytics.view')
    if (denied) return denied as any

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' })
    const from = url.searchParams.get('from') || today
    const to = url.searchParams.get('to') || today
    const companyId = url.searchParams.get('company_id') || ''

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const scoped = companyScope.allowedCompanyIds
    const emptyOut = {
      items: [],
      sales_totals: { revenue: 0, profit: 0, qty: 0 },
      stock_totals: { possible_sales: 0, possible_profit: 0, purchase_sum: 0, total_qty: 0, items_count: 0 },
    }
    if (scoped && scoped.length === 0) return json({ ok: true, data: emptyOut })
    if (scoped && companyId && !scoped.includes(companyId)) return json({ error: 'forbidden-company' }, 403)

    const fromIso = new Date(`${from}T00:00:00+05:00`).toISOString()
    const toIso = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 24 * 3_600_000).toISOString()

    // ── Продажи по товарам за период ──
    let salesQuery = supabase
      .from('point_sale_items')
      .select('item_id, quantity, unit_price, total_price, point_sales!inner(sold_at, company_id)')
      .gte('point_sales.sold_at', fromIso)
      .lt('point_sales.sold_at', toIso)
    if (companyId) salesQuery = salesQuery.eq('point_sales.company_id', companyId)
    if (scoped) salesQuery = salesQuery.in('point_sales.company_id', scoped)
    const { data: saleItems, error: salesError } = await salesQuery
    if (salesError) throw salesError

    const soldByItem = new Map<string, { qty: number; revenue: number }>()
    for (const si of (saleItems || []) as any[]) {
      const id = si.item_id
      if (!id || typeof id !== 'string') continue
      const row = soldByItem.get(id) || { qty: 0, revenue: 0 }
      row.qty += Number(si.quantity || 0)
      row.revenue += Number(si.total_price || (si.quantity || 0) * (si.unit_price || 0) || 0)
      soldByItem.set(id, row)
    }

    // ── Каталог (активные товары) ──
    const { data: itemsRaw, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, sale_price, default_purchase_price, is_active, category:inventory_categories(name)')
      .eq('is_active', true)
    if (itemsError) throw itemsError

    // ── Остатки по локациям компании ──
    let locQuery = supabase
      .from('inventory_locations')
      .select('id, company_id')
      .eq('is_active', true)
      .not('company_id', 'is', null)
    if (companyId) locQuery = locQuery.eq('company_id', companyId)
    if (scoped) locQuery = locQuery.in('company_id', scoped)
    const { data: locs, error: locError } = await locQuery
    if (locError) throw locError
    const locationIds = (locs || []).map((l: any) => String(l.id)).filter((x) => x && x !== 'null')

    const stockByItem = new Map<string, number>()
    if (locationIds.length > 0) {
      const { data: balances, error: balError } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .in('location_id', locationIds)
        .gt('quantity', 0)
      if (balError) throw balError
      for (const b of (balances || []) as any[]) {
        const id = b.item_id
        if (!id || typeof id !== 'string') continue
        stockByItem.set(id, (stockByItem.get(id) || 0) + Number(b.quantity || 0))
      }
    }

    // ── Сборка строк ──
    const items = (itemsRaw || []).map((it: any) => {
      const sold = soldByItem.get(String(it.id)) || { qty: 0, revenue: 0 }
      const purchase = Number(it.default_purchase_price || 0)
      const sale = Number(it.sale_price || 0)
      const cost = purchase * sold.qty
      const profit = sold.revenue - cost
      const stock = Number(stockByItem.get(String(it.id)) || 0)
      const cat = it.category
      return {
        item_id: String(it.id),
        name: String(it.name || ''),
        barcode: it.barcode || '',
        unit: it.unit || 'шт',
        category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
        qty: Math.round(sold.qty * 100) / 100,
        revenue: round(sold.revenue),
        profit: round(profit),
        margin_percent: sold.revenue > 0 ? Math.round((profit / sold.revenue) * 1000) / 10 : 0,
        stock: Math.round(stock * 100) / 100,
        sale_price: sale,
        purchase_price: purchase,
      }
    })

    const sold = items.filter((i) => i.qty > 0)
    const sales_totals = {
      revenue: round(sold.reduce((s, i) => s + i.revenue, 0)),
      profit: round(sold.reduce((s, i) => s + i.profit, 0)),
      qty: Math.round(sold.reduce((s, i) => s + i.qty, 0) * 100) / 100,
    }

    const inStock = items.filter((i) => i.stock > 0)
    const stock_totals = {
      possible_sales: round(inStock.reduce((s, i) => s + i.stock * i.sale_price, 0)),
      possible_profit: round(inStock.reduce((s, i) => s + i.stock * (i.sale_price - i.purchase_price), 0)),
      purchase_sum: round(inStock.reduce((s, i) => s + i.stock * i.purchase_price, 0)),
      total_qty: Math.round(inStock.reduce((s, i) => s + i.stock, 0) * 100) / 100,
      items_count: inStock.length,
    }

    return json({ ok: true, data: { items, sales_totals, stock_totals } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/product-analytics.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
