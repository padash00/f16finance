import { Suspense } from 'react'

import { ClientHomePage } from '@/app/(client)/client/client-home-page'

function ClientPageFallback() {
  return <p className="text-sm text-muted-foreground">Загрузка…</p>
}

export default function ClientHomeRoutePage() {
  return (
    <Suspense fallback={<ClientPageFallback />}>
      <ClientHomePage />
    </Suspense>
  )
}
