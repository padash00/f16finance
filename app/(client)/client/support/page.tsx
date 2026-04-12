import { Suspense } from 'react'

import { SupportPageClient } from '@/app/(client)/client/support/support-page-client'

function SupportFallback() {
  return <p className="text-sm text-muted-foreground">Загрузка…</p>
}

export default function ClientSupportRoutePage() {
  return (
    <Suspense fallback={<SupportFallback />}>
      <SupportPageClient />
    </Suspense>
  )
}
