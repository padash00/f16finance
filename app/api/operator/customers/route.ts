import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'

/**
 * Поиск клиента для веб-кассы оператора (лояльность). Скоуп по орг точки оператора.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const ctx = await requireOperator(request)
    if ('response' in ctx) return ctx.response
    const { supabase, companyId } = ctx

    const search = (new URL(request.url).searchParams.get('search') || '').trim().toLowerCase()
    const orgId = await resolveCompanyOrganizationId(supabase, companyId)

    let query = supabase
      .from('customers')
      .select('id, company_id, name, phone, card_number, loyalty_points, total_spent, visits_count, is_active')
      .eq('is_active', true)
      .order('total_spent', { ascending: false })
      .limit(200)
    if (orgId) query = query.eq('organization_id', orgId)

    const { data, error } = await query
    if (error) throw error

    let customers = (data || []) as any[]
    if (search) {
      customers = customers.filter(
        (c) =>
          c.name?.toLowerCase().includes(search) ||
          c.phone?.toLowerCase().includes(search) ||
          c.card_number?.toLowerCase().includes(search),
      )
    }
    return json({ ok: true, data: customers.slice(0, 20) })
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
