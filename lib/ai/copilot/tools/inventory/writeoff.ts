/**
 * AI tool: списать товар (брак, недостача, служебное использование).
 * Использует RPC inventory_post_writeoff — атомарно создаёт writeoff
 * header + items + обновляет balances.
 *
 * Capability: store-writeoffs.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const writeoffItemTool: CopilotTool = {
  name: 'writeoff_item',
  category: 'inventory',
  description: 'Списать товар (брак, недостача, служебное использование)',
  requiredCapability: 'store-writeoffs.create',
  severity: 'high',
  params: [
    {
      name: 'location_id',
      label: 'Откуда списываем',
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
      description: 'Какой товар',
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
      description: 'Сколько списать',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'select',
      required: true,
      description: 'Причина списания',
      getOptions: async () => [
        { value: 'damage', label: 'Брак / порча' },
        { value: 'expired', label: 'Просрочка' },
        { value: 'shortage', label: 'Недостача (ревизия)' },
        { value: 'personal_use', label: 'Служебное использование' },
        { value: 'other', label: 'Другое' },
      ],
    },
    {
      name: 'comment',
      label: 'Комментарий',
      type: 'string',
      required: false,
      description: 'Опционально — детали',
    },
  ],
  handler: async (input, ctx) => {
    const locationId = String(input.location_id || '')
    const itemId = String(input.item_id || '')
    const qty = Number(input.quantity || 0)
    const reason = String(input.reason || '')
    const comment = String(input.comment || '').trim() || null

    if (!locationId || !itemId || qty <= 0 || !reason) {
      return { ok: false, message: 'Не хватает данных.' }
    }

    // Мультитенантная изоляция: списывать можно только из места хранения своей организации.
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

    // Тянем последнюю unit_cost для этого товара (чтобы сумма списания была реальной)
    let unitCost = 0
    const { data: lastReceipt } = await ctx.supabase
      .from('inventory_receipt_items')
      .select('unit_cost, receipt:receipt_id(received_at)')
      .eq('item_id', itemId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastReceipt?.unit_cost) unitCost = Number(lastReceipt.unit_cost)

    const totalCost = qty * unitCost
    const itemsJson = [{ item_id: itemId, quantity: qty, unit_cost: unitCost, total_cost: totalCost }]

    const { data, error } = await ctx.supabase.rpc('inventory_post_writeoff', {
      p_location_id: locationId,
      p_written_at: todayISO(),
      p_reason: reason,
      p_comment: comment,
      p_created_by: ctx.userId,
      p_items: itemsJson,
    })

    if (error) return { ok: false, message: `Не удалось списать: ${error.message}` }

    const writeoffRow = Array.isArray(data) ? data[0] : data
    const writeoffId = writeoffRow?.writeoff_id ? String(writeoffRow.writeoff_id) : 'unknown'

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-writeoff',
        entityId: writeoffId,
        action: 'create',
        payload: { location_id: locationId, item_id: itemId, quantity: qty, reason, total_cost: totalCost, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const reasonLabels: Record<string, string> = {
      damage: 'Брак', expired: 'Просрочка', shortage: 'Недостача', personal_use: 'Служ. использование', other: 'Другое',
    }
    const cost = totalCost > 0 ? ` (стоимость ${totalCost.toLocaleString('ru-RU')} ₸)` : ''
    return { ok: true, message: `🗑 Списано ${qty} шт${cost}. Причина: ${reasonLabels[reason] || reason}.` }
  },
}
