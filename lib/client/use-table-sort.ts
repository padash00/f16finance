'use client'

/**
 * Сортировка таблицы по нажатию на заголовок столбца — хук поверх
 * lib/core/table-sort. Выбор запоминается в браузере по storageKey.
 *
 *   const columns = useMemo<SortColumns<Row, 'date' | 'total'>>(() => ({
 *     date: { get: (r) => r.date, defaultDir: 'desc' },
 *     total: { get: (r) => r.amount || null, defaultDir: 'desc' },
 *   }), [])
 *   const { sort, toggle, sortedRows } = useTableSort({
 *     storageKey: 'expenses.tableSort', columns, initial: { key: 'date', dir: 'desc' }, rows,
 *   })
 *   <SortableTh label="Дата" sortKey="date" sort={sort} onSort={toggle} />
 *
 * columns стоит мемоизировать — иначе строки пересортировываются на каждый рендер.
 */

import { useCallback, useMemo } from 'react'

import { usePersistentState } from '@/lib/client/use-persistent-state'
import { nextSortState, sortRows, type SortColumns, type SortState } from '@/lib/core/table-sort'

export function useTableSort<T, K extends string>(options: {
  storageKey: string
  columns: SortColumns<T, K>
  initial: SortState<K>
  rows: readonly T[]
  tieBreak?: (a: T, b: T) => number
}) {
  const { storageKey, columns, initial, rows, tieBreak } = options
  const [stored, setStored] = usePersistentState<SortState<K>>(storageKey, initial)

  // В браузере мог остаться выбор столбца, которого больше нет, — тогда стартовый
  const isValid = (state: SortState<K> | null | undefined): state is SortState<K> =>
    !!state && !!columns[state.key] && (state.dir === 'asc' || state.dir === 'desc')
  const sort = isValid(stored) ? stored : initial

  const toggle = useCallback(
    (key: K) => {
      setStored((prev) => nextSortState(isValid(prev) ? prev : initial, key, columns))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, initial.key, initial.dir, setStored],
  )

  const sortedRows = useMemo(() => sortRows(rows, columns, sort, tieBreak), [rows, columns, sort, tieBreak])

  return { sort, toggle, sortedRows }
}
