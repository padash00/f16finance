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
    const locationId = url.searchParams.get('location_id') || ''
    const days = 30 // analyze last 30 days for velocity

    const dateFrom = new Date()
    dateFrom.setDate(dateFrom.getDate() - days)
    const dateFromStr = dateFrom.toISOString().split('T')[0]

    // Fetch sales velocity (last 30 days)
    const { data: saleItems, error: siError } = await supabase
      .from('point_sale_items')
      .select('item_id, quantity, point_sales!inner(sale_date, company_id, location_id)')
      .gte('point_sales.sale_date', dateFromStr)

    if (siError) throw siError

    // Filter by company/location
    const filtered = (saleItems || []).filter((si: any) => {
      const sale = Array.isArray(si.point_sales) ? si.point_sales[0] : si.point_sales
      if (companyId && sale?.company_id !== companyId) return false
      if (locationId && sale?.location_id !== locationId) return false
      return true
    })

    // Compute daily avg qty per item
    const velocityMap: Record<string, number> = {}
    for (const si of filtered) {
      velocityMap[si.item_id] = (velocityMap[si.item_id] || 0) + Number(si.quantity || 0)
    }
    // Convert total qty in period to daily avg
    for (const id of Object.keys(velocityMap)) {
      velocityMap[id] = velocityMap[id] / days
    }

    // Fetch current balances
    let balanceQuery = supabase
      .from('inventory_balances')
      .select('item_id, quantity, location_id')
    if (locationId) balanceQuery = balanceQuery.eq('location_id', locationId)

    const { data: balances, error: balError } = await balanceQuery
    if (balError) throw balError

    // Sum balance per item
    const balanceMap: Record<string, number> = {}
    for (const b of balances || []) {
      balanceMap[b.item_id] = (balanceMap[b.item_id] || 0) + Number(b.quantity || 0)
    }

    // Fetch item details
    const { data: items, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, name, low_stock_threshold, is_active, category:inventory_categories(name)')
      .eq('is_active', true)
    if (itemsError) throw itemsError

    // Build forecast
    const forecast = (items || []).map((item: any) => {
      const balance = balanceMap[item.id] || 0
      const dailyVelocity = velocityMap[item.id] || 0
      const daysLeft = dailyVelocity > 0 ? Math.floor(balance / dailyVelocity) : null
      const cat = item.category
      return {
        item_id: item.id,
        name: item.name,
        category: Array.isArray(cat) ? cat[0]?.name || null : cat?.name || null,
        balance: Math.round(balance * 100) / 100,
        daily_velocity: Math.round(dailyVelocity * 100) / 100,
        days_left: daysLeft,
        threshold: item.low_stock_threshold,
        status: daysLeft === null
          ? 'no_sales'
          : daysLeft <= 3
          ? 'critical'
          : daysLeft <= 7
          ? 'warning'
          : daysLeft <= 14
          ? 'low'
          : 'ok',
      }
    })

    // Sort: critical first, then warning, then by days_left
    forecast.sort((a: any, b: any) => {
      const order = { critical: 0, warning: 1, low: 2, no_sales: 3, ok: 4 }
      const diff = (order[a.status as keyof typeof order] || 4) - (order[b.status as keyof typeof order] || 4)
      if (diff !== 0) return diff
      if (a.days_left === null && b.days_left === null) return 0
      if (a.days_left === null) return 1
      if (b.days_left === null) return -1
      return a.days_left - b.days_left
    })

    return json({ ok: true, data: forecast, period_days: days })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/inventory/forecast.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
