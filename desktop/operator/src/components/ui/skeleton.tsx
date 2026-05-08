import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-gradient-to-r from-slate-200/60 via-slate-200/30 to-slate-200/60 bg-[length:200%_100%] dark:from-slate-800/60 dark:via-slate-700/30 dark:to-slate-800/60',
        className,
      )}
      style={{ animation: 'shimmer 1.6s ease-in-out infinite' }}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-card p-4 dark:border-slate-800">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
      <Skeleton className="h-9 w-9 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2 w-1/3" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  )
}
