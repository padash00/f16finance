/**
 * AI tool: что пользователь может делать (его доступные действия/права).
 * Read-only, доступен всем (requiredCapability '*').
 */

import type { CopilotTool } from '../../types'
import { getToolsForUser } from '../../registry'

const CAT_LABEL: Record<string, string> = {
  finance: 'Финансы', salary: 'Зарплата', shifts: 'Смены', inventory: 'Склад',
  team: 'Команда', pos: 'POS / лояльность', tasks: 'Задачи', analytics: 'Аналитика', system: 'Система',
}

export const listMyActionsTool: CopilotTool = {
  name: 'list_my_actions',
  category: 'system',
  description: 'Что я могу делать / какие у меня права и возможности в системе. Вызывай на «что ты можешь», «что я могу», «какие у меня права», «список функций».',
  requiredCapability: '*',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const tools = getToolsForUser(ctx)
    if (tools.length === 0) {
      return { ok: true, message: 'У тебя пока нет доступа к действиям. Обратись к администратору.', data: { actions: [] } }
    }
    const byCat = new Map<string, string[]>()
    for (const t of tools) {
      if (t.requiredCapability === '*') continue // мета-инструменты не перечисляем
      const arr = byCat.get(t.category) || []
      arr.push(t.description)
      byCat.set(t.category, arr)
    }
    const lines: string[] = []
    for (const [cat, arr] of byCat) {
      lines.push(`${CAT_LABEL[cat] || cat}: ${arr.slice(0, 12).join('; ')}`)
    }
    return {
      ok: true,
      message: lines.join('\n'),
      data: { count: tools.length, categories: Object.fromEntries(byCat) },
    }
  },
}
