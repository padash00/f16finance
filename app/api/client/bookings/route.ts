import { NextResponse } from 'next/server'

import { assertArenaStationForCompanyBooking } from '@/lib/server/client-arena-station'
import { resolveLinkedCustomerForWrite } from '@/lib/server/linked-customers'
import { getRequestCustomerContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

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
    const filterCompanyId = url.searchParams.get('companyId')?.trim() || null
    if (filterCompanyId && !context.linkedCompanyIds.includes(filterCompanyId)) {
      return json({ error: 'company-not-in-profile' }, 400)
    }

    let query = context.supabase
      .from('client_bookings')
      .select('id, company_id, customer_id, starts_at, ends_at, status, notes, source, arena_station_id, created_at, updated_at')
      .in('customer_id', context.linkedCustomerIds)
      .order('starts_at', { ascending: false })
      .limit(limit)

    if (filterCompanyId) {
      query = query.eq('company_id', filterCompanyId)
    } else if (context.linkedCompanyIds.length) {
      query = query.in('company_id', context.linkedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = data || []
    const stationIds = [...new Set(rows.map((r: any) => r.arena_station_id).filter(Boolean))] as string[]
    let stationNames: Record<string, string> = {}
    if (stationIds.length && hasAdminSupabaseCredentials()) {
      const admin = createAdminSupabaseClient()
      const { data: stRows } = await admin.from('arena_stations').select('id, name').in('id', stationIds)
      stationNames = Object.fromEntries((stRows || []).map((s: any) => [String(s.id), String(s.name || 'Станция')]))
    }

    const bookings = rows.map((r: any) => ({
      ...r,
      station_name: r.arena_station_id ? stationNames[String(r.arena_station_id)] || null : null,
    }))

    return json({ ok: true, bookings })
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
          /** К какой точке (компании) привязать бронь, если у аккаунта несколько `customers` по сети */
          companyId?: string | null
          /** Опционально: станция арены (ПК) из схемы клуба */
          arenaStationId?: string | null
        }
      | null

    const startsAtRaw = String(body?.startsAt || '').trim()
    if (!startsAtRaw) return json({ error: 'startsAt-required' }, 400)

    const startsAt = new Date(startsAtRaw)
    if (Number.isNaN(startsAt.getTime())) return json({ error: 'startsAt-invalid' }, 400)

    const endsAtRaw = String(body?.endsAt || '').trim()
    const endsAt = endsAtRaw ? new Date(endsAtRaw) : null
    if (endsAt && Number.isNaN(endsAt.getTime())) return json({ error: 'endsAt-invalid' }, 400)

    const resolved = resolveLinkedCustomerForWrite(context.linkedCustomers, body?.companyId ?? null)
    if (!resolved.ok) {
      return json({ error: resolved.error }, 400)
    }

    const stationRaw = String(body?.arenaStationId || '').trim()
    let arenaStationId: string | null = null
    if (stationRaw) {
      if (!hasAdminSupabaseCredentials()) {
        return json({ error: 'client-api-requires-admin-credentials' }, 503)
      }
      const check = await assertArenaStationForCompanyBooking(createAdminSupabaseClient(), stationRaw, resolved.companyId)
      if (!check.ok) {
        return json({ error: check.error }, 400)
      }
      arenaStationId = stationRaw
    }

    const { data, error } = await context.supabase
      .from('client_bookings')
      .insert({
        customer_id: resolved.customerId,
        company_id: resolved.companyId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        status: 'requested',
        notes: String(body?.notes || '').trim() || null,
        source: 'client_app',
        created_by: context.user?.id || null,
        arena_station_id: arenaStationId,
      })
      .select('id, company_id, customer_id, starts_at, ends_at, status, notes, source, arena_station_id, created_at, updated_at')
      .single()

    if (error) throw error
    return json({ ok: true, booking: data }, 201)
  } catch (error: any) {
    return json({ error: error?.message || 'client-bookings-create-failed' }, 500)
  }
}
