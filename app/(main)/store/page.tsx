'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ClipboardList,
  History,
  Package,
  PackagePlus,
  ScanSearch,
  Store,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InventoryPageContent } from '../inventory/page'

type StoreOverviewResponse = {
  items: Array<{ id: string; low_stock_threshold: number | null }>
  locations: Array<{ id: string; location_type: 'warehouse' | 'point_display'; name: string }>
  balances: Array<{
    location_id: string
    quantity: number
    location?: { id: string; location_type: 'warehouse' | 'point_display'; name: string } | null
    item?: { id: string; name: string; low_stock_threshold: number | null } | null
  }>
  requests: Array<{ id: string; status: string }>
  receipts: Array<{ id: string }>
  movements: Array<{ id: string }>
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export default function StoreOverviewPage() {
  const [overview, setOverview] = useState<StoreOverviewResponse | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/store/overview', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) return
        setOverview(json.data as StoreOverviewResponse)
      } catch {
        setOverview(null)
      }
    }

    void load()
  }, [])

  const metrics = useMemo(() => {
    const balances = overview?.balances || []
    const requests = overview?.requests || []
    const lowStock = balances.filter((balance) => {
      const threshold = balance.item?.low_stock_threshold
      return threshold !== null && threshold !== undefined && Number(balance.quantity || 0) <= threshold
    })

    return {
      pendingRequests: requests.filter((item) => item.status === 'new').length,
      showcases: (overview?.locations || []).filter((item) => item.location_type === 'point_display').length,
      lowStock: lowStock.length,
      receipts: (overview?.receipts || []).length,
    }
  }, [overview])

  const topLowStock = useMemo(() => {
    const balances = overview?.balances || []
    return balances
      .filter((balance) => {
        const threshold = balance.item?.low_stock_threshold
        return threshold !== null && threshold !== undefined && Number(balance.quantity || 0) <= threshold
      })
      .slice(0, 6)
  }, [overview])

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_38%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.96))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              <Boxes className="h-3.5 w-3.5" />
              Центр магазина
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white">Склад, витрины и поток заявок в одном месте</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Здесь видно, что заканчивается, сколько заявок ждут решения и куда перейти дальше: в приёмку, каталог,
              ревизию или движение товара.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:w-[360px]">
            <Link
              href="/store/requests"
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <ClipboardList className="h-4 w-4 text-emerald-300" />
                Заявки
              </div>
              <div className="mt-1 text-xs text-slate-400">Согласование и выдача</div>
            </Link>
            <Link
              href="/store/receipts"
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <PackagePlus className="h-4 w-4 text-blue-300" />
                Приёмка
              </div>
              <div className="mt-1 text-xs text-slate-400">Приход товара на склад</div>
            </Link>
            <Link
              href="/store/movements"
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <History className="h-4 w-4 text-violet-300" />
                Движения
              </div>
              <div className="mt-1 text-xs text-slate-400">Журнал операций</div>
            </Link>
            <Link
              href="/store/revisions"
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <ScanSearch className="h-4 w-4 text-amber-300" />
                Ревизия
              </div>
              <div className="mt-1 text-xs text-slate-400">Проверка склада и витрин</div>
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Новые заявки" value={metrics.pendingRequests} hint="Ждут решения" />
          <MetricCard label="Витрины" value={metrics.showcases} hint="Точек с активной витриной" />
          <MetricCard label="Низкий остаток" value={metrics.lowStock} hint="Позиции под контролем" />
          <MetricCard label="Последние приёмки" value={metrics.receipts} hint="Документы прихода" />
        </div>

        {topLowStock.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                <p className="text-sm font-medium text-amber-100">Скоро закончится на складе или витринах</p>
              </div>
              <Link href="/store/forecast" className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200">
                Прогноз <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {topLowStock.map((balance) => (
                <span
                  key={`${balance.location_id}-${balance.item?.id || 'item'}`}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-black/20 px-3 py-1 text-xs text-amber-200"
                >
                  <Package className="h-3 w-3" />
                  {balance.item?.name || 'Товар'} · {balance.quantity}
                  {balance.location?.name ? ` · ${balance.location.name}` : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <Card className="border-white/10 bg-card/70 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
        <CardHeader className="border-b border-white/10">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-4 w-4 text-emerald-300" />
            Рабочий обзор магазина
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-5">
            <InventoryPageContent forcedView="overview" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
