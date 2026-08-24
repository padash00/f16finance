/**
 * «Этот номер уже звонил» — поиск человека по телефону.
 *
 * Оператор набирает номер во время звонка, и ещё до создания брони видит: имя,
 * сколько раз бронировал, сколько раз не пришёл. Последнее важнее всего —
 * человек, который трижды забронировал и трижды не появился, заслуживает
 * другого разговора.
 *
 * Ничего не создаёт и не меняет. Только читает.
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { normalizePhone } from '@/app/api/point/bookings/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const companyId = device.company_id
    if (!companyId) return json({ error: 'no-company' }, 400)

    const url = new URL(request.url)
    const phone = normalizePhone(url.searchParams.get('phone'))
    if (!phone) return json({ error: 'phone-required' }, 400)

    // Карточка клиента, если такой номер заводили.
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, phone, created_at')
      .eq('company_id', companyId)
      .eq('phone', phone)
      .maybeSingle()

    // История броней по номеру — независимо от того, есть карточка или нет.
    // Человек мог звонить пять раз, ни разу не зарегистрировавшись.
    const { data: history } = await supabase
      .from('client_bookings')
      .select('id, station_name_snapshot, starts_at, ends_at, status, contact_name, created_at')
      .eq('company_id', companyId)
      .eq('contact_phone', phone)
      .order('starts_at', { ascending: false })
      .limit(20)

    const rows = (history || []) as any[]
    // `expired` — время прошло; `completed` — состоялась по наблюдению. Для
    // оператора это одно и то же: вечер позади. Разделение важно там, где
    // считают явку, а здесь важно «сколько раз этот человек уже бронировал».
    const completed = rows.filter((r) => r.status === 'completed' || r.status === 'expired').length
    const cancelled = rows.filter((r) => r.status === 'cancelled').length

    // Имя берём из карточки, а если её нет — из последней брони: человек его
    // называл, и переспрашивать каждый раз невежливо.
    const name =
      (customer?.name ? String(customer.name) : null) ||
      (rows.find((r) => r.contact_name)?.contact_name ?? null)

    return json({
      ok: true,
      phone,
      known: Boolean(customer) || rows.length > 0,
      name,
      customer: customer
        ? { id: String(customer.id), name: customer.name ?? null, since: customer.created_at }
        : null,
      stats: {
        total: rows.length,
        completed,
        cancelled,
      },
      history: rows.slice(0, 8).map((r) => ({
        id: String(r.id),
        stationName: r.station_name_snapshot ?? null,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        status: r.status,
      })),
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/bookings/lookup GET',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
