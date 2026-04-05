import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const ctx = await requirePointDevice(req)
    if ('response' in ctx) return ctx.response

    const { supabase, device } = ctx
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()

    if (!q || q.length < 2) {
      return json({ ok: true, data: [] })
    }

    const companyId = device.company_id

    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, name, phone, card_number, loyalty_points, total_spent, visits_count')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%,card_number.ilike.%${q}%`)
      .order('total_spent', { ascending: false })
      .limit(5)

    if (error) throw error

    const { data: loyaltyConfig } = await supabase
      .from('loyalty_config')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()

    return json({ ok: true, data: customers || [], loyalty_config: loyaltyConfig || null })
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePointDevice(req)
    if ('response' in ctx) return ctx.response

    const { supabase, device } = ctx
    const body = (await req.json().catch(() => null)) as any
    if (!body?.action) return json({ error: 'missing action' }, 400)

    if (body.action === 'recordSaleWithCustomer') {
      const { customer_id, sale_total_amount, loyalty_points_spent } = body
      if (!customer_id) return json({ error: 'customer_id required' }, 400)
      if (typeof sale_total_amount !== 'number' || sale_total_amount <= 0) {
        return json({ error: 'sale_total_amount must be positive number' }, 400)
      }

      const companyId = device.company_id

      // Get loyalty config
      const { data: loyaltyConfig } = await supabase
        .from('loyalty_config')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()

      // Get current customer
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('id, loyalty_points, total_spent, visits_count')
        .eq('id', customer_id)
        .eq('company_id', companyId)
        .single()

      if (customerError || !customer) {
        return json({ error: 'customer not found' }, 404)
      }

      // Calculate points earned
      const pointsPerHundred = loyaltyConfig?.points_per_100_tenge ?? 1
      const pointsEarned = Math.floor((sale_total_amount / 100) * pointsPerHundred)

      // Calculate points spent (validated)
      const pointsSpent = Math.max(0, Math.min(loyalty_points_spent || 0, customer.loyalty_points))

      // Update customer
      const newPoints = Math.max(0, (customer.loyalty_points || 0) + pointsEarned - pointsSpent)
      const newTotalSpent = (Number(customer.total_spent) || 0) + sale_total_amount
      const newVisits = (customer.visits_count || 0) + 1

      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({
          loyalty_points: newPoints,
          total_spent: newTotalSpent,
          visits_count: newVisits,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customer_id)
        .select()
        .single()

      if (updateError) throw updateError

      return json({
        ok: true,
        data: {
          customer: updatedCustomer,
          points_earned: pointsEarned,
          points_spent: pointsSpent,
        },
      })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
