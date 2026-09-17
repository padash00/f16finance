import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ariaSortOf,
  compareSortValues,
  isEmptySortValue,
  nextSortState,
  sortRows,
  type SortColumns,
} from '@/lib/core/table-sort'

type Row = { id: string; date: string; category: string; cash: number | null; comment: string | null }

const rows: Row[] = [
  { id: 'a', date: '2026-09-15', category: 'Зарплата', cash: 13_000, comment: 'аванс' },
  { id: 'b', date: '2026-09-17', category: 'дворник', cash: null, comment: null },
  { id: 'c', date: '2026-09-16', category: 'Аренда', cash: 3_000, comment: '' },
  { id: 'd', date: '2026-09-16', category: 'Дворник', cash: 295_350, comment: 'зарплата' },
]

const columns: SortColumns<Row, 'date' | 'category' | 'cash' | 'comment'> = {
  date: { get: (r) => r.date, defaultDir: 'desc' },
  category: { get: (r) => r.category },
  cash: { get: (r) => r.cash, defaultDir: 'desc' },
  comment: { get: (r) => r.comment },
}

const ids = (list: Row[]) => list.map((r) => r.id).join('')

test('числа сравниваются как числа, а не как текст', () => {
  assert.ok(compareSortValues(9, 10) < 0)
  assert.equal(ids(sortRows(rows, columns, { key: 'cash', dir: 'asc' })), 'cadb')
})

test('текст — по-русски, без регистра, цифры внутри по значению', () => {
  assert.ok(compareSortValues('Точка 2', 'Точка 10') < 0)
  assert.equal(compareSortValues('дворник', 'Дворник'), 0)
  assert.equal(ids(sortRows(rows, columns, { key: 'category', dir: 'asc' })), 'cbda')
})

test('пустые значения всегда в конце — и по возрастанию, и по убыванию', () => {
  assert.equal(ids(sortRows(rows, columns, { key: 'cash', dir: 'desc' })), 'dacb')
  // «аванс» < «зарплата», а null и '' — в конце в исходном порядке
  assert.equal(ids(sortRows(rows, columns, { key: 'comment', dir: 'asc' })), 'adbc')
  assert.equal(isEmptySortValue(''), true)
  assert.equal(isEmptySortValue('  '), true)
  assert.equal(isEmptySortValue(Number.NaN), true)
  assert.equal(isEmptySortValue(0), false)
})

test('равные значения: сначала tieBreak, затем исходный порядок (сортировка устойчивая)', () => {
  const sameDay = sortRows(rows, columns, { key: 'date', dir: 'desc' })
  // c и d в один день — остаются в исходном порядке
  assert.equal(ids(sameDay), 'bcda')
  const byIdDesc = sortRows(rows, columns, { key: 'date', dir: 'desc' }, (x, y) => y.id.localeCompare(x.id))
  assert.equal(ids(byIdDesc), 'bdca')
})

test('нажатие на заголовок: тот же столбец разворачивает, новый — берёт своё направление', () => {
  assert.deepEqual(nextSortState({ key: 'date', dir: 'desc' }, 'date', columns), { key: 'date', dir: 'asc' })
  assert.deepEqual(nextSortState({ key: 'date', dir: 'asc' }, 'cash', columns), { key: 'cash', dir: 'desc' })
  assert.deepEqual(nextSortState({ key: 'cash', dir: 'desc' }, 'category', columns), { key: 'category', dir: 'asc' })
})

test('aria-sort для активного и неактивного столбца', () => {
  assert.equal(ariaSortOf({ key: 'date', dir: 'asc' }, 'date'), 'ascending')
  assert.equal(ariaSortOf({ key: 'date', dir: 'desc' }, 'date'), 'descending')
  assert.equal(ariaSortOf({ key: 'date', dir: 'desc' }, 'cash'), 'none')
})

test('неизвестный столбец — порядок не меняется', () => {
  assert.equal(ids(sortRows(rows, columns, { key: 'nope' as any, dir: 'asc' })), 'abcd')
})
