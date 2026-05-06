/**
 * Регистрация всех AI-tools.
 * Каждый файл с tool'ом импортируется здесь и регистрируется в реестре.
 *
 * При добавлении нового tool — добавь сюда импорт и registerTool() вызов.
 */

import { registerTool } from '../registry'
import { giveAdvanceTool } from './salary/give-advance'
import { addFineTool } from './salary/add-fine'
import { addBonusTool } from './salary/add-bonus'
import { addExpenseTool } from './finance/add-expense'
import { addIncomeTool } from './finance/add-income'
import { markDebtPaidTool } from './finance/mark-debt-paid'
import { createTaskTool } from './tasks/create-task'
import { createInventoryRequestTool } from './inventory/create-request'
import { queryRevenueTool } from './analytics/query-revenue'
import { queryLowStockTool } from './analytics/query-low-stock'

let initialized = false

export function initializeCopilotTools(): void {
  if (initialized) return
  initialized = true

  // Финансовые tools
  registerTool(addExpenseTool)
  registerTool(addIncomeTool)
  registerTool(markDebtPaidTool)

  // Зарплата tools
  registerTool(giveAdvanceTool)
  registerTool(addFineTool)
  registerTool(addBonusTool)

  // Операционные tools
  registerTool(createTaskTool)
  registerTool(createInventoryRequestTool)

  // Read / analytics tools
  registerTool(queryRevenueTool)
  registerTool(queryLowStockTool)

  // TODO: расширять партиями — assign_shift, swap_shift, approve_request,
  // writeoff_item, query_expenses, compare_periods, query_pi, и т.д.
}
