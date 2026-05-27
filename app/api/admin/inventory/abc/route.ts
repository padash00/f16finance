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
  staffRole: string
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
        const itemId = (row as any)?.item_id
        if (!itemId || typeof itemId !== 'string') continue
        qtyByItem[itemId] = (qtyByItem[itemId] || 0) + Number((row as any).quantity || 0)
      }

      const itemIds = Object.keys(qtyByItem).filter((id) => id && id !== 'null' && id !== 'undefined')
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

    // Aggregate by item_id. Пропускаем строки без item_id — иначе в Map попадёт
    // ключ 'null' и SQL получит "invalid input syntax for type uuid: 'null'".
    // Параллельно собираем продажи по дням для XYZ-анализа (коэф. вариации).
    const itemMap: Record<string, { revenue: number; qty: number; transactions: number }> = {}
    const dailyQtyByItem: Record<string, Record<string, number>> = {}
    for (const si of filtered) {
      const itemId = (si as any)?.item_id
      if (!itemId || typeof itemId !== 'string') continue
      if (!itemMap[itemId]) itemMap[itemId] = { revenue: 0, qty: 0, transactions: 0 }
      itemMap[itemId].revenue += Number(si.total_price || (si.quantity * si.unit_price) || 0)
      itemMap[itemId].qty += Number(si.quantity || 0)
      itemMap[itemId].transactions += 1
      const ps = (si as any)?.point_sales
      const saleDate = String((Array.isArray(ps) ? ps[0]?.sale_date : ps?.sale_date) || '').slice(0, 10)
      if (saleDate) {
        if (!dailyQtyByItem[itemId]) dailyQtyByItem[itemId] = {}
        dailyQtyByItem[itemId][saleDate] = (dailyQtyByItem[itemId][saleDate] || 0) + Number(si.quantity || 0)
      }
    }

    // XYZ по коэффициенту вариации (CV) суточных продаж за период.
    // X = стабильный (CV < 25%), Y = средне-стабильный (25-50%), Z = непредсказуемый (>50%).
    // Для товаров с < 3 днями продаж — Z (недостаточно данных для стабильности).
    function computeXyz(itemId: string): 'X' | 'Y' | 'Z' {
      const days = dailyQtyByItem[itemId]
      if (!days) return 'Z'
      const values = Object.values(days)
      if (values.length < 3) return 'Z'
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      if (mean <= 0) return 'Z'
      const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
      const cv = (Math.sqrt(variance) / mean) * 100
      if (cv < 25) return 'X'
      if (cv < 50) return 'Y'
      return 'Z'
    }

    // Fetch all items (active) — нам нужны и items без продаж (C-класс),
    // и itemDetailsMap для items с продажами.
    const itemIds = Object.keys(itemMap).filter((id) => id && id !== 'null' && id !== 'undefined')
    void itemIds // используется только для документации scope; реальный лукап — через allItems ниже

    // Also fetch items with zero sales (C-class candidates)
    const { data: allItems, error: allItemsError } = await supabase
      .from('inventory_items')
      .select('id, name, sale_price, default_purchase_price, category_id, is_active, category:inventory_categories(name)')
      .eq('is_active', true)
    if (allItemsError) throw allItemsError

    // Загружаем остатки складов (warehouse) этой точки/области — для stock_value и slow-movers.
    let stockLocationsQuery = supabase
      .from('inventory_locations')
      .select('id, company_id')
      .eq('is_active', true)
      .not('company_id', 'is', null)
    if (companyId) stockLocationsQuery = stockLocationsQuery.eq('company_id', companyId)
    if (scopedCompanyIds) stockLocationsQuery = stockLocationsQuery.in('company_id', scopedCompanyIds)
    const { data: stockLocations, error: stockLocationsError } = await stockLocationsQuery
    if (stockLocationsError) throw stockLocationsError
    const stockLocationIds = (stockLocations || [])
      .map((row: any) => String(row.id))
      .filter((id) => id && id !== 'null')

    const stockQtyByItem: Record<string, number> = {}
    if (stockLocationIds.length > 0) {
      const { data: stockBalances, error: stockBalancesError } = await supabase
        .from('inventory_balances')
        .select('item_id, quantity')
        .in('location_id', stockLocationIds)
        .gt('quantity', 0)
      if (stockBalancesError) throw stockBalancesError
      for (const row of stockBalances || []) {
        const id = (row as any)?.item_id
        if (!id || typeof id !== 'string') continue
        stockQtyByItem[id] = (stockQtyByItem[id] || 0) + Number((row as any).quantity || 0)
      }
    }

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
      xyz_class: 'X' | 'Y' | 'Z'
      margin: number
      margin_percent: number
      stock_qty: number
      stock_value: number
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
      const stockQty = Number(stockQtyByItem[itemId] || 0)
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
        xyz_class: computeXyz(itemId),
        margin: Math.round(margin),
        margin_percent: Math.round(marginPercent * 10) / 10,
        stock_qty: Math.round(stockQty * 100) / 100,
        stock_value: Math.round(stockQty * purchasePrice),
      })
    }

    // Add zero-sales items as C class
    for (const item of allItems || []) {
      if (!itemMap[item.id]) {
        const cat = item.category as any
        const stockQty = Number(stockQtyByItem[item.id] || 0)
        const purchasePrice = Number(item.default_purchase_price || 0)
        result.push({
          item_id: item.id,
          name: item.name,
          category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
          sale_price: Number(item.sale_price || 0),
          purchase_price: purchasePrice,
          revenue: 0,
          qty: 0,
          transactions: 0,
          revenue_percent: 0,
          cumulative_percent: 100,
          abc_class: 'C',
          xyz_class: 'Z',
          margin: 0,
          margin_percent: 0,
          stock_qty: Math.round(stockQty * 100) / 100,
          stock_value: Math.round(stockQty * purchasePrice),
        })
      }
    }

    // Slow-movers: товары с положительным остатком и нулевыми продажами за период.
    // Замороженные деньги = stock_value.
    const slowMovers = result
      .filter((r) => r.revenue === 0 && r.stock_qty > 0)
      .sort((a, b) => b.stock_value - a.stock_value)
    const slowMoversValue = slowMovers.reduce((s, r) => s + r.stock_value, 0)

    // Матрица ABC×XYZ — 3×3 ячейки с количеством товаров и суммарной выручкой.
    const abcXyzMatrix: Record<string, { count: number; revenue: number }> = {}
    for (const r of result) {
      const key = `${r.abc_class}${r.xyz_class}`
      if (!abcXyzMatrix[key]) abcXyzMatrix[key] = { count: 0, revenue: 0 }
      abcXyzMatrix[key].count += 1
      abcXyzMatrix[key].revenue += r.revenue
    }

    const summary = {
      total_revenue: Math.round(totalRevenue),
      count_a: result.filter(i => i.abc_class === 'A').length,
      count_b: result.filter(i => i.abc_class === 'B').length,
      count_c: result.filter(i => i.abc_class === 'C').length,
      revenue_a: Math.round(result.filter(i => i.abc_class === 'A').reduce((s, i) => s + i.revenue, 0)),
      revenue_b: Math.round(result.filter(i => i.abc_class === 'B').reduce((s, i) => s + i.revenue, 0)),
      revenue_c: Math.round(result.filter(i => i.abc_class === 'C').reduce((s, i) => s + i.revenue, 0)),
      slow_movers_count: slowMovers.length,
      slow_movers_value: Math.round(slowMoversValue),
      abc_xyz_matrix: abcXyzMatrix,
    }

    return json({
      ok: true,
      data: result,
      slow_movers: slowMovers,
      summary,
      days,
      total_revenue: totalRevenue,
      mode,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/abc.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
