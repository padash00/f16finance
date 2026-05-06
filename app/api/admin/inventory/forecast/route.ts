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
    const denied = await requireCapability(access, 'store-forecast.view')
    if (denied) return denied as any
    if (!canManageInventory(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id') || ''
    const locationId = url.searchParams.get('location_id') || ''
    const days = 30 // analyze last 30 days for velocity
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: [], period_days: days })
    }
    if (companyScope.allowedCompanyIds && companyId && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden-company' }, 403)
    }
    const scopedCompanyIds = companyScope.allowedCompanyIds || null

    let locationsQuery = supabase
      .from('inventory_locations')
      .select('id, company_id')
      .eq('is_active', true)
      .not('company_id', 'is', null)
    if (companyId) locationsQuery = locationsQuery.eq('company_id', companyId)
    if (scopedCompanyIds) locationsQuery = locationsQuery.in('company_id', scopedCompanyIds)
    const { data: scopedLocations, error: scopedLocationsError } = await locationsQuery
    if (scopedLocationsError) throw scopedLocationsError
    const scopedLocationIds = new Set((scopedLocations || []).map((row: any) => String(row.id || '')).filter(Boolean))
    if (locationId && !scopedLocationIds.has(locationId)) {
      return json({ error: 'forbidden-location' }, 403)
    }

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
      if (scopedCompanyIds && !scopedCompanyIds.includes(String(sale?.company_id || ''))) return false
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
    else if (scopedLocationIds.size > 0) balanceQuery = balanceQuery.in('location_id', Array.from(scopedLocationIds))
    else balanceQuery = balanceQuery.eq('location_id', '__none__')

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
