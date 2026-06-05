/**
 * AI tool: удалить запомненный факт.
 * Capability: ai-memory.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const deleteMemoryTool: CopilotTool = {
  name: 'delete_memory',
  category: 'system',
  description: 'Удалить факт из AI-памяти',
  requiredCapability: 'ai-memory.delete',
  severity: 'medium',
  params: [
    {
      name: 'memory_id',
      label: 'Какой факт',
      type: 'select',
      required: true,
      description: 'Что удалить',
      getOptions: async (ctx) => {
        const optQ = ctx.supabase.from('ai_memory').select('id, key, value').order('created_at', { ascending: false }).limit(50)
        const { data } = await (ctx.organizationId ? optQ.eq('organization_id', ctx.organizationId) : optQ.is('organization_id', null))
        return (data || []).map((m: any) => ({ value: m.id, label: `${m.key}: ${String(m.value).slice(0, 30)}` }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const memoryId = String(input.memory_id || '')
    if (!memoryId) return { ok: false, message: 'Не выбран факт.' }

    // Удалять/читать можно только факты своей организации (не по чужому id).
    const beforeQ = ctx.supabase.from('ai_memory').select('key').eq('id', memoryId)
    const { data: before } = await (ctx.organizationId ? beforeQ.eq('organization_id', ctx.organizationId) : beforeQ.is('organization_id', null)).single()
    if (!before) return { ok: false, message: 'Факт не найден.' }
    const delQ = ctx.supabase.from('ai_memory').delete().eq('id', memoryId)
    const { error } = await (ctx.organizationId ? delQ.eq('organization_id', ctx.organizationId) : delQ.is('organization_id', null))
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'ai-memory',
        entityId: memoryId,
        action: 'delete',
        payload: { key: before?.key, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🗑 Факт "${before?.key || ''}" удалён.` }
  },
}
