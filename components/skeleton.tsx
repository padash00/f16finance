'use client'

/**
 * Простые скелетоны вместо «Загрузка...».
 * Используй <Skeleton /> для одной плашки или композиции (TableSkeleton, CardSkeleton).
 */

import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-slate-200/80 dark:bg-white/[0.06]',
        className,
      )}
    />
  )
}

export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-4 rounded-lg border border-border bg-card', className)}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-9 flex-1', c === 0 && 'max-w-[120px]', c === cols - 1 && 'max-w-[80px]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Скелетон типовой страницы портала: статкарточки + фильтры + таблица. Для loading-веток вместо «Загрузка...». */
export function PageSkeleton({ stats = 4, rows = 8, cols = 5 }: { stats?: number; rows?: number; cols?: number }) {
  return (
    <div className="space-y-4">
      {stats > 0 && <StatGridSkeleton count={stats} />}
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="rounded-lg border border-border bg-card p-4">
        <TableSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  )
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  )
}
