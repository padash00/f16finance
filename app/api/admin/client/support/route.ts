import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageClientFlow(access: { isSuperAdmin: boolean; staffRole: 'manager' | 'marketer' | 'owner' | 'other' }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageClientFlow(access)) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')
    const status = url.searchParams.get('status')
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('client_support_tickets')
      .select(
        'id, customer_id, company_id, subject, message, status, priority, created_by, assigned_staff_id, resolved_at, created_at, updated_at, customer:customer_id(id, name, phone)',
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (status) query = query.eq('status', status)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) return json({ ok: true, data: [] })
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data || []).map((row: any) => ({
      ...row,
      customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer || null,
    }))
    return json({ ok: true, data: rows })
  } catch (error: any) {
    return json({ error: error?.message || 'client-support-admin-fetch-failed' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageClientFlow(access)) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const body = (await request.json().catch(() => null)) as
      | {
          action?: 'setStatus'
          ticketId?: string
          status?: 'new' | 'in_progress' | 'resolved' | 'closed'
          priority?: 'low' | 'normal' | 'high' | 'urgent'
          assignedStaffId?: string | null
        }
      | null

    if (body?.action !== 'setStatus' || !body.ticketId || !body.status) {
      return json({ error: 'invalid-payload' }, 400)
    }

    const { data: existing, error: existingError } = await supabase
      .from('client_support_tickets')
      .select('id, company_id, customer_id')
      .eq('id', body.ticketId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return json({ error: 'ticket-not-found' }, 404)

    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: existing.company_id,
      isSuperAdmin: access.isSuperAdmin,
    })

    const isResolved = body.status === 'resolved' || body.status === 'closed'
    const { data, error } = await supabase
      .from('client_support_tickets')
      .update({
        status: body.status,
        priority: body.priority || 'normal',
        assigned_staff_id: body.assignedStaffId || null,
        resolved_at: isResolved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.ticketId)
      .select('id, customer_id, company_id, status, priority, assigned_staff_id, resolved_at, created_at, updated_at')
      .single()

    if (error) throw error

    const { data: customerRow, error: customerError } = await supabase
      .from('customers')
      .select('email')
      .eq('id', existing.customer_id)
      .maybeSingle()
    if (customerError) throw customerError

    const outboxRows: Array<Record<string, unknown>> = [
      {
        customer_id: existing.customer_id,
        ticket_id: data.id,
        channel: 'in_app',
        status: 'pending',
        payload: {
          kind: 'ticket_status_changed',
          ticketId: data.id,
          status: data.status,
          priority: data.priority,
          text: `Статус обращения обновлён: ${data.status}.`,
        },
      },
    ]

    const customerEmail = String(customerRow?.email || '').trim()
    if (customerEmail) {
      outboxRows.push({
        customer_id: existing.customer_id,
        ticket_id: data.id,
        channel: 'email',
        status: 'pending',
        payload: {
          kind: 'ticket_status_changed',
          ticketId: data.id,
          status: data.status,
          priority: data.priority,
          email: customerEmail,
          text: `Статус обращения обновлён: ${data.status}.`,
        },
      })
    }

    const { error: outboxError } = await supabase.from('client_notification_outbox').insert(outboxRows)
    if (outboxError) throw outboxError

    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: error?.message || 'client-support-admin-update-failed' }, 500)
  }
}
