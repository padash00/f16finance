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
      .from('client_support_tickets')
      .select('id, customer_id, company_id, subject, message, status, priority, created_at, updated_at, resolved_at')
      .in('customer_id', context.linkedCustomerIds)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    return json({ ok: true, requests: data || [] })
  } catch (error: any) {
    return json({ error: error?.message || 'client-support-fetch-failed' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestCustomerContext(request)
    if ('response' in context) return context.response

    const body = (await request.json().catch(() => null)) as { message?: string } | null
    const message = String(body?.message || '').trim()

    if (!message) return json({ error: 'message-required' }, 400)
    if (message.length > 2000) return json({ error: 'message-too-long' }, 400)

    const targetCustomerId = context.linkedCustomerIds[0] || null
    if (!targetCustomerId) {
      return json({ error: 'customer-not-linked' }, 403)
    }

    const { data: customerRow, error: customerError } = await context.supabase
      .from('customers')
      .select('id, company_id')
      .eq('id', targetCustomerId)
      .maybeSingle()

    if (customerError) throw customerError
    if (!customerRow?.company_id) {
      return json({ error: 'customer-company-not-found' }, 400)
    }

    const { data: ticket, error: ticketError } = await context.supabase
      .from('client_support_tickets')
      .insert({
        customer_id: targetCustomerId,
        company_id: customerRow.company_id,
        message,
        status: 'new',
        priority: 'normal',
        created_by: context.user?.id || null,
      })
      .select('id, customer_id, company_id, message, status, priority, created_at')
      .single()

    if (ticketError) throw ticketError

    const { error: outboxError } = await context.supabase.from('client_notification_outbox').insert({
      customer_id: targetCustomerId,
      ticket_id: ticket.id,
      channel: 'in_app',
      status: 'pending',
      payload: {
        kind: 'client_support_created',
        ticketId: ticket.id,
      },
    })
    if (outboxError) throw outboxError

    return json({ ok: true, ticket })
  } catch (error: any) {
    return json({ error: error?.message || 'client-support-send-failed' }, 500)
  }
}
