/**
 * Cron: алерт регулярной недостачи.
 *
 * Раз в неделю анализирует ревизии за последние 30 дней.
 * Если у товара 3+ ревизий с недостачей — отправляет в Telegram сводку
 * с подсказкой «возможно, воровство».
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { listOrgReportTargets } from '@/lib/server/report-targets'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

type ShortageRow = {
  item_id: string
  item_name: string
  item_barcode: string
  shortage_count: number
  total_shortage_qty: number
  total_shortage_cost: number
  last_shortage_at: string
  affected_locations: string[] | null
}

function fmtMoney(v: number) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const dry = url.searchParams.get('dry') === '1'
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days') || 30)))
    const minCount = Math.max(2, Math.min(20, Number(url.searchParams.get('min_count') || 3)))

    const auth = req.headers.get('authorization') || ''
    const cronSecret = process.env.CRON_SECRET || ''
    const isCron = cronSecret && auth === `Bearer ${cronSecret}`

    let ownerScope = false
    let ownerOrgId: string | null = null
    if (!isCron) {
      const access = await getRequestAccessContext(req)
      if ('response' in access) return access.response
      if (!access.isSuperAdmin && access.staffRole !== 'owner') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      if (!access.isSuperAdmin) {
        ownerScope = true
        ownerOrgId = access.activeOrganization?.id || null
      }
    }

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase.rpc('inventory_recurring_shortages', {
      p_days: days,
      p_min_count: minCount,
    })
    if (error) throw error

    let rows = (data || []) as ShortageRow[]
    // Изоляция: owner видит недостачи только по товарам своей орг (RPC агрегирует по
    // всем; фильтруем по inventory_items.organization_id). Без активной орг — пусто.
    if (ownerScope) {
      if (!ownerOrgId) {
        rows = []
      } else {
        const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean)))
        if (itemIds.length === 0) {
          rows = []
        } else {
          const { data: items } = await supabase
            .from('inventory_items')
            .select('id')
            .in('id', itemIds)
            .eq('organization_id', ownerOrgId)
          const allowed = new Set((items || []).map((i: any) => String(i.id)))
          rows = rows.filter((r) => allowed.has(String(r.item_id)))
        }
      }
    }
    const totalCost = rows.reduce((sum, r) => sum + Number(r.total_shortage_cost || 0), 0)

    if (isCron && !dry && rows.length > 0) {
      const buildMessage = (list: ShortageRow[]) => {
        const cost = list.reduce((sum, r) => sum + Number(r.total_shortage_cost || 0), 0)
        const top = list
          .slice(0, 10)
          .map((r) => {
            const locations = (r.affected_locations || []).filter(Boolean).join(', ') || '—'
            return `• <b>${r.item_name}</b> (${r.item_barcode}): ${r.shortage_count} раз, всего ${r.total_shortage_qty} шт (${fmtMoney(r.total_shortage_cost)}) — ${locations}`
          })
          .join('\n')
        const more = list.length > 10 ? `\n…ещё ${list.length - 10} позиций` : ''
        return (
          `⚠ <b>Регулярная недостача за ${days} дней</b>\n` +
          `Товаров: <b>${list.length}</b> · Общий ущерб: <b>${fmtMoney(cost)}</b>\n\n` +
          top + more +
          `\n\nКандидаты для расследования возможного воровства.`
        )
      }
      const notify = async (chatId: string, list: ShortageRow[]) => {
        if (list.length === 0) return
        try {
          await sendTelegramMessage(chatId, buildMessage(list), { parseMode: 'HTML' })
        } catch (tgError: any) {
          await writeSystemErrorLogSafe({
            scope: 'server',
            area: 'cron/inventory-shortage-alert.telegram',
            message: tgError?.message || 'telegram failed',
          })
        }
      }

      // Изоляция: каждой организации — недостачи только по её товарам в её чат.
      // Нет per-org целей → прежнее поведение (единый env-чат по всем, F16).
      const orgTargets = await listOrgReportTargets()
      if (orgTargets.length > 0) {
        // Карта item_id → organization_id для группировки строк RPC по орг.
        const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean)))
        const itemOrg = new Map<string, string | null>()
        if (itemIds.length > 0) {
          const { data: items } = await supabase
            .from('inventory_items')
            .select('id, organization_id')
            .in('id', itemIds)
          for (const it of (items || []) as any[]) itemOrg.set(String(it.id), it.organization_id ? String(it.organization_id) : null)
        }
        for (const t of orgTargets) {
          await notify(t.chatId, rows.filter((r) => itemOrg.get(String(r.item_id)) === t.organizationId))
        }
      } else {
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID
        if (chatId) await notify(chatId, rows)
      }
    }

    return NextResponse.json({
      ok: true,
      summary: { count: rows.length, total_cost: totalCost, days, min_count: minCount },
      rows,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/inventory-shortage-alert',
      message: error?.message || 'shortage alert failed',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 })
  }
}
