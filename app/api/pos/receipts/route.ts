import { NextResponse } from 'next/server'
import { resolveCompanyScope } from '@/lib/server/organizations'
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
    const dateFrom = url.searchParams.get('date_from') || ''
    const dateTo = url.searchParams.get('date_to') || ''
    const search = url.searchParams.get('search') || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const pageSize = 20
    const offset = (page - 1) * pageSize
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('point_sales')
      .select('id, sale_date, sold_at, payment_method, cash_amount, kaspi_amount, card_amount, online_amount, total_amount, discount_amount, loyalty_points_earned, loyalty_points_spent, loyalty_discount_amount, customer_id, source, comment, items:point_sale_items(id, item_id, quantity, unit_price, total_price, inventory_items(name))', { count: 'exact' })
      .order('sold_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: [], total: 0, page, page_size: pageSize })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }
    if (locationId) query = query.eq('location_id', locationId)
    if (dateFrom) query = query.gte('sale_date', dateFrom)
    if (dateTo) query = query.lte('sale_date', dateTo)

    const { data, error, count } = await query
    if (error) throw error

    // Filter by search (amount or last 6 chars of id)
    let filtered = data || []
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      filtered = filtered.filter(sale =>
        sale.id.slice(-6).toLowerCase().includes(s) ||
        String(sale.total_amount).includes(s)
      )
    }

    return json({ ok: true, data: filtered, total: count || 0, page, page_size: pageSize })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/pos/receipts.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
