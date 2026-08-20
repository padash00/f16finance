/**
 * Бронирование станций оператором.
 *
 * ГЛАВНОЕ ПРАВИЛО: бронь НЕ запускает сессию.
 *
 * Бронь — обещание на будущее, сессия — факт использования сейчас. Если одно
 * начнёт порождать другое, в отчётах появятся часы, которых не было: человек
 * забронировал и не пришёл, а система записала занятость.
 *
 * Поэтому здесь нет ни строчки про `arena_sessions`, ни обращения к SENET, ни
 * изменения состояния станции. Бронь живёт своей таблицей и влияет только на
 * то, что видит оператор на карте.
 *
 * Телефон — главный признак человека. Оператору звонят люди, которых в базе
 * нет, и требовать заранее заведённую карточку значило бы мешать работе. Если
 * номер уже известен, карточка подцепляется, и оператор сразу видит историю.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { requireCurrentOpenShiftId } from '@/lib/server/point-shifts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Приводит телефон к виду, по которому его можно искать.
 *
 * Один и тот же номер люди диктуют как +7 777 123-45-67, 87771234567 и
 * 8 (777) 123 45 67. Без нормализации «этот номер уже звонил» не сработает
 * никогда, и вся ценность истории пропадёт.
 *
 * Казахстанские номера приводим к виду 77XXXXXXXXX: ведущая восьмёрка
 * заменяется семёркой, потому что это одна и та же страна.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1)
  if (digits.length === 10) return '7' + digits
  return digits
}

const CreateBody = z.object({
  action: z.literal('create'),
  stationId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  phone: z.string().min(5).max(32),
  name: z.string().max(120).optional().nullable(),
  tariffId: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
})

const CancelBody = z.object({
  action: z.literal('cancel'),
  bookingId: z.string().uuid(),
  reason: z.string().max(300).optional().nullable(),
})

const Body = z.discriminatedUnion('action', [CreateBody, CancelBody])

/**
 * Брони точки на выбранный день.
 *
 * День берётся по локальному времени оператора: смена работает сутками, и
 * «сегодня» для него — это не UTC-сутки.
 */
