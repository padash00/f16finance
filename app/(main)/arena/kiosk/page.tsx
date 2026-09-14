import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaKioskPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="kiosk" />
    </Suspense>
  )
}
