/**
 * AI tool: пересчёт остатка товара (выставить точное значение).
 * Capability: warehouse.recount
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds } from '../../query-helpers'

export const recountBalanceTool: CopilotTool = {
  name: 'recount_balance',
  category: 'inventory',
  description: 'Установить точный остаток товара (после ревизии)',
  requiredCapability: 'warehouse.recount',
  severity: 'high',
  params: [
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
      name: 'location_id',
      label: 'Где',
      type: 'select',
      required: true,
      description: 'Склад / витрина',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_locations').select('id, name, kind, company:company_id(name)').order('name')
        return (data || []).map((l: any) => {
          const co = Array.isArray(l.company) ? l.company[0] : l.company
          return { value: l.id, label: `${l.name} (${l.kind === 'warehouse' ? 'склад' : 'витрина'})${co?.name ? ` · ${co.name}` : ''}` }
        })
      },
    },
    { name: 'actual_quantity', label: 'Фактический остаток (шт)', type: 'number', required: true, description: 'Что насчитали' },
    { name: 'comment', label: 'Комментарий', type: 'string', required: false, description: 'Что обнаружили' },
  ],
  handler: async (input, ctx) => {
    const itemId = String(input.item_id || '')
    const locationId = String(input.location_id || '')
    const qty = Number(input.actual_quantity)
    const comment = String(input.comment || '').trim() || null
    if (!itemId || !locationId || isNaN(qty) || qty < 0) return { ok: false, message: 'Не хватает данных.' }

    // Мультитенантная изоляция: пересчитывать можно только место хранения своей организации.
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

    const { data: existing } = await ctx.supabase
      .from('inventory_balances')
      .select('id, quantity')
      .eq('item_id', itemId)
      .eq('location_id', locationId)
      .maybeSingle()

    const before = Number(existing?.quantity || 0)
    const delta = qty - before

    let result
    if (existing) {
      result = await ctx.supabase.from('inventory_balances').update({ quantity: qty }).eq('id', existing.id)
    } else {
      result = await ctx.supabase.from('inventory_balances').insert([{ item_id: itemId, location_id: locationId, quantity: qty }])
    }
    if (result.error) return { ok: false, message: `Не удалось пересчитать: ${result.error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-balance',
        entityId: existing?.id || 'new',
        action: 'recount',
        payload: { item_id: itemId, location_id: locationId, before, after: qty, delta, comment, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const sign = delta > 0 ? '+' : ''
    return { ok: true, message: `📋 Пересчёт: было ${before}, стало ${qty} (${sign}${delta})${comment ? `\nКоммент: ${comment}` : ''}` }
  },
}
