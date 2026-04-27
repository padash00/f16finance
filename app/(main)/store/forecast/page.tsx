'use client'

import dynamic from 'next/dynamic'

import { StoreRouteSkeleton } from '@/components/store/store-route-skeleton'

const InventoryForecastPageContent = dynamic(
  () => import('../../inventory/forecast/page').then((mod) => mod.InventoryForecastPageContent),
  { ssr: false, loading: () => <StoreRouteSkeleton /> },
)

export default function StoreForecastPage() {
  return <InventoryForecastPageContent />
}
