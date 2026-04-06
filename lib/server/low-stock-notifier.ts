import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

export async function checkAndNotifyLowStock(
  itemIds: string[],
  locationId: string,
): Promise<void> {
  try {
    if (!itemIds.length || !locationId) return

    const supabase = createAdminSupabaseClient()

    // 1. Fetch current balances for given itemIds at locationId
    const { data: balances } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .eq('location_id', locationId)
      .in('item_id', itemIds)

    if (!balances?.length) return

    // 2. Fetch item details (name, unit, low_stock_threshold)
    const { data: items } = await supabase
      .from('inventory_items')
      .select('id, name, unit, low_stock_threshold')
      .in('id', itemIds)
      .not('low_stock_threshold', 'is', null)

    if (!items?.length) return

    // 3. Fetch location name
    const { data: locationRow } = await supabase
      .from('inventory_locations')
      .select('name')
      .eq('id', locationId)
      .maybeSingle()

    const locationName = locationRow?.name || locationId

    // Build balance map
    const balanceMap = new Map<string, number>()
    for (const b of balances) {
      balanceMap.set(b.item_id, Number(b.quantity || 0))
    }

    // 4. Check thresholds and send alerts
    const now = new Date()
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    for (const item of items) {
      const threshold = Number(item.low_stock_threshold)
      if (!threshold || threshold <= 0) continue

      const balance = balanceMap.get(item.id) ?? null
      if (balance === null || balance > threshold) continue

      // 3a. Check if alert was sent in last 24h
      const { data: recentLog } = await supabase
        .from('low_stock_alert_log')
        .select('id')
        .eq('item_id', item.id)
        .eq('location_id', locationId)
        .gte('sent_at', cutoff)
        .limit(1)
        .maybeSingle()

      if (recentLog?.id) continue

      // 3b. Insert into low_stock_alert_log
      await supabase.from('low_stock_alert_log').insert({
        item_id: item.id,
        location_id: locationId,
        current_qty: balance,
        threshold,
        sent_at: now.toISOString(),
      })

      // 3c. Build Telegram message
      const unit = item.unit || 'шт'
      const text = [
        `<b>⚠️ Низкий остаток</b>`,
        ``,
        `<b>${escapeTelegramHtml(item.name)}</b>`,
        `📊 Сейчас: <b>${balance}</b> ${escapeTelegramHtml(unit)}`,
        `📏 Порог: <b>${threshold}</b> ${escapeTelegramHtml(unit)}`,
        `📍 Точка: <b>${escapeTelegramHtml(locationName)}</b>`,
      ].join('\n')

      // 3d. Fetch all staff with telegram_chat_id and role in ('owner', 'manager')
      const { data: staff } = await supabase
        .from('staff')
        .select('telegram_chat_id, full_name')
        .in('role', ['owner', 'manager'])
        .not('telegram_chat_id', 'is', null)

      if (!staff?.length) continue

      // 3e. Send Telegram message to each
      for (const member of staff) {
        if (!member.telegram_chat_id) continue
        await sendTelegramMessage(Number(member.telegram_chat_id), text).catch(() => null)
      }
    }
  } catch {
    // Never throw — background task, don't break main flow
  }
}
