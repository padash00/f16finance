/**
 * AI tool: закрыть зарплатный период (заморозить).
 * Capability: salary.lock_period
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const lockPayrollPeriodTool: CopilotTool = {
  name: 'lock_payroll_period',
  category: 'system',
  description: 'Закрыть зарплатный период (после выплат)',
  requiredCapability: 'salary.lock_period',
  severity: 'high',
  params: [
    { name: 'period_start', label: 'Начало периода', type: 'date', required: true, description: 'YYYY-MM-DD' },
    { name: 'period_end', label: 'Конец периода', type: 'date', required: true, description: 'YYYY-MM-DD' },
  ],
  handler: async (input, ctx) => {
    const start = String(input.period_start || '')
    const end = String(input.period_end || '')
    if (!start || !end) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('payroll_periods')
      .insert([{ period_start: start, period_end: end, locked_at: new Date().toISOString(), locked_by: ctx.userId }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'payroll-period',
        entityId: data?.id || 'unknown',
        action: 'lock',
        payload: { period_start: start, period_end: end, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🔒 Период ${start}—${end} закрыт. Изменения зарплатных операций заблокированы.` }
  },
}
