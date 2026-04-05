'use client'

import Link from 'next/link'
import { Boxes, Download, PackagePlus, ScanSearch, Tags } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { CatalogPageContent } from '../../inventory/catalog/page'

function MiniAction({
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
      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-emerald-400/30 hover:bg-white/[0.07]"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="h-4 w-4 text-emerald-300" />
        {title}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </Link>
  )
}

export default function StoreCatalogPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-blue-500/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(17,24,39,0.96))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
              <Boxes className="h-3.5 w-3.5" />
              Каталог магазина
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white">Каталог: центральный склад и витрины на точках</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Импорт из Excel: каталог и цены; колонка «Остаток» всегда идёт на центральный склад, витрины не трогаем.
              Массовые действия и остатки по базе в каталоге.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:w-[390px]">
            <MiniAction href="/store/receipts" icon={PackagePlus} title="Приёмка" note="Сразу оприходовать новый товар" />
            <MiniAction href="/store/forecast" icon={ScanSearch} title="Прогноз" note="Посмотреть, что скоро закончится" />
            <MiniAction href="/store/abc" icon={Tags} title="ABC-анализ" note="Понять, что продаётся лучше всего" />
            <MiniAction href="/store/requests" icon={Download} title="Заявки" note="Проверить, что ждут точки" />
          </div>
        </div>
      </section>

      <Card className="border-white/10 bg-card/70 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
        <CardContent className="p-5">
          <CatalogPageContent />
        </CardContent>
      </Card>
    </div>
  )
}
