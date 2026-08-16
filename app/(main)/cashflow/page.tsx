'use client'

/**
 * Тонкая обёртка над телом страницы.
 *
 * Всё содержимое живёт в `page-body.tsx` и подгружается отдельным куском.
 * Причина в весе: страница тянет библиотеку графиков (382 КБ), и в самом
 * маршруте она попадала в первую загрузку — качалась до того, как человек
 * увидит хоть что-то. Теперь маршрут весит килобайты, а тело едет следом.
 *
 * `ssr: false` здесь не потеря: страница и так клиентская, данные грузит
 * запросами и до их прихода показывает скелетон.
 */

import dynamicImport from 'next/dynamic'

import { PageSkeleton } from '@/components/skeleton'

const Body = dynamicImport(() => import('./page-body'), {
  ssr: false,
  loading: () => <PageSkeleton />,
})

export default function CashFlowPage() {
  return <Body />
}
