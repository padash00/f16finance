/**
 * Регистрация всех AI-tools.
 * Каждый файл с tool'ом импортируется здесь и регистрируется в реестре.
 *
 * При добавлении нового tool — добавь сюда импорт и registerTool() вызов.
 */

import { registerTool } from '../registry'
import { giveAdvanceTool } from './salary/give-advance'

let initialized = false

export function initializeCopilotTools(): void {
  if (initialized) return
  initialized = true

  // Salary tools
  registerTool(giveAdvanceTool)

  // TODO: добавить остальные tools партиями (Этап 2)
}
