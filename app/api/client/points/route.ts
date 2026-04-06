import { NextResponse } from 'next/server'

import { getRequestCustomerContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'client-api-requires-admin-credentials' }, 503)
    }

    const supabase = createAdminSupabaseClient()

    const [{ data: customerRows, error: customerError }, { data: salesRows, error: salesError }] = await Promise.all([
      supabase
        .from('customers')
        .select('id, loyalty_points, total_spent, visits_count')
        .in('id', context.linkedCustomerIds)
        .eq('is_active', true),
      supabase
        .from('point_sales')
        .select('id, customer_id, sale_date, loyalty_points_earned, loyalty_points_spent, total_amount')
        .in('customer_id', context.linkedCustomerIds)
        .order('sale_date', { ascending: false })
        .limit(50),
    ])

    if (customerError) throw customerError
    if (salesError) throw salesError

    const totals = (customerRows || []).reduce(
      (acc, row: any) => {
        acc.points += Number(row?.loyalty_points || 0)
        acc.totalSpent += Number(row?.total_spent || 0)
        acc.visits += Number(row?.visits_count || 0)
        return acc
      },
      { points: 0, totalSpent: 0, visits: 0 },
    )

    return json({
      ok: true,
      summary: totals,
      history: salesRows || [],
    })
  } catch (error: any) {
    return json({ error: error?.message || 'client-points-fetch-failed' }, 500)
  }
}
