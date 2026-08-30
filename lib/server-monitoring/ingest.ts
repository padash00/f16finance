import 'server-only'

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import type { AdminSupabaseClient } from '@/lib/server/supabase'
import {
  buildOfflineObservation,
  buildTelemetryObservations,
  normalizeMonitorSettings,
  toMonitorSnapshot,
  type ServerMonitorTelemetryV1,
} from '@/lib/server-monitoring/protocol'

const AGENT_TOKEN_PATTERN = /^(smk_[a-z0-9]{12,48})\.([A-Za-z0-9_-]{43,128})$/
const RATE_LIMIT_PER_MINUTE = 20

export class MonitorIngestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message = code) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function authenticateMonitorAgent(params: {
  supabase: AdminSupabaseClient
  authorization: string | null
  serverId: string
}) {
  const raw = params.authorization || ''
  const bearer = raw.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
  const match = bearer.match(AGENT_TOKEN_PATTERN)
  if (!match) throw new MonitorIngestError(401, 'invalid_agent_credentials')

  const [, keyId, secret] = match
  const { data: key, error } = await params.supabase
    .from('server_monitor_agent_keys')
    .select('id, server_id, secret_hash, status, expires_at')
    .eq('key_id', keyId)
    .maybeSingle()

  if (error) throw new MonitorIngestError(503, 'agent_auth_unavailable')
  const expected = String(key?.secret_hash || '')
  const validHash = /^[0-9a-f]{64}$/.test(expected) && safeHashEqual(sha256(secret), expected)
  const expired = key?.expires_at ? new Date(String(key.expires_at)).getTime() <= Date.now() : false
  if (!key || !validHash || key.status !== 'active' || expired || key.server_id !== params.serverId) {
    throw new MonitorIngestError(401, 'invalid_agent_credentials')
  }

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count, error: rateError } = await params.supabase
    .from('server_monitor_ingest_receipts')
    .select('id', { count: 'exact', head: true })
    .eq('agent_key_id', key.id)
    .gte('received_at', since)
  if (rateError) throw new MonitorIngestError(503, 'rate_limit_unavailable')
  if ((count || 0) >= RATE_LIMIT_PER_MINUTE) throw new MonitorIngestError(429, 'rate_limit_exceeded')

  return { id: String(key.id), serverId: String(key.server_id) }
}

export function validateTelemetryTimestamp(timestamp: string, now = new Date()): void {
  const observedAt = new Date(timestamp)
  if (!Number.isFinite(observedAt.getTime())) throw new MonitorIngestError(422, 'invalid_timestamp')
  const ageMs = now.getTime() - observedAt.getTime()
  if (ageMs < -2 * 60_000) throw new MonitorIngestError(422, 'timestamp_too_far_in_future')
  if (ageMs > 10 * 60_000) throw new MonitorIngestError(422, 'timestamp_too_old')
}

export async function commitMonitorTelemetry(params: {
  supabase: AdminSupabaseClient
  telemetry: ServerMonitorTelemetryV1
  agentKeyId: string
  rawBody: string
}) {
  const { data: settingsRow, error: settingsError } = await params.supabase
    .from('server_monitor_settings')
    .select('*')
    .eq('server_id', params.telemetry.serverId)
    .maybeSingle()
  if (settingsError) throw settingsError
  if (!settingsRow) throw new MonitorIngestError(404, 'server_not_found')

  const settings = normalizeMonitorSettings(settingsRow as Record<string, unknown>)
  const observations = buildTelemetryObservations(params.telemetry, settings)
  observations.push(buildOfflineObservation(0, settings.offline_timeout_seconds))

  const { data, error } = await params.supabase.rpc('server_monitor_commit_ingest', {
    p_server_id: params.telemetry.serverId,
    p_agent_key_id: params.agentKeyId,
    p_payload_hash: sha256(params.rawBody),
    p_snapshot: toMonitorSnapshot(params.telemetry),
    p_observations: observations,
  })
  if (error) {
    if (error.message?.includes('server monitor is disabled')) {
      throw new MonitorIngestError(403, 'server_disabled')
    }
    if (error.code === 'P0002') throw new MonitorIngestError(404, 'server_not_found')
    throw error
  }
  return data as { accepted: boolean; duplicate: boolean; stored: boolean; eventsCreated: number }
}

export function generateMonitorAgentCredential(): {
  keyId: string
  secretHash: string
  token: string
} {
  const keyId = `smk_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const secret = randomBytes(32).toString('base64url')
  return { keyId, secretHash: sha256(secret), token: `${keyId}.${secret}` }
}
