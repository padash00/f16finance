'use client'

/**
 * ОПиУ — отчёт о прибылях и убытках за месяц.
 *
 * Только из журналов: выручка — как в «Доходах», расходы — как в «Расходах»
 * (отклонённые не считаются), налог — из журнала расходов. Ручных поправок нет,
 * поэтому под отчётом сверка: как из сумм тех страниц получились строки ОПиУ.
 *
 * Считает сервер (lib/domain/profitability-report) — те же цифры в PDF и приложении.
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronRight, Download, Landmark, Loader2, Plus, Scale, Store, Trash2 } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { PageSkeleton } from '@/components/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { useCompanies } from '@/hooks/use-companies'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import type { CategoryAmount, CompanyPnl, PnlLineKey, PnlMonth, ProfitabilityReport } from '@/lib/domain/profitability-report'

// ─── Даты и форматирование ──────────────────────────────────────────────────

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const shiftMonth = (month: string, offset: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const name = MONTHS[m - 1] || month
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}
const monthOptions = () => Array.from({ length: 36 }, (_, i) => shiftMonth(currentMonth(), -i))

const money = (v: number) => `${Math.round(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU')} ₸`
const signed = (v: number) => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('ru-RU')} ₸`
const toNumber = (value: string) => {
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.') || 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

const GOOD = 'text-emerald-700 dark:text-emerald-400'
const BAD = 'text-rose-600 dark:text-rose-400'
const tone = (v: number) => (Math.round(v) < 0 ? BAD : GOOD)
/** Рост расхода — плохо, рост выручки и прибыли — хорошо */
const changeTone = (delta: number, expense: boolean) => (Math.round(delta) === 0 ? 'text-muted-foreground' : (delta > 0) !== expense ? GOOD : BAD)

const th = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const thr = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground'
const td = 'px-3 py-2 text-sm tabular-nums'
const tdr = 'px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap'

// ─── Цепочка ОПиУ ───────────────────────────────────────────────────────────

type ChainRow =
  | { kind: 'line'; key: PnlLineKey | 'revenue'; label: string; get: (p: PnlMonth) => number; expense: boolean }
  | { kind: 'total'; label: string; get: (p: PnlMonth) => number; final?: boolean }

const chain = (posLabel: string): ChainRow[] => [
  { kind: 'line', key: 'revenue', label: 'Выручка', get: (p) => p.revenue, expense: false },
  { kind: 'line', key: 'cogs', label: 'Себестоимость', get: (p) => p.cogs, expense: true },
  { kind: 'total', label: 'Валовая прибыль', get: (p) => p.grossProfit },
  { kind: 'line', key: 'operating', label: 'Операционные расходы', get: (p) => p.operatingExpenses, expense: true },
  { kind: 'line', key: 'pos', label: `Комиссия банка (${posLabel})`, get: (p) => p.posCommission, expense: true },
  { kind: 'line', key: 'payroll', label: 'Зарплаты', get: (p) => p.payroll, expense: true },
  { kind: 'line', key: 'payrollTaxes', label: 'Налоги на зарплату', get: (p) => p.payrollTaxes, expense: true },
  { kind: 'total', label: 'EBITDA', get: (p) => p.ebitda },
  { kind: 'line', key: 'depreciation', label: 'Амортизация', get: (p) => p.depreciation, expense: true },
  { kind: 'total', label: 'Операционная прибыль', get: (p) => p.operatingProfit },
  { kind: 'line', key: 'financial', label: 'Проценты по кредитам', get: (p) => p.financialExpenses, expense: true },
  { kind: 'line', key: 'tax', label: 'Налог', get: (p) => p.incomeTax, expense: true },
  { kind: 'line', key: 'nonOperating', label: 'Разовые расходы', get: (p) => p.nonOperating, expense: true },
  { kind: 'total', label: 'Чистая прибыль', get: (p) => p.netProfit, final: true },
]

const OFF_CHAIN: Array<{ key: PnlLineKey; label: string; get: (p: PnlMonth) => number }> = [
  { key: 'capex', label: 'Покупка оборудования', get: (p) => p.capex },
  { key: 'distribution', label: 'Выплаты партнёрам', get: (p) => p.profitDistribution },
]

