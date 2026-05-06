import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageInventory(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-analytics.view')
    if (denied) return denied as any
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id') || ''
    const mode = url.searchParams.get('mode') === 'stock' ? 'stock' : 'sales'
    const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get('days') || '30')))
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    if (companyScope.allowedCompanyIds && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: [], summary: {}, days, mode })
    }
    if (companyScope.allowedCompanyIds && companyId && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden-company' }, 403)
    }
    const scopedCompanyIds = companyScope.allowedCompanyIds || null

    if (mode === 'stock') {
      let warehouseLocationsQuery = supabase
        .from('inventory_locations')
        .select('id, company_id')
        .eq('location_type', 'warehouse')
        .eq('is_active', true)
        .not('company_id', 'is', null)
      if (companyId) warehouseLocationsQuery = warehouseLocationsQuery.eq('company_id', companyId)
      if (scopedCompanyIds) warehouseLocationsQuery = warehouseLocationsQuery.in('company_id', scopedCompanyIds)

      const { data: warehouseLocations, error: warehouseLocationsError } = await warehouseLocationsQuery
      if (warehouseLocationsError) throw warehouseLocationsError
      const locationIds = (warehouseLocations || []).map((row: any) => String(row.id))
      if (locationIds.length === 0) {
        return json({
          ok: true,
          data: [],
          summary: { total_value: 0, count_a: 0, count_b: 0, count_c: 0, value_a: 0, value_b: 0, value_c: 0 },
          days,
          mode,
        })
      }

      const { data: balanceRows, error: balancesError } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .in('location_id', locationIds)
        .gt('quantity', 0)
      if (balancesError) throw balancesError

      const qtyByItem: Record<string, number> = {}
      for (const row of balanceRows || []) {
        const key = String((row as any).item_id || '')
        if (!key) continue
        qtyByItem[key] = (qtyByItem[key] || 0) + Number((row as any).quantity || 0)
      }

      const itemIds = Object.keys(qtyByItem)
      if (itemIds.length === 0) {
        return json({
          ok: true,
          data: [],
          summary: { total_value: 0, count_a: 0, count_b: 0, count_c: 0, value_a: 0, value_b: 0, value_c: 0 },
          days,
          mode,
        })
      }

      const { data: itemRows, error: itemRowsError } = await supabase
        .from('inventory_items')
        .select('id, name, sale_price, default_purchase_price, category:inventory_categories(name)')
        .in('id', itemIds)
      if (itemRowsError) throw itemRowsError

      const rows = (itemRows || []).map((item: any) => {
        const qty = Number(qtyByItem[String(item.id)] || 0)
        const purchasePrice = Number(item.default_purchase_price || 0)
        const stockValue = qty * purchasePrice
        const cat = item.category as any
        return {
          item_id: String(item.id),
          name: String(item.name || ''),
          category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
          sale_price: Number(item.sale_price || 0),
          purchase_price: purchasePrice,
          qty: Math.round(qty * 100) / 100,
          stock_value: Math.round(stockValue),
        }
      }).sort((a, b) => b.stock_value - a.stock_value)

      const totalValue = rows.reduce((sum, row) => sum + row.stock_value, 0)
      let cumulative = 0
      const data = rows.map((row) => {
        const valuePercent = totalValue > 0 ? (row.stock_value / totalValue) * 100 : 0
        cumulative += valuePercent
        const abcClass: 'A' | 'B' | 'C' = cumulative <= 80 ? 'A' : cumulative <= 95 ? 'B' : 'C'
        return {
          ...row,
          value_percent: Math.round(valuePercent * 10) / 10,
          cumulative_percent: Math.round(cumulative * 10) / 10,
          abc_class: abcClass,
        }
      })

      const summary = {
        total_value: Math.round(totalValue),
        count_a: data.filter((i) => i.abc_class === 'A').length,
        count_b: data.filter((i) => i.abc_class === 'B').length,
        count_c: data.filter((i) => i.abc_class === 'C').length,
        value_a: Math.round(data.filter((i) => i.abc_class === 'A').reduce((s, i) => s + i.stock_value, 0)),
        value_b: Math.round(data.filter((i) => i.abc_class === 'B').reduce((s, i) => s + i.stock_value, 0)),
        value_c: Math.round(data.filter((i) => i.abc_class === 'C').reduce((s, i) => s + i.stock_value, 0)),
      }

      return json({ ok: true, data, summary, days, mode })
    }

    const dateFrom = new Date()
    dateFrom.setDate(dateFrom.getDate() - days)
    const dateFromStr = dateFrom.toISOString().split('T')[0]

    // Fetch all sale items in period
    let saleItemsQuery = supabase
      .from('point_sale_items')
      .select('item_id, quantity, unit_price, total_price, point_sales!inner(sale_date, company_id)')
      .gte('point_sales.sale_date', dateFromStr)
    if (companyId) saleItemsQuery = saleItemsQuery.eq('point_sales.company_id', companyId)
    if (scopedCompanyIds) saleItemsQuery = saleItemsQuery.in('point_sales.company_id', scopedCompanyIds)
    const { data: saleItems, error: saleItemsError } = await saleItemsQuery

    if (saleItemsError) throw saleItemsError

    const filtered = saleItems || []

    // Aggregate by item_id
    const itemMap: Record<string, { revenue: number; qty: number; transactions: number }> = {}
    for (const si of filtered) {
      if (!itemMap[si.item_id]) itemMap[si.item_id] = { revenue: 0, qty: 0, transactions: 0 }
      itemMap[si.item_id].revenue += Number(si.total_price || (si.quantity * si.unit_price) || 0)
      itemMap[si.item_id].qty += Number(si.quantity || 0)
      itemMap[si.item_id].transactions += 1
    }

    // Fetch item details
    const itemIds = Object.keys(itemMap)
    let items: any[] = []
    if (itemIds.length > 0) {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, sale_price, default_purchase_price, category_id, is_active, category:inventory_categories(name)')
        .in('id', itemIds)
      if (error) throw error
      items = data || []
    }

    // Also fetch items with zero sales (C-class candidates)
    const { data: allItems, error: allItemsError } = await supabase
      .from('inventory_items')
      .select('id, name, sale_price, default_purchase_price, category_id, is_active, category:inventory_categories(name)')
      .eq('is_active', true)
    if (allItemsError) throw allItemsError

    // Build result
    const totalRevenue = Object.values(itemMap).reduce((s, v) => s + v.revenue, 0)

    type AbcItem = {
      item_id: string
      name: string
      category: string | null
      sale_price: number
      purchase_price: number
      revenue: number
      qty: number
      transactions: number
      revenue_percent: number
      cumulative_percent: number
      abc_class: 'A' | 'B' | 'C'
      margin: number
      margin_percent: number
    }

    const result: AbcItem[] = []

    // Items with sales
    const itemDetailsMap = new Map((allItems || []).map((i: any) => [i.id, i]))

    const sortedItemIds = Object.entries(itemMap).sort((a, b) => b[1].revenue - a[1].revenue)
    let cumulative = 0

    for (const [itemId, stats] of sortedItemIds) {
      const detail = itemDetailsMap.get(itemId)
      const revenuePercent = totalRevenue > 0 ? (stats.revenue / totalRevenue) * 100 : 0
      cumulative += revenuePercent
      const abcClass: 'A' | 'B' | 'C' = cumulative <= 80 ? 'A' : cumulative <= 95 ? 'B' : 'C'
      const purchasePrice = Number(detail?.default_purchase_price || 0)
      const margin = stats.qty > 0 ? stats.revenue - purchasePrice * stats.qty : 0
      const marginPercent = stats.revenue > 0 ? (margin / stats.revenue) * 100 : 0
      const cat = detail?.category
      result.push({
        item_id: itemId,
        name: detail?.name || itemId,
        category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
        sale_price: Number(detail?.sale_price || 0),
        purchase_price: purchasePrice,
        revenue: Math.round(stats.revenue),
        qty: Math.round(stats.qty * 100) / 100,
        transactions: stats.transactions,
        revenue_percent: Math.round(revenuePercent * 10) / 10,
        cumulative_percent: Math.round(cumulative * 10) / 10,
        abc_class: abcClass,
        margin: Math.round(margin),
        margin_percent: Math.round(marginPercent * 10) / 10,
      })
    }

    // Add zero-sales items as C class
    for (const item of allItems || []) {
      if (!itemMap[item.id]) {
        const cat = item.category as any
        result.push({
          item_id: item.id,
          name: item.name,
          category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
          sale_price: Number(item.sale_price || 0),
          purchase_price: Number(item.default_purchase_price || 0),
          revenue: 0,
          qty: 0,
          transactions: 0,
          revenue_percent: 0,
          cumulative_percent: 100,
          abc_class: 'C',
          margin: 0,
          margin_percent: 0,
        })
      }
    }

    const summary = {
      total_revenue: Math.round(totalRevenue),
      count_a: result.filter(i => i.abc_class === 'A').length,
      count_b: result.filter(i => i.abc_class === 'B').length,
      count_c: result.filter(i => i.abc_class === 'C').length,
      revenue_a: Math.round(result.filter(i => i.abc_class === 'A').reduce((s, i) => s + i.revenue, 0)),
      revenue_b: Math.round(result.filter(i => i.abc_class === 'B').reduce((s, i) => s + i.revenue, 0)),
      revenue_c: Math.round(result.filter(i => i.abc_class === 'C').reduce((s, i) => s + i.revenue, 0)),
    }

    return json({ ok: true, data: result, summary, days, total_revenue: totalRevenue, mode })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/abc.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
