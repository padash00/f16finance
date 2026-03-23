import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id') || ''

    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().split('T')[0]
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]

    // Run all queries in parallel
    const [
      todaySalesRes,
      yesterdaySalesRes,
      weekSalesRes,
      monthSalesRes,
      recentSalesRes,
      lowStockRes,
      topItemsRes,
    ] = await Promise.all([
      // Today totals
      supabase.from('point_sales').select('total_amount, cash_amount, kaspi_amount, card_amount, online_amount').eq('sale_date', todayStr).then(r => r),
      // Yesterday totals
      supabase.from('point_sales').select('total_amount').eq('sale_date', yesterdayStr).then(r => r),
      // Week sales by day
      supabase.from('point_sales').select('sale_date, total_amount').gte('sale_date', weekAgoStr).lte('sale_date', todayStr).order('sale_date').then(r => r),
      // Month total
      supabase.from('point_sales').select('total_amount').gte('sale_date', monthStart).then(r => r),
      // Recent 10 sales
      supabase.from('point_sales').select('id, sold_at, total_amount, payment_method, items:point_sale_items(quantity)').order('sold_at', { ascending: false }).limit(10).then(r => r),
      // Low stock items (balance <= threshold)
      supabase.from('inventory_items').select('id, name, low_stock_threshold, total_balance:inventory_balances(quantity)').eq('is_active', true).not('low_stock_threshold', 'is', null).then(r => r),
      // Top items this week
      supabase.from('point_sale_items').select('item_id, quantity, inventory_items(name)').gte('created_at', weekAgoStr).then(r => r),
    ])

    // Today stats
    const todaySales = todaySalesRes.data || []
    const todayTotal = todaySales.reduce((s: number, r: any) => s + (r.total_amount || 0), 0)
    const todayCash = todaySales.reduce((s: number, r: any) => s + (r.cash_amount || 0), 0)
    const todayKaspi = todaySales.reduce((s: number, r: any) => s + (r.kaspi_amount || 0), 0)
    const todayCard = todaySales.reduce((s: number, r: any) => s + (r.card_amount || 0), 0)
    const todayOnline = todaySales.reduce((s: number, r: any) => s + (r.online_amount || 0), 0)
    const todayCount = todaySales.length

    // Yesterday
    const yesterdayTotal = (yesterdaySalesRes.data || []).reduce((s: number, r: any) => s + (r.total_amount || 0), 0)

    // Change %
    const changePercent = yesterdayTotal > 0 ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100) : null

    // Week by day
    const weekByDay: Record<string, number> = {}
    for (const r of weekSalesRes.data || []) {
      weekByDay[r.sale_date] = (weekByDay[r.sale_date] || 0) + (r.total_amount || 0)
    }

    // Month total
    const monthTotal = (monthSalesRes.data || []).reduce((s: number, r: any) => s + (r.total_amount || 0), 0)

    // Top items
    const itemSums: Record<string, { name: string; qty: number }> = {}
    for (const r of topItemsRes.data || []) {
      const name = (Array.isArray(r.inventory_items) ? r.inventory_items[0]?.name : (r.inventory_items as any)?.name) || r.item_id
      if (!itemSums[r.item_id]) itemSums[r.item_id] = { name, qty: 0 }
      itemSums[r.item_id].qty += Number(r.quantity || 0)
    }
    const topItems = Object.entries(itemSums).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5).map(([id, v]) => ({ item_id: id, name: v.name, qty: v.qty }))

    // Low stock
    const lowStock = (lowStockRes.data || []).filter((item: any) => {
      const balance = Array.isArray(item.total_balance)
        ? item.total_balance.reduce((s: number, b: any) => s + (b.quantity || 0), 0)
        : 0
      return balance <= (item.low_stock_threshold || 0)
    }).map((item: any) => ({
      id: item.id,
      name: item.name,
      threshold: item.low_stock_threshold,
      balance: Array.isArray(item.total_balance)
        ? item.total_balance.reduce((s: number, b: any) => s + (b.quantity || 0), 0)
        : 0,
    }))

    // Recent sales
    const recentSales = (recentSalesRes.data || []).map((s: any) => ({
      id: s.id,
      sold_at: s.sold_at,
      total_amount: s.total_amount,
      payment_method: s.payment_method,
      items_count: Array.isArray(s.items) ? s.items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0) : 0,
    }))

    // Suppress unused variable warning
    void companyId

    return json({
      ok: true,
      data: {
        today: { total: todayTotal, count: todayCount, cash: todayCash, kaspi: todayKaspi, card: todayCard, online: todayOnline },
        yesterday: { total: yesterdayTotal },
        change_percent: changePercent,
        month_total: monthTotal,
        week_by_day: weekByDay,
        top_items: topItems,
        low_stock: lowStock,
        recent_sales: recentSales,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/dashboard.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
