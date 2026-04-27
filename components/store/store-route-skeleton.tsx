import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shown in app/(main)/store/loading.tsx and matches the unified store shell
 * (max-w-screen-2xl, compact header row) for instant route feedback.
 */
export function StoreRouteSkeleton() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 md:px-4 md:pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      <Skeleton className="h-[min(420px,55vh)] w-full rounded-lg" />
    </div>
  )
}
