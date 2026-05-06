/**
 * AI tool: обновить расход (изменить сумму, категорию, комментарий).
 * Capability: expenses.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const updateExpenseTool: CopilotTool = {
  name: 'update_expense',
  category: 'finance',
  description: 'Изменить расход (сумма, категория, комментарий)',
  requiredCapability: 'expenses.edit',
  severity: 'high',
  params: [
    {
      name: 'expense_id',
      label: 'Какой расход',
      type: 'select',
      required: true,
      description: 'ID расхода из последних',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('expenses')
          .select('id, date, category, cash_amount, kaspi_amount, comment, company:companies!company_id(name)')
          .order('created_at', { ascending: false })
          .limit(100)
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
    {
      name: 'new_amount',
      label: 'Новая сумма (₸)',
      type: 'number',
      required: false,
      description: 'Если меняем сумму. Если оставить пустым — не меняется.',
    },
    {
      name: 'new_category',
      label: 'Новая категория',
      type: 'select',
      required: false,
      description: 'Если меняем категорию',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('expense_categories').select('name').order('name')
        return (data || []).map((c: any) => ({ value: c.name, label: c.name }))
      },
    },
    {
      name: 'new_comment',
      label: 'Новый комментарий',
      type: 'string',
      required: false,
      description: 'Если хочешь обновить комментарий',
    },
  ],
  handler: async (input, ctx) => {
    const expenseId = String(input.expense_id || '')
    const newAmount = input.new_amount != null ? Number(input.new_amount) : null
    const newCategory = String(input.new_category || '').trim() || null
    const newComment = String(input.new_comment || '').trim() || null
    if (!expenseId) return { ok: false, message: 'Не выбран расход.' }
    if (newAmount == null && !newCategory && newComment == null) {
      return { ok: false, message: 'Нечего менять — укажи сумму, категорию или комментарий.' }
    }

    const { data: existing, error: getErr } = await ctx.supabase
      .from('expenses')
      .select('id, cash_amount, kaspi_amount, category, comment')
      .eq('id', expenseId)
      .single()
    if (getErr || !existing) return { ok: false, message: 'Расход не найден.' }

    const updates: Record<string, unknown> = {}
    if (newAmount != null && newAmount > 0) {
      // Сохраняем пропорцию между cash и kaspi
      const total = Number(existing.cash_amount || 0) + Number(existing.kaspi_amount || 0)
      if (total > 0) {
        updates.cash_amount = (Number(existing.cash_amount || 0) / total) * newAmount
        updates.kaspi_amount = (Number(existing.kaspi_amount || 0) / total) * newAmount
      } else {
        updates.cash_amount = newAmount
        updates.kaspi_amount = 0
      }
    }
    if (newCategory) updates.category = newCategory
    if (newComment != null) updates.comment = newComment

    const { error } = await ctx.supabase.from('expenses').update(updates).eq('id', expenseId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'update',
        payload: { previous: existing, next: updates, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: '✅ Расход обновлён.' }
  },
}
