import { Suspense } from 'react'

import { StorePageClient } from '@/app/(client)/client/store/store-page-client'

function StoreFallback() {
  return <p className="text-sm text-muted-foreground">Загрузка…</p>
}

export default function ClientStoreRoutePage() {
  return (
    <Suspense fallback={<StoreFallback />}>
      <StorePageClient />
    </Suspense>
  )
}
