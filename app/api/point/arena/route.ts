import { NextResponse } from 'next/server'
import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { sendTelegramMessage } from '@/lib/telegram/send'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// In-memory map: sessionId → notifiedAt timestamp (for 5-min Telegram dedup)
const notified5minMap = new Map<string, number>()

// Cleanup entries older than 3 hours every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 3 * 60 * 60_000
    for (const [id, ts] of notified5minMap) {
      if (ts < cutoff) notified5minMap.delete(id)
    }
  }, 60 * 60_000)
}

// ─── GET: fetch zones, stations, tariffs, active sessions ─────────────────────

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response
    const { supabase, device } = point
    const projectId = device.id

    const [
      { data: zones, error: zonesError },
      { data: stations, error: stationsError },
      { data: tariffs, error: tariffsError },
      { data: sessions, error: sessionsError },
    ] = await Promise.all([
      supabase
        .from('arena_zones')
        .select('*')
        .eq('point_project_id', projectId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('arena_stations')
        .select('*')
        .eq('point_project_id', projectId)
        .eq('is_active', true)
        .order('order_index')
        .order('name'),
      supabase
        .from('arena_tariffs')
        .select('*')
        .eq('point_project_id', projectId)
        .eq('is_active', true)
        .order('price'),
      supabase
        .from('arena_sessions')
        .select('*')
        .eq('point_project_id', projectId)
        .eq('status', 'active'),
    ])

    if (zonesError) throw zonesError
    if (stationsError) throw stationsError
    if (tariffsError) throw tariffsError
    if (sessionsError) throw sessionsError

    return json({
      ok: true,
      data: {
        zones: zones || [],
        stations: stations || [],
        tariffs: tariffs || [],
        sessions: sessions || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/arena:get',
      message: error?.message || 'Arena GET error',
    })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

// ─── POST: session management actions ─────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response
    const { supabase, device } = point
    const projectId = device.id

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action required' }, 400)

    // ─── START SESSION ────────────────────────────────────────────────────────
    if (body.action === 'startSession') {
      const { stationId, tariffId, operatorId } = body
      if (!stationId || !tariffId) return json({ error: 'stationId and tariffId required' }, 400)

      // Ensure station is not already occupied
      const { data: existing } = await supabase
        .from('arena_sessions')
        .select('id')
        .eq('station_id', stationId)
        .eq('status', 'active')
        .maybeSingle()

      if (existing) return json({ error: 'station-already-occupied' }, 409)

      // Fetch tariff for duration and price
      const { data: tariff, error: tariffError } = await supabase
        .from('arena_tariffs')
        .select('*')
        .eq('id', tariffId)
        .single()
      if (tariffError || !tariff) return json({ error: 'tariff-not-found' }, 404)

      const startedAt = new Date()
      const endsAt = new Date(startedAt.getTime() + Number(tariff.duration_minutes) * 60_000)

      const { data: session, error: insertError } = await supabase
        .from('arena_sessions')
        .insert({
          point_project_id: projectId,
          station_id: stationId,
          tariff_id: tariffId,
          operator_id: operatorId || null,
          started_at: startedAt.toISOString(),
          ends_at: endsAt.toISOString(),
          amount: Number(tariff.price) || 0,
          status: 'active',
        })
        .select()
        .single()

      if (insertError) throw insertError
      return json({ ok: true, data: session })
    }

    // ─── END SESSION ──────────────────────────────────────────────────────────
    if (body.action === 'endSession') {
      const { sessionId } = body
      if (!sessionId) return json({ error: 'sessionId required' }, 400)

      const { data: session, error: updateError } = await supabase
        .from('arena_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .select()
        .single()

      if (updateError) throw updateError
      notified5minMap.delete(sessionId)
      return json({ ok: true, data: session })
    }

    // ─── EXTEND SESSION ───────────────────────────────────────────────────────
    if (body.action === 'extendSession') {
      const { sessionId, tariffId } = body
      if (!sessionId || !tariffId) return json({ error: 'sessionId and tariffId required' }, 400)

      const { data: tariff, error: tariffError } = await supabase
        .from('arena_tariffs')
        .select('*')
        .eq('id', tariffId)
        .single()
      if (tariffError || !tariff) return json({ error: 'tariff-not-found' }, 404)

      const { data: current, error: fetchError } = await supabase
        .from('arena_sessions')
        .select('ends_at, amount')
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .single()
      if (fetchError || !current) return json({ error: 'session-not-found' }, 404)

      // Extend from current ends_at (or now if already elapsed)
      const currentEndsAt = new Date(current.ends_at)
      const baseTime = currentEndsAt > new Date() ? currentEndsAt : new Date()
      const newEndsAt = new Date(baseTime.getTime() + Number(tariff.duration_minutes) * 60_000)

      const { data: session, error: updateError } = await supabase
        .from('arena_sessions')
        .update({
          ends_at: newEndsAt.toISOString(),
          amount: (Number(current.amount) || 0) + (Number(tariff.price) || 0),
        })
        .eq('id', sessionId)
        .select()
        .single()

      if (updateError) throw updateError
      // Reset notification flag so the new end time gets a fresh notification
      notified5minMap.delete(sessionId)
      return json({ ok: true, data: session })
    }

    // ─── NOTIFY 5 MIN ─────────────────────────────────────────────────────────
    if (body.action === 'notify5min') {
      const { sessionId, operatorId } = body
      if (!sessionId) return json({ error: 'sessionId required' }, 400)

      // In-memory dedup
      if (notified5minMap.has(sessionId)) {
        return json({ ok: true, skipped: 'already-notified' })
      }

      // Fetch session to verify and get station name
      const { data: session } = await supabase
        .from('arena_sessions')
        .select('ends_at, station:station_id(name)')
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .eq('status', 'active')
        .maybeSingle()

      if (!session) return json({ ok: true, skipped: 'session-not-found' })

      const endsAt = new Date(session.ends_at)
      const remaining = endsAt.getTime() - Date.now()
      if (remaining > 5 * 60_000 + 30_000) return json({ ok: true, skipped: 'too-early' })

      // Mark notified with timestamp for TTL cleanup
      notified5minMap.set(sessionId, Date.now())

      // Send Telegram if operator has chat_id
      if (operatorId) {
        const { data: operator } = await supabase
          .from('operators')
          .select('name, telegram_chat_id')
          .eq('id', operatorId)
          .maybeSingle()

        if (operator?.telegram_chat_id) {
          const stationName = Array.isArray(session.station)
            ? session.station[0]?.name
            : (session.station as any)?.name
          const mins = Math.max(0, Math.ceil(remaining / 60_000))
          const timeStr = endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          const text = `⏰ <b>Осталось ${mins} мин.</b>\nСтанция: <b>${stationName || '—'}</b>\nОкончание: ${timeStr}`
          await sendTelegramMessage(operator.telegram_chat_id, text).catch(() => null)
        }
      }

      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/arena:post',
      message: error?.message || 'Arena POST error',
    })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
