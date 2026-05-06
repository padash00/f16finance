/**
 * AI tool: корректировка бонусов лояльности клиента.
 * Capability: customers.adjust_points
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const adjustLoyaltyTool: CopilotTool = {
  name: 'adjust_loyalty_points',
  category: 'pos',
  description: 'Начислить или списать бонусы лояльности клиенту',
  requiredCapability: 'customers.adjust_points',
  severity: 'high',
  params: [
    {
      name: 'customer_id',
      label: 'Какой клиент',
      type: 'select',
      required: true,
      description: 'ID клиента',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('customers')
          .select('id, name, phone, loyalty_points')
          .order('name')
        return (data || []).map((c: any) => ({
          value: c.id,
          label: `${c.name}${c.phone ? ` (${c.phone})` : ''} · ${c.loyalty_points || 0} баллов`,
        }))
      },
    },
    {
      name: 'delta',
      label: 'Изменение баллов (+ или −)',
      type: 'number',
      required: true,
      description: 'Положительное — начислить, отрицательное — списать',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: true,
      description: 'За что',
    },
  ],
  handler: async (input, ctx) => {
    const customerId = String(input.customer_id || '')
    const delta = Number(input.delta || 0)
    const reason = String(input.reason || '').trim()
    if (!customerId || delta === 0 || !reason) return { ok: false, message: 'Не хватает данных.' }

    const { data: customer } = await ctx.supabase
      .from('customers')
      .select('id, name, loyalty_points')
      .eq('id', customerId)
      .single()
    if (!customer) return { ok: false, message: 'Клиент не найден.' }

    const newPoints = Number(customer.loyalty_points || 0) + delta
    if (newPoints < 0) return { ok: false, message: `Нельзя списать ${Math.abs(delta)} — у клиента только ${customer.loyalty_points} баллов.` }

    const { error } = await ctx.supabase.from('customers').update({ loyalty_points: newPoints }).eq('id', customerId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'customer-loyalty',
        entityId: customerId,
        action: delta > 0 ? 'add-points' : 'subtract-points',
        payload: { name: customer.name, delta, before: customer.loyalty_points, after: newPoints, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const sign = delta > 0 ? '+' : ''
    return {
      ok: true,
      message: `✅ ${customer.name}: ${sign}${delta} баллов. Теперь: ${newPoints}. Причина: ${reason}`,
    }
  },
}
