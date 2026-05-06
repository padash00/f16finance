/**
 * AI tool: создать новую точку (companies row).
 * Capability: companies.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createCompanyTool: CopilotTool = {
  name: 'create_company',
  category: 'system',
  description: 'Создать новую точку (филиал)',
  requiredCapability: 'companies.create',
  severity: 'high',
  params: [
    { name: 'name', label: 'Название точки', type: 'string', required: true, description: 'Как называется' },
    { name: 'code', label: 'Код / короткое имя', type: 'string', required: false, description: 'Например ALM-1', extractHint: 'ALM-1' },
    { name: 'address', label: 'Адрес', type: 'string', required: false, description: 'Опционально' },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const code = String(input.code || '').trim() || null
    const address = String(input.address || '').trim() || null
    if (!name) return { ok: false, message: 'Название обязательно.' }

    const { data, error } = await ctx.supabase
      .from('companies')
      .insert([{ name, code, address }])
      .select('id, name, code')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'company',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, code, address, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🏪 Точка "${data?.name}"${data?.code ? ` (${data.code})` : ''} создана.` }
  },
}
