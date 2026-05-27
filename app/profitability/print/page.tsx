import { Suspense } from 'react'

import PrintClient from './print-client'

export const dynamic = 'force-dynamic'

export default function ProfitabilityPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
          Загрузка…
        </div>
      }
    >
      <PrintClient />
    </Suspense>
  )
}
