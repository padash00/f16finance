import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaStationsPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="stations" />
    </Suspense>
  )
}
