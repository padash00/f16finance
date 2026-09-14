import { Suspense } from 'react'

import { ArenaWorkspace } from '@/components/arena/arena-workspace'

export default function ArenaBookingsPage() {
  return (
    <Suspense fallback={null}>
      <ArenaWorkspace section="bookings" />
    </Suspense>
  )
}
