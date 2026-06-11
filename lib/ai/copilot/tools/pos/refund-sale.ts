/**
 * AI tool: возврат продажи (refund).
 * Capability: pos.refund
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds } from '../../query-helpers'

export const refundSaleTool: CopilotTool = {
  name: 'refund_sale',
  category: 'pos',
  description: 'Оформить возврат продажи (refund)',
  requiredCapability: 'pos.refund',
  severity: 'high',
  params: [
    {
      name: 'sale_id',
      label: 'Какая продажа',
      type: 'select',
      required: true,
      description: 'ID продажи',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('point_sales')
          .select('id, total_amount, created_at, company:company_id(name)')
          .is('refunded_at', null)
          .order('created_at', { ascending: false })
          .limit(50)
        return (data || []).map((s: any) => {
          const co = Array.isArray(s.company) ? s.company[0] : s.company
          const date = s.created_at ? new Date(s.created_at).toLocaleString('ru-RU') : ''
          return { value: s.id, label: `${date} · ${co?.name || ''} · ${Number(s.total_amount || 0).toLocaleString('ru-RU')} ₸` }
        })
      },
    },
    {
      name: 'reason',
      label: 'Причина возврата',
      type: 'string',
      required: true,
      description: 'Почему возвращаем',
    },
  ],
  handler: async (input, ctx) => {
    const saleId = String(input.sale_id || '')
    const reason = String(input.reason || '').trim()
    if (!saleId || !reason) return { ok: false, message: 'Нужны продажа и причина.' }

    const { data: sale } = await ctx.supabase.from('point_sales').select('id, total_amount, refunded_at, company_id').eq('id', saleId).single()
    if (!sale) return { ok: false, message: 'Продажа не найдена.' }

    // Мультитенантная изоляция: возврат можно оформить только по продаже своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids && sale.company_id && !ids.includes(String(sale.company_id))) {
      return { ok: false, message: 'Продажа не найдена.' }
    }
    if (sale.refunded_at) return { ok: false, message: 'Уже возвращена.' }

    const { error } = await ctx.supabase
      .from('point_sales')
      .update({ refunded_at: new Date().toISOString(), refund_reason: reason })
      .eq('id', saleId)
    if (error) return { ok: false, message: `Не удалось вернуть: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'pos-sale',
        entityId: saleId,
        action: 'refund',
        payload: { total: sale.total_amount, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `↩️ Возврат на ${Number(sale.total_amount).toLocaleString('ru-RU')} ₸ оформлен. Причина: ${reason}` }
  },
}
