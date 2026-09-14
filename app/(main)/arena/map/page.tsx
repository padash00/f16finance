import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaMapPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="map" />
    </Suspense>
  )
}
