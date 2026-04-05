import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
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
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0]
    const shift = url.searchParams.get('shift') || '' // 'day' | 'night' | '' (both)
    const locationId = url.searchParams.get('location_id') || ''
    const companyId = url.searchParams.get('company_id') || ''
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Build sales query
    let salesQuery = supabase
      .from('point_sales')
      .select('id, sold_at, shift, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, total_amount, operator_id, items:point_sale_items(item_id, quantity, unit_price, total_price, inventory_items(name))')
      .eq('sale_date', date)
      .order('sold_at', { ascending: true })

    if (shift) salesQuery = salesQuery.eq('shift', shift)
    if (locationId) salesQuery = salesQuery.eq('location_id', locationId)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({
          ok: true,
          data: {
            date,
            shift: shift || 'all',
            totals: { amount: 0, cash: 0, kaspi: 0, card: 0, online: 0, count: 0, avg_check: 0 },
            top_items: [],
            by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, amount: 0 })),
            sales: [],
          },
        })
      }
      salesQuery = salesQuery.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data: sales, error: salesError } = await salesQuery
    if (salesError) throw salesError

    const allSales = sales || []

    // Aggregate totals
    const totalAmount = allSales.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0)
    const cashTotal = allSales.reduce((s: number, r: any) => s + Number(r.cash_amount || 0), 0)
    const kaspiTotal = allSales.reduce((s: number, r: any) => s + Number(r.kaspi_amount || 0), 0)
    const cardTotal = allSales.reduce((s: number, r: any) => s + Number(r.card_amount || 0), 0)
    const onlineTotal = allSales.reduce((s: number, r: any) => s + Number(r.online_amount || 0), 0)
    const salesCount = allSales.length
    const avgCheck = salesCount > 0 ? totalAmount / salesCount : 0

    // Aggregate items sold
    const itemMap: Record<string, { name: string; qty: number; revenue: number }> = {}
    for (const sale of allSales) {
      for (const item of (sale.items || []) as any[]) {
        const name = Array.isArray(item.inventory_items) ? item.inventory_items[0]?.name : item.inventory_items?.name || item.item_id
        if (!itemMap[item.item_id]) itemMap[item.item_id] = { name, qty: 0, revenue: 0 }
        itemMap[item.item_id].qty += Number(item.quantity || 0)
        itemMap[item.item_id].revenue += Number(item.total_price || 0)
      }
    }

    const topItems = Object.entries(itemMap)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([id, v]) => ({ item_id: id, name: v.name, qty: Math.round(v.qty * 100) / 100, revenue: Math.round(v.revenue) }))

    // Sales by hour
    const hourMap: Record<number, number> = {}
    for (const sale of allSales) {
      const hour = new Date(sale.sold_at).getHours()
      hourMap[hour] = (hourMap[hour] || 0) + Number(sale.total_amount || 0)
    }
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, amount: Math.round(hourMap[h] || 0) }))

    return json({
      ok: true,
      data: {
        date,
        shift: shift || 'all',
        totals: {
          amount: Math.round(totalAmount),
          cash: Math.round(cashTotal),
          kaspi: Math.round(kaspiTotal),
          card: Math.round(cardTotal),
          online: Math.round(onlineTotal),
          count: salesCount,
          avg_check: Math.round(avgCheck),
        },
        top_items: topItems,
        by_hour: byHour,
        sales: allSales.map((s: any) => ({
          id: s.id,
          sold_at: s.sold_at,
          shift: s.shift,
          total_amount: s.total_amount,
          payment_method: s.payment_method,
          items_count: (s.items || []).length,
        })),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/shifts/report.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
