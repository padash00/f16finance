'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Boxes, Download, PackagePlus, ScanSearch, Tags } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { StoreRouteSkeleton } from '@/components/store/store-route-skeleton'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

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
      className="group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-100/60 px-3 py-2 transition hover:border-emerald-400/30 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
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
      <AdminPageHeader
        title="Каталог магазина"
        description="Общий остаток точки (Каталог), склад и витрина. Импорт Excel: колонка «Остаток» идёт в Каталог."
        icon={<Boxes className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <QuickLink href="/store/receipts" icon={PackagePlus} title="Приёмка" note="Оприходовать новый товар" />
            <QuickLink href="/store/forecast" icon={ScanSearch} title="Прогноз" note="Что скоро закончится" />
            <QuickLink href="/store/abc" icon={Tags} title="ABC-анализ" note="Что продаётся лучше всего" />
            <QuickLink href="/store/requests" icon={Download} title="Заявки" note="Что ждут точки" />
          </div>
        }
      />

      <Card className="overflow-hidden border-slate-200 bg-card/70 p-0 shadow-[0_18px_50px_rgba(0,0,0,0.14)] dark:border-white/10">
        <CardContent className="p-4 sm:p-5">
          <CatalogPageContent />
        </CardContent>
      </Card>
    </div>
  )
}
