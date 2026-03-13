import 'server-only'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type AuditEntry = {
  actorUserId?: string | null
  entityType: string
  entityId: string
  action: string
  payload?: Record<string, unknown> | null
}

type NotificationEntry = {
  channel: string
  recipient: string
  status: string
  payload?: Record<string, unknown> | null
}

type SystemErrorEntry = {
  actorUserId?: string | null
  scope: 'server' | 'client'
  area: string
  message: string
  payload?: Record<string, unknown> | null
}

export async function writeAuditLog(client: any, entry: AuditEntry) {
  try {
    const { error } = await client.from('audit_log').insert([
      {
        actor_user_id: entry.actorUserId || null,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        action: entry.action,
        payload: entry.payload || null,
      },
    ])

    if (error) {
      console.warn('Audit log write skipped', error?.message || error)
    }
  } catch (error) {
    console.warn('Audit log write failed', error)
  }
}

export async function writeNotificationLog(client: any, entry: NotificationEntry) {
  try {
    const { error } = await client.from('notification_log').insert([
      {
        channel: entry.channel,
        recipient: entry.recipient,
        status: entry.status,
        payload: entry.payload || null,
      },
    ])

    if (error) {
      console.warn('Notification log write skipped', error?.message || error)
    }
  } catch (error) {
    console.warn('Notification log write failed', error)
  }
}

export async function writeSystemErrorLog(client: any, entry: SystemErrorEntry) {
  await writeAuditLog(client, {
    actorUserId: entry.actorUserId || null,
    entityType: 'system-error',
    entityId: entry.area,
    action: `${entry.scope}-error`,
    payload: {
      message: entry.message,
      ...(entry.payload || {}),
    },
  })
}

export async function writeSystemErrorLogSafe(entry: SystemErrorEntry) {
  if (!hasAdminSupabaseCredentials()) return
  await writeSystemErrorLog(createAdminSupabaseClient(), entry)
}
