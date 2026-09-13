'use client'

/**
 * /analysis — прогноз на следующий месяц в трёх сценариях и история его точности.
 *
 * Модель (lib/analysis/forecast-learning) сверяет свои прошлые прогнозы с фактом
 * и по этим сверкам поправляется: веса способов, перекос, ширина коридора.
 * 1-го числа крон фиксирует прогноз на месяц — после закрытия месяца видно,
 * что обещали и что вышло. Раньше здесь и на /forecast жили два разных прогноза;
 * теперь он один.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Brain, CalendarCheck, GraduationCap, Info, RefreshCw, Sparkles, Store, Target } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { METHOD_LABELS, type Inside, type MethodId, type Scenarios, type Triple } from '@/lib/analysis/forecast-learning'
import type { MonthlyForecastResponse } from '@/lib/analysis/forecast-scope'

type Company = { id: string; name: string }

type AccuracyRow = { month: string; scenarios: Scenarios; actual: Triple; error: number | null; inside: Inside }

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[(m - 1) % 12]} ${y}`
}
const monthShort = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_SHORT[(m - 1) % 12]} ${String(y).slice(2)}`
}
const money = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸'
const moneyShort = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
  if (a >= 1_000) return Math.round(n / 1_000) + ' тыс'
  return String(Math.round(n))
}
const pct = (share: number) => `${Math.round(share * 100)}%`

export default function AnalysisPage() {
  const { can } = useCapabilities()
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [data, setData] = useState<MonthlyForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'frozen' | 'backtest'>('frozen')
  const [ai, setAi] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAi(null)
    try {
      const p = new URLSearchParams()
      if (companyId) p.set('company_id', companyId)
      const res = await fetch(`/api/admin/monthly-forecast?${p}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Не удалось построить прогноз')
      setData(body as MonthlyForecastResponse)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const frozenRows = useMemo<AccuracyRow[]>(
    () =>
      (data?.snapshots || [])
        .filter((s) => s.actual && s.inside)
        .map((s) => ({ month: s.targetMonth, scenarios: s.scenarios, actual: s.actual!, error: s.error?.income ?? null, inside: s.inside! })),
    [data],
  )
  const backtestRows = useMemo<AccuracyRow[]>(
    () =>
      (data?.next.backtest || []).map((r) => ({
        month: r.month,
        scenarios: r.scenarios,
        actual: r.actual,
        error: r.error.income,
        inside: r.inside,
      })),
    [data],
  )

  // Пока зафиксированных сверок нет — показываем расчёт задним числом
  useEffect(() => {
    if (data && frozenRows.length === 0) setSource('backtest')
  }, [data, frozenRows.length])

  const rows = source === 'frozen' ? frozenRows : backtestRows

  const askAi = useCallback(async () => {
    if (!data?.next.scenarios) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/admin/monthly-forecast/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMonthLabel: monthLabel(data.next.targetMonth),
          scenarios: data.next.scenarios,
          accuracy: data.next.accuracy,
          explanation: data.next.explanation,
          misses: rows.map((r) => ({
            month: monthLabel(r.month),
            forecast: r.scenarios.realistic.income,
            actual: r.actual.income,
            error: r.error,
            inside: r.inside.income,
          })),
          expense: data.forecast.expense,
          breakeven: data.forecast.breakeven.revenue,
        }),
      })
      const j = await res.json()
      setAi(res.ok ? j.text || 'Пусто.' : j.error || 'AI недоступен.')
    } catch {
      setAi('Не удалось получить AI-вывод.')
    } finally {
      setAiLoading(false)
    }
  }, [data, rows])

  const next = data?.next
  const scenarios = next?.scenarios ?? null

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Прогноз и точность"
        description="Три сценария на следующий месяц — модель сверяет свои прогнозы с фактом и поправляется"
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <>
            <NativeSelect value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-auto min-w-[160px]">
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="icon-sm" className="rounded-xl" onClick={() => void load()} disabled={loading} aria-label="Обновить">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
      />

      {error && (
        <Card className="flex-row items-center gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      )}

      {loading && !data ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Считаю прогноз и сверяю прошлые месяцы…
        </div>
      ) : data && next ? (
        <>
          {scenarios || data.current.outlook ? (
            <ForecastHero data={data} />
          ) : (
            <Card className="p-6 text-sm text-muted-foreground">Закрытых месяцев с выручкой пока нет — прогнозу не на чем строиться.</Card>
          )}

          {data.snapshotsWarning && (
            <Card className="flex-row items-start gap-2 border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" /> {data.snapshotsWarning}
            </Card>
          )}

          <LearningCard data={data} />

          <AccuracyCard
            rows={rows}
            source={source}
            onSource={setSource}
            frozenCount={frozenRows.length}
            backtestCount={backtestRows.length}
            trend={next.accuracy.trend}
          />

          <HistoryCard data={data} />

          {data.byCompany && data.byCompany.length > 0 && <ByCompanyCard data={data} />}

          <ExpenseCard data={data} />

          <Card className="gap-0 p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-violet-500" />
                AI-вывод
              </h3>
              {(can('analysis.refresh') || can('forecast.generate')) && scenarios && (
                <Button size="sm" variant="outline" onClick={() => void askAi()} disabled={aiLoading} className="rounded-xl">
                  {aiLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Получить вывод'}
                </Button>
              )}
            </div>
            {ai ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-body">{ai}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                AI объяснит, насколько верить прогнозу по истории промахов, и подскажет, как приблизить месяц к оптимистичному сценарию.
              </p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}

// ==================== blocks ====================

const MONTH_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const monthName = (ym: string) => {
  const name = MONTH_NAMES[(Number(ym.slice(5, 7)) - 1) % 12]
  return name.charAt(0).toUpperCase() + name.slice(1)
}
const monthGenitive = (ym: string) => MONTH_GENITIVE[(Number(ym.slice(5, 7)) - 1) % 12]

/** Верх страницы: идущий месяц (сколько выйдет к концу) и следующий — вкладками */
function ForecastHero({ data }: { data: MonthlyForecastResponse }) {
  const outlook = data.current.outlook
  const next = data.next
  const [tab, setTab] = useState<'current' | 'next'>(outlook ? 'current' : 'next')
  const recent = next.accuracy.recentError.income
  const cover = next.accuracy.coverage.income
  const showCurrent = tab === 'current' && outlook

  return (
    <Card className="gap-0 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-violet-500" />
        <h2 className="mr-1 text-base font-semibold text-foreground">Прогноз</h2>
        {outlook && (
          <Button size="sm" className="rounded-xl" variant={tab === 'current' ? 'default' : 'outline'} onClick={() => setTab('current')}>
            {monthName(outlook.month)} · идёт
          </Button>
        )}
        {next.scenarios && (
          <Button size="sm" className="rounded-xl" variant={tab === 'next' ? 'default' : 'outline'} onClick={() => setTab('next')}>
            {monthName(next.targetMonth)} · следующий
          </Button>
        )}
        <span className="ml-auto rounded-full border border-border bg-white/70 px-3 py-1 text-xs text-muted-foreground dark:bg-white/[0.03]">
          {recent !== null
            ? `средняя ошибка модели ${pct(recent)} · факт в коридоре ${cover.inside} из ${cover.total}`
            : 'точность появится после первых сверок'}
        </span>
      </div>

      {showCurrent ? (
        <CurrentMonthOutlook outlook={outlook} snapshot={data.current.snapshot} />
      ) : next.scenarios ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Прогноз на {monthLabel(next.targetMonth)} по закрытым месяцам. {outlook ? `${monthName(outlook.month)} ещё идёт и в этот расчёт не входит.` : ''}
          </p>
          <ScenarioColumns scenarios={next.scenarios} />
        </>
      ) : null}
    </Card>
  )
}

