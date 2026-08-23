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

import { checkBookingHorizon, horizonRefusalText, operationalDayEnd } from '@/lib/core/booking-horizon'
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
  /**
   * Станции компании.
   *
   * В тетради компания на пять мест была одной записью. Здесь строк по-прежнему
   * пять — иначе не проверить пересечения и не отменить один ПК из пяти, — но
   * у них общая группа, и оператор видит их как одну бронь.
   */
  stationIds: z.array(z.string().uuid()).min(1).max(40),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  phone: z.string().min(5).max(32),
  name: z.string().max(120).optional().nullable(),
  tariffId: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /**
   * Забронировать свободные, а занятые пропустить.
   *
   * Без этого компания на десять машин упирается в отказ целиком из-за одного
   * занятого ПК, и оператор набирает список заново, держа человека на линии.
   * Флаг ставится вторым нажатием, после того как сервер назвал занятые.
   */
  skipBusy: z.boolean().optional(),
})

const CancelBody = z.object({
  action: z.literal('cancel'),
  bookingId: z.string().uuid(),
  /** Отменить всю компанию, а не один ПК из неё. */
  wholeGroup: z.boolean().optional(),
  reason: z.string().max(300).optional().nullable(),
})

/**
 * Перенос и продление.
 *
 * «Давайте не на девять, а на десять» — самая частая правка, и до сих пор она
 * означала отменить бронь и завести заново: заново продиктовать телефон, имя,
 * набрать те же пять машин. Компания переносится целиком: она пришла вместе и
 * сядет вместе.
 */
const RescheduleBody = z.object({
  action: z.literal('reschedule'),
  bookingId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
})

