/**
 * AI tool: отметить долг точки как оплаченный.
 * Capability: point-debts.mark_paid
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const markDebtPaidTool: CopilotTool = {
  name: 'mark_debt_paid',
  category: 'finance',
  description: 'Отметить долг точки как оплаченный',
  requiredCapability: 'point-debts.mark_paid',
  severity: 'high',
  params: [
    {
      name: 'debt_id',
      label: 'Какой долг',
      type: 'select',
      required: true,
      description: 'ID долга из списка активных',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('debts')
          .select('id, amount, client_name, created_at, company:companies!company_id(name)')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(20)
        return (data || []).map((d: any) => {
          const company = Array.isArray(d.company) ? d.company[0] : d.company
          const sum = Number(d.amount || 0).toLocaleString('ru-RU') + ' ₸'
          const client = (d.client_name || '').trim() || 'Должник'
          return {
            value: d.id,
            label: `${company?.name || ''} — ${client} — ${sum}`,
          }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const debtId = String(input.debt_id || '')
    if (!debtId) return { ok: false, message: 'Не выбран долг.' }

    const { data: debt, error: getErr } = await ctx.supabase
      .from('debts')
      .select('id, amount, client_name, status')
      .eq('id', debtId)
      .single()
    if (getErr || !debt) return { ok: false, message: 'Долг не найден.' }
    if (debt.status === 'paid') return { ok: false, message: 'Долг уже отмечен как оплаченный.' }

    const { error } = await ctx.supabase
      .from('debts')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', debtId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'debt',
        entityId: debtId,
        action: 'mark-paid',
        payload: { amount: debt.amount, client: debt.client_name, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Долг ${Number(debt.amount).toLocaleString('ru-RU')} ₸ (${debt.client_name || 'клиент'}) отмечен как оплаченный.`,
    }
  },
}
