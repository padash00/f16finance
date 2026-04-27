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
  Search,
  ScanSearch,
  Store,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InventoryPageContent } from '../inventory/page'

type StoreOverviewResponse = {
  items: Array<{ id: string; low_stock_threshold: number | null }>
  locations: Array<{ id: string; location_type: 'warehouse' | 'point_display'; name: string; company?: { id: string; name: string } | null }>
  balances: Array<{
    location_id: string
    quantity: number
    location?: { id: string; location_type: 'warehouse' | 'point_display'; name: string } | null
    item?: { id: string; name: string; low_stock_threshold: number | null } | null
  }>
  requests: Array<{ id: string; status: string }>
  receipts: Array<{ id: string }>
  movements: Array<{ id: string }>
  writeoffs: Array<{ id: string; reason?: string | null; comment?: string | null }>
}

type AuditTimelineEntry = {
  id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  payload?: Record<string, unknown> | null
  created_at: string
  actor_staff?: { full_name: string | null; role: string | null } | null
}

type GlobalFilters = {
  q: string
  company_id: string
  from: string
  to: string
  status: string
  actor: string
}

type SearchResult = {
  type: string
  title: string
  subtitle: string
  href: string
  score: number
}

const STORE_FILTERS_KEY = 'store-global-filters-v1'

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
  const [timeline, setTimeline] = useState<AuditTimelineEntry[]>([])
  const [filters, setFilters] = useState<GlobalFilters>({
    q: '',
    company_id: '',
    from: '',
    to: '',
    status: '',
    actor: '',
  })
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_FILTERS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GlobalFilters>
        setFilters((prev) => ({ ...prev, ...parsed }))
      }
    } catch { /* ignore parse errors */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORE_FILTERS_KEY, JSON.stringify(filters))
    } catch { /* ignore storage errors */ }
  }, [filters])

  useEffect(() => {
    if (!filters.q.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/store/global-search?q=${encodeURIComponent(filters.q.trim())}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          setSearchResults([])
          return
        }
        setSearchResults(Array.isArray(json?.data?.results) ? json.data.results : [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [filters.q])

  useEffect(() => {
    async function load() {
      try {
        const [resOverview, resTimeline] = await Promise.all([
          fetch('/api/admin/store/overview', { cache: 'no-store' }),
          fetch('/api/admin/store/audit-timeline?limit=20', { cache: 'no-store' }),
        ])
        const jsonOverview = await resOverview.json().catch(() => null)
        if (resOverview.ok && jsonOverview?.ok) {
          setOverview(jsonOverview.data as StoreOverviewResponse)
        }
        const jsonTimeline = await resTimeline.json().catch(() => null)
        if (resTimeline.ok && jsonTimeline?.ok) {
          setTimeline(Array.isArray(jsonTimeline?.data?.timeline) ? jsonTimeline.data.timeline : [])
        }
      } catch {
        setOverview(null)
        setTimeline([])
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
      unresolvedWriteoffs: (overview?.writeoffs || []).filter((w) => !String(w.reason || '').trim() || !String(w.comment || '').trim()).length,
      receiptMismatch: requests.filter((item) => item.status === 'disputed').length,
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

  const companies = useMemo(() => {
    const map = new Map<string, string>()
    for (const loc of overview?.locations || []) {
      const id = String((loc as any).company?.id || '')
      const name = String((loc as any).company?.name || '')
      if (id && name) map.set(id, name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [overview])

  const withGlobalFilters = (baseHref: string) => {
    const params = new URLSearchParams()
    if (filters.company_id) params.set('company_id', filters.company_id)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.status) params.set('status', filters.status)
    if (filters.actor) params.set('actor', filters.actor)
    if (filters.q) params.set('q', filters.q)
    const qs = params.toString()
    if (!qs) return baseHref
    return baseHref.includes('?') ? `${baseHref}&${qs}` : `${baseHref}?${qs}`
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
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
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                value={filters.q}
                onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
                placeholder="Поиск: товар, штрихкод, заявка, приемка..."
                className="h-9 border-white/20 bg-white/[0.04] text-white placeholder:text-slate-400 sm:col-span-2"
              />
              <select
                value={filters.company_id}
                onChange={(e) => setFilters((prev) => ({ ...prev, company_id: e.target.value }))}
                className="h-9 rounded-md border border-white/20 bg-white/[0.04] px-2 text-sm text-white outline-none"
              >
                <option value="">Все точки</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 border-white/20 bg-white/[0.04] text-slate-100 hover:bg-white/[0.1]"
                onClick={() => setFilters({ q: '', company_id: '', from: '', to: '', status: '', actor: '' })}
              >
                <Search className="mr-2 h-4 w-4" />
                Сбросить
              </Button>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
                className="h-9 border-white/20 bg-white/[0.04] text-white"
              />
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
                className="h-9 border-white/20 bg-white/[0.04] text-white"
              />
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="h-9 rounded-md border border-white/20 bg-white/[0.04] px-2 text-sm text-white outline-none"
              >
                <option value="">Все статусы</option>
                <option value="new">Новые</option>
                <option value="approved_full">Одобрено полностью</option>
                <option value="approved_partial">Одобрено частично</option>
                <option value="issued">Выдано</option>
                <option value="received">Получено</option>
                <option value="rejected">Отклонено</option>
              </select>
              <Input
                value={filters.actor}
                onChange={(e) => setFilters((prev) => ({ ...prev, actor: e.target.value }))}
                placeholder="Ответственный"
                className="h-9 border-white/20 bg-white/[0.04] text-white placeholder:text-slate-400"
              />
            </div>
            {(searching || searchResults.length > 0) && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                <p className="text-xs text-slate-400">{searching ? 'Ищу по магазину...' : `Найдено: ${searchResults.length}`}</p>
                <div className="mt-2 space-y-1">
                  {searchResults.slice(0, 8).map((row, idx) => (
                    <Link
                      key={`${row.type}-${idx}-${row.href}`}
                      href={withGlobalFilters(row.href)}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.08]"
                    >
                      <span className="truncate">{row.title}</span>
                      <span className="shrink-0 text-xs text-slate-400">{row.subtitle}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:w-[360px]">
            <Link
              href={withGlobalFilters('/store/requests')}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <ClipboardList className="h-4 w-4 text-emerald-300" />
                Заявки
              </div>
              <div className="mt-1 text-xs text-slate-400">Согласование и выдача</div>
            </Link>
            <Link
              href={withGlobalFilters('/store/receipts')}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <PackagePlus className="h-4 w-4 text-blue-300" />
                Приёмка
              </div>
              <div className="mt-1 text-xs text-slate-400">Приход товара на склад</div>
            </Link>
            <Link
              href={withGlobalFilters('/store/movements')}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-100 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-2 font-medium">
                <History className="h-4 w-4 text-violet-300" />
                Движения
              </div>
              <div className="mt-1 text-xs text-slate-400">Журнал операций</div>
            </Link>
            <Link
              href={withGlobalFilters('/store/revisions')}
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
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200/80">Неразобранные списания</p>
            <p className="mt-1 text-2xl font-semibold text-rose-200">{metrics.unresolvedWriteoffs}</p>
            <p className="mt-1 text-xs text-rose-200/80">Без причины или без комментария</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/80">Расхождения</p>
            <p className="mt-1 text-2xl font-semibold text-amber-200">{metrics.receiptMismatch}</p>
            <p className="mt-1 text-xs text-amber-200/80">Заявки со статусом disputed</p>
          </div>
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

      <Card className="border-white/10 bg-card/70 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
        <CardHeader className="border-b border-white/10">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-violet-300" />
            Единый журнал действий
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Действий пока нет.</p>
          ) : (
            <div className="space-y-2">
              {timeline.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-100">{entry.entity_type} · {entry.action}</span>
                    <span className="text-slate-400">{new Date(entry.created_at).toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-slate-400">
                    <span>ID: {String(entry.entity_id || '').slice(0, 8)}</span>
                    <span>
                      {(entry.actor_staff?.full_name || '').trim() || (entry.actor_user_id ? `ID ${entry.actor_user_id.slice(0, 8)}` : 'Система')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
