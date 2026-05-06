/**
 * AI tool: запомнить факт для AI (long-term memory).
 * Capability: нет — доступно всем staff.
 *
 * Сохраняет в telegram_chat_history с пометкой role='system_memory'
 * чтобы AI мог использовать в следующих диалогах.
 */

import type { CopilotTool } from '../../types'

export const saveMemoryTool: CopilotTool = {
  name: 'save_to_memory',
  category: 'system',
  description: 'Запомнить факт чтобы использовать в будущих диалогах',
  // Минимальная capability — у любого staff есть expenses.view
  requiredCapability: 'expenses.view',
  severity: 'low',
  params: [
    {
      name: 'fact',
      label: 'Что запомнить',
      type: 'string',
      required: true,
      description: 'Что нужно запомнить (правило, контакт, предпочтение и т.п.)',
      extractHint: 'Алтынбек — старший на Arena',
    },
  ],
  handler: async (input, ctx) => {
    const fact = String(input.fact || '').trim()
    if (!fact) return { ok: false, message: 'Что запомнить?' }

    const chatKey = ctx.telegramChatId ? String(ctx.telegramChatId) : `web:${ctx.userId}`
    const { error } = await ctx.supabase
      .from('telegram_chat_history')
      .insert([
        {
          chat_id: chatKey,
          role: 'system_memory',
          content: fact,
          created_at: new Date().toISOString(),
        },
      ])
    if (error) return { ok: false, message: `Не удалось сохранить: ${error.message}` }

    return { ok: true, message: `📝 Запомнил: "${fact}"` }
  },
}