const Body = z.discriminatedUnion('action', [CreateBody, CancelBody, RescheduleBody])

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
      .select('id, station_id, station_name_snapshot, booking_group_id, starts_at, ends_at, status, contact_phone, contact_name, customer_id, tariff_id, notes, created_at')
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
      // Докуда этой смене разрешено бронировать. Интерфейс подставит это в
      // выбор времени, чтобы оператор не упирался в отказ вслепую.
      horizonEnd: operationalDayEnd(new Date()).toISOString(),
      bookings: (data || []).map((row: any) => ({
        id: String(row.id),
        stationId: row.station_id ? String(row.station_id) : null,
        stationName: row.station_name_snapshot ?? null,
        groupId: row.booking_group_id ? String(row.booking_group_id) : null,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        phone: row.contact_phone ?? null,
        name: row.contact_name ?? null,
        customerId: row.customer_id ? String(row.customer_id) : null,
        tariffId: row.tariff_id ? String(row.tariff_id) : null,
        notes: row.notes ?? null,
        createdAt: row.created_at,
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
        .select('id, point_project_id, status, booking_group_id')
        .eq('id', body.bookingId)
        .maybeSingle()
      if (!booking) return json({ error: 'booking-not-found' }, 404)

      // Чужую точку не трогаем даже по прямому запросу.
      if (String(booking.point_project_id) !== String(projectId)) {
        return json({ error: 'forbidden' }, 403)
      }

      // Причина отмены живёт в своём поле. Раньше она писалась в notes и
      // затирала заметку с бронирования: «просил место у окна» превращалось в
      // «передумал». Это разные разговоры, и хранить их в одном поле нельзя.
      const patch = {
        status: 'cancelled',
        cancel_reason: body.reason?.trim() || null,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      // Компания звонит и отменяет целиком — это один разговор, а не пять.
      // Но отменить один ПК из пяти тоже должно быть можно: часть компании
      // передумала, остальные придут.
      const wholeGroup = Boolean(body.wholeGroup && booking.booking_group_id)

      let query = supabase.from('client_bookings').update(patch)
      query = wholeGroup
        ? query.eq('booking_group_id', booking.booking_group_id)
        : query.eq('id', booking.id)

      // Уже отменённые и состоявшиеся не трогаем: иначе повторное нажатие
      // перепишет время отмены и причину, и станет непонятно, когда это
      // случилось на самом деле.
      const { data: cancelled, error } = await query
        .in('status', ['requested', 'confirmed'])
        .select('id, station_name_snapshot')

      if (error) throw error

      return json({
        ok: true,
        status: 'cancelled',
        wholeGroup,
        cancelledCount: (cancelled || []).length,
        stationNames: (cancelled || []).map((r: any) => r.station_name_snapshot).filter(Boolean),
      })
    }

    // ── Перенос и продление ───────────────────────────────────────────────
    if (body.action === 'reschedule') {
      const { data: booking } = await supabase
        .from('client_bookings')
        .select('id, point_project_id, status, booking_group_id, station_id')
        .eq('id', body.bookingId)
        .maybeSingle()
      if (!booking) return json({ error: 'booking-not-found' }, 404)
      if (String(booking.point_project_id) !== String(projectId)) {
        return json({ error: 'forbidden' }, 403)
      }
      if (!['requested', 'confirmed'].includes(String(booking.status))) {
        return json({ error: 'booking-not-active', message: 'Эту бронь уже сняли — перенести нечего.' }, 409)
      }

      const newStart = new Date(body.startsAt)
      const newEnd = new Date(body.endsAt)
      if (!(newEnd > newStart)) {
        return json({ error: 'invalid-window', message: 'Конец брони должен быть позже начала.' }, 400)
      }

      const horizon = checkBookingHorizon(newStart, newEnd, new Date())
      if (!horizon.ok) {
        return json(
          {
            error: 'beyond-horizon',
            message: horizonRefusalText(horizon),
            horizonEnd: horizon.horizonEnd.toISOString(),
          },
          409,
        )
      }

      // Вся компания переносится вместе: одна бронь — одно время.
      const { data: siblings } = booking.booking_group_id
        ? await supabase
            .from('client_bookings')
            .select('id, station_id, station_name_snapshot')
            .eq('booking_group_id', booking.booking_group_id)
            .eq('point_project_id', projectId)
            .in('status', ['requested', 'confirmed'])
        : { data: [{ id: booking.id, station_id: booking.station_id, station_name_snapshot: null }] }

      const movingRows = (siblings || []) as any[]
      const movingIds = movingRows.map((r) => String(r.id))
      const movingStationIds = movingRows.map((r) => String(r.station_id)).filter(Boolean)

      // Новое время не должно наехать на чужую бронь. Свои же строки из
      // проверки исключаем: бронь всегда пересекается сама с собой.
      const { data: clashes } = await supabase
        .from('client_bookings')
        .select('id, station_id, station_name_snapshot, ends_at')
        .in('station_id', movingStationIds)
        .in('status', ['requested', 'confirmed'])
        .lt('starts_at', newEnd.toISOString())
        .gt('ends_at', newStart.toISOString())

      const foreign = ((clashes || []) as any[]).filter((c) => !movingIds.includes(String(c.id)))
      if (foreign.length > 0) {
        const busyNames = foreign.map((c) => c.station_name_snapshot).filter(Boolean).join(', ')
        return json(
          {
            error: 'booking-overlap',
            message:
              'На это время уже занято: ' +
              (busyNames || 'другая бронь') +
              '. Освободится в ' +
              new Date(foreign[0].ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
              '.',
          },
          409,
        )
      }

      const { data: moved, error: moveError } = await supabase
        .from('client_bookings')
        .update({
          starts_at: newStart.toISOString(),
          ends_at: newEnd.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in('id', movingIds)
        .select('id, station_name_snapshot')
      if (moveError) throw moveError

      return json({
        ok: true,
        movedCount: (moved || []).length,
        stationNames: (moved || []).map((r: any) => r.station_name_snapshot).filter(Boolean),
      })
    }

    // ── Создание ──────────────────────────────────────────────────────────
    const startsAt = new Date(body.startsAt)
    const endsAt = new Date(body.endsAt)

    if (!(endsAt > startsAt)) {
      return json({ error: 'invalid-window', message: 'Конец брони должен быть позже начала.' }, 400)
    }

    // Горизонт: не дальше конца текущих операционных суток.
    //
    // Дневная смена вправе занять и ночь — ночь входит в те же сутки. Ночная
    // упирается в утро: следующий день принадлежит другим людям, и раздавать
    // за них обязательства нельзя. Проверка стоит на сервере, потому что
    // интерфейс можно обойти, а обещание клиенту — нет.
    const horizon = checkBookingHorizon(startsAt, endsAt, new Date())
    if (!horizon.ok) {
      return json(
        {
          error: 'beyond-horizon',
          message: horizonRefusalText(horizon),
          horizonEnd: horizon.horizonEnd.toISOString(),
        },
        409,
      )
    }

    // Станции обязаны принадлежать этой точке.
    const stationIds = [...new Set(body.stationIds)]
    const { data: stations } = await supabase
      .from('arena_stations')
      .select('id, name, point_project_id, company_id, is_active')
      .in('id', stationIds)

    const found = (stations || []) as any[]
    if (found.length !== stationIds.length) {
      return json({ error: 'station-not-found' }, 404)
    }
    for (const st of found) {
      if (String(st.point_project_id) !== String(projectId)) {
        return json({ error: 'forbidden', message: 'Станция принадлежит другой точке.' }, 403)
      }
      if (!st.is_active) {
        return json(
          { error: 'station-inactive', message: 'Станция ' + st.name + ' выключена — бронировать нечего.' },
          409,
        )
      }
    }

    // ── Пересечения ───────────────────────────────────────────────────────
    // Две брони на одну станцию в одно время — это обещание, которое нельзя
    // сдержать. Проверка идёт в коде, потому что запрет на уровне базы требует
    // включения расширения btree_gist, а это решение владельца, а не миграции.
    const { data: overlaps } = await supabase
      .from('client_bookings')
      .select('id, station_id, starts_at, ends_at, contact_name')
      .in('station_id', stationIds)
      .in('status', ['requested', 'confirmed'])
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())

    const busyIds = new Set((overlaps || []).map((o: any) => String(o.station_id)))
    const busyStations = found.filter((st) => busyIds.has(String(st.id)))
    const free = found.filter((st) => !busyIds.has(String(st.id)))

    if (busyStations.length > 0 && !body.skipBusy) {
      // Называем конкретные ПК: «что-то занято» бесполезно, когда оператор
      // держит клиента на линии и выбирает из пяти машин.
      //
      // И сразу говорим, сколько остаётся свободных: компания на десять машин
      // обычно согласна на восемь, а собирать список заново — это те же
      // полминуты молчания в трубку, от которых уходим.
      const clash = overlaps![0] as any
      const busyNames = busyStations.map((st) => String(st.name)).join(', ')
      return json(
        {
          error: 'booking-overlap',
          message:
            'Уже забронировано: ' +
            busyNames +
            '. Освободится в ' +
            new Date(clash.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
            '.',
          busyStations: busyNames,
          busyStationIds: busyStations.map((st) => String(st.id)),
          freeCount: free.length,
        },
        409,
      )
    }

    // Занятые пропускаем — но если свободных не осталось, бронировать нечего.
    const bookable = body.skipBusy ? free : found
    if (bookable.length === 0) {
      return json(
        {
          error: 'booking-overlap',
          message: 'Все выбранные ПК заняты на это время.',
          busyStations: busyStations.map((st) => String(st.name)).join(', '),
          busyStationIds: busyStations.map((st) => String(st.id)),
          freeCount: 0,
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

    // Компания получает общий признак группы. Строк по-прежнему по одной на
    // станцию — иначе не отменить один ПК из пяти и не проверить пересечения,
    // — но в списке это будет одна бронь, как строка в тетради.
    const groupId = bookable.length > 1 ? crypto.randomUUID() : null

    const rows = bookable.map((st) => ({
      customer_id: customerId,
      company_id: companyId,
      point_project_id: projectId,
      station_id: st.id,
      station_name_snapshot: String(st.name),
      booking_group_id: groupId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'confirmed',
      contact_phone: phone,
      contact_name: body.name || knownName,
      tariff_id: body.tariffId || null,
      notes: body.notes || null,
      source: 'operator',
      // Кто именно из операторов завёл бронь, устройство не знает: оно общее
      // на точку. Ответственность привязывается через смену.
      created_by_operator_id: null,
      shift_id: shiftId,
    }))

    const { data: created, error } = await supabase.from('client_bookings').insert(rows).select('id')

    if (error) throw error

    return json(
      {
        ok: true,
        bookingIds: (created || []).map((r: any) => String(r.id)),
        groupId,
        stationNames: bookable.map((st) => String(st.name)),
        // Что не поместилось — оператор должен узнать, не сверяя списки.
        skippedStations: busyStations.map((st) => String(st.name)),
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