function CurrentMonthOutlook({
  outlook,
  snapshot,
}: {
  outlook: NonNullable<MonthlyForecastResponse['current']['outlook']>
  snapshot: MonthlyForecastResponse['current']['snapshot']
}) {
  const remaining = outlook.daysInMonth - outlook.knownDays
  const start = outlook.start

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        Сколько выйдет к концу {monthGenitive(outlook.month)}: факт за {outlook.knownDays} дн. плюс оценка оставшихся {remaining} дн. Коридор сужается с каждым днём.
      </p>
      <ScenarioColumns scenarios={outlook.outlook} />

      <div className="mt-4 space-y-2 text-sm">
        <div>
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              Прошло {outlook.knownDays} из {outlook.daysInMonth} дней
            </span>
            <span className="tabular-nums">{pct(outlook.knownShare)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(outlook.knownShare * 100)}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="text-muted-foreground">Факт на вчера:</span>
          <span className="text-muted-foreground">
            доход <b className="tabular-nums text-foreground">{money(outlook.fact.income)}</b>
          </span>
          <span className="text-muted-foreground">
            расход <b className="tabular-nums text-foreground">{money(outlook.fact.expense)}</b>
          </span>
          <span className="text-muted-foreground">
            прибыль{' '}
            <b className={`tabular-nums ${outlook.fact.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {money(outlook.fact.profit)}
            </b>
          </span>
        </div>

        <p className="text-muted-foreground">
          <CalendarCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          На начало месяца прогнозировали доход <b className="tabular-nums text-foreground">{money(start.realistic.income)}</b>{' '}
          <span className="tabular-nums">
            ({moneyShort(start.pessimistic.income)} … {moneyShort(start.optimistic.income)})
          </span>
          {snapshot
            ? ` — зафиксирован ${new Date(snapshot.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}${snapshot.late ? ', не 1-го числа' : ''}.`
            : ' — расчёт модели, фиксация на этот месяц ещё не велась.'}
        </p>

        {outlook.paceIncome !== null && (
          <p className="text-muted-foreground">
            Если остаток месяца пойдёт темпом последних 8 недель — доход около{' '}
            <b className="tabular-nums text-foreground">{money(outlook.paceIncome)}</b>.
          </p>
        )}
      </div>
    </>
  )
}

function ScenarioColumns({ scenarios }: { scenarios: Scenarios }) {
  const columns = [
    { key: 'pessimistic', title: 'Пессимистичный', hint: 'если пойдёт хуже обычного', value: scenarios.pessimistic, tone: 'border-rose-500/25 bg-rose-500/[0.04]', title_tone: 'text-rose-600 dark:text-rose-400' },
    { key: 'realistic', title: 'Реальный', hint: 'самый вероятный исход', value: scenarios.realistic, tone: 'border-violet-500/40 bg-violet-500/[0.06] ring-1 ring-violet-500/30', title_tone: 'text-violet-600 dark:text-violet-400' },
    { key: 'optimistic', title: 'Оптимистичный', hint: 'если пойдёт лучше обычного', value: scenarios.optimistic, tone: 'border-emerald-500/25 bg-emerald-500/[0.04]', title_tone: 'text-emerald-600 dark:text-emerald-400' },
  ]

  return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {columns.map((col) => (
          <div key={col.key} className={`rounded-2xl border p-4 ${col.tone}`}>
            <div className={`text-sm font-semibold ${col.title_tone}`}>{col.title}</div>
            <div className="text-xs text-muted-foreground">{col.hint}</div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <ScenarioLine label="Доход" value={col.value.income} />
              <ScenarioLine label="Расход" value={col.value.expense} />
              <div className="border-t border-border pt-1.5">
                <ScenarioLine label="Прибыль" value={col.value.profit} strong />
              </div>
            </dl>
          </div>
        ))}
      </div>
  )
}

function ScenarioLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`tabular-nums ${strong ? `text-lg font-bold ${value >= 0 ? 'text-foreground' : 'text-rose-600 dark:text-rose-400'}` : 'font-medium text-foreground'}`}
      >
        {money(value)}
      </dd>
    </div>
  )
}

function LearningCard({ data }: { data: MonthlyForecastResponse }) {
  const calibration = data.next.calibration
  const weights = calibration
    ? (Object.entries(calibration.weights.income) as Array<[MethodId, number | undefined]>).sort((a, b) => (b[1] || 0) - (a[1] || 0))
    : []

  return (
    <Card className="gap-0 p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <GraduationCap className="h-4 w-4 text-violet-500" />
        Как модель учится
      </h3>

      {weights.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="text-xs text-muted-foreground">Вес способов прогноза дохода — больше у того, кто меньше ошибался</div>
          {weights.map(([method, weight]) => (
            <div key={method} className="flex items-center gap-3">
              <div className="w-40 shrink-0 truncate text-xs text-body">{METHOD_LABELS[method]}</div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round((weight || 0) * 100)}%` }} />
              </div>
              <div className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{pct(weight || 0)}</div>
            </div>
          ))}
        </div>
      )}

      <ul className="space-y-1.5 border-t border-border pt-3">
        {data.next.explanation.map((line, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-body">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function AccuracyCard({
  rows,
  source,
  onSource,
  frozenCount,
  backtestCount,
  trend,
}: {
  rows: AccuracyRow[]
  source: 'frozen' | 'backtest'
  onSource: (s: 'frozen' | 'backtest') => void
  frozenCount: number
  backtestCount: number
  trend: MonthlyForecastResponse['next']['accuracy']['trend']
}) {
  const chartData = rows.map((r) => ({
    label: monthShort(r.month),
    band: [Math.round(r.scenarios.pessimistic.income), Math.round(r.scenarios.optimistic.income)],
    forecast: Math.round(r.scenarios.realistic.income),
    actual: Math.round(r.actual.income),
    error: r.error === null ? null : Math.round(r.error * 100),
  }))
  const recent = rows.slice(-6).map((r) => r.error).filter((e): e is number => e !== null)
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null
  const inside = rows.slice(-12).filter((r) => r.inside.income).length
  const total = rows.slice(-12).length

  return (
    <Card className="gap-0 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Точность: прогноз против факта</h3>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="xs" className="rounded-xl" variant={source === 'frozen' ? 'default' : 'outline'} disabled={frozenCount === 0} onClick={() => onSource('frozen')}>
            Зафиксированные ({frozenCount})
          </Button>
          <Button size="xs" className="rounded-xl" variant={source === 'backtest' ? 'default' : 'outline'} onClick={() => onSource('backtest')}>
            Расчёт задним числом ({backtestCount})
          </Button>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {source === 'frozen'
          ? 'Прогнозы, сохранённые 1-го числа и не менявшиеся после — самая честная проверка.'
          : 'Модель прогнана по истории так, будто работала с первого месяца: каждый прогноз построен только по данным до него. Зафиксированные прогнозы начнут копиться с 1-го числа.'}
      </p>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Сверок пока нет — нужно хотя бы 4 закрытых месяца.</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {recentAvg !== null && (
              <span className="text-muted-foreground">
                средняя ошибка за последние {recent.length} мес: <b className="tabular-nums text-foreground">{pct(recentAvg)}</b>
              </span>
            )}
            <span className="text-muted-foreground">
              факт в коридоре: <b className="tabular-nums text-foreground">{inside} из {total}</b>
            </span>
            {source === 'backtest' && trend && (
              <span className={trend === 'improving' ? 'text-emerald-600 dark:text-emerald-400' : trend === 'worsening' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
                {trend === 'improving' ? 'ошибка снижается' : trend === 'worsening' ? 'ошибка растёт' : 'ошибка стабильна'}
              </span>
            )}
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.35} vertical={false} />
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="money" fontSize={10} tickLine={false} axisLine={false} tickFormatter={moneyShort} width={60} />
                <YAxis yAxisId="error" orientation="right" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip
                  formatter={(value: any, name: any) => {
                    if (name === 'Ошибка') return [`${value}%`, name]
                    if (Array.isArray(value)) return [`${money(value[0])} … ${money(value[1])}`, name]
                    return [money(Number(value)), name]
                  }}
                />
                <Legend />
                <Area yAxisId="money" dataKey="band" name="Коридор" fill="#8b5cf6" fillOpacity={0.12} stroke="none" />
                <Line yAxisId="money" dataKey="forecast" name="Прогноз (реальный)" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                <Line yAxisId="money" dataKey="actual" name="Факт" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Bar yAxisId="error" dataKey="error" name="Ошибка" fill="#f59e0b" fillOpacity={0.35} barSize={10} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Месяц</th>
                  <th className="px-2 py-2 text-right font-medium">Пессим.</th>
                  <th className="px-2 py-2 text-right font-medium">Реальный</th>
                  <th className="px-2 py-2 text-right font-medium">Оптим.</th>
                  <th className="px-2 py-2 text-right font-medium">Факт</th>
                  <th className="px-2 py-2 text-right font-medium">Ошибка</th>
                  <th className="px-2 py-2 text-right font-medium">Коридор</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => {
                  const below = r.actual.income < Math.min(r.scenarios.pessimistic.income, r.scenarios.optimistic.income)
                  return (
                    <tr key={r.month} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                      <td className="whitespace-nowrap px-2 py-2 text-foreground">{monthLabel(r.month)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(r.scenarios.pessimistic.income)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-body">{money(r.scenarios.realistic.income)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(r.scenarios.optimistic.income)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">{money(r.actual.income)}</td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${r.error === null ? 'text-muted-foreground' : r.error <= 0.1 ? 'text-emerald-600 dark:text-emerald-400' : r.error <= 0.25 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}
                      >
                        {r.error === null ? '—' : pct(r.error)}
                      </td>
                      <td className="px-2 py-2 text-right text-xs">
                        {r.inside.income ? (
                          <span className="text-emerald-600 dark:text-emerald-400">внутри</span>
                        ) : below ? (
                          <span className="text-rose-600 dark:text-rose-400">ниже</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">выше</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function HistoryCard({ data }: { data: MonthlyForecastResponse }) {
  const months = data.forecast.months
  const chartData = months.map((m) => ({
    label: monthShort(m.month) + (m.isPartial ? ' (тек.)' : ''),
    Доход: Math.round(m.income),
    Расход: Math.round(m.expense),
    Прибыль: Math.round(m.profit),
  }))

  return (
    <Card className="gap-0 p-5">
      <h3 className="mb-4 text-sm font-semibold text-foreground">История по месяцам</h3>
      {chartData.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Нет данных</div>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.35} vertical={false} />
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={moneyShort} />
                <Tooltip formatter={(v: any) => money(Number(v))} />
                <Legend />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="Доход" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Расход" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Прибыль" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d['Прибыль'] >= 0 ? '#8b5cf6' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Месяц</th>
                  <th className="px-2 py-2 text-right font-medium">Доход</th>
                  <th className="px-2 py-2 text-right font-medium">Постоянные</th>
                  <th className="px-2 py-2 text-right font-medium">Переменные</th>
                  <th className="px-2 py-2 text-right font-medium">Разовые</th>
                  <th className="px-2 py-2 text-right font-medium">Прибыль</th>
                  <th className="px-2 py-2 text-right font-medium">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                    <td className="whitespace-nowrap px-2 py-2 text-foreground">
                      {monthLabel(m.month)}
                      {m.isPartial && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">тек.</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-body">{money(m.income)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(m.fixed)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(m.variable)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-faint">{m.oneOff > 0 ? money(m.oneOff) : '—'}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${m.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {money(m.profit)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-body">{m.marginPct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function ByCompanyCard({ data }: { data: MonthlyForecastResponse }) {
  return (
    <Card className="gap-0 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Store className="h-4 w-4 text-violet-500" />
        По точкам — {monthLabel(data.next.targetMonth)}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">Точка</th>
              <th className="px-2 py-2 text-right font-medium">Доход (реальный)</th>
              <th className="px-2 py-2 text-right font-medium">Коридор дохода</th>
              <th className="px-2 py-2 text-right font-medium">Прибыль</th>
              <th className="px-2 py-2 text-right font-medium">Ошибка модели</th>
            </tr>
          </thead>
          <tbody>
            {data.byCompany!.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                <td className="max-w-[180px] truncate px-2 py-2 font-medium text-foreground">{c.name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-body">{money(c.scenarios.realistic.income)}</td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
                  {moneyShort(c.scenarios.pessimistic.income)} … {moneyShort(c.scenarios.optimistic.income)}
                </td>
                <td className={`px-2 py-2 text-right font-semibold tabular-nums ${c.scenarios.realistic.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {money(c.scenarios.realistic.profit)}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
                  {c.recentError === null ? 'мало сверок' : `${pct(c.recentError)} · ${c.checks} сверок`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ExpenseCard({ data }: { data: MonthlyForecastResponse }) {
  const { forecast, next } = data
  const realisticIncome = next.scenarios?.realistic.income ?? 0
  const breakeven = forecast.breakeven.revenue
  const safety = realisticIncome > 0 ? ((realisticIncome - breakeven) / realisticIncome) * 100 : null
  const groups = forecast.expenseByGroup.slice(0, 8)
  const max = groups[0]?.amount || 1

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="gap-0 p-5">
        <div className="mb-1 text-xs text-muted-foreground">Точка безубыточности</div>
        <div className="text-xl font-bold tabular-nums text-foreground">{money(breakeven)}</div>
        <p className="mt-1 text-xs text-muted-foreground">доход, при котором месяц выходит в ноль</p>
        {safety !== null && (
          <p className={`mt-2 text-sm font-medium ${safety >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            запас прочности по реальному сценарию {safety >= 0 ? '+' : ''}
            {safety.toFixed(0)}%
          </p>
        )}
      </Card>

      <Card className="gap-0 p-5 lg:col-span-2">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Расход по статьям (в среднем за месяц)</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расходов пока нет.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.group} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-xs text-body sm:w-44">{g.label}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div className={`h-full rounded-full ${g.bucket === 'variable' ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${Math.min(100, (g.amount / max) * 100)}%` }} />
                </div>
                <div className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{money(g.amount)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
          <Legendary color="bg-violet-500">постоянные</Legendary>
          <Legendary color="bg-amber-500">переменные (% от дохода)</Legendary>
        </div>
      </Card>
    </div>
  )
}

function Legendary({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {children}
    </span>
  )
}
