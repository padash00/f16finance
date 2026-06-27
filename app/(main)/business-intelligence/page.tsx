'use client'

import { useEffect, useState } from 'react'
import { Brain, Loader2, RefreshCw } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'

// ── Типы ответа движка ───────────────────────────────────────────────────────
type AnomalyDay = { company: string; date: string; revenue: number; z: number; direction: 'above' | 'below' }
type AnomalyPoint = { company: string; mean: number; stddev: number; ucl: number; lcl: number; daysAnalyzed: number }
type AnomalySection = { available: boolean; note?: string; days: number; points: AnomalyPoint[]; anomalies: AnomalyDay[] }
type EoqRow = { item_id: string; name: string; annualDemand: number; eoq: number; stock: number; purchase: number }
type EoqSection = { available: boolean; note?: string; orderCost: number; holdingRate: number; rows: EoqRow[] }
type SafetyRow = { item_id: string; name: string; avgWeeklyDemand: number; sigmaWeekly: number; safetyStock: number; reorderPoint: number; stock: number; belowReorder: boolean }
type SafetySection = { available: boolean; note?: string; serviceZ: number; leadTimeWeeks: number; rows: SafetyRow[] }
type NewsvendorRow = { item_id: string; name: string; cu: number; co: number; criticalFractilePct: number; recommendedStock: number; stock: number }
type NewsvendorSection = { available: boolean; note?: string; rows: NewsvendorRow[] }
type AbcClassStat = { cls: 'A' | 'B' | 'C'; itemCount: number; itemSharePct: number; revenue: number; revenueSharePct: number }
type AbcVitalItem = { item_id: string; name: string; revenue: number; cumulativePct: number }
type AbcSection = { available: boolean; note?: string; totalRevenue: number; totalItems: number; classes: AbcClassStat[]; vital: AbcVitalItem[] }
type CashierRisk = { cashier: string; shortfallEvents: number; totalEvents: number; posterior: number; posteriorPct: number }
type BayesSection = { available: boolean; note?: string; source: 'audit' | 'writeoff' | 'none'; rows: CashierRisk[] }
type RfmCustomer = { customer_id: string; name: string; recencyDays: number; frequency: number; monetary: number; rScore: number; fScore: number; mScore: number; segment: string }
type RfmSegmentStat = { segment: string; count: number; monetary: number }
type RfmSection = { available: boolean; note?: string; segments: RfmSegmentStat[]; customers: RfmCustomer[] }
type BI = {
  organizationId: string | null
  generatedAt: string
  anomalies: AnomalySection
  eoq: EoqSection
  safetyStock: SafetySection
  newsvendor: NewsvendorSection
  abc: AbcSection
  cashierRisk: BayesSection
  rfm: RfmSection
}

const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸'
const num = (n: number) => Math.round(n || 0).toLocaleString('ru-RU')

const cardCls = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40'
const sub = 'text-slate-500 dark:text-slate-400'
const thCls = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const tdCls = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200 tabular-nums'

function SectionCard({
  emoji,
  title,
  formula,
  how,
  available,
  unavailableNote,
  children,
}: {
  emoji: string
  title: string
  formula: string
  how: string
  available: boolean
  unavailableNote?: string
  children?: React.ReactNode
}) {
  return (
    <div className={available ? cardCls : `${cardCls} opacity-60`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <span aria-hidden>{emoji}</span> {title}
          </h2>
          <p className={`mt-0.5 text-xs ${sub}`}>
            <span className="font-mono text-violet-600 dark:text-violet-300">{formula}</span>
          </p>
        </div>
        {!available ? (
          <span className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/15 dark:text-slate-400">
            нужны данные
          </span>
        ) : null}
      </div>
      <p className={`mt-2 flex items-start gap-1.5 text-xs ${sub}`}>
        <span aria-hidden>💡</span>
        <span className="leading-relaxed">{how}</span>
      </p>
      <div className="mt-4">
        {available ? children : <p className="text-sm text-slate-400 dark:text-slate-500">{unavailableNote || 'Недостаточно данных для расчёта.'}</p>}
      </div>
    </div>
  )
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
      <table className="min-w-full">{children}</table>
    </div>
  )
}

