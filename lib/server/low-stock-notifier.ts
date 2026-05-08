import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
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

    // Pre-фильтр: только items которые ниже порога
    const triggered = items.filter((item) => {
      const threshold = Number(item.low_stock_threshold)
      if (!threshold || threshold <= 0) return false
      const balance = balanceMap.get(item.id)
      return balance !== undefined && balance !== null && balance <= threshold
    })

    if (triggered.length === 0) return

    // Один SELECT вместо N: проверяем какие items уже алертили в последние 24ч
    const { data: recentLogs } = await supabase
      .from('low_stock_alert_log')
      .select('item_id')
      .in('item_id', triggered.map((i) => i.id))
      .eq('location_id', locationId)
      .gte('sent_at', cutoff)
    const recentItemIds = new Set((recentLogs || []).map((r: any) => String(r.item_id)))

    const toAlert = triggered.filter((item) => !recentItemIds.has(String(item.id)))
    if (toAlert.length === 0) return

    // Один INSERT batch
    await supabase.from('low_stock_alert_log').insert(
      toAlert.map((item) => ({
        item_id: item.id,
        location_id: locationId,
        current_qty: balanceMap.get(item.id),
        threshold: Number(item.low_stock_threshold),
        sent_at: now.toISOString(),
      })),
    )

    // Один SELECT staff (раньше делался N раз)
    const { data: staff } = await supabase
      .from('staff')
      .select('id, telegram_chat_id, full_name')
      .in('role', ['owner', 'manager'])
      .not('telegram_chat_id', 'is', null)

    if (!staff?.length) return

    // Параллельные отправки в Telegram (вместо serial).
    // Заворачиваем в async/await чтобы TS не путался в типах через .catch().
    const sendOne = async (chatId: number, text: string, staffId: string | null) => {
      try {
        await sendTelegramMessage(chatId, text)
      } catch (error) {
        await writeSystemErrorLogSafe({
          area: 'low-stock-notifier',
          scope: 'server',
          message: error instanceof Error ? error.message : String(error),
          payload: { itemIds, locationId, staffId, telegramChatId: chatId },
        })
      }
    }

    const sendPromises: Promise<void>[] = []
    for (const item of toAlert) {
      const balance = balanceMap.get(item.id)
      const unit = item.unit || 'шт'
      const text = [
        `<b>⚠️ Низкий остаток</b>`,
        ``,
        `<b>${escapeTelegramHtml(item.name)}</b>`,
        `📊 Сейчас: <b>${balance}</b> ${escapeTelegramHtml(unit)}`,
        `📏 Порог: <b>${Number(item.low_stock_threshold)}</b> ${escapeTelegramHtml(unit)}`,
        `📍 Точка: <b>${escapeTelegramHtml(locationName)}</b>`,
      ].join('\n')

      for (const member of staff) {
        if (!member.telegram_chat_id) continue
        sendPromises.push(sendOne(Number(member.telegram_chat_id), text, member.id || null))
      }
    }
    await Promise.all(sendPromises)
  } catch (error) {
    await writeSystemErrorLogSafe({
      area: 'low-stock-notifier',
      scope: 'server',
      message: error instanceof Error ? error.message : String(error),
      payload: { itemIds, locationId },
    })
    // Never throw — background task, don't break main flow
  }
}
