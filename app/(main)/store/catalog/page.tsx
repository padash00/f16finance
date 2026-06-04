'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Boxes, Download, PackagePlus, ScanSearch, Tags } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { StoreRouteSkeleton } from '@/components/store/store-route-skeleton'

const CatalogPageContent = dynamic(
  () => import('../../inventory/catalog/page').then((m) => m.CatalogPageContent),
  { ssr: false, loading: () => <StoreRouteSkeleton /> },
)

function QuickLink({
  href,
  icon: Icon,
  title,
  note,
}: {
  href: string
  icon: typeof Tags
  title: string
  note: string
}) {
  return (
    <Link
      href={href}
      prefetch
      className="group flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-emerald-400/30 hover:bg-white/[0.07]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
      </span>
    </Link>
  )
}

export default function StoreCatalogPage() {
  return (
    <div className="app-page-wide space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
          <Boxes className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-white">Каталог магазина</h1>
          <p className="truncate text-xs text-muted-foreground">
            Общий остаток точки (Каталог), склад и витрина. Импорт Excel: колонка «Остаток» идёт в Каталог.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <QuickLink href="/store/receipts" icon={PackagePlus} title="Приёмка" note="Оприходовать новый товар" />
        <QuickLink href="/store/forecast" icon={ScanSearch} title="Прогноз" note="Что скоро закончится" />
        <QuickLink href="/store/abc" icon={Tags} title="ABC-анализ" note="Что продаётся лучше всего" />
        <QuickLink href="/store/requests" icon={Download} title="Заявки" note="Что ждут точки" />
      </div>

      <Card className="overflow-hidden border-white/10 bg-card/70 p-0 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
        <CardContent className="p-4 sm:p-5">
          <CatalogPageContent />
        </CardContent>
      </Card>
    </div>
  )
}
