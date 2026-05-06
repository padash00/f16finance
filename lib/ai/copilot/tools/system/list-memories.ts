/**
 * AI tool: показать сохранённые AI-факты.
 * Capability: ai-memory.view
 */

import type { CopilotTool } from '../../types'

export const listMemoriesTool: CopilotTool = {
  name: 'list_memories',
  category: 'system',
  description: 'Показать что AI помнит про команду / бизнес',
  requiredCapability: 'ai-memory.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from('ai_memory')
      .select('id, key, value, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '🧠 AI пока ничего не запомнил.' }

    const lines: string[] = [`🧠 Сохранённых фактов: ${data.length}\n`]
    for (const m of data as any[]) {
      lines.push(`• ${m.key}: ${m.value}`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: data.length } }
  },
}
