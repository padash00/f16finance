'use client'

/**
 * Заголовок столбца, по которому сортируют: нажали — отсортировали, нажали ещё
 * раз — в обратную сторону. Работает в паре с useTableSort
 * (lib/client/use-table-sort).
 *
 * Стрелка у активного столбца видна всегда, у остальных — при наведении, чтобы
 * шапка не пестрела. aria-sort — для экранных читалок.
 */

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { ariaSortOf, type SortState } from '@/lib/core/table-sort'
import { cn } from '@/lib/utils'

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
  title,
}: {
  label: ReactNode
  sortKey: K
  sort: SortState<K>
  onSort: (key: K) => void
  align?: 'left' | 'right' | 'center'
  className?: string
  title?: string
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={ariaSortOf(sort, sortKey)}
      className={cn(align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title ?? (active ? 'Нажмите, чтобы развернуть порядок' : 'Сортировать по этому столбцу')}
        className={cn(
          // uppercase явно: базовые стили сбрасывают text-transform у кнопок
          'group inline-flex items-center gap-1 rounded uppercase transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        <span>{label}</span>
        <Icon className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
      </button>
    </th>
  )
}
