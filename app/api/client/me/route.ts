import { NextResponse } from 'next/server'

import { getRequestCustomerContext } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    const { data, error } = await context.supabase
      .from('customers')
      .select('id, company_id, name, phone, card_number, email, notes, loyalty_points, total_spent, visits_count')
      .in('id', context.linkedCustomerIds)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })

    if (error) throw error

    return json({
      ok: true,
      persona: context.persona,
      customers: data || [],
      activeCustomer: (data || [])[0] || null,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'client-profile-fetch-failed' }, 500)
  }
}
