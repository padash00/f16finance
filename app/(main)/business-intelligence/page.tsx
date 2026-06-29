'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Brain, Loader2, RefreshCw, Sparkles } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'

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
type HealthFactor = { label: string; score0to100: number; note: string }
type HealthSection = { score: number; factors: HealthFactor[] }
type ClvRow = { customer_id: string; name: string; clv: number; avgOrder: number; frequency: number }
type ClvSection = { available: boolean; note?: string; rows: ClvRow[] }
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
  healthScore: HealthSection
  clv: ClvSection
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
  action,
  available,
  unavailableNote,
  headerExtra,
  children,
}: {
  emoji: string
  title: string
  formula: string
  how: string
  action?: string
  available: boolean
  unavailableNote?: string
  headerExtra?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className={available ? cardCls : `${cardCls} opacity-60`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <span aria-hidden>{emoji}</span> {title}
          </h2>
          <p className="mt-1">
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
              {formula}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          {!available ? (
            <span className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/15 dark:text-slate-400">
              нужны данные
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-violet-500/[0.06] px-3 py-2">
        <p className="flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-200">
          <span aria-hidden>💡</span>
          <span className="leading-relaxed"><span className="font-medium">Что это:</span> {how}</span>
        </p>
        {action ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            <span aria-hidden>👉</span>
            <span className="leading-relaxed">{action}</span>
          </p>
        ) : null}
      </div>
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

// Маленькая кнопка-ссылка (deep-link) для секции.
function DeepLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
    >
      {children}
    </Link>
  )
}

type Company = { id: string; name: string }

export default function BusinessIntelligencePage() {
  const [data, setData] = useState<BI | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('') // '' = все точки
  const [days, setDays] = useState<number>(90) // период анализа (пресет)
  const [period, setPeriod] = useState<number | 'custom'>(90) // выбор в селекте
  const [customFrom, setCustomFrom] = useState<string>('') // YYYY-MM-DD
  const [customTo, setCustomTo] = useState<string>('') // YYYY-MM-DD
  // Произвольный период активен только когда выбран «custom» и обе даты заданы.
  const customActive = period === 'custom' && !!customFrom && !!customTo

  // AI-сводка «Главное сегодня».
  const [aiActions, setAiActions] = useState<string[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiUnavailable, setAiUnavailable] = useState(false)

  // Параметры периода для запроса: либо {from,to}, либо {days}.
  const periodParams = (): { from?: string; to?: string; days?: number } =>
    customActive ? { from: customFrom, to: customTo } : { days }

  const runAi = async (cid: string = companyId, pp: { from?: string; to?: string; days?: number } = periodParams()) => {
    setAiLoading(true)
    setAiUnavailable(false)
    setAiActions(null)
    try {
      const res = await fetch('/api/ai/business-intelligence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          company_id: cid || null,
          days: pp.days || null,
          from: pp.from || null,
          to: pp.to || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok && Array.isArray(j.actions) && j.actions.length) {
        setAiActions(j.actions as string[])
      } else {
        setAiUnavailable(true)
      }
    } catch {
      setAiUnavailable(true)
    } finally {
      setAiLoading(false)
    }
  }

  const run = async (cid: string = companyId, pp: { from?: string; to?: string; days?: number } = periodParams()) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cid) params.set('company_id', cid)
      if (pp.from && pp.to) {
        params.set('from', pp.from)
        params.set('to', pp.to)
      } else if (pp.days) {
        params.set('days', String(pp.days))
      }
      const qs = params.toString()
      const url = qs ? `/api/admin/business-intelligence?${qs}` : '/api/admin/business-intelligence'
      const res = await fetch(url, { cache: 'no-store' })
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

  // Список точек.
  useEffect(() => {
    let active = true
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return
        setCompanies((Array.isArray(j?.data) ? j.data : []) as Company[])
      })
      .catch(() => { if (active) setCompanies([]) })
    return () => { active = false }
  }, [])

  // Первичная загрузка + перезапуск при смене точки или периода.
  // При «своём периоде» ждём, пока заданы ОБЕ даты (иначе не дёргаем сервер).
  useEffect(() => {
    if (period === 'custom' && !customActive) return
    const pp = customActive ? { from: customFrom, to: customTo } : { days }
    run(companyId, pp)
    runAi(companyId, pp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days, period, customFrom, customTo])

  // Подпись периода (учитывает «свой период»: «с DD.MM по DD.MM»).
  const dmShort = (iso: string) => {
    const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    return m2 ? `${m2[3]}.${m2[2]}` : iso
  }
  const periodLabel = customActive
    ? `с ${dmShort(customFrom)} по ${dmShort(customTo)}`
    : `за ${days} дней`

  return (
    <div className="app-page-wide space-y-5 text-slate-900 dark:text-white">
      <AdminPageHeader
        title="Бизнес-аналитика"
        description="Формулы Amazon, Walmart, Six Sigma на твоих данных"
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={period === 'custom' ? 'custom' : String(period)}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'custom') {
                  setPeriod('custom')
                } else {
                  const n = Number(v)
                  setPeriod(n)
                  setDays(n)
                }
              }}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]"
              title="Период анализа"
            >
              <option value={30}>Месяц</option>
              <option value={90}>Квартал</option>
              <option value={180}>Полгода</option>
              <option value={365}>Год</option>
              <option value="custom">Свой период</option>
            </select>
            {period === 'custom' ? (
              <>
                <DatePicker
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={setCustomFrom}
                  disabled={loading}
                />
                <span className={`text-sm ${sub}`}>—</span>
                <DatePicker
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={setCustomTo}
                  disabled={loading}
                />
              </>
            ) : null}
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={loading}
              className={`rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]`}
            >
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => { run(); runAi() }}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm ${sub} transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Обновить
            </button>
          </div>
        }
      />

      <p className={`text-xs ${sub}`}>
        {companyId
          ? `Показано по точке: ${companies.find((c) => c.id === companyId)?.name || '—'}`
          : 'По всем точкам (детектор аномалий — по каждой отдельно)'}
      </p>

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      {/* AI-сводка «Главное сегодня» + Оценка здоровья */}
      {(aiLoading || aiActions || (data && data.healthScore.factors.length > 0)) ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* AI-сводка */}
          {(aiLoading || aiActions) ? (
            <div className="lg:col-span-2 rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-5 dark:border-violet-400/30 dark:from-violet-500/10 dark:to-slate-900/40">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <span aria-hidden>🧠</span> Главное сегодня
                <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
              </h2>
              {aiLoading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-500" /> ИИ анализирует…
                </div>
              ) : aiActions && aiActions.length ? (
                <ol className="mt-3 space-y-2">
                  {aiActions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-800 dark:text-slate-100">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{a}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          {/* Оценка здоровья */}
          {data && data.healthScore.factors.length > 0 ? (
            <div className={`${cardCls} ${aiLoading || aiActions ? '' : 'lg:col-span-3'}`}>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <span aria-hidden>❤️‍🩹</span> Здоровье бизнеса
              </h2>
              <div className="mt-2 flex items-end gap-2">
                <span
                  className={`text-4xl font-bold tabular-nums ${
                    data.healthScore.score >= 80
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : data.healthScore.score >= 60
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {data.healthScore.score}
                </span>
                <span className={`pb-1 text-sm ${sub}`}>/ 100</span>
              </div>
              <div className="mt-3 space-y-2.5">
                {data.healthScore.factors.map((f) => (
                  <div key={f.label}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{f.label}</span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">{f.score0to100}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                      <div
                        className={`h-full rounded-full ${
                          f.score0to100 >= 80 ? 'bg-emerald-500' : f.score0to100 >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, f.score0to100))}%` }}
                      />
                    </div>
                    <p className={`mt-0.5 text-[11px] ${sub}`}>{f.note}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : aiUnavailable && !aiActions ? (
        <p className={`text-xs ${sub}`}>AI-сводка недоступна.</p>
      ) : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm">Считаем формулы по данным {periodLabel}…</p>
        </div>
      ) : !data ? null : (
        <div className={loading ? 'space-y-5 opacity-50 transition-opacity' : 'space-y-5'}>
          {/* A. Аномалии */}
          <SectionCard
            emoji="📈"
            title="Детектор аномалий (Six Sigma)"
            formula={`z = (x − μ) / σ · аномалия при |z| > 2 · границы μ ± 3σ`}
            how="Система знает твою обычную выручку по дням. Если день резко выбился из нормы — подсвечивает."
            action="Проверь выделенные дни: сбой кассы, забыли пробить, или воровство."
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
            how="Сколько штук брать за один заказ: слишком часто заказывать — переплата за доставку и время; слишком много разом — деньги застряли на складе."
            action="Заказывай примерно по EOQ — это золотая середина."
            available={data.eoq.available}
            unavailableNote={data.eoq.note}
            headerExtra={<DeepLink href="/store/purchase-plan">📦 Запланировать закуп</DeepLink>}
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
            how="Сколько держать «про запас», чтобы не остаться без ходового товара."
            action="Когда остаток падает до «точки дозаказа» — пора заказывать."
            available={data.safetyStock.available}
            unavailableNote={data.safetyStock.note}
            headerExtra={<DeepLink href="/store/purchase-plan">📦 Запланировать закуп</DeepLink>}
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
            how="Для товара, который может залежаться/испортиться: сколько брать, чтобы и не кончилось, и не списывать."
            action="Держи запас близко к рекомендованному."
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
            how="Обычно 20% товаров дают 80% выручки. Класс A — твои кормильцы, класс C — мелочь."
            action="За классом A следи в первую очередь: не допускай, чтобы он кончался."
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
            how="По ревизиям считает, у кого недостачи СИСТЕМАТИЧЕСКИ, а не разово (случайная ошибка бывает у всех)."
            action="Высокий % — присмотрись к кассиру лично."
            available={data.cashierRisk.available}
            unavailableNote={data.cashierRisk.note}
            headerExtra={<DeepLink href="/shifts/reports">🔍 Смотреть смены</DeepLink>}
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
            how="Делит клиентов по поведению: кто ходит часто и много, а кто давно пропал."
            action="«В зоне риска» и «Уходят» — верни акцией/сообщением, пока не потеряли."
            available={data.rfm.available}
            unavailableNote={data.rfm.note}
            headerExtra={<DeepLink href="/customers">✉️ К клиентам</DeepLink>}
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

          {/* CLV — ценность клиента */}
          <SectionCard
            emoji="💎"
            title="Ценность клиента (CLV)"
            formula="CLV ≈ средний чек · частота · 2"
            how="Сколько денег приносит клиент за всё время. Видно, на кого тратить силы и кого нельзя терять."
            action="Береги клиентов с высоким CLV: персональное внимание, бонусы — потеря одного дороже десяти случайных."
            available={data.clv.available}
            unavailableNote={data.clv.note}
            headerExtra={<DeepLink href="/customers">✉️ К клиентам</DeepLink>}
          >
            <Table>
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className={thCls}>Клиент</th>
                  <th className={thCls}>Средний чек</th>
                  <th className={thCls}>Покупок</th>
                  <th className={thCls}>CLV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.clv.rows.map((c) => (
                  <tr key={c.customer_id}>
                    <td className={`${tdCls} font-medium`}>{c.name}</td>
                    <td className={tdCls}>{money(c.avgOrder)}</td>
                    <td className={tdCls}>{c.frequency}</td>
                    <td className={`${tdCls} font-semibold text-violet-600 dark:text-violet-300`}>{money(c.clv)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </SectionCard>

          <p className={`pt-2 text-center text-xs ${sub}`}>
            Расчёт по данным {periodLabel} · обновлено {new Date(data.generatedAt).toLocaleString('ru-RU')}
          </p>
        </div>
      )}
    </div>
  )
}
