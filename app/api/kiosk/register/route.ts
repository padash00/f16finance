import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sanitizeOrFilterValue } from '@/lib/server/postgrest-filter'

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
    // Изоляция: код/имя станции НЕ уникальны между арендаторами («PC-01» есть у
    // многих). Раньше брали .limit(1) по всей таблице и проверяли ключ уже у
    // выбранной строки — киоск мог перепривязать к себе станцию чужой орг
    // (в ответ уходит новый clientSecret = полный захват киоска).
    // Теперь берём ВСЕХ кандидатов и оставляем ту станцию, чей ключ реально сошёлся.
    const { data: candidates, error: findError } = await admin
      .from('arena_stations')
      .select('id, name, station_code, provisioning_key_hash, point_project_id')
      .or(`station_code.eq.${sanitizeOrFilterValue(stationCode)},name.eq.${sanitizeOrFilterValue(stationCode)}`)
      .limit(50)
    if (findError) throw findError

    const candidateRows = (candidates || []) as Array<{
      id: string
      name: string | null
      station_code: string | null
      provisioning_key_hash: string | null
      point_project_id: string | null
    }>
    if (candidateRows.length === 0) return json({ error: 'station-not-found' }, 404)

    // Ключи проектов всех кандидатов одним запросом.
    const projectIds = Array.from(new Set(candidateRows.map((r) => r.point_project_id).filter(Boolean) as string[]))
    const projectKeyById = new Map<string, string>()
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('point_projects')
        .select('id, arena_provisioning_key')
        .in('id', projectIds)
      for (const p of (projects || []) as any[]) {
        projectKeyById.set(String(p.id), String(p.arena_provisioning_key || '').trim())
      }
    }

    const providedHash = sha256(provisioningKey)
    const globalEnvKey = String(process.env.KIOSK_PROVISIONING_KEY || '').trim()

    // Точное совпадение station_code важнее совпадения по имени.
    const ordered = [...candidateRows].sort((a, b) => {
      const aExact = a.station_code === stationCode ? 0 : 1
      const bExact = b.station_code === stationCode ? 0 : 1
      return aExact - bExact
    })

    const station =
      ordered.find((row) => {
        const projectKey = projectKeyById.get(String(row.point_project_id || '')) || ''
        const perStationHash = String(row.provisioning_key_hash || '')
        return (
          (projectKey && provisioningKey === projectKey) || (perStationHash && providedHash === perStationHash)
        )
      }) ||
      // Глобальный ENV-ключ — только когда кандидат ровно один: иначе им можно
      // было бы «увести» одноимённую станцию другого арендатора.
      (globalEnvKey && provisioningKey === globalEnvKey && ordered.length === 1 ? ordered[0] : null)

    if (!station) {
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
