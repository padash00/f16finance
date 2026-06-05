/**
 * AI tool: записать долг клиента.
 * Capability: debts.create
 */

import type { CopilotTool } from '../../types'
import { companyOptions } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

export const addDebtTool: CopilotTool = {
  name: 'add_debt',
  category: 'finance',
  description: 'Записать долг клиента (что должны нам)',
  requiredCapability: 'debts.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Какая точка',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    { name: 'client_name', label: 'Кто должен', type: 'string', required: true, description: 'Имя клиента' },
    { name: 'amount', label: 'Сумма (₸)', type: 'number', required: true, description: 'Сколько должен' },
    { name: 'comment', label: 'Комментарий', type: 'string', required: false, description: 'За что' },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const client = String(input.client_name || '').trim()
    const amount = Number(input.amount || 0)
    const comment = String(input.comment || '').trim() || null
    if (!companyId || !client || amount <= 0) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('debts')
      .insert([{ company_id: companyId, client_name: client, amount, comment, status: 'active' }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'debt',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { client, amount, company_id: companyId, comment, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📋 Долг записан: ${client} — ${amount.toLocaleString('ru-RU')} ₸${comment ? ` (${comment})` : ''}` }
  },
}
