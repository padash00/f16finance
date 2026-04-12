import { NextResponse } from 'next/server'

import { resolveLinkedCustomerForWrite } from '@/lib/server/linked-customers'
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

    const body = (await request.json().catch(() => null)) as { message?: string; companyId?: string | null } | null
    const message = String(body?.message || '').trim()

    if (!message) return json({ error: 'message-required' }, 400)
    if (message.length > 2000) return json({ error: 'message-too-long' }, 400)

    const resolved = resolveLinkedCustomerForWrite(context.linkedCustomers, body?.companyId ?? null)
    if (!resolved.ok) {
      return json({ error: resolved.error }, 400)
    }

    const { data: ticket, error: ticketError } = await context.supabase
      .from('client_support_tickets')
      .insert({
        customer_id: resolved.customerId,
        company_id: resolved.companyId,
        message,
        status: 'new',
        priority: 'normal',
        created_by: context.user?.id || null,
      })
      .select('id, customer_id, company_id, message, status, priority, created_at')
      .single()

    if (ticketError) throw ticketError

    const { error: outboxError } = await context.supabase.from('client_notification_outbox').insert({
      customer_id: resolved.customerId,
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
