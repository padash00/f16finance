import { NextResponse } from 'next/server'

import { getRequestCustomerContext } from '@/lib/server/request-auth'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    const url = new URL(request.url)
    const limitRaw = Number(url.searchParams.get('limit') || 20)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20

    let query = context.supabase
      .from('client_bookings')
      .select('id, company_id, customer_id, starts_at, ends_at, status, notes, source, created_at, updated_at')
      .in('customer_id', context.linkedCustomerIds)
      .order('starts_at', { ascending: false })
      .limit(limit)

    if (context.linkedCompanyIds.length) {
      query = query.in('company_id', context.linkedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ ok: true, bookings: data || [] })
  } catch (error: any) {
    return json({ error: error?.message || 'client-bookings-fetch-failed' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    const body = (await request.json().catch(() => null)) as
      | {
          startsAt?: string
          endsAt?: string | null
          notes?: string
        }
      | null

    const startsAtRaw = String(body?.startsAt || '').trim()
    if (!startsAtRaw) return json({ error: 'startsAt-required' }, 400)

    const startsAt = new Date(startsAtRaw)
    if (Number.isNaN(startsAt.getTime())) return json({ error: 'startsAt-invalid' }, 400)

    const endsAtRaw = String(body?.endsAt || '').trim()
    const endsAt = endsAtRaw ? new Date(endsAtRaw) : null
    if (endsAt && Number.isNaN(endsAt.getTime())) return json({ error: 'endsAt-invalid' }, 400)

    const targetCustomerId = context.linkedCustomerIds[0] || null
    if (!targetCustomerId) return json({ error: 'customer-not-linked' }, 403)

    const { data: customerRow, error: customerError } = await context.supabase
      .from('customers')
      .select('id, company_id')
      .eq('id', targetCustomerId)
      .maybeSingle()

    if (customerError) throw customerError
    if (!customerRow?.company_id) return json({ error: 'customer-company-not-found' }, 400)

    const { data, error } = await context.supabase
      .from('client_bookings')
      .insert({
        customer_id: targetCustomerId,
        company_id: customerRow.company_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        status: 'requested',
        notes: String(body?.notes || '').trim() || null,
        source: 'client_app',
        created_by: context.user?.id || null,
      })
      .select('id, company_id, customer_id, starts_at, ends_at, status, notes, source, created_at, updated_at')
      .single()

    if (error) throw error
    return json({ ok: true, booking: data }, 201)
  } catch (error: any) {
    return json({ error: error?.message || 'client-bookings-create-failed' }, 500)
  }
}
