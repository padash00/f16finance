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
import { closeTaskTool } from './tasks/close-task'
import { createInventoryRequestTool } from './inventory/create-request'
import { approveRequestTool, declineRequestTool } from './inventory/decide-request'
import { assignShiftTool } from './shifts/assign-shift'
import { cancelShiftTool } from './shifts/cancel-shift'
import { writeoffItemTool } from './inventory/writeoff'
import { blockOperatorTool, unblockOperatorTool } from './team/block-operator'
import { queryRevenueTool } from './analytics/query-revenue'
import { queryLowStockTool } from './analytics/query-low-stock'
import { queryExpensesTool } from './analytics/query-expenses'
import { getTodayShiftsTool } from './analytics/get-today-shifts'
import { getOverdueTasksTool } from './analytics/get-overdue-tasks'
import { getPendingRequestsTool } from './analytics/get-pending-requests'
import { getBirthdaysTool } from './analytics/get-birthdays'
import { getOperatorInfoTool } from './analytics/get-operator-info'

let initialized = false

export function initializeCopilotTools(): void {
  if (initialized) return
  initialized = true

  // ─── Action tools (write) ────────────────────────────────────────────
  // Финансы
  registerTool(addExpenseTool)
  registerTool(addIncomeTool)
  registerTool(markDebtPaidTool)

  // Зарплата
  registerTool(giveAdvanceTool)
  registerTool(addFineTool)
  registerTool(addBonusTool)

  // Задачи
  registerTool(createTaskTool)
  registerTool(closeTaskTool)

  // Склад
  registerTool(createInventoryRequestTool)
  registerTool(approveRequestTool)
  registerTool(declineRequestTool)

  // Смены
  registerTool(assignShiftTool)
  registerTool(cancelShiftTool)

  // Списания
  registerTool(writeoffItemTool)

  // Команда
  registerTool(blockOperatorTool)
  registerTool(unblockOperatorTool)

  // ─── Read / analytics tools ──────────────────────────────────────────
  registerTool(queryRevenueTool)
  registerTool(queryExpensesTool)
  registerTool(queryLowStockTool)
  registerTool(getTodayShiftsTool)
  registerTool(getOverdueTasksTool)
  registerTool(getPendingRequestsTool)
  registerTool(getBirthdaysTool)
  registerTool(getOperatorInfoTool)

  // Зарегистрировано: 23 tools (16 action + 7 analytics)
  // TODO: ещё партии — get_operator_salary, query_pi, compare_periods,
  // transfer_to_showcase, swap_shift, send_to_operator, save_to_memory.
}
