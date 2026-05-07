/**
 * AI tool: удалить запись о доходе.
 * Capability: income.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { resolveCompanyNames } from '../../query-helpers'

export const deleteIncomeTool: CopilotTool = {
  name: 'delete_income',
  category: 'finance',
  description: 'Удалить запись о выручке',
  requiredCapability: 'income.delete',
  severity: 'high',
  params: [
    {
      name: 'income_id',
      label: 'Какую запись',
      type: 'select',
      required: true,
      description: 'ID последних записей выручки',
      getOptions: async (ctx) => {
        const { data, error } = await ctx.supabase
          .from('incomes')
          .select('id, date, shift, cash_amount, kaspi_amount, card_amount, online_amount, company_id')
          .order('date', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[copilot] delete-income getOptions ERROR:', JSON.stringify(error))
          return []
        }
        const rows = data || []
        const companyMap = await resolveCompanyNames(ctx.supabase, rows as any)
        return rows.map((i: any) => {
          const total = Number(i.cash_amount || 0) + Number(i.kaspi_amount || 0) + Number(i.card_amount || 0) + Number(i.online_amount || 0)
          const co = companyMap.get(String(i.company_id)) || ''
          return {
            value: String(i.id),
            label: `${i.date} ${i.shift === 'night' ? '🌙' : '☀️'} ${co} · ${total.toLocaleString('ru-RU')} ₸`,
          }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const incomeId = String(input.income_id || '')
    if (!incomeId) return { ok: false, message: 'Не выбрана запись.' }

    const { error } = await ctx.supabase.from('incomes').delete().eq('id', incomeId)
    if (error) return { ok: false, message: `Не удалось удалить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'income',
        entityId: incomeId,
        action: 'delete',
        payload: { via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: '🗑 Запись о выручке удалена.' }
  },
}
