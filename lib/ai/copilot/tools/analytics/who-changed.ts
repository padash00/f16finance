/**
 * AI tool: кто и когда менял конкретную сущность.
 * Capability: audit.view
 */

import type { CopilotTool } from '../../types'

export const whoChangedTool: CopilotTool = {
  name: 'who_changed',
  category: 'analytics',
  description: 'Кто менял конкретный объект (расход, смену и т.д.)',
  requiredCapability: 'audit.view',
  severity: 'low',
  params: [
    { name: 'entity_type', label: 'Тип объекта', type: 'string', required: true, description: 'expense / shift / operator / company / etc' },
    { name: 'entity_id', label: 'ID объекта', type: 'string', required: true, description: 'UUID' },
  ],
  handler: async (input, ctx) => {
    const entityType = String(input.entity_type || '').trim()
    const entityId = String(input.entity_id || '').trim()
    if (!entityType || !entityId) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('audit_log')
      .select('action, payload, created_at, actor_user_id')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: 'Записей о изменениях нет.' }

    const lines: string[] = [`📜 История ${entityType} ${entityId.slice(0, 8)}…\n`]
    for (const r of data as any[]) {
      const time = r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : ''
      lines.push(`${time} · ${r.action}`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: data.length } }
  },
}
