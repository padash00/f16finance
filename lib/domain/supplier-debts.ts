/**
 * Свод по долгам поставщикам: сколько должны всего и сколько уже просрочено.
 *
 * Считала страница `/store/billing`, у себя. Повторение на Swift дало бы вторую
 * трактовку «просрочки» — а именно по ней решают, кому платить сегодня.
 *
 * Оплаченные и списанные строки в сумму не входят: долгом остаётся только
 * `open`.
 */

export type SupplierDebtRow = {
  status?: string | null
  total_amount?: number | string | null
  due_date?: string | null
}

export type SupplierDebtTotals = {
  open: number
  open_count: number
  overdue: number
  overdue_count: number
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Просрочен ли счёт.
 *
 * Отдельная функция, потому что признак нужен и в своде, и на каждой строке:
 * если клиент решит это сам, «просрочено 3 счёта» в шапке и красные строки под
 * ней перестанут сходиться.
 *
 * @param now момент, относительно которого считается просрочка
 */
export function isSupplierDebtOverdue(row: SupplierDebtRow, now: Date = new Date()): boolean {
  // Оплаченный счёт не просрочен, каким бы старым ни был срок.
  if (row?.status !== 'open') return false
  // Срок могли не проставить — такой долг не просрочен, а бессрочен.
  if (!row.due_date) return false
  const due = new Date(row.due_date).getTime()
  return Number.isFinite(due) && due < now.getTime()
}

/**
 * @param rows строки `supplier_debts`
 * @param now  момент, относительно которого считается просрочка
 */
export function summarizeSupplierDebts(
  rows: SupplierDebtRow[],
  now: Date = new Date(),
): SupplierDebtTotals {
  const totals: SupplierDebtTotals = { open: 0, open_count: 0, overdue: 0, overdue_count: 0 }

  for (const row of rows || []) {
    if (row?.status !== 'open') continue

    const amount = num(row.total_amount)
    totals.open += amount
    totals.open_count += 1

    if (isSupplierDebtOverdue(row, now)) {
      totals.overdue += amount
      totals.overdue_count += 1
    }
  }

  return totals
}
