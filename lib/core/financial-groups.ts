export type FinancialGroup =
  | 'operating'
  | 'payroll'
  | 'payroll_advance'
  | 'payroll_tax'
  | 'income_tax'
  | 'non_operating'

export const FINANCIAL_GROUP_OPTIONS: Array<{
  value: FinancialGroup
  label: string
  description: string
}> = [
  { value: 'operating', label: 'Операционные', description: 'Обычные расходы бизнеса: аренда, закуп, маркетинг, хозяйственные траты.' },
  { value: 'payroll', label: 'ФОТ', description: 'Основная зарплата персонала за месяц.' },
  { value: 'payroll_advance', label: 'Аванс по зарплате', description: 'Авансовые выплаты, которые входят в общий фонд оплаты труда.' },
  { value: 'payroll_tax', label: 'Налоги на зарплату', description: 'Социальные и зарплатные налоги, связанные с фондом оплаты труда.' },
  { value: 'income_tax', label: 'Налог на прибыль / 3%', description: 'Налоги на результат бизнеса: 3%, ИПН, КПН и похожие статьи.' },
  { value: 'non_operating', label: 'Неоперационные', description: 'Разовые или внеоперационные статьи, которые не относятся к обычной работе.' },
]

export function getFinancialGroupLabel(group: string | null | undefined) {
  return FINANCIAL_GROUP_OPTIONS.find((item) => item.value === group)?.label || 'Операционные'
}

function normalizeCategoryName(name: string | null | undefined) {
  return String(name || '').trim().toLowerCase()
}

export function inferFinancialGroup(categoryName: string | null | undefined): FinancialGroup {
  const normalized = normalizeCategoryName(categoryName)

  if (!normalized) return 'operating'

  if (normalized.includes('аванс')) return 'payroll_advance'
  if (
    normalized.includes('осмс') ||
    normalized.includes('соц') ||
    normalized.includes('социальн') ||
    normalized.includes('зарплатн') ||
    normalized.includes('пенсион')
  ) {
    return 'payroll_tax'
  }
  if (
    normalized.includes('3%') ||
    normalized.includes('налог на прибыль') ||
    normalized === 'налоги' ||
    normalized.includes('ипн') ||
    normalized.includes('кпн')
  ) {
    return 'income_tax'
  }
  if (
    normalized === 'зп' ||
    normalized.includes('зарплат') ||
    normalized.includes('фот')
  ) {
    return 'payroll'
  }
  if (
    normalized.includes('штраф') ||
    normalized.includes('курсов') ||
    normalized.includes('разов')
  ) {
    return 'non_operating'
  }

  return 'operating'
}

export function resolveFinancialGroup(categoryName: string | null | undefined, explicitGroup: string | null | undefined): FinancialGroup {
  if (explicitGroup && FINANCIAL_GROUP_OPTIONS.some((item) => item.value === explicitGroup)) {
    return explicitGroup as FinancialGroup
  }
  return inferFinancialGroup(categoryName)
}
