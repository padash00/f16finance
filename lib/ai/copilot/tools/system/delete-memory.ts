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
        const { data } = await ctx.supabase.from('ai_memory').select('id, key, value').order('created_at', { ascending: false }).limit(50)
        return (data || []).map((m: any) => ({ value: m.id, label: `${m.key}: ${String(m.value).slice(0, 30)}` }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const memoryId = String(input.memory_id || '')
    if (!memoryId) return { ok: false, message: 'Не выбран факт.' }

    const { data: before } = await ctx.supabase.from('ai_memory').select('key').eq('id', memoryId).single()
    const { error } = await ctx.supabase.from('ai_memory').delete().eq('id', memoryId)
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
