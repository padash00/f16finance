'use client'

/**
 * ОПиУ и прибыльность.
 *
 *  Обзор        — прибыль месяца, почему она изменилась, куда уходят деньги;
 *  Динамика     — месяцы периода графиком и таблицей + идущий месяц с прогнозом;
 *  Точки        — ОПиУ каждой точки за период;
 *  Ввод данных  — ручные корректировки месяца с превью «было → станет»;
 *  Отчёты       — PDF по точке, по всем точкам, для инвестора.
 *
 * Считает сервер одним расчётом для экрана, приложения и PDF
 * (lib/domain/profitability-report): налог — ставкой с выручки, отклонённые
 * расходы не считаются, F16 Extra по галочке, ночной безнал — на следующий день.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Calculator,
  ChevronDown,
  Download,
  Info,
  Landmark,
  Loader2,
  Plus,
  Save,
  Scale,
  Target,
  TrendingUp,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { PageSkeleton } from '@/components/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { useCompanies } from '@/hooks/use-companies'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { computeMonthlyPnlFromParts, type MonthlyPnl, type ProfitabilityInputs } from '@/lib/domain/profitability'
import { profitBridge, type CompanyPnl, type PnlMonth, type ProfitabilityReport } from '@/lib/domain/profitability-report'

type TabKey = 'overview' | 'dynamics' | 'points' | 'inputs' | 'reports'
type Outlook = {
  month: string
  taxRate: number
  knownDays?: number
  daysInMonth?: number
  fact?: { income: number; expense: number; profit: number }
  outlook: null | Record<'pessimistic' | 'realistic' | 'optimistic', { income: number; expense: number; profit: number }>
}
type Draft = Record<string, string>

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
const monthShort = (month: string) => `${(MONTHS[Number(month.slice(5, 7)) - 1] || '').slice(0, 3)} ${month.slice(2, 4)}`
const monthOptions = () => Array.from({ length: 36 }, (_, i) => shiftMonth(currentMonth(), -i))

const money = (v: number) => `${Math.round(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU')} ₸`
const signed = (v: number) => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('ru-RU')} ₸`
const compact = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(Math.round(v))
}
const tone = (v: number) => (Math.round(v) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')
const pctChange = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null)

const CHART_TOOLTIP = { background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }
const th = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const thr = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground'
const td = 'px-3 py-2 text-sm tabular-nums'
const tdr = 'px-3 py-2 text-right text-sm tabular-nums'

const INPUT_FIELDS = [
  'cash_revenue_override',
  'pos_revenue_override',
  'kaspi_qr_turnover',
  'kaspi_qr_rate',
  'kaspi_gold_turnover',
  'kaspi_gold_rate',
  'qr_gold_turnover',
  'qr_gold_rate',
  'other_cards_turnover',
  'other_cards_rate',
  'kaspi_red_turnover',
  'kaspi_red_rate',
  'kaspi_kredit_turnover',
  'kaspi_kredit_rate',
  'payroll_amount',
  'payroll_taxes_amount',
  'income_tax_amount',
  'depreciation_amount',
  'amortization_amount',
  'other_operating_amount',
] as const
const draftFrom = (row?: Record<string, any> | null): Draft => ({
  ...Object.fromEntries(INPUT_FIELDS.map((f) => [f, row?.[f] ? String(row[f]) : ''])),
  notes: row?.notes || '',
})
const toNumber = (value: string) => {
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.') || 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}
const draftToInputs = (draft: Draft): ProfitabilityInputs => Object.fromEntries(INPUT_FIELDS.map((f) => [f, toNumber(draft[f] || '')])) as ProfitabilityInputs

const TAX_RATE_KEY = 'profitability_tax_rate'
const initialTaxRate = () => {
  try {
    const own = Number(localStorage.getItem(TAX_RATE_KEY))
    if (own >= 2 && own <= 6) return own
    const settings = JSON.parse(localStorage.getItem('tax_business_settings') || '{}')
    const rate = Number(settings?.ipnRate)
    if (rate >= 2 && rate <= 6) return rate
  } catch {}
  return 2
}

// ─── ОПиУ таблицей ──────────────────────────────────────────────────────────

function pnlRows(p: MonthlyPnl, posLabel: string) {
  return [
    { label: 'Выручка', value: p.revenue, kind: 'big' as const },
    ...(p.cogs ? [{ label: 'Себестоимость', value: -p.cogs, kind: 'neg' as const }, { label: 'Валовая прибыль', value: p.grossProfit, kind: 'sub' as const }] : []),
    { label: 'Операционные расходы', value: -p.operatingExpenses, kind: 'neg' as const },
    { label: `Комиссия ${posLabel} / эквайринг`, value: -p.posCommission, kind: 'neg' as const },
    { label: 'Фонд оплаты труда', value: -p.payroll, kind: 'neg' as const },
    { label: 'Налоги на зарплату', value: -p.payrollTaxes, kind: 'neg' as const },
    { label: 'Прочие операционные', value: -p.otherOperating, kind: 'neg' as const },
    { label: 'EBITDA', value: p.ebitda, kind: 'sub' as const },
    { label: 'Износ и амортизация', value: -(p.depreciation + p.amortization), kind: 'neg' as const },
    { label: 'Операционная прибыль', value: p.operatingProfit, kind: 'sub' as const },
    { label: 'Проценты по кредитам', value: -p.financialExpenses, kind: 'neg' as const },
    { label: `Налог${p.incomeTaxSource === 'manual' ? ' (ручной ввод)' : ''}`, value: -p.incomeTax, kind: 'neg' as const },
    { label: 'Разовые', value: -p.nonOperating, kind: 'neg' as const },
    { label: 'Чистая прибыль', value: p.netProfit, kind: 'final' as const },
  ]
}

function PnlTable({ pnl, posLabel }: { pnl: MonthlyPnl; posLabel: string }) {
  const fcf = pnl.netProfit - pnl.capex - pnl.profitDistribution
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <tbody>
          {pnlRows(pnl, posLabel).map((row) => (
            <tr
              key={row.label}
              className={`border-b border-border last:border-b-0 ${row.kind === 'sub' ? 'bg-surface-muted/60' : ''} ${row.kind === 'final' ? 'bg-emerald-500/[0.06]' : ''}`}
            >
              <td className={`px-4 py-2 ${row.kind === 'neg' ? 'text-muted-foreground' : 'font-medium'}`}>{row.label}</td>
              <td className={`px-4 py-2 text-right tabular-nums ${row.kind === 'final' ? `font-bold ${tone(row.value)}` : row.kind === 'sub' ? 'font-semibold' : row.value < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                {money(row.value)}
                {pnl.revenue > 0 && row.kind !== 'neg' ? <span className="ml-2 text-xs font-normal text-muted-foreground">{((row.value / pnl.revenue) * 100).toFixed(1)}%</span> : null}
              </td>
            </tr>
          ))}
          {pnl.capex || pnl.profitDistribution || pnl.incomeTaxPaid ? (
            <>
              <tr className="bg-amber-500/[0.05]">
                <td colSpan={2} className="px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  Справочно — вне ОПиУ
                </td>
              </tr>
              {pnl.incomeTaxPaid ? (
                <tr className="border-b border-border">
                  <td className="px-4 py-2 text-muted-foreground">Налог уплачен по журналу расходов</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(pnl.incomeTaxPaid)}</td>
                </tr>
              ) : null}
              {pnl.capex ? (
                <tr className="border-b border-border">
                  <td className="px-4 py-2 text-muted-foreground">Покупка оборудования</td>
                  <td className="px-4 py-2 text-right tabular-nums">−{money(pnl.capex)}</td>
                </tr>
              ) : null}
              {pnl.profitDistribution ? (
                <tr className="border-b border-border">
                  <td className="px-4 py-2 text-muted-foreground">Выплаты партнёрам</td>
                  <td className="px-4 py-2 text-right tabular-nums">−{money(pnl.profitDistribution)}</td>
                </tr>
              ) : null}
              <tr>
                <td className="px-4 py-2 font-medium">Остаётся после покупок и выплат</td>
                <td className={`px-4 py-2 text-right font-semibold tabular-nums ${tone(fcf)}`}>{money(fcf)}</td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, subtitle, icon, action, children }: { title: string; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="gap-0 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {icon}
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
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

  const lastClosed = shiftMonth(currentMonth(), -1)
  const [monthFrom, setMonthFrom] = useState(shiftMonth(lastClosed, -3))
  const [monthTo, setMonthTo] = useState(lastClosed)
  const [includeExtra, setIncludeExtra] = useState(false)
  const [taxRate, setTaxRate] = useState(2)
  const [selectedMonth, setSelectedMonth] = useState(lastClosed)
  const [tab, setTab] = useState<TabKey>('overview')
  const [report, setReport] = useState<ProfitabilityReport | null>(null)
  const [inputs, setInputs] = useState<Record<string, Record<string, any>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [outlook, setOutlook] = useState<Outlook | null>(null)

  useEffect(() => setTaxRate(initialTaxRate()), [])

  const load = useCallback(async () => {
    if (monthFrom > monthTo) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: monthFrom, to: monthTo, tax_rate: String(taxRate), with_previous: '1' })
      if (includeExtra) params.set('include_extra', '1')
      const [summaryRes, inputsRes] = await Promise.all([
        fetch(`/api/admin/profitability/summary?${params}`, { cache: 'no-store' }),
        fetch(`/api/admin/profitability?from=${monthFrom}&to=${monthTo}`, { cache: 'no-store' }),
      ])
      const summary = await summaryRes.json().catch(() => null)
      if (!summaryRes.ok || !summary?.ok) throw new Error(summary?.error || 'Не удалось посчитать ОПиУ')
      const inputsBody = await inputsRes.json().catch(() => null)
      setReport(summary.data)
      setInputs(Object.fromEntries(((inputsBody?.items || []) as any[]).map((row) => [String(row.month).slice(0, 7), row])))
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [monthFrom, monthTo, taxRate, includeExtra])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!report?.months.length) return
    if (!report.months.some((m) => m.month === selectedMonth)) setSelectedMonth(report.months[report.months.length - 1].month)
  }, [report, selectedMonth])

  useEffect(() => {
    if (tab !== 'dynamics' || outlook) return
    const params = new URLSearchParams({ tax_rate: String(taxRate) })
    if (includeExtra) params.set('include_extra', '1')
    fetch(`/api/admin/profitability/outlook?${params}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.ok && setOutlook(j.data))
      .catch(() => {})
  }, [tab, outlook, taxRate, includeExtra])

  useEffect(() => setOutlook(null), [taxRate, includeExtra])

  const changeTaxRate = (rate: number) => {
    setTaxRate(rate)
    try {
      localStorage.setItem(TAX_RATE_KEY, String(rate))
    } catch {}
  }

  const selected = report?.months.find((m) => m.month === selectedMonth) || null
  const previousOfSelected = useMemo(() => {
    if (!report || !selected) return null
    const idx = report.months.findIndex((m) => m.month === selected.month)
    return idx > 0 ? report.months[idx - 1] : report.previous
  }, [report, selected])
  const hasExtra = Boolean(report?.extra.names.length)

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="ОПиУ и прибыльность"
        description="Сколько бизнес заработал, почему прибыль изменилась и какая точка сколько приносит"
        icon={<Landmark className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-9 w-auto" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} aria-label="С месяца">
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  с {monthLabel(m).toLowerCase()}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="h-9 w-auto" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} aria-label="По месяц">
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  по {monthLabel(m).toLowerCase()}
                </option>
              ))}
            </NativeSelect>
            {(
              [
                ['4 мес', 3],
                ['6 мес', 5],
                ['12 мес', 11],
              ] as const
            ).map(([label, back]) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                onClick={() => {
                  setMonthFrom(shiftMonth(lastClosed, -back))
                  setMonthTo(lastClosed)
                }}
              >
                {label}
              </Button>
            ))}
            <NativeSelect className="h-9 w-auto" value={taxRate} onChange={(e) => changeTaxRate(Number(e.target.value))} aria-label="Ставка налога">
              {[2, 3, 4, 5, 6].map((r) => (
                <option key={r} value={r}>
                  Налог {r}%
                </option>
              ))}
            </NativeSelect>
            {hasExtra ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={includeExtra} onCheckedChange={(v) => setIncludeExtra(v === true)} /> с {report!.extra.names.join(', ')}
              </label>
            ) : null}
          </div>
        }
      />

      {monthFrom > monthTo ? <Card className="p-4 text-sm text-amber-700 dark:text-amber-300">Начало периода позже конца — поменяйте месяцы.</Card> : null}
      {error ? (
        <Card className="flex-row items-center gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      ) : null}

      {loading && !report ? (
        <PageSkeleton stats={4} rows={8} cols={4} />
      ) : report && selected ? (
        <div className={loading ? 'space-y-5 opacity-60' : 'space-y-5'}>
          {report.months.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {report.months.map((m) => {
                const active = m.month === selectedMonth
                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => setSelectedMonth(m.month)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${
                      active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="font-medium">{monthLabel(m.month)}</span>
                    {m.revenue > 0 ? <span className={`text-xs ${tone(m.netProfit)}`}>{m.netMargin.toFixed(0)}%</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="gap-4">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="h-10">
                <TabsTrigger value="overview" className="px-3">Обзор</TabsTrigger>
                <TabsTrigger value="dynamics" className="px-3">Динамика</TabsTrigger>
                <TabsTrigger value="points" className="px-3">Точки</TabsTrigger>
                <TabsTrigger value="inputs" className="px-3">Ввод данных</TabsTrigger>
                <TabsTrigger value="reports" className="px-3">Отчёты</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview">
              <OverviewTab report={report} selected={selected} previous={previousOfSelected} inputs={inputs[selected.month]} posLabel={cashLabels.pos} labels={cashLabels} />
            </TabsContent>
            <TabsContent value="dynamics">
              <DynamicsTab report={report} outlook={outlook} onSelect={(m) => { setSelectedMonth(m); setTab('overview') }} />
            </TabsContent>
            <TabsContent value="points">
              <PointsTab report={report} posLabel={cashLabels.pos} />
            </TabsContent>
            <TabsContent value="inputs">
              <InputsTab
                report={report}
                selected={selected}
                row={inputs[selected.month]}
                canEdit={can('profitability.edit')}
                labels={cashLabels}
                onSaved={(item) => {
                  setInputs((prev) => ({ ...prev, [String(item.month).slice(0, 7)]: item }))
                  void load()
                }}
              />
            </TabsContent>
            <TabsContent value="reports">
              <ReportsTab report={report} companies={companies} monthFrom={monthFrom} monthTo={monthTo} taxRate={taxRate} includeExtra={includeExtra} canExport={can('profitability.export_pdf')} posLabel={cashLabels.pos} />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            Налог — {report.taxRate}% с выручки (ручной ввод налога важнее). Как в отчётах: отклонённые расходы не считаются, безнал ночной смены после полуночи — на следующий день
            {report.extra.names.length && !report.extra.included ? `, ${report.extra.names.join(', ')} не в итогах` : ''}.
          </p>
        </div>
      ) : report ? (
        <Card className="p-6 text-sm text-muted-foreground">За выбранный период данных нет.</Card>
      ) : null}
    </div>
  )
}

// ─── Обзор ──────────────────────────────────────────────────────────────────

function OverviewTab({
  report,
  selected,
  previous,
  inputs,
  posLabel,
  labels,
}: {
  report: ProfitabilityReport
  selected: PnlMonth
  previous: PnlMonth | null
  inputs: Record<string, any> | undefined
  posLabel: string
  labels: ReturnType<typeof useCashlessLabels>
}) {
  const bridge = previous ? profitBridge(selected, previous) : []
  const maxEffect = Math.max(1, ...bridge.map((l) => Math.abs(l.effect)))
  const categories = (report.categoriesByMonth[selected.month] || []).slice(0, 6)
  const maxCategory = categories[0]?.amount || 1
  const incomplete = report.incompleteMonths.filter((m) => m.month === selected.month)
  const imprecise = report.impreciseNightByMonth[selected.month] || 0

  const cards = [
    { label: 'Выручка', value: selected.revenue, prev: previous?.revenue, icon: TrendingUp, sub: selected.manual.revenue ? 'ручной ввод' : `нал ${compact(selected.cashRevenue)} · безнал ${compact(selected.cashlessRevenue)}` },
    { label: 'EBITDA', value: selected.ebitda, prev: previous?.ebitda, icon: Calculator, sub: `маржа ${selected.ebitdaMargin.toFixed(1)}%` },
    { label: 'Операционная прибыль', value: selected.operatingProfit, prev: previous?.operatingProfit, icon: Wallet },
    { label: 'Чистая прибыль', value: selected.netProfit, prev: previous?.netProfit, icon: Target, sub: `маржа ${selected.netMargin.toFixed(1)}%` },
  ]

  const posTypes: Array<[string, string, string]> = [
    [labels.qr, 'kaspi_qr_turnover', 'kaspi_qr_rate'],
    [labels.gold, 'kaspi_gold_turnover', 'kaspi_gold_rate'],
    ['Другие карты', 'other_cards_turnover', 'other_cards_rate'],
    [labels.red, 'kaspi_red_turnover', 'kaspi_red_rate'],
    [labels.kredit, 'kaspi_kredit_turnover', 'kaspi_kredit_rate'],
    ['Старый общий QR/Gold', 'qr_gold_turnover', 'qr_gold_rate'],
  ]
  const posLines = posTypes.filter(([, t, r]) => Number(inputs?.[t]) > 0 && Number(inputs?.[r]) > 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, prev, icon: Icon, sub }) => {
          const d = prev != null ? pctChange(value, prev) : null
          return (
            <Card key={label} className="gap-1 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className={`text-xl font-semibold tabular-nums ${value < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{money(value)}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{sub || ' '}</span>
                {d != null ? (
                  <span className={`inline-flex items-center gap-0.5 font-medium ${d >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {d >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {Math.abs(d).toFixed(1)}%
                  </span>
                ) : null}
              </div>
            </Card>
          )
        })}
      </div>

      {incomplete.length || imprecise || selected.manual.revenue ? (
        <div className="space-y-2">
          {incomplete.length ? (
            <Card className="flex-row items-start gap-2 border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Месяц внесён не полностью: {incomplete.map((m) => `${m.company} — ${m.days} дн. из обычных ${m.expectedDays}`).join(', ')}. Прибыль занижена, пока отчёты не внесут.
            </Card>
          ) : null}
          {selected.manual.revenue ? (
            <Card className="flex-row items-start gap-2 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
              Выручка месяца взята из ручного ввода, а не из отчётов смен. Очистите поля выручки во вкладке «Ввод данных», чтобы вернуть журнал.
            </Card>
          ) : null}
          {imprecise ? (
            <Card className="flex-row items-start gap-2 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              {imprecise} ночных смен без разбивки безнала до и после полуночи — весь их безнал отнесён на следующий день.
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Section
            title="Почему изменилась прибыль"
            subtitle={previous ? `${monthLabel(selected.month)} против ${monthLabel(previous.month).toLowerCase()}: ${signed(selected.netProfit - previous.netProfit)}` : 'Нет прошлого месяца для сравнения.'}
            icon={<Scale className="h-4 w-4 text-violet-500" />}
          >
            {previous ? (
              <div className="space-y-2.5">
                {bridge.map((line) => (
                  <div key={line.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">
                        {line.label}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {money(line.previous)} → {money(line.current)}
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${tone(line.effect)}`}>{signed(line.effect)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div className={`h-1.5 rounded-full ${line.effect >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(2, (Math.abs(line.effect) / maxEffect) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Выберите период, в котором есть предыдущий месяц.</p>
            )}
          </Section>
        </div>
        <div className="xl:col-span-2">
          <Section title="Топ расходов месяца" icon={<BarChart2 className="h-4 w-4 text-rose-500" />}>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">Расходов нет.</p>
            ) : (
              <div className="space-y-2.5">
                {categories.map((c) => (
                  <div key={c.name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 font-medium tabular-nums">{money(c.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div className="h-1.5 rounded-full bg-rose-500/80" style={{ width: `${(c.amount / maxCategory) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="ОПиУ месяца" subtitle="От выручки до чистой прибыли; справа — доля выручки" icon={<Landmark className="h-4 w-4 text-emerald-500" />}>
          <PnlTable pnl={selected} posLabel={posLabel} />
        </Section>
        <Section title="Безнал и комиссии банка" icon={<Wallet className="h-4 w-4 text-cyan-500" />}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Наличные</p>
              <p className="mt-1 font-semibold tabular-nums">{money(selected.cashRevenue)}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Безналичный</p>
              <p className="mt-1 font-semibold tabular-nums">{money(selected.cashlessRevenue)}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.05] p-3">
              <p className="text-xs text-muted-foreground">Комиссия банка за месяц</p>
              <p className="mt-1 font-semibold tabular-nums">{money(selected.posCommission)}</p>
              <p className="text-xs text-muted-foreground">
                {selected.manual.posCommission ? 'по оборотам и ставкам из «Ввода данных»' : selected.posCommission ? 'из журнала расходов (группа «Комиссия POS»)' : 'не заполнена ни в журнале, ни вручную'}
              </p>
            </div>
          </div>
          {posLines.length ? (
            <div className="mt-3 space-y-1.5">
              {posLines.map(([label, t, r]) => (
                <div key={t} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-lg bg-surface-muted px-3 py-1.5 text-sm">
                  <span>{label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {money(Number(inputs![t]))} × {Number(inputs![r]).toFixed(2)}%
                  </span>
                  <span className="font-medium tabular-nums">{money((Number(inputs![t]) * Number(inputs![r])) / 100)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  )
}

// ─── Динамика ───────────────────────────────────────────────────────────────

function DynamicsTab({ report, outlook, onSelect }: { report: ProfitabilityReport; outlook: Outlook | null; onSelect: (month: string) => void }) {
  const chartData = report.months.map((m) => ({ label: monthShort(m.month), 'Выручка': Math.round(m.revenue), EBITDA: Math.round(m.ebitda), 'Чистая прибыль': Math.round(m.netProfit) }))
  const o = outlook?.outlook
  const tax = (income: number) => (income * (outlook?.taxRate || report.taxRate)) / 100
  return (
    <div className="space-y-5">
      {o && outlook ? (
        <Section title={`${monthLabel(outlook.month)} — идёт`} subtitle={`Факт по ${outlook.knownDays} число из ${outlook.daysInMonth} и прогноз к концу месяца из «Прогноз и точность».`} icon={<TrendingUp className="h-4 w-4 text-violet-500" />}>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Выручка к концу месяца</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">~ {money(o.realistic.income)}</p>
              <p className="text-xs text-muted-foreground">
                от {money(o.pessimistic.income)} до {money(o.optimistic.income)} · факт {money(outlook.fact?.income || 0)}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Прибыль до налога и разовых</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${tone(o.realistic.profit)}`}>~ {money(o.realistic.profit)}</p>
              <p className="text-xs text-muted-foreground">
                от {money(o.pessimistic.profit)} до {money(o.optimistic.profit)}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">После налога {outlook.taxRate}%</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${tone(o.realistic.profit - tax(o.realistic.income))}`}>~ {money(o.realistic.profit - tax(o.realistic.income))}</p>
              <p className="text-xs text-muted-foreground">без покупки оборудования и выплат партнёрам</p>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="По месяцам" subtitle="Выручка столбиками, EBITDA и чистая прибыль линиями">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Выручка" fill="#3b82f6" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="EBITDA" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Чистая прибыль" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Таблица" subtitle="Нажмите на месяц, чтобы открыть его разбор">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[940px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className={th}>Месяц</th>
                <th className={thr}>Выручка</th>
                <th className={thr}>Себестоимость</th>
                <th className={thr}>Операционные</th>
                <th className={thr}>ФОТ + налоги</th>
                <th className={thr}>Комиссия</th>
                <th className={thr}>EBITDA</th>
                <th className={thr}>Налог</th>
                <th className={thr}>Чистая</th>
                <th className={thr}>Маржа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.months.map((m) => (
                <tr key={m.month} className="cursor-pointer hover:bg-surface-muted" onClick={() => onSelect(m.month)}>
                  <td className={`${td} font-medium`}>
                    {monthLabel(m.month)}
                    {report.incompleteMonths.some((i) => i.month === m.month) ? <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-500" /> : null}
                  </td>
                  <td className={tdr}>{money(m.revenue)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(m.cogs)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(m.operatingExpenses)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(m.payroll + m.payrollTaxes)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(m.posCommission)}</td>
                  <td className={`${tdr} ${tone(m.ebitda)}`}>{money(m.ebitda)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(m.incomeTax)}</td>
                  <td className={`${tdr} font-semibold ${tone(m.netProfit)}`}>{money(m.netProfit)}</td>
                  <td className={`${tdr} ${tone(m.netMargin)}`}>{m.netMargin.toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <td className={td}>Итого</td>
                <td className={tdr}>{money(report.total.revenue)}</td>
                <td className={tdr}>{money(report.total.cogs)}</td>
                <td className={tdr}>{money(report.total.operatingExpenses)}</td>
                <td className={tdr}>{money(report.total.payroll + report.total.payrollTaxes)}</td>
                <td className={tdr}>{money(report.total.posCommission)}</td>
                <td className={`${tdr} ${tone(report.total.ebitda)}`}>{money(report.total.ebitda)}</td>
                <td className={tdr}>{money(report.total.incomeTax)}</td>
                <td className={`${tdr} ${tone(report.total.netProfit)}`}>{money(report.total.netProfit)}</td>
                <td className={`${tdr} ${tone(report.total.netMargin)}`}>{report.total.netMargin.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// ─── Точки ──────────────────────────────────────────────────────────────────

function PointsTab({ report, posLabel }: { report: ProfitabilityReport; posLabel: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const anyManual = report.months.some((m) => m.manual.payroll || m.manual.payrollTaxes || m.manual.posCommission || m.manual.depreciation || m.amortization || m.otherOperating)
  return (
    <div className="space-y-5">
      <Section
        title="Точки за период"
        subtitle={anyManual ? 'Ручные вводы месяца (ФОТ, комиссии, износ, прочие) разнесены по точкам пропорционально выручке — сумма точек сходится с итогом.' : 'ОПиУ каждой точки за выбранный период.'}
      >
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[980px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className={th}>Точка</th>
                <th className={thr}>Выручка</th>
                <th className={thr}>Доля</th>
                <th className={thr}>Себест.</th>
                <th className={thr}>Операц.</th>
                <th className={thr}>ФОТ + налоги</th>
                <th className={thr}>EBITDA</th>
                <th className={thr}>Налог</th>
                <th className={thr}>Чистая</th>
                <th className={thr}>Маржа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.companies.map((c) => (
                <tr key={c.id} className={`cursor-pointer hover:bg-surface-muted ${c.inTotals ? '' : 'text-muted-foreground'}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <td className={`${td} font-medium`}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === c.id ? 'rotate-180' : ''}`} />
                      {c.name}
                      {c.isExtra ? <span className="text-xs font-normal">({c.inTotals ? 'в итогах' : 'не в итогах'})</span> : null}
                    </span>
                  </td>
                  <td className={tdr}>{money(c.total.revenue)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{c.inTotals ? `${(c.share * 100).toFixed(1)}%` : '—'}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(c.total.cogs)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(c.total.operatingExpenses)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(c.total.payroll + c.total.payrollTaxes)}</td>
                  <td className={`${tdr} ${tone(c.total.ebitda)}`}>{money(c.total.ebitda)}</td>
                  <td className={`${tdr} text-muted-foreground`}>{money(c.total.incomeTax)}</td>
                  <td className={`${tdr} font-semibold ${tone(c.total.netProfit)}`}>{money(c.total.netProfit)}</td>
                  <td className={`${tdr} ${tone(c.total.netMargin)}`}>{c.total.netMargin.toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <td className={td}>Итого</td>
                <td className={tdr}>{money(report.total.revenue)}</td>
                <td className={tdr}>100%</td>
                <td className={tdr}>{money(report.total.cogs)}</td>
                <td className={tdr}>{money(report.total.operatingExpenses)}</td>
                <td className={tdr}>{money(report.total.payroll + report.total.payrollTaxes)}</td>
                <td className={`${tdr} ${tone(report.total.ebitda)}`}>{money(report.total.ebitda)}</td>
                <td className={tdr}>{money(report.total.incomeTax)}</td>
                <td className={`${tdr} ${tone(report.total.netProfit)}`}>{money(report.total.netProfit)}</td>
                <td className={`${tdr} ${tone(report.total.netMargin)}`}>{report.total.netMargin.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {open ? (
        (() => {
          const c = report.companies.find((x) => x.id === open)
          if (!c) return null
          return <CompanyDetail company={c} posLabel={posLabel} />
        })()
      ) : null}
    </div>
  )
}

function CompanyDetail({ company, posLabel }: { company: CompanyPnl; posLabel: string }) {
  const last = company.months[company.months.length - 1]
  const prev = company.months.length > 1 ? company.months[company.months.length - 2] : null
  const bridge = last && prev ? profitBridge(last, prev) : []
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title={`${company.name} — ОПиУ за период`}>
        <PnlTable pnl={company.total} posLabel={posLabel} />
      </Section>
      <Section title="Что изменилось в последнем месяце" subtitle={last && prev ? `${monthLabel(last.month)} против ${monthLabel(prev.month).toLowerCase()}: ${signed(last.netProfit - prev.netProfit)}` : 'В периоде один месяц.'}>
        {bridge.length ? (
          <div className="space-y-2">
            {bridge.map((l) => (
              <div key={l.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">
                  {l.label}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {money(l.previous)} → {money(l.current)}
                  </span>
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${tone(l.effect)}`}>{signed(l.effect)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Нужно хотя бы два месяца в периоде.</p>
        )}
      </Section>
    </div>
  )
}

// ─── Ввод данных ────────────────────────────────────────────────────────────

function InputsTab({
  report,
  selected,
  row,
  canEdit,
  labels,
  onSaved,
}: {
  report: ProfitabilityReport
  selected: PnlMonth
  row: Record<string, any> | undefined
  canEdit: boolean
  labels: ReturnType<typeof useCashlessLabels>
  onSaved: (item: Record<string, any>) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(row))
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(draftFrom(row)), [row, selected.month])

  const after = computeMonthlyPnlFromParts(selected.month, selected.parts.income, selected.parts.journal, draftToInputs(draft), { taxRate: report.taxRate })
  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/profitability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selected.month, payload: { ...draftToInputs(draft), notes: draft.notes } }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.item) throw new Error(body?.error || 'Не удалось сохранить')
      toast({ title: `Сохранено: ${monthLabel(selected.month).toLowerCase()}` })
      onSaved(body.item)
    } catch (e: any) {
      toast({ title: 'Не удалось сохранить', description: e?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const field = (key: string, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={draft[key] || ''} onChange={(e) => set(key, e.target.value)} inputMode="decimal" placeholder={hint || '0'} disabled={!canEdit} />
    </div>
  )

  const rows: Array<[string, (p: MonthlyPnl) => number]> = [
    ['Выручка', (p) => p.revenue],
    ['Комиссия банка', (p) => p.posCommission],
    ['ФОТ + налоги', (p) => p.payroll + p.payrollTaxes],
    ['EBITDA', (p) => p.ebitda],
    ['Налог', (p) => p.incomeTax],
    ['Чистая прибыль', (p) => p.netProfit],
  ]

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <div className="space-y-5 xl:col-span-3">
        <Section
          title={`Ручные корректировки: ${monthLabel(selected.month).toLowerCase()}`}
          subtitle="Заполняйте, только если журнал неполный или нужны точные цифры банка. Пустое поле — берётся из журнала. Выбрать другой месяц — плашками над вкладками."
          icon={<Calculator className="h-4 w-4 text-amber-500" />}
        >
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">Выручка</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('cash_revenue_override', 'Наличная выручка за месяц', 'из отчётов смен')}
                {field('pos_revenue_override', 'Безналичная выручка за месяц', 'из отчётов смен')}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Обороты и ставки банка</p>
              <div className="space-y-2">
                {(
                  [
                    ['kaspi_qr_turnover', 'kaspi_qr_rate', labels.qr],
                    ['kaspi_gold_turnover', 'kaspi_gold_rate', labels.gold],
                    ['other_cards_turnover', 'other_cards_rate', 'Другие карты'],
                    ['kaspi_red_turnover', 'kaspi_red_rate', labels.red],
                    ['kaspi_kredit_turnover', 'kaspi_kredit_rate', labels.kredit],
                  ] as const
                ).map(([t, r, label]) => (
                  <div key={t} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_150px_90px]">
                    <span className="text-sm">{label}</span>
                    <Input value={draft[t] || ''} onChange={(e) => set(t, e.target.value)} inputMode="decimal" placeholder="Оборот, ₸" disabled={!canEdit} />
                    <Input value={draft[r] || ''} onChange={(e) => set(r, e.target.value)} inputMode="decimal" placeholder="%" disabled={!canEdit} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Зарплаты и налоги</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {field('payroll_amount', 'ФОТ за месяц')}
                {field('payroll_taxes_amount', 'Налоги на зарплату')}
                {field('income_tax_amount', `Налог (вместо ${report.taxRate}% с выручки)`)}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Прочее</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {field('depreciation_amount', 'Износ')}
                {field('amortization_amount', 'Амортизация')}
                {field('other_operating_amount', 'Прочие операционные')}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Комментарий к месяцу</Label>
              <Textarea value={draft.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="например: разовая выплата партнёру, новый договор с банком" disabled={!canEdit} />
            </div>
          </div>
        </Section>
      </div>
      <div className="xl:col-span-2">
        <Section title="Что изменится" subtitle="Тем же расчётом, что и отчёт">
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={th}>Строка</th>
                  <th className={thr}>Сейчас</th>
                  <th className={thr}>После</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(([label, get]) => {
                  const before = get(selected)
                  const next = get(after)
                  const changed = Math.round(before) !== Math.round(next)
                  return (
                    <tr key={label}>
                      <td className={td}>{label}</td>
                      <td className={`${tdr} text-muted-foreground`}>{money(before)}</td>
                      <td className={`${tdr} ${changed ? 'font-semibold' : ''}`}>{money(next)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <Button className="mt-4 w-full" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Сохранить {monthLabel(selected.month).toLowerCase()}
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Нет права менять ручные корректировки.</p>
          )}
        </Section>
      </div>
    </div>
  )
}

// ─── Отчёты ─────────────────────────────────────────────────────────────────

function ReportsTab({
  report,
  companies,
  monthFrom,
  monthTo,
  taxRate,
  includeExtra,
  canExport,
  posLabel,
}: {
  report: ProfitabilityReport
  companies: Array<{ id: string; name: string }>
  monthFrom: string
  monthTo: string
  taxRate: number
  includeExtra: boolean
  canExport: boolean
  posLabel: string
}) {
  const [branchCompany, setBranchCompany] = useState('')
  const [branchFrom, setBranchFrom] = useState(monthTo)
  const [branchTo, setBranchTo] = useState(monthTo)
  const [includeCapex, setIncludeCapex] = useState(true)
  const [payrollStaff, setPayrollStaff] = useState('')
  const [payrollOps, setPayrollOps] = useState('')
  const [note, setNote] = useState('')
  const [partners, setPartners] = useState<Array<{ name: string; percent: string }>>([])
  const [downloading, setDownloading] = useState(false)
  const [investorCompany, setInvestorCompany] = useState('')
  const [exporting, setExporting] = useState(false)
  const MONTH_OPTIONS = useMemo(() => monthOptions(), [])

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

  const branchParams = () => {
    const params = new URLSearchParams({ company_id: branchCompany, from: branchFrom, to: branchTo, capex: includeCapex ? '1' : '0', tax_rate: String(taxRate) })
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

  const downloadBranch = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/profitability/pdf?${branchParams()}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const match = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/i)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = match?.[1] ? decodeURIComponent(match[1]) : `profitability-${branchFrom}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      toast({ title: 'Не удалось сформировать PDF', description: e?.message, variant: 'destructive' })
    } finally {
      setDownloading(false)
    }
  }

  const pnlPdfRows = (p: MonthlyPnl) =>
    pnlRows(p, posLabel).map((row) => ({
      label: row.label,
      value: row.value,
      meta: p.revenue > 0 ? `${((Math.abs(row.value) / p.revenue) * 100).toFixed(1)}%` : ' ',
      strong: row.kind === 'sub' || row.kind === 'final' || row.kind === 'big',
    }))

  const exportAllPoints = async () => {
    setExporting(true)
    try {
      const t = report.total
      await downloadReportPdf(
        'table',
        {
          meta: { title: 'ОПиУ по точкам', period: `${monthLabel(monthFrom)} — ${monthLabel(monthTo)}`, generated: new Date().toLocaleString('ru-RU') },
          sections: [
            {
              title: 'Сводно по точкам',
              columns: [
                { key: 'name', label: 'Точка' },
                { key: 'revenue', label: 'Выручка', align: 'right' },
                { key: 'cogs', label: 'Себест.', align: 'right' },
                { key: 'operating', label: 'Операц.', align: 'right' },
                { key: 'payroll', label: 'ФОТ+налоги', align: 'right' },
                { key: 'ebitda', label: 'EBITDA', align: 'right' },
                { key: 'tax', label: 'Налог', align: 'right' },
                { key: 'net', label: 'Чистая', align: 'right' },
                { key: 'margin', label: 'Маржа %', align: 'right' },
                { key: 'share', label: 'Доля %', align: 'right' },
              ],
              rows: report.companies.map((c) => ({
                name: c.name,
                revenue: c.total.revenue,
                cogs: c.total.cogs,
                operating: c.total.operatingExpenses,
                payroll: c.total.payroll + c.total.payrollTaxes,
                ebitda: c.total.ebitda,
                tax: c.total.incomeTax,
                net: c.total.netProfit,
                margin: Math.round(c.total.netMargin),
                share: Math.round(c.share * 100),
              })),
              total: { name: 'ИТОГО', revenue: t.revenue, cogs: t.cogs, operating: t.operatingExpenses, payroll: t.payroll + t.payrollTaxes, ebitda: t.ebitda, tax: t.incomeTax, net: t.netProfit, margin: Math.round(t.netMargin), share: 100 },
            },
            ...report.companies.map((c) => ({
              title: `${c.name} — ОПиУ`,
              dense: true,
              columns: [
                { key: 'label', label: 'Показатель' },
                { key: 'value', label: 'Сумма', align: 'right' as const },
                { key: 'meta', label: 'Доля выручки', align: 'right' as const },
              ],
              rows: pnlPdfRows(c.total),
            })),
          ],
        },
        `OPiU_tochki_${monthFrom}_${monthTo}`,
      )
    } catch (e: any) {
      toast({ title: 'Не удалось выгрузить', description: e?.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const exportInvestor = async () => {
    const c = report.companies.find((x) => x.id === investorCompany)
    if (!c) return
    setExporting(true)
    try {
      await downloadReportPdf(
        'table',
        {
          meta: { title: `Отчёт инвестора — ${c.name}`, period: `${monthLabel(monthFrom)} — ${monthLabel(monthTo)}`, generated: new Date().toLocaleString('ru-RU') },
          sections: [
            {
              title: 'ОПиУ за период',
              columns: [
                { key: 'label', label: 'Показатель' },
                { key: 'value', label: 'Сумма', align: 'right' },
                { key: 'meta', label: 'Доля выручки', align: 'right' },
              ],
              rows: pnlPdfRows(c.total),
            },
            {
              title: 'По месяцам',
              columns: [
                { key: 'month', label: 'Месяц' },
                { key: 'revenue', label: 'Выручка', align: 'right' },
                { key: 'ebitda', label: 'EBITDA', align: 'right' },
                { key: 'net', label: 'Чистая', align: 'right' },
                { key: 'margin', label: 'Маржа %', align: 'right' },
              ],
              rows: c.months.map((m) => ({ month: monthLabel(m.month), revenue: m.revenue, ebitda: m.ebitda, net: m.netProfit, margin: Math.round(m.netMargin) })),
            },
          ],
        },
        `Investor_${c.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}_${monthFrom}_${monthTo}`,
      )
    } catch (e: any) {
      toast({ title: 'Не удалось выгрузить', description: e?.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  if (!canExport) return <Card className="p-5 text-sm text-muted-foreground">Нет права на выгрузку отчётов ОПиУ.</Card>

  return (
    <div className="space-y-5">
      <Section
        title="Управленческий отчёт по точке"
        subtitle={`Оборот, налог ${taxRate}%, расходы по статьям, чистая прибыль и распределение по партнёрам — теми же цифрами, что на экране.`}
        icon={<Download className="h-4 w-4 text-amber-500" />}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Точка</Label>
              <NativeSelect value={branchCompany} onChange={(e) => setBranchCompany(e.target.value)}>
                <option value="">— выберите —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">С месяца</Label>
              <NativeSelect value={branchFrom} onChange={(e) => setBranchFrom(e.target.value)}>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">По месяц</Label>
              <NativeSelect value={branchTo} onChange={(e) => setBranchTo(e.target.value)}>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeCapex} onCheckedChange={(v) => setIncludeCapex(v === true)} /> Показать покупку оборудования
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">ФОТ адм. сотрудников вручную, ₸ (пусто — как в расчёте)</Label>
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
            <Button disabled={!branchCompany || branchFrom > branchTo || downloading} onClick={() => void downloadBranch()}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Скачать PDF
            </Button>
            <Button variant="outline" disabled={!branchCompany || branchFrom > branchTo} onClick={() => window.open(`/profitability/print?${branchParams()}`, '_blank')}>
              Открыть в браузере
            </Button>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="ОПиУ всех точек (PDF)" subtitle="Сводная таблица и полная ОПиУ каждой точки за выбранный период.">
          <Button variant="outline" onClick={() => void exportAllPoints()} disabled={exporting || !report.companies.length}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Выгрузить
          </Button>
        </Section>
        <Section title="Отчёт для инвестора (PDF)" subtitle="ОПиУ одной точки за период и по месяцам.">
          <div className="flex flex-wrap gap-2">
            <NativeSelect className="w-auto" value={investorCompany} onChange={(e) => setInvestorCompany(e.target.value)}>
              <option value="">— точка —</option>
              {report.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={() => void exportInvestor()} disabled={!investorCompany || exporting}>
              <Download className="h-4 w-4" /> Выгрузить
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
