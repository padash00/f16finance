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
import { deleteIncomeTool } from './finance/delete-income'
import { addVendorTool } from './finance/add-vendor'
import { updateExpenseTool } from './finance/update-expense'
import { addKaspiRecordTool } from './finance/add-kaspi-record'
import { voidAdjustmentTool } from './salary/void-adjustment'
import { takeTaskTool } from './tasks/take-task'
import { deleteTaskTool } from './tasks/delete-task'
import { addStockTool } from './inventory/add-stock'
import { updateStockThresholdTool } from './inventory/update-stock-threshold'
import { addSupplierTool } from './inventory/add-supplier'
import { updateOperatorTool } from './team/update-operator'
import { updateTaskTool } from './tasks/update-task'
import { saveMemoryTool } from './system/save-memory'
import { listMyActionsTool } from './system/list-my-actions'
import { findPageTool } from './system/find-page'
import { getForecastTool } from './analytics/get-forecast'
import { sendTelegramReportTool } from './system/send-telegram-report'
import { getTeamInfoTool } from './system/get-team-info'
import { getKpiStatusTool } from './analytics/get-kpi-status'
import { compareCompaniesTool } from './analytics/compare-companies'
import { getOperatorSalaryTool } from './analytics/get-operator-salary'
import { getOverdueDebtsTool } from './analytics/get-overdue-debts'
import { getShiftReportTool } from './analytics/get-shift-report'
import { getPaymentBreakdownTool } from './analytics/get-payment-breakdown'
import { getRecentActionsTool } from './analytics/get-recent-actions'
import { getTaxSummaryTool } from './analytics/get-tax-summary'
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
import { createPromoTool } from './pos/create-promo'
import { createCustomerTool } from './pos/create-customer'
import { adjustLoyaltyTool } from './pos/adjust-loyalty'
import { setKpiPlanTool } from './system/set-kpi-plan'
import { createGoalTool } from './system/create-goal'
import { refundSaleTool } from './pos/refund-sale'
import { getReceiptHistoryTool } from './pos/get-receipt-history'
import { createReceiptTool } from './inventory/create-receipt'
import { addItemTool } from './inventory/add-item'
import { updateItemPriceTool } from './inventory/update-item-price'
import { recountBalanceTool } from './inventory/recount-balance'
import { archiveItemTool } from './inventory/archive-item'
import { assignRoleTool } from './team/assign-role'
import { updateOperatorPhoneTool } from './team/update-operator-phone'
import { createCompanyTool } from './system/create-company'
import { updateCompanyTool } from './system/update-company'
import { archiveCompanyTool } from './system/archive-company'
import { listGoalsTool } from './system/list-goals'
import { closeGoalTool } from './system/close-goal'
import { scheduleReminderTool } from './system/schedule-reminder'
import { listRemindersTool } from './system/list-reminders'
import { snoozeReminderTool } from './system/snooze-reminder'
import { cancelReminderTool } from './system/cancel-reminder'
import { listMemoriesTool } from './system/list-memories'
import { deleteMemoryTool } from './system/delete-memory'
import { lockPayrollPeriodTool } from './system/lock-payroll-period'
import { calculatePayrollTool } from './salary/calculate-payroll'
import { addDebtTool } from './finance/add-debt'
import { getAuditLogTool } from './analytics/get-audit-log'
import { whoChangedTool } from './analytics/who-changed'
import { getKpiProgressTool } from './analytics/get-kpi-progress'
import { getSupplierDebtsTool } from './analytics/get-supplier-debts'
import { getEmployeeRatingTool } from './analytics/get-employee-rating'
import { getStockValueTool } from './analytics/get-stock-value'
import { getTopSellingTool } from './analytics/get-top-selling'
import { getCustomerInfoTool } from './analytics/get-customer-info'

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
  registerTool(deleteIncomeTool)
  registerTool(addVendorTool)
  registerTool(updateExpenseTool)
  registerTool(addKaspiRecordTool)

  // Зарплата
  registerTool(giveAdvanceTool)
  registerTool(addFineTool)
  registerTool(addBonusTool)
  registerTool(voidAdjustmentTool)

  // Задачи
  registerTool(createTaskTool)
  registerTool(takeTaskTool)
  registerTool(closeTaskTool)
  registerTool(deleteTaskTool)
  registerTool(updateTaskTool)

  // Системные
  registerTool(saveMemoryTool)
  registerTool(listMyActionsTool)
  registerTool(findPageTool)
  registerTool(getForecastTool)
  registerTool(sendTelegramReportTool)
  registerTool(getTeamInfoTool)

  // Склад
  registerTool(createInventoryRequestTool)
  registerTool(approveRequestTool)
  registerTool(declineRequestTool)
  registerTool(transferToShowcaseTool)
  registerTool(writeoffItemTool)
  registerTool(addStockTool)
  registerTool(updateStockThresholdTool)
  registerTool(addSupplierTool)

  // Смены
  registerTool(assignShiftTool)
  registerTool(cancelShiftTool)

  // Команда
  registerTool(createOperatorTool)
  registerTool(blockOperatorTool)
  registerTool(unblockOperatorTool)
  registerTool(sendMessageToOperatorTool)
  registerTool(broadcastToOperatorsTool)
  registerTool(updateOperatorTool)

  // POS / лояльность / чеки
  registerTool(createPromoTool)
  registerTool(createCustomerTool)
  registerTool(adjustLoyaltyTool)
  registerTool(refundSaleTool)

  // KPI / цели
  registerTool(setKpiPlanTool)
  registerTool(createGoalTool)
  registerTool(closeGoalTool)

  // Точки
  registerTool(createCompanyTool)
  registerTool(updateCompanyTool)
  registerTool(archiveCompanyTool)

  // Команда / роли
  registerTool(assignRoleTool)
  registerTool(updateOperatorPhoneTool)

  // Каталог / склад (расширение)
  registerTool(createReceiptTool)
  registerTool(addItemTool)
  registerTool(updateItemPriceTool)
  registerTool(recountBalanceTool)
  registerTool(archiveItemTool)

  // Финансы (расширение)
  registerTool(addDebtTool)

  // Зарплата (расширение)
  registerTool(calculatePayrollTool)
  registerTool(lockPayrollPeriodTool)

  // Напоминания
  registerTool(scheduleReminderTool)
  registerTool(snoozeReminderTool)
  registerTool(cancelReminderTool)

  // AI-память
  registerTool(deleteMemoryTool)

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
  registerTool(getOperatorSalaryTool)
  registerTool(getOverdueDebtsTool)
  registerTool(getShiftReportTool)
  registerTool(getPaymentBreakdownTool)
  registerTool(getRecentActionsTool)
  registerTool(getTaxSummaryTool)
  registerTool(getKpiStatusTool)
  registerTool(compareCompaniesTool)
  registerTool(getReceiptHistoryTool)
  registerTool(getAuditLogTool)
  registerTool(whoChangedTool)
  registerTool(getKpiProgressTool)
  registerTool(getSupplierDebtsTool)
  registerTool(getEmployeeRatingTool)
  registerTool(getStockValueTool)
  registerTool(getTopSellingTool)
  registerTool(getCustomerInfoTool)
  registerTool(listGoalsTool)
  registerTool(listRemindersTool)
  registerTool(listMemoriesTool)

  // Зарегистрировано: 95 tools.
  // Покрытие ~85% capabilities проекта.
}
