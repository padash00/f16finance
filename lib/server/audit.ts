import 'server-only'

import { formatAuditEvent } from '@/lib/core/event-formatter'
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

const actorCache = new Map<string, { checkedAt: number; isLeader: boolean; isSuperAdmin: boolean; label: string; role: string | null }>()
const companyNameCache = new Map<string, { checkedAt: number; name: string }>()
const CACHE_TTL_MS = 5 * 60_000

// Дедупликация одинаковых событий: ключ "actor:entityType:action:companyId" → { count, firstSeenAt, timer }
const dedupeCache = new Map<string, { count: number; firstSeenAt: number; timer: NodeJS.Timeout | null; entry: AuditEntry; actorLabel: string }>()
const DEDUPE_WINDOW_MS = 5_000

// Типы событий, которые НЕ шлём в Telegram (только в БД)
const TELEGRAM_SILENT_ENTITY_TYPES = new Set<string>([
  'page-view',
  'auth-attempt',
  'ai-usage',
  'system-error',
  'operator-chat',
])

function escapeTelegramHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function kzTimeLabel(date = new Date()) {
  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pickCompanyId(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null
  const direct = String(payload.company_id || '').trim()
  if (direct) return direct
  const nextObj = (payload.next || null) as Record<string, unknown> | null
  const previousObj = (payload.previous || null) as Record<string, unknown> | null
  const nextId = String(nextObj?.company_id || '').trim()
  if (nextId) return nextId
  const prevId = String(previousObj?.company_id || '').trim()
  if (prevId) return prevId
  return null
}

async function resolveCompanyName(companyId: string | null) {
  if (!companyId || !hasAdminSupabaseCredentials()) return null
  const now = Date.now()
  const cached = companyNameCache.get(companyId)
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.name
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('companies').select('name').eq('id', companyId).maybeSingle()
    const name = String(data?.name || '').trim() || companyId
    companyNameCache.set(companyId, { checkedAt: now, name })
    return name
  } catch {
    return companyId
  }
}

async function resolveLeaderActor(actorUserId: string) {
  const now = Date.now()
  const cached = actorCache.get(actorUserId)
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
    return cached
  }

  if (!hasAdminSupabaseCredentials()) {
    const fallback = { checkedAt: now, isLeader: false, isSuperAdmin: false, label: actorUserId, role: null }
    actorCache.set(actorUserId, fallback)
    return fallback
  }

  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.auth.admin.getUserById(actorUserId)
    const email = data?.user?.email || null
    const meta = (data?.user?.user_metadata || {}) as Record<string, unknown>
    const staffId = typeof meta.staff_id === 'string' ? meta.staff_id.trim() : ''
    let staffRow: any = null
    if (staffId) {
      const { data: staffById } = await admin
        .from('staff')
        .select('id, full_name, short_name, role')
        .eq('id', staffId)
        .maybeSingle()
      staffRow = staffById || null
    }
    if (!staffRow && email) {
      const { data: staffByEmail } = await admin
        .from('staff')
        .select('id, full_name, short_name, role')
        .ilike('email', email)
        .maybeSingle()
      staffRow = staffByEmail || null
    }
    const role = String(staffRow?.role || '').trim().toLowerCase() || null
    const isSuper = isAdminEmail(email)
    const label =
      String(staffRow?.full_name || '').trim() ||
      String(staffRow?.short_name || '').trim() ||
      (typeof meta.full_name === 'string' ? meta.full_name.trim() : '') ||
      (typeof meta.name === 'string' ? meta.name.trim() : '') ||
      email ||
      actorUserId
    const resolved = {
      checkedAt: now,
      isLeader: role === 'owner' || role === 'manager' || isSuper,
      isSuperAdmin: isSuper,
      label: String(label),
      role,
    }
    actorCache.set(actorUserId, resolved)
    return resolved
  } catch {
    const fallback = { checkedAt: now, isLeader: false, isSuperAdmin: false, label: actorUserId, role: null }
    actorCache.set(actorUserId, fallback)
    return fallback
  }
}

