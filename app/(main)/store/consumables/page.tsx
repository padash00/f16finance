'use client'

import dynamic from 'next/dynamic'

import { StoreRouteSkeleton } from '@/components/store/store-route-skeleton'

const ConsumablesPageContent = dynamic(
  () => import('../../inventory/consumables/page').then((mod) => mod.ConsumablesPageContent),
  { ssr: false, loading: () => <StoreRouteSkeleton /> },
)

export default function StoreConsumablesPage() {
  return <ConsumablesPageContent />
}
