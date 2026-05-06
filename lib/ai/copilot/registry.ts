/**
 * Tool Registry — единый каталог всех AI-tools.
 *
 * Tools регистрируются явно (не auto-generation сейчас, чтобы держать
 * контроль над описаниями и параметрами). Auto-generation добавим
 * позже когда покроем критичные actions.
 *
 * Permission filter: getToolsForUser(ctx) возвращает только tools
 * у которых requiredCapability входит в ctx.capabilities.
 */

import type { CopilotTool, CopilotContext } from './types'

const REGISTRY = new Map<string, CopilotTool>()

export function registerTool(tool: CopilotTool): void {
  if (REGISTRY.has(tool.name)) {
    throw new Error(`Copilot tool already registered: ${tool.name}`)
  }
  REGISTRY.set(tool.name, tool)
}

export function getTool(name: string): CopilotTool | null {
  return REGISTRY.get(name) || null
}

export function getAllTools(): CopilotTool[] {
  return Array.from(REGISTRY.values())
}

/**
 * Возвращает tools доступные конкретному пользователю.
 * Super-admin видит все. Остальные — только те у которых есть capability.
 */
export function getToolsForUser(ctx: CopilotContext): CopilotTool[] {
  const all = getAllTools()
  if (ctx.isSuperAdmin) return all
  return all.filter((tool) => ctx.capabilities.has(tool.requiredCapability))
}

/**
 * Получить compact описание tools для inclusion в системный промпт LLM.
 * Чтобы LLM знал какие действия может предложить.
 */
export function describeToolsForPrompt(tools: CopilotTool[]): string {
  if (tools.length === 0) return 'У пользователя нет доступа к действиям. Можешь только отвечать на вопросы.'

  const byCategory = new Map<string, CopilotTool[]>()
  for (const t of tools) {
    const arr = byCategory.get(t.category) || []
    arr.push(t)
    byCategory.set(t.category, arr)
  }

  const lines: string[] = ['ДОСТУПНЫЕ ДЕЙСТВИЯ (вызывай через tool use):']
  for (const [category, ts] of byCategory) {
    lines.push(`\n[${category}]`)
    for (const t of ts) {
      const required = t.params.filter((p) => p.required).map((p) => p.name).join(', ')
      lines.push(`  • ${t.name}: ${t.description}` + (required ? ` (params: ${required})` : ''))
    }
  }
  return lines.join('\n')
}

/**
 * Конвертирует CopilotTool в OpenAI tool definition (function calling format).
 */
export function toolToOpenAISchema(tool: CopilotTool, ctx: CopilotContext): unknown {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const p of tool.params) {
    let type: string = 'string'
    if (p.type === 'number') type = 'number'
    else if (p.type === 'boolean') type = 'boolean'
    properties[p.name] = {
      type,
      description: p.description + (p.extractHint ? ` [Подсказка: ${p.extractHint}]` : ''),
    }
    if (p.required) required.push(p.name)
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  }
}
