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
        'id, company_id, customer_id, station_id, station_name_snapshot, booking_group_id, contact_phone, contact_name, tariff_id, starts_at, ends_at, status, notes, source, created_at, updated_at, customer:customer_id(id, name, phone)',
      )
      .order('starts_at', { ascending: false })
      .limit(200)

    if (status) query = query.eq('status', status)

    // Окно по датам: без него владелец видит последние двести броней вперемешку
    // за все месяцы, а спрашивает он обычно про конкретный день.
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from) query = query.gte('starts_at', from)
    if (to) query = query.lte('starts_at', to)

    // Только брони конкретных ПК: заявки из клиентского приложения без станции
    // живут своей жизнью и в зале не отображаются.
    if (url.searchParams.get('stations_only') === '1') {
      query = query.not('station_id', 'is', null)
    }
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: [] })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data || []).map((row: any) => {
      const customer = Array.isArray(row.customer) ? row.customer[0] || null : row.customer || null
      return {
        ...row,
        customer,
        // Телефон и имя берутся из брони, а карточка клиента подставляется
        // запасным вариантом: оператор бронирует по звонку, и человека в базе
        // может не быть вовсе.
        phone: row.contact_phone || customer?.phone || null,
        name: row.contact_name || customer?.name || null,
      }
    })

    // Компания на пять ПК — одна бронь, а не пять строк. В тетради так и было,
    // и в списке должно быть так же: иначе владелец увидит пять записей об
    // одном звонке и решит, что вечер загружен вдвое сильнее.
    const groups = new Map<string, any>()
    const singles: any[] = []

    for (const row of rows) {
      if (!row.booking_group_id) {
        singles.push({ ...row, stations: row.station_name_snapshot ? [row.station_name_snapshot] : [] })
        continue
      }
      const existing = groups.get(row.booking_group_id)
      if (existing) {
        if (row.station_name_snapshot) existing.stations.push(row.station_name_snapshot)
        existing.ids.push(row.id)
      } else {
        groups.set(row.booking_group_id, {
          ...row,
          ids: [row.id],
          stations: row.station_name_snapshot ? [row.station_name_snapshot] : [],
        })
      }
    }

    const merged = [...singles, ...groups.values()].sort((a, b) =>
      a.starts_at < b.starts_at ? 1 : -1,
    )

    return json({ ok: true, data: merged })
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

    // Изоляция: resolveCompanyScope с requestedCompanyId=null НЕ бросает, поэтому
    // бронь с company_id IS NULL проходила проверку молча — чужую бронь можно было
    // обновить и создать уведомление чужому клиенту. Нет точки → нет права.
    if (!existing.company_id) return json({ error: 'forbidden' }, 403)

    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: existing.company_id,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Полный набор точек организации — клиент может быть заведён на соседней точке.
    const orgScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Изоляция: клиент брони тоже обязан быть своим — в outbox ниже пишется
    // customer_id, а из customers читается email.
    if (!existing.customer_id) return json({ error: 'booking-customer-missing' }, 400)
    const { data: customerScopeRow, error: customerScopeError } = await supabase
      .from('customers')
      .select('id, company_id')
      .eq('id', existing.customer_id)
      .maybeSingle()
    if (customerScopeError) throw customerScopeError
    if (!customerScopeRow) return json({ error: 'booking-customer-missing' }, 404)
    if (
      orgScope.allowedCompanyIds &&
      !orgScope.allowedCompanyIds.includes(String((customerScopeRow as any).company_id || ''))
    ) {
      return json({ error: 'forbidden' }, 403)
    }

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
