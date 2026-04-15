import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { broadcastKioskCommand } from '@/lib/server/kiosk-broadcast'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * GET /api/kiosk/debug?code=801
 * Returns station info + last heartbeat + active session.
 * Accessible without auth for diagnostics.
 *
 * POST /api/kiosk/debug?code=801
 * Sends a test broadcast to the station's realtime channel.
 */
export async function GET(request: Request) {
  if (!hasAdminSupabaseCredentials()) return json({ error: 'no-admin-credentials' }, 503)

  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const id = url.searchParams.get('id') || ''
  if (!code && !id) return json({ error: 'provide ?code=STATION_CODE or ?id=STATION_ID' }, 400)

  const admin = createAdminSupabaseClient()

  let q = admin
    .from('arena_stations')
    .select('id, name, station_code, kiosk_status, last_heartbeat_at, device_ip, device_mac, registered_at')
    .limit(1)
  if (id) {
    q = q.eq('id', id)
  } else {
    q = q.or(`station_code.eq.${code},name.eq.${code}`)
  }

  const { data: station, error } = await q.maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!station) return json({ error: 'station-not-found' }, 404)

  const now = new Date().toISOString()
  const { data: activeSession } = await admin
    .from('arena_sessions')
    .select('id, started_at, ends_at, status, tariff:tariff_id(name)')
    .eq('station_id', station.id)
    .eq('status', 'active')
    .gt('ends_at', now)
    .maybeSingle()

  const lastHb = station.last_heartbeat_at
    ? Math.round((Date.now() - new Date(station.last_heartbeat_at).getTime()) / 1000)
    : null

  return json({
    stationId: station.id,
    stationCode: station.station_code,
    name: station.name,
    kioskStatus: station.kiosk_status,
    lastHeartbeatAt: station.last_heartbeat_at,
    lastHeartbeatSecondsAgo: lastHb,
    deviceIp: station.device_ip,
    deviceMac: station.device_mac,
    registeredAt: station.registered_at,
    activeSession: activeSession
      ? {
          id: (activeSession as any).id,
          startedAt: (activeSession as any).started_at,
          endsAt: (activeSession as any).ends_at,
          tariffName: (Array.isArray((activeSession as any).tariff)
            ? (activeSession as any).tariff[0]?.name
            : (activeSession as any).tariff?.name) ?? null,
        }
      : null,
    realtimeChannel: `kiosk:${station.id}`,
  })
}

export async function POST(request: Request) {
  if (!hasAdminSupabaseCredentials()) return json({ error: 'no-admin-credentials' }, 503)

  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const id = url.searchParams.get('id') || ''
  if (!code && !id) return json({ error: 'provide ?code=STATION_CODE or ?id=STATION_ID' }, 400)

  const admin = createAdminSupabaseClient()

  let q = admin.from('arena_stations').select('id, station_code').limit(1)
  if (id) {
    q = q.eq('id', id)
  } else {
    q = q.or(`station_code.eq.${code},name.eq.${code}`)
  }

  const { data: station, error } = await q.maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!station) return json({ error: 'station-not-found' }, 404)

  await broadcastKioskCommand(station.id, { type: 'ping', ts: Date.now() })

  return json({
    ok: true,
    message: `Test ping sent to channel kiosk:${station.id}`,
    stationId: station.id,
    stationCode: station.station_code,
  })
}
