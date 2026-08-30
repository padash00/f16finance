import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireCapability, requireOwnerOrSuper } from '@/lib/server/capabilities'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { generateMonitorAgentCredential } from '@/lib/server-monitoring/ingest'
import { sendMonitorTestNotification } from '@/lib/server-monitoring/notifications'

export const runtime = 'nodejs'

const serverCode = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)

const createServerSchema = z.object({
  action: z.literal('createServer'),
  code: serverCode,
  name: z.string().trim().min(1).max(120),
  hostname: z.string().trim().min(1).max(255).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
}).strict()

const serverActionBase = z.object({
  serverId: z.string().uuid(),
})

const updateServerSchema = serverActionBase.extend({
  action: z.literal('updateServer'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  enabled: z.boolean(),
}).strict()

const rotateKeySchema = serverActionBase
  .extend({
    action: z.literal('rotateKey'),
  })
  .strict()

const revokeKeySchema = serverActionBase
  .extend({
    action: z.literal('revokeKey'),
    keyId: z.string().uuid(),
  })
  .strict()

const testTelegramSchema = serverActionBase
  .extend({
    action: z.literal('testTelegram'),
  })
  .strict()

const settingsSchema = serverActionBase.extend({
  action: z.literal('updateSettings'),

  cpuTempWarningC: z.number().min(-50).max(200),
  cpuTempCriticalC: z.number().min(-50).max(200),

  cpuUsageWarningPct: z.number().min(0).max(100),
  cpuUsageCriticalPct: z.number().min(0).max(100),

  ramUsageWarningPct: z.number().min(0).max(100),
  ramUsageCriticalPct: z.number().min(0).max(100),

  diskTempWarningC: z.number().min(-50).max(200),
  diskTempCriticalC: z.number().min(-50).max(200),

  diskFreeWarningPct: z.number().min(0).max(100),
  diskFreeCriticalPct: z.number().min(0).max(100),

  offlineTimeoutSeconds: z.number().int().min(60).max(3600),
  recoverySamples: z.number().int().min(1).max(10),

  telegramEnabled: z.boolean(),
  notifyWarning: z.boolean(),
  notifyCritical: z.boolean(),
  notifyRecovery: z.boolean(),
})
  .strict()
  .superRefine((value, context) => {
    const ordered = [
      [value.cpuTempWarningC, value.cpuTempCriticalC, 'cpuTempCriticalC'],
      [value.cpuUsageWarningPct, value.cpuUsageCriticalPct, 'cpuUsageCriticalPct'],
      [value.ramUsageWarningPct, value.ramUsageCriticalPct, 'ramUsageCriticalPct'],
      [value.diskTempWarningC, value.diskTempCriticalC, 'diskTempCriticalC'],
    ] as const

    for (const [warning, critical, field] of ordered) {
      if (warning >= critical) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'critical must exceed warning',
        })
      }
    }

    if (value.diskFreeCriticalPct >= value.diskFreeWarningPct) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diskFreeCriticalPct'],
        message: 'critical must be below warning',
      })
    }
  })

const actionSchema = z.union([
  createServerSchema,
  updateServerSchema,
  rotateKeySchema,
  revokeKeySchema,
  testTelegramSchema,
  settingsSchema,
])

type Access = Exclude<
  Awaited<ReturnType<typeof getRequestAccessContext>>,
  { response: NextResponse }
>

function organizationIdFor(access: Access): string | null {
  return access.activeOrganization?.id || null
}

async function requireMonitorAccess(
  request: Request,
  capability: string,
) {
  const access = await getRequestAccessContext(request)

  if ('response' in access) {
    return { response: access.response } as const
  }

  const denied = await requireCapability(access, capability)

  if (denied) {
    return { response: denied } as const
  }

  if (!organizationIdFor(access)) {
    return {
      response: NextResponse.json(
        { error: 'organization_required' },
        { status: 409 },
      ),
    } as const
  }

  if (!hasAdminSupabaseCredentials()) {
    return {
      response: NextResponse.json(
        { error: 'monitor_backend_not_configured' },
        { status: 503 },
      ),
    } as const
  }

  return { access } as const
}

