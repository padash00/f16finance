import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOrgReportTargets } from '@/lib/server/report-targets'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const PENDING_THRESHOLD_MS = 30 * 60 * 1000 // очередь висит дольше 30 минут
const REALERT_MS = 2 * 60 * 60 * 1000 // напоминание не чаще раза в 2 часа
const OFFLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // касса не на связи 2+ часа
const WORK_HOUR_START = 10 // рабочее окно по Алматы (UTC+5) для алерта «не на связи»

/**
 * Cron (каждые 30 мин): алерт владельцу про кассы, у которых
 *  1) локальная офлайн-очередь продаж висит дольше 30 минут, или
 *  2) касса не выходила на связь 2+ часа в рабочее время.
 * Данные приходят из sync-check (x-pending-sales), анти-спам — раз в 2 часа.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = process.env.CRON_SECRET
    if (secret && url.searchParams.get('secret') !== secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (!hasAdminSupabaseCredentials()) return json({ ok: true, skipped: 'no-admin-creds' })

    const supabase = createAdminSupabaseClient()
    const { data: devices, error } = await supabase
      .from('point_devices')
      .select('id, name, company_id, pending_sales_count, attention_sales_count, pending_since, last_offline_alert_at, last_seen_at, company:company_id(name)')
      .eq('is_active', true)
    if (error) {
      // Колонок нет до миграции 20260722 — тихо выходим
      if (String(error.message || '').includes('column')) return json({ ok: true, skipped: 'migration-pending' })
      throw error
    }

    const now = Date.now()
    const almatyHour = new Date(now + 5 * 3600 * 1000).getUTCHours()
    const inWorkHours = almatyHour >= WORK_HOUR_START // клуб работает до ночи — верхнюю границу не режем

    // Считаем алерт по каждой кассе один раз, запоминая её company_id для группировки по орг.
    type DeviceAlert = { deviceId: string; companyId: string | null; text: string }
    const deviceAlerts: DeviceAlert[] = []

    for (const d of (devices as any[]) || []) {
      const company = Array.isArray(d.company) ? d.company[0] : d.company
      const label = `${company?.name || '—'} · ${d.name || 'касса'}`
      const companyId = d.company_id ? String(d.company_id) : null
      const lastAlert = d.last_offline_alert_at ? new Date(d.last_offline_alert_at).getTime() : 0
      if (now - lastAlert < REALERT_MS) continue

      const pending = Number(d.pending_sales_count || 0)
      const attention = Number(d.attention_sales_count || 0)
      const pendingSince = d.pending_since ? new Date(d.pending_since).getTime() : 0
      const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0

      if ((pending > 0 || attention > 0) && pendingSince && now - pendingSince > PENDING_THRESHOLD_MS) {
        const sinceStr = new Date(pendingSince + 5 * 3600 * 1000).toISOString().slice(11, 16)
        const parts: string[] = []
        if (pending > 0) parts.push(`${pending} не отправлено`)
        if (attention > 0) parts.push(`${attention} требуют внимания (отказ сервера)`)
        deviceAlerts.push({ deviceId: String(d.id), companyId, text: `⚠️ <b>${label}</b>: ${parts.join(', ')} — с ${sinceStr}` })
        continue
      }

      if (inWorkHours && lastSeen && now - lastSeen > OFFLINE_THRESHOLD_MS) {
        const hours = Math.floor((now - lastSeen) / 3600000)
        deviceAlerts.push({ deviceId: String(d.id), companyId, text: `🔌 <b>${label}</b>: касса не выходила на связь ${hours} ч` })
      }
    }

    const alertedIds: string[] = []
    const send = async (chatId: string, group: DeviceAlert[]) => {
      if (group.length === 0) return
      await sendTelegramMessage(
        chatId,
        `<b>Офлайн-продажи / связь касс</b>\n\n${group.map((a) => a.text).join('\n')}\n\nЗастрявшие продажи: касса → экран «Очередь» → «Отправить сейчас».`,
      )
      alertedIds.push(...group.map((a) => a.deviceId))
    }

    // Изоляция: кассы группируем по организации, каждой орг — только её кассы в её чат.
    // Если per-org целей нет — прежнее поведение (единый админ-чат по всем кассам).
    const orgTargets = await listOrgReportTargets()
    if (orgTargets.length > 0) {
      for (const t of orgTargets) {
        const allowed = new Set(t.companyIds || [])
        const group = deviceAlerts.filter((a) => a.companyId && allowed.has(a.companyId))
        await send(t.chatId, group)
      }
    } else {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID
      if (!chatId) return json({ ok: true, skipped: 'no-chat' })
      await send(chatId, deviceAlerts)
    }

    if (alertedIds.length > 0) {
      const nowIso = new Date().toISOString()
      await supabase.from('point_devices').update({ last_offline_alert_at: nowIso }).in('id', alertedIds)
    }

    return json({ ok: true, alerted: alertedIds.length })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'cron/offline-sales-alert', message: error?.message || 'error' })
    return json({ error: error?.message || 'error' }, 500)
  }
}
