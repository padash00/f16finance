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
import { transferToShowcaseTool } from './inventory/transfer-to-showcase'
import { blockOperatorTool, unblockOperatorTool } from './team/block-operator'
import { createOperatorTool } from './team/create-operator'
import { sendMessageToOperatorTool, broadcastToOperatorsTool } from './team/send-message'
import { approveExpenseTool, declineExpenseTool } from './finance/approve-expense'
import { deleteExpenseTool } from './finance/delete-expense'
import { addCategoryTool } from './finance/add-category'
import { takeTaskTool } from './tasks/take-task'
import { saveMemoryTool } from './system/save-memory'
import { getPiRankingTool } from './analytics/get-pi-ranking'
import { queryByCompanyTool } from './analytics/query-by-company'
import { queryAnomaliesTool } from './analytics/query-anomalies'
import { queryRevenueTool } from './analytics/query-revenue'
import { queryLowStockTool } from './analytics/query-low-stock'
import { queryExpensesTool } from './analytics/query-expenses'
import { getTodayShiftsTool } from './analytics/get-today-shifts'
import { getOverdueTasksTool } from './analytics/get-overdue-tasks'
import { getPendingRequestsTool } from './analytics/get-pending-requests'
import { getBirthdaysTool } from './analytics/get-birthdays'
import { getOperatorInfoTool } from './analytics/get-operator-info'
import { comparePeriodsTool } from './analytics/compare-periods'
import { getTopOperatorsTool } from './analytics/get-top-operators'
import { getCashflowTool } from './analytics/get-cashflow'

let initialized = false

export function initializeCopilotTools(): void {
  if (initialized) return
  initialized = true

  // ─── Action tools (write) ────────────────────────────────────────────
  // Финансы
  registerTool(addExpenseTool)
  registerTool(addIncomeTool)
  registerTool(markDebtPaidTool)
  registerTool(approveExpenseTool)
  registerTool(declineExpenseTool)
  registerTool(deleteExpenseTool)
  registerTool(addCategoryTool)

  // Зарплата
  registerTool(giveAdvanceTool)
  registerTool(addFineTool)
  registerTool(addBonusTool)

  // Задачи
  registerTool(createTaskTool)
  registerTool(takeTaskTool)
  registerTool(closeTaskTool)

  // Системные
  registerTool(saveMemoryTool)

  // Склад
  registerTool(createInventoryRequestTool)
  registerTool(approveRequestTool)
  registerTool(declineRequestTool)
  registerTool(transferToShowcaseTool)
  registerTool(writeoffItemTool)

  // Смены
  registerTool(assignShiftTool)
  registerTool(cancelShiftTool)

  // Команда
  registerTool(createOperatorTool)
  registerTool(blockOperatorTool)
  registerTool(unblockOperatorTool)
  registerTool(sendMessageToOperatorTool)
  registerTool(broadcastToOperatorsTool)

  // ─── Read / analytics tools ──────────────────────────────────────────
  registerTool(queryRevenueTool)
  registerTool(queryExpensesTool)
  registerTool(queryLowStockTool)
  registerTool(getTodayShiftsTool)
  registerTool(getOverdueTasksTool)
  registerTool(getPendingRequestsTool)
  registerTool(getBirthdaysTool)
  registerTool(getOperatorInfoTool)
  registerTool(comparePeriodsTool)
  registerTool(getTopOperatorsTool)
  registerTool(getCashflowTool)
  registerTool(getPiRankingTool)
  registerTool(queryByCompanyTool)
  registerTool(queryAnomaliesTool)

  // Зарегистрировано: 38 tools (24 action + 13 analytics + 1 system)
  // Покрывает большую часть admin workflow.
}
