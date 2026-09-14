import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaHallPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="hall" />
    </Suspense>
  )
}
