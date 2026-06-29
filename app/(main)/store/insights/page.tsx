'use client'

import { useEffect, useState } from 'react'
import {
  Sparkles, Loader2, RefreshCw, Coins, Skull, TrendingUp, AlertTriangle, Boxes,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'

type InsightProduct = {
  item_id: string; name: string; soldQty: number; revenue: number; profit: number
  marginPct: number; velocityPerWeek: number; purchase: number; salePrice: number
  stock: number; stockValue: number; coverageWeeks: number; trendPct: number
}
type DeadStockRow = { item_id: string; name: string; stock: number; purchase: number; stockValue: number }
type SlowRow = { item_id: string; name: string; soldQty: number; velocityPerWeek: number; marginPct: number; profit: number; stock: number; stockValue: number }
type TrendRow = { item_id: string; name: string; trendPct: number; recentQty: number; earlierQty: number; revenue: number }
type LossRow = { item_id: string; name: string; qty: number; purchase: number; lossValue: number }
type Metrics = {
  organizationId: string | null
  days: number
  totals: { totalRevenue: number; totalProfit: number; deadStockValue: number; lossesValue: number; skuSold: number; skuDead: number }
  topProfit: InsightProduct[]
  deadStock: DeadStockRow[]
  slowLowMargin: SlowRow[]
  trending: { rising: TrendRow[]; falling: TrendRow[] }
  losses: { value: number; rows: LossRow[] }
}
type Resp = { ok: boolean; metrics: Metrics; aiText: string | null; error?: string }

const fmt = (v: number) => new Intl.NumberFormat('ru-RU').format(Math.round(v || 0))
const money = (v: number) => fmt(v) + ' ₸'
const COVERAGE_INF = 999

const PERIODS = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
]

