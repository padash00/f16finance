import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageClientFlow(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
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
      .from('client_bookings')
      .select(
        'id, company_id, customer_id, starts_at, ends_at, status, notes, source, created_at, updated_at, customer:customer_id(id, name, phone)',
      )
      .order('starts_at', { ascending: false })
      .limit(200)

    if (status) query = query.eq('status', status)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: [] })
      }
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
    return json({ error: error?.message || 'client-bookings-admin-fetch-failed' }, 500)
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
          bookingId?: string
          status?: 'requested' | 'confirmed' | 'cancelled' | 'completed' | 'rejected'
          notes?: string
        }
      | null

    if (body?.action !== 'setStatus' || !body.bookingId || !body.status) {
      return json({ error: 'invalid-payload' }, 400)
    }

    const { data: existing, error: existingError } = await supabase
      .from('client_bookings')
      .select('id, company_id, customer_id')
      .eq('id', body.bookingId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return json({ error: 'booking-not-found' }, 404)

    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: existing.company_id,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { data, error } = await supabase
      .from('client_bookings')
      .update({
        status: body.status,
        notes: body.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.bookingId)
      .select('id, company_id, customer_id, starts_at, ends_at, status, notes, source, created_at, updated_at')
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
        channel: 'in_app',
        status: 'pending',
        payload: {
          kind: 'booking_status_changed',
          bookingId: data.id,
          status: data.status,
          text: `Статус вашей брони обновлён: ${data.status}.`,
        },
      },
    ]

    const customerEmail = String(customerRow?.email || '').trim()
    if (customerEmail) {
      outboxRows.push({
        customer_id: existing.customer_id,
        channel: 'email',
        status: 'pending',
        payload: {
          kind: 'booking_status_changed',
          bookingId: data.id,
          status: data.status,
          email: customerEmail,
          text: `Статус вашей брони обновлён: ${data.status}.`,
        },
      })
    }

    const { error: outboxError } = await supabase.from('client_notification_outbox').insert(outboxRows)
    if (outboxError) throw outboxError

    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: error?.message || 'client-bookings-admin-update-failed' }, 500)
  }
}
