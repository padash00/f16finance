/**
 * AI tool: оприходование товара без поставщика (излишки, корректировка остатка).
 * Использует тот же RPC inventory_post_receipt но без supplier/invoice —
 * быстрая форма для типичных случаев "нашли неучтённое".
 *
 * Capability: receipts.create (та же что и для приёмки)
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addStockTool: CopilotTool = {
  name: 'add_stock',
  category: 'inventory',
  description: 'Оприходовать товар (быстро, без поставщика — для излишков/корректировок)',
  requiredCapability: 'receipts.create',
  severity: 'medium',
  params: [
    {
      name: 'location_id',
      label: 'Куда добавляем',
      type: 'select',
      required: true,
      description: 'Склад или витрина',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('inventory_locations')
          .select('id, name, kind, company:company_id(name)')
          .order('name')
        return (data || []).map((l: any) => {
          const co = Array.isArray(l.company) ? l.company[0] : l.company
          const kindLabel = l.kind === 'warehouse' ? '🏭' : '🛍'
          return { value: l.id, label: `${kindLabel} ${l.name}${co?.name ? ` · ${co.name}` : ''}` }
        })
      },
    },
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Что добавляем',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_items').select('id, name').order('name')
        return (data || []).map((i: any) => ({ value: i.id, label: i.name }))
      },
    },
    {
      name: 'quantity',
      label: 'Количество',
      type: 'number',
      required: true,
      description: 'Сколько шт оприходовать',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: true,
      description: 'Почему оприходование',
      extractHint: 'излишки при ревизии',
    },
  ],
  handler: async (input, ctx) => {
    const locationId = String(input.location_id || '')
    const itemId = String(input.item_id || '')
    const qty = Number(input.quantity || 0)
    const reason = String(input.reason || '').trim()

    if (!locationId || !itemId || qty <= 0 || !reason) {
      return { ok: false, message: 'Не хватает данных.' }
    }

    // Мультитенантная изоляция: оприходовать можно только в место хранения своей организации.
    // inventory_items — глобальный каталог (без company_id), скоуп — через локацию.
    const ids = await scopedCompanyIds(ctx)
    if (ids) {
      const { data: loc } = await ctx.supabase
        .from('inventory_locations')
        .select('id, company_id')
        .eq('id', locationId)
        .single()
      if (!loc || (loc.company_id && !ids.includes(String(loc.company_id)))) {
        return { ok: false, message: 'Место хранения не найдено.' }
      }
    }

    // unit_cost = 0 для оприходования без накладной (это не закупка)
    const itemsJson = [{ item_id: itemId, quantity: qty, unit_cost: 0, total_cost: 0 }]

    const { data, error } = await ctx.supabase.rpc('inventory_post_receipt', {
      p_location_id: locationId,
      p_received_at: todayISO(),
      p_supplier_id: null,
      p_invoice_number: null,
      p_comment: `Оприходование: ${reason}`,
      p_created_by: ctx.userId,
      p_items: itemsJson,
    })

    if (error) return { ok: false, message: `Не удалось оприходовать: ${error.message}` }

    const receiptRow = Array.isArray(data) ? data[0] : data
    const receiptId = receiptRow?.receipt_id ? String(receiptRow.receipt_id) : 'unknown'

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-receipt',
        entityId: receiptId,
        action: 'add-stock',
        payload: { location_id: locationId, item_id: itemId, quantity: qty, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Оприходовано ${qty} шт. Причина: ${reason}. Остаток обновлён.` }
  },
}
