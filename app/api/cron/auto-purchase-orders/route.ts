/**
 * Cron: автогенерация заявок поставщикам по остаткам.
 *
 * Раз в день:
 *  1. Берёт все активные товары с закреплённым поставщиком.
 *  2. Считает эффективный порог: ручной low_stock_threshold, иначе умный
 *     (расход/день за 30 дней × lead_time_days поставщика × 1.5).
 *  3. Находит товары, где остаток ≤ порога.
 *  4. Группирует по поставщику и создаёт по одной черновой авто-заявке
 *     (is_auto=true, status=draft) на поставщика.
 *  5. Дедуп: если у поставщика уже есть открытый черновик авто-заявки —
 *     пропускаем (чтобы не плодить дубли каждый день).
 *  6. Пингует владельца в Telegram: «N автозаявок ждут отправки».
 *
 * ?dry=1 — показать, что создалось бы, без записи.
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'

const SAFETY_FACTOR = 1.5

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const dry = url.searchParams.get('dry') === '1'

    const auth = req.headers.get('authorization') || ''
    const cronSecret = process.env.CRON_SECRET || ''
    const isCron = cronSecret && auth === `Bearer ${cronSecret}`

    if (!isCron) {
      const access = await getRequestAccessContext(req)
      if ('response' in access) return access.response
      if (!access.isSuperAdmin && access.staffRole !== 'owner') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }

    const supabase = createAdminSupabaseClient()

    // 1. Товары с закреплённым поставщиком.
    const { data: itemRows, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, name, barcode, unit, low_stock_threshold, primary_supplier_id, is_active')
      .not('primary_supplier_id', 'is', null)
      .eq('is_active', true)
    if (itemsError) throw itemsError

    const items = (itemRows || []) as Array<{
      id: string
      name: string
      barcode: string
      unit: string | null
      low_stock_threshold: number | null
      primary_supplier_id: string
    }>
    if (items.length === 0) {
      return NextResponse.json({ ok: true, summary: { items_checked: 0, orders_created: 0 }, created: [] })
    }

    const itemIds = items.map((i) => i.id)
    const supplierIds = Array.from(new Set(items.map((i) => i.primary_supplier_id)))

    // 2. Остатки, скорость расхода, поставщики — параллельно.
    const [balanceRes, consumptionRes, suppliersRes, openAutoRes] = await Promise.all([
      supabase.from('inventory_balances').select('item_id, quantity').in('item_id', itemIds),
      supabase.from('inventory_consumption_rates').select('item_id, avg_daily_consumption').in('item_id', itemIds),
      supabase
        .from('inventory_suppliers')
        .select('id, name, organization_name, organization_id, lead_time_days, sales_rep_name')
        .in('id', supplierIds),
      supabase
        .from('inventory_purchase_orders')
        .select('supplier_id')
        .eq('is_auto', true)
        .eq('status', 'draft')
        .in('supplier_id', supplierIds),
    ])
    if (balanceRes.error) throw balanceRes.error
    if (consumptionRes.error) throw consumptionRes.error
    if (suppliersRes.error) throw suppliersRes.error
    if (openAutoRes.error) throw openAutoRes.error

    const stockByItem = new Map<string, number>()
    for (const row of (balanceRes.data || []) as any[]) {
      const key = String(row.item_id)
      stockByItem.set(key, (stockByItem.get(key) || 0) + Number(row.quantity || 0))
    }
    const consumptionByItem = new Map<string, number>()
    for (const row of (consumptionRes.data || []) as any[]) {
      consumptionByItem.set(String(row.item_id), Number(row.avg_daily_consumption || 0))
    }
    const supplierById = new Map<string, any>()
    for (const s of (suppliersRes.data || []) as any[]) supplierById.set(String(s.id), s)
    // Поставщики, у которых уже есть открытый черновик авто-заявки — пропускаем.
    const suppliersWithOpenAuto = new Set<string>(
      ((openAutoRes.data || []) as any[]).map((r) => String(r.supplier_id)),
    )

    // 3. Низкие позиции, сгруппированные по поставщику.
    const bySupplier = new Map<string, Array<{
      item_id: string
      name: string
      barcode: string
      unit: string | null
      current_qty: number
      threshold: number
      suggested_qty: number
    }>>()

    for (const item of items) {
      const supplier = supplierById.get(item.primary_supplier_id)
      if (!supplier) continue
      if (suppliersWithOpenAuto.has(item.primary_supplier_id)) continue

      const stock = stockByItem.get(item.id) || 0
      const avgDaily = consumptionByItem.get(item.id) || 0
      const leadTime = Number(supplier.lead_time_days ?? 3) || 3
      const smartThreshold = Math.round(avgDaily * leadTime * SAFETY_FACTOR)
      const threshold = item.low_stock_threshold != null ? Number(item.low_stock_threshold) : smartThreshold
      if (threshold <= 0) continue
      if (stock > threshold) continue

      const suggestedQty = Math.max(1, Math.round(threshold * 2 - stock))
      const list = bySupplier.get(item.primary_supplier_id) || []
      list.push({
        item_id: item.id,
        name: item.name,
        barcode: item.barcode,
        unit: item.unit,
        current_qty: stock,
        threshold,
        suggested_qty: suggestedQty,
      })
      bySupplier.set(item.primary_supplier_id, list)
    }

    // 4. Создаём авто-заявки.
    const created: Array<{ supplier_id: string; supplier_name: string; order_id: string | null; item_count: number }> = []
    for (const [supplierId, lowItems] of bySupplier.entries()) {
      if (lowItems.length === 0) continue
      const supplier = supplierById.get(supplierId)
      const supplierName = supplier?.organization_name || supplier?.name || 'Поставщик'

      if (dry) {
        created.push({ supplier_id: supplierId, supplier_name: supplierName, order_id: null, item_count: lowItems.length })
        continue
      }

      const { data: order, error: orderError } = await supabase
        .from('inventory_purchase_orders')
        .insert([
          {
            supplier_id: supplierId,
            organization_id: supplier?.organization_id || null,
            status: 'draft',
            is_auto: true,
            comment: 'Автозаявка по остаткам',
            created_by: null,
          },
        ])
        .select('id')
        .single()
      if (orderError) {
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'cron/auto-purchase-orders.insert_order',
          message: orderError.message || 'order insert failed',
        })
        continue
      }
      const orderId = String(order.id)
      const { error: itemsInsertError } = await supabase
        .from('inventory_purchase_order_items')
        .insert(
          lowItems.map((li) => ({
            order_id: orderId,
            item_id: li.item_id,
            current_qty: li.current_qty,
            threshold: li.threshold,
            suggested_qty: li.suggested_qty,
          })),
        )
      if (itemsInsertError) {
        await supabase.from('inventory_purchase_orders').delete().eq('id', orderId)
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'cron/auto-purchase-orders.insert_items',
          message: itemsInsertError.message || 'order items insert failed',
        })
        continue
      }
      created.push({ supplier_id: supplierId, supplier_name: supplierName, order_id: orderId, item_count: lowItems.length })
    }

    // 5. Telegram-пинг владельцу.
    if (isCron && !dry && created.length > 0) {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID
      if (chatId) {
        const lines = created
          .map((c) => `• <b>${c.supplier_name}</b> — ${c.item_count} позиций`)
          .join('\n')
        const message =
          `🛒 <b>Автозаявки поставщикам</b>\n` +
          `Создано черновиков: <b>${created.length}</b>\n\n` +
          lines +
          `\n\nОткройте «Заявки поставщикам» и отправьте торгпредам.`
        try {
          await sendTelegramMessage(chatId, message, { parseMode: 'HTML' })
        } catch (tgError: any) {
          await writeSystemErrorLogSafe({
            scope: 'server',
            area: 'cron/auto-purchase-orders.telegram',
            message: tgError?.message || 'telegram failed',
          })
        }
      }
    }

    return NextResponse.json({
      ok: true,
      dry,
      summary: {
        items_checked: items.length,
        suppliers_skipped_open_auto: suppliersWithOpenAuto.size,
        orders_created: created.length,
      },
      created,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/auto-purchase-orders',
      message: error?.message || 'auto purchase orders failed',
    })
    return NextResponse.json({ ok: false, error: error?.message || 'error' }, { status: 500 })
  }
}
