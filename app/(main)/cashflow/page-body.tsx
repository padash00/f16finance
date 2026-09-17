'use client'

/**
 * Движение денег — вкладками.
 *
 *  Обзор        — пришло, ушло, чистый поток, остаток на руках, куда ушли деньги;
 *  Нал и безнал — два отдельных потока и остаток по каждому;
 *  Платежи      — регулярные платежи и деньги до конца месяца;
 *  Точки        — поток по каждой точке;
 *  Расходы      — статьи по назначению, крупные платежи.
 *
 * Считает сервер (lib/domain/cashflow-report): как в /reports — безнал ночной
 * смены на следующий день, отклонённые расходы не считаются, F16 Extra по
 * галочке. Остаток — от отметки, которую вводит владелец; у организации по
 * всем точкам, включая Extra.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Coins,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/use-toast'
import { useCompanies } from '@/hooks/use-companies'
import { readApiCache, writeApiCache } from '@/lib/client/use-api-cache'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import type { BalanceAnchor, CashflowReport, ChannelFlows, MonthProjection, UpcomingPayment } from '@/lib/domain/cashflow-report'
import { SortableTh } from '@/components/ui/sortable-th'
import { useTableSort } from '@/lib/client/use-table-sort'
import type { SortColumns, SortState } from '@/lib/core/table-sort'

type Report = CashflowReport & { balanceAvailable: boolean }
type Outlook = { today: string; payments: UpcomingPayment[]; projection: MonthProjection | null; balanceToday: { cash: number; cashless: number; total: number } | null; anchor: BalanceAnchor | null }
type TabKey = 'overview' | 'channels' | 'payments' | 'points' | 'expenses'
type Preset = 'month' | 'prevMonth' | 'd7' | 'd30' | 'custom'

// ─── Даты и форматирование ──────────────────────────────────────────────────

const toISODateLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const addDaysISO = (iso: string, diff: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return toISODateLocal(dt)
}
function presetRange(preset: Exclude<Preset, 'custom'>, today: string) {
  const [y, m] = today.split('-').map(Number)
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (preset === 'prevMonth') {
    const start = new Date(y, m - 2, 1)
    const end = new Date(y, m - 1, 0)
    return { from: toISODateLocal(start), to: toISODateLocal(end) }
  }
  return { from: addDaysISO(today, preset === 'd7' ? -6 : -29), to: today }
}
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')} ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`
}
const shortDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

const money = (v: number) => `${Math.round(v || 0).toLocaleString('ru-RU')} ₸`
const signed = (v: number) => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('ru-RU')} ₸`
const compact = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(Math.round(v))
}
const tone = (v: number) => (Math.round(v) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')
const pct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null)

const CHART_TOOLTIP = { background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }
const td = 'px-3 py-2 text-sm tabular-nums'
const tdr = 'px-3 py-2 text-right text-sm tabular-nums'
// Заголовки сортировки: общий класс без text-left/right — выравнивание задаёт align
const ths = 'px-3 py-2 text-xs font-medium text-muted-foreground'

// ─── Сортировка таблиц ──────────────────────────────────────────────────────

type DaySortKey = 'day' | 'cashIn' | 'cashOut' | 'cashlessIn' | 'cashlessOut' | 'cashEnd' | 'cashlessEnd'
type PaymentSortKey = 'date' | 'name' | 'company' | 'method' | 'amount'
type PointSortKey = 'name' | 'in' | 'out' | 'net' | 'delta' | 'cashNet' | 'cashlessNet'
type CategorySortKey = 'name' | 'activity' | 'amount' | 'cash' | 'cashless' | 'previous' | 'delta'
type LargeExpenseSortKey = 'date' | 'company' | 'category' | 'payee' | 'amount'

const DAY_SORT_INITIAL: SortState<DaySortKey> = { key: 'day', dir: 'asc' }
const PAYMENT_SORT_INITIAL: SortState<PaymentSortKey> = { key: 'date', dir: 'asc' }
const POINT_SORT_INITIAL: SortState<PointSortKey> = { key: 'net', dir: 'desc' }
const CATEGORY_SORT_INITIAL: SortState<CategorySortKey> = { key: 'amount', dir: 'desc' }
const LARGE_EXPENSE_SORT_INITIAL: SortState<LargeExpenseSortKey> = { key: 'amount', dir: 'desc' }

// ─── Мелкие компоненты ──────────────────────────────────────────────────────

function Delta({ cur, prev, goodWhenUp = true }: { cur: number; prev: number; goodWhenUp?: boolean }) {
  const p = pct(cur, prev)
  if (p == null) return <span className="text-xs text-muted-foreground">не с чем сравнить</span>
  if (Math.abs(p) < 0.05) return <span className="text-xs text-muted-foreground">без изменений</span>
  const up = p > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up === goodWhenUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(p).toFixed(1)}% к прошлому периоду
    </span>
  )
}

function Tile({ label, value, children, hint, valueClass = '' }: { label: string; value: string; children?: ReactNode; hint?: ReactNode; valueClass?: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </Card>
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

export default function CashFlowPage() {
  const { can } = useCapabilities()
  const { companies } = useCompanies()
  const today = useMemo(() => toISODateLocal(new Date()), [])

  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => presetRange('month', today))
  const [companyId, setCompanyId] = useState('')
  const [includeExtra, setIncludeExtra] = useState(false)
  const [tab, setTab] = useState<TabKey>('overview')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [outlook, setOutlook] = useState<Outlook | null>(null)
  const [outlookLoading, setOutlookLoading] = useState(false)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [aiText, setAiText] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to })
    if (companyId) p.set('company_id', companyId)
    if (includeExtra) p.set('include_extra', '1')
    return p.toString()
  }, [range, companyId, includeExtra])

  const load = useCallback(
    async (force = false) => {
      const url = `/api/admin/cashflow/summary?${query}`
      const cached = force ? null : readApiCache<Report>(url)
      if (cached) setReport(cached)
      setLoading(!cached)
      setError(null)
      setAiText(null)
      try {
        const res = await fetch(url, { cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось загрузить')
        if (!body.data?.flows) {
          setReport(null)
        } else {
          setReport(body.data)
          writeApiCache(url, body.data)
        }
      } catch (e: any) {
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    },
    [query],
  )

  const loadOutlook = useCallback(async () => {
    setOutlookLoading(true)
    try {
      const res = await fetch(`/api/admin/cashflow/outlook${companyId ? `?company_id=${companyId}` : ''}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось загрузить платежи')
      setOutlook(body.data)
    } catch (e: any) {
      toast({ title: 'Платежи не загрузились', description: e?.message, variant: 'destructive' })
    } finally {
      setOutlookLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setOutlook(null)
  }, [companyId])

  useEffect(() => {
    if (tab === 'payments' && !outlook && !outlookLoading) void loadOutlook()
  }, [tab, outlook, outlookLoading, loadOutlook])

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p, today))
  }

  const hasExtra = Boolean(report?.extra.names.length)

  const askAi = async () => {
    if (!report) return
    setAiLoading(true)
    try {
      const f = report.flows
      const snapshot = {
        page: 'cashflow',
        title: 'Движение денег',
        generatedAt: new Date().toISOString(),
        route: '/cashflow',
        period: { from: report.from, to: report.to },
        summary: [
          `Пришло ${money(f.total.in)}, ушло ${money(f.total.out)}, чистый поток ${signed(f.total.net)}`,
          `Наличные: пришло ${money(f.cash.in)}, ушло ${money(f.cash.out)}; безналичный: пришло ${money(f.cashless.in)}, ушло ${money(f.cashless.out)}`,
          report.balance ? `Остаток на конец периода ${money(report.balance.end.total)} (нал ${money(report.balance.end.cash)}, безнал ${money(report.balance.end.cashless)}), минимум ${money(report.balance.lowest.total)} ${report.balance.lowest.date}` : 'Остаток денег не указан',
          `Прошлый период: пришло ${money(report.previous.total.in)}, ушло ${money(report.previous.total.out)}`,
        ],
        sections: [
          { title: 'Куда ушли деньги', bullets: report.activities.map((a) => `${a.label}: ${money(a.amount)} (было ${money(a.previous)})`) },
          { title: 'Крупные статьи', bullets: report.categories.slice(0, 8).map((c) => `${c.name}: ${money(c.amount)}`) },
          { title: 'Дни, когда наличных ушло больше', bullets: report.cashDeficitDays.slice(0, 6).map((d) => `${d.date}: ${signed(d.net)}`) },
        ],
      }
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 'cashflow',
          prompt: 'Разбери движение денег за период: 3 коротких вывода с цифрами — что хорошо, что тревожит (особенно наличные и крупные выплаты) и одно главное действие. Безналичные оплаты называй «Безналичный».',
          snapshot,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.text) throw new Error(body?.error || 'ИИ не ответил')
      setAiText(body.text)
    } catch (e: any) {
      toast({ title: 'Разбор не получился', description: e?.message, variant: 'destructive' })
    } finally {
      setAiLoading(false)
    }
  }

  const exportPdf = async () => {
    if (!report) return
    const f = report.flows
    const nf = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
    const meta = { title: 'Движение денег', period: `${report.from} — ${report.to}`, generated: new Date().toLocaleString('ru-RU'), brandNote: 'поступления, расходы и остаток' }
    const cols = [
      { key: 'date', label: 'Дата', w: '16%' },
      { key: 'income', label: 'Пришло', align: 'right' as const, w: '17%' },
      { key: 'expenses', label: 'Ушло', align: 'right' as const, w: '17%' },
      { key: 'profit', label: 'Поток за день', align: 'right' as const, signed: true, w: '17%' },
      { key: 'balance', label: report.balance ? 'Остаток' : 'Накоплено', align: 'right' as const, signed: true, w: '17%' },
      { key: 'cash', label: 'Нал за день', align: 'right' as const, signed: true, w: '16%' },
    ]
    const rows = report.days.map((d) => ({ date: d.date, income: d.income, expenses: d.expense, profit: d.net, balance: d.onHand ? d.onHand.total : d.balance, cash: d.cashIn - d.cashOut }))
    const maxActivity = Math.max(1, ...report.activities.map((a) => a.amount))
    await downloadReportPdf(
      'premium',
      {
        meta,
        kpis: [
          { label: 'Пришло', value: `${nf(f.total.in)} тг`, sub: `нал ${nf(f.cash.in)} · безнал ${nf(f.cashless.in)}` },
          { label: 'Ушло', value: `${nf(f.total.out)} тг`, sub: `нал ${nf(f.cash.out)} · безнал ${nf(f.cashless.out)}` },
          { label: 'Чистый поток', value: `${nf(f.total.net)} тг`, tone: f.total.net < 0 ? 'bad' : undefined },
          report.balance
            ? { label: 'Остаток на конец', value: `${nf(report.balance.end.total)} тг`, sub: `нал ${nf(report.balance.end.cash)} · безнал ${nf(report.balance.end.cashless)}`, tone: report.balance.end.total < 0 ? 'bad' : undefined }
            : { label: 'Накоплено за период', value: `${nf(report.totals.endingBalance)} тг`, sub: 'остаток не указан' },
        ],
        sections: [
          {
            type: 'bars',
            title: 'Куда ушли деньги',
            hint: 'по назначению',
            items: report.activities.map((a) => ({ label: a.label, amount: a.amount, ratio: a.amount / maxActivity, color: '#f97316' })),
          },
        ],
        detail: { title: 'По дням', subtitle: 'поступления, расходы, поток и остаток', columns: cols, rows, total: { date: null, income: f.total.in, expenses: f.total.out, profit: f.total.net, balance: report.balance ? report.balance.end.total : report.totals.endingBalance, cash: f.cash.net } },
      },
      `Dvizhenie_deneg_${report.from}_${report.to}`,
    )
  }

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Движение денег"
        description="Сколько пришло, сколько ушло и сколько денег на руках"
        icon={<Wallet className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setBalanceOpen(true)}>
              <Landmark className="h-4 w-4" /> Остаток
            </Button>
            <Button variant="outline" size="icon" onClick={() => void load(true)} disabled={loading} aria-label="Обновить">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {can('cashflow.export') ? (
              <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={!report}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            ) : null}
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-9 w-auto" value={preset} onChange={(e) => applyPreset(e.target.value as Preset)} aria-label="Период">
              <option value="month">Этот месяц</option>
              <option value="prevMonth">Прошлый месяц</option>
              <option value="d7">7 дней</option>
              <option value="d30">30 дней</option>
              <option value="custom">Свой период</option>
            </NativeSelect>
            {preset === 'custom' ? (
              <>
                <DatePicker value={range.from} max={range.to} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
                <span className="text-muted-foreground">—</span>
                <DatePicker value={range.to} min={range.from} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
              </>
            ) : null}
            <NativeSelect className="h-9 w-auto" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Точка">
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {hasExtra && !companyId ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={includeExtra} onCheckedChange={(v) => setIncludeExtra(v === true)} /> с {report!.extra.names.join(', ')}
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
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
          <p className="text-sm">Считаем поступления и расходы…</p>
        </div>
      ) : report ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className={`gap-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10">
              <TabsTrigger value="overview" className="px-3">Обзор</TabsTrigger>
              <TabsTrigger value="channels" className="px-3">Нал и безнал</TabsTrigger>
              <TabsTrigger value="payments" className="px-3">Платежи</TabsTrigger>
              <TabsTrigger value="points" className="px-3">Точки</TabsTrigger>
              <TabsTrigger value="expenses" className="px-3">Расходы</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview">
            <OverviewTab report={report} onSetBalance={() => setBalanceOpen(true)} canAi={can('cashflow.ai_analysis')} aiText={aiText} aiLoading={aiLoading} onAskAi={askAi} />
          </TabsContent>
          <TabsContent value="channels">
            <ChannelsTab report={report} />
          </TabsContent>
          <TabsContent value="payments">
            <PaymentsTab outlook={outlook} loading={outlookLoading} onReload={loadOutlook} onSetBalance={() => setBalanceOpen(true)} />
          </TabsContent>
          <TabsContent value="points">
            <PointsTab report={report} />
          </TabsContent>
          <TabsContent value="expenses">
            <ExpensesTab report={report} />
          </TabsContent>
        </Tabs>
      ) : null}

      <BalanceDialog
        open={balanceOpen}
        onOpenChange={setBalanceOpen}
        companies={companies}
        defaultCompanyId={companyId}
        today={today}
        onChanged={() => {
          void load(true)
          setOutlook(null)
        }}
      />
    </div>
  )
}

// ─── Обзор ──────────────────────────────────────────────────────────────────

function OverviewTab({
  report,
  onSetBalance,
  canAi,
  aiText,
  aiLoading,
  onAskAi,
}: {
  report: Report
  onSetBalance: () => void
  canAi: boolean
  aiText: string | null
  aiLoading: boolean
  onAskAi: () => void
}) {
  const f = report.flows
  const p = report.previous
  const maxActivity = Math.max(1, ...report.activities.map((a) => a.amount))
  const chartData = report.days.map((d) => ({
    label: shortDay(d.date),
    'Пришло': Math.round(d.income),
    'Ушло': Math.round(d.expense),
    [report.balance ? 'Остаток' : 'Накоплено']: Math.round(d.onHand ? d.onHand.total : d.balance),
  }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Пришло" value={money(f.total.in)}>
          <Delta cur={f.total.in} prev={p.total.in} />
        </Tile>
        <Tile label="Ушло" value={money(f.total.out)} hint={report.pending.count ? `ждут согласования: ${report.pending.count} на ${money(report.pending.total)}` : undefined}>
          <Delta cur={f.total.out} prev={p.total.out} goodWhenUp={false} />
        </Tile>
        <Tile label="Чистый поток" value={signed(f.total.net)} valueClass={tone(f.total.net)}>
          <span className="text-xs text-muted-foreground">было {signed(p.total.net)}</span>
        </Tile>
        {report.balance ? (
          <Tile
            label={`Остаток на ${shortDay(report.to)}`}
            value={money(report.balance.end.total)}
            valueClass={report.balance.end.total < 0 ? 'text-rose-600 dark:text-rose-400' : ''}
            hint={`нал ${money(report.balance.end.cash)} · безнал ${money(report.balance.end.cashless)}`}
          >
            <span className="text-xs text-muted-foreground">на начало {money(report.balance.start.total)}</span>
          </Tile>
        ) : (
          <Card className="gap-1 p-4">
            <p className="text-xs text-muted-foreground">Остаток на руках</p>
            <p className="text-sm">{report.balanceAvailable ? 'Не указан — сколько денег было на какую-то дату?' : 'Нужна миграция 20260915_cash_balance_anchors.sql'}</p>
            {report.balanceAvailable ? (
              <Button variant="outline" size="xs" className="mt-1 w-fit" onClick={onSetBalance}>
                <Plus className="h-3.5 w-3.5" /> Указать остаток
              </Button>
            ) : null}
          </Card>
        )}
      </div>

      {report.balance && report.balance.lowest.total < 0 ? (
        <Card className="flex-row items-start gap-2 border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          По расчёту денег не хватало {dayLabel(report.balance.lowest.date)}: остаток {money(report.balance.lowest.total)}. Проверьте, все ли поступления внесены, или обновите отметку остатка.
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Section title="По дням" subtitle={report.balance ? 'Поступления и расходы за день, линия — остаток на конец дня' : 'Поступления и расходы за день, линия — накоплено с начала периода (это не остаток)'}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Пришло" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Ушло" fill="#f43f5e" fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Line type="monotone" dataKey={report.balance ? 'Остаток' : 'Накоплено'} stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>
        <div className="xl:col-span-2">
          <Section title="Куда ушли деньги" subtitle="Расходы по назначению против прошлого периода такой же длины">
            {report.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Расходов нет.</p>
            ) : (
              <div className="space-y-3">
                {report.activities.map((a) => (
                  <div key={a.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{a.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(a.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div className={`h-1.5 rounded-full ${a.key === 'owners' ? 'bg-violet-500' : a.key === 'investing' ? 'bg-sky-500' : a.key === 'taxes' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${(a.amount / maxActivity) * 100}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      нал {money(a.cash)} · безнал {money(a.cashless)} · было {money(a.previous)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {canAi ? (
        <Section
          title="Разбор ИИ"
          subtitle="Три вывода по цифрам этого периода."
          icon={<Sparkles className="h-4 w-4 text-violet-500" />}
          action={
            <Button size="sm" onClick={onAskAi} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {aiText ? 'Заново' : 'Разобрать'}
            </Button>
          }
        >
          {aiText ? <p className="whitespace-pre-line text-sm leading-relaxed">{aiText}</p> : <p className="text-sm text-muted-foreground">Нажмите «Разобрать» — ИИ прочитает цифры выше.</p>}
        </Section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Как в отчётах: безналичный ночной смены после полуночи — на следующий день, отклонённые расходы не считаются
        {report.extra.names.length && !report.extra.included ? `, ${report.extra.names.join(', ')} не в итогах` : ''}.
        {report.balance ? ` Остаток — от отметки ${shortDay(report.balance.anchor.as_of_date)}${report.balance.scope === 'organization' ? ', по всем точкам организации' : ''}.` : ''}
      </p>
    </div>
  )
}

// ─── Нал и безнал ───────────────────────────────────────────────────────────

function ChannelCard({ title, icon, flow, previous, start, end }: { title: string; icon: ReactNode; flow: ChannelFlows['cash']; previous: ChannelFlows['cash']; start: number | null; end: number | null }) {
  return (
    <Section title={title} icon={icon}>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Пришло</p>
          <p className="font-semibold tabular-nums">{money(flow.in)}</p>
          <p className="text-xs text-muted-foreground">было {money(previous.in)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Ушло</p>
          <p className="font-semibold tabular-nums">{money(flow.out)}</p>
          <p className="text-xs text-muted-foreground">было {money(previous.out)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Поток</p>
          <p className={`font-semibold tabular-nums ${tone(flow.net)}`}>{signed(flow.net)}</p>
          <p className="text-xs text-muted-foreground">было {signed(previous.net)}</p>
        </div>
      </div>
      {start != null && end != null ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Остаток</span>
          <span className="tabular-nums">
            {money(start)} → <b className={end < 0 ? 'text-rose-600 dark:text-rose-400' : ''}>{money(end)}</b>
          </span>
        </div>
      ) : null}
    </Section>
  )
}

function ChannelsTab({ report }: { report: Report }) {
  const b = report.balance
  const daySortColumns = useMemo<SortColumns<Report['days'][number], DaySortKey>>(
    () => ({
      day: { get: (d) => d.date, defaultDir: 'desc' },
      cashIn: { get: (d) => d.cashIn || null, defaultDir: 'desc' },
      cashOut: { get: (d) => d.cashOut || null, defaultDir: 'desc' },
      cashlessIn: { get: (d) => d.cashlessIn || null, defaultDir: 'desc' },
      cashlessOut: { get: (d) => d.cashlessOut || null, defaultDir: 'desc' },
      cashEnd: { get: (d) => (d.onHand ? d.onHand.cash : d.cashIn - d.cashOut), defaultDir: 'desc' },
      cashlessEnd: { get: (d) => (d.onHand ? d.onHand.cashless : d.cashlessIn - d.cashlessOut), defaultDir: 'desc' },
    }),
    [],
  )
  const { sort: daySort, toggle: toggleDaySort, sortedRows: sortedDays } = useTableSort<Report['days'][number], DaySortKey>({
    storageKey: 'cashflow.daysSort',
    columns: daySortColumns,
    initial: DAY_SORT_INITIAL,
    rows: report.days,
  })
  const chartData = report.days.map((d) => ({
    label: shortDay(d.date),
    'Наличные': Math.round(d.onHand ? d.onHand.cash : 0),
    'Безналичный': Math.round(d.onHand ? d.onHand.cashless : 0),
    'Поток нал': Math.round(d.cashIn - d.cashOut),
    'Поток безнал': Math.round(d.cashlessIn - d.cashlessOut),
  }))
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <ChannelCard title="Наличные" icon={<Coins className="h-4 w-4 text-emerald-500" />} flow={report.flows.cash} previous={report.previous.cash} start={b ? b.start.cash : null} end={b ? b.end.cash : null} />
        <ChannelCard title="Безналичный" icon={<CreditCard className="h-4 w-4 text-blue-500" />} flow={report.flows.cashless} previous={report.previous.cashless} start={b ? b.start.cashless : null} end={b ? b.end.cashless : null} />
      </div>

      <Section title={b ? 'Остаток по дням' : 'Поток по дням'} subtitle={b ? 'Наличные и безналичный на конец каждого дня' : 'Поступления минус расходы за день по каждому каналу'}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {b ? (
                <>
                  <Line type="monotone" dataKey="Наличные" stroke="#10b981" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="Безналичный" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                </>
              ) : (
                <>
                  <Bar dataKey="Поток нал" fill="#10b981" maxBarSize={16} />
                  <Bar dataKey="Поток безнал" fill="#3b82f6" maxBarSize={16} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Дни, когда наличных ушло больше, чем пришло" subtitle="Такие дни держатся на деньгах из кассы — стоит проверить, откуда их взяли.">
        {report.cashDeficitDays.length === 0 ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Таких дней нет.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {report.cashDeficitDays.map((d) => (
              <span key={d.date} className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-2.5 py-1 text-xs">
                {dayLabel(d.date)} · <b className="tabular-nums">{signed(d.net)}</b>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="По дням">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px]">
            <thead className="bg-surface-muted">
              <tr>
                <SortableTh label="День" sortKey="day" sort={daySort} onSort={toggleDaySort} className={ths} />
                <SortableTh label="Нал пришло" sortKey="cashIn" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
                <SortableTh label="Нал ушло" sortKey="cashOut" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
                <SortableTh label="Безнал пришло" sortKey="cashlessIn" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
                <SortableTh label="Безнал ушло" sortKey="cashlessOut" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
                <SortableTh label={b ? 'Остаток нал' : 'Поток нал'} sortKey="cashEnd" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
                <SortableTh label={b ? 'Остаток безнал' : 'Поток безнал'} sortKey="cashlessEnd" sort={daySort} onSort={toggleDaySort} align="right" className={ths} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedDays.map((d) => (
                <tr key={d.date}>
                  <td className={td}>{dayLabel(d.date)}</td>
                  <td className={tdr}>{money(d.cashIn)}</td>
                  <td className={tdr}>{money(d.cashOut)}</td>
                  <td className={tdr}>{money(d.cashlessIn)}</td>
                  <td className={tdr}>{money(d.cashlessOut)}</td>
                  <td className={`${tdr} ${tone(d.onHand ? d.onHand.cash : d.cashIn - d.cashOut)}`}>{d.onHand ? money(d.onHand.cash) : signed(d.cashIn - d.cashOut)}</td>
                  <td className={`${tdr} ${tone(d.onHand ? d.onHand.cashless : d.cashlessIn - d.cashlessOut)}`}>{d.onHand ? money(d.onHand.cashless) : signed(d.cashlessIn - d.cashlessOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// ─── Платежи ────────────────────────────────────────────────────────────────

function PaymentsTab({ outlook, loading, onReload, onSetBalance }: { outlook: Outlook | null; loading: boolean; onReload: () => void; onSetBalance: () => void }) {
  // Хуки — до ранних выходов: React требует одинакового порядка на каждый рендер
  const paymentSortColumns = useMemo<SortColumns<UpcomingPayment, PaymentSortKey>>(
    () => ({
      date: { get: (p) => p.date, defaultDir: 'desc' },
      name: { get: (p) => p.name || null },
      company: { get: (p) => p.company || null },
      method: { get: (p) => (p.cashless ? 'Безналичный' : 'Наличные') },
      amount: { get: (p) => p.amount || null, defaultDir: 'desc' },
    }),
    [],
  )
  const paymentRows = useMemo(() => outlook?.payments || [], [outlook?.payments])
  const { sort: paymentSort, toggle: togglePaymentSort, sortedRows: sortedPayments } = useTableSort<UpcomingPayment, PaymentSortKey>({
    storageKey: 'cashflow.paymentsSort',
    columns: paymentSortColumns,
    initial: PAYMENT_SORT_INITIAL,
    rows: paymentRows,
  })

  if (loading && !outlook) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
        <p className="text-sm">Собираем платежи и прогноз…</p>
      </div>
    )
  }
  if (!outlook) return null
  const pr = outlook.projection
  const chartData = pr?.days.map((d) => ({ label: shortDay(d.date), 'Ожидаемая выручка': Math.round(d.income), 'Платежи': Math.round(d.payments + d.other), 'Остаток': d.balance == null ? null : Math.round(d.balance) })) || []
  const paymentsTotal = outlook.payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-5">
      {pr ? (
        <Section
          title={`Деньги до ${shortDay(pr.monthEnd)}`}
          subtitle={pr.source === 'model' ? 'Выручка и расходы — модель из «Прогноз и точность», регулярные платежи — в их дни.' : 'Истории для модели мало — выручка и расходы по среднему за 4 недели.'}
          icon={<CalendarClock className="h-4 w-4 text-violet-500" />}
          action={
            <Button variant="outline" size="sm" onClick={onReload} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Обновить
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Ожидаемая выручка</p>
              <p className="mt-1 font-semibold tabular-nums">{money(pr.incomeLeft)}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Регулярные платежи</p>
              <p className="mt-1 font-semibold tabular-nums">{money(pr.paymentsLeft)}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Остальные расходы</p>
              <p className="mt-1 font-semibold tabular-nums">{money(pr.otherSpendLeft)}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{pr.balanceEnd != null ? 'Остаток на конец месяца' : 'Поток до конца месяца'}</p>
              <p className={`mt-1 font-semibold tabular-nums ${tone(pr.balanceEnd ?? pr.netLeft)}`}>{pr.balanceEnd != null ? money(pr.balanceEnd) : signed(pr.netLeft)}</p>
            </div>
          </div>

          {pr.lowest && pr.lowest.balance < 0 ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Кассовый разрыв: к {dayLabel(pr.lowest.date)} денег может не хватить на {money(-pr.lowest.balance)}. Перенесите платёж или отложите деньги заранее.
            </div>
          ) : pr.lowest ? (
            <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">
              Разрыва не видно: самый низкий остаток — {money(pr.lowest.balance)} ({dayLabel(pr.lowest.date)}).
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-muted p-3 text-sm">
              Чтобы увидеть, хватит ли денег, укажите остаток на руках.
              <Button variant="outline" size="xs" onClick={onSetBalance}>
                <Plus className="h-3.5 w-3.5" /> Указать остаток
              </Button>
            </div>
          )}

          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => (v == null ? '—' : money(Number(v)))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Ожидаемая выручка" fill="#10b981" fillOpacity={0.7} maxBarSize={16} />
                <Bar dataKey="Платежи" fill="#f43f5e" fillOpacity={0.7} maxBarSize={16} />
                {pr.balanceStart != null ? <Line type="monotone" dataKey="Остаток" stroke="#3b82f6" strokeWidth={2.5} dot={false} /> : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {outlook.balanceToday ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Старт — остаток на конец вчера: {money(outlook.balanceToday.total)} (нал {money(outlook.balanceToday.cash)}, безнал {money(outlook.balanceToday.cashless)}).
            </p>
          ) : null}
        </Section>
      ) : (
        <Card className="p-5 text-sm text-muted-foreground">Для прогноза до конца месяца пока мало истории доходов.</Card>
      )}

      <Section title="Регулярные платежи на 31 день" subtitle={`Из шаблонов расходов с днём месяца. Всего ${money(paymentsTotal)}. Созданный в этом месяце платёж уже есть в расходах и здесь не повторяется.`}>
        {outlook.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Регулярных платежей нет — их можно завести в шаблонах расходов, указав день месяца.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px]">
              <thead className="bg-surface-muted">
                <tr>
                  <SortableTh label="Дата" sortKey="date" sort={paymentSort} onSort={togglePaymentSort} className={ths} />
                  <SortableTh label="Платёж" sortKey="name" sort={paymentSort} onSort={togglePaymentSort} className={ths} />
                  <SortableTh label="Точка" sortKey="company" sort={paymentSort} onSort={togglePaymentSort} className={ths} />
                  <SortableTh label="Как платим" sortKey="method" sort={paymentSort} onSort={togglePaymentSort} className={ths} />
                  <SortableTh label="Сумма" sortKey="amount" sort={paymentSort} onSort={togglePaymentSort} align="right" className={ths} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedPayments.map((p) => (
                  <tr key={`${p.templateId}-${p.date}`}>
                    <td className={td}>{dayLabel(p.date)}</td>
                    <td className={`${td} font-medium`}>
                      {p.name}
                      <span className="block text-xs font-normal text-muted-foreground">{p.category}</span>
                    </td>
                    <td className={td}>{p.company}</td>
                    <td className={td}>{p.cashless ? 'Безналичный' : 'Наличные'}</td>
                    <td className={tdr}>{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Точки ──────────────────────────────────────────────────────────────────

function PointsTab({ report }: { report: Report }) {
  const pointSortColumns = useMemo<SortColumns<Report['companies'][number], PointSortKey>>(
    () => ({
      name: { get: (c) => c.name || null },
      in: { get: (c) => c.flows.total.in || null, defaultDir: 'desc' },
      out: { get: (c) => c.flows.total.out || null, defaultDir: 'desc' },
      net: { get: (c) => c.flows.total.net, defaultDir: 'desc' },
      delta: { get: (c) => (c.previousNet ? c.flows.total.net - c.previousNet : null), defaultDir: 'desc' },
      cashNet: { get: (c) => c.flows.cash.net, defaultDir: 'desc' },
      cashlessNet: { get: (c) => c.flows.cashless.net, defaultDir: 'desc' },
    }),
    [],
  )
  const { sort: pointSort, toggle: togglePointSort, sortedRows: sortedPoints } = useTableSort<Report['companies'][number], PointSortKey>({
    storageKey: 'cashflow.pointsSort',
    columns: pointSortColumns,
    initial: POINT_SORT_INITIAL,
    rows: report.companies,
  })
  return (
    <Section title="Точки" subtitle="Поток каждой точки за период. Изменение — к прошлому периоду такой же длины.">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px]">
          <thead className="bg-surface-muted">
            <tr>
              <SortableTh label="Точка" sortKey="name" sort={pointSort} onSort={togglePointSort} className={ths} />
              <SortableTh label="Пришло" sortKey="in" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
              <SortableTh label="Ушло" sortKey="out" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
              <SortableTh label="Поток" sortKey="net" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
              <SortableTh label="Изм." sortKey="delta" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
              <SortableTh label="Поток нал" sortKey="cashNet" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
              <SortableTh label="Поток безнал" sortKey="cashlessNet" sort={pointSort} onSort={togglePointSort} align="right" className={ths} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedPoints.map((c) => (
              <tr key={c.id} className={c.inTotals ? '' : 'text-muted-foreground'}>
                <td className={`${td} font-medium`}>
                  {c.name}
                  {c.isExtra ? <span className="ml-1 text-xs font-normal">({c.inTotals ? 'в итогах' : 'не в итогах'})</span> : null}
                </td>
                <td className={tdr}>{money(c.flows.total.in)}</td>
                <td className={tdr}>{money(c.flows.total.out)}</td>
                <td className={`${tdr} font-semibold ${tone(c.flows.total.net)}`}>{signed(c.flows.total.net)}</td>
                <td className={`${tdr} ${tone(c.flows.total.net - c.previousNet)}`}>{c.previousNet ? signed(c.flows.total.net - c.previousNet) : '—'}</td>
                <td className={`${tdr} ${tone(c.flows.cash.net)}`}>{signed(c.flows.cash.net)}</td>
                <td className={`${tdr} ${tone(c.flows.cashless.net)}`}>{signed(c.flows.cashless.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ─── Расходы ────────────────────────────────────────────────────────────────

function ExpensesTab({ report }: { report: Report }) {
  const labelOf = Object.fromEntries(report.activities.map((a) => [a.key, a.label]))
  const categorySortColumns = useMemo<SortColumns<Report['categories'][number], CategorySortKey>>(
    () => ({
      name: { get: (c) => c.name || null },
      activity: { get: (c) => c.activity || null },
      amount: { get: (c) => c.amount || null, defaultDir: 'desc' },
      cash: { get: (c) => c.cash || null, defaultDir: 'desc' },
      cashless: { get: (c) => c.cashless || null, defaultDir: 'desc' },
      previous: { get: (c) => c.previous || null, defaultDir: 'desc' },
      delta: { get: (c) => c.amount - c.previous, defaultDir: 'desc' },
    }),
    [],
  )
  const { sort: categorySort, toggle: toggleCategorySort, sortedRows: sortedCategories } = useTableSort<Report['categories'][number], CategorySortKey>({
    storageKey: 'cashflow.categoriesSort',
    columns: categorySortColumns,
    initial: CATEGORY_SORT_INITIAL,
    rows: report.categories,
  })

  const largeExpenseSortColumns = useMemo<SortColumns<Report['largestExpenses'][number], LargeExpenseSortKey>>(
    () => ({
      date: { get: (e) => e.date, defaultDir: 'desc' },
      company: { get: (e) => e.company || null },
      category: { get: (e) => e.category || null },
      payee: { get: (e) => e.payee || null },
      amount: { get: (e) => e.amount || null, defaultDir: 'desc' },
    }),
    [],
  )
  const { sort: largeExpenseSort, toggle: toggleLargeExpenseSort, sortedRows: sortedLargeExpenses } = useTableSort<Report['largestExpenses'][number], LargeExpenseSortKey>({
    storageKey: 'cashflow.largestExpensesSort',
    columns: largeExpenseSortColumns,
    initial: LARGE_EXPENSE_SORT_INITIAL,
    rows: report.largestExpenses,
  })
  return (
    <div className="space-y-5">
      <Section title="Статьи" subtitle={`Назначение — по группам справочника статей. «Было» — прошлый период такой же длины.${report.pending.count ? ` Ждут согласования: ${report.pending.count} на ${money(report.pending.total)}.` : ''}`}>
        {report.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расходов нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[760px]">
              <thead className="bg-surface-muted">
                <tr>
                  <SortableTh label="Статья" sortKey="name" sort={categorySort} onSort={toggleCategorySort} className={ths} />
                  <SortableTh label="Назначение" sortKey="activity" sort={categorySort} onSort={toggleCategorySort} className={ths} />
                  <SortableTh label="Сумма" sortKey="amount" sort={categorySort} onSort={toggleCategorySort} align="right" className={ths} />
                  <SortableTh label="Нал" sortKey="cash" sort={categorySort} onSort={toggleCategorySort} align="right" className={ths} />
                  <SortableTh label="Безнал" sortKey="cashless" sort={categorySort} onSort={toggleCategorySort} align="right" className={ths} />
                  <SortableTh label="Было" sortKey="previous" sort={categorySort} onSort={toggleCategorySort} align="right" className={ths} />
                  <SortableTh label="Изм." sortKey="delta" sort={categorySort} onSort={toggleCategorySort} align="right" className={ths} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedCategories.map((c) => (
                  <tr key={c.name}>
                    <td className={`${td} font-medium`}>{c.name}</td>
                    <td className={`${td} text-muted-foreground`}>{labelOf[c.activity] || c.activity}</td>
                    <td className={tdr}>{money(c.amount)}</td>
                    <td className={tdr}>{money(c.cash)}</td>
                    <td className={tdr}>{money(c.cashless)}</td>
                    <td className={`${tdr} text-muted-foreground`}>{money(c.previous)}</td>
                    <td className={`${tdr} ${tone(-(c.amount - c.previous))}`}>{signed(c.amount - c.previous)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Крупные расходы">
        {report.largestExpenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расходов нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px]">
              <thead className="bg-surface-muted">
                <tr>
                  <SortableTh label="Дата" sortKey="date" sort={largeExpenseSort} onSort={toggleLargeExpenseSort} className={ths} />
                  <SortableTh label="Точка" sortKey="company" sort={largeExpenseSort} onSort={toggleLargeExpenseSort} className={ths} />
                  <SortableTh label="Статья" sortKey="category" sort={largeExpenseSort} onSort={toggleLargeExpenseSort} className={ths} />
                  <SortableTh label="Кому / комментарий" sortKey="payee" sort={largeExpenseSort} onSort={toggleLargeExpenseSort} className={ths} />
                  <SortableTh label="Сумма" sortKey="amount" sort={largeExpenseSort} onSort={toggleLargeExpenseSort} align="right" className={ths} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedLargeExpenses.map((e, i) => (
                  <tr key={`${e.date}|${e.company}|${e.category}|${e.amount}|${i}`}>
                    <td className={td}>{dayLabel(e.date)}</td>
                    <td className={td}>{e.company}</td>
                    <td className={td}>
                      {e.category}
                      {e.pending ? <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300">на согласовании</span> : null}
                    </td>
                    <td className={`${td} max-w-[260px] truncate text-muted-foreground`}>{e.payee || '—'}</td>
                    <td className={tdr}>
                      {money(e.amount)}
                      <span className="block text-[11px] text-muted-foreground">
                        {e.cash ? `нал ${compact(e.cash)}` : ''}
                        {e.cash && e.cashless ? ' · ' : ''}
                        {e.cashless ? `безнал ${compact(e.cashless)}` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Остаток ────────────────────────────────────────────────────────────────

function BalanceDialog({
  open,
  onOpenChange,
  companies,
  defaultCompanyId,
  today,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companies: Array<{ id: string; name: string }>
  defaultCompanyId: string
  today: string
  onChanged: () => void
}) {
  const [anchors, setAnchors] = useState<Array<BalanceAnchor & { created_at?: string }>>([])
  const [canEdit, setCanEdit] = useState(false)
  const [available, setAvailable] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [scope, setScope] = useState('')
  const [date, setDate] = useState(today)
  const [cash, setCash] = useState('')
  const [cashless, setCashless] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const nameOf = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies])

  const loadAnchors = useCallback(async () => {
    const res = await fetch('/api/admin/cashflow/balance', { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (res.ok && body?.ok) {
      setAnchors(body.data.anchors || [])
      setCanEdit(Boolean(body.data.canEdit))
      setAvailable(Boolean(body.data.available))
      setHint(body.data.hint || null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setScope(defaultCompanyId)
    setDate(today)
    setCash('')
    setCashless('')
    setNote('')
    void loadAnchors()
  }, [open, defaultCompanyId, today, loadAnchors])

  const parse = (v: string) => Number(String(v).replace(/\s/g, '').replace(',', '.'))

  const save = async () => {
    const cashValue = parse(cash || '0')
    const cashlessValue = parse(cashless || '0')
    if (!Number.isFinite(cashValue) || !Number.isFinite(cashlessValue)) {
      toast({ title: 'Суммы должны быть числами', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/cashflow/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: scope || null, as_of_date: date, cash_amount: cashValue, cashless_amount: cashlessValue, note }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error || 'Не удалось сохранить')
      toast({ title: 'Остаток сохранён' })
      setCash('')
      setCashless('')
      setNote('')
      await loadAnchors()
      onChanged()
    } catch (e: any) {
      toast({ title: 'Не удалось сохранить', description: e?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const ok = await confirmDialog({ title: 'Удалить отметку остатка?', description: 'Остаток будет считаться от предыдущей отметки, если она есть.', confirmLabel: 'Удалить', destructive: true })
    if (!ok) return
    const res = await fetch(`/api/admin/cashflow/balance?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) {
      toast({ title: 'Не удалось удалить', description: body?.error, variant: 'destructive' })
      return
    }
    await loadAnchors()
    onChanged()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Остаток денег</DialogTitle>
          <DialogDescription>
            Сколько было наличных и безналичных на утро даты — до движений этого дня. Дальше система считает остаток сама. Пересчитали кассу — добавьте новую отметку.
          </DialogDescription>
        </DialogHeader>

        {!available ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{hint || 'Функция ещё не включена.'}</p>
        ) : (
          <div className="space-y-4">
            {canEdit ? (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Чьи деньги</Label>
                    <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)}>
                      <option value="">Вся организация</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label>На утро даты</Label>
                    <DatePicker value={date} max={today} onChange={setDate} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Наличные, ₸</Label>
                    <Input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Безналичный, ₸</Label>
                    <Input value={cashless} onChange={(e) => setCashless(e.target.value)} inputMode="decimal" placeholder="0" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: пересчёт кассы и выписка банка" />
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Указать остаток может владелец или управляющий.</p>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Отметки</p>
              {anchors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Пока нет ни одной.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border">
                  {anchors.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {dayLabel(a.as_of_date)} · {a.company_id ? nameOf.get(a.company_id) || 'Точка' : 'Вся организация'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          нал {money(Number(a.cash_amount))} · безнал {money(Number(a.cashless_amount))}
                          {a.note ? ` · ${a.note}` : ''}
                        </p>
                      </div>
                      {canEdit ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => void remove(a.id)} aria-label="Удалить отметку">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
