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
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()))
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1))
    const companyId = url.searchParams.get('company_id') || ''

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`

    // Fetch sales for month
    let salesQuery = supabase
      .from('point_sales')
      .select('id, sale_date, shift, total_amount, cash_amount, kaspi_amount, card_amount, online_amount, discount_amount, loyalty_discount_amount')
      .gte('sale_date', monthStart)
      .lt('sale_date', nextMonth)
      .order('sale_date')

    if (companyId) salesQuery = salesQuery.eq('company_id', companyId)
    const { data: sales, error: salesError } = await salesQuery
    if (salesError) throw salesError

    // Daily breakdown
    const dailyMap: Record<string, { date: string; count: number; total: number; cash: number; kaspi: number; card: number; online: number; discount: number }> = {}
    for (const s of sales || []) {
      if (!dailyMap[s.sale_date]) {
        dailyMap[s.sale_date] = { date: s.sale_date, count: 0, total: 0, cash: 0, kaspi: 0, card: 0, online: 0, discount: 0 }
      }
      dailyMap[s.sale_date].count++
      dailyMap[s.sale_date].total += Number(s.total_amount || 0)
      dailyMap[s.sale_date].cash += Number(s.cash_amount || 0)
      dailyMap[s.sale_date].kaspi += Number(s.kaspi_amount || 0)
      dailyMap[s.sale_date].card += Number(s.card_amount || 0)
      dailyMap[s.sale_date].online += Number(s.online_amount || 0)
      dailyMap[s.sale_date].discount += Number(s.discount_amount || 0) + Number(s.loyalty_discount_amount || 0)
    }

    const daily = Object.values(dailyMap).map(d => ({
      ...d,
      total: Math.round(d.total),
      cash: Math.round(d.cash),
      kaspi: Math.round(d.kaspi),
      card: Math.round(d.card),
      online: Math.round(d.online),
      discount: Math.round(d.discount),
    }))

    const totals = {
      count: (sales || []).length,
      total: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0)),
      cash: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.cash_amount || 0), 0)),
      kaspi: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.kaspi_amount || 0), 0)),
      card: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.card_amount || 0), 0)),
      online: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.online_amount || 0), 0)),
      discount: Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.discount_amount || 0) + Number(r.loyalty_discount_amount || 0), 0)),
      avg_check: (sales || []).length > 0 ? Math.round((sales || []).reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0) / (sales || []).length) : 0,
    }

    return json({ ok: true, data: { daily, totals, year, month } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/reports/monthly.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
