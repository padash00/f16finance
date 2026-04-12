import { Suspense } from 'react'

import { BookingsPageClient } from '@/app/(client)/client/bookings/bookings-page-client'

function BookingsFallback() {
  return <p className="text-sm text-muted-foreground">Загрузка…</p>
}

export default function ClientBookingsRoutePage() {
  return (
    <Suspense fallback={<BookingsFallback />}>
      <BookingsPageClient />
    </Suspense>
  )
}
