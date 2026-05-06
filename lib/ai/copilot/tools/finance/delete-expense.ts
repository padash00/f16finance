/**
 * AI tool: удалить расход.
 * Capability: expenses.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const deleteExpenseTool: CopilotTool = {
  name: 'delete_expense',
  category: 'finance',
  description: 'Удалить расход (ошибочный или дублирующий)',
  requiredCapability: 'expenses.delete',
  severity: 'high',
  params: [
    {
      name: 'expense_id',
      label: 'Какой расход',
      type: 'select',
      required: true,
      description: 'ID последних расходов',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('expenses')
          .select('id, date, category, cash_amount, kaspi_amount, comment, company:companies!company_id(name)')
          .order('created_at', { ascending: false })
          .limit(20)
        return (data || []).map((e: any) => {
          const co = Array.isArray(e.company) ? e.company[0] : e.company
          const sum = Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
          return {
            value: e.id,
            label: `${e.date} · ${co?.name || ''} · ${sum.toLocaleString('ru-RU')} ₸ · ${e.category}`,
          }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const expenseId = String(input.expense_id || '')
    if (!expenseId) return { ok: false, message: 'Не выбран расход.' }

    const { data: exp, error: getErr } = await ctx.supabase
      .from('expenses')
      .select('id, cash_amount, kaspi_amount, category, date')
      .eq('id', expenseId)
      .single()
    if (getErr || !exp) return { ok: false, message: 'Расход не найден.' }

    const { error } = await ctx.supabase.from('expenses').delete().eq('id', expenseId)
    if (error) return { ok: false, message: `Не удалось удалить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'delete',
        payload: { date: exp.date, category: exp.category, sum: Number(exp.cash_amount || 0) + Number(exp.kaspi_amount || 0), via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🗑 Расход удалён.` }
  },
}
