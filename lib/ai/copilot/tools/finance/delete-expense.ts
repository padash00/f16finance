/**
 * AI tool: удалить расход.
 * Capability: expenses.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds } from '../../query-helpers'

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
        const { data, error } = await ctx.supabase
          .from('expenses')
          .select('id, date, category, cash_amount, kaspi_amount, comment, company_id')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[copilot] delete-expense getOptions ERROR:', JSON.stringify(error))
          return []
        }
        const rows = data || []
        if (rows.length === 0) return []

        // Подгружаем имена точек одним запросом
        const companyIds = Array.from(new Set(rows.map((r: any) => r.company_id).filter(Boolean)))
        const companyMap = new Map<string, string>()
        if (companyIds.length > 0) {
          const { data: companies } = await ctx.supabase
            .from('companies').select('id, name').in('id', companyIds)
          for (const c of (companies || []) as any[]) companyMap.set(String(c.id), c.name || '')
        }

        return rows.map((e: any) => {
          const sum = Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
          const companyName = companyMap.get(String(e.company_id)) || ''
          return {
            value: String(e.id),
            label: `${e.date} · ${companyName} · ${sum.toLocaleString('ru-RU')} ₸ · ${e.category}`,
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
      .select('id, cash_amount, kaspi_amount, category, date, company_id')
      .eq('id', expenseId)
      .single()
    if (getErr || !exp) return { ok: false, message: 'Расход не найден.' }

    // Мультитенантная изоляция: удалять можно только расход своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids && exp.company_id && !ids.includes(String(exp.company_id))) {
      return { ok: false, message: 'Расход не найден.' }
    }

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
