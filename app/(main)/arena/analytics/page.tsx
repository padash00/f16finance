import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="analytics" />
    </Suspense>
  )
}
