import { Suspense } from 'react'

import { PointsPageClient } from '@/app/(client)/client/points/points-page-client'

function PointsFallback() {
  return <p className="text-sm text-muted-foreground">Загрузка…</p>
}

export default function ClientPointsRoutePage() {
  return (
    <Suspense fallback={<PointsFallback />}>
      <PointsPageClient />
    </Suspense>
  )
}
