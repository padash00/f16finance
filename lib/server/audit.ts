import 'server-only'

import { isAdminEmail } from '@/lib/server/admin'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegram } from '@/lib/server/telegram'

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

const superAdminCache = new Map<string, { checkedAt: number; isSuperAdmin: boolean; label: string }>()
const SUPERADMIN_CACHE_TTL_MS = 5 * 60_000

function escapeTelegramHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(value: string, max = 550) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

async function resolveSuperAdminActorLabel(actorUserId: string) {
  const now = Date.now()
  const cached = superAdminCache.get(actorUserId)
  if (cached && now - cached.checkedAt < SUPERADMIN_CACHE_TTL_MS) {
    return cached
  }

  if (!hasAdminSupabaseCredentials()) {
    const fallback = { checkedAt: now, isSuperAdmin: false, label: actorUserId }
    superAdminCache.set(actorUserId, fallback)
    return fallback
  }

  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.auth.admin.getUserById(actorUserId)
    const email = data?.user?.email || null
    const meta = (data?.user?.user_metadata || {}) as Record<string, unknown>
    const name =
      (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
      (typeof meta.name === 'string' && meta.name.trim()) ||
      email ||
      actorUserId
    const resolved = {
      checkedAt: now,
      isSuperAdmin: isAdminEmail(email),
      label: String(name),
    }
    superAdminCache.set(actorUserId, resolved)
    return resolved
  } catch {
    const fallback = { checkedAt: now, isSuperAdmin: false, label: actorUserId }
    superAdminCache.set(actorUserId, fallback)
    return fallback
  }
}

async function notifySuperAdminAudit(entry: AuditEntry) {
  try {
    if (!entry.actorUserId) return
    const targetChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID
    if (!targetChatId) return

    const actor = await resolveSuperAdminActorLabel(entry.actorUserId)
    if (!actor.isSuperAdmin) return

    const payloadJson = entry.payload ? truncate(JSON.stringify(entry.payload, null, 0), 550) : ''
    const lines = [
      '🧭 <b>Действие супер-админа</b>',
      `👤 <b>${escapeTelegramHtml(actor.label)}</b>`,
      `🏷 <code>${escapeTelegramHtml(entry.entityType)}</code> · <code>${escapeTelegramHtml(entry.action)}</code>`,
      `🆔 <code>${escapeTelegramHtml(entry.entityId)}</code>`,
    ]
    if (entry.entityType === 'page-view') {
      const pathname = String((entry.payload?.pathname as string) || entry.entityId || '').trim()
      if (pathname) lines.push(`📍 Страница: <code>${escapeTelegramHtml(pathname)}</code>`)
    }
    if (payloadJson) {
      lines.push(`🧾 ${escapeTelegramHtml(payloadJson)}`)
    }

    await sendTelegram(lines.join('\n'), targetChatId)
  } catch {
    // Notification must not break primary flow.
  }
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
      return
    }

    await notifySuperAdminAudit(entry)
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