const C = {
  card: 'bg-white dark:bg-slate-900/60',
  border: 'border-border',
  sub: 'text-muted-foreground',
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className={`rounded-2xl border ${C.border} ${C.card} p-4`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs ${C.sub}`}>{label}</p>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${tone}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function Section({ title, icon, hint, children, count }: { title: string; icon: string; hint?: string; children: React.ReactNode; count?: number }) {
  return (
    <div className={`rounded-2xl border ${C.border} ${C.card} overflow-hidden`}>
      <div className={`flex items-center justify-between gap-3 border-b ${C.border} px-4 py-3`}>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden>{icon}</span> {title}
            {typeof count === 'number' ? <span className={`text-xs font-normal ${C.sub}`}>· {count}</span> : null}
          </h2>
          {hint ? <p className={`mt-0.5 text-xs ${C.sub}`}>{hint}</p> : null}
        </div>
      </div>
      {children}
    </div>
  )
}

function marginColor(pct: number) {
  if (pct >= 30) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 15) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}
function trendColor(pct: number) {
  return pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

const thCls = 'px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground'
const thR = thCls + ' text-right'
const tdCls = 'px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200'
const tdR = 'px-4 py-2.5 text-right text-sm tabular-nums text-slate-700 dark:text-slate-200'
const nameCls = 'px-4 py-2.5 text-sm font-medium text-foreground max-w-[18rem] truncate'

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className={`px-4 py-6 text-center text-sm ${C.sub}`}>{text}</td>
    </tr>
  )
}

export default function StoreInsightsPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai/store-insights?days=${d}`, { cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as Resp | null
      if (!res.ok || !j?.ok) {
        setError(j?.error || 'Не удалось построить разбор')
        setData(null)
      } else {
        setData(j)
      }
    } catch {
      setError('Сеть недоступна')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(days) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days])

  const metrics = data?.metrics
  const t = metrics?.totals

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <AdminPageHeader
        title="AI-разбор магазина"
        description="Что приносит деньги, где заморожены деньги, где потери"
        accent="violet"
        backHref="/store"
        icon={<Sparkles className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-white/10 dark:bg-white/5">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setDays(p.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    days === p.value
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => load(days)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
            </button>
          </div>
        }
      />

      {loading && !data ? (
        <div className={`flex items-center justify-center gap-2 rounded-2xl border ${C.border} ${C.card} py-16 text-sm ${C.sub}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Считаю продажи, остатки и маржу…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : !metrics || !t ? null : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Выручка" value={money(t.totalRevenue)} icon={<Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />} tone="bg-emerald-500/10" />
            <Kpi label="Валовая прибыль" value={money(t.totalProfit)} icon={<TrendingUp className="h-4 w-4 text-sky-600 dark:text-sky-400" />} tone="bg-sky-500/10" />
            <Kpi label="Мёртвый груз" value={money(t.deadStockValue)} icon={<Skull className="h-4 w-4 text-amber-600 dark:text-amber-400" />} tone="bg-amber-500/10" />
            <Kpi label="Потери" value={money(t.lossesValue)} icon={<AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />} tone="bg-rose-500/10" />
          </div>

          {/* AI-вывод */}
          <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 dark:border-violet-400/20 dark:bg-violet-500/[0.07]">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-200">
              <Sparkles className="h-4 w-4" /> AI-вывод
            </div>
            {loading ? (
              <div className={`flex items-center gap-2 text-sm ${C.sub}`}>
                <Loader2 className="h-4 w-4 animate-spin" /> Анализирую…
              </div>
            ) : data?.aiText ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{data.aiText}</p>
            ) : (
              <p className={`text-sm ${C.sub}`}>
                AI-вердикт недоступен (нет ключа OpenAI или сервис не ответил). Цифры ниже посчитаны и точны.
              </p>
            )}
          </div>

          {/* Звёзды прибыли */}
          <Section title="Звёзды прибыли" icon="💰" hint="Что кормит магазин — по валовой прибыли за период" count={metrics.topProfit.length}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${C.border}`}>
                    <th className={thCls}>Товар</th>
                    <th className={thR}>Прибыль</th>
                    <th className={thR}>Маржа</th>
                    <th className={thR}>Продано</th>
                    <th className={thR}>Выручка</th>
                    <th className={thR}>Скорость/нед</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${C.border}`}>
                  {metrics.topProfit.length ? metrics.topProfit.map((p) => (
                    <tr key={p.item_id}>
                      <td className={nameCls} title={p.name}>{p.name}</td>
                      <td className={`${tdR} font-semibold text-emerald-600 dark:text-emerald-400`}>{money(p.profit)}</td>
                      <td className={`${tdR} font-medium ${marginColor(p.marginPct)}`}>{p.marginPct}%</td>
                      <td className={tdR}>{fmt(p.soldQty)}</td>
                      <td className={tdR}>{money(p.revenue)}</td>
                      <td className={tdR}>{p.velocityPerWeek}</td>
                    </tr>
                  )) : <EmptyRow cols={6} text="Продаж за период нет" />}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Мёртвый груз */}
          <Section title="Мёртвый груз" icon="🪦" hint="Есть остаток, но 0 продаж за период — заморожены деньги" count={metrics.deadStock.length}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${C.border}`}>
                    <th className={thCls}>Товар</th>
                    <th className={thR}>Заморожено ₸</th>
                    <th className={thR}>Остаток</th>
                    <th className={thR}>Закуп</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${C.border}`}>
                  {metrics.deadStock.length ? metrics.deadStock.map((p) => (
                    <tr key={p.item_id}>
                      <td className={nameCls} title={p.name}>{p.name}</td>
                      <td className={`${tdR} font-semibold text-amber-600 dark:text-amber-400`}>{money(p.stockValue)}</td>
                      <td className={tdR}>{fmt(p.stock)}</td>
                      <td className={tdR}>{money(p.purchase)}</td>
                    </tr>
                  )) : <EmptyRow cols={4} text="Мёртвого груза нет — всё движется" />}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Медленные + низкая маржа */}
          <Section title="Медленные + низкая маржа" icon="🐌" hint="Продаются вяло и почти без наценки — кандидаты убрать или поднять цену" count={metrics.slowLowMargin.length}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${C.border}`}>
                    <th className={thCls}>Товар</th>
                    <th className={thR}>Маржа</th>
                    <th className={thR}>Скорость/нед</th>
                    <th className={thR}>Прибыль</th>
                    <th className={thR}>Остаток ₸</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${C.border}`}>
                  {metrics.slowLowMargin.length ? metrics.slowLowMargin.map((p) => (
                    <tr key={p.item_id}>
                      <td className={nameCls} title={p.name}>{p.name}</td>
                      <td className={`${tdR} font-medium ${marginColor(p.marginPct)}`}>{p.marginPct}%</td>
                      <td className={tdR}>{p.velocityPerWeek}</td>
                      <td className={tdR}>{money(p.profit)}</td>
                      <td className={tdR}>{money(p.stockValue)}</td>
                    </tr>
                  )) : <EmptyRow cols={5} text="Нет проблемных позиций" />}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Тренды */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Растут" icon="📈" hint="Вторая половина периода против первой" count={metrics.trending.rising.length}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={`border-b ${C.border}`}>
                      <th className={thCls}>Товар</th>
                      <th className={thR}>Тренд</th>
                      <th className={thR}>Было→Стало</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${C.border}`}>
                    {metrics.trending.rising.length ? metrics.trending.rising.map((p) => (
                      <tr key={p.item_id}>
                        <td className={nameCls} title={p.name}>{p.name}</td>
                        <td className={`${tdR} font-medium ${trendColor(p.trendPct)}`}>+{p.trendPct}%</td>
                        <td className={tdR}>{fmt(p.earlierQty)}→{fmt(p.recentQty)}</td>
                      </tr>
                    )) : <EmptyRow cols={3} text="Нет растущих" />}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Падают" icon="📉" hint="Вторая половина периода против первой" count={metrics.trending.falling.length}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={`border-b ${C.border}`}>
                      <th className={thCls}>Товар</th>
                      <th className={thR}>Тренд</th>
                      <th className={thR}>Было→Стало</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${C.border}`}>
                    {metrics.trending.falling.length ? metrics.trending.falling.map((p) => (
                      <tr key={p.item_id}>
                        <td className={nameCls} title={p.name}>{p.name}</td>
                        <td className={`${tdR} font-medium ${trendColor(p.trendPct)}`}>{p.trendPct}%</td>
                        <td className={tdR}>{fmt(p.earlierQty)}→{fmt(p.recentQty)}</td>
                      </tr>
                    )) : <EmptyRow cols={3} text="Нет падающих" />}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          {/* Потери */}
          <Section title="Потери" icon="🚨" hint="Списания и инвентаризация за период (в закупочных ₸)" count={metrics.losses.rows.length}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${C.border}`}>
                    <th className={thCls}>Товар</th>
                    <th className={thR}>Потеря ₸</th>
                    <th className={thR}>Кол-во</th>
                    <th className={thR}>Закуп</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${C.border}`}>
                  {metrics.losses.rows.length ? metrics.losses.rows.map((p) => (
                    <tr key={p.item_id}>
                      <td className={nameCls} title={p.name}>{p.name}</td>
                      <td className={`${tdR} font-semibold text-rose-600 dark:text-rose-400`}>{money(p.lossValue)}</td>
                      <td className={tdR}>{fmt(p.qty)}</td>
                      <td className={tdR}>{money(p.purchase)}</td>
                    </tr>
                  )) : <EmptyRow cols={4} text="Потерь за период нет" />}
                </tbody>
              </table>
            </div>
          </Section>

          <p className={`flex items-center gap-1.5 text-xs ${C.sub}`}>
            <Boxes className="h-3.5 w-3.5" /> За {metrics.days} дней продавалось {t.skuSold} позиций. Прибыль = продано × (цена − закуп). Заморожено = остаток × закуп.
          </p>
        </>
      )}
    </div>
  )
}