export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const url = new URL(request.url)

    // В арене проект точки — это идентификатор самого устройства: так
    // устроены существующие маршруты, и отступать от их соглашения нельзя,
    // иначе брони окажутся в другом проекте, чем станции.
    const projectId = device.id
    if (!projectId) return json({ error: 'no-project' }, 400)

    // Окно по умолчанию — от текущего момента и на сутки вперёд: оператору
    // важно, что будет, а не что было.
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    const from = fromParam ? new Date(fromParam) : new Date()
    const to = toParam ? new Date(toParam) : new Date(from.getTime() + 24 * 60 * 60 * 1000)

    const { data, error } = await supabase
      .from('client_bookings')
      .select('id, station_id, station_name_snapshot, starts_at, ends_at, status, contact_phone, contact_name, customer_id, tariff_id, notes, created_at')
      .eq('point_project_id', projectId)
      .not('station_id', 'is', null)
      .in('status', ['requested', 'confirmed'])
      .gte('ends_at', from.toISOString())
      .lte('starts_at', to.toISOString())
      .order('starts_at')

    if (error) throw error

    return json({
      ok: true,
      serverTime: new Date().toISOString(),
      bookings: (data || []).map((row: any) => ({
        id: String(row.id),
        stationId: row.station_id ? String(row.station_id) : null,
        stationName: row.station_name_snapshot ?? null,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        phone: row.contact_phone ?? null,
        name: row.contact_name ?? null,
        customerId: row.customer_id ? String(row.customer_id) : null,
        tariffId: row.tariff_id ? String(row.tariff_id) : null,
        notes: row.notes ?? null,
      })),
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/bookings GET',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const projectId = device.id
    const companyId = device.company_id
    if (!projectId || !companyId) return json({ error: 'no-project' }, 400)

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'invalid-payload', details: parsed.error.flatten() }, 400)

    const body = parsed.data

    // ── Отмена ────────────────────────────────────────────────────────────
    if (body.action === 'cancel') {
      const { data: booking } = await supabase
        .from('client_bookings')
        .select('id, point_project_id, status')
        .eq('id', body.bookingId)
        .maybeSingle()
      if (!booking) return json({ error: 'booking-not-found' }, 404)

      // Чужую точку не трогаем даже по прямому запросу.
      if (String(booking.point_project_id) !== String(projectId)) {
        return json({ error: 'forbidden' }, 403)
      }

      const { error } = await supabase
        .from('client_bookings')
        .update({
          status: 'cancelled',
          notes: body.reason || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id)
      if (error) throw error

      return json({ ok: true, status: 'cancelled' })
    }

    // ── Создание ──────────────────────────────────────────────────────────
    const startsAt = new Date(body.startsAt)
    const endsAt = new Date(body.endsAt)

    if (!(endsAt > startsAt)) {
      return json({ error: 'invalid-window', message: 'Конец брони должен быть позже начала.' }, 400)
    }

    // Станция обязана принадлежать этой точке.
    const { data: station } = await supabase
      .from('arena_stations')
      .select('id, name, point_project_id, company_id, is_active')
      .eq('id', body.stationId)
      .maybeSingle()
    if (!station) return json({ error: 'station-not-found' }, 404)
    if (String(station.point_project_id) !== String(projectId)) {
      return json({ error: 'forbidden', message: 'Станция принадлежит другой точке.' }, 403)
    }
    if (!station.is_active) {
      return json({ error: 'station-inactive', message: 'Станция выключена — бронировать нечего.' }, 409)
    }

    // ── Пересечения ───────────────────────────────────────────────────────
    // Две брони на одну станцию в одно время — это обещание, которое нельзя
    // сдержать. Проверка идёт в коде, потому что запрет на уровне базы требует
    // включения расширения btree_gist, а это решение владельца, а не миграции.
    const { data: overlaps } = await supabase
      .from('client_bookings')
      .select('id, starts_at, ends_at, contact_name, contact_phone')
      .eq('station_id', station.id)
      .in('status', ['requested', 'confirmed'])
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())

    if (overlaps && overlaps.length > 0) {
      const clash = overlaps[0] as any
      return json(
        {
          error: 'booking-overlap',
          message: `Станция уже забронирована с ${new Date(clash.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} до ${new Date(clash.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`,
          conflict: {
            id: String(clash.id),
            startsAt: clash.starts_at,
            endsAt: clash.ends_at,
            name: clash.contact_name ?? null,
          },
        },
        409,
      )
    }

    // ── Кто бронирует ─────────────────────────────────────────────────────
    // Ищем номер среди известных клиентов. Не нашли — не беда: бронь всё
    // равно создаётся, телефон остаётся сам по себе.
    const phone = normalizePhone(body.phone)
    let customerId: string | null = null
    let knownName: string | null = null

    if (phone) {
      const { data: customer } = await supabase
        .from('customers')
        .select('id, full_name, phone')
        .eq('company_id', companyId)
        .eq('phone', phone)
        .maybeSingle()
      if (customer) {
        customerId = String(customer.id)
        knownName = customer.full_name ? String(customer.full_name) : null
      }
    }

    // Смена нужна, чтобы потом понимать, кто заводил бронь. Если смена не
    // открыта, бронь всё равно создаётся: отказать оператору из-за этого
    // значило бы потерять клиента на телефоне.
    let shiftId: string | null = null
    try {
      const shift = await requireCurrentOpenShiftId(supabase as any, device as any)
      shiftId = typeof shift === 'string' ? shift : null
    } catch {
      shiftId = null
    }

    const { data: created, error } = await supabase
      .from('client_bookings')
      .insert([
        {
          customer_id: customerId,
          company_id: companyId,
          point_project_id: projectId,
          station_id: station.id,
          station_name_snapshot: String(station.name),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: 'confirmed',
          contact_phone: phone,
          contact_name: body.name || knownName,
          tariff_id: body.tariffId || null,
          notes: body.notes || null,
          source: 'operator',
          // Кто именно из операторов завёл бронь, устройство не знает: оно
          // общее на точку. Ответственность привязывается через смену.
          created_by_operator_id: null,
          shift_id: shiftId,
        },
      ])
      .select('id')
      .single()

    if (error) throw error

    return json(
      {
        ok: true,
        bookingId: String(created.id),
        stationName: String(station.name),
        // Оператору полезно сразу узнать, что человек уже бывал.
        knownCustomer: customerId ? { id: customerId, name: knownName } : null,
      },
      201,
    )
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/bookings POST',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
