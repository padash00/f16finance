import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  rows?: number
  columns?: number
  className?: string
}

/** Sticky-header table placeholder for store list pages (приёмка, ревизия, списания, движения). */
export function StoreDataTableSkeleton({ rows = 8, columns = 7, className }: Props) {
  return (
    <div className={className ?? 'min-h-[240px]'}>
      <div
        className="grid border-b border-white/[0.06] bg-[#0f172a]/60 px-4 py-2.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 max-w-[4rem] opacity-50" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={ri}
          className="grid items-center gap-2 border-b border-white/[0.04] px-4 py-2.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
        >
          {Array.from({ length: columns }).map((_, ci) => (
            <Skeleton key={ci} className="h-4 w-full opacity-60" />
          ))}
        </div>
      ))}
    </div>
  )
}
