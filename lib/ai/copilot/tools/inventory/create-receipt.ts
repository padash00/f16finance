/**
 * AI tool: оформить приход (приёмку) товара от поставщика.
 * Использует Supabase RPC inventory_post_receipt — атомарно создаёт
 * receipt header + items + обновляет balances + пишет movement.
 *
 * Capability: receipts.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const createReceiptTool: CopilotTool = {
  name: 'create_receipt',
  category: 'inventory',
  description: 'Оформить приход товара от поставщика (один товар за раз)',
  requiredCapability: 'receipts.create',
  severity: 'medium',
  params: [
    {
      name: 'location_id',
      label: 'На какой склад',
      type: 'select',
      required: true,
      description: 'Склад приёмки',
      getOptions: async (ctx) => {
        // Только склады, не витрины
        const { data } = await ctx.supabase
          .from('inventory_locations')
          .select('id, name, kind, company:company_id(name)')
          .eq('kind', 'warehouse')
          .order('name')
        return (data || []).map((l: any) => {
          const co = Array.isArray(l.company) ? l.company[0] : l.company
          return { value: l.id, label: `${l.name}${co?.name ? ` · ${co.name}` : ''}` }
        })
      },
    },
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Что приходим',
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
      description: 'Сколько шт',
    },
    {
      name: 'unit_cost',
      label: 'Цена закупки за единицу (₸)',
      type: 'number',
      required: true,
      description: 'Закупочная цена за 1 шт',
    },
    {
      name: 'supplier_id',
      label: 'Поставщик',
      type: 'select',
      required: false,
      description: 'От кого пришло',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_suppliers').select('id, name').order('name')
        return (data || []).map((s: any) => ({ value: s.id, label: s.name }))
      },
    },
    {
      name: 'invoice_number',
      label: 'Номер накладной',
      type: 'string',
      required: false,
      description: 'Опционально',
    },
  ],
  handler: async (input, ctx) => {
    const locationId = String(input.location_id || '')
    const itemId = String(input.item_id || '')
    const qty = Number(input.quantity || 0)
    const unitCost = Number(input.unit_cost || 0)
    const supplierId = input.supplier_id ? String(input.supplier_id) : null
    const invoiceNumber = input.invoice_number ? String(input.invoice_number).trim() || null : null

    if (!locationId || !itemId || qty <= 0 || unitCost < 0) {
      return { ok: false, message: 'Не хватает данных.' }
    }

    const totalCost = qty * unitCost
    const itemsJson = [{ item_id: itemId, quantity: qty, unit_cost: unitCost, total_cost: totalCost }]

    const { data, error } = await ctx.supabase.rpc('inventory_post_receipt', {
      p_location_id: locationId,
      p_received_at: todayISO(),
      p_supplier_id: supplierId,
      p_invoice_number: invoiceNumber,
      p_comment: null,
      p_created_by: ctx.userId,
      p_items: itemsJson,
    })

    if (error) return { ok: false, message: `Не удалось оприходовать: ${error.message}` }

    // RPC возвращает строки (receipt_id, total_amount) — берём первую
    const receiptRow = Array.isArray(data) ? data[0] : data
    const receiptId = receiptRow?.receipt_id ? String(receiptRow.receipt_id) : 'unknown'

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-receipt',
        entityId: receiptId,
        action: 'create',
        payload: { location_id: locationId, item_id: itemId, qty, unit_cost: unitCost, total_cost: totalCost, supplier_id: supplierId, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `📦 Приёмка оформлена: ${qty} шт × ${unitCost.toLocaleString('ru-RU')} ₸ = ${totalCost.toLocaleString('ru-RU')} ₸. Остаток на складе обновлён.`,
      data: { receiptId },
    }
  },
}
