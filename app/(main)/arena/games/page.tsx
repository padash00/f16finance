import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaGamesPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="games" />
    </Suspense>
  )
}
