import { NextResponse } from 'next/server'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { processMonitorNotificationOutbox } from '@/lib/server-monitoring/notifications'
import {
  authenticateMonitorAgent,
  commitMonitorTelemetry,
  MonitorIngestError,
  validateTelemetryTimestamp,
} from '@/lib/server-monitoring/ingest'
import { serverMonitorTelemetryV1Schema } from '@/lib/server-monitoring/protocol'

export const runtime = 'nodejs'
export const maxDuration = 20

const MAX_BODY_BYTES = 256 * 1024

function jsonError(status: number, code: string) {
  return NextResponse.json({ ok: false, error: code }, { status })
}

export async function POST(request: Request) {
  if (!hasAdminSupabaseCredentials()) return jsonError(503, 'monitor_backend_not_configured')

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('application/json')) return jsonError(415, 'content_type_must_be_json')
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return jsonError(413, 'payload_too_large')

  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return jsonError(413, 'payload_too_large')

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return jsonError(400, 'invalid_json')
    }

    const result = serverMonitorTelemetryV1Schema.safeParse(parsed)
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: 'invalid_payload', issues: result.error.issues.slice(0, 12).map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
        { status: 422 },
      )
    }
    validateTelemetryTimestamp(result.data.timestamp)

    const supabase = createAdminSupabaseClient()
    const agent = await authenticateMonitorAgent({
      supabase,
      authorization: request.headers.get('authorization'),
      serverId: result.data.serverId,
    })
    const committed = await commitMonitorTelemetry({
      supabase,
      telemetry: result.data,
      agentKeyId: agent.id,
      rawBody,
    })

    if (committed.eventsCreated > 0) {
      await processMonitorNotificationOutbox(5).catch((error) => {
        console.error('[server-monitor] immediate notification delivery failed', error)
      })
    }

    return NextResponse.json({ ok: true, ...committed }, { status: committed.duplicate ? 200 : 202 })
  } catch (error) {
    if (error instanceof MonitorIngestError) return jsonError(error.status, error.code)
    console.error('[server-monitor] ingest failed', error)
    return jsonError(500, 'ingest_failed')
  }
}
