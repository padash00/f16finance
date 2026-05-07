/**
 * AI tool: одобрить ожидающий расход.
 * Capability: expenses-pending.approve
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { resolveCompanyNames } from '../../query-helpers'

export const approveExpenseTool: CopilotTool = {
  name: 'approve_expense',
  category: 'finance',
  description: 'Одобрить ожидающий расход (status pending → approved)',
  requiredCapability: 'expenses-pending.approve',
  severity: 'high',
  params: [
    {
      name: 'expense_id',
      label: 'Какой расход',
      type: 'select',
      required: true,
      description: 'ID ожидающего расхода',
      getOptions: async (ctx) => {
        const { data, error } = await ctx.supabase
          .from('expenses')
          .select('id, date, category, cash_amount, kaspi_amount, comment, one_off_payee, company_id')
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[copilot] approve-expense getOptions ERROR:', JSON.stringify(error))
          return []
        }
        const rows = data || []
        const companyMap = await resolveCompanyNames(ctx.supabase, rows as any)
        return rows.map((e: any) => {
          const sum = Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
          const payee = e.one_off_payee || e.category
          const co = companyMap.get(String(e.company_id)) || ''
          return {
            value: String(e.id),
            label: `${co} · ${sum.toLocaleString('ru-RU')} ₸ · ${payee}`,
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
      .select('id, status, cash_amount, kaspi_amount, category')
      .eq('id', expenseId)
      .single()
    if (getErr || !exp) return { ok: false, message: 'Расход не найден.' }
    if (exp.status === 'approved') return { ok: false, message: 'Уже одобрен.' }

    const { error } = await ctx.supabase
      .from('expenses')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: ctx.userId })
      .eq('id', expenseId)
    if (error) return { ok: false, message: `Не удалось одобрить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'approve',
        payload: { via: 'copilot', source: ctx.source },
      })
    } catch {}

    const sum = Number(exp.cash_amount || 0) + Number(exp.kaspi_amount || 0)
    return { ok: true, message: `✅ Расход ${sum.toLocaleString('ru-RU')} ₸ (${exp.category}) одобрен.` }
  },
}

export const declineExpenseTool: CopilotTool = {
  name: 'decline_expense',
  category: 'finance',
  description: 'Отклонить ожидающий расход',
  requiredCapability: 'expenses-pending.decline',
  severity: 'high',
  params: [
    {
      name: 'expense_id',
      label: 'Какой расход',
      type: 'select',
      required: true,
      description: 'ID',
      getOptions: async (ctx) => {
        const { data, error } = await ctx.supabase
          .from('expenses')
          .select('id, date, category, cash_amount, kaspi_amount, one_off_payee, company_id')
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[copilot] decline-expense getOptions ERROR:', JSON.stringify(error))
          return []
        }
        const rows = data || []
        const companyMap = await resolveCompanyNames(ctx.supabase, rows as any)
        return rows.map((e: any) => {
          const sum = Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
          const co = companyMap.get(String(e.company_id)) || ''
          return { value: String(e.id), label: `${co} · ${sum.toLocaleString('ru-RU')} ₸ · ${e.one_off_payee || e.category}` }
        })
      },
    },
    {
      name: 'reason',
      label: 'Причина отклонения',
      type: 'string',
      required: true,
      description: 'Почему отклоняем',
    },
  ],
  handler: async (input, ctx) => {
    const expenseId = String(input.expense_id || '')
    const reason = String(input.reason || '').trim()
    if (!expenseId || !reason) return { ok: false, message: 'Нужны расход и причина.' }

    const { error } = await ctx.supabase
      .from('expenses')
      .update({ status: 'declined', declined_at: new Date().toISOString(), declined_by: ctx.userId, declined_reason: reason })
      .eq('id', expenseId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'decline',
        payload: { reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `❌ Расход отклонён. Причина: ${reason}` }
  },
}
