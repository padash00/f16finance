export type FinancialGroup =
  | 'cogs'
  | 'operating'
  | 'payroll'
  | 'payroll_advance'
  | 'payroll_tax'
  | 'depreciation'
  | 'financial_expenses'
  | 'income_tax'
  | 'capex'
  | 'non_operating'

export const FINANCIAL_GROUP_OPTIONS: Array<{
  value: FinancialGroup
  label: string
  description: string
}> = [
  { value: 'cogs',                label: 'COGS (Себестоимость)',  description: 'Прямые затраты на производство/закупку товаров и услуг. Вычитаются из выручки до Валовой прибыли.' },
  { value: 'operating',           label: 'Операционные',         description: 'Аренда, электроэнергия, интернет, реклама, ремонт, упаковка, списание.' },
  { value: 'payroll',             label: 'ФОТ',                  description: 'Основная зарплата персонала за месяц.' },
  { value: 'payroll_advance',     label: 'Аванс по зарплате',    description: 'Авансовые выплаты в счёт зарплаты, входят в общий ФОТ.' },
  { value: 'payroll_tax',         label: 'Налоги на зарплату',   description: 'ОПВ, ОСМС, социальные отчисления — всё что связано с ФОТ.' },
  { value: 'depreciation',        label: 'Амортизация',          description: 'Ежемесячный износ ПК и оборудования. Вычитается после EBITDA.' },
  { value: 'financial_expenses',  label: 'Финансовые расходы',   description: 'Проценты по кредиту и займам. Вычитается после EBIT.' },
  { value: 'income_tax',          label: 'Налог на прибыль',     description: 'Налог 3%, ИПН, КПН — финальный вычет перед чистой прибылью.' },
  { value: 'capex',               label: 'CAPEX',                description: 'Покупка оборудования. Не входит в P&L цепочку, учитывается отдельно.' },
  { value: 'non_operating',       label: 'Неоперационные',       description: 'Разовые или внеоперационные статьи вне основной деятельности.' },
]

/** Цепочка P&L: группы в порядке вычитания и промежуточные итоги */
export type PLChainNode =
  | { kind: 'group'; group: FinancialGroup }
  | { kind: 'subtotal'; label: string; key: string }

export const PL_CHAIN: PLChainNode[] = [
  { kind: 'subtotal', label: 'Выручка',          key: 'revenue' },
  { kind: 'group',    group: 'cogs' },
  { kind: 'subtotal', label: 'Валовая прибыль',  key: 'gross_profit' },
  { kind: 'group',    group: 'operating' },
  { kind: 'group',    group: 'payroll' },
  { kind: 'group',    group: 'payroll_advance' },
  { kind: 'group',    group: 'payroll_tax' },
  { kind: 'subtotal', label: 'EBITDA',        key: 'ebitda' },
  { kind: 'group',    group: 'depreciation' },
  { kind: 'subtotal', label: 'EBIT',          key: 'ebit' },
  { kind: 'group',    group: 'financial_expenses' },
  { kind: 'subtotal', label: 'EBT',           key: 'ebt' },
  { kind: 'group',    group: 'income_tax' },
  { kind: 'subtotal', label: 'Чистая прибыль', key: 'net' },
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

  if (
    normalized.includes('себестоим') ||
    normalized.includes('cogs') ||
    normalized.includes('закупка товар') ||
    normalized.includes('стоимость товар') ||
    normalized.includes('прямые затрат')
  ) return 'cogs'
  if (normalized.includes('аванс')) return 'payroll_advance'
  if (
    normalized.includes('осмс') ||
    normalized.includes('соц') ||
    normalized.includes('социальн') ||
    normalized.includes('зарплатн') ||
    normalized.includes('пенсион') ||
    normalized.includes('опв')
  ) return 'payroll_tax'
  if (
    normalized.includes('3%') ||
    normalized.includes('налог на прибыль') ||
    normalized === 'налоги' ||
    normalized.includes('ипн') ||
    normalized.includes('кпн')
  ) return 'income_tax'
  if (
    normalized === 'зп' ||
    normalized.includes('зарплат') ||
    normalized.includes('фот')
  ) return 'payroll'
  if (
    normalized.includes('амортизац') ||
    normalized.includes('износ')
  ) return 'depreciation'
  if (
    normalized.includes('процент') ||
    normalized.includes('кредит') ||
    normalized.includes('займ') ||
    normalized.includes('финанс расход')
  ) return 'financial_expenses'
  if (
    normalized.includes('capex') ||
    normalized.includes('капекс') ||
    normalized.includes('оборудован') ||
    normalized.includes('покупка тех')
  ) return 'capex'
  if (
    normalized.includes('штраф') ||
    normalized.includes('курсов') ||
    normalized.includes('разов')
  ) return 'non_operating'

  return 'operating'
}

export function resolveFinancialGroup(categoryName: string | null | undefined, explicitGroup: string | null | undefined): FinancialGroup {
  if (explicitGroup && FINANCIAL_GROUP_OPTIONS.some((item) => item.value === explicitGroup)) {
    return explicitGroup as FinancialGroup
  }
  return inferFinancialGroup(categoryName)
}
