'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Boxes, ClipboardList, FileText, History, Package,
  Search, Loader2, Warehouse, Building2, Activity, Receipt, Users2,
  PackagePlus, ArchiveX, ScanSearch,
} from 'lucide-react'

import { isAbortError } from '@/lib/is-abort-error'
import { SupplierDebtsWidget } from '@/components/store/supplier-debts-widget'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type StoreOverviewResponse = {
  items: Array<{ id: string; low_stock_threshold: number | null }>
  locations: Array<{ id: string; location_type: 'warehouse' | 'point_display'; name: string; company?: { id: string; name: string } | null }>
  balances: Array<{ location_id: string; quantity: number; location?: { id: string; location_type: 'warehouse' | 'point_display'; name: string } | null; item?: { id: string; name: string; low_stock_threshold: number | null } | null }>
  requests: Array<{ id: string; status: string }>
  receipts: Array<{ id: string }>
  movements: Array<{ id: string }>
  writeoffs: Array<{ id: string; reason?: string | null; comment?: string | null }>
}
type AuditTimelineEntry = {
  id: string; entity_type: string; entity_id: string; action: string; created_at: string
  actor_user_id: string | null; actor_staff?: { full_name: string | null; role: string | null } | null
}
type SearchResult = { type: string; title: string; subtitle: string; href: string; score: number }

const card = 'rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20'

const HUBS = [
  { href: '/store/stock', label: 'Склад', note: 'Остатки, витрина, движения, каталог', icon: Warehouse, color: 'text-emerald-600 dark:text-emerald-300' },
  { href: '/store/documents', label: 'Документы', note: 'Приёмка, оприходование, списания, ревизия', icon: FileText, color: 'text-sky-600 dark:text-sky-300' },
  { href: '/store/orders', label: 'Заявки', note: 'Заявки точек и заказы поставщикам', icon: ClipboardList, color: 'text-violet-600 dark:text-violet-300' },
  { href: '/store/vendors', label: 'Поставщики', note: 'Поставщики, долги, расходники', icon: Building2, color: 'text-amber-600 dark:text-amber-300' },
  { href: '/store/sales', label: 'Аналитика', note: 'Продажи, товары, ABC, прогноз', icon: Activity, color: 'text-emerald-600 dark:text-emerald-300' },
  { href: '/store/cashbox', label: 'Касса', note: 'Чеки, возвраты, реклама', icon: Receipt, color: 'text-sky-600 dark:text-sky-300' },
  { href: '/store/clients', label: 'Клиенты', note: 'Клиенты и скидки', icon: Users2, color: 'text-violet-600 dark:text-violet-300' },
]