export default function BusinessIntelligencePage() {
  const [data, setData] = useState<BI | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/business-intelligence', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка')
      setData(j.data as BI)
      setLoaded(true)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    run()
  }, [])

  return (
    <div className="app-page-wide space-y-5 text-slate-900 dark:text-white">
      <AdminPageHeader
        title="Бизнес-аналитика"
        description="Формулы Amazon, Walmart, Six Sigma на твоих данных"
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <button
            onClick={run}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm ${sub} transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]`}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Обновить
          </button>
        }
      />

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm">Считаем формулы по данным за 60 дней…</p>
        </div>
      ) : !data ? null : (
        <div className={loading ? 'space-y-5 opacity-50 transition-opacity' : 'space-y-5'}>
          {/* A. Аномалии */}
          <SectionCard
            emoji="📈"
            title="Детектор аномалий (Six Sigma)"
            formula={`z = (x − μ) / σ · аномалия при |z| > 2 · границы μ ± 3σ`}
            how="Считаем среднюю дневную выручку каждой точки и её разброс. День, где выручка отклонилась больше чем на 2 сигмы — повод разобраться (праздник, сбой кассы, кража). Дни вне границ μ±3σ — почти наверняка не случайность."
            available={data.anomalies.available}
            unavailableNote={data.anomalies.note}
          >
            <div className="space-y-4">
              {data.anomalies.points.length ? (
                <Table>
                  <thead className="bg-slate-50 dark:bg-white/[0.03]">
                    <tr>
                      <th className={thCls}>Точка</th>
                      <th className={thCls}>Средняя выручка/день</th>
                      <th className={thCls}>σ</th>
                      <th className={thCls}>Нижняя граница</th>
                      <th className={thCls}>Верхняя граница</th>
                      <th className={thCls}>Дней</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {data.anomalies.points.map((p, i) => (
                      <tr key={i}>
                        <td className={`${tdCls} font-medium`}>{p.company}</td>
                        <td className={tdCls}>{money(p.mean)}</td>
                        <td className={tdCls}>{money(p.stddev)}</td>
                        <td className={tdCls}>{money(p.lcl)}</td>
                        <td className={tdCls}>{money(p.ucl)}</td>
                        <td className={tdCls}>{p.daysAnalyzed}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
              {data.anomalies.anomalies.length ? (
                <div>
                  <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${sub}`}>Аномальные дни</p>
                  <Table>
                    <thead className="bg-slate-50 dark:bg-white/[0.03]">
                      <tr>
                        <th className={thCls}>Точка</th>
                        <th className={thCls}>Дата</th>
                        <th className={thCls}>Выручка</th>
                        <th className={thCls}>z</th>
                        <th className={thCls}>Отклонение</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {data.anomalies.anomalies.map((a, i) => (
                        <tr key={i}>
                          <td className={`${tdCls} font-medium`}>{a.company}</td>
                          <td className={tdCls}>{a.date}</td>
                          <td className={tdCls}>{money(a.revenue)}</td>
                          <td className={`${tdCls} font-semibold`}>{a.z.toFixed(2)}</td>
                          <td className={tdCls}>
                            <span className={a.direction === 'above' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {a.direction === 'above' ? '▲ выше нормы' : '▼ ниже нормы'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <p className={`text-sm ${sub}`}>Аномальных дней не обнаружено — выручка стабильна.</p>
              )}
            </div>
          </SectionCard>

          {/* B. EOQ */}
          <SectionCard
            emoji="📦"
            title="EOQ — оптимальный размер заказа (формула Уилсона)"
            formula="EOQ = √(2·D·S / H)"
            how={`Сколько штук заказывать за раз, чтобы суммарно тратить меньше на доставку и хранение. D — годовой спрос, S — стоимость одного заказа (${num(data.eoq.orderCost)} ₸), H — хранение единицы в год (${Math.round(data.eoq.holdingRate * 100)}% от закупочной цены).`}
            available={data.eoq.available}
            unavailableNote={data.eoq.note}
          >
            <Table>
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className={thCls}>Товар</th>
                  <th className={thCls}>Годовой спрос (D)</th>
                  <th className={thCls}>EOQ (шт. за заказ)</th>
                  <th className={thCls}>Текущий остаток</th>
                  <th className={thCls}>Закупка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.eoq.rows.map((r) => (
                  <tr key={r.item_id}>
                    <td className={`${tdCls} font-medium`}>{r.name}</td>
                    <td className={tdCls}>{num(r.annualDemand)}</td>
                    <td className={`${tdCls} font-semibold text-violet-600 dark:text-violet-300`}>{num(r.eoq)}</td>
                    <td className={tdCls}>{num(r.stock)}</td>
                    <td className={tdCls}>{money(r.purchase)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </SectionCard>

          {/* C. Страховой запас */}
          <SectionCard
            emoji="🛡️"
            title="Страховой запас и точка дозаказа"
            formula={`SS = Z·σ_d·√L · ROP = спрос·L + SS · (Z=${data.safetyStock.serviceZ}, L=${data.safetyStock.leadTimeWeeks} нед)`}
            how="Сколько держать «на всякий случай» и при каком остатке пора заказывать снова, чтобы в 95% случаев не уйти в ноль. Если остаток ниже точки дозаказа — заказывайте сейчас."
            available={data.safetyStock.available}
            unavailableNote={data.safetyStock.note}
          >
            <Table>
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className={thCls}>Товар</th>
                  <th className={thCls}>Спрос/нед</th>
                  <th className={thCls}>σ недели</th>
                  <th className={thCls}>Страх. запас</th>
                  <th className={thCls}>Точка дозаказа</th>
                  <th className={thCls}>Остаток</th>
                  <th className={thCls}>Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.safetyStock.rows.map((r) => (
                  <tr key={r.item_id}>
                    <td className={`${tdCls} font-medium`}>{r.name}</td>
                    <td className={tdCls}>{r.avgWeeklyDemand}</td>
                    <td className={tdCls}>{r.sigmaWeekly}</td>
                    <td className={tdCls}>{num(r.safetyStock)}</td>
                    <td className={`${tdCls} font-semibold`}>{num(r.reorderPoint)}</td>
                    <td className={tdCls}>{num(r.stock)}</td>
                    <td className={tdCls}>
                      {r.belowReorder ? (
                        <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">заказать</span>
                      ) : (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">хватает</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </SectionCard>

          {/* D. Newsvendor */}
          <SectionCard
            emoji="🥡"
            title="Newsvendor — заказ скоропорта (critical fractile)"
            formula="CF = Cu / (Cu + Co) · Q* = μ + z(CF)·σ"
            how="Для товаров, что портятся: баланс между «не хватило» (теряем маржу Cu) и «списали» (теряем закупку Co). Чем выше критический фрактиль — тем смелее заказывать. Q* — рекомендуемый запас."
            available={data.newsvendor.available}
            unavailableNote={data.newsvendor.note}
          >
            {data.newsvendor.note ? <p className={`mb-3 text-xs ${sub}`}>{data.newsvendor.note}</p> : null}
            <Table>
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className={thCls}>Товар</th>
                  <th className={thCls}>Cu (маржа)</th>
                  <th className={thCls}>Co (закупка)</th>
                  <th className={thCls}>Крит. фрактиль</th>
                  <th className={thCls}>Реком. запас Q*</th>
                  <th className={thCls}>Остаток</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.newsvendor.rows.map((r) => (
                  <tr key={r.item_id}>
                    <td className={`${tdCls} font-medium`}>{r.name}</td>
                    <td className={tdCls}>{money(r.cu)}</td>
                    <td className={tdCls}>{money(r.co)}</td>
                    <td className={`${tdCls} font-semibold text-violet-600 dark:text-violet-300`}>{r.criticalFractilePct}%</td>
                    <td className={`${tdCls} font-semibold`}>{num(r.recommendedStock)}</td>
                    <td className={tdCls}>{num(r.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </SectionCard>

          {/* E. ABC */}
          <SectionCard
            emoji="🔤"
            title="ABC-анализ (Парето 80/20)"
            formula="накопит.% выручки · A ≤ 80% · B ≤ 95% · C — остальное"
            how="20% товаров дают 80% выручки. Класс A — жизненно важные (следите за наличием жёстко), C — кандидаты на сокращение ассортимента."
            available={data.abc.available}
            unavailableNote={data.abc.note}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {data.abc.classes.map((c) => (
                  <div key={c.cls} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      Класс {c.cls}
                      <span className={`ml-2 text-xs font-normal ${sub}`}>
                        {c.cls === 'A' ? 'жизненно важные' : c.cls === 'B' ? 'важные' : 'второстепенные'}
                      </span>
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">{c.itemCount} тов.</p>
                    <p className={`text-xs ${sub} tabular-nums`}>
                      {c.itemSharePct}% позиций · {c.revenueSharePct}% выручки
                    </p>
                    <p className={`mt-1 text-xs ${sub} tabular-nums`}>{money(c.revenue)}</p>
                  </div>
                ))}
              </div>
              {data.abc.vital.length ? (
                <div>
                  <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${sub}`}>Жизненно важные (класс A)</p>
                  <Table>
                    <thead className="bg-slate-50 dark:bg-white/[0.03]">
                      <tr>
                        <th className={thCls}>Товар</th>
                        <th className={thCls}>Выручка</th>
                        <th className={thCls}>Накопит. %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {data.abc.vital.map((v) => (
                        <tr key={v.item_id}>
                          <td className={`${tdCls} font-medium`}>{v.name}</td>
                          <td className={tdCls}>{money(v.revenue)}</td>
                          <td className={tdCls}>{v.cumulativePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* F. Байес-риск кассиров */}
          <SectionCard
            emoji="🎲"
            title="Байес-риск недостач по кассирам"
            formula="P = (1 + недостачи) / (5 + всего событий) · Beta(α=1, β=4)"
            how="Кто чаще «не досчитывается» на ревизии — с поправкой на малую выборку (байесовское сглаживание), чтобы один случай не клеймил человека. Высокий процент — повод присмотреться."
            available={data.cashierRisk.available}
            unavailableNote={data.cashierRisk.note}
          >
            {data.cashierRisk.note ? <p className={`mb-3 text-xs ${sub}`}>{data.cashierRisk.note}</p> : null}
            <Table>
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className={thCls}>Кассир</th>
                  <th className={thCls}>Недостачи</th>
                  <th className={thCls}>Всего событий</th>
                  <th className={thCls}>Риск недостачи</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.cashierRisk.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={`${tdCls} font-medium`}>{r.cashier}</td>
                    <td className={tdCls}>{r.shortfallEvents}</td>
                    <td className={tdCls}>{r.totalEvents}</td>
                    <td className={`${tdCls} font-semibold`}>
                      <span className={r.posteriorPct >= 30 ? 'text-rose-600 dark:text-rose-400' : r.posteriorPct >= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {r.posteriorPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </SectionCard>

          {/* G. RFM */}
          <SectionCard
            emoji="👥"
            title="RFM — сегментация клиентов"
            formula="R = давность · F = частота · M = сумма · квинтили 1–5"
            how="Делим клиентов по свежести, частоте и сумме покупок. Чемпионам — VIP-внимание, «в зоне риска» — вернуть акцией, «потерянным» — реактивация."
            available={data.rfm.available}
            unavailableNote={data.rfm.note}
          >
            <div className="space-y-4">
              {data.rfm.segments.length ? (
                <div className="flex flex-wrap gap-2">
                  {data.rfm.segments.map((s) => (
                    <div key={s.segment} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.segment}</p>
                      <p className={`text-xs ${sub} tabular-nums`}>
                        {s.count} клиентов · {money(s.monetary)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {data.rfm.customers.length ? (
                <Table>
                  <thead className="bg-slate-50 dark:bg-white/[0.03]">
                    <tr>
                      <th className={thCls}>Клиент</th>
                      <th className={thCls}>Сегмент</th>
                      <th className={thCls}>R (дней)</th>
                      <th className={thCls}>F</th>
                      <th className={thCls}>M</th>
                      <th className={thCls}>R/F/M</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {data.rfm.customers.map((c) => (
                      <tr key={c.customer_id}>
                        <td className={`${tdCls} font-medium`}>{c.name}</td>
                        <td className={tdCls}>{c.segment}</td>
                        <td className={tdCls}>{c.recencyDays >= 9999 ? '—' : c.recencyDays}</td>
                        <td className={tdCls}>{c.frequency}</td>
                        <td className={tdCls}>{money(c.monetary)}</td>
                        <td className={`${tdCls} ${sub}`}>{c.rScore}/{c.fScore}/{c.mScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </div>
          </SectionCard>

          <p className={`pt-2 text-center text-xs ${sub}`}>
            Расчёт по данным за 60 дней · обновлено {new Date(data.generatedAt).toLocaleString('ru-RU')}
          </p>
        </div>
      )}
    </div>
  )
}