async function loadOwnedServer(
  serverId: string,
  organizationId: string,
) {
  const supabase = createAdminSupabaseClient()

  const { data, error } = await supabase
    .from('server_monitor_servers')
    .select('id, organization_id, name, hostname, enabled')
    .eq('id', serverId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function GET(request: Request) {
  const authorization = await requireMonitorAccess(
    request,
    'server-monitor.view',
  )

  if ('response' in authorization) {
    return authorization.response
  }

  const organizationId = organizationIdFor(
    authorization.access,
  )!

  const supabase = createAdminSupabaseClient()

  try {
    const serversResult = await supabase
      .from('server_monitor_servers')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name')

    if (serversResult.error) {
      throw serversResult.error
    }

    const serverIds = (serversResult.data || []).map(
      (row) => row.id,
    )

    const [
      currentResult,
      settingsResult,
      alertsResult,
      eventsResult,
      keysResult,
      companiesResult,
    ] = await Promise.all([
      supabase
        .from('server_monitor_current')
        .select('*')
        .eq('organization_id', organizationId)
        .order('received_at', {
          ascending: false,
        }),

      supabase
        .from('server_monitor_settings')
        .select('*')
        .eq('organization_id', organizationId),

      supabase
        .from('server_monitor_alerts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('severity')
        .order('started_at', {
          ascending: false,
        }),

      supabase
        .from('server_monitor_alert_events')
        .select('*')
        .eq('organization_id', organizationId)
        .order('occurred_at', {
          ascending: false,
        })
        .limit(100),

      serverIds.length
        ? supabase
            .from('server_monitor_agent_keys')
            .select(
              'id, server_id, key_id, label, status, created_at, expires_at, last_used_at, revoked_at',
            )
            .in('server_id', serverIds)
            .order('created_at', {
              ascending: false,
            })
        : Promise.resolve({
            data: [],
            error: null,
          }),

      // В companies нет колонки is_active.
      // Активной считаем компанию, которая не архивирована.
      supabase
        .from('companies')
        .select('id, name, code')
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .order('name'),
    ])

    const firstError = [
      currentResult,
      settingsResult,
      alertsResult,
      eventsResult,
      keysResult,
      companiesResult,
    ].find((result) => result.error)?.error

    if (firstError) {
      throw firstError
    }

    return NextResponse.json({
      servers: serversResult.data || [],
      current: currentResult.data || [],
      settings: settingsResult.data || [],
      activeAlerts: alertsResult.data || [],
      events: eventsResult.data || [],
      agentKeys: keysResult.data || [],
      companies: companiesResult.data || [],

      telegramConfigured: Boolean(
        process.env.TELEGRAM_MONITOR_BOT_TOKEN &&
          process.env.TELEGRAM_MONITOR_CHAT_ID,
      ),

      realtime: true,

      permissions: {
        manageCredentials:
          authorization.access.isSuperAdmin ||
          authorization.access.staffRole === 'owner',
      },
    })
  } catch (error) {
    console.error(
      '[server-monitor] dashboard load failed',
      error,
    )

    return NextResponse.json(
      {
        error: 'monitor_load_failed',
      },
      {
        status: 500,
      },
    )
  }
}

export async function POST(request: Request) {
  const authorization = await requireMonitorAccess(
    request,
    'server-monitor.view',
  )

  if ('response' in authorization) {
    return authorization.response
  }

  const access = authorization.access

  const organizationId = organizationIdFor(access)!

  const body = await request
    .json()
    .catch(() => null)

  const parsed = actionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        issues: parsed.error.issues,
      },
      {
        status: 422,
      },
    )
  }

  const supabase = createAdminSupabaseClient()

  try {
    if (parsed.data.action === 'createServer') {
      const ownerDenied = requireOwnerOrSuper(access)

      if (ownerDenied) {
        return ownerDenied
      }

      if (parsed.data.companyId) {
        const { data: company } = await supabase
          .from('companies')
          .select('id')
          .eq('id', parsed.data.companyId)
          .eq('organization_id', organizationId)
          .maybeSingle()

        if (!company) {
          return NextResponse.json(
            {
              error: 'company_not_found',
            },
            {
              status: 404,
            },
          )
        }
      }

      const credential =
        generateMonitorAgentCredential()

      const {
        data: server,
        error: serverError,
      } = await supabase
        .from('server_monitor_servers')
        .insert({
          organization_id: organizationId,
          company_id:
            parsed.data.companyId || null,
          code: parsed.data.code,
          name: parsed.data.name,
          hostname:
            parsed.data.hostname || null,
          description:
            parsed.data.description || null,
        })
        .select('*')
        .single()

      if (serverError) {
        throw serverError
      }

      const {
        error: keyError,
      } = await supabase
        .from('server_monitor_agent_keys')
        .insert({
          server_id: server.id,
          key_id: credential.keyId,
          secret_hash: credential.secretHash,
          label: 'Первичный ключ',
          created_by:
            access.user?.id || null,
        })

      if (keyError) {
        await supabase
          .from('server_monitor_servers')
          .delete()
          .eq('id', server.id)
          .eq(
            'organization_id',
            organizationId,
          )

        throw keyError
      }

      return NextResponse.json(
        {
          ok: true,
          server,
          agentKey: credential.token,
        },
        {
          status: 201,
        },
      )
    }

    const server = await loadOwnedServer(
      parsed.data.serverId,
      organizationId,
    )

    if (!server) {
      return NextResponse.json(
        {
          error: 'server_not_found',
        },
        {
          status: 404,
        },
      )
    }

    if (
      parsed.data.action ===
      'updateServer'
    ) {
      const denied = await requireCapability(
        access,
        'server-monitor.edit',
      )

      if (denied) {
        return denied
      }

      if (parsed.data.companyId) {
        const { data: company } =
          await supabase
            .from('companies')
            .select('id')
            .eq(
              'id',
              parsed.data.companyId,
            )
            .eq(
              'organization_id',
              organizationId,
            )
            .maybeSingle()

        if (!company) {
          return NextResponse.json(
            {
              error: 'company_not_found',
            },
            {
              status: 404,
            },
          )
        }
      }

      const { error } = await supabase
        .from('server_monitor_servers')
        .update({
          name: parsed.data.name,
          description:
            parsed.data.description || null,
          company_id:
            parsed.data.companyId || null,
          enabled: parsed.data.enabled,
        })
        .eq('id', server.id)
        .eq(
          'organization_id',
          organizationId,
        )

      if (error) {
        throw error
      }

      return NextResponse.json({
        ok: true,
      })
    }

    if (
      parsed.data.action ===
      'updateSettings'
    ) {
      const denied = await requireCapability(
        access,
        'server-monitor.edit_settings',
      )

      if (denied) {
        return denied
      }

      const { error } = await supabase
        .from('server_monitor_settings')
        .update({
          cpu_temp_warning_c:
            parsed.data.cpuTempWarningC,
          cpu_temp_critical_c:
            parsed.data.cpuTempCriticalC,

          cpu_usage_warning_pct:
            parsed.data.cpuUsageWarningPct,
          cpu_usage_critical_pct:
            parsed.data.cpuUsageCriticalPct,

          ram_usage_warning_pct:
            parsed.data.ramUsageWarningPct,
          ram_usage_critical_pct:
            parsed.data.ramUsageCriticalPct,

          disk_temp_warning_c:
            parsed.data.diskTempWarningC,
          disk_temp_critical_c:
            parsed.data.diskTempCriticalC,

          disk_free_warning_pct:
            parsed.data.diskFreeWarningPct,
          disk_free_critical_pct:
            parsed.data.diskFreeCriticalPct,

          offline_timeout_seconds:
            parsed.data.offlineTimeoutSeconds,

          recovery_samples:
            parsed.data.recoverySamples,

          telegram_enabled:
            parsed.data.telegramEnabled,

          notify_warning:
            parsed.data.notifyWarning,

          notify_critical:
            parsed.data.notifyCritical,

          notify_recovery:
            parsed.data.notifyRecovery,

          updated_by:
            access.user?.id || null,
        })
        .eq('server_id', server.id)
        .eq(
          'organization_id',
          organizationId,
        )

      if (error) {
        throw error
      }

      return NextResponse.json({
        ok: true,
      })
    }

    if (
      parsed.data.action ===
      'rotateKey'
    ) {
      const ownerDenied =
        requireOwnerOrSuper(access)

      if (ownerDenied) {
        return ownerDenied
      }

      const credential =
        generateMonitorAgentCredential()

      const {
        error: insertError,
      } = await supabase
        .from('server_monitor_agent_keys')
        .insert({
          server_id: server.id,
          key_id: credential.keyId,
          secret_hash:
            credential.secretHash,
          label: 'Ротация ключа',
          created_by:
            access.user?.id || null,
        })

      if (insertError) {
        throw insertError
      }

      const now =
        new Date().toISOString()

      const {
        error: revokeError,
      } = await supabase
        .from('server_monitor_agent_keys')
        .update({
          status: 'revoked',
          revoked_at: now,
        })
        .eq('server_id', server.id)
        .eq('status', 'active')
        .neq(
          'key_id',
          credential.keyId,
        )

      if (revokeError) {
        throw revokeError
      }

      return NextResponse.json({
        ok: true,
        agentKey: credential.token,
      })
    }

    if (
      parsed.data.action ===
      'revokeKey'
    ) {
      const ownerDenied =
        requireOwnerOrSuper(access)

      if (ownerDenied) {
        return ownerDenied
      }

      const { error } = await supabase
        .from('server_monitor_agent_keys')
        .update({
          status: 'revoked',
          revoked_at:
            new Date().toISOString(),
        })
        .eq('id', parsed.data.keyId)
        .eq('server_id', server.id)
        .eq('status', 'active')

      if (error) {
        throw error
      }

      return NextResponse.json({
        ok: true,
      })
    }

    const denied = await requireCapability(
      access,
      'server-monitor.test_notifications',
    )

    if (denied) {
      return denied
    }

    const result =
      await sendMonitorTestNotification({
        serverId: server.id,
        organizationId,
        serverName: server.name,
        hostname: server.hostname,
      })

    return NextResponse.json({
      ok: true,
      delivery: result,
    })
  } catch (error) {
    console.error(
      '[server-monitor] mutation failed',
      error,
    )

    return NextResponse.json(
      {
        error: 'monitor_update_failed',
      },
      {
        status: 500,
      },
    )
  }
}
