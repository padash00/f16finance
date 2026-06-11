/**
 * AI tool: отметить долг клиента (с точки) как оплаченный.
 * Capability: point-debts.mark_paid
 *
 * Работает с таблицей point_debt_items (per-point client debts), которая
 * существует с самого начала проекта. Долги записываются операторами
 * в киоске/POS и видны на странице /point-debts.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { resolveCompanyNames, scopedCompanyIds } from '../../query-helpers'

export const markDebtPaidTool: CopilotTool = {
  name: 'mark_debt_paid',
  category: 'finance',
  description: 'Отметить долг клиента как оплаченный',
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
        const { data, error } = await ctx.supabase
          .from('point_debt_items')
          .select('id, total_amount, client_name, item_name, quantity, created_at, company_id')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) {
          console.error('[copilot] mark-debt-paid getOptions ERROR:', JSON.stringify(error))
          return []
        }
        const rows = data || []
        const companyMap = await resolveCompanyNames(ctx.supabase, rows as any)
        return rows.map((d: any) => {
          const sum = Number(d.total_amount || 0).toLocaleString('ru-RU') + ' ₸'
          const client = (d.client_name || '').trim() || 'Должник'
          const co = companyMap.get(String(d.company_id)) || ''
          return {
            value: String(d.id),
            label: `${co} — ${client} — ${sum}${d.item_name ? ` (${d.item_name})` : ''}`,
          }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const debtId = String(input.debt_id || '')
    if (!debtId) return { ok: false, message: 'Не выбран долг.' }

    const { data: debt, error: getErr } = await ctx.supabase
      .from('point_debt_items')
      .select('id, total_amount, client_name, status, company_id')
      .eq('id', debtId)
      .single()
    if (getErr || !debt) return { ok: false, message: 'Долг не найден.' }

    // Мультитенантная изоляция: закрывать можно только долг своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids && debt.company_id && !ids.includes(String(debt.company_id))) {
      return { ok: false, message: 'Долг не найден.' }
    }
    if (debt.status === 'deleted') return { ok: false, message: 'Долг уже закрыт.' }

    // Помечаем как deleted (это статус "закрыт/оплачен" в point_debt_items)
    const { error } = await ctx.supabase
      .from('point_debt_items')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', debtId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'point-debt',
        entityId: debtId,
        action: 'mark-paid',
        payload: { amount: debt.total_amount, client: debt.client_name, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `✅ Долг ${Number(debt.total_amount).toLocaleString('ru-RU')} ₸ (${debt.client_name || 'клиент'}) отмечен как оплаченный.`,
    }
  },
}
