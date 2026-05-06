/**
 * AI tool: архивировать точку (deactivate).
 * Capability: companies.archive
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const archiveCompanyTool: CopilotTool = {
  name: 'archive_company',
  category: 'system',
  description: 'Архивировать точку (мягкое удаление)',
  requiredCapability: 'companies.archive',
  severity: 'critical',
  params: [
    {
      name: 'company_id',
      label: 'Какую точку архивируем',
      type: 'select',
      required: true,
      description: 'ID точки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').is('archived_at', null).order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    { name: 'reason', label: 'Причина', type: 'string', required: true, description: 'Почему архивируем' },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const reason = String(input.reason || '').trim()
    if (!companyId || !reason) return { ok: false, message: 'Не хватает данных.' }

    const { data: before } = await ctx.supabase.from('companies').select('name').eq('id', companyId).single()
    const { error } = await ctx.supabase
      .from('companies')
      .update({ archived_at: new Date().toISOString(), archive_reason: reason })
      .eq('id', companyId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'company',
        entityId: companyId,
        action: 'archive',
        payload: { name: before?.name, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📦 "${before?.name}" архивирована. Причина: ${reason}` }
  },
}
