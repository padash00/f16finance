import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
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

function normalizeStatus(value: unknown): string {
  const s = String(value || 'online').trim().toLowerCase()
  const allowed = new Set(['online', 'idle', 'in_game', 'offline', 'extend_requested', 'operator_called'])
  return allowed.has(s) ? s : 'online'
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'kiosk-api-requires-admin-credentials' }, 503)
    }

    const headerSecret = request.headers.get('x-kiosk-secret')?.trim() || ''
    const body = (await request.json().catch(() => null)) as
      | {
          secret?: string
          stationId?: string
          stationCode?: string
          deviceToken?: string
          device_ip?: string | null
          device_mac?: string | null
          status?: string
        }
      | null

    const secret = String(body?.secret || headerSecret || '').trim()

    const stationId = String(body?.stationId || '').trim()
    const stationCode = String(body?.stationCode || '').trim()
    const headerDeviceToken = request.headers.get('x-kiosk-device-token')?.trim() || ''
    const deviceToken = String(body?.deviceToken || headerDeviceToken || '').trim()
    if (!stationId && !stationCode) {
      return json({ error: 'stationId-or-stationCode-required' }, 400)
    }

    const deviceIp = normalizeIp(body?.device_ip)
    const deviceMac = normalizeMac(body?.device_mac)
    const kioskStatus = normalizeStatus(body?.status)

    const admin = createAdminSupabaseClient()

    let q = admin
      .from('arena_stations')
      .select('id, name, station_code, device_ip, device_mac, device_token_hash, client_secret_hash')
      .limit(1)
    if (stationId) {
      q = q.eq('id', stationId)
    } else {
      q = q.or(`station_code.eq.${stationCode},name.eq.${stationCode}`)
    }

    const { data: row, error: findError } = await q.maybeSingle()
    if (findError) throw findError
    if (!row?.id) {
      return json({ error: 'station-not-found' }, 404)
    }

    const globalSecret = String(process.env.KIOSK_HEARTBEAT_SECRET || '').trim()
    const perDeviceHash = String(row.client_secret_hash || '')
    const expectedDeviceTokenHash = String(row.device_token_hash || '')
    const providedSecretHash = secret ? sha256(secret) : ''
    const providedDeviceTokenHash = deviceToken ? sha256(deviceToken) : ''

    if (!deviceToken) {
      return json({ error: 'missing-device-token' }, 401)
    }
    if (!expectedDeviceTokenHash) {
      return json({ error: 'device-not-bound' }, 409)
    }
    if (providedDeviceTokenHash !== expectedDeviceTokenHash) {
      return json({ error: 'device-token-mismatch' }, 401)
    }

    const authByPerDeviceSecret = Boolean(perDeviceHash && providedSecretHash && perDeviceHash === providedSecretHash)
    const authByGlobalSecret = Boolean(globalSecret && secret && globalSecret === secret)
    if (!authByPerDeviceSecret && !authByGlobalSecret) {
      return json({ error: 'unauthorized' }, 401)
    }
    // Note: IP/MAC check removed — clientSecret + deviceToken are sufficient auth.
    // IP can change (DHCP, VPN, docker) and cause false 409s that break session sync.

    console.log(`[heartbeat] OK station=${row.id} code=${row.station_code} status=${kioskStatus} ip=${deviceIp} mac=${deviceMac}`)
    const nowIso = new Date().toISOString()
    const { error: updError } = await admin
      .from('arena_stations')
      .update({ last_heartbeat_at: nowIso, kiosk_status: kioskStatus })
      .eq('id', row.id)

    if (updError) throw updError

    // Auto-end expired sessions for this station
    await admin
      .from('arena_sessions')
      .update({ status: 'completed', ended_at: nowIso })
      .eq('station_id', row.id)
      .eq('status', 'active')
      .lt('ends_at', nowIso)

    // Return active session so kiosk can sync state after restart
    const { data: activeSession } = await admin
      .from('arena_sessions')
      .select('ends_at, tariff:tariff_id(name)')
      .eq('station_id', row.id)
      .eq('status', 'active')
      .gt('ends_at', nowIso)
      .maybeSingle()

    const tariffName = activeSession
      ? (Array.isArray((activeSession as any).tariff)
          ? (activeSession as any).tariff[0]?.name
          : (activeSession as any).tariff?.name) ?? 'Тариф'
      : null

    return json({
      ok: true,
      stationId: row.id,
      last_heartbeat_at: nowIso,
      kiosk_status: kioskStatus,
      activeSession: activeSession
        ? { endsAt: (activeSession as any).ends_at, tariffName }
        : null,
    })
  } catch (error: any) {
    return json({ error: error?.message || 'kiosk-heartbeat-failed' }, 500)
  }
}
