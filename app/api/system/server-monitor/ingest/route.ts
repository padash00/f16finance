import { NextResponse } from 'next/server'

import {
  createAdminSupabaseClient,
  hasAdminSupabaseCredentials,
} from '@/lib/server/supabase'

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
  return NextResponse.json(
    {
      ok: false,
      error: code,
    },
    {
      status,
    },
  )
}

export async function POST(request: Request) {
  if (!hasAdminSupabaseCredentials()) {
    return jsonError(503, 'monitor_backend_not_configured')
  }

  const contentType = request.headers.get('content-type') || ''

  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonError(415, 'content_type_must_be_json')
  }

  const declaredLength = Number(
    request.headers.get('content-length') || 0,
  )

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BODY_BYTES
  ) {
    return jsonError(413, 'payload_too_large')
  }

  try {
    const rawBody = await request.text()

    if (
      new TextEncoder().encode(rawBody).byteLength >
      MAX_BODY_BYTES
    ) {
      return jsonError(413, 'payload_too_large')
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return jsonError(400, 'invalid_json')
    }

    const result =
      serverMonitorTelemetryV1Schema.safeParse(parsed)

    if (!result.success) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_payload',
          issues: result.error.issues
            .slice(0, 12)
            .map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
        },
        {
          status: 422,
        },
      )
    }

    validateTelemetryTimestamp(
      result.data.timestamp,
    )

    /*
     * Агент может авторизоваться двумя способами:
     *
     * 1. X-ORDA-Agent-Key: smk_...
     * 2. Authorization: Bearer smk_...
     *
     * Приоритет отдаём X-ORDA-Agent-Key.
     */

    const authHeader =
      request.headers.get('authorization') || ''

    const customAgentKey =
      request.headers
        .get('x-orda-agent-key')
        ?.trim() || ''

    const bearerAgentKey =
      authHeader
        .match(/^Bearer\s+(.+)$/i)?.[1]
        ?.trim() || ''

    const effectiveAgentKey =
      customAgentKey || bearerAgentKey

    const keyId =
      effectiveAgentKey.split('.')[0] || ''

    const agentAuthorization =
      effectiveAgentKey
        ? `Bearer ${effectiveAgentKey}`
        : null

    /*
     * Диагностика.
     * Полный Agent Key в лог НЕ выводится.
     */

    const supabaseHost = (() => {
      try {
        return new URL(
          process.env.NEXT_PUBLIC_SUPABASE_URL ||
            process.env.SUPABASE_URL ||
            '',
        ).hostname
      } catch {
        return 'invalid'
      }
    })()

    console.log(
      '[server-monitor] agent auth diagnostic',
      {
        authorizationPresent: Boolean(
          authHeader,
        ),
        customAgentKeyPresent: Boolean(
          customAgentKey,
        ),
        bearerPresent: Boolean(
          bearerAgentKey,
        ),
        keyId,
        serverId: result.data.serverId,
        supabaseHost,
      },
    )

    const supabase =
      createAdminSupabaseClient()

    const agent =
      await authenticateMonitorAgent({
        supabase,
        authorization:
          agentAuthorization,
        serverId:
          result.data.serverId,
      })

    const committed =
      await commitMonitorTelemetry({
        supabase,
        telemetry: result.data,
        agentKeyId: agent.id,
        rawBody,
      })

    if (committed.eventsCreated > 0) {
      await processMonitorNotificationOutbox(
        5,
      ).catch((error) => {
        console.error(
          '[server-monitor] immediate notification delivery failed',
          error,
        )
      })
    }

    return NextResponse.json(
      {
        ok: true,
        ...committed,
      },
      {
        status:
          committed.duplicate
            ? 200
            : 202,
      },
    )
  } catch (error) {
    if (
      error instanceof MonitorIngestError
    ) {
      console.warn(
        '[server-monitor] ingest rejected',
        {
          status: error.status,
          code: error.code,
        },
      )

      return jsonError(
        error.status,
        error.code,
      )
    }

    console.error(
      '[server-monitor] ingest failed',
      error,
    )

    return jsonError(
      500,
      'ingest_failed',
    )
  }
}
