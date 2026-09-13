import { FINANCIAL_GROUP_OPTIONS, PL_CHAIN, resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

/**
 * Расходы периода по статьям ОПиУ — для /reports.
 *
 * Статья определяется так же, как в `/profitability` (`computeMonthlyPnl`):
 * явная `accounting_group` категории, иначе угадывание по названию; аванс
 * входит в ФОТ. Промежуточные итоги (EBITDA, чистую прибыль) здесь нарочно не
 * считаем: ручные поправки ОПиУ помесячные и на произвольный период не
 * ложатся — вышли бы цифры, спорящие с /profitability.
 */

type ExpenseRow = {
  date: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
}

export type ExpenseArticle = {
  group: FinancialGroup
  label: string
  /** CAPEX и распределение прибыли: в ОПиУ не вычитаются */
  offChain: boolean
  amount: number
  prevAmount: number
  /** Категории внутри статьи за текущий период, по убыванию */
  categories: { name: string; amount: number }[]
}

// Порядок вычитания как в ОПиУ; неоперационные идут после налога, вне цепочки — в конце.
const ORDER: FinancialGroup[] = Array.from(
  new Set<FinancialGroup>([
    ...PL_CHAIN.flatMap((node) => (node.kind === 'group' ? [node.group] : [])),
    'non_operating',
    'capex',
    'profit_distribution',
  ]),
).filter((group) => group !== 'payroll_advance')

const LABELS: Partial<Record<FinancialGroup, string>> = {
  payroll: 'ФОТ (зарплата и авансы)',
}

function num(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function groupExpensesByArticle(input: {
  expenses: ExpenseRow[]
  dateFrom: string
  dateTo: string
  prevFrom: string
  prevTo: string
  /** Категория (trim + lower) → accounting_group из справочника своей организации */
  categoryGroups: Record<string, string | null>
}): ExpenseArticle[] {
  const byGroup = new Map<FinancialGroup, { amount: number; prevAmount: number; categories: Map<string, number> }>()

  for (const row of input.expenses) {
    const inCurrent = row.date >= input.dateFrom && row.date <= input.dateTo
    const inPrevious = row.date >= input.prevFrom && row.date <= input.prevTo
    if (!inCurrent && !inPrevious) continue

    const amount = num(row.cash_amount) + num(row.kaspi_amount)
    if (amount === 0) continue

    const key = String(row.category || '').trim().toLowerCase()
    let group = resolveFinancialGroup(row.category, input.categoryGroups[key] ?? null)
    if (group === 'payroll_advance') group = 'payroll'

    let bucket = byGroup.get(group)
    if (!bucket) {
      bucket = { amount: 0, prevAmount: 0, categories: new Map() }
      byGroup.set(group, bucket)
    }

    if (inCurrent) {
      bucket.amount += amount
      const name = String(row.category || '').trim() || 'Без категории'
      bucket.categories.set(name, (bucket.categories.get(name) || 0) + amount)
    } else {
      bucket.prevAmount += amount
    }
  }

  return ORDER.filter((group) => byGroup.has(group)).map((group) => {
    const bucket = byGroup.get(group)!
    const option = FINANCIAL_GROUP_OPTIONS.find((item) => item.value === group)
    return {
      group,
      label: LABELS[group] || option?.label || group,
      offChain: option?.kind === 'off_chain',
      amount: bucket.amount,
      prevAmount: bucket.prevAmount,
      categories: Array.from(bucket.categories, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    }
  })
}
