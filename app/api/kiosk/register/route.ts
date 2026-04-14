import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeMac(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const canonical = raw.replace(/-/g, ':').toUpperCase()
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(canonical)) return null
  return canonical
}

function normalizeIp(value: unknown): string | null {
  if (value == null) return null
  const ip = String(value).trim()
  if (!ip) return null
  if (!isIP(ip)) return null
  return ip
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'kiosk-api-requires-admin-credentials' }, 503)
    }

    const body = (await request.json().catch(() => null)) as
      | {
          stationCode?: string
          provisioningKey?: string
          deviceToken?: string
          device_ip?: string | null
          device_mac?: string | null
        }
      | null

    const stationCode = String(body?.stationCode || '').trim()
    const provisioningKey = String(body?.provisioningKey || '').trim()
    const deviceToken = String(body?.deviceToken || '').trim()
    if (!stationCode) return json({ error: 'stationCode-required' }, 400)
    if (!provisioningKey) return json({ error: 'provisioningKey-required' }, 400)
    if (!deviceToken) return json({ error: 'deviceToken-required' }, 400)

    const admin = createAdminSupabaseClient()
    const { data: station, error: findError } = await admin
      .from('arena_stations')
      .select('id, name, station_code, provisioning_key_hash, point_project_id')
      .or(`station_code.eq.${stationCode},name.eq.${stationCode}`)
      .limit(1)
      .maybeSingle()
    if (findError) throw findError
    if (!station?.id) return json({ error: 'station-not-found' }, 404)

    // Check global key first (env var), then fall back to per-station key
    const globalKey = String(process.env.KIOSK_PROVISIONING_KEY || '').trim()
    const perStationHash = String(station.provisioning_key_hash || '')
    const validByGlobal = Boolean(globalKey && provisioningKey === globalKey)
    const validByStation = Boolean(perStationHash && sha256(provisioningKey) === perStationHash)
    if (!validByGlobal && !validByStation) {
      return json({ error: 'provisioning-key-invalid' }, 401)
    }

    const clientSecret = randomBytes(24).toString('hex')
    const deviceIp = normalizeIp(body?.device_ip)
    const deviceMac = normalizeMac(body?.device_mac)

    const { error: updError } = await admin
      .from('arena_stations')
      .update({
        station_code: station.station_code || stationCode,
        device_ip: deviceIp,
        device_mac: deviceMac,
        device_token_hash: sha256(deviceToken),
        client_secret_hash: sha256(clientSecret),
        registered_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        kiosk_status: 'online',
      })
      .eq('id', station.id)
    if (updError) throw updError

    return json({
      ok: true,
      stationId: station.id,
      stationCode: station.station_code || station.name || stationCode,
      clientSecret,
      heartbeatPath: '/api/kiosk/heartbeat',
    })
  } catch (error: any) {
    return json({ error: error?.message || 'kiosk-register-failed' }, 500)
  }
}
