import { NextResponse } from 'next/server'
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

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return json({ error: 'kiosk-api-requires-admin-credentials' }, 503)
    }

    const secretEnv = String(process.env.KIOSK_HEARTBEAT_SECRET || '').trim()
    if (!secretEnv) {
      return json({ error: 'kiosk-heartbeat-secret-not-configured' }, 503)
    }

    const headerSecret = request.headers.get('x-kiosk-secret')?.trim() || ''
    const body = (await request.json().catch(() => null)) as
      | {
          secret?: string
          stationId?: string
          stationCode?: string
          device_ip?: string | null
          device_mac?: string | null
          status?: string
        }
      | null

    const secret = String(body?.secret || headerSecret || '').trim()
    if (!secret || secret !== secretEnv) {
      return json({ error: 'unauthorized' }, 401)
    }

    const stationId = String(body?.stationId || '').trim()
    const stationCode = String(body?.stationCode || '').trim()
    if (!stationId && !stationCode) {
      return json({ error: 'stationId-or-stationCode-required' }, 400)
    }

    const deviceIp = normalizeIp(body?.device_ip)
    const deviceMac = normalizeMac(body?.device_mac)
    const kioskStatus = normalizeStatus(body?.status)

    const admin = createAdminSupabaseClient()

    let q = admin.from('arena_stations').select('id, name, device_ip, device_mac').limit(1)
    if (stationId) {
      q = q.eq('id', stationId)
    } else {
      q = q.eq('name', stationCode)
    }

    const { data: row, error: findError } = await q.maybeSingle()
    if (findError) throw findError
    if (!row?.id) {
      return json({ error: 'station-not-found' }, 404)
    }

    const boundIp = row.device_ip != null ? String(row.device_ip).trim() : ''
    const boundMac = row.device_mac != null ? String(row.device_mac).trim().toUpperCase().replace(/-/g, ':') : ''

    if (boundIp && deviceIp && boundIp !== deviceIp) {
      return json({ error: 'device-ip-mismatch', stationId: row.id }, 409)
    }
    if (boundMac && deviceMac && boundMac !== deviceMac) {
      return json({ error: 'device-mac-mismatch', stationId: row.id }, 409)
    }

    const nowIso = new Date().toISOString()
    const { error: updError } = await admin
      .from('arena_stations')
      .update({ last_heartbeat_at: nowIso, kiosk_status: kioskStatus })
      .eq('id', row.id)

    if (updError) throw updError

    return json({ ok: true, stationId: row.id, last_heartbeat_at: nowIso, kiosk_status: kioskStatus })
  } catch (error: any) {
    return json({ error: error?.message || 'kiosk-heartbeat-failed' }, 500)
  }
}
