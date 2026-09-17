/**
 * Сортировка таблиц по столбцам — одна логика на все страницы.
 *
 * Раньше каждая таблица (кадры, KPI продаж, ABC, аналитика операторов)
 * писала свой switch по полям. Здесь — чистые функции без React: страница
 * описывает столбцы (как достать значение и в какую сторону сортировать по
 * умолчанию), а порядок строк считается одинаково везде.
 *
 * Правила:
 *  - деньги и числа сравниваются как числа, текст — по-русски, с учётом цифр
 *    внутри («Точка 2» раньше «Точка 10»), без учёта регистра;
 *  - пустые значения (null, '', «—») ВСЕГДА в конце, в любом направлении:
 *    при сортировке по наличным строки без наличных не должны лезть наверх;
 *  - при равенстве — порядок из tieBreak страницы, затем исходный порядок
 *    (сортировка устойчивая, строки не прыгают при повторном нажатии).
 *
 * Хук — lib/client/use-table-sort, заголовок — components/ui/sortable-th.
 */

export type SortDirection = 'asc' | 'desc'
export type SortValue = string | number | null | undefined

export type SortColumn<T> = {
  /** Значение ячейки для сравнения. null/''/NaN — пусто, уходит в конец. */
  get: (row: T) => SortValue
  /** Направление при первом нажатии: суммам и датам удобнее «сначала большие/новые». */
  defaultDir?: SortDirection
}

export type SortColumns<T, K extends string> = Record<K, SortColumn<T>>
export type SortState<K extends string> = { key: K; dir: SortDirection }

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

export function isEmptySortValue(value: SortValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return !Number.isFinite(value)
  return value.trim() === ''
}

/** Сравнение двух непустых значений: числа как числа, остальное как текст. */
export function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

export function sortRows<T, K extends string>(
  rows: readonly T[],
  columns: SortColumns<T, K>,
  state: SortState<K>,
  /** Порядок при равных значениях; НЕ разворачивается вместе с направлением. */
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const column = columns[state.key]
  if (!column) return [...rows]
  const sign = state.dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: column.get(row) }))
    .sort((a, b) => {
      const aEmpty = isEmptySortValue(a.value)
      const bEmpty = isEmptySortValue(b.value)
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      if (!aEmpty) {
        const cmp = compareSortValues(a.value, b.value)
        if (cmp !== 0) return sign * cmp
      }
      if (tieBreak) {
        const tie = tieBreak(a.row, b.row)
        if (tie !== 0) return tie
      }
      return a.index - b.index
    })
    .map((item) => item.row)
}

/** Нажатие на заголовок: тот же столбец — сменить направление, другой — его направление по умолчанию. */
export function nextSortState<T, K extends string>(
  current: SortState<K>,
  key: K,
  columns: SortColumns<T, K>,
): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: columns[key]?.defaultDir ?? 'asc' }
}

export function ariaSortOf<K extends string>(state: SortState<K>, key: K): 'ascending' | 'descending' | 'none' {
  if (state.key !== key) return 'none'
  return state.dir === 'asc' ? 'ascending' : 'descending'
}
