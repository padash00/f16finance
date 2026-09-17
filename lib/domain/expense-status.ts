// Отклонённые расходы не считаются нигде: ни в отчётах, ни в аналитике, ни у ИИ.

// Для чтения `expenses` под отчёты: `.or(COUNTED_EXPENSE_FILTER)`.
// Учитывает пустой статус: голый `.neq('status', 'declined')` выбросил бы и строки с null.
export const COUNTED_EXPENSE_FILTER = 'status.is.null,status.neq.declined'

export function isCountedExpense(row: { status?: string | null }): boolean {
  return row.status !== 'declined'
}