export default function StoreOverviewPage() {
  const [overview, setOverview] = useState<StoreOverviewResponse | null>(null)
  const [timeline, setTimeline] = useState<AuditTimelineEntry[]>([])
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])

  useEffect(() => {
    if (!q.trim()) { setSearchResults([]); return }
    const ac = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/store/global-search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store', signal: ac.signal })
        const json = await res.json().catch(() => null)
        if (ac.signal.aborted) return
        setSearchResults(res.ok && json?.ok && Array.isArray(json?.data?.results) ? json.data.results : [])
      } catch (e) { if (!isAbortError(e) && !ac.signal.aborted) setSearchResults([]) }
      finally { if (!ac.signal.aborted) setSearching(false) }
    }, 250)
    return () => { clearTimeout(timer); ac.abort() }
  }, [q])

  useEffect(() => {
    const ac = new AbortController()
    async function load() {
      try {
        const [resOverview, resTimeline] = await Promise.all([
          fetch('/api/admin/store/overview', { cache: 'no-store', signal: ac.signal }),
          fetch('/api/admin/store/audit-timeline?limit=12', { cache: 'no-store', signal: ac.signal }),
        ])
        if (ac.signal.aborted) return
        const jsonOverview = await resOverview.json().catch(() => null)
        if (resOverview.ok && jsonOverview?.ok) setOverview(jsonOverview.data as StoreOverviewResponse)
        const jsonTimeline = await resTimeline.json().catch(() => null)
        if (ac.signal.aborted) return
        if (resTimeline.ok && jsonTimeline?.ok) setTimeline(Array.isArray(jsonTimeline?.data?.timeline) ? jsonTimeline.data.timeline : [])
      } catch (e) { if (!isAbortError(e) && !ac.signal.aborted) { setOverview(null); setTimeline([]) } }
    }
    void load()
    return () => ac.abort()
  }, [])

  const metrics = useMemo(() => {
    const balances = overview?.balances || []
    const requests = overview?.requests || []
    const lowStock = balances.filter((b) => { const t = b.item?.low_stock_threshold; return t != null && Number(b.quantity || 0) <= t })
    return {
      pendingRequests: requests.filter((i) => i.status === 'new').length,
      showcases: (overview?.locations || []).filter((i) => i.location_type === 'point_display').length,
      lowStock: lowStock.length,
      receipts: (overview?.receipts || []).length,
      unresolvedWriteoffs: (overview?.writeoffs || []).filter((w) => !String(w.reason || '').trim() || !String(w.comment || '').trim()).length,
      receiptMismatch: requests.filter((i) => i.status === 'disputed').length,
    }
  }, [overview])

  const topLowStock = useMemo(() => {
    return (overview?.balances || [])
      .filter((b) => { const t = b.item?.low_stock_threshold; return t != null && Number(b.quantity || 0) <= t })
      .slice(0, 10)
  }, [overview])

  const loaded = overview !== null

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Обзор магазина"
        description="Что заканчивается, сколько заявок ждут решения и куда перейти"
        icon={<Boxes className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по магазину: товар, штрихкод, заявка, приёмка…"
              className="w-full rounded-xl border border-border bg-white dark:bg-slate-950/50 py-2.5 pl-10 pr-3 text-sm text-foreground placeholder-slate-500 focus:border-emerald-400/50 focus:outline-none"
            />
            {(searching || searchResults.length > 0) && q.trim() && (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-white dark:bg-slate-950/95 shadow-2xl backdrop-blur">
                <div className="px-3 py-2 text-[11px] text-slate-500">{searching ? 'Ищу…' : `Найдено: ${searchResults.length}`}</div>
                <div className="max-h-72 overflow-y-auto">
                  {searchResults.slice(0, 10).map((row, idx) => (
                    <Link key={`${row.type}-${idx}`} href={row.href} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5">
                      <span className="truncate">{row.title}</span>
                      <span className="shrink-0 text-xs text-slate-500">{row.subtitle}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />

      {/* KPI / алерты */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Новые заявки" value={metrics.pendingRequests} hint="Ждут решения" tone={metrics.pendingRequests > 0 ? 'amber' : 'normal'} loaded={loaded} href="/store/orders" />
        <Kpi label="Низкий остаток" value={metrics.lowStock} hint="Позиции под контролем" tone={metrics.lowStock > 0 ? 'rose' : 'normal'} loaded={loaded} />
        <Kpi label="Витрины" value={metrics.showcases} hint="Точек с витриной" tone="normal" loaded={loaded} href="/store/stock" />
        <Kpi label="Приёмки" value={metrics.receipts} hint="Последние документы" tone="normal" loaded={loaded} href="/store/documents" />
        <Kpi label="Списания без причины" value={metrics.unresolvedWriteoffs} hint="Требуют разбора" tone={metrics.unresolvedWriteoffs > 0 ? 'rose' : 'normal'} loaded={loaded} href="/store/documents" />
        <Kpi label="Расхождения" value={metrics.receiptMismatch} hint="Спорные заявки" tone={metrics.receiptMismatch > 0 ? 'amber' : 'normal'} loaded={loaded} href="/store/orders" />
      </div>

      {/* Долги поставщикам */}
      <SupplierDebtsWidget />

      {/* Скоро закончится */}
      {topLowStock.length > 0 && (
        <div className={`${card} p-4`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-300" /> Скоро закончится</span>
            <Link href="/store/sales" className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-300 hover:text-amber-700 dark:hover:text-amber-200">Прогноз <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {topLowStock.map((b) => (
              <span key={`${b.location_id}-${b.item?.id || 'item'}`} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-200">
                <Package className="h-3 w-3" />
                {b.item?.name || 'Товар'} · <span className="font-semibold">{b.quantity}</span>
                {b.location?.name ? <span className="text-amber-700/60 dark:text-amber-200/60">· {b.location.name}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Разделы магазина */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Разделы</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {HUBS.map((h) => (
            <Link key={h.href} href={h.href} className={`${card} group flex items-start gap-3 p-4 transition-colors hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-slate-900/80`}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-slate-100 dark:bg-white/5"><h.icon className={`h-5 w-5 ${h.color}`} /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-sm font-medium text-foreground">{h.label}<ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-600 dark:group-hover:text-slate-300" /></div>
                <div className="mt-0.5 text-xs text-muted-foreground">{h.note}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Последние действия */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-violet-500 dark:text-violet-300" /> Последние действия
        </div>
        {!loaded ? (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : timeline.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">Действий пока нет.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {timeline.map((e) => {
              const m = activityMeta(e.entity_type, e.action)
              const actor = (e.actor_staff?.full_name || '').trim()
              const Icon = m.icon
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-white/5"><Icon className={`h-4 w-4 ${m.color}`} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-700 dark:text-slate-200">{m.phrase}</div>
                    {actor ? <div className="text-[11px] text-slate-500">{actor}</div> : null}
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const ACTIVITY_PHRASE: Record<string, string> = {
  'inventory-receipt:create': 'Приёмка создана',
  'inventory-receipt:create_posting': 'Оприходование',
  'inventory-receipt:update': 'Приёмка изменена',
  'inventory-receipt:delete': 'Приёмка удалена',
  'inventory-writeoff:create': 'Списание создано',
  'inventory-writeoff:cancel': 'Списание отменено',
  'inventory-request:create': 'Заявка создана',
  'inventory-request:approve': 'Заявка одобрена',
  'inventory-request:reject': 'Заявка отклонена',
  'inventory-request:issue': 'Заявка выдана',
  'inventory-request:receive': 'Заявка получена',
  'inventory-revision:create': 'Ревизия создана',
  'inventory-revision:apply': 'Ревизия проведена',
  'inventory-posting:create': 'Оприходование',
}
const ENTITY_META: Record<string, { label: string; icon: any; color: string }> = {
  'inventory-receipt': { label: 'Приёмка', icon: PackagePlus, color: 'text-sky-500 dark:text-sky-300' },
  'inventory-writeoff': { label: 'Списание', icon: ArchiveX, color: 'text-rose-500 dark:text-rose-300' },
  'inventory-request': { label: 'Заявка', icon: ClipboardList, color: 'text-violet-500 dark:text-violet-300' },
  'inventory-revision': { label: 'Ревизия', icon: ScanSearch, color: 'text-amber-500 dark:text-amber-300' },
  'inventory-posting': { label: 'Оприходование', icon: Package, color: 'text-emerald-500 dark:text-emerald-300' },
}
const ACTION_FALLBACK: Record<string, string> = {
  create: 'создано', create_posting: 'оприходование', approve: 'одобрено', reject: 'отклонено',
  cancel: 'отменено', update: 'изменено', delete: 'удалено', issue: 'выдано', receive: 'получено',
  apply: 'проведено', close: 'закрыто', open: 'открыто',
}
function activityMeta(entity: string, action: string): { phrase: string; icon: any; color: string } {
  const meta = ENTITY_META[entity] || { label: String(entity || '').replace(/[-_]/g, ' '), icon: History, color: 'text-muted-foreground' }
  const phrase = ACTIVITY_PHRASE[`${entity}:${action}`] || `${meta.label} · ${ACTION_FALLBACK[action] || action}`
  return { phrase, icon: meta.icon, color: meta.color }
}

function Kpi({ label, value, hint, tone, loaded, href }: { label: string; value: number; hint: string; tone: 'normal' | 'amber' | 'rose'; loaded: boolean; href?: string }) {
  const valueColor = tone === 'rose' ? 'text-rose-600 dark:text-rose-300' : tone === 'amber' ? 'text-amber-600 dark:text-amber-300' : 'text-foreground'
  const body = (
    <div className={`${card} p-4 ${href ? 'transition-colors hover:border-slate-300 dark:hover:border-white/20' : ''}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${valueColor}`}>{loaded ? value : '—'}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}
