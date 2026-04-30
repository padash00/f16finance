import 'server-only'

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

const actorCache = new Map<string, { checkedAt: number; isLeader: boolean; label: string; role: string | null }>()
const companyNameCache = new Map<string, { checkedAt: number; name: string }>()
const CACHE_TTL_MS = 5 * 60_000

function escapeTelegramHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toNum(v: unknown): number {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

function fmtMoney(v: unknown) {
  return `${Math.round(toNum(v)).toLocaleString('ru-RU')} ₸`
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
    const fallback = { checkedAt: now, isLeader: false, label: actorUserId, role: null }
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
    const label =
      String(staffRow?.full_name || '').trim() ||
      String(staffRow?.short_name || '').trim() ||
      (typeof meta.full_name === 'string' ? meta.full_name.trim() : '') ||
      (typeof meta.name === 'string' ? meta.name.trim() : '') ||
      email ||
      actorUserId
    const resolved = {
      checkedAt: now,
      isLeader: role === 'owner' || role === 'manager',
      label: String(label),
      role,
    }
    actorCache.set(actorUserId, resolved)
    return resolved
  } catch {
    const fallback = { checkedAt: now, isLeader: false, label: actorUserId, role: null }
    actorCache.set(actorUserId, fallback)
    return fallback
  }
}

async function buildHumanAuditMessage(entry: AuditEntry, actorLabel: string) {
  const payload = (entry.payload || {}) as Record<string, unknown>
  const at = kzTimeLabel()
  const companyName = await resolveCompanyName(pickCompanyId(payload))
  const where = companyName ? ` · точка: <b>${escapeTelegramHtml(companyName)}</b>` : ''

  if (entry.entityType === 'auth-session' && entry.action.endsWith('-login')) {
    return `👤 <b>${escapeTelegramHtml(actorLabel)}</b> вошла в систему.\n🕒 ${at}`
  }

  if (entry.entityType === 'page-view' && entry.action === 'visit') {
    const pathname = String(payload.pathname || entry.entityId || '').trim() || 'unknown'
    return `🧭 <b>${escapeTelegramHtml(actorLabel)}</b> открыла страницу <code>${escapeTelegramHtml(pathname)}</code>\n🕒 ${at}`
  }

  if (entry.entityType === 'income') {
    const cash = toNum(payload.cash_amount)
    const kaspi = toNum(payload.kaspi_amount)
    const online = toNum(payload.online_amount)
    const card = toNum(payload.card_amount)
    const total =
      toNum(payload.total_amount) || (cash + kaspi + online + card)
    if (entry.action === 'create') {
      return `💰 <b>${escapeTelegramHtml(actorLabel)}</b> добавила доход: <b>${fmtMoney(total)}</b>${where}\n` +
        `Нал: ${fmtMoney(cash)} · Kaspi: ${fmtMoney(kaspi)} · Online: ${fmtMoney(online)} · Карта: ${fmtMoney(card)}\n🕒 ${at}`
    }
    if (entry.action === 'delete') {
      return `🗑 <b>${escapeTelegramHtml(actorLabel)}</b> удалила доход${where}\n🕒 ${at}`
    }
    if (entry.action.startsWith('update')) {
      return `✏️ <b>${escapeTelegramHtml(actorLabel)}</b> изменила доход${where}\n🕒 ${at}`
    }
  }

  if (entry.entityType === 'expense') {
    const cash = toNum(payload.cash_amount)
    const kaspi = toNum(payload.kaspi_amount)
    const total = toNum(payload.total_amount) || (cash + kaspi)
    const category = String(payload.category || '').trim()
    const categoryLabel = category ? ` · категория: <b>${escapeTelegramHtml(category)}</b>` : ''
    if (entry.action === 'create') {
      return `📉 <b>${escapeTelegramHtml(actorLabel)}</b> добавила расход: <b>${fmtMoney(total)}</b>${where}${categoryLabel}\n` +
        `Нал: ${fmtMoney(cash)} · Kaspi: ${fmtMoney(kaspi)}\n🕒 ${at}`
    }
    if (entry.action === 'delete') {
      return `🗑 <b>${escapeTelegramHtml(actorLabel)}</b> удалила расход${where}${categoryLabel}\n🕒 ${at}`
    }
    if (entry.action.startsWith('update')) {
      return `✏️ <b>${escapeTelegramHtml(actorLabel)}</b> изменила расход${where}${categoryLabel}\n🕒 ${at}`
    }
  }

  return `🧾 <b>${escapeTelegramHtml(actorLabel)}</b> выполнила действие <code>${escapeTelegramHtml(entry.entityType)}</code> / <code>${escapeTelegramHtml(entry.action)}</code>${where}\n🕒 ${at}`
}

async function notifyLeaderAudit(entry: AuditEntry) {
  try {
    if (!entry.actorUserId) return
    const targetChatId = process.env.TELEGRAM_SUPERADMIN_CHAT_ID
    if (!targetChatId) return

    const actor = await resolveLeaderActor(entry.actorUserId)
    if (!actor.isLeader) return

    const text = await buildHumanAuditMessage(entry, actor.label)
    await sendTelegram(text, targetChatId)
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