async function buildHumanAuditMessage(entry: AuditEntry, actorLabel: string) {
  const payload = (entry.payload || {}) as Record<string, unknown>
  const at = kzTimeLabel()

  // Подмешиваем имя точки в payload, если в payload только company_id
  let payloadWithCompany: Record<string, unknown> = payload
  if (!payload.company_name) {
    const companyName = await resolveCompanyName(pickCompanyId(payload))
    if (companyName) {
      payloadWithCompany = { ...payload, company_name: companyName }
    }
  }

  const formatted = formatAuditEvent({
    entityType: entry.entityType,
    action: entry.action,
    payload: payloadWithCompany,
    actorLabel,
  })

  const head = `${formatted.icon} <b>${escapeTelegramHtml(formatted.title)}</b>`
  const detailsLine = formatted.details.length > 0
    ? formatted.details.map((d) => escapeTelegramHtml(d)).join(' · ')
    : ''

  return [head, detailsLine, `🕒 ${at}`].filter(Boolean).join('\n')
}

async function flushDedupedEvent(key: string) {
  const bucket = dedupeCache.get(key)
  if (!bucket) return
  dedupeCache.delete(key)

  const targetChatId = process.env.TELEGRAM_SUPERADMIN_CHAT_ID
  if (!targetChatId) return

  try {
    const text = await buildHumanAuditMessage(bucket.entry, bucket.actorLabel)
    const finalText = bucket.count > 1 ? `${text}\n\n<i>Событие повторилось ${bucket.count} раз(а) подряд</i>` : text
    await sendTelegram(finalText, targetChatId)
  } catch {
    // Notification must not break primary flow.
  }
}

async function notifyLeaderAudit(entry: AuditEntry) {
  try {
    if (!entry.actorUserId) return

    // Не шлём шумные технические события в Telegram (page-view, ai-usage и т.п.)
    if (TELEGRAM_SILENT_ENTITY_TYPES.has(entry.entityType)) return

    const targetChatId = process.env.TELEGRAM_SUPERADMIN_CHAT_ID
    if (!targetChatId) return

    const actor = await resolveLeaderActor(entry.actorUserId)
    if (!actor.isLeader) return

    // Дедупликация: если такое же событие пришло за последние 5 секунд — копим, не шлём
    const companyKey = pickCompanyId(entry.payload) || ''
    const dedupeKey = `${entry.actorUserId}:${entry.entityType}:${entry.action}:${companyKey}`
    const existing = dedupeCache.get(dedupeKey)

    if (existing) {
      existing.count += 1
      existing.entry = entry
      return
    }

    const bucket = {
      count: 1,
      firstSeenAt: Date.now(),
      timer: null as NodeJS.Timeout | null,
      entry,
      actorLabel: actor.label,
    }
    bucket.timer = setTimeout(() => {
      flushDedupedEvent(dedupeKey).catch(() => {})
    }, DEDUPE_WINDOW_MS)
    dedupeCache.set(dedupeKey, bucket)
  } catch {
    // Notification must not break primary flow.
  }
}

export async function writeAuditLog(client: any, entry: AuditEntry) {
  try {
    const row = {
      actor_user_id: entry.actorUserId || null,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      payload: entry.payload || null,
    }
    const { error } = await client.from('audit_log').insert([row])

    if (error) {
      // 23503 — actor_user_id отсутствует в auth.users (юзер удалён
      // или сессия устаревшая). Перезаписываем анонимно, чтоб сохранить запись.
      const code = (error as any)?.code
      if (code === '23503' && row.actor_user_id) {
        const retryRow = { ...row, actor_user_id: null }
        const { error: retryErr } = await client.from('audit_log').insert([retryRow])
        if (retryErr) {
          console.warn('Audit log retry skipped', retryErr?.message || retryErr)
          return
        }
      } else {
        console.warn('Audit log write skipped', error?.message || error)
        return
      }
    }

    await notifyLeaderAudit(entry)
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
      area: entry.area,
      scope: entry.scope,
      message: entry.message,
      ...(entry.payload || {}),
    },
  })
}

export async function writeSystemErrorLogSafe(entry: SystemErrorEntry) {
  try {
    if (!hasAdminSupabaseCredentials()) return
    await writeSystemErrorLog(createAdminSupabaseClient(), entry)
  } catch (error) {
    console.warn('System error log write skipped', error)
  }
}
