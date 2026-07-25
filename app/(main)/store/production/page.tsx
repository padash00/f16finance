'use client'

import dynamic from 'next/dynamic'

import { PageSkeleton } from '@/components/skeleton'

// Техкарты внутри модуля «Магазин» (StoreShell): рендерим ту же страницу
// /production, но под шеллом магазина — с его сайдбаром и хедером, как Склад
// и Документы. Источник логики один (app/(main)/production/page.tsx).
const Production = dynamic(() => import('@/app/(main)/production/page'), {
  ssr: false,
  loading: () => <div className="app-page-wide py-4"><PageSkeleton stats={3} rows={8} cols={6} /></div>,
})

export default function StoreProductionPage() {
  return <Production />
}
