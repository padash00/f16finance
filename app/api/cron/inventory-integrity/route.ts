/**
 * Cron: проверка целостности инвентаря.
 *
 * Вызывает SQL функцию public.inventory_integrity_check() и:
 *  - возвращает JSON с расхождениями (для проверки руками или из админки)
 *  - если расхождения есть И передан Bearer CRON_SECRET — шлёт сводку в Telegram
 *
 * Использование:
 *   1. Vercel Cron: GET /api/cron/inventory-integrity с Authorization: Bearer ${CRON_SECRET}
 *   2. Вручную (от админа): GET /api/cron/inventory-integrity?dry=1 — только JSON, без Telegram
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

type IntegrityRow = {
  severity: 'critical' | 'error' | 'warning'
  category: string
  location_id: string | null
  location_name: string | null
  location_type: string | null
  item_id: string | null
  item_name: string | null
  expected_qty: number | null
  actual_qty: number | null
  diff: number | null
  detail: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  balance_vs_movements: 'Баланс не сходится с движениями',
  negative_balance: 'Отрицательный остаток',
  warehouse_exceeds_catalog: 'Подсобка превышает каталог',
  orphan_movement: 'Движение без локации',
}

function formatRow(r: IntegrityRow): string {
  const cat = CATEGORY_LABELS[r.category] || r.category
  const itemPart = r.item_name ? `«${r.item_name}»` : '—'
  const locPart = r.location_name ? `на «${r.location_name}» (${r.location_type || '?'})` : ''
  const diffPart =
    r.diff != null && r.expected_qty != null && r.actual_qty != null
      ? ` — учёт ${r.expected_qty}, факт ${r.actual_qty}, разница ${r.diff > 0 ? '+' : ''}${r.diff}`
      : ''
  return `• [${r.severity}] ${cat}: ${itemPart} ${locPart}${diffPart}`
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const dry = url.searchParams.get('dry') === '1'
    const auth = req.headers.get('authorization') || ''
    const cronSecret = process.env.CRON_SECRET || ''

    // Авторизация: либо валидный Bearer (для Vercel cron), либо аутентифицированный админ
    const isCron = cronSecret && auth === `Bearer ${cronSecret}`
    if (!isCron) {
      const access = await getRequestAccessContext(req)
      if ('response' in access) return access.response
      if (!access.isSuperAdmin && access.staffRole !== 'owner') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase.rpc('inventory_integrity_check')
    if (error) throw error

    const rows = (data || []) as IntegrityRow[]
    const counts = {
      total: rows.length,
      critical: rows.filter((r) => r.severity === 'critical').length,
      error: rows.filter((r) => r.severity === 'error').length,
      warning: rows.filter((r) => r.severity === 'warning').length,
      by_category: {} as Record<string, number>,
    }
    for (const r of rows) {
      counts.by_category[r.category] = (counts.by_category[r.category] || 0) + 1
    }

    // Telegram-уведомление: только при cron-вызове и если есть проблемы
    if (isCron && !dry && rows.length > 0) {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID
      if (chatId) {
        const top = rows.slice(0, 15).map(formatRow).join('\n')
        const more = rows.length > 15 ? `\n…ещё ${rows.length - 15} расхождений` : ''
        const message =
          `⚠ <b>Инвентарь — расхождения</b>\n` +
          `Всего: <b>${counts.total}</b> ` +
          `(критичных: ${counts.critical}, ошибок: ${counts.error}, предупреждений: ${counts.warning})\n\n` +
          top +
          more
        try {
          await sendTelegramMessage(chatId, message, { parseMode: 'HTML' })
        } catch (tgError: any) {
          await writeSystemErrorLogSafe({
            scope: 'server',
            area: 'cron/inventory-integrity.telegram',
            message: tgError?.message || 'telegram failed',
          })
        }
      }
    }

    return NextResponse.json({ ok: true, counts, rows })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/inventory-integrity',
      message: error?.message || 'integrity check failed',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 })
  }
}
