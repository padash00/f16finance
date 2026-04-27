import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type Props = { cards?: number }

/** Card-stack placeholder for store /requests list loading. */
export function StorePanelSkeleton({ cards = 3 }: Props) {
  return (
    <div className="space-y-3">
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="border-white/10 bg-card/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full max-w-lg" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