/** Строки чистой цепочки без пустых — для таблицы и PDF */
const visibleChain = (posLabel: string, current: PnlMonth, previous: PnlMonth | null) =>
  chain(posLabel).filter((row) => row.kind === 'total' || row.key === 'revenue' || Math.round(row.get(current)) !== 0 || (previous && Math.round(row.get(previous)) !== 0))

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card className="gap-0 p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </Card>
  )
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function ProfitabilityPage() {
  const cashLabels = useCashlessLabels()
  const { can } = useCapabilities()
  const { companies } = useCompanies()
  const MONTH_OPTIONS = useMemo(() => monthOptions(), [])

  const [month, setMonth] = useState(shiftMonth(currentMonth(), -1))
  const [pointId, setPointId] = useState('')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [report, setReport] = useState<ProfitabilityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: month, to: month, with_previous: '1' })
      if (includeExtra) params.set('include_extra', '1')
      const res = await fetch(`/api/admin/profitability/summary?${params}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось посчитать ОПиУ')
      setReport(body.data)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [month, includeExtra])

  useEffect(() => {
    void load()
  }, [load])

  const point = pointId ? report?.companies.find((c) => c.id === pointId) || null : null
  const current = report ? (pointId ? point?.months[0] || null : report.months[0] || null) : null
  const previous = report ? (pointId ? point?.previous || null : report.previous) : null
  const pointName = pointId ? companies.find((c) => c.id === pointId)?.name || point?.name || 'точка' : null
  const extraNames = report?.extra.names || []
  const incomplete = (report?.incompleteMonths || []).filter((m) => !pointId || m.companyId === pointId)

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="ОПиУ"
        description="Отчёт о прибылях и убытках: выручка, расходы по статьям и чистая прибыль — из журналов доходов и расходов"
        icon={<Landmark className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-9 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц">
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="h-9 w-auto" value={pointId} onChange={(e) => setPointId(e.target.value)} aria-label="Точка">
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {extraNames.length && !pointId ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={includeExtra} onCheckedChange={(v) => setIncludeExtra(v === true)} /> с {extraNames.join(', ')}
              </label>
            ) : null}
          </div>
        }
      />

      {error ? (
        <Card className="flex-row items-center gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      ) : null}

      {loading && !report ? (
        <PageSkeleton stats={0} rows={12} cols={4} />
      ) : report ? (
        <div className={loading ? 'space-y-5 opacity-60' : 'space-y-5'}>
          {incomplete.length ? (
            <Card className="flex-row items-start gap-2 border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Месяц внесён не полностью: {incomplete.map((m) => `${m.company} — ${m.days} дн. из обычных ${m.expectedDays}`).join(', ')}. Выручка и прибыль будут меньше, пока отчёты смен не внесут.
            </Card>
          ) : null}

          {current ? (
            <>
              <Section
                title={`${monthLabel(month)}${pointName ? ` — ${pointName}` : ''}`}
                subtitle={previous ? `Рядом — ${monthLabel(previous.month).toLowerCase()} и насколько изменилось. Нажмите на строку, чтобы увидеть статьи.` : 'Нажмите на строку, чтобы увидеть статьи.'}
                icon={<Landmark className="h-4 w-4 text-emerald-500" />}
              >
                <PnlTable current={current} previous={previous} labels={cashLabels} />
              </Section>

              <Section title="Сверка с «Доходами» и «Расходами»" subtitle="Откуда взялись цифры отчёта — суммы тех страниц за этот же месяц" icon={<Scale className="h-4 w-4 text-sky-500" />}>
                <Reconciliation current={current} pointName={pointName} extraNames={extraNames} includeExtra={includeExtra} />
              </Section>

              {!pointId && report.companies.length > 1 ? (
                <Section title="По точкам" subtitle="Нажмите на точку, чтобы открыть её отчёт" icon={<Store className="h-4 w-4 text-violet-500" />}>
                  <PointsTable report={report} onSelect={setPointId} />
                </Section>
              ) : null}
            </>
          ) : (
            <Card className="p-6 text-sm text-muted-foreground">
              {pointId ? `У точки ${pointName} за ${monthLabel(month).toLowerCase()} нет ни доходов, ни расходов.` : `За ${monthLabel(month).toLowerCase()} данных нет.`}
            </Card>
          )}

          <ReportsSection month={month} pointId={pointId} companies={companies} includeExtra={includeExtra} canExport={can('profitability.export_pdf')} posLabel={cashLabels.pos} />
        </div>
      ) : null}
    </div>
  )
}

// ─── Отчёт ──────────────────────────────────────────────────────────────────

function PnlTable({ current, previous, labels }: { current: PnlMonth; previous: PnlMonth | null; labels: ReturnType<typeof useCashlessLabels> }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const revenueParts = (p: PnlMonth | null): CategoryAmount[] =>
    p
      ? [
          { name: 'Наличные', amount: p.income.cash },
          { name: labels.pos, amount: p.income.kaspi },
          { name: 'Карта', amount: p.income.card },
          { name: 'Онлайн', amount: p.income.online },
        ]
      : []
  const partsOf = (key: PnlLineKey | 'revenue', p: PnlMonth | null) => (key === 'revenue' ? revenueParts(p) : p?.categories[key as PnlLineKey] || [])

  /** Статьи обоих месяцев одним списком, по сумме этого месяца */
  const mergedParts = (key: PnlLineKey | 'revenue') => {
    const cur = new Map(partsOf(key, current).map((c) => [c.name, c.amount]))
    const prev = new Map(partsOf(key, previous).map((c) => [c.name, c.amount]))
    const names = Array.from(new Set([...cur.keys(), ...prev.keys()]))
    return names
      .map((name) => ({ name, cur: cur.get(name) || 0, prev: prev.get(name) || 0 }))
      .filter((r) => Math.round(r.cur) !== 0 || Math.round(r.prev) !== 0)
      .sort((a, b) => b.cur - a.cur || b.prev - a.prev)
  }

  const revenue = current.revenue
  const share = (v: number) => (revenue > 0 ? `${((v / revenue) * 100).toFixed(1)}%` : '—')

  const cells = (value: number, prevValue: number | null, expense: boolean, strong: boolean) => {
    const shown = expense ? -value : value
    const delta = prevValue == null ? null : value - prevValue
    return (
      <>
        <td className={`${tdr} ${strong ? 'font-semibold' : ''} ${expense && Math.round(value) ? 'text-muted-foreground' : ''}`}>{money(shown)}</td>
        <td className={`${tdr} text-xs text-muted-foreground`}>{share(value)}</td>
        {previous ? (
          <>
            <td className={`${tdr} text-muted-foreground`}>{money(expense ? -(prevValue || 0) : prevValue || 0)}</td>
            <td className={`${tdr} ${delta != null ? changeTone(delta, expense) : ''}`}>{delta != null ? signed(delta) : '—'}</td>
          </>
        ) : null}
      </>
    )
  }

  const lineRows = (key: PnlLineKey | 'revenue', label: string, value: number, prevValue: number | null, expense: boolean) => {
    const parts = mergedParts(key)
    const expandable = parts.length > 0
    const isOpen = open.has(key)
    return (
      <Fragment key={key}>
        <tr className={`border-b border-border ${expandable ? 'cursor-pointer hover:bg-surface-muted' : ''}`} onClick={expandable ? () => toggle(key) : undefined}>
          <td className={`${td} ${expense ? '' : 'font-semibold'}`}>
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''} ${expandable ? '' : 'invisible'}`} />
              {label}
            </span>
          </td>
          {cells(value, prevValue, expense, !expense)}
        </tr>
        {isOpen
          ? parts.map((part) => (
              <tr key={`${key}:${part.name}`} className="border-b border-border bg-surface-muted/40">
                <td className="py-1.5 pl-10 pr-3 text-xs text-muted-foreground">{part.name}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap">{money(part.cur)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{share(part.cur)}</td>
                {previous ? (
                  <>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">{money(part.prev)}</td>
                    <td className={`px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap ${changeTone(part.cur - part.prev, expense)}`}>{signed(part.cur - part.prev)}</td>
                  </>
                ) : null}
              </tr>
            ))
          : null}
      </Fragment>
    )
  }

  const offRows = OFF_CHAIN.filter((row) => Math.round(row.get(current)) !== 0 || (previous && Math.round(row.get(previous)) !== 0))
  const leftover = (p: PnlMonth) => p.netProfit - p.capex - p.profitDistribution

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px]">
        <thead className="bg-surface-muted">
          <tr>
            <th className={th}>Статья</th>
            <th className={thr}>{monthLabel(current.month)}</th>
            <th className={thr}>% выручки</th>
            {previous ? (
              <>
                <th className={thr}>{monthLabel(previous.month)}</th>
                <th className={thr}>Изменение</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {visibleChain(labels.pos, current, previous).map((row) =>
            row.kind === 'line' ? (
              lineRows(row.key, row.label, row.get(current), previous ? row.get(previous) : null, row.expense)
            ) : (
              <tr key={row.label} className={`border-b border-border ${row.final ? 'bg-emerald-500/[0.07]' : 'bg-surface-muted/60'}`}>
                <td className={`${td} ${row.final ? 'font-bold' : 'font-semibold'} pl-8`}>{row.label}</td>
                <td className={`${tdr} ${row.final ? `font-bold ${tone(row.get(current))}` : 'font-semibold'}`}>{money(row.get(current))}</td>
                <td className={`${tdr} text-xs text-muted-foreground`}>{share(row.get(current))}</td>
                {previous ? (
                  <>
                    <td className={`${tdr} text-muted-foreground`}>{money(row.get(previous))}</td>
                    <td className={`${tdr} font-semibold ${changeTone(row.get(current) - row.get(previous), false)}`}>{signed(row.get(current) - row.get(previous))}</td>
                  </>
                ) : null}
              </tr>
            ),
          )}
          {offRows.length ? (
            <>
              <tr className="border-b border-border bg-amber-500/[0.05]">
                <td colSpan={previous ? 5 : 3} className="px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  После чистой прибыли — в ОПиУ не входят
                </td>
              </tr>
              {offRows.map((row) => lineRows(row.key, row.label, row.get(current), previous ? row.get(previous) : null, true))}
              <tr>
                <td className={`${td} pl-8 font-semibold`}>Остаётся после покупок и выплат</td>
                <td className={`${tdr} font-semibold ${tone(leftover(current))}`}>{money(leftover(current))}</td>
                <td className={`${tdr} text-xs text-muted-foreground`}>{share(leftover(current))}</td>
                {previous ? (
                  <>
                    <td className={`${tdr} text-muted-foreground`}>{money(leftover(previous))}</td>
                    <td className={`${tdr} ${changeTone(leftover(current) - leftover(previous), false)}`}>{signed(leftover(current) - leftover(previous))}</td>
                  </>
                ) : null}
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

// ─── Сверка ─────────────────────────────────────────────────────────────────

function Reconciliation({ current, pointName, extraNames, includeExtra }: { current: PnlMonth; pointName: string | null; extraNames: string[]; includeExtra: boolean }) {
  const pnlExpenses = current.revenue - current.netProfit
  const filter = pointName
    ? `фильтр точки — ${pointName}`
    : extraNames.length
      ? `все точки, ${extraNames.join(', ')} ${includeExtra ? 'включён' : 'не включён'} в итоги`
      : 'все точки'

  const row = (label: ReactNode, value: string, className = '') => (
    <div className={`flex items-baseline justify-between gap-3 px-3 py-2 text-sm ${className}`}>
      <span>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="divide-y divide-border rounded-xl border border-border">
        {row(
          <>
            Итого на странице{' '}
            <Link href="/income" className="font-medium text-sky-600 hover:underline dark:text-sky-400">
              «Доходы»
            </Link>
          </>,
          money(current.revenue),
        )}
        {row(<span className="font-semibold">= Выручка в отчёте</span>, money(current.revenue), 'font-semibold')}
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {row(
          <>
            Итого на странице{' '}
            <Link href="/expenses" className="font-medium text-sky-600 hover:underline dark:text-sky-400">
              «Расходы»
            </Link>{' '}
            (все статусы)
          </>,
          money(current.check.expensesAll),
        )}
        {current.check.declined ? row(<span className="text-muted-foreground">− отклонённые ({current.check.declinedCount} шт.) — не расход</span>, `−${money(current.check.declined)}`) : null}
        {current.capex ? row(<span className="text-muted-foreground">− покупка оборудования — после прибыли</span>, `−${money(current.capex)}`) : null}
        {current.profitDistribution ? row(<span className="text-muted-foreground">− выплаты партнёрам — после прибыли</span>, `−${money(current.profitDistribution)}`) : null}
        {row(<span className="font-semibold">= Расходы в отчёте (с налогом)</span>, money(pnlExpenses), 'font-semibold')}
      </div>
      <p className="text-xs text-muted-foreground lg:col-span-2">
        На тех страницах выберите период с 1-го по последнее число месяца и тот же фильтр: {filter}. Выручка {money(current.revenue)} − расходы {money(pnlExpenses)} = чистая прибыль{' '}
        <span className={`font-medium ${tone(current.netProfit)}`}>{money(current.netProfit)}</span>.
      </p>
    </div>
  )
}

// ─── По точкам ──────────────────────────────────────────────────────────────

function PointsTable({ report, onSelect }: { report: ProfitabilityReport; onSelect: (id: string) => void }) {
  const hasPrev = Boolean(report.previous)
  const expenses = (p: PnlMonth) => p.revenue - p.netProfit
  const row = (key: string, name: ReactNode, cur: PnlMonth | null, prev: PnlMonth | null, opts: { muted?: boolean; total?: boolean; onClick?: () => void }) => {
    const c = cur
    const net = c?.netProfit || 0
    return (
      <tr key={key} className={`${opts.total ? 'bg-surface-muted/60 font-semibold' : 'border-b border-border'} ${opts.onClick ? 'cursor-pointer hover:bg-surface-muted' : ''} ${opts.muted ? 'text-muted-foreground' : ''}`} onClick={opts.onClick}>
        <td className={`${td} font-medium`}>{name}</td>
        <td className={tdr}>{money(c?.revenue || 0)}</td>
        <td className={`${tdr} text-muted-foreground`}>{money(c ? expenses(c) : 0)}</td>
        <td className={`${tdr} font-semibold ${tone(net)}`}>{money(net)}</td>
        <td className={`${tdr} ${tone(c?.netMargin || 0)}`}>{c && c.revenue > 0 ? `${c.netMargin.toFixed(1)}%` : '—'}</td>
        {hasPrev ? (
          <>
            <td className={`${tdr} text-muted-foreground`}>{money(prev?.netProfit || 0)}</td>
            <td className={`${tdr} ${changeTone(net - (prev?.netProfit || 0), false)}`}>{signed(net - (prev?.netProfit || 0))}</td>
          </>
        ) : null}
      </tr>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px]">
        <thead className="bg-surface-muted">
          <tr>
            <th className={th}>Точка</th>
            <th className={thr}>Выручка</th>
            <th className={thr}>Расходы</th>
            <th className={thr}>Чистая прибыль</th>
            <th className={thr}>Маржа</th>
            {hasPrev ? (
              <>
                <th className={thr}>Прибыль, {monthLabel(report.previous!.month).toLowerCase()}</th>
                <th className={thr}>Изменение</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {report.companies.map((c: CompanyPnl) =>
            row(
              c.id,
              <span className="inline-flex items-center gap-1.5">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                {c.name}
                {c.isExtra ? <span className="text-xs font-normal text-muted-foreground">({c.inTotals ? 'в итогах' : 'не в итогах'})</span> : null}
              </span>,
              c.months[0] || null,
              c.previous,
              { muted: !c.inTotals, onClick: () => onSelect(c.id) },
            ),
          )}
          {row('total', 'Итого', report.months[0] || null, report.previous, { total: true })}
        </tbody>
      </table>
    </div>
  )
}

// ─── PDF-отчёты ─────────────────────────────────────────────────────────────

function ReportsSection({
  month,
  pointId,
  companies,
  includeExtra,
  canExport,
  posLabel,
}: {
  month: string
  pointId: string
  companies: Array<{ id: string; name: string }>
  includeExtra: boolean
  canExport: boolean
  posLabel: string
}) {
  const MONTH_OPTIONS = useMemo(() => monthOptions(), [])
  const [from, setFrom] = useState(month)
  const [to, setTo] = useState(month)
  const [branchCompany, setBranchCompany] = useState(pointId)
  const [includeCapex, setIncludeCapex] = useState(true)
  const [payrollStaff, setPayrollStaff] = useState('')
  const [payrollOps, setPayrollOps] = useState('')
  const [note, setNote] = useState('')
  const [partners, setPartners] = useState<Array<{ name: string; percent: string }>>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setFrom(month)
    setTo(month)
  }, [month])
  useEffect(() => {
    if (pointId) setBranchCompany(pointId)
  }, [pointId])
  useEffect(() => {
    try {
      const saved = localStorage.getItem('profitability-branch-note')
      if (saved) setNote(saved)
    } catch {}
  }, [])
  useEffect(() => {
    try {
      if (note) localStorage.setItem('profitability-branch-note', note)
      else localStorage.removeItem('profitability-branch-note')
    } catch {}
  }, [note])

  if (!canExport) return null

  const period = from === to ? monthLabel(from) : `${monthLabel(from)} — ${monthLabel(to)}`
  const badPeriod = from > to

  const branchParams = () => {
    const params = new URLSearchParams({ company_id: branchCompany, from, to, capex: includeCapex ? '1' : '0' })
    if (includeExtra) params.set('include_extra', '1')
    const clean = partners.map((p) => ({ name: p.name.trim(), percent: Number(p.percent) || 0 })).filter((p) => p.name && p.percent > 0)
    if (clean.length) params.set('partners', encodeURIComponent(JSON.stringify(clean)))
    const staff = Math.round(toNumber(payrollStaff))
    const ops = Math.round(toNumber(payrollOps))
    if (staff) params.set('payroll_staff', String(staff))
    if (ops) params.set('payroll_ops', String(ops))
    if (note.trim()) params.set('note', note.trim().slice(0, 2000))
    return params
  }

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key)
    try {
      await job()
    } catch (e: any) {
      toast({ title: 'Не удалось сформировать PDF', description: e?.message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const downloadBranch = () =>
    run('branch', async () => {
      const res = await fetch(`/api/admin/profitability/pdf?${branchParams()}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const match = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/i)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = match?.[1] ? decodeURIComponent(match[1]) : `profitability-${from}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    })

  const loadPeriod = async (): Promise<ProfitabilityReport> => {
    const params = new URLSearchParams({ from, to })
    if (includeExtra) params.set('include_extra', '1')
    const res = await fetch(`/api/admin/profitability/summary?${params}`, { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось посчитать ОПиУ')
    return body.data
  }

  const pdfRows = (p: PnlMonth) =>
    visibleChain(posLabel, p, null).map((row) => ({
      label: row.label,
      value: row.kind === 'line' && row.expense ? -row.get(p) : row.get(p),
      meta: p.revenue > 0 ? `${((row.get(p) / p.revenue) * 100).toFixed(1)}%` : ' ',
      strong: row.kind === 'total' || (row.kind === 'line' && !row.expense),
    }))

  const pnlColumns = [
    { key: 'label', label: 'Статья' },
    { key: 'value', label: 'Сумма', align: 'right' as const },
    { key: 'meta', label: '% выручки', align: 'right' as const },
  ]
  const generated = () => new Date().toLocaleString('ru-RU')

  const exportAllPoints = () =>
    run('all', async () => {
      const report = await loadPeriod()
      const t = report.total
      const exp = (p: PnlMonth) => p.revenue - p.netProfit
      await downloadReportPdf(
        'table',
        {
          meta: { title: 'ОПиУ по точкам', period, generated: generated() },
          sections: [
            {
              title: 'Сводно по точкам',
              columns: [
                { key: 'name', label: 'Точка' },
                { key: 'revenue', label: 'Выручка', align: 'right' },
                { key: 'expenses', label: 'Расходы', align: 'right' },
                { key: 'tax', label: 'в т.ч. налог', align: 'right' },
                { key: 'net', label: 'Чистая прибыль', align: 'right' },
                { key: 'margin', label: 'Маржа %', align: 'right' },
              ],
              rows: report.companies.map((c) => ({ name: c.name, revenue: c.total.revenue, expenses: exp(c.total), tax: c.total.incomeTax, net: c.total.netProfit, margin: Math.round(c.total.netMargin) })),
              total: { name: 'ИТОГО', revenue: t.revenue, expenses: exp(t), tax: t.incomeTax, net: t.netProfit, margin: Math.round(t.netMargin) },
            },
            { title: 'ОПиУ — все точки', dense: true, columns: pnlColumns, rows: pdfRows(t) },
            ...report.companies.map((c) => ({ title: `${c.name} — ОПиУ`, dense: true, columns: pnlColumns, rows: pdfRows(c.total) })),
          ],
        },
        `OPiU_tochki_${from}_${to}`,
      )
    })

  const exportInvestor = () =>
    run('investor', async () => {
      const report = await loadPeriod()
      const c = report.companies.find((x) => x.id === branchCompany)
      if (!c) throw new Error('У точки нет данных за этот период')
      await downloadReportPdf(
        'table',
        {
          meta: { title: `Отчёт инвестора — ${c.name}`, period, generated: generated() },
          sections: [
            { title: 'ОПиУ за период', columns: pnlColumns, rows: pdfRows(c.total) },
            {
              title: 'По месяцам',
              columns: [
                { key: 'month', label: 'Месяц' },
                { key: 'revenue', label: 'Выручка', align: 'right' },
                { key: 'ebitda', label: 'EBITDA', align: 'right' },
                { key: 'net', label: 'Чистая прибыль', align: 'right' },
                { key: 'margin', label: 'Маржа %', align: 'right' },
              ],
              rows: c.months.map((m) => ({ month: monthLabel(m.month), revenue: m.revenue, ebitda: m.ebitda, net: m.netProfit, margin: Math.round(m.netMargin) })),
            },
          ],
        },
        `Investor_${c.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}_${from}_${to}`,
      )
    })

  const spinner = (key: string) => (busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />)

  return (
    <Section title="PDF-отчёты" subtitle="Те же цифры, что на экране. Период можно взять шире одного месяца." icon={<Download className="h-4 w-4 text-amber-500" />}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">С месяца</Label>
            <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)}>
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">По месяц</Label>
            <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Точка (для отчёта по точке и инвестору)</Label>
            <NativeSelect value={branchCompany} onChange={(e) => setBranchCompany(e.target.value)}>
              <option value="">— выберите —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {badPeriod ? <p className="text-sm text-amber-700 dark:text-amber-300">Начало периода позже конца — поменяйте месяцы.</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportAllPoints()} disabled={badPeriod || busy !== null}>
            {spinner('all')} ОПиУ всех точек
          </Button>
          <Button variant="outline" onClick={() => void exportInvestor()} disabled={badPeriod || !branchCompany || busy !== null}>
            {spinner('investor')} Отчёт для инвестора
          </Button>
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Управленческий отчёт по точке</p>
            <p className="text-xs text-muted-foreground">Оборот, налог, расходы по статьям, чистая прибыль и доли партнёров.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeCapex} onCheckedChange={(v) => setIncludeCapex(v === true)} /> Показать покупку оборудования
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">ФОТ адм. сотрудников вручную, ₸ (пусто — из журнала)</Label>
              <Input value={payrollStaff} onChange={(e) => setPayrollStaff(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ФОТ операторов вручную, ₸</Label>
              <Input value={payrollOps} onChange={(e) => setPayrollOps(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Пояснение к отчёту (попадёт в PDF)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="Например: в апреле ремонт зоны PS5 на 350 000 ₸ — в покупке оборудования." />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Распределение чистой прибыли по партнёрам</Label>
              <Button variant="ghost" size="xs" onClick={() => setPartners((p) => [...p, { name: '', percent: '10' }])}>
                <Plus className="h-3.5 w-3.5" /> Партнёр
              </Button>
            </div>
            {partners.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input placeholder="Имя" value={p.name} onChange={(e) => setPartners((list) => list.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)))} />
                <Input className="w-24" inputMode="decimal" value={p.percent} onChange={(e) => setPartners((list) => list.map((row, i) => (i === idx ? { ...row, percent: e.target.value } : row)))} />
                <span className="text-sm text-muted-foreground">%</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setPartners((list) => list.filter((_, i) => i !== idx))} aria-label="Убрать партнёра">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {partners.length ? <p className="text-xs text-muted-foreground">Сумма долей: {partners.reduce((s, p) => s + (Number(p.percent) || 0), 0).toFixed(1)}%</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!branchCompany || badPeriod || busy !== null} onClick={() => void downloadBranch()}>
              {spinner('branch')} Скачать PDF
            </Button>
            <Button variant="outline" disabled={!branchCompany || badPeriod} onClick={() => window.open(`/profitability/print?${branchParams()}`, '_blank')}>
              Открыть в браузере
            </Button>
          </div>
        </div>
      </div>
    </Section>
  )
}
