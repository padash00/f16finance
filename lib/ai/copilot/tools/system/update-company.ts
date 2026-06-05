/**
 * AI tool: изменить данные точки.
 * Capability: companies.update
 */

import type { CopilotTool } from '../../types'
import { companyOptions } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

export const updateCompanyTool: CopilotTool = {
  name: 'update_company',
  category: 'system',
  description: 'Изменить название / код / адрес точки',
  requiredCapability: 'companies.update',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Какую точку',
      type: 'select',
      required: true,
      description: 'ID точки',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    { name: 'new_name', label: 'Новое название', type: 'string', required: false, description: 'Если меняем' },
    { name: 'new_code', label: 'Новый код', type: 'string', required: false, description: 'Если меняем' },
    { name: 'new_address', label: 'Новый адрес', type: 'string', required: false, description: 'Если меняем' },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    if (!companyId) return { ok: false, message: 'Не выбрана точка.' }

    const update: Record<string, unknown> = {}
    if (input.new_name) update.name = String(input.new_name).trim()
    if (input.new_code) update.code = String(input.new_code).trim()
    if (input.new_address) update.address = String(input.new_address).trim()
    if (Object.keys(update).length === 0) return { ok: false, message: 'Нечего менять.' }

    // Менять можно только точку своей организации.
    let chkQ = ctx.supabase.from('companies').select('id').eq('id', companyId)
    if (ctx.organizationId) chkQ = chkQ.eq('organization_id', ctx.organizationId)
    const { data: chk } = await chkQ.maybeSingle()
    if (!chk) return { ok: false, message: 'Точка не найдена.' }
    let updQ = ctx.supabase.from('companies').update(update).eq('id', companyId)
    if (ctx.organizationId) updQ = updQ.eq('organization_id', ctx.organizationId)
    const { error } = await updQ
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'company',
        entityId: companyId,
        action: 'update',
        payload: { changes: update, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🏪 Точка обновлена: ${Object.keys(update).join(', ')}` }
  },
}
